// FASE 0 (blueprint DLA): proveedor OCR de TAMIZ para el motor universal
// compartido (packages/scanner-core/molde). Reutiliza el MISMO worker
// Tesseract spa del puente (bridge/ocr-worker.ts) en lugar de crear otro:
// un solo worker caliente por app, mismo patrón getWorker/lazy.
//
// El motor necesita ocrLines (líneas con palabras y bboxes — para anclas y
// editor) y ocrTextoUnico (lectura de recortes de campo con psm/whitelist).
// Fase 3 (migración): el MAPEO de blocks → LineaOcr vive en scanner-core
// (molde/ocr-mapeo) y es compartido con Molde Studio (D3) — misma
// normalización de confianza y misma regla N-9.

import type { LineaOcr, ProveedorOcr } from '@molde-suite/scanner-core/molde/ocr-tipos';
import { lineasDesdeBlocksTesseract } from '@molde-suite/scanner-core/molde/ocr-mapeo';
import { getWorker } from '../bridge/ocr-worker';

/** OCR de página completa con líneas/palabras y bboxes (px del canvas). */
export async function ocrLines(canvas: HTMLCanvasElement): Promise<{
  lines: LineaOcr[];
  conf: number | null;
}> {
  const worker = await getWorker();
  const ret = await worker.recognize(canvas, {}, { text: true, blocks: true, hocr: false, tsv: false });
  const data = ret.data as unknown as Parameters<typeof lineasDesdeBlocksTesseract>[0];
  return lineasDesdeBlocksTesseract(data);
}

/** OCR de una línea única (recorte de campo) con psm/whitelist opcionales. */
export async function ocrTextoUnico(
  canvas: HTMLCanvasElement,
  opts?: { whitelist?: string; psm?: '6' | '7' | '8' | '13' },
): Promise<{ texto: string; conf: number | null }> {
  const worker = await getWorker();
  // BUG CORREGIDO (worker compartido): el PSM/whitelist fijado para el recorte
  // quedaba vigente para toda la sesión — el OCR de PÁGINA COMPLETA de la
  // PÁGINA SIGUIENTE del motor universal corría en modo "una línea" (psm 7)
  // y todas sus anclas fallaban (también afectaba moldes multipágina E-14).
  // tesseract.js v7 no expone getParameters, así que la restauración es
  // explícita al estado que el OCR de página completa espera: PSM AUTO ('3',
  // el default de createWorker) sin whitelist — el mismo valor que asumen
  // ocrLines (aquí) y el OCR de bandas de E-14 (lib/e14/ocr/tesseract.ts).
  const cambio = Boolean(opts?.psm || opts?.whitelist !== undefined);
  if (cambio) {
    await worker.setParameters({
      tessedit_pageseg_mode: opts?.psm ?? '7',
      tessedit_char_whitelist: opts?.whitelist ?? '',
    });
  }
  const ret = await worker.recognize(canvas, {}, { text: true, blocks: false });
  if (cambio) {
    await worker.setParameters({
      tessedit_pageseg_mode: '3',
      tessedit_char_whitelist: '',
    });
  }
  const conf = (ret.data as unknown as { confidence?: number }).confidence;
  return {
    texto: (ret.data.text ?? '').trim(),
    conf: typeof conf === 'number' && conf >= 0 ? conf / 100 : null,
  };
}

/** El proveedor completo que la app host registra en scanner-core. */
export const proveedorOcrTamiz: ProveedorOcr = { ocrLines, ocrTextoUnico };
