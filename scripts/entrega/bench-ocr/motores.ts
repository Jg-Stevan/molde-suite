/**
 * motores.ts — motores del arnés de MEDICIÓN (2026-11-28).
 *
 * Copia del código de motores de entry.ts (mismo port citado allí):
 *   · db-postprocess — packages/scanner-core/ocr/db-postprocess.ts (literal)
 *   · preDet/crop/rec — packages/scanner-core/ocr/rapidocr.ts
 *   · tesseract.js 7 (worker/core/lang locales)
 * Se separa para reutilizarlo desde entry-medicion.ts sin tocar el arnés V3.
 */
import { createWorker, PSM } from "tesseract.js";

const BASE = "/_bench"; // origen del arnés (assets bajo public/_bench)
const DET_CAP_PROD = 1920; // rapidocr.ts L469 (producción byte a byte)

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

type OrtModule = typeof import("onnxruntime-web/wasm");
interface OrtValue { readonly dims: readonly number[]; data: Float32Array }
interface RapidLinea { texto: string; conf: number; box: Punto[] }
interface RapidResultado { lineas: RapidLinea[]; texto: string; confMedia: number; msDet: number; msCls: number; msRec: number; nBoxes: number }

let ortGlobal: OrtModule | null = null;
interface RapidRuntime { det: OrtSession; cls: OrtSession; rec: OrtSession; dict: string[]; ort: OrtModule }
interface OrtSession { run(feeds: Record<string, OrtValue>): Promise<Record<string, OrtValue>>; inputNames: readonly string[]; outputNames: readonly string[] }
let rtRapid: RapidRuntime | null = null;
let rapidFrio = true;

async function rapidInit(hilos?: number): Promise<void> {
  if (rtRapid) return;
  const ort = (await import("onnxruntime-web/wasm")) as OrtModule;
  ortGlobal = ort;
  ort.env.wasm.wasmPaths = `${BASE}/vendor/onnxruntime/`;
  ort.env.wasm.numThreads = hilos ?? Math.min(2, navigator.hardwareConcurrency || 1); // 4 GB: 1 hilo para no OOM
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

type TessWorker = Awaited<ReturnType<typeof createWorker>>;
export type TessModelo = "fast" | "best" | "std";

const tessWorkers: Record<string, TessWorker> = {};

// Directorio por familia de traineddata en el repo naptha/tessdata (commit
// fijado en materializar.mjs): 4.0.0 = estándar, 4.0.0_fast, 4.0.0_best.
const TESS_DIRS: Record<TessModelo, string> = { fast: "4.0.0_fast", best: "4.0.0_best", std: "4.0.0" };

// probe SIMD128 de ocr-core-resolver.ts (molde-studio): el corePath debe ser
// el ARCHIVO EXACTO — si es un directorio, tesseract.js v7 sondea
// relaxedsimd (no hospedado: abort «missing function: DotProductSSE»).
const SIMD128_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 15, 1, 13, 0, 65, 1, 253, 15, 65, 2, 253, 15, 253, 128, 2, 11]);
function coreArchivo(): string {
  const variante = WebAssembly.validate(SIMD128_PROBE) ? "tesseract-core-simd-lstm.wasm.js" : "tesseract-core-lstm.wasm.js";
  return `${BASE}/vendor/tesseract/${variante}`;
}

async function tessInit(modelo: TessModelo, lang = "spa"): Promise<TessWorker> {
  const clave = `${modelo}:${lang}`;
  if (tessWorkers[clave]) return tessWorkers[clave];
  const langPath = `${BASE}/models/tess/${TESS_DIRS[modelo]}`;
  const worker = await createWorker(lang, 1, {
    workerPath: `${BASE}/vendor/tesseract/worker.min.js`,
    corePath: coreArchivo(),
    langPath,
    logger: () => {},
  });
  await worker.setParameters({ preserve_interword_spaces: "1" });
  tessWorkers[clave] = worker;
  return worker;
}

interface TessPalabra { texto: string; x0: number; y0: number; x1: number; y1: number; conf: number }
interface TessResultado { texto: string; conf: number; palabras: TessPalabra[]; ms: number }

async function tessReconocer(worker: TessWorker, img: HTMLCanvasElement, variante: string, psm = "3", whitelist?: string, dpi?: number): Promise<TessResultado> {
  const t0 = performance.now();
  await worker.setParameters({
    tessedit_pageseg_mode: psm as PSM,
    ...(whitelist ? { tessedit_char_whitelist: whitelist } : {}),
    ...(dpi ? { user_defined_dpi: String(dpi) } : {}),
  });
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
  return { texto: data.text ?? "", conf: data.confidence ?? 0, palabras, ms };
}

// ─── API del módulo ─────────────────────────────────────────────────────────
export {
  DET_CAP_PROD,
  canvasCon,
  canvasDe,
  ctxDe,
  fetchBitmap,
  norm,
  levenshtein,
  heapMB,
  rapidInit,
  rapidReconocer,
  rapidRecCrop,
  tessInit,
  tessReconocer,
};
export type { Punto, RapidLinea, RapidResultado, TessPalabra, TessResultado, TessWorker };

/** Downsampling determinista: mismo algoritmo para toda la escalera. */
export function escalarCanvas(src: HTMLCanvasElement, ladoObjetivo: number): HTMLCanvasElement {
  const largo = Math.max(src.width, src.height);
  const escala = largo > ladoObjetivo ? ladoObjetivo / largo : 1;
  const c = canvasCon(Math.round(src.width * escala), Math.round(src.height * escala));
  const ctx = ctxDe(c);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

// ─────────────────────────────────────────────────────────────────────────────
// Motores de terceros (medición 2026-11-28, sin molde). Import dinámico: si un
// SDK no carga en el navegador, solo ese motor queda «no viable con motivo».
// ─────────────────────────────────────────────────────────────────────────────

export interface ReconExterno {
  texto: string;
  /** Media de confianza 0-100 (como tesseract). */
  conf100: number;
  lineas: { texto: string; conf: number; box: { x: number; y: number }[] }[];
}

function lineaDeCaja(texto: string, conf: number, x0: number, y0: number, x1: number, y1: number) {
  return {
    texto,
    conf,
    box: [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ],
  };
}

function confMediaDe(lineas: { conf: number }[]): number {
  if (lineas.length === 0) return 0;
  return Math.round((lineas.reduce((s, l) => s + l.conf, 0) / lineas.length) * 100);
}

async function ortLocal(hilos?: number): Promise<void> {
  const ort = await import("onnxruntime-web");
  ort.env.wasm.wasmPaths = `${BASE}/vendor/onnxruntime/`;
  ort.env.wasm.numThreads = hilos ?? Math.min(2, navigator.hardwareConcurrency || 1);
  ort.env.wasm.simd = true;
}

// litert-ocr — PP-OCRv6-Small sobre LiteRT.js (modelo y runtime desde CDN/HF).
let litertWorker: {
  recognize: (img: HTMLCanvasElement, o?: unknown, out?: unknown) => Promise<{ data: any }>;
} | null = null;

export async function litertInit(): Promise<void> {
  if (litertWorker) return;
  const { createWorker } = await import("litert-ocr");
  litertWorker = (await createWorker("eng")) as never;
}

function cajaDe(b: any): [number, number, number, number] | null {
  if (!b) return null;
  if (Array.isArray(b)) return [b[0], b[1], b[2], b[3]];
  if (b.x0 != null) return [b.x0, b.y0, b.x1, b.y1];
  if (b.x != null) return [b.x, b.y, b.x + (b.width ?? 0), b.y + (b.height ?? 0)];
  return null;
}

export async function litertReconocer(img: HTMLCanvasElement): Promise<ReconExterno> {
  await litertInit();
  const { data } = await litertWorker!.recognize(img, {}, { blocks: true });
  // Una línea por renglón: data.lines → blocks[].paragraphs[].lines → bloque.
  // Si el build solo expone el bloque, su texto (con \n) queda como lectura cruda.
  let items: any[] = data.lines ?? [];
  if (items.length === 0) {
    for (const bl of (data.blocks ?? []) as any[]) {
      for (const pa of bl.paragraphs ?? []) for (const li of pa.lines ?? []) items.push(li);
    }
  }
  if (items.length === 0) items = data.blocks ?? [];
  const lineas = items
    .map((b) => {
      const c = cajaDe(b.bbox ?? b.box);
      if (!c) return null;
      return lineaDeCaja(String(b.text ?? "").trim(), (Number(b.confidence) || Number(data.confidence) || 0) / 100, c[0], c[1], c[2], c[3]);
    })
    .filter((l): l is { texto: string; conf: number; box: { x: number; y: number }[] } => !!l && !!l.texto);
  return { texto: data.text ?? "", conf100: Math.round(Number(data.confidence) || 0), lineas };
}

// ppu-paddle-ocr — PP-OCRv5 mobile latin (ONNX, motor de imagen canvas-native).
let paddleSvc: { initialize: () => Promise<void>; recognize: (img: any, o?: any) => Promise<any> } | null = null;

export async function paddleInit(hilos?: number): Promise<void> {
  if (paddleSvc) return;
  await ortLocal(hilos);
  const { PaddleOcrService, V5_LATIN_MOBILE_MODEL } = await import("ppu-paddle-ocr/web");
  const svc = new PaddleOcrService({ model: V5_LATIN_MOBILE_MODEL, processing: { engine: "canvas-native" } });
  await svc.initialize();
  paddleSvc = svc as never;
}

export async function paddleReconocer(img: HTMLCanvasElement): Promise<ReconExterno> {
  await paddleInit();
  const r: any = await paddleSvc!.recognize(img, { flatten: true, noCache: true });
  const items: any[] = r.results ?? (r.lines ? r.lines.flat() : []);
  const lineas = items
    .map((w) =>
      lineaDeCaja(
        String(w.text ?? "").trim(),
        Number(w.confidence) || 0,
        w.box.x,
        w.box.y,
        w.box.x + w.box.width,
        w.box.y + w.box.height,
      ),
    )
    .filter((l) => l.texto);
  const conf100 = r.confidence != null ? Math.round(Number(r.confidence) * 100) : confMediaDe(lineas);
  return { texto: r.text ?? "", conf100, lineas };
}

// ffocr — PP-OCRv5 mobile (ONNX + ORT Web, modelos oficiales del paquete).
let ffocrSvc: { ocr: (img: any) => Promise<any> } | null = null;

export async function ffocrInit(): Promise<void> {
  if (ffocrSvc) return;
  const { createDefaultPPOcrV5 } = await import("ffocr");
  ffocrSvc = createDefaultPPOcrV5({
    ort: { wasmPaths: `${BASE}/vendor/onnxruntime/`, wasmThreads: 1 },
    providerPreference: "wasm",
  }) as never;
}

export async function ffocrReconocer(img: HTMLCanvasElement): Promise<ReconExterno> {
  await ffocrInit();
  const r = await ffocrSvc!.ocr(img);
  const lineas = ((r.lines ?? []) as any[])
    .map((l) =>
      lineaDeCaja(
        String(l.text ?? "").trim(),
        Number(l.score) || 0,
        l.box.points[0].x,
        l.box.points[0].y,
        l.box.points[2].x,
        l.box.points[2].y,
      ),
    )
    .filter((l) => l.texto);
  return { texto: r.text ?? "", conf100: confMediaDe(lineas), lineas };
}

// ppu-indra-ocr — Datalab Indra v3.1 (Latin/Cyrillic/Greek, el set más pequeño).
let indraSvc: { initialize: () => Promise<void>; convert: (img: any) => Promise<any> } | null = null;

export async function indraInit(hilos?: number): Promise<void> {
  if (indraSvc) return;
  await ortLocal(hilos);
  const { IndraOcrService } = await import("ppu-indra-ocr/web");
  const svc = new IndraOcrService({ model: "v3.1", lm: false, math: false });
  await svc.initialize();
  indraSvc = svc as never;
}

export async function indraReconocer(img: HTMLCanvasElement): Promise<ReconExterno> {
  await indraInit();
  const page = await indraSvc!.convert(img);
  const lineas = ((page.lines ?? []) as any[])
    .map((l) => lineaDeCaja(String(l.text ?? "").trim(), Number(l.conf) || 0, l.box[0], l.box[1], l.box[2], l.box[3]))
    .filter((l) => l.texto);
  return { texto: page.text ?? "", conf100: confMediaDe(lineas), lineas };
}
