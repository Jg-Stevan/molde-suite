// Mapeo de la respuesta de Tesseract.js v7 → LineaOcr[] — Fase 3 (migración).
//
// ABSORBE el mapeo duplicado (D3 del Plan de Reconciliación) que estaba
// espejado en apps/tamiz (molde/ocr-proveedor.ts) y apps/molde-studio
// (lib/ocr/ocr-client.ts), byte a byte:
//  · confianza de palabra 0-100 → 0-1;
//  · palabras vacías fuera;
//  · bbox de línea = min/max entre línea y palabras;
//  · líneas ordenadas por y, luego x;
//  · regla N-9: sin confianza de página → null (nunca un número inventado).
//
// Cada app conserva su PROPIEDAD del worker (Studio: worker auto-hospedado
// con probe SIMD + retry; Tamiz: worker compartido del puente) y solo delega
// la NORMALIZACIÓN aquí.

import type { LineaOcr, PalabraOcr } from './ocr-tipos';
import type { RapidOcrLinea } from '../ocr/rapidocr';

export interface RespuestaBlocksTesseract {
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
}

/** Normaliza la respuesta con blocks de Tesseract v7 a líneas/palabras del motor. */
export function lineasDesdeBlocksTesseract(data: RespuestaBlocksTesseract): {
  lines: LineaOcr[];
  conf: number | null;
} {
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
  // N-9: sin confianza reportada → null (antes 0.5 inventado). El motor trata
  // «sin señal» como conf_baja, no como un 50%.
  return {
    lines,
    conf: typeof data.confidence === 'number' && data.confidence >= 0 ? data.confidence / 100 : null,
  };
}

/** F2 — Normaliza líneas de RapidOCR a LineaOcr[] del motor universal.
 *  Rapid no da palabras: `palabras: []` (los rescates por campo usan
 *  ocrTextoUnico Tesseract, que ya existe). bbox = min/max de los puntos
 *  del polígono `box`, escalado por `factorEscala` (anchoDestino/anchoOriginal).
 *  conf de página = media de conf de líneas (null si vacío). */
export function lineasDesdeRapid(
  rapidLineas: RapidOcrLinea[],
  factorEscala: number,
): { lines: LineaOcr[]; conf: number | null } {
  const lines: LineaOcr[] = [];
  for (const l of rapidLineas) {
    const texto = (l.texto ?? '').trim();
    if (!texto || !l.box || l.box.length === 0) continue;
    const xs = l.box.map((p) => p.x);
    const ys = l.box.map((p) => p.y);
    const x0 = Math.min(...xs) * factorEscala;
    const y0 = Math.min(...ys) * factorEscala;
    const x1 = Math.max(...xs) * factorEscala;
    const y1 = Math.max(...ys) * factorEscala;
    lines.push({ texto, bbox: [x0, y0, x1, y1], palabras: [] });
  }
  lines.sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
  const confs = rapidLineas.filter(
    (l) => (l.texto ?? '').trim().length > 0 && l.box && l.box.length > 0 && typeof l.conf === 'number' && l.conf >= 0,
  );
  const conf = confs.length > 0 ? confs.reduce((s, l) => s + l.conf, 0) / confs.length : null;
  return { lines, conf };
}
