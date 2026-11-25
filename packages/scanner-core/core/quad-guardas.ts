// Guardas anti-degenerados del QUAD (plan §B rotada-12 — causa raíz del visor
// en «SE MUESTRA LA FOTO ORIGINAL»): un quad con coordenadas NO finitas
// (NaN/±Inf — detector caído, molde JSON corrupto, Math sobre datos ausentes)
// envenena TODO el camino de processImage y de su gemelo worker:
//   · ruta crop → Math.min/max(NaN) → canvas width NaN → 0×0 → drawImage
//     no-op SILONCISO → toDataURL devuelve "data:," (foto vacía que viaja
//     como fotoProcesada);
//   · ruta warp → hypot(NaN)=NaN → Math.max(200, Math.min(4032, NaN))=NaN →
//     warpPerspectiva recibe ancho NaN (canvas 0×0 / createImageData lanza).
// Ambos gemelos (image-processor.ts y workers/fallback-canvas.ts) sanitizan
// con ESTAS funciones puras — misma matemática, mismo commit (doctrina del
// repo). Sin DOM, sin dependencias: importables desde el worker IIFE y desde
// tests bun.
//
// PROHIBIDO cambiar aquí la matemática del warp que ya funciona (homografía
// real): solo blindaje de degenerados y errores.

import { defaultQuad, type Quad } from './types';

/**
 * Saniza un quad normalizado: si CUALQUIER coordenada no es finita devuelve
 * el quad identidad (la foto entera es el documento — degradación honesta,
 * mismo convenio del catch de detección del pipeline). Quad sano → intacto.
 */
export function sanearQuad(quad: Quad): { quad: Quad; saneado: boolean } {
  const finito = quad.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (finito) return { quad, saneado: false };
  return { quad: defaultQuad(), saneado: true };
}

/**
 * Gemelo PLANO (worker): el quad viaja aplanado [x0,y0, x1,y1, x2,y2, x3,y3]
 * por postMessage. Misma decisión que `sanearQuad` sobre la forma del mensaje.
 */
export function sanearQuadPlano(plano: number[]): { plano: number[]; saneado: boolean } {
  const finito =
    plano.length >= 8 &&
    plano.every((v) => Number.isFinite(v));
  if (finito) return { plano, saneado: false };
  return {
    plano: [0, 0, 1, 0, 1, 1, 0, 1],
    saneado: true,
  };
}

/**
 * Ancho de salida del warp (fórmula histórica de image-processor.ts: media de
 * los lados TL→TR y BL→BR en px) con guarda anti-degenerados: componentes no
 * finitos cuentan 0 y el resultado queda clampeado a [1, maxLongSide] — jamás
 * 0 ni NaN llega a warpPerspectiva. El ancho sano se devuelve EXACTO (paridad
 * byte-fiel con el cálculo que ya funciona; la banda 200..4032 del llamador
 * queda intacta).
 */
export function anchoSalidaDeQuad(
  quad: Quad,
  w: number,
  h: number,
  maxLongSide: number,
): number {
  const lado = (a: Quad[number], b: Quad[number]): number =>
    Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(b.x) && Number.isFinite(b.y)
      ? Math.hypot((b.x - a.x) * w, (b.y - a.y) * h)
      : 0;
  const anchoDoc = (lado(quad[0], quad[1]) + lado(quad[3], quad[2])) / 2;
  return Math.max(1, Math.min(maxLongSide, anchoDoc));
}
