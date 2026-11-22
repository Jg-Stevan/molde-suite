// FASE 0 (blueprint DLA): proveedor OCR de TAMIZ para el motor universal
// compartido (packages/scanner-core/molde). Reutiliza el MISMO worker
// Tesseract spa del puente (bridge/ocr-worker.ts) en lugar de crear otro:
// un solo worker caliente por app, mismo patrón getWorker/lazy.
//
// El motor necesita ocrLines (líneas con palabras y bboxes — para anclas y
// editor) y ocrTextoUnico (lectura de recortes de campo con psm/whitelist).
// El mapeo de blocks replica el de Molde Studio (ocr-client.ts): misma
// normalización de confianza 0-100 → 0-1 y misma regla N-9 (sin confianza
// reportada → null, nunca un número inventado).

import type { LineaOcr, PalabraOcr, ProveedorOcr } from '@jg-stevan/scanner-core/molde/ocr-tipos';
import { getWorker } from '../bridge/ocr-worker';

/** OCR de página completa con líneas/palabras y bboxes (px del canvas). */
export async function ocrLines(canvas: HTMLCanvasElement): Promise<{
  lines: LineaOcr[];
  conf: number | null;
}> {
  const worker = await getWorker();
  const ret = await worker.recognize(canvas, {}, { text: true, blocks: true, hocr: false, tsv: false });
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
              conf: typeof w.confidence === 'number' ? w.confidence / 100 : -1,
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
  return {
    lines,
    conf: typeof data.confidence === 'number' && data.confidence >= 0 ? data.confidence / 100 : null,
  };
}

/** OCR de una línea única (recorte de campo) con psm/whitelist opcionales. */
export async function ocrTextoUnico(
  canvas: HTMLCanvasElement,
  opts?: { whitelist?: string; psm?: '6' | '7' | '8' | '13' },
): Promise<{ texto: string; conf: number | null }> {
  const worker = await getWorker();
  if (opts?.psm || opts?.whitelist !== undefined) {
    await worker.setParameters({
      tessedit_pageseg_mode: opts?.psm ?? '7',
      tessedit_char_whitelist: opts?.whitelist ?? '',
    });
  }
  const ret = await worker.recognize(canvas, {}, { text: true, blocks: false });
  const conf = (ret.data as unknown as { confidence?: number }).confidence;
  return {
    texto: (ret.data.text ?? '').trim(),
    conf: typeof conf === 'number' && conf >= 0 ? conf / 100 : null,
  };
}

/** El proveedor completo que la app host registra en scanner-core. */
export const proveedorOcrTamiz: ProveedorOcr = { ocrLines, ocrTextoUnico };
