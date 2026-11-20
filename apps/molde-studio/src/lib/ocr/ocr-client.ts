'use client';

// Cliente Tesseract.js v7 para el navegador: OCR de pagina completa con
// lineas/palabras (equivale a ocr_lines del motor Python) + re-OCR del ID
// amplificado con whitelist de digitos (fuente ocr_relectura).

import type { Worker as TesseractWorker } from 'tesseract.js';
import { canvasGrayscale, otsuThreshold } from '@/lib/molde/imageproc';
import type { LineaOcr, PalabraOcr } from '@/lib/molde/types';

type ProgressCb = (info: { status: string; progress: number }) => void;

let progressCb: ProgressCb | null = null;
let workerPromise: Promise<TesseractWorker> | null = null;

export function setOcrProgress(cb: ProgressCb | null): void {
  progressCb = cb;
}

async function getWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, PSM } = await import('tesseract.js');
      // El motor de referencia usa lang='spa+eng' y psm 4
      const worker = await createWorker('spa+eng', 1, {
        logger: (m: { status: string; progress: number }) => {
          if (progressCb) progressCb(m);
        },
      });
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_COLUMN, // psm 4, igual que el motor de referencia
        preserve_interword_spaces: '1',
      });
      return worker;
    })();
  }
  return workerPromise;
}

/** OCR de una pagina -> lineas con palabras y bbox (misma estructura que ocr_lines en Python). */
export async function ocrLines(
  canvas: HTMLCanvasElement,
): Promise<{ lines: LineaOcr[]; conf: number }> {
  const worker = await getWorker();
  const ret = await worker.recognize(
    canvas,
    {},
    { text: true, blocks: true, hocr: false, tsv: false },
  );
  const data = ret.data as unknown as {
    confidence: number;
    blocks: Array<{
      paragraphs: Array<{
        lines: Array<{
          text: string;
          confidence: number;
          bbox: { x0: number; y0: number; x1: number; y1: number };
          words: Array<{
            text: string;
            confidence: number;
            bbox: { x0: number; y0: number; x1: number; y1: number };
          }>;
        }>;
      }>;
    }> | null;
  };
  const lines: LineaOcr[] = [];
  for (const b of data.blocks ?? []) {
    for (const p of b.paragraphs ?? []) {
      for (const l of p.lines ?? []) {
        const palabras: PalabraOcr[] = (l.words ?? [])
          .map(
            (w): PalabraOcr => ({
              texto: (w.text ?? '').trim(),
              conf: typeof w.confidence === 'number' ? w.confidence : -1,
              bbox: [w.bbox.x0, w.bbox.y0, w.bbox.x1, w.bbox.y1],
            }),
          )
          .filter((w) => w.texto.length > 0);
        if (palabras.length === 0) continue;
        const x0 = Math.min(...palabras.map((w) => w.bbox[0]), l.bbox.x0);
        const y0 = Math.min(...palabras.map((w) => w.bbox[1]), l.bbox.y0);
        const x1 = Math.max(...palabras.map((w) => w.bbox[2]), l.bbox.x1);
        const y1 = Math.max(...palabras.map((w) => w.bbox[3]), l.bbox.y1);
        lines.push({
          texto: palabras.map((w) => w.texto).join(' '),
          bbox: [x0, y0, x1, y1],
          palabras,
        });
      }
    }
  }
  lines.sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
  return { lines, conf: typeof data.confidence === 'number' ? data.confidence / 100 : 0.5 };
}

/** OCR de una sola línea/valor (psm 7 por defecto) sobre un recorte — motor universal v3.
 * opts.whitelist restringe los caracteres reconocidos (ej. dígitos para manuscritos). */
export async function ocrTextoUnico(
  canvas: HTMLCanvasElement,
  opts?: { whitelist?: string; psm?: '6' | '7' | '8' | '13' },
): Promise<{ texto: string; conf: number }> {
  const worker = await getWorker();
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
      conf: typeof conf === 'number' && conf >= 0 ? conf / 100 : 0.6,
    };
  } finally {
    const { PSM } = await import('tesseract.js');
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_COLUMN,
      tessedit_char_whitelist: '',
    });
  }
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

  const worker = await getWorker();
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
    const { PSM } = await import('tesseract.js');
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_COLUMN,
      tessedit_char_whitelist: '',
    });
  }
}
