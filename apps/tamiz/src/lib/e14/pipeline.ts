// CUERPO del pipeline de escaneo (FASE F — move-only del original, versión
// mínima D8 opción B). Ejecuta: decode → detección de bordes → warp →
// calidad → OCR (escalonado/cascada + bandas) → clasificación → gate, con
// inyección de los pasos que comparte con RealCoreBridge (PasosPipelineL2).
// Todo el tiempo medido cae en `parcial.msParciales` (el watchdog lo lee).

import {
  clasificarDesdeOcr,
  type ClasificacionE14,
} from '@jg-stevan/scanner-core/dominio/clasificador';
import { detectDocumentEdgesDetail, processImage } from '@jg-stevan/scanner-core/core/image-processor';
import { defaultQuad, type PageFilter } from '@jg-stevan/scanner-core/core/types';
import type { Acta, ProgresoAnalisis } from '@jg-stevan/scanner-core/dominio/types';
import type { OpcionesEscaneo } from '@jg-stevan/scanner-core/dominio/bridge';
import type { CamposActa, OpcionesEscaneoConTimeout, ParcialPipeline, PasosPipelineL2 } from './bridge/protocolo';
// PLAN-AGENTE-LAYOUT F4: copy canónico del rechazo estructural (el detalle
// viaja con la regla exacta y su motivo — ver DETALLE_* en protocolo.ts).
import { DETALLE_ESTRUCTURA } from './bridge/protocolo';
import type { EntradaPipeline } from './bridge/captura';
// ETAPA B (plan "interfaz única E-14"): el veredicto del MOLDE puede
// sustituir al del gate cuando el acta se ENRUTA a una plantilla de la
// biblioteca (documento no electoral reconocido por el motor universal).
import { veredictoDeResumen } from './molde/enrutamiento';
import { logger } from '../logger';

function marcar(parcial: ParcialPipeline, fase: string, t0: number): void {
  parcial.msParciales = { ...(parcial.msParciales ?? {}), [fase]: Math.round(performance.now() - t0) };
}

/** Densidad de tinta de una foto procesada (0..1) — para procesadaVacia. */
async function razonTinta(dataUrl: string): Promise<number> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const W = 200;
  const H = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * W));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  let oscuros = 0;
  const n = W * H;
  for (let i = 0; i < n; i++) {
    if (d[i * 4] < 120) oscuros++;
  }
  return oscuros / n;
}

export async function correrPipelineL2(
  opciones: OpcionesEscaneoConTimeout,
  entrada: EntradaPipeline,
  parcial: ParcialPipeline,
  emitir: (p: ProgresoAnalisis) => void,
  pasos: PasosPipelineL2,
): Promise<Acta> {
  // ---- CAPTURA: decode + warm-up ----
  let t0 = performance.now();
  emitir(pasos.conRampa('DETECTANDO', 0));
  await pasos.esperarWorkerCaliente();
  const fotoOriginal =
    'archivo' in entrada ? await pasos.decodeArchivoMemo(entrada.archivo) : entrada.dataUrl;
  parcial.fotoOriginal = fotoOriginal;
  marcar(parcial, 'decode', t0);

  // ---- DETECCIÓN de bordes ----
  t0 = performance.now();
  emitir(pasos.conRampa('DETECTANDO', 0.6));
  let quad = pasos.quadIdentidad;
  let origenDeteccion: string | null = null;
  // Un ARCHIVO subido ya ES el documento (escaneo/recorte previo): volver a
  // recortarlo con la heurística de gradientes engancha recuadros internos del
  // formulario (p. ej. la tabla de nivelación del E-14) y el pipeline —gate y
  // OCR— termina viendo solo un fragmento. La detección queda para la cámara.
  const esArchivoSubido = 'archivo' in entrada;
  try {
    if (esArchivoSubido) {
      origenDeteccion = 'archivo-identidad';
    } else {
      const detalle = await detectDocumentEdgesDetail(fotoOriginal);
      quad = detalle.quad;
      origenDeteccion = detalle.origen;
    }
  } catch {
    quad = defaultQuad(); // degradación honesta: la foto entera es el documento
  }
  marcar(parcial, 'detect', t0);

  // ---- RECORTANDO: warp + filtro ----
  t0 = performance.now();
  emitir(pasos.conRampa('RECORTANDO', 0.2));
  // §D8.3: los assets de SIMULACIÓN corren as-is ("original"); el flujo
  // normal nace en B/N adaptativo ("bw").
  const filtro: PageFilter = opciones.fuente === 'SIMULACION' ? 'original' : 'bw';
  // FASE A3 (blueprint DLA): warp de perspectiva real cuando el quad está
  // sesgado + deskew residual por perfil de proyección (flag del operador).
  const warp = await processImage(fotoOriginal, quad, filtro, 0, {
    deskew: pasos.deskewHabilitado,
  });
  marcar(parcial, 'proceso', t0);

  // ---- CALIDAD ----
  t0 = performance.now();
  emitir(pasos.conRampa('CALIDAD', 0.3));
  const calidad = await pasos.calidadDeActa(warp.processed);
  const scoreVisual = pasos.scoreDeCalidad(calidad);
  marcar(parcial, 'calidad', t0);

  // ---- LAYOUT (PLAN-AGENTE-LAYOUT F4): gate estructural ANTES del OCR ----
  // Molde sin layout, flag DLA apagada o modelo no configurado → null (etapa
  // saltada, retrocompatible con moldes v3.0.0). Regla obligatoria faltante →
  // corte temprano RECHAZADA/INCOMPLETA con la regla y el motivo exactos: un
  // documento equivocado no debe gastar un OCR completo.
  let estructura: CamposActa['estructura'] = null;
  t0 = performance.now();
  emitir(pasos.conRampa('LAYOUT', 0.4));
  try {
    estructura = (await pasos.evaluarEstructuraActa?.(warp.processed)) ?? null;
  } catch {
    estructura = null; // fallo honesto: el escaneo continúa sin gate
  }
  marcar(parcial, 'layout', t0);
  emitir(pasos.conRampa('LAYOUT', 1));

  if (estructura && !estructura.ok && estructura.obligatorias_faltantes.length > 0) {
    // Primera regla con problema (faltante/baja_confianza) — el detalle lleva
    // la etiqueta EXACTA y su motivo para que el operador sepa qué faltó.
    const primera = estructura.reglas.find(
      (r) => r.estado === 'faltante' || r.estado === 'baja_confianza',
    );
    const detalleRegla = primera
      ? `${DETALLE_ESTRUCTURA} — FALTA: ${primera.etiqueta.toUpperCase()} (${primera.motivo ?? primera.estado})`
      : DETALLE_ESTRUCTURA;
    return pasos.construirActa(opciones as OpcionesEscaneo, parcial, {
      // Acta MÍNIMA del rechazo temprano: el OCR NUNCA corrió (ese es el
      // ahorro del gate) — sin texto ni clasificación. Lo fotográfico ya
      // conocido viaja para el diagnóstico y el overlay en REVISIÓN.
      quadDetectado: quad,
      calidad,
      fotoProcesada: warp.processed,
      filtro,
      ocrTexto: '',
      score: 0,
      status: 'RECHAZADA',
      rechazo: { tipo: 'INCOMPLETA', detalle: detalleRegla },
      clasificacion: null,
      estructura,
    });
  }

  // ---- OCR ----
  t0 = performance.now();
  emitir(pasos.conRampa('OCR', 0.15));
  let ocrTexto = await pasos.reconocerRapidOcrEscalonado(warp.processed);
  if (ocrTexto.length < 60) {
    ocrTexto = await pasos.reconocerRapidOcrCascada(warp.processed);
  }
  // FASE B3 (blueprint DLA): banda DINÁMICA desde regiones de layout cuando
  // el paso inyectado la provee (flag + modelo); caída a las bandas fijas
  // 16%/20% de siempre sin señal (Nivel 1 intacto).
  const banda =
    (await pasos.ocrBandaDinamica?.(warp.processed, "sup")) ??
    (await pasos.ocrBanda(warp.processed));
  const bandaInf =
    (await pasos.ocrBandaDinamica?.(warp.processed, "inf")) ??
    (await pasos.ocrBandaInferior(warp.processed));
  marcar(parcial, 'ocr', t0);
  emitir(pasos.conRampa('OCR', 1));

  // ---- CLASIFICACIÓN + completitud ----
  const textoCompleto = `${banda}\n${ocrTexto}\n${bandaInf}`;
  const clasificacionBase = clasificarDesdeOcr(textoCompleto);
  const esquinas = await pasos.esquinasDeActa(warp.processed);
  const tinta = await razonTinta(warp.processed);
  const procesadaVacia = tinta < 0.002;

  // ---- GATE ----
  // Techos (§D1/§K): sin señal de contenido o recorte detectado, el score
  // NO puede pasar los techos del sitio.
  let score = scoreVisual;
  let clasificacion: ClasificacionE14 | null = clasificacionBase;
  if (clasificacionBase && !pasos.senalDeContenido(textoCompleto, clasificacionBase)) {
    score = Math.min(score, pasos.TECHO_SIN_SENAL);
    clasificacion = null; // sin señal no se afianza la identificación
  }
  if (pasos.contrasteEfectivoDe(calidad) < 0.18) {
    // Escudo de fondo: el flash/sombra sepulta el documento.
    score = Math.min(score, pasos.TECHO_ESCUDO_FONDO);
  }

  const campos: CamposActa = {
    fotoProcesada: warp.processed,
    procesadaVacia,
    recortada: !esquinas.completa,
    recorteLado: esquinas.ladoEsquina,
    quadDetectado: quad,
    calidad,
    ocrTexto,
    motor: 'canvas',
    filtro,
    score,
    scoreVisual,
    status: 'OPTIMA', // sobreescrito por el gate
    rechazo: null,
    clasificacion,
  };

  // Recorte cortado con tinta al filo → INCOMPLETA directa (F-5).
  if (campos.recortada) {
    return pasos.construirActa(opciones as OpcionesEscaneo, parcial, {
      ...campos,
      score: 0,
      status: 'RECHAZADA',
      rechazo: { tipo: 'INCOMPLETA', detalle: pasos.DETALLE_INCOMPLETA },
      clasificacion: null,
    });
  }
  if (procesadaVacia) {
    return pasos.construirActa(opciones as OpcionesEscaneo, parcial, {
      ...campos,
      score: 0,
      status: 'RECHAZADA',
      rechazo: { tipo: 'SIN_VOTOS', detalle: pasos.DETALLE_SIN_VOTOS },
      clasificacion: null,
    });
  }

  const clasifFinal: ClasificacionE14 = clasificacion ?? {
    nivel: 'SUGERIDA',
    tipo: null,
    mesa: null,
    pagina: null,
  };
  const gate = pasos.evaluarGate(
    score,
    ocrTexto,
    clasifFinal,
    opciones.intento ?? 1,
    opciones.maxIntentos ?? 3,
  );

  // FASE 0 (blueprint DLA): evaluación del MOLDE tras el gate (paso
  // inyectado — Tamiz ejecuta el motor universal compartido). ETAPA B: el
  // paso recibe el CONTEXTO E-14 (¿el clasificador electoral leyó el tipo?)
  // y puede marcar el resultado `enrutado` cuando la biblioteca identifica
  // un documento no electoral. Fallo del paso → null honesto (el escaneo
  // sigue).
  let evaluacionMolde: CamposActa['evaluacionMolde'] = null;
  try {
    evaluacionMolde = await pasos.evaluarMolde(warp.processed, {
      esE14: (clasificacionBase?.tipo ?? null) !== null,
    });
  } catch (e) {
    logger.warn('[pipeline] paso de molde falló (el escaneo sigue sin él)', {
      mensaje: (e as Error).message,
    });
    evaluacionMolde = null;
  }

  // ETAPA B (B.2 + B.3) — acta ENRUTADA al molde: el score/estado/rechazo
  // del acta derivan del RESULTADO DEL MOLDE (semáforo verde/ámbar/rojo
  // universal con la misma escala del gate). La clasificación E-14 queda
  // null (no hay cabecera electoral que archivar) y el banner toma el
  // nombre del documento en construirActa. Sin enrutamiento: veredicto del
  // gate intacto y resultado del molde ADITIVO (doctrina de siempre).
  const veredictoMolde = evaluacionMolde?.enrutado
    ? veredictoDeResumen(evaluacionMolde)
    : null;

  void origenDeteccion;
  return pasos.construirActa(opciones as OpcionesEscaneo, parcial, {
    ...campos,
    score: veredictoMolde?.score ?? score,
    status: veredictoMolde?.status ?? gate.status,
    rechazo: veredictoMolde ? veredictoMolde.rechazo : gate.rechazo,
    clasificacion: veredictoMolde ? null : gate.clasificacion,
    evaluacionMolde,
    // PLAN-AGENTE-LAYOUT F4: veredicto del gate estructural (ADITIVO —
    // null = etapa saltada). El overlay de REVISIÓN lo consume.
    estructura,
  });
}
