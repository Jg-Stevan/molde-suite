// OCR del bridge (puerta al motor de Molde Studio, D8 opción B): el texto se
// reconoce con Tesseract.js (spa) — el MISMO motor que usa Molde Studio, así
// el acta se puede verificar luego contra el molde v3. Escalonado = varias
// escalas; Cascada = reintento con realce cuando la primera lectura es débil.

import { logger } from '../../logger';
// FASE 0 (blueprint DLA): el singleton del worker vive ahora en ./ocr-worker
// y lo comparte con el proveedor OCR del motor universal (molde/ocr-proveedor).
import { getWorker } from './ocr-worker';
// Fase 3 (migración scanner-core): el realce p5-p95 vive en el paquete (D2).
import { canvasDesdeDataUrl, estirarContrasteEnCanvas } from '@molde-suite/scanner-core/core/canvas-imagen';

async function ocrDataUrl(dataUrl: string, psm?: string): Promise<{ texto: string; conf: number | null }> {
  try {
    const worker = await getWorker();
    if (psm) {
      await worker.setParameters({ tessedit_pageseg_mode: psm });
    }
    const ret = await worker.recognize(dataUrl);
    const conf = ret.data.confidence;
    return {
      texto: (ret.data.text ?? '').trim(),
      conf: typeof conf === 'number' && conf >= 0 ? conf / 100 : null,
    };
  } catch (e) {
    logger.warn('[ocr] recognize falló', { mensaje: (e as Error).message });
    // Bloque 3b — FALLBACK AUTOMÁTICO: si el motor ganador (Tesseract, ver
    // benchmark /tmp/benchmark-ocr.ts) no inicializa, el SECOND motor
    // (RapidOCR ONNX del fork) toma el turno. null honesto si también cae.
    const fb = await ocrRapidoFallback(dataUrl, psm);
    if (fb) return { texto: fb, conf: null };
    return { texto: '', conf: null };
  }
}

/** Fallback RapidOCR (motor B del benchmark): solo navegador; los modelos
 *  viajan self-hosted (/models/rapidocr, sha256 en PanelModelos). Cualquier
 *  fallo ⇒ null (el pipeline sigue sin OCR — jamás lanza). */
async function ocrRapidoFallback(dataUrl: string, psm?: string): Promise<string | null> {
  void psm; // el rec de RapidOCR no usa psm (bloques DB propios)
  if (typeof window === 'undefined') return null;
  try {
    const motor = await import('@molde-suite/scanner-core/ocr/rapidocr');
    const rt = await motor.asegurarRapidOcr();
    const r = await motor.rapidOcrReconocer(rt, dataUrl);
    return r?.texto || null;
  } catch (e) {
    logger.warn('[ocr] fallback RapidOCR falló (se sigue sin texto)', {
      mensaje: (e as Error).message,
    });
    return null;
  }
}

/** OCR base (RapidOCR en el producto original; aquí Tesseract spa). */
export async function reconocerRapidOcr(dataUrl: string): Promise<string> {
  const r = await ocrDataUrl(dataUrl);
  return r.texto;
}

/** OCR escalonado: página completa y, si sale débil, reintento ampliado. */
export async function reconocerRapidOcrEscalonado(dataUrl: string): Promise<string> {
  const primera = await ocrDataUrl(dataUrl, '4');
  if (primera.texto.length >= 40) return primera.texto;
  const segunda = await ocrDataUrl(dataUrl, '3');
  return segunda.texto.length > primera.texto.length ? segunda.texto : primera.texto;
}

/** OCR en cascada: primera lectura + reintento con realce si salió débil. */
export async function reconocerRapidOcrCascada(dataUrl: string): Promise<string> {
  const primera = await reconocerRapidOcrEscalonado(dataUrl);
  if (primera.length >= 60) return primera;
  // Realce: escala de grises + estiramiento p5-p95 antes del reintento
  // (implementación compartida en scanner-core/core/canvas-imagen — D2).
  const c = await canvasDesdeDataUrl(dataUrl);
  estirarContrasteEnCanvas(c);
  const segunda = await ocrDataUrl(c.toDataURL('image/jpeg', 0.92), '4');
  return segunda.texto.length > primera.length ? segunda.texto : primera;
}

/** OCR de la banda superior (cabecera/título del acta). */
export async function ocrBanda(dataUrl: string): Promise<string> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = Math.max(1, Math.round(img.naturalHeight * 0.16));
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height, 0, 0, c.width, c.height);
  return (await ocrDataUrl(c.toDataURL('image/jpeg', 0.92), '6')).texto;
}

/** OCR de la banda inferior (sello/firmas del acta). */
export async function ocrBandaInferior(dataUrl: string): Promise<string> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const c = document.createElement('canvas');
  const h16 = Math.max(1, Math.round(img.naturalHeight * 0.2));
  c.width = img.naturalWidth;
  c.height = h16;
  c.getContext('2d')!.drawImage(img, 0, img.naturalHeight - h16, c.width, h16, 0, 0, c.width, h16);
  return (await ocrDataUrl(c.toDataURL('image/jpeg', 0.92), '6')).texto;
}
