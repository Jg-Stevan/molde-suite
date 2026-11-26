// CUERPO del pipeline de escaneo (FASE F — move-only del original, versión
// mínima D8 opción B). Ejecuta: decode → detección de bordes → warp →
// calidad → OCR (escalonado/cascada + bandas) → clasificación → gate, con
// inyección de los pasos que comparte con RealCoreBridge (PasosPipelineL2).
// Todo el tiempo medido cae en `parcial.msParciales` (el watchdog lo lee).

import {
  clasificarDesdeOcr,
  type ClasificacionE14,
} from '@molde-suite/scanner-core/dominio/clasificador';
import { processImage, processImageDual } from '@molde-suite/scanner-core/core/image-processor';
import { defaultQuad, type PageFilter } from '@molde-suite/scanner-core/core/types';
import type { Acta, ProgresoAnalisis } from '@molde-suite/scanner-core/dominio/types';
import type { OpcionesEscaneo } from '@molde-suite/scanner-core/dominio/bridge';
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
import { probeOrientacion, rotarDataUrl } from './orientacion';
import type { ProbeOrientacion } from './orientacion';
import { decodificarQrCapa0Camara } from '@molde-suite/scanner-core/qr/capa0-qr.client';
// KIT e14-ocr-cascada-v1: con `ocrCascada` ON el OCR es la CASCADA de
// digielect (intento 1 → GATE → core → rescate); OFF = escalonado de siempre.
import { cascadaActiva } from '@molde-suite/scanner-core/orquestacion/cascada';
import { leerFlags } from './flags';
import { presupuestoEscaneoEfectivo } from './adaptacion/plan';
import type { CfgOcr } from './bridge/ocr';
// Detección del quad de la foto: worker OpenCV (la misma vía del visor en
// vivo) con la heurística del core como respaldo.
import { detectarQuadDeFoto } from './bridge/deteccion-quad';
// 2.4 — política universal del gate (C3 lectura + escudo-fondo).
import { aplicarPoliticaUniversal } from './politica/gate';
import { senalDeLectura } from '@molde-suite/scanner-core/dominio/senal-lectura';

function marcar(parcial: ParcialPipeline, fase: string, t0: number): void {
  parcial.msParciales = { ...(parcial.msParciales ?? {}), [fase]: Math.round(performance.now() - t0) };
}

// §D4/plan §B (rotada-12) — ANCHO de la miniatura de medición de tinta.
// CAUSA RAÍZ medida: a 200 px el promediado de la reducción BORRA los trazos
// finos — rotada-12 (recibo claro, 1.37 % de tinta real a resolución
// completa) medía 0.0009 < 0.002 ⇒ procesadaVacia FALSA y el visor caía a la
// foto original (§D4 activado sin procesada realmente vacía). A 600 px la
// misma foto mide 0.0124 (6× el umbral) y TODOS los fixtures del banco
// quedan sobre 0.008; una página REALMENTE en blanco mide 0 a cualquier
// ancho (scripts/resultados/*.json, diagnóstico 2026-11-25). El costo es el
// mismo: img.decode() ya decodifica la foto completa.
export const ANCHO_MEDIDA_TINTA = 600;

/**
 * Densidad de tinta (0..1) sobre PÍXELES RGBA — PURA (sin DOM, testeable en
 * bun): reducción por caja a `ancho` px de ancho (identidad si los píxeles
 * ya vienen a ese ancho o menos — sin upscale) y conteo de oscuros
 * (canal rojo < 120, mismo criterio histórico del pipeline).
 */
export function razonTintaDePixeles(
  px: { w: number; h: number; data: Uint8Array | Uint8ClampedArray },
  ancho: number = ANCHO_MEDIDA_TINTA,
): number {
  if (px.w <= 0 || px.h <= 0) return 0;
  const W = Math.max(1, Math.min(px.w, Math.round(ancho)));
  const H = Math.max(1, Math.round((px.h / px.w) * W));
  let oscuros = 0;
  // Reducción por caja (misma semántica del drawImage suavizado que había):
  // cada píxel destino promedia su ventana origen [x0..x1)×[y0..y1).
  const sx = px.w / W;
  const sy = px.h / H;
  for (let y = 0; y < H; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.min(px.h, Math.max(y0 + 1, Math.floor((y + 1) * sy)));
    for (let x = 0; x < W; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.min(px.w, Math.max(x0 + 1, Math.floor((x + 1) * sx)));
      let acc = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          acc += px.data[(yy * px.w + xx) * 4];
          n++;
        }
      }
      if (acc / n < 120) oscuros++;
    }
  }
  return oscuros / (W * H);
}

/** Densidad de tinta de una foto procesada (0..1) — para procesadaVacia. */
async function razonTinta(dataUrl: string): Promise<number> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const W = ANCHO_MEDIDA_TINTA;
  const H = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * W));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, W, H);
  // La PURA hace el conteo (downscale identidad: los píxeles ya vienen a W) —
  // el camino de producción y los tests bun comparten la MISMA matemática.
  const d = ctx.getImageData(0, 0, W, H);
  return razonTintaDePixeles({ w: d.width, h: d.height, data: d.data }, W);
}

export async function correrPipelineL2(
  opciones: OpcionesEscaneoConTimeout,
  entrada: EntradaPipeline,
  parcial: ParcialPipeline,
  emitir: (p: ProgresoAnalisis) => void,
  pasos: PasosPipelineL2,
): Promise<Acta> {
  // Base del PRESUPUESTO del OCR (el timeout existente del pipeline manda —
  // §3 del kit escalonado): cuenta desde el arranque del pipeline, como en
  // digielect14.
  const tInicioPipeline = performance.now();
  // ---- CAPTURA: decode + warm-up ----
  let t0 = performance.now();
  emitir(pasos.conRampa('DETECTANDO', 0));
  await pasos.esperarWorkerCaliente();
  const fotoOriginal =
    'archivo' in entrada ? await pasos.decodeArchivoMemo(entrada.archivo) : entrada.dataUrl;
  parcial.fotoOriginal = fotoOriginal;
  // e64-qr T-2.1 (upstream pipeline.ts:192-201) — CAPA 0 QR en WORKER,
  // EN PARALELO con todo el pipeline: alimenta parcial.qrCam (contrato ya
  // cableado en construirActa/checklist) y la brújula de orientación.
  const qrCamPromesa: Promise<ParcialPipeline['qrCam']> = (async () => {
    try {
      const r = await decodificarQrCapa0Camara(fotoOriginal);
      return r && 'payload' in r ? { payload: r.payload } : null;
    } catch {
      return null;
    }
  })();
  marcar(parcial, 'decode', t0);

  // ---- DETECCIÓN de bordes ----
  t0 = performance.now();
  emitir(pasos.conRampa('DETECTANDO', 0.6));
  let quad = pasos.quadIdentidad;
  let origenDeteccion: string | null = null;
  // Regresión del port corregida (2026-11-25): los archivos importados TAMBIÉN
  // pasan por el detector — antes usaban quad identidad y la «procesada» era
  // el fotograma entero con fondo. Sin bordes, el detector degrada a identidad.
  try {
    const detalle = await detectarQuadDeFoto(fotoOriginal);
    quad = detalle.quad;
    origenDeteccion = detalle.origen;
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
  // F1: warp compartido — un solo warp (original) y bw derivado por Bradley.
  // Kill-switch: warpCompartido=false ⇒ dos processImage (histórico).
  let warp: Awaited<ReturnType<typeof processImage>>;
  let warpOcr: Awaited<ReturnType<typeof processImage>>;
  if (filtro !== 'original' && leerFlags().warpCompartido) {
    const dual = await processImageDual(fotoOriginal, quad, 0, {
      deskew: pasos.deskewHabilitado,
    });
    warp = dual.bw;
    warpOcr = dual.original;
  } else {
    warp = await processImage(fotoOriginal, quad, filtro, 0, {
      deskew: pasos.deskewHabilitado,
    });
    // D2 (§D8.2 upstream) — VARIANTE OCR ORIGINAL: el OCR JAMÁS lee la
    // variante binarizada ('bw'/'contrast'); corre sobre un warp SIN filtro.
    warpOcr =
      filtro === 'original'
        ? warp
        : await processImage(fotoOriginal, quad, 'original', 0, {
            deskew: pasos.deskewHabilitado,
          });
  }
  // Guarda §D4 (contrato del visor): una salida VACÍA de processImage
  // (canvas 0×0, encode fallido) JAMÁS viaja como fotoProcesada:'' — se
  // lanza con causa explícita y el puente resuelve el rechazo (catch
  // honesto aguas arriba: bridge → ESCANEO_FALLIDO). fotoProcesada queda
  // ausente/null en cualquier acta; el '' silencioso está prohibido.
  if (!warp.processed || !warpOcr.processed) {
    logger.warn('[pipeline] processImage devolvió salida vacía', {
      dims: `${warp.width}x${warp.height}`,
      ms: Math.round(performance.now() - t0),
    });
    throw new Error('PROCESADO DE IMAGEN SIN SALIDA (data URL vacío)');
  }
  let fotoOcr = warpOcr.processed;
  let fotoProcesada = warp.processed;
  marcar(parcial, 'proceso', t0);

  // ---- ORIENTACIÓN ----
  t0 = performance.now();
  emitir(pasos.conRampa('RECORTANDO', 0.9));
  let probeOri: ProbeOrientacion | null = null;
  const qrCam = await qrCamPromesa;
  if (qrCam) parcial.qrCam = qrCam;
  if (opciones.fuente !== 'SIMULACION') {
    try {
      probeOri = await probeOrientacion(fotoOcr);
    } catch {
      probeOri = null;
    }
    if (probeOri?.aplicado) {
      fotoOcr = await rotarDataUrl(fotoOcr, probeOri.rot);
      fotoProcesada = await rotarDataUrl(fotoProcesada, probeOri.rot);
    }
  }
  if (probeOri != null) parcial.probeMsOrientacion = probeOri.ms;
  marcar(parcial, 'orientacion', t0);

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
    estructura = (await pasos.evaluarEstructuraActa?.(fotoProcesada)) ?? null;
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
      fotoProcesada,
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
  // KIT e14-ocr-cascada-v1 — `ocrCascada` ON: CASCADA de digielect (intento 1
  // Tesseract best / RapidOCR según `ocrPrimeraPasadaRapida` → GATE entre
  // motores → core RapidOCR escalonado → rescate ROI/motor). OFF: escalonado
  // de siempre byte a byte. SIM: una pasada completa, 0 trazas (§3).
  const cfgOcr: CfgOcr = {
    simular: opciones.fuente === 'SIMULACION',
    presupuestoMs: opciones.timeoutMs ?? presupuestoEscaneoEfectivo(),
    inicioMs: tInicioPipeline,
    orientacionDecidida: false, // la brújula QR aún no se cablea al pipeline
    corteIncompleta: false,
  };
  const onProgresoOcr = (p: number): void =>
    emitir(pasos.conRampa('OCR', Math.min(1, 0.15 + 0.85 * Math.max(0, p))));
  // F2: capturar las líneas Rapid del cascade para reuso en el router/molde.
  let lineasRapidCascade: Array<{ texto: string; conf: number; box: Array<{ x: number; y: number }> }> | undefined;
  const ocrTexto = cascadaActiva(leerFlags().ocrCascada, cfgOcr.simular)
    ? await pasos.reconocerRapidOcrCascada(fotoOcr, onProgresoOcr, cfgOcr).then((r) => {
        lineasRapidCascade = r.lineasRapid;
        return r.texto;
      })
    : await pasos.reconocerRapidOcrEscalonado(fotoOcr, onProgresoOcr, cfgOcr);
  // FASE B3 (blueprint DLA): banda DINÁMICA desde regiones de layout cuando
  // el paso inyectado la provee (flag + modelo); caída a las bandas fijas
  // 16%/20% de siempre sin señal (Nivel 1 intacto).
  const banda =
    (await pasos.ocrBandaDinamica?.(fotoOcr, "sup")) ??
    (await pasos.ocrBanda(fotoOcr));
  const bandaInf =
    (await pasos.ocrBandaDinamica?.(fotoOcr, "inf")) ??
    (await pasos.ocrBandaInferior(fotoOcr));
  marcar(parcial, 'ocr', t0);
  emitir(pasos.conRampa('OCR', 1));

  // ---- CLASIFICACIÓN + completitud ----
  const textoCompleto = `${banda}\n${ocrTexto}\n${bandaInf}`;
  const clasificacionBase = clasificarDesdeOcr(textoCompleto);
  const esquinas = await pasos.esquinasDeActa(warp.processed);
  const tinta = await razonTinta(warp.processed);
  const procesadaVacia = tinta < 0.002;
  // Telemetría §D4: cuando la bandera se activa, el valor medido viaja al
  // log (diagnóstico de falsos positivos sin reproducir el escaneo).
  if (procesadaVacia) {
    logger.warn('[pipeline] procesada sin tinta medible (§D4)', {
      tinta: tinta.toFixed(6),
      umbral: 0.002,
    });
  }

  // ---- GATE (2.4 — política universal; paridad escaneo↔recorte) ----
  // C3 PRIMERO (pitfall §9.4): el OCR manda — piso FUERTE / techo DEBIL por
  // la LECTURA del texto, antes de cualquier techo del sitio.
  const politica = aplicarPoliticaUniversal({
    score: scoreVisual,
    nivelLectura: senalDeLectura(textoCompleto).nivel,
    // El fork no mide `level`: sin proxy de `poor`, el piso de lectura
    // vence al techo fair (decisión del kit «el OCR manda» §3).
    calidadPoor: false,
    contrasteEfectivo: pasos.contrasteEfectivoDe(calidad),
    completa: esquinas.completa,
    manual: false, // el ESCANEO jamás es manual (el recorte del editor va por pipeline-recorte)
  });
  let score = politica.score;
  let clasificacion: ClasificacionE14 | null = clasificacionBase;
  if (clasificacionBase && !pasos.senalDeContenido(textoCompleto, clasificacionBase)) {
    score = Math.min(score, pasos.TECHO_SIN_SENAL);
    clasificacion = null; // sin señal no se afianza la identificación
  }

  const campos: CamposActa = {
    fotoProcesada,
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

  // ETAPA B — el ROUTER de moldes corre ANTES de los rechazos del gate: un
  // documento genérico no puede morir por una razón electoral (recorte
  // sospechado, página sin tinta) sin que la biblioteca haya tenido la
  // oportunidad de identificarlo. El OCR ya corrió y el router lo reutiliza.
  // Fallo del paso → null honesto (el escaneo sigue sin él).
  let evaluacionMolde: CamposActa['evaluacionMolde'] = null;
  try {
    evaluacionMolde = await pasos.evaluarMolde(
      fotoProcesada,
      { esE14: (clasificacionBase?.tipo ?? null) !== null },
      // Fase 4 (plan primera ola): la geometría SIN binarizar ya existe
      // (`fotoOcr`, la que leyó RapidOCR) — el molde la usa como A/B cuando
      // la imagen bw no produce ninguna lectura.
      // F2: líneas Rapid del cascade para reuso en el router (flag-gated).
      { fotoOriginal: fotoOcr, lineasRapid: lineasRapidCascade, anchoOcr: warpOcr.width },
    );
  } catch (e) {
    logger.warn('[pipeline] paso de molde falló (el escaneo sigue sin él)', {
      mensaje: (e as Error).message,
    });
    evaluacionMolde = null;
  }
  // Acta ENRUTADA al molde: score/estado/rechazo derivan del RESULTADO DEL
  // MOLDE (semáforo universal con la misma escala del gate). La clasificación
  // E-14 queda null y el banner toma el nombre del documento en construirActa.
  // Sin enrutamiento: veredicto del gate intacto y resultado del molde ADITIVO.
  const veredictoMolde = evaluacionMolde?.enrutado
    ? veredictoDeResumen(evaluacionMolde)
    : null;

  // Recorte cortado con tinta al filo → INCOMPLETA directa (F-5). Si el molde
  // ya identificó el documento y dio veredicto, manda él: la geometría sola no
  // condena (doctrina «prohibido rechazar por coordenadas»).
  if (campos.recortada && !veredictoMolde) {
    return pasos.construirActa(opciones as OpcionesEscaneo, parcial, {
      ...campos,
      score: 0,
      status: 'RECHAZADA',
      rechazo: { tipo: 'INCOMPLETA', detalle: pasos.DETALLE_INCOMPLETA },
      clasificacion: null,
      evaluacionMolde,
    });
  }
  if (procesadaVacia && !veredictoMolde) {
    return pasos.construirActa(opciones as OpcionesEscaneo, parcial, {
      ...campos,
      score: 0,
      status: 'RECHAZADA',
      rechazo: { tipo: 'SIN_VOTOS', detalle: pasos.DETALLE_SIN_VOTOS },
      clasificacion: null,
      evaluacionMolde,
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
