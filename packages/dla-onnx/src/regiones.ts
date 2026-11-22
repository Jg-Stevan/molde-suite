// FASE B3 (blueprint DLA): regiones de LAYOUT con PP-DocLayout (variante S
// cuantizada). Los consumidores: bandas OCR dinámicas (reemplazan las bandas
// fijas 16%/20% del pipeline de Tamiz), auto-proposición de zonas en el
// editor y candidatos de ancla visual (insumo de la Fase 7 ORB/SIFT del plan).

import { crearDetector, configuracionLista } from './runtime';
import { PRESETS, type Deteccion } from './tipos';

/** Detector de regiones de layout (null = sin modelo configurado). */
export async function crearDetectorLayout(): Promise<{
  detectar: (canvas: HTMLCanvasElement, confMin?: number) => Promise<Deteccion[]>;
} | null> {
  if (!configuracionLista('layout')) return null;
  const d = await crearDetector('layout');
  return { detectar: (canvas, confMin) => d.detectar(canvas, confMin ?? PRESETS.layout.confMin) };
}

/**
 * Bandas OCR dinámicas a partir de regiones: sustituye los porcentajes fijos
 * (16% superior / 20% inferior) del pipeline cuando el detector está activo.
 * Devuelve los límites NORMALIZADOS de la banda superior (cabecera) e inferior
 * (pie/sello) o null si no hay regiones de confianza para esa banda.
 */
export function bandasDesdeRegiones(
  regiones: Deteccion[],
): { sup: { y0: number; y1: number } | null; inf: { y0: number; y1: number } | null } {
  const clasesSup = new Set(['header', 'cabecera', 'title', 'titulo', 'text']);
  const clasesInf = new Set(['footer', 'pie', 'text']);
  let sup: { y0: number; y1: number } | null = null;
  let inf: { y0: number; y1: number } | null = null;
  for (const r of regiones) {
    const cls = r.clase.toLowerCase();
    const { y, h } = r.caja;
    if (clasesSup.has(cls) && y < 0.45) {
      const fin = y + h;
      if (!sup || y < sup.y0) sup = { y0: Math.max(0, y), y1: Math.min(1, fin) };
    }
    if (clasesInf.has(cls) && y > 0.55) {
      const fin = y + h;
      if (!inf || fin > inf.y1) inf = { y0: Math.max(0, y), y1: Math.min(1, fin) };
    }
  }
  return { sup, inf };
}
