/**
 * entry-medicion.ts — arnés de MEDICIÓN resolución × motores (2026-11-28).
 *
 * Protocolo único aprobado (enmiendas A–K):
 *   · Maestras reales exportadas de la app (scripts/resultados/medicion-ocr/maestras)
 *     + una maestra sintética renderizada aquí con GT exacto (CER/WER sin datos
 *     personales).
 *   · Escalera por downsampling determinista (mismo drawImage de alta calidad),
 *     sin upscale: los objetivos mayores que la nativa se marcan y no se corren.
 *   · Init en frío por motor + calentamiento aparte; todas las corridas
 *     registradas son calientes, con repeticiones ≥5.
 *   · Por corrida: ms, heap pico medido (performance.memory sampleado), texto
 *     crudo y líneas con cajas/conf, etiquetas impresas detectadas (sin valores
 *     personales) y, para la sintética, CER/WER contra el GT.
 *
 * Motores fase 1: tesseract.js 7 (4.0.0_fast, 4.0.0_best spa) y RapidOCR
 * PP-OCRv4 detCap 1280/1920 (mismos ajustes que producción).
 */
import {
  canvasCon,
  ctxDe,
  fetchBitmap,
  ffocrInit,
  ffocrReconocer,
  heapMB,
  indraInit,
  indraReconocer,
  levenshtein,
  litertInit,
  litertReconocer,
  norm,
  paddleInit,
  paddleReconocer,
  rapidInit,
  rapidReconocer,
  tessInit,
  tessReconocer,
  type ReconExterno,
} from "./motores";
// Mismo warp que usa el pipeline de la app (TS puro, sin dependencias).
import { warpPerspectiva } from "../../../packages/scanner-core/molde/homografia";
import type { Quad } from "../../../packages/scanner-core/core/types";

const MAESTRAS = "/maestras";
const GT = "/gt";

// Hilos WASM por dispositivo: A56 (8 GB) 2; equipos de 4 GB 1 (OOM con más).
const PARAMS = new URLSearchParams(location.search);
const HILOS_WASM = (() => {
  const n = parseInt(PARAMS.get("hilos") ?? "", 10);
  return Number.isFinite(n) && n >= 1 && n <= 4 ? n : Math.min(2, navigator.hardwareConcurrency || 1);
})();
// ?equipo=a56&maestras=propias → solo sintética + maestras capturadas en ese equipo.
const EQUIPO_PARAM = (PARAMS.get("equipo") ?? "").toLowerCase();
const SOLO_PROPIAS = PARAMS.get("maestras") === "propias";
// ?maestra=<id> → solo esa maestra real (+ la sintética si existe). Se usa para
// correr la misma imagen limpia (p. ej. capturada en el A56) en todos los equipos.
const MAESTRA_PARAM = PARAMS.get("maestra") ?? "";
// ?rectificadas=1 → sintética + todas las maestras ya limpias (warp nativo).
const SOLO_RECT = PARAMS.get("rectificadas") === "1";
// ?inv=<archivo> → inventario alternativo dentro de /gt (p. ej. la familia
// Tesseract). Solo nombre de archivo: sin rutas.
const INV_PARAM = /^[a-z0-9._-]+$/i.test(PARAMS.get("inv") ?? "") ? PARAMS.get("inv")! : "inventario.json";

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

interface Maestra {
  id: string;
  equipo: string;
  doc: string;
  ruta: string;
  w: number;
  h: number;
  sintetica?: boolean;
  rectificada?: boolean;
}

interface Inventario {
  escalera: number[];
  motores: string[];
  repeticiones: number;
  maestras: Maestra[];
}

interface Sintetica {
  ancho: number;
  alto: number;
  titulo: string;
  subtitulo: string;
  lineas: string[];
  parrafo: string[];
  etiquetasFirma: string[];
}

interface Corrida {
  id: string;
  motor: string;
  maestra: string;
  equipo: string;
  doc: string;
  lado: number;
  rep: number;
}

interface LineaSalida {
  texto: string;
  conf: number;
  box: { x: number; y: number }[];
}

type QuadPts = { x: number; y: number }[];

// Familia Tesseract (pedido del dueño 2026-11-28): modelo traineddata ×
// segmentación PSM × idioma × pista de DPI. El id es lo que viaja en el
// inventario y en los resultados.
interface TessSpec {
  modelo: "fast" | "best" | "std";
  lang: string;
  psm: string;
  dpi?: number;
  /** Recorte [x0,y0,x1,y1] en fracciones de la imagen limpia (rescate). */
  crop?: [number, number, number, number];
  escala?: number;
}

interface ResultadoCorrida extends Corrida {
  ms: number;
  prepMs: number;
  heapPicoMB: number;
  heapMB: number;
  limpioW?: number;
  limpioH?: number;
  cropW?: number;
  cropH?: number;
  sinQuad?: boolean;
  chars?: number;
  lineasN?: number;
  nBoxes?: number;
  detMs?: number;
  conf?: number;
  texto?: string;
  lineas?: LineaSalida[];
  etiquetas?: { id: string; hit: boolean }[];
  cer?: number;
  wer?: number;
  error?: string;
}

interface EscaleraMaestra {
  maestra: string;
  nativaMax: number;
  corridas: number[];
  skipUpscale: number[];
}

interface Estado {
  listo: boolean;
  error: string;
  corridas: Corrida[];
  resultados: ResultadoCorrida[];
  idx: number;
  iniciando: boolean;
  maestrasPorId: Map<string, Maestra>;
  meta: {
    ua: string;
    hilos: number | null;
    crossOriginIsolated: boolean | null;
    initFrioMs: Record<string, number>;
    calentamientoMs: Record<string, number>;
    erroresMotor: Record<string, string>;
    escaleraPorMaestra: EscaleraMaestra[];
    quads: Record<string, QuadPts | null>;
    deteccionMs: Record<string, number>;
    detectorError: string;
    tessFamilia?: Record<string, TessSpec>;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Maestra sintética (GT exacto, sin datos personales)
// ─────────────────────────────────────────────────────────────────────────────

let sinteticaJson: Sintetica | null = null;
let sinteticaCanvas: HTMLCanvasElement | null = null;

async function cargarSintetica(): Promise<Sintetica> {
  if (sinteticaJson) return sinteticaJson;
  const r = await fetch(`${GT}/sintetica.json`);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${GT}/sintetica.json`);
  sinteticaJson = (await r.json()) as Sintetica;
  return sinteticaJson;
}

function gtTextoSintetica(s: Sintetica): string {
  return [s.titulo, s.subtitulo, ...s.lineas, ...s.parrafo, ...s.etiquetasFirma].join("\n");
}

function renderSintetica(s: Sintetica): HTMLCanvasElement {
  if (sinteticaCanvas) return sinteticaCanvas;
  const c = canvasCon(s.ancho, s.alto);
  const ctx = ctxDe(c);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#111111";
  ctx.textBaseline = "alphabetic";
  const x = Math.round(s.ancho * 0.06);

  ctx.font = `bold ${Math.round(s.alto * 0.021)}px Arial`;
  ctx.fillText(s.titulo, x, Math.round(s.alto * 0.07));
  ctx.font = `${Math.round(s.alto * 0.0095)}px Arial`;
  ctx.fillText(s.subtitulo, x, Math.round(s.alto * 0.095));

  ctx.font = `${Math.round(s.alto * 0.012)}px Arial`;
  let y = Math.round(s.alto * 0.145);
  for (const linea of s.lineas) {
    ctx.fillText(linea, x, y);
    y += Math.round(s.alto * 0.0215);
  }

  ctx.font = `${Math.round(s.alto * 0.008)}px Arial`;
  y = Math.round(s.alto * 0.42);
  for (const linea of s.parrafo) {
    ctx.fillText(linea, x, y);
    y += Math.round(s.alto * 0.012);
  }

  // trazos de firma (tinta) bajo cada rótulo — para medir borrado por resolución
  ctx.font = `${Math.round(s.alto * 0.01)}px Arial`;
  const yFirma = Math.round(s.alto * 0.78);
  const rotulos = [
    { texto: s.etiquetasFirma[0] ?? "", x },
    { texto: s.etiquetasFirma[1] ?? "", x: Math.round(s.ancho * 0.52) },
  ];
  for (const r of rotulos) {
    ctx.beginPath();
    ctx.strokeStyle = "#1a1a8c";
    ctx.lineWidth = Math.max(2, Math.round(s.alto * 0.0012));
    const y0 = yFirma - Math.round(s.alto * 0.03);
    ctx.moveTo(r.x, y0);
    for (let i = 1; i <= 24; i++) {
      const px = r.x + i * Math.round(s.ancho * 0.012);
      const py = y0 + Math.sin(i * 1.7) * Math.round(s.alto * 0.009) + i * 1.5;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.fillText(r.texto, r.x, yFirma);
  }
  sinteticaCanvas = c;
  return c;
}

// ─────────────────────────────────────────────────────────────────────────────
// Estado y plan
// ─────────────────────────────────────────────────────────────────────────────

const estado: Estado = {
  listo: false,
  error: "",
  corridas: [],
  resultados: [],
  idx: 0,
  iniciando: false,
  maestrasPorId: new Map(),
  meta: {
    ua: navigator.userAgent,
    hilos: navigator.hardwareConcurrency ?? null,
    crossOriginIsolated: typeof crossOriginIsolated === "boolean" ? crossOriginIsolated : null,
    initFrioMs: {},
    calentamientoMs: {},
    erroresMotor: {},
    escaleraPorMaestra: [],
    quads: {},
    deteccionMs: {},
    detectorError: "",
  },
};

const etiquetasJson: Record<string, string[]> = {};

async function cargarEtiquetas(): Promise<void> {
  try {
    const r = await fetch(`${GT}/etiquetas.json`);
    if (!r.ok) return;
    const j = (await r.json()) as Record<string, string[]>;
    for (const [k, v] of Object.entries(j)) etiquetasJson[k] = v;
  } catch { /* opcional */ }
}

function construirPlan(inv: Inventario): Corrida[] {
  const corridas: Corrida[] = [];
  const repeticiones = Math.max(1, inv.repeticiones || 5);
  const vistos = new Set<string>();
  for (const motor of inv.motores) {
    for (const m of inv.maestras) {
      const nativaMax = Math.max(m.w, m.h);
      if (!vistos.has(m.id)) {
        vistos.add(m.id);
        estado.meta.escaleraPorMaestra.push({
          maestra: m.id,
          nativaMax,
          corridas: inv.escalera.filter((l) => l <= nativaMax),
          skipUpscale: inv.escalera.filter((l) => l > nativaMax),
        });
      }
      for (const lado of inv.escalera) {
        if (lado > nativaMax) continue;
        for (let rep = 1; rep <= repeticiones; rep++) {
          corridas.push({
            id: `${motor}-${m.id}-${lado}-r${rep}`,
            motor, maestra: m.id, equipo: m.equipo, doc: m.doc, lado, rep,
          });
        }
      }
    }
  }
  return corridas;
}

// ─────────────────────────────────────────────────────────────────────────────
// Detección del quad del documento (mismo detection-worker que usa la app)
// y preparación de la imagen LIMPIA: downsample al lado pedido → warp con el
// quad → canvas rectificado (lo que el pipeline de producción manda al OCR).
// ─────────────────────────────────────────────────────────────────────────────

let detector: Worker | null = null;
let detectorListo: Promise<void> | null = null;
let detPendiente: { resolve: (m: { type: string; corners?: number[] | null; message?: string }) => void; reject: (e: Error) => void; timer: number } | null = null;
let detResuelto = false;
let detError = "";

function abrirDetector(): Promise<void> {
  if (detectorListo) return detectorListo;
  detectorListo = new Promise((resolve, reject) => {
    const w = new Worker("/_bench/scanner/detection-worker.js");
    const timer = setTimeout(() => reject(new Error("detection-worker: sin ready en 90 s")), 90000);
    w.onmessage = (ev) => {
      const m = ev.data as { type: string; corners?: number[] | null; message?: string };
      if (m.type === "ready") {
        detResuelto = true;
        clearTimeout(timer);
        resolve();
        return;
      }
      if (m.type === "error" && !detResuelto) {
        detError = m.message ?? "error";
        clearTimeout(timer);
        reject(new Error(`detection-worker: ${detError}`));
        return;
      }
      if (!detPendiente) return;
      if (m.type === "result" || m.type === "error") {
        const p = detPendiente;
        detPendiente = null;
        clearTimeout(p.timer);
        p.resolve(m);
      }
    };
    w.onerror = (e) => reject(new Error(`detection-worker onerror: ${e.message}`));
    detector = w;
  });
  detectorListo.catch((e) => { detError = String(e.message ?? e); });
  return detectorListo;
}

const DET_LONG_SIDE = 400; // mismo lado que usa la app para detectar

async function detectarQuad(
  bmp: ImageBitmap,
  longSide = DET_LONG_SIDE,
): Promise<{ quad: Quad | null; msg: { type: string; corners?: number[] | null; message?: string } }> {
  await abrirDetector();
  const largo = Math.max(bmp.width, bmp.height);
  const esc = Math.min(1, longSide / largo);
  const c = canvasCon(Math.round(bmp.width * esc), Math.round(bmp.height * esc));
  const ctx = ctxDe(c);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const mini = await createImageBitmap(c);
  const ts = Date.now() + Math.random();
  const msg = await new Promise<{ type: string; corners?: number[] | null; message?: string }>((resolve, reject) => {
    if (!detector) { reject(new Error("detector no abierto")); return; }
    const timer = window.setTimeout(() => {
      detPendiente = null;
      reject(new Error("detección sin respuesta en 30 s"));
    }, 30000);
    detPendiente = { resolve, reject, timer };
    detector.postMessage({ type: "detect", bitmap: mini, ts }, [mini]);
  });
  if (msg.type === "error") throw new Error(msg.message ?? "error de detección");
  const c8 = msg.corners;
  if (!c8 || c8.length !== 8) return { quad: null, msg };
  // fracciones 0..1 en orden TL,TR,BR,BL (contrato del worker)
  return {
    quad: [
      { x: c8[0], y: c8[1] }, { x: c8[2], y: c8[3] },
      { x: c8[4], y: c8[5] }, { x: c8[6], y: c8[7] },
    ],
    msg,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Preparación de imagen (bitmap cacheado por maestra; canvas fresco por corrida)
// ─────────────────────────────────────────────────────────────────────────────

let bmpActual: { id: string; bmp: ImageBitmap } | null = null;

async function bitmapDe(m: Maestra): Promise<ImageBitmap> {
  if (bmpActual?.id === m.id) return bmpActual.bmp;
  if (bmpActual) { try { bmpActual.bmp.close(); } catch { /* ya cerrado */ } }
  const bmp = await fetchBitmap(`${MAESTRAS}/${encodeURIComponent(m.ruta).replace(/%2F/g, "/")}`);
  bmpActual = { id: m.id, bmp };
  return bmp;
}

async function canvasPara(m: Maestra, lado: number): Promise<HTMLCanvasElement> {
  if (m.sintetica) {
    const s = await cargarSintetica();
    const base = renderSintetica(s);
    const largo = Math.max(base.width, base.height);
    if (lado >= largo) return base;
    const escala = lado / largo;
    const c = canvasCon(Math.round(base.width * escala), Math.round(base.height * escala));
    const ctx = ctxDe(c);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(base, 0, 0, c.width, c.height);
    return c;
  }
  const bmp = await bitmapDe(m);
  const largo = Math.max(bmp.width, bmp.height);
  const escala = Math.min(1, lado / largo);
  const marco = canvasCon(Math.round(bmp.width * escala), Math.round(bmp.height * escala));
  const ctx = ctxDe(marco);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, marco.width, marco.height);
  // Imagen limpia: mismo recorte que producción (warp del quad, sin bw y sin
  // deskew adicional). Si no hubo quad, se mide el marco completo y se marca.
  const quad = estado.meta.quads[m.id] ?? null;
  if (!quad || m.rectificada) return marco;
  const anchoDoc = Math.round(
    ((Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y) +
      Math.hypot(quad[2].x - quad[3].x, quad[2].y - quad[3].y)) / 2) * marco.width,
  );
  if (anchoDoc < 64) return marco;
  try {
    return warpPerspectiva(marco, quad, anchoDoc);
  } catch {
    estado.meta.quads[m.id] = null;
    return marco;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Medición
// ─────────────────────────────────────────────────────────────────────────────

function medirEtiquetas(doc: string, texto: string): { id: string; hit: boolean }[] | undefined {
  const lista = etiquetasJson[doc];
  if (!lista || lista.length === 0) return undefined;
  const t = norm(texto);
  return lista.map((id) => ({ id, hit: t.includes(norm(id)) }));
}

function levenshteinGw(a: string[], b: string[]): number {
  const prev = new Uint16Array(b.length + 1);
  const cur = new Uint16Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + costo);
    }
    prev.set(cur);
  }
  return prev[b.length];
}

function cerWer(gt: string, ocr: string): { cer: number; wer: number } {
  const g = norm(gt);
  const o = norm(ocr);
  const cer = g.length === 0 ? 0 : levenshtein(g, o) / g.length;
  const gw = g.split(" ").filter(Boolean);
  const ow = o.split(" ").filter(Boolean);
  const wer = gw.length === 0 ? 0 : levenshteinGw(gw, ow) / gw.length;
  return { cer: Math.round(cer * 10000) / 10000, wer: Math.round(wer * 10000) / 10000 };
}

// Recorte de rescate (cambio 4): el bloque de cabecera que PSM 3 no segmenta.
function recorteCanvas(
  src: HTMLCanvasElement,
  [x0, y0, x1, y1]: [number, number, number, number],
  escala: number,
): HTMLCanvasElement {
  const sx = Math.round(src.width * x0);
  const sy = Math.round(src.height * y0);
  const sw = Math.max(1, Math.round(src.width * (x1 - x0)));
  const sh = Math.max(1, Math.round(src.height * (y1 - y0)));
  const c = canvasCon(Math.round(sw * escala), Math.round(sh * escala));
  const ctx = ctxDe(c);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}

async function ejecutarCorrida(c: Corrida): Promise<ResultadoCorrida> {
  const m = estado.maestrasPorId.get(c.maestra)!;
  const res: ResultadoCorrida = { ...c, ms: 0, prepMs: 0, heapPicoMB: heapMB(), heapMB: heapMB() };
  const tPrep = performance.now();
  let canvas: HTMLCanvasElement;
  try {
    canvas = await canvasPara(m, c.lado);
  } catch (e) {
    res.error = `prep: ${String((e as Error)?.message ?? e)}`;
    return res;
  }
  res.prepMs = Math.round(performance.now() - tPrep);
  res.limpioW = canvas.width;
  res.limpioH = canvas.height;
  if (!m.sintetica && !estado.meta.quads[m.id]) res.sinQuad = true;
  let pico = heapMB();
  const sampler = setInterval(() => { const h = heapMB(); if (h > pico) pico = h; }, 20);
  const t0 = performance.now();
  try {
    let texto = "";
    let lineas: LineaSalida[] = [];
    if (TESS_SPEC[c.motor]) {
      const spec = TESS_SPEC[c.motor];
      const worker = await tessInit(spec.modelo, spec.lang);
      const imagen = spec.crop ? recorteCanvas(canvas, spec.crop, spec.escala ?? 1) : canvas;
      if (spec.crop) {
        res.cropW = imagen.width;
        res.cropH = imagen.height;
      }
      const r = await tessReconocer(worker, imagen, c.motor, spec.psm, undefined, spec.dpi);
      texto = r.texto;
      res.conf = Math.round(r.conf);
      lineas = r.palabras.map((p) => ({
        texto: p.texto,
        conf: Math.round(p.conf) / 100,
        box: [{ x: p.x0, y: p.y0 }, { x: p.x1, y: p.y0 }, { x: p.x1, y: p.y1 }, { x: p.x0, y: p.y1 }],
      }));
    } else if (EXT_SPEC[c.motor] || EXT_ALIAS[c.motor]) {
      const { ext, crop, escala } = extDe(c.motor)!;
      const imagen = crop ? recorteCanvas(canvas, crop, escala) : canvas;
      if (crop) {
        res.cropW = imagen.width;
        res.cropH = imagen.height;
      }
      const r = await ext.rec(imagen);
      texto = r.texto;
      res.conf = r.conf100;
      lineas = r.lineas;
    } else if (c.motor === "rapid1280" || c.motor === "rapid1920") {
      await rapidInit();
      const detCap = c.motor === "rapid1280" ? 1280 : 1920;
      const r = await rapidReconocer(canvas, { detCap });
      texto = r.texto;
      res.conf = Math.round(r.confMedia * 100);
      res.nBoxes = r.nBoxes;
      res.detMs = Math.round(r.msDet);
      lineas = r.lineas.map((l) => ({ texto: l.texto, conf: Math.round(l.conf * 100) / 100, box: l.box }));
    } else {
      throw new Error(`motor no implementado en este arnés: ${c.motor}`);
    }
    res.ms = Math.round(performance.now() - t0);
    res.chars = texto.replace(/\s+/g, " ").trim().length;
    res.lineasN = lineas.filter((l) => l.texto).length;
    res.texto = texto;
    res.lineas = lineas.slice(0, 400);
    res.etiquetas = medirEtiquetas(c.doc, texto);
    if (m.sintetica) {
      const s = await cargarSintetica();
      const { cer, wer } = cerWer(gtTextoSintetica(s), texto);
      res.cer = cer;
      res.wer = wer;
    }
  } catch (e) {
    res.error = String((e as Error)?.message ?? e).slice(0, 300);
    res.ms = Math.round(performance.now() - t0);
  } finally {
    clearInterval(sampler);
    res.heapPicoMB = Math.max(pico, heapMB());
    res.heapMB = heapMB();
  }
  return res;
}

async function ejecutarLote(n: number): Promise<{ hechos: number; total: number; listo: boolean; errores: number; heapMB: number }> {
  if (!estado.listo) throw new Error("arnés no listo");
  const fin = Math.min(estado.corridas.length, estado.idx + n);
  let errores = 0;
  for (; estado.idx < fin; estado.idx++) {
    const r = await ejecutarCorrida(estado.corridas[estado.idx]);
    if (r.error) errores++;
    estado.resultados.push(r);
  }
  return {
    hechos: estado.idx,
    total: estado.corridas.length,
    listo: estado.idx >= estado.corridas.length,
    errores,
    heapMB: heapMB(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Init: inventario, motores, warmup medido
// ─────────────────────────────────────────────────────────────────────────────

// Familia Tesseract: 3 modelos 4.0.0 (estándar/fast/best) × PSM 3/4/6/11
// (11 = texto disperso, ataca los campos sueltos del recibo) × spa/spa+eng ×
// pista user_defined_dpi. `tess_fast`/`tess_best` (PSM 3, spa) replican las
// filas de referencia de la corrida anterior.
const TESS_SPEC: Record<string, TessSpec> = {
  tess_fast: { modelo: "fast", lang: "spa", psm: "3" },
  tess_best: { modelo: "best", lang: "spa", psm: "3" },
  tess_std: { modelo: "std", lang: "spa", psm: "3" },
  tess_fast_p4: { modelo: "fast", lang: "spa", psm: "4" },
  tess_fast_p6: { modelo: "fast", lang: "spa", psm: "6" },
  tess_fast_p11: { modelo: "fast", lang: "spa", psm: "11" },
  tess_best_p4: { modelo: "best", lang: "spa", psm: "4" },
  tess_best_p6: { modelo: "best", lang: "spa", psm: "6" },
  tess_best_p11: { modelo: "best", lang: "spa", psm: "11" },
  tess_std_p6: { modelo: "std", lang: "spa", psm: "6" },
  tess_std_p11: { modelo: "std", lang: "spa", psm: "11" },
  tess_fast_eng: { modelo: "fast", lang: "spa+eng", psm: "3" },
  tess_best_eng: { modelo: "best", lang: "spa+eng", psm: "3" },
  tess_best_p11_dpi: { modelo: "best", lang: "spa", psm: "11", dpi: 300 },
  // Rescate de cabecera (cambio 4): recorte del bloque «Fecha / N.º Recibo»,
  // PSM 6 a 2× sobre el recorte. Solo para los dos campos que PSM 3 no segmenta.
  tess_header_p6: { modelo: "fast", lang: "spa", psm: "6", crop: [0.30, 0.02, 0.85, 0.25], escala: 2 },
  // Variantes anchas: el recorte estrecho trunca el último carácter del valor
  // («REC-2026-01») y pierde el año de la fecha. Se prueba el bloque completo.
  tess_header_pw: { modelo: "fast", lang: "spa", psm: "6", crop: [0.05, 0.02, 0.95, 0.30], escala: 2 },
  tess_header_pw1: { modelo: "fast", lang: "spa", psm: "6", crop: [0.05, 0.02, 0.95, 0.30], escala: 1 },
  tess_header_p11w: { modelo: "fast", lang: "spa", psm: "11", crop: [0.05, 0.02, 0.95, 0.30], escala: 2 },
  tess_header_bpw: { modelo: "best", lang: "spa", psm: "6", crop: [0.05, 0.02, 0.95, 0.30], escala: 2 },
  // Banda fina medida sobre las cajas reales de la cabecera (las dos líneas de
  // «Fecha» y «N.º Recibo» caen en x 0,60–0,95 · y 0,135–0,195 del rectificado).
  tess_hdr_par: { modelo: "fast", lang: "spa", psm: "6", crop: [0.60, 0.135, 0.95, 0.195], escala: 3 },
  tess_hdr_par_p7: { modelo: "fast", lang: "spa", psm: "7", crop: [0.60, 0.135, 0.95, 0.195], escala: 3 },
  tess_hdr_par_p11: { modelo: "fast", lang: "spa", psm: "11", crop: [0.60, 0.135, 0.95, 0.195], escala: 3 },
  tess_hdr_par_e2: { modelo: "fast", lang: "spa", psm: "6", crop: [0.60, 0.135, 0.95, 0.195], escala: 2 },
};

// Motores de terceros (medición sin molde): init/reconocer normalizados a
// { texto, conf100, lineas }. Si un SDK no carga en Chrome, el warmup lo saca
// de la matriz con motivo (erroresMotor), sin afectar a los demás.
const EXT_SPEC: Record<string, { init: (hilos?: number) => Promise<void>; rec: (img: HTMLCanvasElement) => Promise<ReconExterno> }> = {
  litert: { init: litertInit, rec: litertReconocer },
  paddle_latin: { init: paddleInit, rec: paddleReconocer },
  ffocr: { init: ffocrInit, rec: ffocrReconocer },
  indra_v31: { init: indraInit, rec: indraReconocer },
};

// Alias con pre-proceso: el MISMO recorte de cabecera que usa tess_header_p6,
// pero con el reconocedor que sí segmenta el impreso. Mide el coste de un
// segundo pase acotado (la página entera con litert cuesta 25-43 s en ≤4 GB).
const EXT_ALIAS: Record<string, { base: string; crop: [number, number, number, number]; escala: number }> = {
  litert_header: { base: "litert", crop: [0.3, 0.02, 0.85, 0.25], escala: 2 },
  litert_header_w: { base: "litert", crop: [0.05, 0.02, 0.95, 0.3], escala: 2 },
};
const extDe = (motor: string) => {
  const a = EXT_ALIAS[motor];
  const base = a?.base ?? motor;
  const ext = EXT_SPEC[base];
  return ext ? { ext, crop: a?.crop, escala: a?.escala ?? 1 } : null;
};
const motoresDisponibles = [
  ...Object.keys(TESS_SPEC),
  ...Object.keys(EXT_SPEC),
  ...Object.keys(EXT_ALIAS),
  "rapid1280",
  "rapid1920",
];

async function iniciar(): Promise<void> {
  if (estado.iniciando || estado.listo) return;
  estado.iniciando = true;
  try {
    const r = await fetch(`${GT}/${INV_PARAM}`);
    if (!r.ok) throw new Error(`HTTP ${r.status} ${GT}/${INV_PARAM}`);
    const inv = (await r.json()) as Inventario;
    const desconocidos = inv.motores.filter((x) => !motoresDisponibles.includes(x));
    if (desconocidos.length > 0) throw new Error(`motores sin implementación en el arnés: ${desconocidos.join(", ")}`);
    estado.meta.tessFamilia = Object.fromEntries(inv.motores.filter((m) => TESS_SPEC[m]).map((m) => [m, TESS_SPEC[m]]));
    await cargarEtiquetas();
    await cargarSintetica();
    const usadas = MAESTRA_PARAM
      ? inv.maestras.filter((m) => m.sintetica || m.id === MAESTRA_PARAM)
      : SOLO_RECT
        ? inv.maestras.filter((m) => m.sintetica || m.rectificada)
        : SOLO_PROPIAS
          ? inv.maestras.filter((m) => m.sintetica || m.equipo.toLowerCase().includes(EQUIPO_PARAM))
          : inv.maestras;
    if (MAESTRA_PARAM && !usadas.some((m) => m.id === MAESTRA_PARAM)) {
      throw new Error(`maestra desconocida: ${MAESTRA_PARAM}`);
    }
    estado.corridas = construirPlan({ ...inv, maestras: usadas });
    estado.maestrasPorId = new Map(usadas.map((m) => [m.id, m]));

    // Quad de cada maestra real con el detector de la app (una vez, cacheado
    // por id). La síntesis no pasa por detector: ya es una página recta.
    for (const m of usadas) {
      if (m.sintetica || m.rectificada) continue;
      const t = performance.now();
      try {
        const bmp = await bitmapDe(m);
        estado.meta.quads[m.id] = (await detectarQuad(bmp)).quad;
      } catch (e) {
        estado.meta.quads[m.id] = null;
        estado.meta.detectorError = String((e as Error)?.message ?? e).slice(0, 300);
      }
      estado.meta.deteccionMs[m.id] = Math.round(performance.now() - t);
    }

    // warmup medido por motor (el primero incluye carga de modelos → frío real)
    const sintetica = usadas.find((m) => m.sintetica);
    if (sintetica) {
      const mini = await canvasPara(sintetica, 720);
      for (const motor of inv.motores) {
        const t = performance.now();
        try {
          if (TESS_SPEC[motor]) {
            const spec = TESS_SPEC[motor];
            const worker = await tessInit(spec.modelo, spec.lang);
            const warm = await tessReconocer(worker, mini, motor, spec.psm, undefined, spec.dpi);
            estado.meta.initFrioMs[motor] = Math.round(performance.now() - t);
            estado.meta.calentamientoMs[motor] = Math.round(warm.ms);
          } else if (extDe(motor)) {
            const { ext, crop, escala } = extDe(motor)!;
            await ext.init(HILOS_WASM);
            const miniImg = crop ? recorteCanvas(mini, crop, escala) : mini;
            const t1 = performance.now();
            await ext.rec(miniImg);
            estado.meta.initFrioMs[motor] = Math.round(t1 - t);
            estado.meta.calentamientoMs[motor] = Math.round(performance.now() - t1);
          } else {
            await rapidInit(HILOS_WASM);
            const detCap = motor === "rapid1280" ? 1280 : 1920;
            const warm = await rapidReconocer(mini, { detCap });
            estado.meta.initFrioMs[motor] = Math.round(performance.now() - t);
            estado.meta.calentamientoMs[motor] = Math.round(warm.msDet + warm.msCls + warm.msRec);
          }
        } catch (e) {
          estado.meta.initFrioMs[motor] = -1;
          estado.meta.calentamientoMs[motor] = -1;
          estado.meta.erroresMotor[motor] = String((e as Error)?.message ?? e).slice(0, 300);
          estado.corridas = estado.corridas.filter((c) => c.motor !== motor);
        }
      }
    }
    estado.listo = true;
  } catch (e) {
    estado.error = String((e as Error)?.message ?? e);
  } finally {
    estado.iniciando = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// API pública
// ─────────────────────────────────────────────────────────────────────────────

function resultado(): unknown {
  return {
    meta: {
      arnes: "medicion-resolucion-motores",
      fecha: new Date().toISOString(),
      motores: {
        tesseract: "tesseract.js 7.0.0 — spa 4.0.0_fast y 4.0.0_best (best descargado 2026-11-28)",
        rapidocr: "PP-OCRv4 det/cls/rec — onnxruntime-web 1.31.1 WASM",
        terceros:
          "litert-ocr 0.2.2 (PP-OCRv6-Small LiteRT), ppu-paddle-ocr 6.7.1 (PP-OCRv5 latin mobile, canvas-native), ffocr 0.1.13 (PP-OCRv5 mobile, ORT Web local), ppu-indra-ocr 0.3.0 (Datalab Indra v3.1, lm/math off). Modelos descargados al arnés en el primer init desde CDN/HuggingFace; nunca documentos.",
      },
      nota: "initFrioMs = init del motor + primer reconocimiento en 720; calentamientoMs = reconocimiento de calentamiento (no entra en la matriz). Todas las corridas registradas son calientes. Entrada = imagen limpia: maestra escalada al lado → quad del detection-worker de la app (400 px) → warpPerspectiva sin bw ni deskew; si no hubo quad se midió el marco y se marcó sinQuad.",
      hilosWasm: HILOS_WASM,
      ...estado.meta,
    },
    corridas: estado.corridas.length,
    resultados: estado.resultados,
  };
}

declare global {
  interface Window {
    __ARNES: {
      iniciar: () => Promise<void>;
      estado: () => { listo: boolean; error: string; idx: number; total: number };
      ejecutar: (n: number) => Promise<{ hechos: number; total: number; listo: boolean; errores: number; heapMB: number }>;
      resultado: () => unknown;
      inyectar: (previos: unknown) => void;
      limpia: (id: string, lado: number) => Promise<string>;
      detectar: (id: string, lado?: number) => Promise<unknown>;
    };
  }
}

window.__ARNES = {
  iniciar,
  estado: () => ({ listo: estado.listo, error: estado.error, idx: estado.idx, total: estado.corridas.length }),
  ejecutar: ejecutarLote,
  resultado,
  inyectar: (previos: unknown) => {
    const arr = previos as ResultadoCorrida[];
    if (!Array.isArray(arr)) return;
    estado.resultados = arr.slice();
    estado.idx = Math.min(arr.length, estado.corridas.length);
  },
  // Recorte rectificado que se mide (para inspección visual del dueño).
  limpia: async (id: string, lado: number) => {
    const m = estado.maestrasPorId.get(id);
    if (!m) throw new Error(`maestra no cargada en esta sesión: ${id}`);
    const c = await canvasPara(m, lado);
    return c.toDataURL("image/jpeg", 0.9);
  },
  // Diagnóstico: respuesta cruda del detection-worker sobre una maestra.
  detectar: async (id: string, lado = 400) => {
    const m = estado.maestrasPorId.get(id);
    if (!m) throw new Error(`maestra no cargada en esta sesión: ${id}`);
    const bmp = await bitmapDe(m);
    const r = await detectarQuad(bmp, lado);
    return { ...r.msg, quadOk: r.quad !== null, lado };
  },
};

export {};
