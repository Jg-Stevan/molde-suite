// Calidad fotográfica del acta (escala del mantenedor, score 0..10):
// nitidez (varianza del Laplaciano), brillo, contraste y detección de
// esquinas cortadas. Todo sobre canvas — sin dependencias.

import type { PageQuality } from '@jg-stevan/scanner-core/core/types';

async function dataUrlAGris(dataUrl: string): Promise<{ g: Float32Array; w: number; h: number }> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const W = Math.min(400, img.naturalWidth);
  const H = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * W));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  const g = new Float32Array(W * H);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    g[i] = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
  }
  return { g, w: W, h: H };
}

/** Métricas de calidad del acta procesada. */
export async function calidadDeActa(fotoProcesada: string): Promise<PageQuality> {
  const { g, w, h } = await dataUrlAGris(fotoProcesada);
  let suma = 0;
  for (let i = 0; i < g.length; i++) suma += g[i];
  const brillo = suma / g.length;
  let varianza = 0;
  for (let i = 0; i < g.length; i++) varianza += (g[i] - brillo) ** 2;
  const contraste = Math.sqrt(varianza / g.length);
  // Varianza del Laplaciano 4-vecinos.
  let lap = 0;
  let lap2 = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
      lap += l;
      lap2 += l * l;
      n++;
    }
  }
  const mediaL = lap / n;
  const sharpness = lap2 / n - mediaL * mediaL;
  return { sharpness, brightness: brillo, contrast: contraste };
}

/** Contraste efectivo (normalizado 0..1 desde la desviación de gris). */
export function contrasteEfectivoDe(q: PageQuality): number {
  return Math.min(1, q.contrast / 70);
}

/**
 * Score del mantenedor (0..10) desde las métricas: nitidez domina, el brillo
 * penaliza fuera de zona, el contraste acota el techo.
 */
export function scoreDeCalidad(q: PageQuality): number {
  const nitidez = Math.min(1, q.sharpness / 900);
  const brillo = 1 - Math.min(1, Math.abs(q.brightness - 190) / 140);
  const contraste = contrasteEfectivoDe(q);
  const bruto = 10 * (0.55 * nitidez + 0.25 * contraste + 0.2 * brillo);
  return Math.round(Math.min(10, Math.max(0, bruto)) * 10) / 10;
}

/**
 * Esquinas del acta (sospecha de recorte): sin detección de perspectivas
 * completas, verifica tinta impresa tocando el filo del recorte (tabla §2:
 * la geometría sola NO condena — es SOSPECHA).
 */
export async function esquinasDeActa(fotoProcesada: string): Promise<{
  completa: boolean;
  ladoEsquina: string | null;
}> {
  const { g, w, h } = await dataUrlAGris(fotoProcesada);
  const umbral = 110;
  const fraccionTinta = (x0: number, y0: number, x1: number, y1: number): number => {
    let oscuros = 0;
    let totalPx = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        totalPx++;
        if (g[y * w + x] < umbral) oscuros++;
      }
    }
    return totalPx ? oscuros / totalPx : 0;
  };
  const m = 6; // margen: borde físico del recorte
  const lado = (nombre: string, x0: number, y0: number, x1: number, y1: number): string | null =>
    fraccionTinta(x0, y0, x1, y1) > 0.22 ? nombre : null;
  const lados = [
    lado('sup-izq', m, m, Math.floor(w * 0.3), Math.floor(h * 0.06)),
    lado('sup-der', Math.floor(w * 0.7), m, w - m, Math.floor(h * 0.06)),
    lado('inf-izq', m, Math.floor(h * 0.94), Math.floor(w * 0.3), h - m),
    lado('inf-der', Math.floor(w * 0.7), Math.floor(h * 0.94), w - m, h - m),
  ];
  const cortada = lados.find((l) => l !== null) ?? null;
  return { completa: cortada === null, ladoEsquina: cortada };
}
