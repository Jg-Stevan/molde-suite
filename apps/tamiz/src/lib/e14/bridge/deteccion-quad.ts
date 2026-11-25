// Detección del quad de la FOTO capturada con el detector REAL (worker
// OpenCV, `detector-client`) — la MISMA vía que pinta las marcas en vivo.
// Orden: OpenCV → heurística Sobel (worker no listo/muerto) → identidad
// (degradación honesta dentro de `detectDocumentEdgesDetail`).
//
// Cordura «ya es la página»: en escaneos a sangre (sin fondo visible) el
// worker no encuentra contorno y el Sobel del core engancha una caja INTERNA
// — caso real pag-01: 1700×2200 → recorte 575×892 y el OCR pierde el
// documento. Si el perímetro de la foto ya es papel, se devuelve identidad
// sin recortar lo que ya es la página.

import { getScannerWorker } from '@molde-suite/scanner-core/core/detector-client';
import { detectDocumentEdgesDetail } from '@molde-suite/scanner-core/core/image-processor';
import type { OrigenQuad } from '@molde-suite/scanner-core/core/image-processor';
import { defaultQuad, type Quad } from '@molde-suite/scanner-core/core/types';

/** Tope por etapa: un worker colgado no puede frenar el escaneo (la
 *  heurística local es el respaldo y siempre responde). El arranque en frío
 *  del worker en móvil se midió en 2.7–6.7 s (A56) — con el tope viejo de 3 s
 *  la detección caía al Sobel/identidad y la «procesada» era el fotograma. */
const ESPERA_WORKER_MS = 8000;
const DETECCION_TIMEOUT_MS = 3000;

/** Área mínima del quad del worker para creerle (fracción del fotograma). */
const AREA_MINIMA = 0.05;
/** Perímetro considerado papel: luminancia mínima y fracción del anillo. */
const LUZ_PAPEL = 190;
const FRACCION_PAPEL = 0.97;

function conTimeout<T>(p: Promise<T>, valor: T, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => window.setTimeout(() => resolve(valor), ms)),
  ]);
}

function areaDeQuad(q: Quad): number {
  const [tl, tr, br, bl] = q;
  const tri = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) =>
    Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
  return tri(tl!, tr!, br!) + tri(tl!, br!, bl!);
}

/** true cuando el anillo exterior de la foto es casi todo papel: la imagen
 *  ya es la página (escaneo a sangre) y no hay fondo que recortar. */
function perimetroEsPapel(img: HTMLImageElement): boolean {
  const W = 96;
  const H = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * W));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(img, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  const banda = Math.max(1, Math.round(Math.min(W, H) * 0.02));
  let total = 0;
  let papel = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!(x < banda || y < banda || x >= W - banda || y >= H - banda)) continue;
      const i = (y * W + x) * 4;
      const lum = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
      total++;
      if (lum >= LUZ_PAPEL) papel++;
    }
  }
  return total > 0 && papel / total >= FRACCION_PAPEL;
}

export async function detectarQuadDeFoto(
  foto: string,
): Promise<{ quad: Quad; origen: OrigenQuad }> {
  let img: HTMLImageElement | null = null;
  try {
    img = new Image();
    img.src = foto;
    await img.decode();
    if (perimetroEsPapel(img)) return { quad: defaultQuad(), origen: 'identidad' };
  } catch {
    /* decode inválido → el detector/Sobel deciden (o lanza HEIC aguas abajo) */
  }
  try {
    const worker = getScannerWorker();
    if (worker && (await conTimeout(worker.waitReady(), false, ESPERA_WORKER_MS))) {
      if (!img) {
        img = new Image();
        img.src = foto;
        await img.decode();
      }
      const out = await conTimeout(
        worker.detect(img, img.naturalWidth, img.naturalHeight),
        null,
        DETECCION_TIMEOUT_MS,
      );
      const f = out?.corners;
      if (f && f.length === 8 && Array.from(f).every((v) => Number.isFinite(v))) {
        const punto = (i: number): { x: number; y: number } => ({
          x: Math.min(1, Math.max(0, f[2 * i]!)),
          y: Math.min(1, Math.max(0, f[2 * i + 1]!)),
        });
        const quad: Quad = [punto(0), punto(1), punto(2), punto(3)];
        if (areaDeQuad(quad) >= AREA_MINIMA) return { quad, origen: 'detector' };
      }
    }
  } catch {
    /* worker roto → heurística del core */
  }
  return detectDocumentEdgesDetail(foto);
}
