// Reconocimiento AUTOMÁTICO de plantilla (Fase 6 «cartero en cascada»,
// paso barato de frases clave): OCR de la FRANJA SUPERIOR de la captura y
// comparación contra la huella de cada molde del catálogo empaquetado.
//
// Cascada honesta: UNA lectura de banda (barata), ranking completo y
// UMBRAL de auto-aceptación conservador. Si la confianza no alcanza el
// umbral, NO se adivina: el resultado es null y la UI ofrece la selección
// manual (fallback acordado en las decisiones cerradas).

import type { MoldeUniversal } from '@jg-stevan/scanner-core/molde/universal-types';
import { getWorker } from '@/lib/e14/bridge/ocr-worker';
import { normalizarTexto, puntuarMolde, type CoincidenciaMolde } from './huella';

/** Confianza mínima (ratio de frases de la huella) para seleccionar sola. */
export const UMBRAL_AUTO = 0.5;

/** La franja del encabezado: 24% superior (cubre títulos y «Pág N de M»). */
const FRACCION_BANDA = 0.24;

/**
 * OCR de la franja superior de la captura (banda más alta que ocrBanda del
 * bridge porque los títulos de los moldes genéricos pueden caer bajo el
 * 16% — p. ej. encabezados de dos líneas en E-22/E-26). Mismo patrón:
 * recorte canvas → JPEG 0.92 → Tesseract PSM 6 (bloque uniforme).
 */
async function ocrEncabezado(dataUrl: string): Promise<string> {
  try {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const altoBanda = Math.max(1, Math.round(img.naturalHeight * FRACCION_BANDA));
    // Banda 2x: los títulos de los moldes son chicos (~15px en 850px de
    // ancho) y el grano del scan los difumina — el upscale mejora el
    // acierto del OCR de banda (misma técnica del banco OCR del repo).
    const c = document.createElement('canvas');
    c.width = img.naturalWidth * 2;
    c.height = altoBanda * 2;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, img.naturalWidth, altoBanda, 0, 0, c.width, c.height);
    const worker = await getWorker();
    await worker.setParameters({ tessedit_pageseg_mode: '6' });
    const ret = await worker.recognize(c.toDataURL('image/jpeg', 0.92));
    // Restaura el PSM por defecto del worker compartido (regla de la casa).
    await worker.setParameters({ tessedit_pageseg_mode: '3' });
    return (ret.data.text ?? '').trim();
  } catch {
    // Sin OCR (offline primer arranque, CDN caído) el reconocimiento no
    // adivina: la UI cae a selección manual.
    return '';
  }
}

export interface ResultadoReconocimiento {
  /** Molde seleccionado automáticamente; null = pasó el umbral nadie. */
  molde: MoldeUniversal | null;
  /** Confianza del mejor candidato (0..1). */
  confianza: number;
  /** Ranking completo para la UI de respaldo manual. */
  ranking: CoincidenciaMolde[];
  /** Texto OCR de la banda (para diagnóstico en UI). */
  textoEncabezado: string;
}

/**
 * Identifica la plantilla comparando el encabezado OCR contra la huella de
 * TODOS los candidatos. Devuelve el mejor candidato SOLO si alcanza
 * UMBRAL_AUTO; si no, null con el ranking para la elección manual.
 */
export async function identificarMolde(
  capturaPagina1: string,
  candidatos: MoldeUniversal[],
): Promise<ResultadoReconocimiento> {
  const texto = await ocrEncabezado(capturaPagina1);
  const textoNormalizado = normalizarTexto(texto);
  const ranking = candidatos
    .map((m) => puntuarMolde(m, textoNormalizado))
    .sort((a, b) => b.score - a.score);
  const mejor = ranking[0];
  const moldeMejor = candidatos.find((m) => m.nombre === mejor?.nombre) ?? null;
  const confianza = mejor?.score ?? 0;
  const aceptado = confianza >= UMBRAL_AUTO && textoNormalizado.length > 0;
  return {
    molde: aceptado ? moldeMejor : null,
    confianza,
    ranking,
    textoEncabezado: texto,
  };
}
