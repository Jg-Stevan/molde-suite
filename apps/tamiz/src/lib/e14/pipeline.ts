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
import type { EntradaPipeline } from './bridge/captura';

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
  try {
    const detalle = await detectDocumentEdgesDetail(fotoOriginal);
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

  // FASE 0 (blueprint DLA): evaluación del MOLDE ACTIVO tras el gate (paso
  // inyectado — Tamiz ejecuta el motor universal compartido cuando hay molde
  // registrado). ADITIVO: no toca score/status/rechazo; su veredicto viaja en
  // `acta.evaluacionMolde`. Fallo del paso → null honesto (el escaneo sigue).
  let evaluacionMolde: CamposActa['evaluacionMolde'] = null;
  try {
    evaluacionMolde = await pasos.evaluarMolde(warp.processed);
  } catch {
    evaluacionMolde = null;
  }

  void origenDeteccion;
  return pasos.construirActa(opciones as OpcionesEscaneo, parcial, {
    ...campos,
    score,
    status: gate.status,
    rechazo: gate.rechazo,
    clasificacion: gate.clasificacion,
    evaluacionMolde,
  });
}
