// Primitivas de procesado de imagen — pipeline REAL de digielect14:
// detección por DetectionWorker (OpenCV) con fallback Sobel local, warp
// refinado (RANSAC + homografía INTER_CUBIC) + enhance del motor (raw/text/
// bw) en el worker, y fallback canvas (worker IIFE o hilo principal) con la
// MISMA matemática de image-modes.

import type { PageFilter, Quad } from './types';
// R-46 — prefijo público de assets por INYECCIÓN lazy (dominio/entorno del fork).
import { publicBaseEfectivo } from '../dominio/entorno';
// Plan §B (rotada-12): guardas anti-degenerados del quad compartidas con el
// gemelo worker (core/quad-guardas.ts — misma matemática, mismo commit) y
// logger del paquete para la telemetría de salida vacía.
import { anchoSalidaDeQuad, sanearQuad } from './quad-guardas';
import { enhanceToRgba, unsharpRgba, type EnhanceMode } from './image-modes';
import { getScannerWorker } from './detector-client';
import { logger } from '../dominio/logger';

/** Tope técnico ÚNICO del lado mayor procesado (fix v3 upstream): 4032 px —
 *  4032×3024 ≈ 12.2 MP, lejos del límite de canvas de iOS (~16.7 MP). */
export const PROCESSED_MAX_LONG_SIDE = 4032;

/** Mapea los filtros del producto a los modos reales del worker. El filtro
 *  'contrast' del fork se resuelve al modo 'text' de digielect14 (white-point
 *  + LUT sigmoidal; el p5/p95 lineal ya no se usa — R4 de la auditoría). */
export function filterToEnhanceMode(filter: PageFilter): EnhanceMode {
  switch (filter) {
    case 'original':
      return 'raw';
    case 'bw':
      return 'bw';
    default:
      return 'text';
  }
}

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
 * Detección de esquinas del documento — PIPELINE REAL de digielect14
 * (contornos OpenCV vía DetectionWorker + refinado; fallback Sobel local).
 * El quad es normalizado 0..1 en orden TL, TR, BR, BL. Origen honesto:
 * 'detector' = worker OpenCV; 'sobel' = fallback local.
 */
export async function detectDocumentEdgesDetail(
  foto: string,
): Promise<{ quad: Quad; origen: OrigenQuad }> {
  // 1) Pipeline real: worker + OpenCV (la MISMA vía del visor en vivo).
  const quad = await detectWithWorker(foto);
  if (quad) return { quad, origen: 'detector' };
  // 2) Fallback: Sobel simplificado (siempre devuelve algo).
  return { quad: await detectSobel(foto), origen: 'sobel' };
}

/** Solo Sobel — el llamador ya intentó el worker y necesita el respaldo. */
export async function detectDocumentEdgesSobel(foto: string): Promise<Quad> {
  return detectSobel(foto);
}

async function detectWithWorker(foto: string): Promise<Quad | null> {
  const client = getScannerWorker();
  if (!client || client.isDead) return null;
  const ok = await client.waitReady();
  if (!ok) return null;
  try {
    const img = await decodificar(foto);
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return null;
    const out = await client.detect(img, w, h);
    if (out && isValidQuadFloats(out.corners)) {
      const quad = floatsToQuad(out.corners);
      // Sanity: área razonable (el worker ya valida ≥10% del frame).
      if (quadArea(quad) > 0.01) return quad;
    }
  } catch {
    /* fallback */
  }
  return null;
}

function floatsToQuad(f: Float32Array): Quad {
  return [
    { x: f[0]!, y: f[1]! },
    { x: f[2]!, y: f[3]! },
    { x: f[4]!, y: f[5]! },
    { x: f[6]!, y: f[7]! },
  ];
}

function isValidQuadFloats(f: Float32Array | null): f is Float32Array {
  if (f === null || f.length !== 8) return false;
  for (let i = 0; i < 8; i++) {
    const v = f[i]!;
    if (!Number.isFinite(v) || v < -0.05 || v > 1.05) return false;
  }
  return true;
}

function quadArea(q: Quad): number {
  const [tl, tr, br, bl] = q;
  const tri = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) =>
    Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
  return tri(tl!, tr!, br!) + tri(tl!, br!, bl!);
}

/** P2 (digielect14 0.4.0): umbral de pico y penalización por lateral vivo. */
const UMBRAL_PICO = 0.4;
const SPAN_INTERNA = 0.15;
const LATERAL_VIVO = 0.35;

function clamp01(v: number): number {
  return Math.min(0.98, Math.max(0.02, v));
}

/** Sobel simplificado sobre downscaled — fallback del pipeline real
 *  (port byte-fiel de digielect14 image-processor.ts:924-1106). */
async function detectSobel(foto: string): Promise<Quad> {
  try {
    const img = await decodificar(foto);
    const w0 = img.naturalWidth;
    const h0 = img.naturalHeight;
    const W = 160;
    const H = Math.max(1, Math.round((h0 / w0) * W));
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('sin contexto');
    ctx.drawImage(img, 0, 0, W, H);
    const data = ctx.getImageData(0, 0, W, H).data;

    // Mapa de energía Sobel
    const energy = new Float32Array(W * H);
    const gray = (i: number) => 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const gx =
          -gray(i - W - 1) - 2 * gray(i - 1) - gray(i + W - 1) +
          gray(i - W + 1) + 2 * gray(i + 1) + gray(i + W + 1);
        const gy =
          -gray(i - W - 1) - 2 * gray(i - W) - gray(i - W + 1) +
          gray(i + W - 1) + 2 * gray(i + W) + gray(i + W + 1);
        energy[i] = Math.sqrt(gx * gx + gy * gy);
      }
    }

    const findEdgeX = (from: number, to: number, y0: number, y1: number) => {
      let bestX = from;
      let bestE = -1;
      for (let x = from; x < to; x++) {
        let e = 0;
        for (let y = y0; y < y1; y++) e += energy[y * W + x];
        if (e > bestE) {
          bestE = e;
          bestX = x;
        }
      }
      return bestX / W;
    };
    const findEdgeY = (from: number, to: number, x0: number, x1: number) => {
      let bestY = from;
      let bestE = -1;
      for (let y = from; y < to; y++) {
        let e = 0;
        for (let x = x0; x < x1; x++) e += energy[y * W + x];
        if (e > bestE) {
          bestE = e;
          bestY = y;
        }
      }
      return bestY / H;
    };

    /** P2 (0.4.0, kit e14-quad-sobel-v1 §3-B): el borde del PAPEL, no el
     *  máximo de energía. La banda de nivelación de la mesa le ganaba al
     *  borde papel/pupitre → quad corto → falso INCOMPLETA. Mismo mapa de
     *  energía a 160px; solo cambia cuál fila del rango inferior se elige.
     *  Sin candidatos ≥ umbral → degradación a máxima energía. */
    const findEdgeYBottom = (
      from: number,
      to: number,
      x0: number,
      x1: number,
      leftFrac: number,
      rightFrac: number,
    ) => {
      const E: number[] = [];
      for (let y = from; y < to; y++) {
        let e = 0;
        for (let x = x0; x < x1; x++) e += energy[y * W + x];
        E.push(e);
      }
      const maxE = Math.max(...E);
      const yMax = from + E.indexOf(maxE);
      if (!(maxE > 0)) return yMax / H;

      const colPeak = (xf: number) => {
        const xc = Math.round(xf * W);
        let peak = 0;
        for (let dx = -2; dx <= 2; dx++) {
          const x = Math.min(W - 2, Math.max(1, xc + dx));
          for (let y = 1; y < H - 1; y++) {
            if (energy[y * W + x] > peak) peak = energy[y * W + x];
          }
        }
        return peak;
      };
      const peakL = colPeak(leftFrac);
      const peakR = colPeak(rightFrac);
      const lateralVivo = (xf: number, peak: number, y: number) => {
        if (!(peak > 0)) return false;
        const xc = Math.round(xf * W);
        for (let dx = -2; dx <= 2; dx++) {
          const x = Math.min(W - 2, Math.max(1, xc + dx));
          if (energy[y * W + x] >= LATERAL_VIVO * peak) return true;
        }
        return false;
      };

      let mejorY = yMax;
      let mejorScore = -1;
      for (let i = 0; i < E.length; i++) {
        const prev = i > 0 ? E[i - 1]! : -1;
        const next = i < E.length - 1 ? E[i + 1]! : -1;
        if (E[i]! < prev || E[i]! < next) continue;
        if (E[i]! < UMBRAL_PICO * maxE) continue;
        let vivo = 0;
        for (let yy = from + i + 1; yy < to; yy++) {
          if (lateralVivo(leftFrac, peakL, yy) || lateralVivo(rightFrac, peakR, yy)) vivo++;
        }
        const restante = Math.max(1, to - (from + i));
        const spanFrac = vivo / restante;
        const penal = Math.min(1, spanFrac / (SPAN_INTERNA * 2));
        const score = E[i]! * (1 - penal);
        if (score >= mejorScore) {
          mejorScore = score;
          mejorY = from + i;
        }
      }
      return (mejorScore >= 0 ? mejorY : yMax) / H;
    };

    const m = Math.round(W * 0.06);
    const left = findEdgeX(1, Math.floor(W * 0.45), m, H - m);
    const right = findEdgeX(Math.ceil(W * 0.55), W - 1, m, H - m);
    const top = findEdgeY(1, Math.floor(H * 0.45), m, W - m);
    const bottom = findEdgeYBottom(Math.ceil(H * 0.55), H - 1, m, W - m, left, right);

    return [
      { x: clamp01(left), y: clamp01(top) },
      { x: clamp01(right), y: clamp01(top) },
      { x: clamp01(right), y: clamp01(bottom) },
      { x: clamp01(left), y: clamp01(bottom) },
    ];
  } catch {
    // Contrato del fallback «siempre devuelve algo»: el flujo sigue.
    return [
      { x: 0.08, y: 0.1 },
      { x: 0.92, y: 0.07 },
      { x: 0.95, y: 0.93 },
      { x: 0.05, y: 0.96 },
    ];
  }
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
  const t0Worker = performance.now();
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
        // Telemetría §B (rotada-12): salida VACÍA con entrada decodificable
        // — una línea con ms y dims. null = la ruta local termina el trabajo
        // (degradación contenida de siempre, sin '' silencioso).
        if (!processed) {
          logger.warn(
            "[image-processor] PNG del worker indigerible como data URL (cae a ruta local)",
            { ms: Math.round(performance.now() - t0Worker), dims: `${r.ancho}x${r.alto}` },
          );
          return null;
        }
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

/** Filtro bw de digielect14 — unsharp + Bradley-Roth ADAPTATIVO. Única
 *  matemática del filtro bw en la ruta local; el gemelo del worker
 *  (`workers/fallback-canvas.ts`) replica esta secuencia EXACTA byte a byte
 *  (test de paridad `core/filtros-paridad.test.ts`). */
export function aplicarFiltroBw(px: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const afilada = unsharpRgba(px, w, h);
  return enhanceToRgba(afilada, w, h, 'bw');
}

// ─── Pipeline PRECISO: DetectionWorker + OpenCV (digielect14) ───────────────

/** Estadísticas del pipeline REAL (worker OpenCV) — observabilidad del acta. */
export interface PagePrecision {
  engine: 'worker';
  refined: boolean;
  /** Esquinas firmes del refinado (null = cuadro manual, sin refine). */
  cornersSolid: number | null;
  width: number;
  height: number;
  elapsedMs?: number;
}

export interface ProcessResult {
  processed: string;
  width: number;
  height: number;
  thumbnail?: string;
  precision?: PagePrecision;
  /** ms de adquisición de la fuente del warp (blob-first o decode completo). */
  decodeMs?: number;
}

/** Opciones del pipeline (las de digielect14 + kill-switches del host). */
export interface ProcessOptions {
  /** Quad colocado por el humano → sin refine y sin shrink (F5-MANUAL). */
  manual?: boolean;
  /** Deskew residual del fork (kill-switch del host); off por defecto. */
  deskew?: boolean;
  /** Lado mayor máximo del resultado (default PROCESSED_MAX_LONG_SIDE). */
  maxLongSide?: number;
  /** true = unsharp (0.5/1.5) sobre el filtro Original (raw puro por F5-RAW). */
  unsharpOriginal?: boolean;
}

/** Nº de esquinas firmes del refinado (fellBack[i]=true ⇒ esquina i cayó al
 *  estimado grueso). null cuando el worker no informa (quad manual). */
function solidCorners(fellBack: readonly boolean[] | null): number | null {
  if (!fellBack) return null;
  return fellBack.filter((f) => !f).length;
}

/** data URL → Blob SÍNCRONO (parse manual, portable a workers; C-24: null si
 *  no hay coma separadora — nunca un Blob vacío). Port de core/codec.ts. */
function dataUrlToBlob(dataUrl: string): Blob | null {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  const header = dataUrl.slice(0, comma);
  const mime = /data:([^;]+)/.exec(header)?.[1] ?? 'application/octet-stream';
  const payload = dataUrl.slice(comma + 1);
  if (/;base64$/i.test(header)) {
    const bin = atob(payload);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(payload)], { type: mime });
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result ?? ''));
    fr.onerror = () => reject(new Error('blobToDataURL falló'));
    fr.readAsDataURL(blob);
  });
}

/** Dibuja un bitmap en canvas aplicando rotación de 90/180/270. */
function bitmapToRotatedCanvas(
  bitmap: ImageBitmap | HTMLCanvasElement | HTMLImageElement,
  rotation: number,
): HTMLCanvasElement {
  const w = bitmap instanceof HTMLImageElement ? bitmap.naturalWidth : bitmap.width;
  const h = bitmap instanceof HTMLImageElement ? bitmap.naturalHeight : bitmap.height;
  const swapped = rotation === 90 || rotation === 270;
  const canvas = document.createElement('canvas');
  canvas.width = swapped ? h : w;
  canvas.height = swapped ? w : h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('sin contexto');
  ctx.imageSmoothingQuality = 'high';
  if (rotation !== 0) {
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.drawImage(bitmap, -w / 2, -h / 2);
    ctx.restore();
  } else {
    ctx.drawImage(bitmap, 0, 0);
  }
  return canvas;
}

/** Miniatura 160px de ancho desde un blob (resultado real del enhance). */
async function thumbnailFromBlob(blob: Blob): Promise<string> {
  let bm: ImageBitmap | null = null;
  try {
    bm = await createImageBitmap(blob);
    const tW = 160;
    const tH = Math.max(1, Math.round((bm.height / bm.width) * tW));
    const canvas = document.createElement('canvas');
    canvas.width = tW;
    canvas.height = tH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('sin contexto');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bm, 0, 0, tW, tH);
    return canvas.toDataURL('image/jpeg', 0.8);
  } catch {
    // Cosmética: fallo ⇒ "" y el acta procesada sigue intacta.
    return '';
  } finally {
    try {
      bm?.close();
    } catch {
      /* noop */
    }
  }
}

/** Segunda vía de la miniatura: re-decode del processed (solo si el blob
 *  falló). "" si todo falla, igual que thumbnailFromBlob. */
async function thumbnailFromDataURL(url: string): Promise<string> {
  try {
    const img = await loadImage(url);
    const tW = 160;
    const tH = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * tW));
    const canvas = document.createElement('canvas');
    canvas.width = tW;
    canvas.height = tH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, tW, tH);
    return canvas.toDataURL('image/jpeg', 0.8);
  } catch {
    return '';
  }
}

function thumbnailFromCanvas(canvas: HTMLCanvasElement): string {
  const tW = 160;
  const tH = Math.max(1, Math.round((canvas.height / canvas.width) * tW));
  const tCanvas = document.createElement('canvas');
  tCanvas.width = tW;
  tCanvas.height = tH;
  const tCtx = tCanvas.getContext('2d');
  if (tCtx) {
    tCtx.imageSmoothingQuality = 'high';
    tCtx.drawImage(canvas, 0, 0, tW, tH);
  }
  return tCanvas.toDataURL('image/jpeg', 0.8);
}

async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement | null> {
  const bm = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bm.width;
    canvas.height = bm.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bm, 0, 0);
    return canvas;
  } finally {
    try {
      bm.close();
    } catch {
      /* noop */
    }
  }
}

function applyUnsharpToCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return canvas;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  data.data.set(unsharpRgba(data.data, canvas.width, canvas.height));
  ctx.putImageData(data, 0, 0);
  return canvas;
}

/** Filtro canvas de respaldo del preciso (enhance no disponible): MISMAS
 *  funciones puras de image-modes (contrato §4.2 — prohibida otra matemática).
 *  Unsharp ANTES del filtro en modo ≠ raw/text (§8); "text" afila por bordes
 *  internamente (F-TEXT-CLEAN). */
function applyFilterToCanvas(canvas: HTMLCanvasElement, filter: PageFilter): HTMLCanvasElement {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || canvas.width < 1 || canvas.height < 1) return canvas;
  const mode = filterToEnhanceMode(filter);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let d: Uint8ClampedArray = image.data;
  if (mode !== 'raw' && mode !== 'text') d = unsharpRgba(d, canvas.width, canvas.height);
  image.data.set(enhanceToRgba(d, canvas.width, canvas.height, mode));
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** Pipeline REAL vía DetectionWorker: warp (RANSAC + homografía INTER_CUBIC)
 *  → rotación/deskew → enhance del motor (modo real del producto). null →
 *  el llamador usa su fallback (worker canvas o ruta local). */
async function processImagePrecise(
  src: string,
  quad: Quad,
  filter: PageFilter,
  rotation: number,
  opts?: ProcessOptions,
): Promise<ProcessResult | null> {
  const client = getScannerWorker();
  if (!client || client.isDead) return null;
  const ok = await client.waitReady();
  if (!ok) return null;
  try {
    // Blob-first del tier fast: si hay tope de salida menor que el full-res,
    // decodificar DIRECTO del Blob al tamaño de salida (el decodificador
    // escala durante el decode). Cualquier fallo → camino normal (el
    // comportamiento nunca degrada, solo acelera cuando está disponible).
    const cap = opts?.maxLongSide;
    const tDecode = performance.now();
    let warpSource: HTMLImageElement | ImageBitmap | null = null;
    let img: HTMLImageElement | null = null;
    if (cap !== undefined && cap < PROCESSED_MAX_LONG_SIDE) {
      try {
        const blob = dataUrlToBlob(src);
        if (blob === null) throw new Error('data URL sin payload');
        const dims = await jpegDimensionsFromBlob(blob);
        if (dims && cap < Math.max(dims.w, dims.h)) {
          const scale = cap / Math.max(dims.w, dims.h);
          const rw = Math.max(1, Math.round(dims.w * scale));
          const rh = Math.max(1, Math.round(dims.h * scale));
          const bitmap = await createImageBitmap(blob, {
            resizeWidth: rw,
            resizeHeight: rh,
            resizeQuality: 'high',
            imageOrientation: 'from-image',
          });
          // Sanity: la plataforma DEBE entregar el tamaño pedido.
          if (bitmap.width === rw && bitmap.height === rh) warpSource = bitmap;
          else bitmap.close();
        }
      } catch {
        /* no-JPEG / header corrupto / sin resize+orientación → camino normal */
      }
    }
    if (!warpSource) {
      img = await decodificar(src);
      warpSource = img;
      const longIn = Math.max(img.naturalWidth, img.naturalHeight);
      if (cap !== undefined && cap < PROCESSED_MAX_LONG_SIDE && cap < longIn) {
        const scale = cap / longIn;
        try {
          warpSource = await createImageBitmap(img, {
            resizeWidth: Math.max(1, Math.round(img.naturalWidth * scale)),
            resizeHeight: Math.max(1, Math.round(img.naturalHeight * scale)),
            resizeQuality: 'high',
          });
        } catch {
          /* plataforma sin resize → foto completa */
        }
      }
    }
    const decodeMs = performance.now() - tDecode;

    // 1) Warp: refinado sub-píxel (RANSAC) + shrink 3.5px + homografía
    //    INTER_CUBIC sobre la foto completa. Devuelve bitmap PURO (F5-RAW-2).
    const warp = await client.warp(warpSource, quad, opts?.manual === true);
    // Si la fuente fue un bitmap propio, liberarlo (transferido → no-op).
    if (warpSource !== img) (warpSource as ImageBitmap).close();
    if (!warp?.bitmap) return null;

    // 2) Rotación post-warp (90/180/270) y deskew residual del fork. Solo se
    //    materializa canvas cuando hay transformación de píxeles; con
    //    rotation 0 (todas las capturas) el bitmap va DIRECTO al enhance.
    const necesitaCanvas = rotation !== 0 || (opts?.deskew === true && opts?.manual !== true);
    let rotated: HTMLCanvasElement | null = null;
    if (necesitaCanvas) {
      rotated = bitmapToRotatedCanvas(warp.bitmap, rotation);
      warp.bitmap.close();
      if (opts?.deskew && !opts?.manual) {
        try {
          const ang = anguloDeskew(rotated);
          if (ang !== 0) rotated = corregirDeskew(rotated, ang);
        } catch {
          /* sin corrección: degradación honesta, el pipeline sigue */
        }
      }
    }

    // 3) Enhance: modo real del producto (modelo de sombras + constantes
    //    exactas). maxLongSide protege la memoria de data URLs en iOS.
    const mode = filterToEnhanceMode(filter);
    const maxLongSide = opts?.maxLongSide ?? PROCESSED_MAX_LONG_SIDE;
    const enh = await client.enhance(rotated ?? warp.bitmap, mode, { maxLongSide });

    if (enh && enh.blob.size > 0) {
      let blob = enh.blob;
      // El modo raw sale PURO del worker — el toggle de nitidez del Original
      // se aplica aquí con las mismas constantes (0.5/1.5, kernel 7).
      if (filter === 'original' && opts?.unsharpOriginal === true) {
        try {
          const canvas = await blobToCanvas(blob);
          if (canvas) {
            applyUnsharpToCanvas(canvas);
            const reencoded = await new Promise<Blob | null>((resolve) =>
              canvas.toBlob((b) => resolve(b), 'image/png'),
            );
            if (reencoded && reencoded.size > 0) blob = reencoded;
          }
        } catch {
          /* conserva el blob puro */
        }
      }
      const processed = await blobToDataURL(blob);
      const precision: PagePrecision = {
        engine: 'worker',
        refined: warp.refined,
        cornersSolid: solidCorners(warp.fellBack),
        width: enh.w,
        height: enh.h,
        elapsedMs: enh.elapsedMs,
      };
      const thumbnail = await thumbnailFromBlob(blob);
      return {
        processed,
        width: enh.w,
        height: enh.h,
        thumbnail:
          thumbnail || (rotated ? thumbnailFromCanvas(rotated) : await thumbnailFromDataURL(processed)),
        precision,
        decodeMs,
      };
    }

    // 4) Enhance no disponible → warp real + filtro canvas local (misma
    //    matemática de image-modes). rotation === 0: el bitmap se transfirió
    //    al worker (detached) → close no-op; devolver null cae al pipeline
    //    completo desde la fuente (output equivalente, jamás incorrecto).
    if (!rotated) {
      warp.bitmap.close();
      return null;
    }
    const filtered = applyFilterToCanvas(rotated, filter);
    if (filter === 'original' && opts?.unsharpOriginal === true) {
      applyUnsharpToCanvas(filtered);
    }
    return {
      processed: filtered.toDataURL('image/png'),
      width: filtered.width,
      height: filtered.height,
      thumbnail: thumbnailFromCanvas(filtered),
      precision: {
        engine: 'worker',
        refined: warp.refined,
        cornersSolid: solidCorners(warp.fellBack),
        width: filtered.width,
        height: filtered.height,
      },
      decodeMs,
    };
  } catch {
    // Cualquier fallo del preciso ⇒ null: processImage cae al fallback
    // (output equivalente, jamás rompe al llamador).
    return null;
  }
}

export async function processImage(
  foto: string,
  quad: Quad,
  filtro: PageFilter,
  rotation: number,
  opts?: ProcessOptions,
): Promise<ProcessResult> {
  // Ruta REAL de digielect14: worker OpenCV (warp refinado + enhance). null →
  // fallback worker canvas → ruta local, en ese orden.
  const precisa = await processImagePrecise(foto, quad, filtro, rotation, opts);
  if (precisa) return precisa;
  // §5.4 (R2, port) — ruta EN WORKER cuando el entorno la soporta y el pedido
  // no necesita deskew (corrección exclusiva del fork, camada local). El quad
  // manual (`manual: true`) viaja igual: el worker respeta el quad al píxel.
  if (!opts?.deskew) {
    const viaWorker = await processImageViaFallbackWorker(foto, quad, filtro, rotation);
    if (viaWorker) return viaWorker;
  }
  const t0 = performance.now();
  const img = await decodificar(foto);
  const src = imgACanvas(img);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  // Guarda §B: un quad con NaN/±Inf (detector caído, JSON corrupto) envenena
  // AMBAS rutas — crop → Math.min/max NaN → canvas 0×0 → drawImage no-op
  // SILENCIOSO → toDataURL '' (foto vacía en el acta); warp → hypot(NaN) →
  // ancho NaN. Se sana a identidad ANTES de decidir (degradación honesta,
  // mismo convenio del catch de detección del pipeline) y se registra.
  const saneado = sanearQuad(quad);
  if (saneado.saneado) {
    logger.warn('[image-processor] quad con coordenadas no finitas → identidad', {
      dims: `${w}x${h}`,
    });
  }
  const quadSano = saneado.quad;
  const sesgado = quadSesgado(quadSano);
  let out: HTMLCanvasElement;
  if (sesgado) {
    // Warp de perspectiva real: la salida conserva el ancho efectivo del
    // documento (media de lados cortos/largos lo decide warpPerspectiva).
    // Guarda §B: la fórmula vive en anchoSalidaDeQuad (quad-guardas,
    // compartida con el gemelo worker) — clamp [1, 4032]; un quad degenerado
    // ya NO puede producir NaN (antes Math.min(4032, NaN) = NaN → canvas 0×0).
    const anchoDoc = Math.round(anchoSalidaDeQuad(quadSano, w, h, PROCESSED_MAX_LONG_SIDE));
    // PROCESSED_MAX_LONG_SIDE = 4032 (upstream image-processor.ts:67 — bug v3
    // de CALIDAD: 3200 recortaba las fotos de 12 MP; 4032×3024 ≈ 12.2 MP).
    out = warpPerspectiva(src, quadSano, Math.max(200, anchoDoc));
  } else {
    // Rect del quad (bounding) en px — camino equivalente al recorte histórico.
    const xs = quadSano.map((p) => p.x * w);
    const ys = quadSano.map((p) => p.y * h);
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
  if (filtro === 'bw') {
    // bw de digielect14 (portado) vía aplicarFiltroBw — unsharp + Bradley-Roth
    // ADAPTATIVO (integral image, ventana w/12, t=0.15) + despeckle +
    // corrección de sombra. El umbral fijo 165/90 del fork dejaba manchas con
    // fondo sombreado (hallazgo de la captura real del A56: OCR y molde sin
    // anclas).
    const rc = rotado.getContext('2d', { willReadFrequently: true })!;
    const data = rc.getImageData(0, 0, rotado.width, rotado.height);
    data.data.set(aplicarFiltroBw(data.data, rotado.width, rotado.height));
    rc.putImageData(data, 0, 0);
  } else if (filtro === 'contrast') {
    // R4 (auditoría diff-puertos): el "Texto claro" de digielect14 — white-
    // point + LUT sigmoidal + afilado edge-aware, SIN unsharp global y SIN el
    // p5/p95 lineal del fork que dejaba la página negra en renders limpios.
    const rc = rotado.getContext('2d', { willReadFrequently: true })!;
    const data = rc.getImageData(0, 0, rotado.width, rotado.height);
    data.data.set(enhanceToRgba(data.data, rotado.width, rotado.height, 'text'));
    rc.putImageData(data, 0, 0);
  }
  // R-10 (upstream): los 3 filtros del producto salen PNG — sin ringing
  // JPEG sobre la tinta (degrada OCR y la comparación del visor).
  const processed = rotado.toDataURL('image/png');
  // Telemetría §B (rotada-12): salida VACÍA con entrada decodificable — una
  // línea con ms y dims (el pipeline de Tamiz lanza con causa explícita; un
  // '' jamás viaja como fotoProcesada, contrato §D4 del visor).
  if (!processed) {
    logger.warn('[image-processor] salida procesada VACÍA con entrada decodificable', {
      dimsEntrada: `${w}x${h}`,
      dimsSalida: `${rotado.width}x${rotado.height}`,
      ms: Math.round(performance.now() - t0),
    });
  }
  return {
    processed,
    width: rotado.width,
    height: rotado.height,
  };
}

/** F1 — warp compartido: un solo warp (original) y bw derivado por Bradley
 *  sobre el canvas ya warp+deskew+rotado. PNG es lossless → el bw es
 *  pixel-idéntico al del flujo actual (dos processImage independientes).
 *  Ahorra el 2.º warp completo (decode + perspectiva + deskew + rotación). */
export async function processImageDual(
  foto: string,
  quad: Quad,
  rotation: number,
  opts?: ProcessOptions,
): Promise<{ bw: ProcessResult; original: ProcessResult }> {
  const original = await processImage(foto, quad, 'original', rotation, opts);
  if (!original.processed) {
    return { bw: original, original };
  }
  const img = await decodificar(original.processed);
  const canvas = imgACanvas(img);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  data.data.set(aplicarFiltroBw(data.data, canvas.width, canvas.height));
  ctx.putImageData(data, 0, 0);
  const bwProcessed = canvas.toDataURL('image/png');
  return {
    bw: { processed: bwProcessed, width: canvas.width, height: canvas.height },
    original,
  };
}
