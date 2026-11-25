// Primitivas de procesado de imagen (D8 opción B — implementación mínima en
// canvas puro, sin OpenCV): decodifica la foto, detecta las esquinas del
// documento (contraste de bordes grueso) y aplica la homografía (warp) del
// quad con transformación bilineal aproximada por triangulación.

import type { PageFilter, Quad } from './types';
// R-46 — prefijo público de assets por INYECCIÓN lazy (dominio/entorno del fork).
import { publicBaseEfectivo } from '../dominio/entorno';

/** Tope técnico ÚNICO del lado mayor procesado (fix v3 upstream): 4032 px —
 *  4032×3024 ≈ 12.2 MP, lejos del límite de canvas de iOS (~16.7 MP). */
export const PROCESSED_MAX_LONG_SIDE = 4032;

/** Decode de un data URL a <img> (decode-once del paquete — upstream L99-106). */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("No se pudo cargar la imagen"));
    img.src = src;
  });
}

/** Dims de un JPEG leídas del CONTENEDOR (≤256 KB, sin decodificar) con la
 *  orientación EXIF ya resuelta (swap 5-8). null = no-JPEG o header ilegible.
 *  Port byte-fiel de upstream image-processor.ts:116-159 (KIT velocidad-5s). */
export async function jpegDimensionsFromBlob(blob: Blob): Promise<{ w: number; h: number } | null> {
  try {
    const head = new Uint8Array(await blob.slice(0, 262144).arrayBuffer());
    if (head[0] !== 0xff || head[1] !== 0xd8) return null;
    let orientation = 1;
    let i = 2;
    while (i + 9 < head.length) {
      if (head[i] !== 0xff) { i += 1; continue; }
      const marker = head[i + 1];
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
      const len = (head[i + 2] << 8) | head[i + 3];
      if (marker === 0xe1 && len >= 8) {
        const isExif = head[i + 4] === 0x45 && head[i + 5] === 0x78 && head[i + 6] === 0x69 && head[i + 7] === 0x66;
        if (isExif) {
          if (i + 18 > head.length || i + 2 + len > head.length) return null;
          const tiff = i + 10;
          const be = head[tiff] === 0x4d && head[tiff + 1] === 0x4d;
          const u16 = (o: number) => (be ? (head[o] << 8) | head[o + 1] : head[o] | (head[o + 1] << 8));
          const ifd0 = be
            ? (((head[tiff + 4] << 24) | (head[tiff + 5] << 16) | (head[tiff + 6] << 8) | head[tiff + 7]) >>> 0)
            : (((head[tiff + 7] << 24) | (head[tiff + 6] << 16) | (head[tiff + 5] << 8) | head[tiff + 4]) >>> 0);
          const ifd = tiff + ifd0;
          for (let n = u16(ifd), e = 0; e < n && ifd + 2 + e * 12 + 8 <= head.length; e += 1) {
            const entry = ifd + 2 + e * 12;
            if (u16(entry) === 0x0112) { orientation = u16(entry + 8); break; }
          }
        }
      }
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        const h = (head[i + 5] << 8) | head[i + 6];
        const w = (head[i + 7] << 8) | head[i + 8];
        if (w <= 0 || h <= 0) return null;
        const swap = orientation >= 5 && orientation <= 8;
        return { w: swap ? h : w, h: swap ? w : h };
      }
      i += 2 + len;
    }
    return null;
  } catch {
    return null;
  }
}

/** Defaults del rescate F-HEIC (upstream image-processor.ts:248-255). */
export const HEIC_TOPE_MP_DEFECTO = 24;
export const HEIC_LIMITE_MS_DEFECTO = 15_000;
export type OpcionesRescateHeic = { topeMpHeic?: number; limiteMsHeic?: number };

/** F-IMPORT — File → dataURL de captura. Sin `heic2any` en Tamiz (sin deps
 *  nuevas autorizadas), el rescate HEIC de reserva NO existe: un HEIC se
 *  rechaza con SU error (ErrorRescateHeic) y la UI lo clasifica
 *  (HEIC_NO_SOPORTADO); JPEG/PNG decodifican nativo con tope por canvas. */
export async function fileToCaptureDataUrl(
  file: File,
  _opcionesRescate: OpcionesRescateHeic = {},
): Promise<string> {
  const looksHeic = /heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
  if (looksHeic) throw new ErrorRescateHeic("La foto HEIC no se pudo decodificar en este navegador.");
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result ?? ""));
    fr.onerror = () => reject(fr.error ?? new Error("No se pudo leer el archivo"));
    fr.readAsDataURL(file);
  });
  if (!dataUrl) throw new ErrorRescateHeic();
  return dataUrl;
}

import {
  anguloDeskew,
  corregirDeskew,
  quadSesgado,
  warpPerspectiva,
} from '../molde/homografia';

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
  // Guardia de plausibilidad: la heurística de gradientes puede engancharse a
  // un recuadro INTERNO del documento (tablas, tarjetas de candidatos) en vez
  // de al papel completo. Si el rect cubre <30% del área es más probable que
  // sea un elemento interno: identidad (la foto entera es el documento).
  if ((x1 - x0) * (y1 - y0) < 0.3) {
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
 * Procesa la foto: recorta el quad y aplica el filtro de revelado.
 *
 * FASE A3 (blueprint DLA): el quad ya NO se reduce a su bounding box. Si el
 * quad está SESGADO (alguna esquina separada del bbox — foto en ángulo), se
 * aplica una homografía real de 4 puntos (warpPerspectiva, muestreo bilineal
 * inverso); si es axis-aligned exacto, el recorte recto equivale al warp y es
 * más barato. El ancho de salida conserva la resolución del documento.
 * Además, con `opts.deskew` (kill-switch por flag en Tamiz) se corrige la
 * INCLINACIÓN residual ≤25° por perfil de proyección (FASE 2 del plan:
 * antes ≤10°) — la que el quad no ve.
 * `manual: true` (recorte del editor) respeta el quad al píxel y desactiva el
 * deskew automático (la decisión del usuario manda).
 * Devuelve { processed } como dataURL.
 */

// ─── KIT e14-fallback-worker-v1 (Ola 5 §5.4 — R2, port Tamiz universal) ────
// El warp + filtros + encode PNG salen del hilo principal al worker IIFE
// `public/scanner/fallback-canvas.worker.js` (build: scripts/build-fallback-
// canvas-worker.mjs — fuentes en workers/fallback-canvas.ts con los filtros
// EXACTOS del fork, ver comentario del worker). El hilo principal queda como
// red: decodifica (createImageBitmap, async) y TRANSIERE el bitmap. Ruta local
// SIEMPRE cuando no hay window (tests bun), no hay OffscreenCanvas (iOS <16.4),
// el worker falló una vez (roto para la sesión) o cualquier excepción.
interface RespuestaFallbackOk {
  id: number;
  ok: true;
  png: Blob;
  ancho: number;
  alto: number;
}
interface RespuestaFallbackMal {
  id: number;
  ok: false;
  error: string;
}
type RespuestaFallbackWorker = RespuestaFallbackOk | RespuestaFallbackMal;

let fallbackCanvasWorker: Worker | null = null;
let fallbackCanvasWorkerRoto = false;
let fallbackCanvasSeq = 0;
const fallbackCanvasPendientes = new Map<
  number,
  { resolver: (r: RespuestaFallbackOk) => void; rechazar: (e: Error) => void }
>();

function fallbackCanvasHabilitado(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof Worker === "function" &&
    typeof OffscreenCanvas === "function" &&
    !fallbackCanvasWorkerRoto
  );
}

function romperFallbackCanvasWorker(motivo: string): void {
  fallbackCanvasWorkerRoto = true;
  if (fallbackCanvasWorker) {
    try {
      fallbackCanvasWorker.terminate();
    } catch {
      /* noop */
    }
    fallbackCanvasWorker = null;
  }
  for (const [id, pendiente] of fallbackCanvasPendientes) {
    fallbackCanvasPendientes.delete(id);
    pendiente.rechazar(new Error(`fallback-worker: ${motivo}`));
  }
}

function obtenerFallbackCanvasWorker(): Worker {
  if (!fallbackCanvasWorker) {
    // Artefacto PRECOMPILADO (DICTAMEN-e73 §3.1): el .ts crudo no sirve de
    // worker — el .worker.js lo emite scripts/build-fallback-canvas-worker.mjs.
    const w = new Worker(`${publicBaseEfectivo()}/scanner/fallback-canvas.worker.js`, {
      name: "fallback-canvas-v1",
    });
    w.onmessage = (e: MessageEvent<RespuestaFallbackWorker>) => {
      const pendiente = fallbackCanvasPendientes.get(e.data.id);
      if (!pendiente) return;
      fallbackCanvasPendientes.delete(e.data.id);
      if (e.data.ok) pendiente.resolver(e.data);
      else pendiente.rechazar(new Error(e.data.error));
    };
    w.onerror = () => romperFallbackCanvasWorker("onerror del worker");
    fallbackCanvasWorker = w;
  }
  return fallbackCanvasWorker;
}

/** processImage EN WORKER: el main decodifica y transfiere; el worker hace
 *  warp + rotación + filtro fork + PNG (misma matemática). Devuelve null en
 *  cualquier fallo — el llamador cae a su ruta local sin cambiar nada. */
async function processImageViaFallbackWorker(
  foto: string,
  quad: Quad,
  filtro: PageFilter,
  rotation: number,
): Promise<{ processed: string; width: number; height: number } | null> {
  if (!fallbackCanvasHabilitado()) return null;
  try {
    const blobSrc = await (await fetch(foto)).blob();
    const bitmap = await createImageBitmap(blobSrc);
    try {
      const worker = obtenerFallbackCanvasWorker();
      const id = ++fallbackCanvasSeq;
      const respuesta = new Promise<RespuestaFallbackOk>((resolver, rechazar) => {
        fallbackCanvasPendientes.set(id, { resolver, rechazar });
      });
      const reloj = setTimeout(() => {
        if (fallbackCanvasPendientes.delete(id)) {
          romperFallbackCanvasWorker("sin respuesta en 30 s");
        }
      }, 30_000);
      try {
        worker.postMessage(
          {
            id,
            bitmap,
            quad: quad.flatMap((p) => [p.x, p.y]),
            filter: filtro,
            rotation,
            maxLongSide: 4032,
          },
          [bitmap],
        );
        const r = await respuesta;
        const processed = await new Promise<string>((resolve) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result ?? ""));
          fr.onerror = () => resolve("");
          fr.readAsDataURL(r.png);
        });
        if (!processed) return null;
        return { processed, width: r.ancho, height: r.alto };
      } finally {
        clearTimeout(reloj);
        fallbackCanvasPendientes.delete(id);
      }
    } finally {
      try {
        bitmap.close();
      } catch {
        /* noop — si fue transferido queda detached */
      }
    }
  } catch {
    // Cualquier excepción del camino nuevo → null: la ruta local termina el trabajo.
    return null;
  }
}

export async function processImage(
  foto: string,
  quad: Quad,
  filtro: PageFilter,
  rotation: number,
  opts?: { manual?: boolean; deskew?: boolean },
): Promise<{ processed: string; width: number; height: number }> {
  // §5.4 (R2, port) — ruta EN WORKER cuando el entorno la soporta y el pedido
  // no necesita deskew (corrección exclusiva del fork, camada local). El quad
  // manual (`manual: true`) viaja igual: el worker respeta el quad al píxel.
  if (!opts?.deskew) {
    const viaWorker = await processImageViaFallbackWorker(foto, quad, filtro, rotation);
    if (viaWorker) return viaWorker;
  }
  const img = await decodificar(foto);
  const src = imgACanvas(img);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const sesgado = quadSesgado(quad);
  let out: HTMLCanvasElement;
  if (sesgado) {
    // Warp de perspectiva real: la salida conserva el ancho efectivo del
    // documento (media de lados cortos/largos lo decide warpPerspectiva).
    const anchoDoc = Math.round(
      (Math.hypot((quad[1].x - quad[0].x) * w, (quad[1].y - quad[0].y) * h) +
        Math.hypot((quad[2].x - quad[3].x) * w, (quad[2].y - quad[3].y) * h)) / 2,
    );
    // PROCESSED_MAX_LONG_SIDE = 4032 (upstream image-processor.ts:67 — bug v3
    // de CALIDAD: 3200 recortaba las fotos de 12 MP; 4032×3024 ≈ 12.2 MP).
    out = warpPerspectiva(src, quad, Math.max(200, Math.min(4032, anchoDoc)));
  } else {
    // Rect del quad (bounding) en px — camino equivalente al recorte histórico.
    const xs = quad.map((p) => p.x * w);
    const ys = quad.map((p) => p.y * h);
    const x0 = Math.max(0, Math.floor(Math.min(...xs)));
    const y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const x1 = Math.min(w, Math.ceil(Math.max(...xs)));
    const y1 = Math.min(h, Math.ceil(Math.max(...ys)));
    const cw = Math.max(1, x1 - x0);
    const ch = Math.max(1, y1 - y0);
    out = document.createElement('canvas');
    out.width = cw;
    out.height = ch;
    const ctx = out.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(src, x0, y0, cw, ch, 0, 0, cw, ch);
  }
  // FASE A3 — deskew residual (≤25°, FASE 2 del plan: antes ≤10°): solo fuera
  // del recorte manual y cuando la flag del host lo habilita; el ángulo lo
  // mide el perfil de proyección.
  if (opts?.deskew && !opts?.manual) {
    try {
      const ang = anguloDeskew(out);
      if (ang !== 0) out = corregirDeskew(out, ang);
    } catch {
      /* sin corrección: degradación honesta, el pipeline sigue */
    }
  }
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
    // Rango tonal degenerado (p5≈p95): pasa en renders limpios, PDFs
    // rasterizados y fotos de fondo uniforme, donde >95 % de los píxeles son
    // 255. Estirar contra un span artificial de 8 mapeaba el BLANCO a 0 y
    // dejaba la página entera negra (OCR vacío, «papel cortado», score 0).
    // Sin rango útil se conserva el gris original: el umbral sigue separando
    // tinta de papel sin invertir la imagen.
    const degenerado = p95 - p5 < 8;
    const span = Math.max(8, p95 - p5);
    for (let i = 0; i < px.length; i += 4) {
      const g = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
      let v = degenerado ? g : ((g - p5) * 255) / span;
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
    // R-10 (upstream): los 3 filtros del producto salen PNG — sin ringing
    // JPEG sobre la tinta (degrada OCR y la comparación del visor).
    processed: rotado.toDataURL('image/png'),
    width: rotado.width,
    height: rotado.height,
  };
}
