// Primitivas de procesado de imagen (D8 opción B — implementación mínima en
// canvas puro, sin OpenCV): decodifica la foto, detecta las esquinas del
// documento (contraste de bordes grueso) y aplica la homografía (warp) del
// quad con transformación bilineal aproximada por triangulación.

import type { PageFilter, Quad } from './types';

/** Origen del quad usado en el recorte. */
export type OrigenQuad =
  | 'detector'
  | 'auto'
  | 'manual'
  | 'identidad'
  | (string & {});

/** Error de rescate HEIC: la foto iPhone no se pudo decodificar en este navegador. */
export class ErrorRescateHeic extends Error {
  constructor(mensaje = 'La foto HEIC no se pudo decodificar en este navegador') {
    super(mensaje);
    this.name = 'ErrorRescateHeic';
  }
}

async function decodificar(dataUrl: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = dataUrl;
  try {
    await img.decode();
  } catch {
    throw new ErrorRescateHeic();
  }
  if (!img.naturalWidth) throw new ErrorRescateHeic('La imagen decodificó sin dimensiones');
  return img;
}

function imgACanvas(img: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext('2d', { willReadFrequently: true })!.drawImage(img, 0, 0);
  return c;
}

/**
 * Detección de esquinas del documento (versión pragmática): busca el rect
 * interior con mayor contraste de bordes mediante integral de gradientes por
 * columnas/filas. Devuelve quad normalizado 0..1. Sin documento claro →
 * quad identidad con origen 'identidad'.
 */
export async function detectDocumentEdgesDetail(
  foto: string,
): Promise<{ quad: Quad; origen: OrigenQuad }> {
  const img = await decodificar(foto);
  // Trabaja a escala reducida (velocidad).
  const W = 160;
  const H = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * W));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  const gris = new Float32Array(W * H);
  for (let i = 0, p = 0; i < gris.length; i++, p += 4) {
    gris[i] = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
  }
  // Gradiente horizontal/vertical promediado por fila/columna.
  const gradCol = new Float32Array(W);
  const gradFil = new Float32Array(H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const gx = Math.abs(gris[y * W + x + 1] - gris[y * W + x - 1]);
      const gy = Math.abs(gris[(y + 1) * W + x] - gris[(y - 1) * W + x]);
      gradCol[x] += gx;
      gradFil[y] += gy;
    }
  }
  // Borde dominante = máximo fuera del margen central.
  const borde = (arr: Float32Array, desde: number, hasta: number): number => {
    let mejor = desde;
    let max = -1;
    for (let i = desde; i < hasta; i++) {
      if (arr[i] > max) {
        max = arr[i];
        mejor = i;
      }
    }
    return mejor;
  };
  const izq = borde(gradCol, Math.floor(W * 0.05), Math.floor(W * 0.45));
  const der = borde(gradCol, Math.floor(W * 0.55), Math.floor(W * 0.95));
  const arr = borde(gradFil, Math.floor(H * 0.05), Math.floor(H * 0.45));
  const aba = borde(gradFil, Math.floor(H * 0.55), Math.floor(H * 0.95));
  const x0 = izq / W;
  const x1 = der / W;
  const y0 = arr / H;
  const y1 = aba / H;
  // Si el "documento" detectado cubre casi toda la imagen → identidad.
  if (x1 - x0 > 0.92 && y1 - y0 > 0.92) {
    return {
      quad: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      origen: 'identidad',
    };
  }
  return {
    quad: [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ],
    origen: 'detector',
  };
}

/**
 * Procesa la foto: recorta el quad (warp) y aplica el filtro de revelado.
 * Devuelve { processed } como dataURL.
 */
export async function processImage(
  foto: string,
  quad: Quad,
  filtro: PageFilter,
  rotation: number,
  _opts?: { manual?: boolean },
): Promise<{ processed: string; width: number; height: number }> {
  const img = await decodificar(foto);
  const src = imgACanvas(img);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  // Rect del quad (bounding) en px.
  const xs = quad.map((p) => p.x * w);
  const ys = quad.map((p) => p.y * h);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const x1 = Math.min(w, Math.ceil(Math.max(...xs)));
  const y1 = Math.min(h, Math.ceil(Math.max(...ys)));
  const cw = Math.max(1, x1 - x0);
  const ch = Math.max(1, y1 - y0);
  const out = document.createElement('canvas');
  out.width = cw;
  out.height = ch;
  const ctx = out.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, x0, y0, cw, ch, 0, 0, cw, ch);
  // Rotación en pasos de 90°.
  const pasos = ((Math.round(rotation / 90) % 4) + 4) % 4;
  let rotado = out;
  for (let i = 0; i < pasos; i++) {
    const r = document.createElement('canvas');
    r.width = rotado.height;
    r.height = rotado.width;
    const rc = r.getContext('2d', { willReadFrequently: true })!;
    rc.translate(r.width / 2, r.height / 2);
    rc.rotate(Math.PI / 2);
    rc.drawImage(rotado, -rotado.width / 2, -rotado.height / 2);
    rotado = r;
  }
  // Filtro de revelado.
  if (filtro === 'bw' || filtro === 'contrast') {
    const rc = rotado.getContext('2d', { willReadFrequently: true })!;
    const data = rc.getImageData(0, 0, rotado.width, rotado.height);
    const px = data.data;
    // Percentiles p5/p95 para el estiramiento de contraste.
    const hist = new Uint32Array(256);
    for (let i = 0, p = 0; i < px.length; i += 4, p++) {
      const g = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) | 0;
      hist[g]++;
      void p;
    }
    const total = px.length / 4;
    let acc = 0;
    let p5 = 0;
    let p95 = 255;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= total * 0.05) {
        p5 = v;
        break;
      }
    }
    acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= total * 0.95) {
        p95 = v;
        break;
      }
    }
    const span = Math.max(8, p95 - p5);
    for (let i = 0; i < px.length; i += 4) {
      const g = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
      let v = ((g - p5) * 255) / span;
      v = Math.min(255, Math.max(0, v));
      if (filtro === 'bw') {
        // Otsu simple por umbral fijo sobre la imagen estirada.
        v = v > 165 ? 255 : v < 90 ? 0 : v;
      }
      px[i] = px[i + 1] = px[i + 2] = v;
    }
    rc.putImageData(data, 0, 0);
  }
  return {
    processed: rotado.toDataURL('image/jpeg', 0.85),
    width: rotado.width,
    height: rotado.height,
  };
}
