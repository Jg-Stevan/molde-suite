'use client';

// Cliente Tesseract.js v7 para el navegador: OCR de pagina completa con
// lineas/palabras (equivale a ocr_lines del motor Python) + re-OCR del ID
// amplificado con whitelist de digitos (fuente ocr_relectura).
//
// FIX P1 (diagnostico 2026-11-21, seccion 2): el core se carga AUTO-HOSPEDADO
// (public/tesseract/, misma origen) y con variante FIJADA por probe SIMD —
// nunca la variante relaxedsimd defectuosa que jsDelivr reparte por defecto
// (abort "missing function: DotProductSSE"). Ver ocr-core-resolver.ts.
//
// FIX P1 (recuperacion): ante abort/error del worker, se termina, se recrea y
// se reintenta UNA vez re-aplicando los parametros (PSM/whitelist). Si el
// reintento falla, el error propagado describe la causa real (antes: toast
// generico "Error procesando ..." sin detalle y corrida colgada en "Cargando").
//
// FIX P3 (logger): los mensajes informativos del core llegan al logger junto
// con el progreso; solo los estados del ciclo de vida alimentan la UI. Todo lo
// demas se degrada a console.debug (antes: ruido tipo "Estimating resolution
// as N" / "Error in boxClipToRectangle" ensuciaba la consola como error).
// El ruido stderr que emite el DENTRO del worker se filtra en el propio
// worker.min.js auto-hospedado (patch print/printErr — ver docs/FIX-OCR-P1.md).

import type { Worker as TesseractWorker } from 'tesseract.js';
import { canvasGrayscale, otsuThreshold } from '@/lib/molde/imageproc';
// Fase 3 (migración scanner-core): mapeo OCR compartido con Tamiz (D3).
import { lineasDesdeBlocksTesseract } from '@jg-stevan/scanner-core/molde/ocr-mapeo';
import { tesseractWorkerOptions } from '@/lib/ocr/ocr-core-resolver';
import type { LineaOcr, PalabraOcr } from '@/lib/molde/types';

type ProgressCb = (info: { status: string; progress: number }) => void;

// Estados del ciclo de vida de tesseract.js v7 que la UI muestra con barra de
// progreso. Cualquier otro mensaje que llegue al logger es ruido del core.
const ESTADOS_CICLO = new Set([
  'loading tesseract core',
  'initializing tesseract',
  'loading language traineddata',
  'initializing api',
  'recognizing text',
]);

let progressCb: ProgressCb | null = null;
let workerPromise: Promise<TesseractWorker> | null = null;

export function setOcrProgress(cb: ProgressCb | null): void {
  progressCb = cb;
}

/** Logger propio (P3): filtra el ruido del core y alimenta la barra de progreso. */
function loggerTesseract(m: { status: string; progress: number }): void {
  if (typeof m.status !== 'string') return;
  if (ESTADOS_CICLO.has(m.status)) {
    if (progressCb) progressCb(m);
    return;
  }
  // Ruido del core (p. ej. mensajes reflejados del binario): nivel debug.
  console.debug('[tesseract]', m.status);
}

async function crearWorker(): Promise<TesseractWorker> {
  const { createWorker, PSM } = await import('tesseract.js');
  // Benchmark de motores (scripts/benchmark-motores-anclas.ts): 'spa' OEM 1
  // (LSTM) es ~25% más rápido y descarga ~3x menos datos que 'spa+eng' con el
  // MISMO recall de anclas. Mejor para celulares.
  const worker = await createWorker('spa', 1, {
    // P1: assets auto-hospedados con variante fijada (nunca relaxedsimd) y sin
    // dependencia de CDN en runtime (core, worker y traineddata same-origin).
    ...tesseractWorkerOptions(),
    logger: loggerTesseract,
    // P1: sin errorHandler, un reject del worker se relanza como excepción no
    // controlada en la página (throw Error(data) dentro de onMessage). Con
    // errorHandler el fallo queda capturado y la recuperación decide.
    errorHandler: (err: unknown) => {
      console.debug('[tesseract] error de worker capturado:', err);
    },
  });
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_COLUMN, // psm 4: columna única, ideal para el acta
    preserve_interword_spaces: '1',
  });
  return worker;
}

/** Termina el worker actual (si existe) y fuerza su recreación en el próximo uso. */
export function resetOcrWorker(): void {
  if (workerPromise) {
    workerPromise
      .then((w) => {
        w.terminate().catch(() => {});
      })
      .catch(() => {});
  }
  workerPromise = null;
}

async function getWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = crearWorker();
    // Si la creación falla (p. ej. core ausente), limpiar para permitir reintento.
    workerPromise.catch(() => {
      workerPromise = null;
    });
  }
  return workerPromise;
}

/**
 * Ejecuta una operación OCR con recuperación ante abort del worker (P1):
 * 1. intento con el worker vivo;
 * 2. si falla → terminate + recrear + UN reintento (la op re-aplica sus
 *    parámetros, pues el worker nuevo nace con los parámetros base);
 * 3. si el reintento también falla → error explícito con la causa real.
 */
async function conRecuperacion<T>(op: (worker: TesseractWorker) => Promise<T>): Promise<T> {
  let worker = await getWorker();
  try {
    return await op(worker);
  } catch (errPrimero) {
    const msg = errPrimero instanceof Error ? errPrimero.message : String(errPrimero);
    console.warn(`[ocr] worker falló (${msg}); terminando y recreando para reintentar una vez...`);
    resetOcrWorker();
    worker = await getWorker();
    try {
      return await op(worker);
    } catch (errSegundo) {
      const msg2 = errSegundo instanceof Error ? errSegundo.message : String(errSegundo);
      // Abort persistente: el error que sube a la UI describe la causa real.
      throw new Error(`El OCR falló tras reintentar con un worker nuevo. Causa: ${msg2}`);
    }
  }
}

/** OCR de una pagina -> lineas con palabras y bbox (misma estructura que ocr_lines en Python). */
export async function ocrLines(
  canvas: HTMLCanvasElement,
): Promise<{ lines: LineaOcr[]; conf: number | null }> {
  return conRecuperacion(async (worker) => {
    const ret = await worker.recognize(
      canvas,
      {},
      { text: true, blocks: true, hocr: false, tsv: false },
    );
    // Fase 3 (migración scanner-core): mapeo compartido con Tamiz (D3) —
    // misma normalización 0-100 → 0-1 y misma regla N-9 (sin confianza
    // reportada → null, nunca un número inventado).
    const data = ret.data as unknown as Parameters<typeof lineasDesdeBlocksTesseract>[0];
    return lineasDesdeBlocksTesseract(data);
  });
}

/** OCR de una sola línea/valor (psm 7 por defecto) sobre un recorte — motor universal v3.
 * opts.whitelist restringe los caracteres reconocidos (ej. dígitos para manuscritos).
 * conf es null cuando Tesseract no reporta confianza (antes se inventaba 0.6). */
export async function ocrTextoUnico(
  canvas: HTMLCanvasElement,
  opts?: { whitelist?: string; psm?: '6' | '7' | '8' | '13' },
): Promise<{ texto: string; conf: number | null }> {
  return conRecuperacion(async (worker) => {
    const { PSM } = await import('tesseract.js');
    try {
      await worker.setParameters({
        tessedit_pageseg_mode: (opts?.psm ?? '7') as Parameters<TesseractWorker['setParameters']>[0]['tessedit_pageseg_mode'],
        tessedit_char_whitelist: opts?.whitelist ?? '',
      });
      const ret = await worker.recognize(canvas, {}, { text: true, blocks: false });
      const texto = (ret.data.text ?? '').trim();
      const conf = (ret.data as unknown as { confidence?: number }).confidence;
      return {
        texto,
        conf: typeof conf === 'number' && conf >= 0 ? conf / 100 : null,
      };
    } finally {
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_COLUMN,
        tessedit_char_whitelist: '',
      });
    }
  });
}

/** Recorta la palabra del ID, la amplifica x4 y la re-OCR-iza con whitelist de digitos. */
export async function relecturaId(
  canvas: HTMLCanvasElement,
  lines: LineaOcr[],
): Promise<string | null> {
  const patronId = /^7\d{14}$|^\d{15}$/;
  let objetivo: { bbox: [number, number, number, number] } | null = null;
  for (const l of lines) {
    for (const w of l.palabras) {
      if (patronId.test(w.texto)) {
        objetivo = { bbox: w.bbox };
        break;
      }
    }
    if (objetivo) break;
  }
  if (!objetivo) return null;

  const [x0, y0, x1, y1] = objetivo.bbox;
  const padx = Math.round((x1 - x0) * 0.08);
  const pady = Math.round((y1 - y0) * 0.35);
  // Clamp (P1 del diagnóstico): el recorte del ID nunca sale de los límites
  // del canvas — cajas fuera de bounds corrompen el pipeline del core.
  const cx0 = Math.max(0, x0 - padx);
  const cy0 = Math.max(0, y0 - pady);
  const cx1 = Math.min(canvas.width, x1 + padx);
  const cy1 = Math.min(canvas.height, y1 + pady);
  if (cx1 <= cx0 || cy1 <= cy0) return null;

  const factor = 4;
  const crop = document.createElement('canvas');
  crop.width = Math.round((cx1 - cx0) * factor);
  crop.height = Math.round((cy1 - cy0) * factor);
  const cctx = crop.getContext('2d', { willReadFrequently: true })!;
  cctx.imageSmoothingEnabled = true;
  cctx.imageSmoothingQuality = 'high';
  cctx.drawImage(canvas, cx0, cy0, cx1 - cx0, cy1 - cy0, 0, 0, crop.width, crop.height);

  const grayCanvas = canvasGrayscale(crop);
  const gctx = grayCanvas.getContext('2d', { willReadFrequently: true })!;
  const gData = gctx.getImageData(0, 0, grayCanvas.width, grayCanvas.height);
  const gray = new Uint8Array(grayCanvas.width * grayCanvas.height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) gray[i] = gData.data[p];
  const thr = otsuThreshold(gray);
  const binCanvas = document.createElement('canvas');
  binCanvas.width = grayCanvas.width;
  binCanvas.height = grayCanvas.height;
  const bctx = binCanvas.getContext('2d', { willReadFrequently: true })!;
  const binImg = bctx.createImageData(binCanvas.width, binCanvas.height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    const v = gray[i] <= thr ? 0 : 255;
    binImg.data[p] = v;
    binImg.data[p + 1] = v;
    binImg.data[p + 2] = v;
    binImg.data[p + 3] = 255;
  }
  bctx.putImageData(binImg, 0, 0);

  return conRecuperacion(async (worker) => {
    const { PSM } = await import('tesseract.js');
    try {
      await worker.setParameters({
        tessedit_pageseg_mode: '7' as Parameters<TesseractWorker['setParameters']>[0]['tessedit_pageseg_mode'],
        tessedit_char_whitelist: '0123456789',
      });
      for (const prep of [binCanvas, grayCanvas]) {
        const ret = await worker.recognize(prep, {}, { text: true, blocks: false, hocr: false, tsv: false });
        const txt = (ret.data.text ?? '').trim().replace(/\s+/g, '');
        if (/^\d{15}$/.test(txt)) return txt;
      }
      return null;
    } finally {
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_COLUMN,
        tessedit_char_whitelist: '',
      });
    }
  });
}
