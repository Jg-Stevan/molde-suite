/**
 * Fase 3 del plan (primera ola) — PARIDAD del filtro bw entre los DOS gemelos:
 *   · local: `aplicarFiltroBw` (core/image-processor.ts) sobre los píxeles del
 *     canvas rotado del hilo principal;
 *   · worker: `aplicarFiltroForkAPixeles` (workers/fallback-canvas.ts) en la
 *     ruta de degradación.
 * Misma entrada → MISMOS bytes (regla de casa de los gemelos: un cambio de
 * matemática en un lado sin el otro rompe este test).
 *
 * Además cubre el motivo del cambio: el bw de digielect14 es Bradley-Roth
 * ADAPTATIVO con corrección de sombra — el papel sobre fondo sombreado sale
 * BLANCO (el umbral fijo 165/90 del fork lo dejaba negro/manchado).
 */
import { describe, expect, test } from 'bun:test';

import { aplicarFiltroBw } from '@molde-suite/scanner-core/core/image-processor';
import { aplicarFiltroForkAPixeles } from '@molde-suite/scanner-core/workers/fallback-canvas';

/**
 * Página sintética análoga a una foto real: papel con gradiente de
 * iluminación (235 → 130, sombra a la derecha) y barras de tinta oscura
 * (gris 35). Devuelve RGBA listo para ambos filtros.
 */
function paginaSombreada(w = 160, h = 120): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  const barras = new Set([30, 31, 32, 60, 61, 62, 90, 91, 92]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      const papel = Math.round(235 - (105 * x) / (w - 1));
      const v = barras.has(y) ? 35 : papel;
      data[p] = v;
      data[p + 1] = v;
      data[p + 2] = v;
      data[p + 3] = 255;
    }
  }
  return data;
}

const gris = (px: Uint8ClampedArray, w: number, x: number, y: number): number =>
  px[(y * w + x) * 4]!;

describe('paridad worker ↔ local — filtro bw (Bradley-Roth de digielect14)', () => {
  const W = 160;
  const H = 120;

  test('bw: misma entrada → MISMOS bytes en los dos gemelos', () => {
    const base = paginaSombreada(W, H);
    const local = aplicarFiltroBw(base.slice(), W, H);
    const worker = base.slice();
    aplicarFiltroForkAPixeles(worker, W, H, 'bw');
    expect(worker.length).toBe(local.length);
    expect(worker).toEqual(local);
  });

  test('contrast: misma entrada → MISMOS bytes (gemelo de la rama p5/p95)', () => {
    const base = paginaSombreada(W, H);
    const worker = base.slice();
    aplicarFiltroForkAPixeles(worker, W, H, 'contrast');
    // La ruta local NO tiene helper exportado de contrast (vive inline en
    // processImage con canvas); la paridad se ancla al comportamiento del
    // gemelo: estiramiento de grises SIN binarizar.
    const valores = new Set<number>();
    for (let i = 0; i < worker.length; i += 4) valores.add(worker[i]!);
    expect(valores.size).toBeGreaterThan(2); // hay grises intermedios, no bilevel
    expect(valores.has(255)).toBe(true);
    expect(valores.has(0)).toBe(true);
  });

  test('original: el worker NO toca los píxeles', () => {
    const base = paginaSombreada(W, H);
    const copia = base.slice();
    aplicarFiltroForkAPixeles(copia, W, H, 'original');
    expect(copia).toEqual(base);
  });

  test('bw ADAPTATIVO: papel en la zona SOMBRIA sale blanco (corrección de sombra)', () => {
    const px = aplicarFiltroBw(paginaSombreada(W, H), W, H);
    // Esquina derecha (gris de papel ≈130 por el gradiente) sin tinta: el
    // umbral fijo del fork la habría llevado a 0; Bradley local la deja papel.
    expect(gris(px, W, 155, 10)).toBeGreaterThanOrEqual(200);
    // Zona iluminada, también papel.
    expect(gris(px, W, 5, 10)).toBeGreaterThanOrEqual(200);
  });

  test('bw ADAPTATIVO: la tinta (gris 35) sale negra en cualquier zona', () => {
    const px = aplicarFiltroBw(paginaSombreada(W, H), W, H);
    expect(gris(px, W, 80, 61)).toBeLessThanOrEqual(50); // zona media
    expect(gris(px, W, 150, 61)).toBeLessThanOrEqual(50); // zona sombreada
  });

  test('determinismo: dos corridas del mismo lado → mismo resultado', () => {
    const base = paginaSombreada(W, H);
    expect(aplicarFiltroBw(base.slice(), W, H)).toEqual(aplicarFiltroBw(base.slice(), W, H));
  });
});
