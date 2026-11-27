/**
 * entry.ts — Arnés de benchmark OCR V3 · Agente 1 (rama bench/agente-1-arnes-motores)
 * PLAN-BENCHMARK-V3.md §5 (C1) + §8 reglas técnicas.
 *
 * Bundle browser (`bun build entry.ts --outfile=public/_bench/bench-ocr.js`).
 * Conductor: `bench-ocr.mjs` con CDP crudo (sin Playwright/Puppeteer/onnxruntime-node).
 *
 * Motores: Tesseract.js 7.0.0 (traineddata 4.0.0_fast y 4.0.0_real best, spa),
 * RapidOCR PP-OCRv4 (port del pipeline de scanner-core: preDet main.py,
 * db-postprocess literal, cls/rec por lotes, CTC con ppocr_keys) y ZXing
 * 0.23.0 (línea base 1D/QR independiente del OCR, plan §6).
 *
 * Prueba M (§3): M1 con molde (zonas ancla_relativa → recorte → OCR por
 * recorte con whitelist/realce), M2 sin molde (solo texto — extracción en el
 * conductor), M3 molde auto (anclas detectadas por OCR → zonas dinámicas).
 * S6 (§1): presencia de tinta {con_tinta, bbox} — JAMÁS transcripción de
 * manuscritos (contrato §1). Firmas medidas con el port de imageproc
 * (adaptive threshold 31/12 + apertura H/V + filtro de líneas combadas).
 *
 * Origen del código portado (cités línea a línea en cada sección):
 *   · db-postprocess.ts  — packages/scanner-core/ocr/db-postprocess.ts (LITERAL)
 *   · preDet/crop/rec    — packages/scanner-core/ocr/rapidocr.ts (L472-535,
 *                          L549-577, L605-653, L655-701, L985-1009, L1031-1040)
 *   · tinta (imageproc)  — packages/scanner-core/molde/imageproc.ts (L21-178,
 *                          L234-271) y universal-engine.ts medirTinta (L1089)
 *   · fórmula ancla_relativa — universal-engine.ts resolverRectCampo (L913-993)
 */

// ─────────────────────────────────────────────────────────────────────────────
// 0. Config del arnés
// ─────────────────────────────────────────────────────────────────────────────

const BASE = "/_bench";
const FIXTURES = "/fixtures";
const GT = "/gt";

const DET_CAP_PROD = 1920; // rapidocr.ts L469 (producción byte a byte)

const DOCS: Record<string, {
  prefix: string;
  moldes: { nombre: string; url: string; cuando: (ruta: string) => boolean }[];
}> = {
  recibo: {
    prefix: "01-RECIBO-DE-PAGO",
    moldes: [
      { nombre: "recibo_pago", url: `${FIXTURES}/01-RECIBO-DE-PAGO/molde/recibo_pago.molde.json`, cuando: () => true },
      { nombre: "recibo_a_real", url: `${FIXTURES}/01-RECIBO-DE-PAGO/molde/recibo_a_real.molde.json`, cuando: (r) => r.includes("firmas-vacias") },
    ],
  },
  comprobante: {
    prefix: "02-RECIBO-DE-ENTREGA",
    moldes: [
      { nombre: "comprobante_entrega", url: `${FIXTURES}/02-RECIBO-DE-ENTREGA/molde/comprobante_entrega.molde.json`, cuando: () => true },
      { nombre: "comprobante_a_real", url: `${FIXTURES}/02-RECIBO-DE-ENTREGA/molde/comprobante_a_real.molde.json`, cuando: (r) => r.includes("firmas-vacias") },
    ],
  },
  e26: { prefix: "03-E26-ACTA-PARCIAL-6PAG", moldes: [{ nombre: "e26_acta_parcial", url: `${FIXTURES}/03-E26-ACTA-PARCIAL-6PAG/molde/e26_acta_parcial.molde.json`, cuando: () => true }] },
  e14: { prefix: "04-ACTA-E14-2PAG", moldes: [{ nombre: "e14_acta", url: `${FIXTURES}/04-ACTA-E14-2PAG/molde/e14_acta.molde.json`, cuando: () => true }] },
};

function docDe(ruta: string): string | null {
  for (const [k, v] of Object.entries(DOCS)) if (ruta.startsWith(v.prefix)) return k;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Utilidades canvas / imagen
// ─────────────────────────────────────────────────────────────────────────────

function ctxDe(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("sin ctx 2d");
  return ctx;
}
function canvasCon(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
function canvasDe(src: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const c = canvasCon(w, h);
  ctxDe(c).drawImage(src, 0, 0, w, h);
  return c;
}
const round32 = (n: number): number => Math.max(32, Math.round(n / 32) * 32);

async function fetchBitmap(url: string): Promise<ImageBitmap> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return createImageBitmap(await r.blob());
}

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return (await r.json()) as T;
}

function heapMB(): number {
  const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return m ? Math.round(m.usedJSHeapSize / 1048576) : -1;
}

// Normalización para matching (anclas/GT): minúsculas, sin acentos, solo alnum+espacio
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = new Uint16Array(b.length + 1);
  const cur = new Uint16Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const costo = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + costo);
    }
    prev.set(cur);
  }
  return prev[b.length];
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. db-postprocess.ts — COPIA LITERAL (módulo puro, origen citado en cabecera)
// ─────────────────────────────────────────────────────────────────────────────

interface OpsDet { w: number; h: number; ratioW: number; ratioH: number; padTop: number; ratioWDet: number; ratioHDet: number }
interface Punto { x: number; y: number }
interface RectDB { cx: number; cy: number; w: number; h: number; theta: number }

function mapearAFuente(p: Punto, ops: OpsDet, srcW: number, srcH: number): Punto {
  const xPostPad = p.x / ops.ratioWDet;
  const yPostPad = p.y / ops.ratioHDet - ops.padTop;
  const x = xPostPad / ops.ratioW;
  const y = yPostPad / ops.ratioH;
  return { x: Math.max(0, Math.min(srcW, Math.round(x))), y: Math.max(0, Math.min(srcH, Math.round(y))) };
}

const DB_THRESH = 0.3;
const DB_BOX_THRESH = 0.5;
const DB_MAX_CANDIDATES = 1000;
const DB_UNCLIP_RATIO = 1.6;
const MIN_SIDE_DESCARTAR = 3;
const MIN_SIDE_TRAS_UNCLIP = 5;

function convexHull(pts: Punto[]): Punto[] {
  if (pts.length < 3) return pts.slice();
  const p = pts.slice().sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o: Punto, a: Punto, b: Punto) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Punto[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Punto[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function minAreaRect(hull: Punto[]): RectDB | null {
  if (hull.length < 2) return null;
  let mejor: RectDB | null = null;
  let mejorArea = Infinity;
  const n = hull.length;
  for (let i = 0; i < n; i++) {
    const p1 = hull[i];
    const p2 = hull[(i + 1) % n];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const ux = dx / len;
    const uy = dy / len;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const q of hull) {
      const u = q.x * ux + q.y * uy;
      const v = -q.x * uy + q.y * ux;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const w = maxU - minU;
    const h = maxV - minV;
    const area = w * h;
    if (area < mejorArea) {
      mejorArea = area;
      mejor = { cx: ((maxU + minU) / 2) * ux + ((maxV + minV) / 2) * -uy, cy: ((maxU + minU) / 2) * uy + ((maxV + minV) / 2) * ux, w, h, theta: Math.atan2(uy, ux) };
    }
  }
  return mejor;
}

function boxScoreFast(pred: Float32Array, w: number, h: number, box: Punto[]): number {
  let xmin = w - 1, xmax = 0, ymin = h - 1, ymax = 0;
  for (const q of box) {
    xmin = Math.max(0, Math.min(xmin, Math.floor(q.x)));
    xmax = Math.min(w - 1, Math.max(xmax, Math.ceil(q.x)));
    ymin = Math.max(0, Math.min(ymin, Math.floor(q.y)));
    ymax = Math.min(h - 1, Math.max(ymax, Math.ceil(q.y)));
  }
  if (xmax < xmin || ymax < ymin) return 0;
  let suma = 0, cuenta = 0;
  for (let y = ymin; y <= ymax; y++) {
    const xs: number[] = [];
    for (let i = 0; i < box.length; i++) {
      const a = box[i];
      const b = box[(i + 1) % box.length];
      if (a.y === b.y) continue;
      const yMin = Math.min(a.y, b.y);
      const yMax = Math.max(a.y, b.y);
      if (y + 0.5 >= yMin && y + 0.5 < yMax) xs.push(a.x + ((y + 0.5 - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(xmin, Math.ceil(xs[k] - 0.5));
      const x1 = Math.min(xmax, Math.floor(xs[k + 1] - 0.5));
      for (let x = x0; x <= x1; x++) {
        if (x >= xs[k] && x <= xs[k + 1]) { suma += pred[y * w + x]; cuenta++; }
      }
    }
  }
  return cuenta === 0 ? 0 : suma / cuenta;
}

function esquinasRect(r: RectDB): Punto[] {
  const cos = Math.cos(r.theta);
  const sin = Math.sin(r.theta);
  const nx = -sin;
  const ny = cos;
  const hw = r.w / 2;
  const hh = r.h / 2;
  const pts = [
    { x: r.cx + hw * cos + hh * nx, y: r.cy + hw * sin + hh * ny },
    { x: r.cx + hw * cos - hh * nx, y: r.cy + hw * sin - hh * ny },
    { x: r.cx - hw * cos + hh * nx, y: r.cy - hw * sin + hh * ny },
    { x: r.cx - hw * cos - hh * nx, y: r.cy - hw * sin - hh * ny },
  ];
  pts.sort((a, b) => a.x - b.x);
  let tl: Punto, bl: Punto, tr: Punto, br: Punto;
  if (pts[0].y <= pts[1].y) { tl = pts[0]; bl = pts[1]; } else { tl = pts[1]; bl = pts[0]; }
  if (pts[2].y <= pts[3].y) { tr = pts[2]; br = pts[3]; } else { tr = pts[3]; br = pts[2]; }
  return [tl, tr, br, bl];
}

function ordenarCajas(boxes: Punto[][]): Punto[][] {
  const sorted = boxes.slice().sort((a, b) => a[0].y - b[0].y || a[0].x - b[0].x);
  for (let i = 0; i < sorted.length - 1; i++) {
    for (let j = i; j >= 0; j--) {
      if (Math.abs(sorted[j + 1][0].y - sorted[j][0].y) < 10 && sorted[j + 1][0].x < sorted[j][0].x) {
        const tmp = sorted[j]; sorted[j] = sorted[j + 1]; sorted[j + 1] = tmp;
      } else break;
    }
  }
  return sorted;
}

function dbPostprocess(pred: Float32Array, pw: number, ph: number, ops: OpsDet, srcW: number, srcH: number): { boxesFuente: Punto[][]; nBoxes: number } {
  const bitmap = new Uint8Array(pw * ph);
  for (let i = 0; i < bitmap.length; i++) bitmap[i] = pred[i] > DB_THRESH ? 1 : 0;
  const dil = new Uint8Array(pw * ph);
  for (let y = 0; y < ph; y++) {
    const fila = y * pw;
    const filaPrev = Math.max(0, y - 1) * pw;
    for (let x = 0; x < pw; x++) {
      const xPrev = Math.max(0, x - 1);
      dil[fila + x] = Math.max(bitmap[fila + x], bitmap[filaPrev + x], bitmap[fila + xPrev], bitmap[filaPrev + xPrev]);
    }
  }
  const labels = new Int32Array(pw * ph);
  let nComp = 0;
  const rects: RectDB[] = [];
  const stack = new Int32Array(pw * ph);
  const coords: number[] = [];
  for (let y = 0; y < ph && nComp < DB_MAX_CANDIDATES; y++) {
    for (let x = 0; x < pw && nComp < DB_MAX_CANDIDATES; x++) {
      const idx = y * pw + x;
      if (dil[idx] === 0 || labels[idx] !== 0) continue;
      nComp++;
      let sp = 0;
      stack[sp++] = idx;
      labels[idx] = nComp;
      coords.length = 0;
      while (sp > 0) {
        const cur = stack[--sp];
        const cy = (cur / pw) | 0;
        const cx = cur - cy * pw;
        coords.push(cx, cy);
        if (cx > 0 && dil[cur - 1] === 1 && labels[cur - 1] === 0) { labels[cur - 1] = nComp; stack[sp++] = cur - 1; }
        if (cx < pw - 1 && dil[cur + 1] === 1 && labels[cur + 1] === 0) { labels[cur + 1] = nComp; stack[sp++] = cur + 1; }
        if (cy > 0 && dil[cur - pw] === 1 && labels[cur - pw] === 0) { labels[cur - pw] = nComp; stack[sp++] = cur - pw; }
        if (cy < ph - 1 && dil[cur + pw] === 1 && labels[cur + pw] === 0) { labels[cur + pw] = nComp; stack[sp++] = cur + pw; }
      }
      const nPx = coords.length / 2;
      if (nPx < 10) continue;
      const stride = nPx > 20000 ? Math.ceil(nPx / 20000) : 1;
      const pts: Punto[] = [];
      for (let k = 0; k < nPx; k += stride) pts.push({ x: coords[k * 2], y: coords[k * 2 + 1] });
      const hull = convexHull(pts);
      const rect = minAreaRect(hull);
      if (!rect) continue;
      const sside = Math.min(rect.w, rect.h);
      if (sside < MIN_SIDE_DESCARTAR) continue;
      const esq = esquinasRect(rect);
      const score = boxScoreFast(pred, pw, ph, esq);
      if (score < DB_BOX_THRESH) continue;
      const perim = 2 * (rect.w + rect.h);
      const dUnclip = (rect.w * rect.h * DB_UNCLIP_RATIO) / perim;
      const wU = rect.w + 2 * dUnclip;
      const hU = rect.h + 2 * dUnclip;
      if (Math.min(wU, hU) < MIN_SIDE_TRAS_UNCLIP) continue;
      rects.push({ cx: rect.cx, cy: rect.cy, w: wU, h: hU, theta: rect.theta });
    }
  }
  const boxesFuente = rects.map((r) => esquinasRect(r).map((p) => mapearAFuente(p, ops, srcW, srcH))).filter((b) => b.every((p) => p.x >= 0 && p.y >= 0));
  return { boxesFuente: ordenarCajas(boxesFuente), nBoxes: rects.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. RapidOCR-lite — port del pipeline (rapidocr.ts, secciones citadas)
// ─────────────────────────────────────────────────────────────────────────────

const TEXT_SCORE = 0.5; // rapidocr.ts L545
const DET_CAP_RAPIDO = 1280; // rapidocr.ts L470 (1.ª pasada del escalonado) — barridos §6

function preDet(src: HTMLCanvasElement, cap = DET_CAP_PROD): { canvas: HTMLCanvasElement; ops: OpsDet } {
  let w = src.width;
  let h = src.height;
  let ratioW = 1;
  let ratioH = 1;
  if (Math.max(h, w) > 1920) {
    const ratio = 1920 / Math.max(h, w);
    const nh = round32(Math.floor(h * ratio));
    const nw = round32(Math.floor(w * ratio));
    ratioW *= nw / w;
    ratioH *= nh / h;
    w = nw;
    h = nh;
  }
  if (Math.min(h, w) < 30) {
    const ratio = 30 / Math.min(h, w);
    const nh = round32(Math.floor(h * ratio));
    const nw = round32(Math.floor(w * ratio));
    ratioW *= nw / w;
    ratioH *= nh / h;
    w = nw;
    h = nh;
  }
  const imgEsc = canvasDe(src, w, h);
  let padTop = 0;
  let canvasPadded = imgEsc;
  const widthHeightRatio = 8;
  const minHeight = 30;
  if (h <= minHeight || w / h > widthHeightRatio) {
    const newH = Math.max(Math.floor(w / widthHeightRatio), minHeight) * 2;
    padTop = Math.floor(Math.abs(newH - h) / 2);
    const padded = canvasCon(w, h + padTop * 2);
    const pctx = ctxDe(padded);
    pctx.fillStyle = "#000000";
    pctx.fillRect(0, 0, padded.width, padded.height);
    pctx.drawImage(imgEsc, 0, padTop);
    canvasPadded = padded;
    h = padded.height;
  }
  const ratioDet = Math.max(h, w) > cap ? cap / Math.max(h, w) : 1;
  const dh = round32(Math.floor(h * ratioDet));
  const dw = round32(Math.floor(w * ratioDet));
  const detIn = canvasDe(canvasPadded, dw, dh);
  return { canvas: detIn, ops: { w: dw, h: dh, ratioW, ratioH, padTop, ratioWDet: dw / w, ratioHDet: dh / h } };
}

function medidasDeCaja(box: Punto[]): { w: number; h: number } {
  // crop-geometria.ts: anchura = arista superior, altura = arista izquierda
  const w = Math.hypot(box[1].x - box[0].x, box[1].y - box[0].y);
  const h = Math.hypot(box[3].x - box[0].x, box[3].y - box[0].y);
  return { w, h };
}

function cropQuad(src: HTMLCanvasElement, box: Punto[]): { canvas: HTMLCanvasElement; ratio: number } {
  const [p0, p1] = box;
  const { w, h } = medidasDeCaja(box);
  const cropW = Math.max(1, Math.round(w));
  const cropH = Math.max(1, Math.round(h));
  const theta = Math.atan2(p1.y - p0.y, p1.x - p0.x);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const canvas = canvasCon(cropW, cropH);
  const ctx = ctxDe(canvas);
  const e = -cos * p0.x - sin * p0.y;
  const f = sin * p0.x - cos * p0.y;
  ctx.setTransform(cos, -sin, sin, cos, e, f);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(src, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return { canvas, ratio: cropW / cropH };
}

function tensorDeCanvases(ort: OrtModule, canvases: HTMLCanvasElement[], targetW: number, h: number): OrtValue {
  const b = canvases.length;
  const data = new Float32Array(b * 3 * h * targetW);
  for (let i = 0; i < b; i++) {
    const c = canvases[i];
    const cw = c.width;
    const ch = c.height;
    const rw = Math.min(Math.max(1, Math.ceil((h * cw) / ch)), targetW);
    const base = i * 3 * h * targetW;
    const paso = h * targetW;
    const ctx = ctxDe(c);
    const img = ctx.getImageData(0, 0, cw, ch);
    for (let y = 0; y < h; y++) {
      const sy = Math.min(ch - 1, Math.floor((y * ch) / h));
      for (let x = 0; x < rw; x++) {
        const sx = Math.min(cw - 1, Math.floor((x * cw) / rw));
        const idx = (sy * cw + sx) * 4;
        const o = base + y * targetW + x;
        data[o] = (img.data[idx + 2] / 255 - 0.5) / 0.5;
        data[o + paso] = (img.data[idx + 1] / 255 - 0.5) / 0.5;
        data[o + 2 * paso] = (img.data[idx] / 255 - 0.5) / 0.5;
      }
    }
  }
  return new ort.Tensor("float32", data, [b, 3, h, targetW]);
}

function softmax2(a: number, b: number): [number, number] {
  const m = Math.max(a, b);
  const ea = Math.exp(a - m);
  const eb = Math.exp(b - m);
  return [ea / (ea + eb), eb / (ea + eb)];
}

function ctcDecode(tensor: OrtValue, dict: string[]): { texto: string; conf: number } {
  const dims = tensor.dims;
  const T = dims[1];
  const C = dims[2];
  const data = tensor.data as Float32Array;
  let texto = "";
  let sumaConf = 0;
  let cuenta = 0;
  let ultimo = -1;
  for (let t = 0; t < T; t++) {
    const base = t * C;
    let mejor = 0;
    let mejorV = -Infinity;
    for (let c = 0; c < C; c++) {
      const v = data[base + c];
      if (v > mejorV) { mejorV = v; mejor = c; }
    }
    if (mejor !== 0 && mejor !== ultimo) {
      const prob = mejorV;
      if (mejor <= dict.length) texto += dict[mejor - 1];
      else texto += " ";
      sumaConf += prob;
      cuenta++;
    }
    ultimo = mejor;
  }
  return { texto, conf: cuenta === 0 ? 0 : sumaConf / cuenta };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Motores: ORT/RapidOCR, Tesseract, ZXing
// ─────────────────────────────────────────────────────────────────────────────

type OrtModule = typeof import("onnxruntime-web/wasm");
interface OrtValue { readonly dims: readonly number[]; data: Float32Array }
interface RapidLinea { texto: string; conf: number; box: Punto[] }
interface RapidResultado { lineas: RapidLinea[]; texto: string; confMedia: number; msDet: number; msCls: number; msRec: number; nBoxes: number }

let ortGlobal: OrtModule | null = null;
interface RapidRuntime { det: OrtSession; cls: OrtSession; rec: OrtSession; dict: string[]; ort: OrtModule }
interface OrtSession { run(feeds: Record<string, OrtValue>): Promise<Record<string, OrtValue>>; inputNames: readonly string[]; outputNames: readonly string[] }
let rtRapid: RapidRuntime | null = null;
let rapidFrio = true;

async function rapidInit(): Promise<void> {
  if (rtRapid) return;
  const ort = (await import("onnxruntime-web/wasm")) as OrtModule;
  ortGlobal = ort;
  ort.env.wasm.wasmPaths = `${BASE}/vendor/onnxruntime/`;
  ort.env.wasm.numThreads = Math.min(2, navigator.hardwareConcurrency || 1); // sandbox 4 GB: 4 hilos OOM
  ort.env.wasm.simd = true;
  const opts = { executionProviders: ["wasm"] as const };
  const base = `${BASE}/models/rapidocr`;
  const [det, cls, rec, dictResp] = await Promise.all([
    ort.InferenceSession.create(`${base}/ch_PP-OCRv4_det_infer.onnx`, opts),
    ort.InferenceSession.create(`${base}/ch_ppocr_mobile_v2.0_cls_infer.onnx`, opts),
    ort.InferenceSession.create(`${base}/ch_PP-OCRv4_rec_infer.onnx`, opts),
    fetch(`${base}/ppocr_keys.txt`),
  ]);
  // ⚠️ CRLF trap documentado en rapidocr.ts (initReal): filtrar líneas vacías
  const dict = (await dictResp.text()).split(/\r?\n/).filter((l) => l.length > 0);
  rtRapid = { det: det as unknown as OrtSession, cls: cls as unknown as OrtSession, rec: rec as unknown as OrtSession, dict, ort };
}

async function inferDet(rt: NonNullable<typeof rtRapid>, src: HTMLCanvasElement, cap: number): Promise<{ boxesFuente: Punto[][]; msDet: number; nBoxes: number }> {
  const t0 = performance.now();
  const { canvas, ops } = preDet(src, cap);
  const ctx = ctxDe(canvas);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const w = canvas.width;
  const h = canvas.height;
  const data = new Float32Array(w * h * 3);
  for (let px = 0, i = 0; px < w * h; px++, i += 4) {
    data[px] = (img.data[i + 2] / 255 - 0.5) / 0.5;
    data[w * h + px] = (img.data[i + 1] / 255 - 0.5) / 0.5;
    data[2 * w * h + px] = (img.data[i] / 255 - 0.5) / 0.5;
  }
  const tensor = new rt.ort.Tensor("float32", data, [1, 3, h, w]);
  const res = await rt.det.run({ [rt.det.inputNames[0]]: tensor });
  const out = res[rt.det.outputNames[0]];
  const ph = out.dims[2];
  const pw = out.dims[3];
  const post = dbPostprocess(out.data as Float32Array, pw, ph, ops, src.width, src.height);
  return { boxesFuente: post.boxesFuente, msDet: performance.now() - t0, nBoxes: post.nBoxes };
}

const RECO_KNOBS = { anchoMax: 480, alto: 40, lote: 6 }; // recKnobs() defaults (plan.ts)

async function rapidReconocer(canvas: HTMLCanvasElement, opts?: { omitirCls?: boolean; detCap?: number }): Promise<RapidResultado> {
  const rt = rtRapid!;
  const tTotal = performance.now();
  const { boxesFuente, msDet, nBoxes } = await inferDet(rt, canvas, opts?.detCap ?? DET_CAP_PROD);
  if (boxesFuente.length === 0) {
    return { lineas: [], texto: "", confMedia: 0, msDet, msCls: 0, msRec: 0, nBoxes: 0 };
  }
  const porY = boxesFuente.map((b, i) => {
    const { w, h } = medidasDeCaja(b);
    return { i, ratio: w / Math.max(1, h), y: b.reduce((s, p) => s + p.y, 0) / b.length };
  });
  const lienzoBruto = new Map<number, HTMLCanvasElement>();
  const lienzoDe = (i: number): HTMLCanvasElement => {
    let c = lienzoBruto.get(i);
    if (!c) { c = cropQuad(canvas, boxesFuente[i]).canvas; lienzoBruto.set(i, c); }
    return c;
  };
  const rotacion = new Array<boolean>(boxesFuente.length).fill(false);
  // cls por lote de 6 (rapidocr.ts L985-1009)
  let msCls = 0;
  if (!opts?.omitirCls) {
    for (let i = 0; i < porY.length; i += 6) {
      const lote = porY.slice(i, i + 6);
      const tLote = performance.now();
      const tensors = lote.map((o) => {
        const cv = lienzoDe(o.i);
        const ratio = cv.width / cv.height;
        const wObj = Math.min(192, Math.max(1, Math.ceil(48 * ratio)));
        const tmp = canvasCon(wObj, 48);
        ctxDe(tmp).drawImage(cv, 0, 0, wObj, 48);
        return tmp;
      });
      const tensor = tensorDeCanvases(rt.ort, tensors, 192, 48);
      const res = await rt.cls.run({ [rt.cls.inputNames[0]]: tensor });
      const out = res[rt.cls.outputNames[0]];
      const data = out.data as Float32Array;
      for (let k = 0; k < lote.length; k++) {
        const [p0, p180] = out.dims[1] === 2 ? softmax2(data[k * 2], data[k * 2 + 1]) : [1, 0];
        if (p180 > 0.9 && p180 > p0) rotacion[lote[k].i] = true;
      }
      msCls += performance.now() - tLote;
    }
  }
  // rec por lotes (rapidocr.ts L1031-1040)
  let msRec = 0;
  const lineas: RapidLinea[] = new Array(boxesFuente.length);
  const orden = [...porY].sort((a, b) => a.ratio - b.ratio);
  for (let k = 0; k < orden.length; k += RECO_KNOBS.lote) {
    const lote = orden.slice(k, k + RECO_KNOBS.lote);
    const maxRatio = Math.max(320 / RECO_KNOBS.alto, ...lote.map((o) => o.ratio));
    const targetW = Math.min(RECO_KNOBS.anchoMax, Math.floor(RECO_KNOBS.alto * maxRatio));
    const canvases = lote.map((o) => {
      const bruto = lienzoDe(o.i);
      if (!rotacion[o.i]) return bruto;
      const tmp = canvasCon(bruto.width, bruto.height);
      const ctx = ctxDe(tmp);
      ctx.translate(bruto.width, bruto.height);
      ctx.rotate(Math.PI);
      ctx.drawImage(bruto, 0, 0);
      return tmp;
    });
    const tLote = performance.now();
    const tensor = tensorDeCanvases(rt.ort, canvases, targetW, RECO_KNOBS.alto);
    const res = await rt.rec.run({ [rt.rec.inputNames[0]]: tensor });
    const out = res[rt.rec.outputNames[0]];
    // decode POR ITEM: el output ONNX del rec es [b, T, C]; decodifico por slice b.
    const data = out.data as Float32Array;
    const T = out.dims[1];
    const C = out.dims[2];
    for (let j = 0; j < lote.length; j++) {
      const i = lote[j].i;
      const slice = new Float32Array(data.buffer, j * T * C * 4, T * C);
      const { texto, conf } = ctcDecode({ dims: [1, T, C], data: slice }, rt.dict);
      const limpio = texto.trim();
      lineas[i] = { texto: limpio, conf, box: boxesFuente[i] };
    }
    msRec += performance.now() - tLote;
  }
  const leibles = lineas.filter((l) => l && l.texto.length > 0 && l.conf >= TEXT_SCORE);
  const texto = leibles.map((l) => l.texto).join("\n");
  const confMedia = leibles.length ? leibles.reduce((s, l) => s + l.conf, 0) / leibles.length : 0;
  return { lineas: leibles, texto, confMedia, msDet, msCls, msRec, nBoxes };
}

// rec sobre UN recorte (M1-rapid): rec directo sin det (rapidocr rec-only)
async function rapidRecCrop(crop: HTMLCanvasElement): Promise<{ texto: string; conf: number; ms: number }> {
  const rt = rtRapid!;
  const t0 = performance.now();
  const ratio = crop.width / Math.max(1, crop.height);
  const maxRatio = Math.max(320 / RECO_KNOBS.alto, ratio);
  const targetW = Math.min(RECO_KNOBS.anchoMax, Math.floor(RECO_KNOBS.alto * maxRatio));
  const tensor = tensorDeCanvases(rt.ort, [crop], targetW, RECO_KNOBS.alto);
  const res = await rt.rec.run({ [rt.rec.inputNames[0]]: tensor });
  const out = res[rt.rec.outputNames[0]];
  const { texto, conf } = ctcDecode(out, rt.dict);
  return { texto: texto.trim(), conf, ms: performance.now() - t0 };
}

// ─── Tesseract.js 7 ─────────────────────────────────────────────────────────

import { createWorker, PSM } from "tesseract.js";
type TessWorker = Awaited<ReturnType<typeof createWorker>>;

const tessWorkers: Record<string, TessWorker> = {};
const tessFrio: Record<string, boolean> = { fast: true, best: true };

// probe SIMD128 de ocr-core-resolver.ts (molde-studio): el corePath debe ser
// el ARCHIVO EXACTO — si es un directorio, tesseract.js v7 sondea
// relaxedsimd (no hospedado: abort «missing function: DotProductSSE»).
const SIMD128_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 15, 1, 13, 0, 65, 1, 253, 15, 65, 2, 253, 15, 253, 128, 2, 11]);
function coreArchivo(): string {
  const variante = WebAssembly.validate(SIMD128_PROBE) ? "tesseract-core-simd-lstm.wasm.js" : "tesseract-core-lstm.wasm.js";
  return `${BASE}/vendor/tesseract/${variante}`;
}

async function tessInit(variante: "fast" | "best"): Promise<TessWorker> {
  if (tessWorkers[variante]) return tessWorkers[variante];
  const langPath = `${BASE}/models/tess/4.0.0_${variante}`;
  const worker = await createWorker("spa", 1, {
    workerPath: `${BASE}/vendor/tesseract/worker.min.js`,
    corePath: coreArchivo(),
    langPath,
    logger: () => {},
  });
  await worker.setParameters({ preserve_interword_spaces: "1" });
  tessWorkers[variante] = worker;
  return worker;
}

interface TessPalabra { texto: string; x0: number; y0: number; x1: number; y1: number; conf: number }
interface TessResultado { texto: string; conf: number; palabras: TessPalabra[]; ms: number }

async function tessReconocer(worker: TessWorker, img: HTMLCanvasElement, variante: string, psm = "3", whitelist?: string): Promise<TessResultado> {
  const t0 = performance.now();
  await worker.setParameters({ tessedit_pageseg_mode: psm as PSM, ...(whitelist ? { tessedit_char_whitelist: whitelist } : {}) });
  const { data } = await worker.recognize(img, {}, { text: true, blocks: true });
  const palabras: TessPalabra[] = [];
  for (const bloque of data.blocks ?? []) {
    for (const par of bloque.paragraphs ?? []) {
      for (const linea of par.lines ?? []) {
        for (const p of linea.words ?? []) {
          palabras.push({ texto: p.text ?? "", x0: p.bbox.x0, y0: p.bbox.y0, x1: p.bbox.x1, y1: p.bbox.y1, conf: p.confidence ?? 0 });
        }
      }
    }
  }
  const ms = performance.now() - t0;
  tessFrio[variante] = false;
  return { texto: data.text ?? "", conf: data.confidence ?? 0, palabras, ms };
}

// ─── ZXing (línea base códigos 1D/QR, plan §6) ──────────────────────────────

async function zxingLeer(canvas: HTMLCanvasElement): Promise<{ formato: string; texto: string; ms: number } | null> {
  const t0 = performance.now();
  try {
    const ZX = await import("@zxing/library");
    const reader = new ZX.MultiFormatReader();
    const hints = new Map();
    hints.set(ZX.DecodeHintType.TRY_HARDER, true);
    reader.setHints(hints);
    const src = new ZX.HTMLCanvasElementLuminanceSource(canvas);
    const bmp = new ZX.BinaryBitmap(new ZX.HybridBinarizer(src));
    try {
      const res = reader.decode(bmp);
      return { formato: ZX.BarcodeFormat[res.getBarcodeFormat()], texto: res.getText(), ms: performance.now() - t0 };
    } catch {
      // segunda opinión: luminancia invertida (códigos claros sobre oscuro)
      src.invert();
      const bmp2 = new ZX.BinaryBitmap(new ZX.HybridBinarizer(src));
      const res = reader.decode(bmp2);
      return { formato: ZX.BarcodeFormat[res.getBarcodeFormat()], texto: res.getText(), ms: performance.now() - t0 };
    }
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Filtros (plan §6): original, grises, B/N Otsu, gris+CLAHE
// ─────────────────────────────────────────────────────────────────────────────

function filtroGris(c: HTMLCanvasElement): HTMLCanvasElement {
  const out = canvasCon(c.width, c.height);
  const octx = ctxDe(out);
  octx.drawImage(c, 0, 0);
  const img = octx.getImageData(0, 0, out.width, out.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  octx.putImageData(img, 0, 0);
  return out;
}

function umbralOtsu(gray: Uint8Array): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let suma = 0;
  for (let t = 0; t < 256; t++) suma += t * hist[t];
  let sumaB = 0, wB = 0, mejor = 0, varMax = 0;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumaB += t * hist[t];
    const mB = sumaB / wB;
    const mF = (suma - sumaB) / wF;
    const varEntre = wB * wF * (mB - mF) * (mB - mF);
    if (varEntre > varMax) { varMax = varEntre; mejor = t; }
  }
  return mejor;
}

function filtroOtsu(c: HTMLCanvasElement): HTMLCanvasElement {
  const g = filtroGris(c);
  const ctx = ctxDe(g);
  const img = ctx.getImageData(0, 0, g.width, g.height);
  const d = img.data;
  const gray = new Uint8Array(g.width * g.height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) gray[i] = d[p];
  const t = umbralOtsu(gray);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    const v = gray[i] <= t ? 0 : 255;
    d[p] = d[p + 1] = d[p + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return g;
}

function claheGray(gray: Uint8Array, w: number, h: number, tiles = 8, clipLimit = 2.0): Uint8Array {
  // CLAHE compacto: histogramas por tile con recorte + distribución bilinear
  const tw = Math.ceil(w / tiles);
  const th = Math.ceil(h / tiles);
  const maps: Uint8Array[] = [];
  const tileArea = tw * th;
  const clipCount = Math.max(1, Math.floor((clipLimit * tileArea) / 256));
  for (let ty = 0; ty < tiles; ty++) {
    for (let tx = 0; tx < tiles; tx++) {
      const hist = new Float64Array(256);
      const y0 = ty * th;
      const x0 = tx * tw;
      const y1 = Math.min(h, y0 + th);
      const x1 = Math.min(w, x0 + tw);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) hist[gray[y * w + x]]++;
      let exceso = 0;
      for (let i = 0; i < 256; i++) if (hist[i] > clipCount) { exceso += hist[i] - clipCount; hist[i] = clipCount; }
      const reparto = exceso / 256;
      const cdf = new Uint8Array(256);
      let acc = 0;
      const n = Math.max(1, (x1 - x0) * (y1 - y0));
      for (let i = 0; i < 256; i++) {
        acc += hist[i] + reparto;
        cdf[i] = Math.min(255, Math.round((acc * 255) / n));
      }
      maps.push(cdf);
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(tiles - 1, y / th);
    const ty0 = Math.floor(fy);
    const ty1 = Math.min(tiles - 1, ty0 + 1);
    const wy = fy - ty0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(tiles - 1, x / tw);
      const tx0 = Math.floor(fx);
      const tx1 = Math.min(tiles - 1, tx0 + 1);
      const wx = fx - tx0;
      const v = gray[y * w + x];
      const a = maps[ty0 * tiles + tx0][v];
      const b = maps[ty0 * tiles + tx1][v];
      const c2 = maps[ty1 * tiles + tx0][v];
      const d2 = maps[ty1 * tiles + tx1][v];
      out[y * w + x] = (a * (1 - wx) * (1 - wy) + b * wx * (1 - wy) + c2 * (1 - wx) * wy + d2 * wx * wy) | 0;
    }
  }
  return out;
}

function filtroClahe(c: HTMLCanvasElement): HTMLCanvasElement {
  const g = filtroGris(c);
  const ctx = ctxDe(g);
  const img = ctx.getImageData(0, 0, g.width, g.height);
  const d = img.data;
  const gray = new Uint8Array(g.width * g.height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) gray[i] = d[p];
  const eq = claheGray(gray, g.width, g.height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    d[p] = d[p + 1] = d[p + 2] = eq[i];
  }
  ctx.putImageData(img, 0, 0);
  return g;
}

function aplicarFiltro(c: HTMLCanvasElement, filtro: string): HTMLCanvasElement {
  switch (filtro) {
    case "gris": return filtroGris(c);
    case "otsu": return filtroOtsu(c);
    case "clahe": return filtroClahe(c);
    default: return c;
  }
}

// Calidad: reescalado + re-encode JPEG (plan §6). q=null = bytes originales.
async function prepararImagen(ruta: string, wObjetivo?: number, q?: number): Promise<HTMLCanvasElement> {
  const bmp = await fetchBitmap(`${FIXTURES}/${ruta}`);
  let escala = 1;
  if (wObjetivo && bmp.width > wObjetivo) escala = wObjetivo / bmp.width;
  const c = canvasCon(Math.round(bmp.width * escala), Math.round(bmp.height * escala));
  const ctx = ctxDe(c);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  if (q != null) {
    // re-encode JPEG a calidad q y re-decode (efecto compresión real)
    const dataUrl = c.toDataURL("image/jpeg", q / 100);
    const bmp2 = await fetchBitmap(dataUrl);
    const c2 = canvasCon(bmp2.width, bmp2.height);
    ctxDe(c2).drawImage(bmp2, 0, 0);
    bmp2.close();
    return c2;
  }
  return c;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Medición de tinta (S6) — port imageproc.ts + medirTinta (universal-engine)
// ─────────────────────────────────────────────────────────────────────────────

interface BinImage { w: number; h: number; data: Uint8Array }
interface CompStats { x: number; y: number; w: number; h: number; area: number }

function grayFromImageData(img: ImageData): Uint8Array {
  const { width: w, height: h, data } = img;
  const g = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) | 0;
  return g;
}

function gaussianBlurReplicate(src: Float32Array, w: number, h: number, kernel: Float32Array): Float32Array {
  const r = (kernel.length - 1) >> 1;
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) { const xx = Math.min(w - 1, Math.max(0, x + k)); acc += src[row + xx] * kernel[k + r]; }
      tmp[row + x] = acc;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) { const yy = Math.min(h - 1, Math.max(0, y + k)); acc += tmp[yy * w + x] * kernel[k + r]; }
      out[y * w + x] = acc;
    }
  }
  return out;
}

function gaussianKernel(blockSize: number): Float32Array {
  const sigma = 0.3 * ((blockSize - 1) * 0.5 - 1) + 0.8;
  const r = (blockSize - 1) >> 1;
  const k = new Float32Array(blockSize);
  let sum = 0;
  for (let i = 0; i < blockSize; i++) { const v = Math.exp(-((i - r) * (i - r)) / (2 * sigma * sigma)); k[i] = v; sum += v; }
  for (let i = 0; i < blockSize; i++) k[i] /= sum;
  return k;
}

function adaptiveThresholdInv(gray: Uint8Array, w: number, h: number, blockSize = 31, C = 12): BinImage {
  const f = new Float32Array(gray.length);
  for (let i = 0; i < gray.length; i++) f[i] = gray[i];
  const kernel = gaussianKernel(blockSize);
  const b = gaussianBlurReplicate(f, w, h, kernel);
  const out = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) out[i] = gray[i] <= Math.round(b[i]) - C ? 1 : 0;
  return { w, h, data: out };
}

function opening1D(bin: BinImage, k: number, dir: "h" | "v"): Uint8Array {
  const { w, h, data } = bin;
  const out = new Uint8Array(w * h);
  const n = dir === "h" ? w : h;
  const lines = dir === "h" ? h : w;
  const r = (k - 1) >> 1;
  const idx = dir === "h" ? (i: number, j: number) => i * w + j : (i: number, j: number) => j * w + i;
  const deque = new Int32Array(n + 1);
  const eros = new Uint8Array(n);
  const dil = new Uint8Array(n);
  for (let i = 0; i < lines; i++) {
    let head = 0;
    let tail = 0;
    const pushEros = (j: number) => {
      const v = data[idx(i, j)];
      while (tail > head && data[idx(i, deque[tail - 1])] >= v) tail--;
      deque[tail++] = j;
    };
    for (let x = 0; x <= Math.min(r, n - 1); x++) pushEros(x);
    for (let j = 0; j < n; j++) {
      if (j > 0 && j + r <= n - 1) pushEros(j + r);
      while (deque[head] < j - r) head++;
      eros[j] = data[idx(i, deque[head])];
    }
    head = 0;
    tail = 0;
    const pushDil = (j: number) => {
      const v = eros[j];
      while (tail > head && eros[deque[tail - 1]] <= v) tail--;
      deque[tail++] = j;
    };
    for (let x = 0; x <= Math.min(r, n - 1); x++) pushDil(x);
    for (let j = 0; j < n; j++) {
      if (j > 0 && j + r <= n - 1) pushDil(j + r);
      while (deque[head] < j - r) head++;
      dil[j] = eros[deque[head]];
    }
    if (dir === "h") out.set(dil, i * w);
    else for (let j = 0; j < n; j++) out[j * w + i] = dil[j];
  }
  return out;
}

function binarizeNoLines(gray: Uint8Array, w: number, h: number, kernelLineaFrac = 0.083): BinImage {
  const bin = adaptiveThresholdInv(gray, w, h, 31, 12);
  const k = Math.max(20, Math.floor(w * kernelLineaFrac)) | 1;
  const hor = opening1D(bin, k, "h");
  const ver = opening1D(bin, k, "v");
  const data = new Uint8Array(w * h);
  for (let i = 0; i < data.length; i++) data[i] = bin.data[i] && !(hor[i] || ver[i]) ? 1 : 0;
  return { w, h, data };
}

function connectedComponents(bin: Uint8Array, w: number, h: number): { labels: Int32Array; stats: CompStats[] } {
  const labels = new Int32Array(w * h).fill(-1);
  const stats: CompStats[] = [];
  const stack = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (bin[start] === 0 || labels[start] !== -1) continue;
    const id = stats.length;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = id;
    let minX = w, maxX = -1, minY = h, maxY = -1, area = 0;
    while (sp > 0) {
      const p = stack[--sp];
      const px = p % w;
      const py = (p / w) | 0;
      area++;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      const y0 = Math.max(0, py - 1);
      const y1 = Math.min(h - 1, py + 1);
      const x0 = Math.max(0, px - 1);
      const x1 = Math.min(w - 1, px + 1);
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          const q = yy * w + xx;
          if (bin[q] === 1 && labels[q] === -1) { labels[q] = id; stack[sp++] = q; }
        }
      }
    }
    stats.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, area });
  }
  return { labels, stats };
}

interface FiltroLinea { fraccion_ancho: number; grosor_max: number }

function inkRatio(bin: BinImage, zone: [number, number, number, number], filtro?: FiltroLinea): number {
  const { w: W } = bin;
  const [zx0, zy0, zx1, zy1] = zone;
  const x0 = Math.max(0, Math.floor(zx0));
  const y0 = Math.max(0, Math.floor(zy0));
  const x1 = Math.min(bin.w, Math.ceil(zx1));
  const y1 = Math.min(bin.h, Math.ceil(zy1));
  const zw = x1 - x0;
  const zh = y1 - y0;
  if (zw <= 0 || zh <= 0) return 0;
  const crop = new Uint8Array(zw * zh);
  for (let y = 0; y < zh; y++) for (let x = 0; x < zw; x++) crop[y * zw + x] = bin.data[(y0 + y) * W + x0 + x];
  if (filtro) {
    const { labels, stats } = connectedComponents(crop, zw, zh);
    for (let i = 0; i < stats.length; i++) {
      const s = stats[i];
      if (s.w >= filtro.fraccion_ancho * zw && s.area <= filtro.grosor_max * s.w) {
        for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) if (labels[y * zw + x] === i) crop[y * zw + x] = 0;
      }
    }
  }
  let ink = 0;
  let minX = zw, maxX = -1, minY = zh, maxY = -1;
  for (let y = 0; y < zh; y++) {
    for (let x = 0; x < zw; x++) {
      if (crop[y * zw + x] === 1) {
        ink++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  inkRatioUltimoBbox = ink > 0 ? { x: minX / zw, y: minY / zh, w: (maxX - minX + 1) / zw, h: (maxY - minY + 1) / zh } : null;
  return ink / crop.length;
}

let inkRatioUltimoBbox: { x: number; y: number; w: number; h: number } | null = null;

// medirTinta (universal-engine L1089): binarizeNoLines + inkRatio con filtro
function medirTinta(crop: HTMLCanvasElement): { ratio: number; bbox: { x: number; y: number; w: number; h: number } | null } {
  const gray = grayFromImageData(ctxDe(crop).getImageData(0, 0, crop.width, crop.height));
  const bin = binarizeNoLines(gray, crop.width, crop.height, 0.083);
  const ratio = inkRatio(bin, [0, 0, crop.width, crop.height], { fraccion_ancho: 0.5, grosor_max: 6 });
  return { ratio, bbox: inkRatioUltimoBbox };
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Motor de moldes: ancla fuzzy + ancla_relativa (M1/M3) — fórmula
//    resolverRectCampo (universal-engine L913-993): zona RELATIVA AL HIT
// ─────────────────────────────────────────────────────────────────────────────

interface Token { texto: string; cx: number; cy: number; x0: number; y0: number; x1: number; y1: number }

function tokensDeRapid(lineas: RapidLinea[], W: number, H: number): Token[] {
  const tokens: Token[] = [];
  for (const l of lineas) {
    const xs = l.box.map((p) => p.x);
    const ys = l.box.map((p) => p.y);
    const bx0 = Math.min(...xs) / W, bx1 = Math.max(...xs) / W;
    const by0 = Math.min(...ys) / H, by1 = Math.max(...ys) / H;
    const ancho = (bx1 - bx0) / Math.max(1, l.texto.length);
    let cursor = bx0;
    // sub-tokens por frontera no-alfanumérica: RapidOCR suelda etiqueta+valor
    // ("Fecha:02 defebrero de2026") — sin este corte, el matcher por ventanas
    // no halla el ancla "Fecha" dentro del token pegado
    const partes = l.texto.split(/[^\w\u00c0-\u017f]+/).filter((s) => s.length > 0);
    for (const parte of partes) {
      const desplazamiento = l.texto.indexOf(parte, cursor > bx0 ? Math.round(((cursor - bx0) / (ancho || 1)) * 0) : 0);
      const idxChar = desplazamiento >= 0 ? desplazamiento : Math.round((cursor - bx0) / (ancho || 1));
      const wTok = Math.max(bx1 - bx0, ancho * parte.length);
      const x0 = Math.min(bx1, bx0 + idxChar * ancho);
      tokens.push({ texto: parte, x0, x1: x0 + wTok, y0: by0, y1: by1, cx: x0 + wTok / 2, cy: (by0 + by1) / 2 });
      cursor = x0 + wTok;
    }
  }
  return tokens;
}

function tokensDeTess(palabras: TessPalabra[], W: number, H: number): Token[] {
  return palabras
    .filter((p) => p.texto.trim().length > 0)
    .map((p) => ({
      texto: p.texto.trim(),
      x0: p.x0 / W, x1: p.x1 / W, y0: p.y0 / H, y1: p.y1 / H,
      cx: ((p.x0 + p.x1) / 2) / W, cy: ((p.y0 + p.y1) / 2) / H,
    }));
}

const ANCLA_SCORE_MIN = 0.72; // universal-engine

function lineasNormDe(lineas: RapidLinea[], W: number, H: number): { texto: string; rect: RectNorm }[] {
  return lineas.map((l) => {
    const xs = l.box.map((p) => p.x);
    const ys = l.box.map((p) => p.y);
    const x0 = Math.min(...xs) / W, x1 = Math.max(...xs) / W;
    const y0 = Math.min(...ys) / H, y1 = Math.max(...ys) / H;
    return { texto: l.texto, rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
  });
}

function buscarAncla(textoAncla: string, tokens: Token[], rectRef: { x: number; y: number; w: number; h: number } | null, lineas?: { texto: string; rect: RectNorm }[]): { score: number; rect: { x: number; y: number; w: number; h: number } } | null {
  if (typeof textoAncla !== "string") return null; // campo sin ancla textual usable (ej. ancla_relacional/grupos: fuera del arnés)
  const target = norm(textoAncla);
  if (target.length < 2) return null;
  const targetTokens = target.split(" ");
  type Hit = { score: number; rect: RectNorm };
  let mejor: Hit | null = null;
  const refCx = rectRef ? rectRef.x + rectRef.w / 2 : 0.5;
  const refCy = rectRef ? rectRef.y + rectRef.h / 2 : 0.5;
  const considerar = (score: number, rect: RectNorm): void => {
    if (mejor === null || score > mejor.score) mejor = { score, rect };
  };
  // PASO 1 — contención por línea completa (el texto del ancla aparece DENTRO
  // de la línea OCR; tolera etiquetas sueldas con el valor)
  if (lineas) {
    for (const l of lineas) {
      const nL = norm(l.texto);
      if (nL.length < 2) continue;
      if (nL.includes(target)) {
        const cx = l.rect.x + l.rect.w / 2;
        const cy = l.rect.y + l.rect.h / 2;
        const penal = 1 / (1 + 3 * (Math.abs(cx - refCx) + Math.abs(cy - refCy)));
        considerar(penal, l.rect);
      }
    }
  }
  // PASO 2 — ventanas de sub-tokens con fuzzy (edit distance, umbral 0.72)
  for (let m = Math.max(1, targetTokens.length - 1); m <= targetTokens.length + 1; m++) {
    for (let i = 0; i + m <= tokens.length; i++) {
      const ventana = tokens.slice(i, i + m);
      const cand = norm(ventana.map((t) => t.texto).join(" "));
      if (cand.length < 2) continue;
      const dist = levenshtein(cand, target);
      const score0 = 1 - dist / Math.max(cand.length, target.length);
      if (score0 < 0.55) continue;
      const cx = ventana.reduce((s, t) => s + t.cx, 0) / m;
      const cy = ventana.reduce((s, t) => s + t.cy, 0) / m;
      const penal = 1 / (1 + 3 * (Math.abs(cx - refCx) + Math.abs(cy - refCy)));
      considerar(score0 * penal, {
        x: Math.min(...ventana.map((t) => t.x0)),
        y: Math.min(...ventana.map((t) => t.y0)),
        w: Math.max(...ventana.map((t) => t.x1)) - Math.min(...ventana.map((t) => t.x0)),
        h: Math.max(...ventana.map((t) => t.y1)) - Math.min(...ventana.map((t) => t.y0)),
      });
    }
  }
  const hitFinal = mejor as Hit | null;
  if (hitFinal && hitFinal.score >= ANCLA_SCORE_MIN) return hitFinal;
  return null;
}

interface RectNorm { x: number; y: number; w: number; h: number }

function resolverZona(campo: MoldeCampo, base: RectNorm): RectNorm {
  // universal-engine L925-930: x = x_absoluto ? zona.x : base.x + zona.x
  const zona = campo.zona!;
  let x = campo.x_absoluto ? zona.x : base.x + zona.x;
  let y = base.y + zona.y;
  const w = Math.max(0.01, zona.w);
  const h = Math.max(0.005, zona.h);
  x = Math.min(1 - w, Math.max(-0.02, x));
  y = Math.min(1 - h, Math.max(-0.02, y));
  return { x: Math.max(0, x), y: Math.max(0, y), w, h };
}

interface MoldeCampo {
  id: string;
  etiqueta?: string;
  pagina?: number;
  tipo?: string;
  htr?: boolean;
  estrategia?: string;
  zona?: RectNorm;
  x_absoluto?: boolean;
  umbral?: number;
  obligatorio?: boolean;
  ancla?: { texto: string; rect?: RectNorm };
  ancla_respaldo?: { texto: string; rect?: RectNorm };
  patron?: string;
  whitelist?: string;
  realce?: boolean;
  nota?: string;
}
interface Molde { tipo?: string; version?: string; nombre?: string; campos: MoldeCampo[] }

function esManuscrito(campo: MoldeCampo): boolean {
  return campo.tipo === "firma" || campo.htr === true;
}

function cropRect(canvas: HTMLCanvasElement, r: RectNorm, escala = 2): HTMLCanvasElement {
  const sx = Math.max(0, Math.floor(r.x * canvas.width));
  const sy = Math.max(0, Math.floor(r.y * canvas.height));
  const sw = Math.max(2, Math.min(canvas.width - sx, Math.ceil(r.w * canvas.width)));
  const sh = Math.max(2, Math.min(canvas.height - sy, Math.ceil(r.h * canvas.height)));
  const dw = Math.min(4000, Math.round(sw * escala));
  const dh = Math.min(4000, Math.round(sh * escala));
  const out = canvasCon(dw, dh);
  const ctx = ctxDe(out);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, dw, dh);
  return out;
}

function realceCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  // imageproc canvasRealce: grises → estiramiento p5-p95 (escala ×4 ya aplicada en cropRect)
  const g = filtroGris(src);
  const ctx = ctxDe(g);
  const img = ctx.getImageData(0, 0, g.width, g.height);
  const d = img.data;
  const gray = new Uint8Array(g.width * g.height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) gray[i] = d[p];
  const hist = new Float64Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const n = gray.length;
  let acc = 0;
  let p5 = 0, p95 = 255;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= n * 0.05) { p5 = i; break; } }
  acc = 0;
  for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= n * 0.05) { p95 = i; break; } }
  const span = Math.max(1, p95 - p5);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    const v = Math.max(0, Math.min(255, ((gray[i] - p5) * 255) / span));
    d[p] = d[p + 1] = d[p + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return g;
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Runner del benchmark
// ─────────────────────────────────────────────────────────────────────────────

interface Corrida { id: string; tipo: string; motor: string; imagen: string; calidad?: { w?: number; q?: number }; filtro?: string; molde?: string; nota?: string }
interface ResultadoCorrida extends Corrida {
  ms: number;
  heapMB: number;
  frio?: boolean;
  texto?: string;
  conf?: number;
  lineas?: { texto: string; conf: number; box: Punto[] }[];
  palabras?: number;
  det?: { nBoxes: number; msDet: number; msCls: number; msRec: number };
  campos?: unknown[];
  tinta?: unknown[];
  zxing?: unknown;
  error?: string;
  errorStack?: string;
}

const estado = {
  listo: false,
  error: "",
  corridas: [] as Corrida[],
  resultados: [] as ResultadoCorrida[],
  idx: 0,
  iniciando: false,
};

const SUBSET_CALIDAD = [
  "01-RECIBO-DE-PAGO/escaneado/pag-01.png",
  "01-RECIBO-DE-PAGO/real/recibo-impreso-01.jpg",
  "02-RECIBO-DE-ENTREGA/escaneado/pag-01.png",
  "02-RECIBO-DE-ENTREGA/real/comprobante-a-impreso-firmas-vacias-01.jpg",
  "04-ACTA-E14-2PAG/escaneado/referencia-p1.png",
  "03-E26-ACTA-PARCIAL-6PAG/escaneado/pag-01.png",
];

function imagenesDe(prefix: string, inventario: { ruta_relativa: string }[]): string[] {
  return inventario.filter((i) => i.ruta_relativa.startsWith(prefix)).map((i) => i.ruta_relativa);
}

async function construirPlan(inventario: { ruta_relativa: string }[]): Promise<Corrida[]> {
  const corridas: Corrida[] = [];
  const todas = inventario.map((i) => i.ruta_relativa);
  // base — nativo sin re-encode, ambos motores página completa
  for (const ruta of todas) {
    corridas.push({ id: `base-tess_fast-${ruta}`, tipo: "base", motor: "tess_fast", imagen: ruta });
    corridas.push({ id: `base-rapidocr-${ruta}`, tipo: "base", motor: "rapidocr", imagen: ruta });
  }
  // zxing — E-14 (plan §6: códigos 1D/QR como línea base)
  for (const ruta of imagenesDe(DOCS.e14.prefix, inventario)) {
    corridas.push({ id: `zxing-${ruta}`, tipo: "zxing", motor: "zxing", imagen: ruta });
  }
  // reps caliente — recibo escaneado ×2 por motor
  const repsImg = SUBSET_CALIDAD[0];
  for (const motor of ["tess_fast", "rapidocr"]) {
    corridas.push({ id: `rep-1-${motor}`, tipo: "rep", motor, imagen: repsImg });
    corridas.push({ id: `rep-2-${motor}`, tipo: "rep", motor, imagen: repsImg });
  }
  // barrido calidad — 6 imgs × {800,1200,1600} × {60,80,92} × 2 motores
  for (const ruta of SUBSET_CALIDAD) {
    for (const w of [800, 1200, 1600]) {
      for (const q of [60, 80, 92]) {
        for (const motor of ["tess_fast", "rapidocr"]) {
          corridas.push({ id: `cal-w${w}-q${q}-${motor}-${ruta}`, tipo: "calidad", motor, imagen: ruta, calidad: { w, q } });
        }
      }
    }
  }
  // barrido filtros — 6 imgs × {gris,otsu,clahe} × 2 motores (nativo)
  for (const ruta of SUBSET_CALIDAD) {
    for (const filtro of ["gris", "otsu", "clahe"]) {
      for (const motor of ["tess_fast", "rapidocr"]) {
        corridas.push({ id: `fil-${filtro}-${motor}-${ruta}`, tipo: "filtro", motor, imagen: ruta, filtro });
      }
    }
  }
  // M1 (con molde) — recortes por campo; tess_best (S2-a) en recibo/comprobante
  // (+ rapidocr-crop en recibo); e26/e14 solo pág. 1 del escaneado.
  const moldeCache = new Map<string, Molde>();
  const cargarMolde = async (doc: string, nombre: string): Promise<Molde> => {
    const key = `${doc}/${nombre}`;
    if (!moldeCache.has(key)) {
      const def = DOCS[doc].moldes.find((m) => m.nombre === nombre)!;
      moldeCache.set(key, await fetchJson<Molde>(def.url));
    }
    return moldeCache.get(key)!;
  };
  const camposLeibles = (molde: Molde, pagina: number | null): MoldeCampo[] =>
    molde.campos.filter((c) => (pagina === null || (c.pagina ?? 1) === pagina) && (c.estrategia === "ancla_relativa" || c.estrategia === "zona_fija" || !c.estrategia));
  const forMolde = async (doc: string, nombre: string, imgs: string[], pagina: number | null, motores: string[], tag: string, modo: "m1" | "m3" = "m1") => {
    const molde = await cargarMolde(doc, nombre);
    for (const ruta of imgs) {
      for (const motor of motores) {
        corridas.push({ id: `${modo}-${tag}-${motor}-${ruta}`, tipo: modo, motor, imagen: ruta, molde: `${doc}/${nombre}`, nota: JSON.stringify({ campos: camposLeibles(molde, pagina).map((c) => c.id) }) });
      }
    }
  };
  await forMolde("recibo", "recibo_pago", imagenesDe(DOCS.recibo.prefix, inventario), 1, ["tess_best", "rapid"], "gen", "m1");
  await forMolde("recibo", "recibo_a_real", imagenesDe(DOCS.recibo.prefix, inventario).filter((r) => r.includes("firmas-vacias")), 1, ["tess_best"], "real", "m1");
  await forMolde("comprobante", "comprobante_entrega", imagenesDe(DOCS.comprobante.prefix, inventario), 1, ["tess_best"], "gen", "m1");
  await forMolde("comprobante", "comprobante_a_real", imagenesDe(DOCS.comprobante.prefix, inventario).filter((r) => r.includes("firmas-vacias")), 1, ["tess_best"], "real", "m1");
  await forMolde("e26", "e26_acta_parcial", ["03-E26-ACTA-PARCIAL-6PAG/escaneado/pag-01.png"], 1, ["tess_best"], "p1", "m1");
  await forMolde("e14", "e14_acta", ["04-ACTA-E14-2PAG/escaneado/referencia-p1.png"], 1, ["tess_best"], "p1", "m1");
  // M3 (molde auto) — mismas molde/imagenes, zonas recalculadas SOLO con el
  // ancla detectada en ESTA imagen (sin fallback a rect de referencia).
  await forMolde("recibo", "recibo_pago", imagenesDe(DOCS.recibo.prefix, inventario), 1, ["tess_best"], "gen", "m3");
  await forMolde("comprobante", "comprobante_entrega", imagenesDe(DOCS.comprobante.prefix, inventario), 1, ["tess_best"], "gen", "m3");
  await forMolde("e26", "e26_acta_parcial", ["03-E26-ACTA-PARCIAL-6PAG/escaneado/pag-01.png"], 1, ["tess_best"], "p1", "m3");
  await forMolde("e14", "e14_acta", ["04-ACTA-E14-2PAG/escaneado/referencia-p1.png"], 1, ["tess_best"], "p1", "m3");
  // S6 — tinta por zonas firma del molde (recibo/comprobante todas sus imgs;
  // e26 6 páginas escaneadas; e14 sus 6 imgs)
  const imgsTinta = [...imagenesDe(DOCS.recibo.prefix, inventario), ...imagenesDe(DOCS.comprobante.prefix, inventario), ...imagenesDe(DOCS.e14.prefix, inventario), ...imagenesDe(DOCS.e26.prefix, inventario)];
  for (const ruta of imgsTinta) {
    corridas.push({ id: `tinta-${ruta}`, tipo: "tinta", motor: "scanner-core", imagen: ruta });
  }
  return corridas;
}

// Versión async (los crops llaman a OCR asíncrono)
async function ejecutarMoldeAsync(molde: Molde, tokens: Token[], canvas: HTMLCanvasElement, modo: "m1" | "m3", engine: "tess_best" | "rapid", lineas?: { texto: string; rect: RectNorm }[]): Promise<unknown[]> {
  const salida: unknown[] = [];
  for (const campo of molde.campos) {
    const item: Record<string, unknown> = { id: campo.id, tipo: campo.tipo ?? "texto", obligatorio: campo.obligatorio !== false };
    try {
    pasoActual = "inicio";
    const rectRef = campo.ancla?.rect ?? null;
    let base: RectNorm | null = null;
    let fuenteAncla = "sin_ancla";
    let scoreAncla = 0;
    if (campo.estrategia === "zona_fija" || (!campo.ancla && campo.zona)) {
      base = { x: campo.zona!.x, y: campo.zona!.y, w: campo.zona!.w, h: campo.zona!.h };
      fuenteAncla = "zona_fija";
    } else if (campo.ancla) {
      pasoActual = "buscar_ancla";
      const textoAncla = (campo.ancla as { texto?: string }).texto;
      const hit = typeof textoAncla === "string" ? buscarAncla(textoAncla, tokens, rectRef, lineas) : null;
      if (hit) {
        base = resolverZona(campo, hit.rect);
        fuenteAncla = "hit";
        scoreAncla = hit.score;
      } else if (modo === "m1") {
        pasoActual = "buscar_respaldo";
        const textoRespaldo = (campo.ancla_respaldo as { texto?: string } | undefined)?.texto;
        if (campo.ancla_respaldo && typeof textoRespaldo === "string") {
          const hit2 = buscarAncla(textoRespaldo, tokens, campo.ancla_respaldo.rect ?? null, lineas);
          if (hit2) { base = resolverZona(campo, hit2.rect); fuenteAncla = "respaldo_hit"; scoreAncla = hit2.score; }
        }
        if (!base && rectRef) { base = resolverZona(campo, rectRef); fuenteAncla = "referencia"; }
      }
      // m3: SIN fallback — si el ancla no se detecta en ESTA imagen, no hay zona
    }
    if (!base) {
      item.estado = "no_encontrado";
      item.fuente_ancla = fuenteAncla;
      salida.push(item);
      continue;
    }
    item.rect = base;
    item.fuente_ancla = fuenteAncla;
    item.ancla_score = Math.round(scoreAncla * 1000) / 1000;
    if (esManuscrito(campo)) {
      pasoActual = "crop_tinta";
      const crop = cropRect(canvas, base, 1);
      pasoActual = "medir_tinta";
      const { ratio, bbox } = medirTinta(crop);
      const umbral = campo.umbral ?? 0.02;
      item.tipo = "tinta";
      item.ratio = Math.round(ratio * 10000) / 10000;
      item.con_tinta = ratio >= umbral;
      item.umbral = umbral;
      item.bbox = bbox;
      item.estado = ratio >= umbral ? "ok" : ratio >= umbral * 0.6 ? "borde" : "vacia";
      salida.push(item);
      continue;
    }
    pasoActual = "crop_texto";
    const multilinea = ["datos_emisor", "datos_pagador", "concepto", "importe_texto", "descripcion", "direccion", "titulo", "declaratoria", "resumen_votacion", "pagina", "copia_destino", "divipol_consulado", "divipol_pais"].includes(campo.id) || (base.h > 0.03 && campo.id !== "umbral" && campo.id !== "cifra");
    const psm = multilinea ? "6" : "7";
    const escala = campo.realce ? 4 : 2;
    let crop = cropRect(canvas, base, escala);
    if (campo.realce) { pasoActual = "realce"; crop = realceCanvas(crop); }
    if (engine === "tess_best") {
      pasoActual = "ocr_tess_crop";
      const r = await tessReconocer(tessWorkers.best, crop, "best", psm, campo.whitelist);
      item.valor = r.texto.trim();
      item.conf = Math.round(r.conf);
      item.motor_recorte = "tess_4.0.0_best";
      item.psm = psm;
      item.realce = !!campo.realce;
      item.whitelist = campo.whitelist ?? null;
    } else {
      pasoActual = "ocr_rapid_crop";
      const r = await rapidRecCrop(crop);
      item.valor = r.texto;
      item.conf = Math.round(r.conf * 100);
      item.motor_recorte = "rapidocr_rec";
    }
    item.patron_ok = campo.patron ? new RegExp(campo.patron).test(item.valor as string) : null;
    item.estado = (item.valor as string).length > 0 ? "ok" : "no_encontrado";
    salida.push(item);
    } catch (eCampo) {
      item.estado = "error_campo";
      item.error_campo = `${String((eCampo as Error)?.message ?? eCampo)} @ ${pasoActual}`;
      salida.push(item);
    }
  }
  return salida;
}

// marcador del paso actual para el diagnóstico per-campo
let pasoActual = "?";

async function ejecutarCorrida(c: Corrida): Promise<ResultadoCorrida> {
  const t0 = performance.now();
  const heap0 = heapMB();
  const res: ResultadoCorrida = { ...c, ms: 0, heapMB: heap0 };
  try {
    if (c.tipo === "tinta") {
      const doc = docDe(c.imagen)!;
      const moldeDef = DOCS[doc].moldes.find((m) => m.cuando(c.imagen))!;
      const molde = await fetchJson<Molde>(moldeDef.url);
      const canvas = await prepararImagen(c.imagen);
      // página de la imagen (e26 pag-0X / e14 ...-pagX) — solo zonas de esa página
      const mPag = /pag[-_]?(\d+)/i.exec(c.imagen);
      const paginaImg = mPag ? parseInt(mPag[1], 10) : 1;
      const zonas = molde.campos.filter((campo) => esManuscrito(campo) && campo.zona && (campo.pagina ?? 1) === paginaImg);
      const necesitaOcr = zonas.some((campo) => campo.estrategia === "ancla_relativa" && campo.ancla);
      // mapa OCR global UNA vez por imagen (no por zona)
      const ocr = necesitaOcr ? await rapidReconocer(canvas, { omitirCls: true }) : null;
      const tokens = ocr ? tokensDeRapid(ocr.lineas, canvas.width, canvas.height) : [];
      const lineas = ocr ? lineasNormDe(ocr.lineas, canvas.width, canvas.height) : undefined;
      const tinta: unknown[] = [];
      for (const campo of zonas) {
        let rect: RectNorm | null = null;
        let fuente = "zona_fija";
        if (campo.estrategia === "ancla_relativa" && campo.ancla) {
          const hit = buscarAncla(campo.ancla.texto, tokens, campo.ancla.rect ?? null, lineas);
          if (hit) { rect = resolverZona(campo, hit.rect); fuente = "hit"; }
          else if (campo.ancla.rect) { rect = resolverZona(campo, campo.ancla.rect); fuente = "referencia"; }
          else { rect = { x: campo.zona!.x, y: campo.zona!.y, w: campo.zona!.w, h: campo.zona!.h }; fuente = "zona_fija"; }
        } else if (campo.zona) {
          rect = { x: campo.zona.x, y: campo.zona.y, w: campo.zona.w, h: campo.zona.h };
        }
        if (!rect) continue;
        const crop = cropRect(canvas, rect, 1);
        const { ratio, bbox } = medirTinta(crop);
        const umbral = campo.umbral ?? 0.02;
        tinta.push({ id: campo.id, fuente, ratio: Math.round(ratio * 10000) / 10000, con_tinta: ratio >= umbral, umbral, bbox, rect });
      }
      res.tinta = tinta;
      res.ms = performance.now() - t0;
      res.heapMB = heapMB();
      return res;
    }
    if (c.tipo === "zxing") {
      const canvas = await prepararImagen(c.imagen);
      const r = await zxingLeer(canvas);
      res.zxing = r;
      res.ms = performance.now() - t0;
      res.heapMB = heapMB();
      return res;
    }
    if (c.tipo === "m1" || c.tipo === "m3") {
      const [doc, nombre] = (c.molde ?? "").split("/");
      const molde = await fetchJson<Molde>(DOCS[doc].moldes.find((m) => m.nombre === nombre)!.url);
      const canvas = await prepararImagen(c.imagen);
      // mapa OCR global de la página (rapid-first, como producción): anclas
      const ocr = await rapidReconocer(canvas, { omitirCls: true });
      const tokens = tokensDeRapid(ocr.lineas, canvas.width, canvas.height);
      const lineas = lineasNormDe(ocr.lineas, canvas.width, canvas.height);
      const engine = c.motor === "rapid" ? "rapid" : "tess_best";
      const campos = await ejecutarMoldeAsync(molde, tokens, canvas, c.tipo === "m1" ? "m1" : "m3", engine, lineas);
      res.campos = campos;
      res.det = { nBoxes: ocr.nBoxes, msDet: Math.round(ocr.msDet), msCls: Math.round(ocr.msCls), msRec: Math.round(ocr.msRec) };
      res.texto = ocr.texto;
      res.ms = performance.now() - t0;
      res.heapMB = heapMB();
      return res;
    }
    // base / calidad / filtro / rep — página completa
    const canvas = await aplicarFiltro(await prepararImagen(c.imagen, c.calidad?.w, c.calidad?.q), c.filtro ?? "original");
    const ligero = c.tipo === "calidad" || c.tipo === "filtro" || c.tipo === "rep"; // barridos: sin lineas (JSON acotado)
    if (c.motor === "tess_fast" || c.motor === "tess_best") {
      const variante = c.motor === "tess_fast" ? "fast" : "best";
      const worker = await tessInit(variante as "fast" | "best");
      const r = await tessReconocer(worker, canvas, variante, "3");
      res.texto = r.texto;
      res.conf = Math.round(r.conf);
      res.palabras = r.palabras.length;
      res.frio = !calienteMarca[variante];
      calienteMarca[variante] = true;
      res.lineas = ligero ? undefined : r.palabras.slice(0, 400).map((p) => ({ texto: p.texto, conf: p.conf / 100, box: [{ x: p.x0, y: p.y0 }, { x: p.x1, y: p.y0 }, { x: p.x1, y: p.y1 }, { x: p.x0, y: p.y1 }] }));
      res.ms = performance.now() - t0;
    } else {
      const awaitRapid = await rapidInit().then(() => rapidReconocer(canvas, {
        // barridos §6 con cap rápido (1280, 1.ª pasada del escalonado del repo):
        // acota el pico de WASM — el §6 deja que el heap decida hasta dónde subir
        detCap: ligero ? DET_CAP_RAPIDO : DET_CAP_PROD,
      }));
      res.texto = awaitRapid.texto;
      res.conf = Math.round(awaitRapid.confMedia * 100);
      res.lineas = ligero ? undefined : awaitRapid.lineas.map((l) => ({ texto: l.texto, conf: l.conf, box: l.box }));
      res.det = { nBoxes: awaitRapid.nBoxes, msDet: Math.round(awaitRapid.msDet), msCls: Math.round(awaitRapid.msCls), msRec: Math.round(awaitRapid.msRec) };
      res.frio = calienteMarca.rapid === false;
      calienteMarca.rapid = true;
      res.ms = performance.now() - t0;
    }
    res.heapMB = heapMB();
    return res;
  } catch (e) {
    res.error = String((e as Error)?.message ?? e);
    const stack = (e as Error)?.stack;
    if (stack) res.errorStack = stack.split("\n").slice(0, 4).join(" | ");
    res.ms = performance.now() - t0;
    res.heapMB = heapMB();
    return res;
  }
}

// marca de frío por motor (primera corrida de página completa tras init)
const calienteMarca: Record<string, boolean> = { fast: false, best: false, rapid: false };

async function ejecutarLote(n: number): Promise<{ hechos: number; total: number; listo: boolean; errores: number }> {
  if (!estado.listo) throw new Error("arnés no listo");
  const fin = Math.min(estado.corridas.length, estado.idx + n);
  let errores = 0;
  for (; estado.idx < fin; estado.idx++) {
    const c = estado.corridas[estado.idx];
    const r = await ejecutarCorrida(c);
    if (r.error) errores++;
    estado.resultados.push(r);
  }
  return { hechos: estado.idx, total: estado.corridas.length, listo: estado.idx >= estado.corridas.length, errores };
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. API pública para el conductor CDP
// ─────────────────────────────────────────────────────────────────────────────

async function iniciar(): Promise<void> {
  if (estado.iniciando || estado.listo) return;
  estado.iniciando = true;
  try {
    const invJson = await fetchJson<{ imagenes?: { ruta_relativa: string }[] } | { ruta_relativa: string }[]>(`${GT}/inventario.json`);
    const inventario = Array.isArray(invJson) ? invJson : (invJson.imagenes ?? []);
    estado.corridas = await construirPlan(inventario);
    // precarga motores (frío medible en la primera corrida real de cada uno)
    await rapidInit();
    await tessInit("fast");
    await tessInit("best");
    estado.listo = true;
  } catch (e) {
    estado.error = String((e as Error)?.message ?? e);
  } finally {
    estado.iniciando = false;
  }
}

function resultado(): unknown {
  return { meta: { agente: 1, plan: "PLAN-BENCHMARK-V3", rama: "bench/agente-1-arnes-motores", fecha: new Date().toISOString(), motores: { tesseract: "7.0.0 (spa 4.0.0_fast + 4.0.0_best)", rapidocr: "PP-OCRv4 det/cls/rec onnxruntime-web 1.31.1 WASM", zxing: "@zxing/library 0.23.0" }, ua: navigator.userAgent, hilos: ortGlobal?.env.wasm.numThreads ?? null, crossOriginIsolated }, corridas: estado.corridas.length, resultados: estado.resultados };
}

declare global {
  interface Window {
    __ARNES: {
      iniciar: () => Promise<void>;
      estado: () => { listo: boolean; error: string; idx: number; total: number };
      ejecutar: (n: number) => Promise<{ hechos: number; total: number; listo: boolean; errores: number }>;
      resultado: () => unknown;
      inyectar: (previos: unknown) => void;
    };
  }
}

window.__ARNES = {
  iniciar,
  estado: () => ({ listo: estado.listo, error: estado.error, idx: estado.idx, total: estado.corridas.length }),
  ejecutar: ejecutarLote,
  resultado,
  // reanudación: el conductor reinyecta los resultados parciales tras un OOM.
  // Toda corrida reanudada es CALIENTE (los fríos 1-2 siempre viven en las
  // primeras 24 corridas, antes del primer ciclo de recarga).
  inyectar: (previos: unknown) => {
    const arr = previos as ResultadoCorrida[];
    if (!Array.isArray(arr)) return;
    estado.resultados = arr.slice();
    estado.idx = Math.min(arr.length, estado.corridas.length);
    if (arr.length > 0) {
      calienteMarca.fast = true;
      calienteMarca.best = true;
      calienteMarca.rapid = true;
      rapidFrio = false;
    }
  },
};

export {};
