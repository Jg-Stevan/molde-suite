/**
 * rapidocr.ts — BASE del paquete (FASE 3 del mapa v2.3): cuerpo de
 * digielect14 (sin router — el router de S muere en POST-F3) + la SALUD
 * del motor de supervision-e14 (vuelo, reinicio, cola FIFO — "reinicio por
 * inactividad y control de vuelo son salud del motor") + TODO lo adaptativo
 * inyectado por OpcionesPlan (topeThreads, knobsRec).
 *
 * rapidocr.ts — módulo compartido — motor de producción (PROD-2, kit
 * e14-motor-rapidocr-v1) — MOVE literal desde informe/rapidocr.ts
 * (pitfall §9.8 del kit: mismo código, sin «reordenar» ni «limpiar»).
 * KIT e14-fuera-informes-v1 (R-1.5): fuera la instrumentación del informe
 * (import ../informe/telemetria + TODAS las llamadas evento() — el console
 * info de celda queda; cero efecto en el OCR).
 *
 * RapidOCR PP-OCRv4 en el navegador — puerto fiel de rapidocr_onnxruntime
 * 1.4.4 (config del bench: det_limit_side_len=1920, det_limit_type='max').
 * SIN OpenCV (el build vendored del repo es un binding custom sin
 * minAreaRect): el postproceso de detección (DB) es JS puro —
 * binarización 0.3 → dilate 2×2 → CCL 4-conectividad → convex hull →
 * min-area rect por barrido de aristas → box_score_fast → unclip →
 * esquinas TL,TR,BR,BL → mapeo inverso a coords de la fuente.
 *
 * Determinismo: executionProviders ["wasm"] (igual que el bench); WebGPU
 * disponible en el dispositivo queda anotado en el log del entorno pero NO
 * se usa.
 */

// KIT e14-observabilidad-v1 (A1-C7): tope de threads OCR = flag del mantenedor
// (kill switch MANUAL — ocrThreadsTope, default 4 = el literal que vivía
// aquí). La app NUNCA cambia reglas de negocio sola (D6).
// NOTA (eliminación del módulo masiva): la lectura EFECTIVA vía gama.ts
// (capa adaptativa del kit e14-gama-adaptativa-v1) se retiró con el módulo
// — el tope vuelve a leer el flag puro de siempre.

// FASE 3 (§3.3): publicBase por entorno inyectado (mismo default que el core).
import { publicBaseEfectivo } from "../dominio/entorno";
import { medidasDeCaja } from "./crop-geometria";
// KIT e14-post-det-worker-v1 (R-45, 2026-11-19): el postproceso DB del det
// corre en el WORKER db-postprocess.worker.js (cliente db-postprocess-client.ts
// — fallback local al módulo puro). `OpsDet` es el tipo CANÓNICO del módulo
// puro: preDet produce este registro y el worker lo consume — importado de
// allí (antes duplicado aquí; el módulo puro es la fuente).
import type { OpsDet } from "./db-postprocess";
import { dbPostprocessRemoto } from "./db-postprocess-client";

// ─── Tipos ORT mínimos (el módulo se importa dinámicamente) ─────────────────

interface OrtValue {
  dims: readonly number[];
  data: Float32Array | Int32Array | Uint8Array | BigInt64Array;
  type: string;
}
interface OrtSession {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(feeds: Record<string, OrtValue>): Promise<Record<string, OrtValue>>;
}
interface OrtModule {
  env: {
    wasm: {
      wasmPaths: string;
      numThreads: number;
      simd: boolean;
      proxy: boolean;
    };
  };
  Tensor: new (type: "float32", data: Float32Array, dims: number[]) => OrtValue;
  InferenceSession: {
    create(uri: string, opts?: { executionProviders: string[] }): Promise<OrtSession>;
  };
}

export interface RapidOcrLinea {
  texto: string;
  conf: number;
  box: { x: number; y: number }[];
}

export interface RapidOcrResultado {
  lineas: RapidOcrLinea[];
  texto: string;
  confMedia: number;
  msDet: number;
  msCls: number;
  msRec: number;
  /** KIT e14-velocidad-5s-v1 — despiece de `msRec`: `msRunRec` = tiempo ES
   *  esperando el `run()` (wasm + el viaje del output de ~19 MB por lote con
   *  `proxy: true`); la resta (`msRec − msRunRec`) es hilo principal puro
   *  (getImageData + normalizar tensores + CTC decode). Sin este despiece el
   *  acta no dice si conviene más de un hilo wasm, menos W o menos líneas. */
  msRunRec: number;
  /** KIT e14-remediacion-movil-v1 (B3 — P1 #9): ms del RECORTE por caja
   *  (drawImage de la fuente). Antes era un tramo mudo entre det y cls —
   *  con C2 solo paga lo que se lee, y con este campo la atribución cierra
   *  (det + cls + rec + crops explica ≥ 97 % de ocrMs). */
  msCrops: number;
  nBoxes: number;
}

export interface RapidRuntime {
  ort: OrtModule;
  det: OrtSession;
  cls: OrtSession;
  rec: OrtSession;
  dict: string[];
}

// ─── Init (singleton — el 2.º informe no re-descarga nada) ──────────────────

let rtSingleton: Promise<RapidRuntime> | null = null;

export function rapidOcrInit(): Promise<RapidRuntime> {
  if (!rtSingleton) {
    rtSingleton = initReal().catch((e) => {
      rtSingleton = null; // reintentable
      throw e;
    });
  }
  return rtSingleton;
}

// KIT e14-prowarm-ocr-v1 (T1): pre-warm REAL de la sesión RapidOCR —
// rapidOcrInit() crea las sesiones pero NUNCA infiere; la 1.ª acta real
// pagaba ~27 s de frío (35.9 s OCR vs 8.3 s caliente, informe 19/10).
// Esto corre UNA inferencia dummy sobre canvas sintético por det+cls+rec
// y DESCARTA el resultado (§0.2). NUNCA llamar aquí a reconocerRapidOcr
// del bridge (contaminaría ultimoOcr* — §0.3): rapidOcrReconocer directo.
let prewarmHecho: Promise<boolean> | null = null;

export function rapidOcrPrecalentar(): Promise<boolean> {
  if (prewarmHecho) return prewarmHecho; // 1 sola vez por carga de página
  prewarmHecho = (async () => {
    try {
      const rt = await rapidOcrInit(); // MISMO singleton — el calor queda
      const c = canvasCon(640, 480); // SPRINT-A A3 — factory
      const ctx = ctxDe(c);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, 640, 480);
      ctx.fillStyle = "#000000";
      ctx.font = "bold 48px monospace";
      ctx.fillText("E14 WARM-UP", 40, 120);
      ctx.font = "bold 36px monospace";
      ctx.fillText("PUESTO 01 20261019123055", 40, 240);
      ctx.fillText("TRANSMISION 98.7% 15:30:22", 40, 340);
      const dataUrl = c.toDataURL("image/png");
      const r = await rapidOcrReconocer(rt, dataUrl); // resultado DESCARTADO
      logger.info(
        `[e14-prowarm] listo det=${r.msDet}ms cls=${r.msCls}ms rec=${r.msRec}ms · ${r.nBoxes} cajas · ${r.lineas.length} líneas`,
      );
      return true;
    } catch (e) {
      // Frío como hoy: el pipeline NO depende de esto (fallback honesto).
      logger.info(
        `[e14-prowarm] fallo (continua como hoy): ${e instanceof Error ? e.message : String(e)}`,
      );
      return false;
    }
  })();
  return prewarmHecho;
}

async function initReal(): Promise<RapidRuntime> {
  const ort = (await import("onnxruntime-web/wasm")) as unknown as OrtModule;
  ort.env.wasm.wasmPaths = `${publicBaseEfectivo()}/vendor/onnxruntime/`;
  // KIT e14-adaptacion-dispositivo-v1 — hilos RESUELTOS por el plan adaptativo
  // (adaptacion/plan.ts · numThreadsOcrEfectivos): SAB+COOP/COEP exigidos
  // (sin ellos 1 hilo — igual que siempre); dentro, prioridad D6:
  //   override MANUAL del mantenedor (ocrThreadsTope) > plan por tier (BAJO 2 ·
  //   MEDIO 3 · ALTO 6 — exprimar en gama alta, proteger en baja) > default 4.
  // Cap SIEMPRE por hardwareConcurrency. `adaptacionDispositivo: false`
  // ⇒ byte-idéntico al comportamiento histórico (default 4).
  // AUDITORIA-e14-v1: consumo medido 2,8 de 8 núcleos ⇒ numThreads no surte
  // efecto con el proxy (ORT mueve los kernels a un thread pool interno).
  // Forzamos 6 hilos ALTO + registro observable desde el dispositivo.
  const hilos = opcionesPlan.topeThreadsOcr();
  ort.env.wasm.numThreads = hilos;
  try {
    (window as unknown as { __E14_ORT_CONFIG__?: unknown }).__E14_ORT_CONFIG__ = { numThreads: hilos, proxy: true, simd: true };
  } catch {
    // Hook global de diagnóstico (window falta en node/SSR): sin él el motor corre IGUAL — es solo una ventana de inspección, cero comportamiento.
  }
  ort.env.wasm.simd = true;
  // KIT e14-optimizacion-v1 (T2, hallazgo #2 de AUDITORIA-e14-v1): proxy=true
  // migra det/cls/rec al worker interno de ORT — la inferencia (9.8-14.3 s)
  // deja de bloquear el main thread y el progreso de ANALIZANDO deja de
  // congelarse. MISMO EP wasm (opts de abajo), MISMO wasm, MISMO resultado.
  // numThreads queda como está: 1 en GH Pages (no hay SAB) — el proxy NO
  // requiere SAB. Revertible en 1 línea si la verificación falla (kit §3-T2.2).
  // NOTA merge D68-merge (AI Studio): el export de AI Studio trajo proxy=false
  // («error de resolución dynamic import en bundler») — workaround AMBIENTAL de
  // ese sandbox; producción (GH Pages/Vercel) verificada con proxy=true. Se
  // restaura aquí; si AI Studio lo necesita, revertir SOLO en ese entorno.
  ort.env.wasm.proxy = true;

  const opts = { executionProviders: ["wasm"] };
  const REC_URL = `${publicBaseEfectivo()}/models/rapidocr/ch_PP-OCRv4_rec_infer.onnx`;
  // Una sola sesión por modelo. La variante con DOS sesiones del mismo rec
  // (dos workers `proxy` repartiéndose los lotes) se midió y se descartó: el
  // A56 ya está a 7,7 de 8 núcleos con UNA, así que la segunda no encuentra
  // CPU libre y solo paga el heap extra y el init (otra descarga+deshielo del
  // .onnx en el primer escaneo). Ver el bloque de knobs del rec abajo.
  const [det, cls, rec, dictResp] = await Promise.all([
    ort.InferenceSession.create(`${publicBaseEfectivo()}/models/rapidocr/ch_PP-OCRv4_det_infer.onnx`, opts),
    ort.InferenceSession.create(
      `${publicBaseEfectivo()}/models/rapidocr/ch_ppocr_mobile_v2.0_cls_infer.onnx`,
      opts,
    ),
    ort.InferenceSession.create(REC_URL, opts),
    fetch(`${publicBaseEfectivo()}/models/rapidocr/ppocr_keys.txt`),
  ]);
  if (!dictResp.ok) throw new Error(`ppocr_keys.txt HTTP ${dictResp.status}`);
  // `/\r?\n/` y NO `"\n"`: con autocrlf de Windows el checkout del .txt llega con
  // CRLF al working tree (dev sirve esos bytes; el build publica el blob, que es
  // LF). Partiendo solo por LF cada token sale con su `\r` pegado y `ctcDecode`
  // lo pega entre letra y letra («C\rO\rN\rS\rU\rL\rA...»): el texto parece
  // legible pero NINGUNA ancla de `senal-lectura.ts` matchea. Medido en el
  // hermano: 6/6 RECHAZADA en el camino navegador (supervision-e14, misma
  // línea con el mismo fix).
  const dict = (await dictResp.text()).split(/\r?\n/).filter((l) => l.length > 0);
  return { ort, det, cls, rec, dict };
}

// ─── Salud del motor (FASE 3 — de supervision-e14; sobrevive al router) ────
// KIT selector-motor-v1 fase 5 — REINICIO SEGURO: un contador de
// reconocimientos en vuelo impide soltar las sesiones bajo los pies de una
// inferencia. Los probes de ~centenas de ms (orientación/rec-lote) quedan
// fuera del conteo a propósito: una carrera ahí se auto-repara.
let reconocimientosEnVuelo = 0;

/** true si hay una inferencia det→cls→rec en vuelo (consulta barata). */
export function ocrEnVuelo(): boolean {
  return reconocimientosEnVuelo > 0;
}

// ─── KIT ocr-cola-global-v1 (de S) — UN SOLO cliente ORT a la vez ───────────
// Con pool≥2 dos actas llaman al MISMO singleton y sus session.run() se
// solapan: la segunda inferencia concurrente no regresa JAMÁS (gpu8/gpu13).
// La cola serializa el GPU (UN device) y el otro acta corre lo CPU que sí
// es paralelo (warp, decode, QR). Kill-switch inyectado (default false =
// default histórico).
let turnoOcr: Promise<unknown> = Promise.resolve();

/** Acumulador de ESPERA del turno FIFO, UNO POR ACTA (lo crea el pipeline).
 *  Objeto y no contador de módulo: con pool 2 un acumulador global le
 *  asignaría a una acta la espera de la otra. */
export interface EsperaOcrSink {
  ms: number;
}

async function conTurnoOcr<T>(fn: () => Promise<T>, sink?: EsperaOcrSink): Promise<T> {
  const tPedido = performance.now();
  const arrancar = () => {
    if (sink) sink.ms += performance.now() - tPedido;
    return fn();
  };
  const turno = turnoOcr.then(arrancar, arrancar);
  // La cola nunca se encona con un rechazo: el siguiente entra igual.
  turnoOcr = turno.then(
    () => undefined,
    () => undefined,
  );
  return turno;
}

/** Cola global inyectada por la app (S: flags.ocrColaGlobal · D: no usa). */
let colaGlobalOcr: () => boolean = () => false;
export function configurarColaGlobalOcr(activa: () => boolean): void {
  colaGlobalOcr = activa;
}
const colaOcrActiva = (): boolean => {
  try {
    return colaGlobalOcr();
  } catch {
    // Flag inyectada por la app rota ⇒ cola OFF (default histórico): el OCR serializa en su propia cola, sin lanzar.
    return false;
  }
};

/** Soltar el runtime (release de cada sesión si la build de ORT lo expone). */
async function soltarRuntime(rt: RapidRuntime): Promise<void> {
  const sesiones = [rt.det, rt.cls, rt.rec] as Array<
    OrtSession & { release?: () => unknown }
  >;
  for (const s of sesiones) {
    try {
      await s.release?.();
    } catch {
      /* sesión ya muerta — seguir con la siguiente */
    }
  }
}

/** D65 — soltar el runtime OCR (watchdog/APLICAR AHORA): release de cada
 *  sesión, luego el singleton FUERA → la próxima rapidOcrInit() re-crea
 *  TODO. El pre-warm también cae. NUNCA lanza. (El motor Tesseract, si lo
 *  usa la app, lo reinicia SU wrapper — el paquete no lo acopla aquí.) */
export async function rapidOcrReiniciar(): Promise<void> {
  if (!rtSingleton) return;
  try {
    await soltarRuntime(await rtSingleton);
  } catch {
    /* best-effort */
  }
  rtSingleton = null;
  prewarmHecho = null;
}

/** Reinicio del motor para la UI: rechaza si hay OCR corriendo (false — la
 *  corrida manda); true = reiniciado o sin motor iniciado. Jamás lanza. */
export async function reiniciarMotorOcrSiInactivo(): Promise<boolean> {
  try {
    if (reconocimientosEnVuelo > 0) return false;
    if (!rtSingleton) return true;
    await rapidOcrReiniciar();
    return true;
  } catch {
    // Reinicio best-effort: cualquier fallo ⇒ false (no reiniciado) — la corrida en curso manda, jamás lanza a la UI (docblock).
    return false;
  }
}

// ─── Utilidades de imagen ───────────────────────────────────────────────────

// SPRINT-A (perf/decode-once-v1) A2: el loadImage privado (decode <img> sin
// memo — usos en reconocerRapidOcr y rapidOcrCropsOrientacion) se SUSTITUYE
// por loadImageMemo del repo: el probe de orientación y la pasada-1 del
// escalonado consumen la MISMA dataUrl → decode UNA vez (el det ya hacía HIT
// por D62 — ahora también el decode). Verificado contra la eviction tope 2:
// entre probe → pasada-1 → pasada-2 del escalonado solo viven fotoOriginal y
// fotoProcesada en la memo → la imagen del acta en vuelo NO se desaloja
// (máx 2 entradas en la ruta del OCR); el re-OCR de la banda corre DESPUÉS
// de la elección, sin dependencia con la entrada viva.
import { canvasCon, loadImageMemo } from "../dominio/image-utils";
import { opcionesPlan } from "../dominio/plan";
import { logger } from "../dominio/logger"; // SPRINT-A A6 — console→logger (mensajes byte-idénticos)

function canvasDe(img: HTMLImageElement | HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  const c = canvasCon(w, h); // SPRINT-A A3 — factory
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);
  return c;
}

const round32 = (v: number) => Math.max(32, Math.round(v / 32) * 32);

function ctxDe(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas 2d no disponible");
  return ctx;
}

// ─── KIT e14-ocr-escalonado-v1 (§2.1): cap del det-preprocess (op4) ──────────
// La sesión det NO cambia (mismos pesos — el cap es del preprocess op4, NO del
// modelo ni de una sesión nueva): DET_CAP_PROD=1920 es el comportamiento de
// HOY byte a byte (config det_limit_side_len=1920, det_limit_type='max');
// DET_CAP_RAPIDO=1280 es la 1.ª pasada del OCR escalonado (banco B3 GO:
// det −56%, 120/120 votos, 0 cajas perdidas — banco det1280 del PR #34 — decisión D53).
// op1 (reduce_max_side 1920) queda INTACTO: es el preprocess fijo del paquete,
// det_limit_side_len es el parámetro que op4 implementa.
export const DET_CAP_PROD = 1920;
export const DET_CAP_RAPIDO = 1280;

// ─── KIT e14-rec-wmax480-v1 (bench v8.5): cap del ancho del tensor rec ──────
// El run() WASM del rec escala con n×wmax (floats del tensor [b,3,h,wmax]),
// NO con los píxeles del crop — medido ~0.56 ms/unidad constante en Q2–Q4
// (bench v8.5, 70 lotes). El techo 480 da: rec full media 10,733→8,729 ms
// (−19%), RapidOCR full 12,150→10,093 ms (−17%), peor caso 16.0→11.8 s
// (−26%), outliers 51.2s/41.2s/34.6s MUERTOS (max 1,760 ms) y calidad
// 7/7 gt ×4/4 intacta — tensorDeCanvases hace squish horizontal (rw=
// min(natural, targetW) con pad de ceros), NO truncado: líneas naturales
// hasta 864 sobrevivieron sin pérdida. Aplicado en AMBOS rec (producción y
// probe §2.1) para mantener el pre/post idéntico.
// ─── KIT e14-velocidad-5s-v1 (fase rec): los tres knobs SON FLAGS ──────────
// WMAX/ALTURA/LOTE salen de `leerFlags()` (default = HOY byte a byte) porque
// la única palanca que queda es HACER MENOS CÁLCULO: medido con /proc/stat
// DURANTE la corrida en el A56, el rec deja el celu a 7,7 de 8 núcleos
// (los 4 núcleos grandes clavados en 1,00). Sesiones hermanas, hilos 3→6 y 2
// lotes en vuelo quedaron PROBADOS Y DESCARTADOS: sin holgura de CPU, mover
// el trabajo de worker no lo hace más barato. El costo es ~ n·h·W (y la
// salida [n,T,6623] con T ∝ W) ⇒ W y h son las perillas; el ONNX del rec
// acepta altura DINÁMICA (verificado en node: [1,3,h,320] corre para
// h=32/40/48/56 y T queda 40 — la altura SOLO mueve las conv, no el CTC).
// WMIN = 320: aun con h baja, el tensor no se acorta de lo que PaddleOCR usa
// de fábrica (T=40 pasos — el pad de ceros ya estaba en el diseño).
import { ANCLAS_LECTURA } from "../dominio/senal-lectura";

/** Las 10 anclas estructurales del acta contadas sobre un texto YA leído — la
 *  MISMA lista (`ANCLAS_LECTURA`) que usa la señal de lectura del score, para
 *  que la decisión de "esto ya es un acta identificada" sea la misma en los dos
 *  sitios. Puro y barato: 10 regex sobre ~600 caracteres. */
function contarAnclas(texto: string): number {
  return ANCLAS_LECTURA.filter(([, re]) => re.test(texto)).length;
}

/** Los tres knobs del tensor del rec (flags de la app — default = HOY). Una
 *  sola lectura por pasada: el probe de orientación y la pasada del bridge
 *  llaman a `recKnobs()` y quedan con el MISMO pre/post (la conf cruda tiene
 *  que seguir siendo comparable entre motores). */
export function recKnobs(): {
  anchoMax: number;
  alto: number;
  lote: number;
  suave: boolean;
  wFija: boolean;
  cabecera: number;
  pie: number;
  bordesRescate: number;
} {
  const f = opcionesPlan.knobsRec();
  return {
    anchoMax: f.anchoMax,
    alto: f.alto,
    lote: f.lote,
    suave: f.suave,
    wFija: f.wFija,
    cabecera: f.cabecera,
    pie: f.pie,
    bordesRescate: f.bordesRescate,
  };
}

// ─── Pre-det (main.py fidelidad: reduce_max → increase_min → letterbox →
//     det-preprocess round32) + registro de ops para mapear de vuelta ───────

// KIT e14-ocr-escalonado-v1 (§2.1): cap PARAMETRIZABLE — default DET_CAP_PROD
// (byte a byte el flujo de hoy); el OCR escalonado pasa DET_CAP_RAPIDO en la
// 1.ª pasada.
function preDet(
  src: HTMLImageElement,
  cap: number = DET_CAP_PROD,
): { canvas: HTMLCanvasElement; ops: OpsDet } {
  let w = src.naturalWidth || src.width;
  let h = src.naturalHeight || src.height;
  let ratioW = 1;
  let ratioH = 1;

  // op1 — reduce_max_side(img, 1920): int(h*ratio) luego round32 cada lado
  if (Math.max(h, w) > 1920) {
    const ratio = 1920 / Math.max(h, w);
    const nh = round32(Math.floor(h * ratio));
    const nw = round32(Math.floor(w * ratio));
    ratioW *= nw / w;
    ratioH *= nh / h;
    w = nw;
    h = nh;
  }

  // op2 — increase_min_side(img, 30): idem con el lado menor
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

  // op3 — maybe_add_letterbox: h ≤ 30 o w/h > 8 → pads arriba/abajo negros.
  //   padding_h = int(abs(max(int(w/8), 30) * 2 − h) / 2)   [main.py L161-164]
  let padTop = 0;
  let canvasPadded = imgEsc;
  const widthHeightRatio = 8;
  const minHeight = 30;
  if (h <= minHeight || w / h > widthHeightRatio) {
    const newH = Math.max(Math.floor(w / widthHeightRatio), minHeight) * 2;
    padTop = Math.floor(Math.abs(newH - h) / 2);
    const padded = canvasCon(w, h + padTop * 2); // SPRINT-A A3 — factory
    const pctx = ctxDe(padded);
    pctx.fillStyle = "#000000";
    pctx.fillRect(0, 0, padded.width, padded.height);
    pctx.drawImage(imgEsc, 0, padTop);
    canvasPadded = padded;
    h = padded.height;
  }

  // op4 — det-preprocess (limit <cap> max + round32 SIEMPRE, mínimo 32) —
  //   cap=DET_CAP_PROD (1920) = producción de hoy byte a byte; 1280 = 1.ª
  //   pasada del escalonado (banco B3: −56% det, 0 votos perdidos).
  const ratioDet = Math.max(h, w) > cap ? cap / Math.max(h, w) : 1;
  const dh = round32(Math.floor(h * ratioDet));
  const dw = round32(Math.floor(w * ratioDet));
  const detIn = canvasDe(canvasPadded, dw, dh);

  return {
    canvas: detIn,
    ops: { w: dw, h: dh, ratioW, ratioH, padTop, ratioWDet: dw / w, ratioHDet: dh / h },
  };
}

// KIT e14-post-det-worker-v1 (R-45, 2026-11-19): el postproceso DB y sus
// auxiliares (consts DB_*/MIN_*, mapearAFuente, Rect, convexHull,
// minAreaRect, boxScoreFast, esquinasRect, ordenarCajas) viven en
// src/ocr/db-postprocess.ts (módulo puro — transcripción literal del bloque
// que corría inline en inferDet) y corren en el WORKER
// db-postprocess.worker.js vía dbPostprocessRemoto — borrados de aquí tras
// el rewiring (0 referencias restantes, verificado con rg). TEXT_SCORE se
// queda: es del filtro de conf del REC.
const TEXT_SCORE = 0.5;

// ─── Crops, cls, rec ────────────────────────────────────────────────────────

function cropLinea(
  src: HTMLImageElement,
  box: { x: number; y: number }[],
): { canvas: HTMLCanvasElement; ratio: number } {
  const [p0, p1] = box;
  // Las medidas salen del helper COMPARTIDO con el ratio del filtro `leibles`
  // (H5): una sola fórmula de geometría. El canvas redondea a píxel.
  const { w, h } = medidasDeCaja(box);
  const cropW = Math.max(1, Math.round(w));
  const cropH = Math.max(1, Math.round(h));
  const theta = Math.atan2(p1.y - p0.y, p1.x - p0.x);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const canvas = canvasCon(cropW, cropH); // SPRINT-A A3 — factory
  const ctx = ctxDe(canvas);
  // get_rotate_crop_image equivalente: la matriz del contexto transforma
  // coords de la FUENTE → coords del CANVAS (inversa de [R|p0]): rotación
  // −θ y traslación −R·p0 — así la caja queda pegada al origen del canvas
  // y la imagen se dibuja 1:1 (la ventana cropW×cropH recorta el rect).
  // (v1 tenía el transform al revés: el dibujo caía fuera del canvas →
  // crops transparentes y rec vacío — bug v1.)
  const e = -cos * p0.x - sin * p0.y;
  const f = sin * p0.x - cos * p0.y;
  ctx.setTransform(cos, -sin, sin, cos, e, f);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(src, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return { canvas, ratio: cropW / cropH };
}

// KIT e14-velocidad-5s-v1 — rama SUAVE del remuestreo (`ocrRecSuave`). El
// recorte llega a resolución NATIVA del acta (líneas de 40-70 px), así que
// cuando `alto` baja de esa altura el nearest de siempre no interpola: elige
// UNA fila cada ch/h y DESCARTA las demás — la red ve trazos partidos y las
// anclas caen (medido: h=32/40 con nearest perdía anclas y escalaba la
// cascada). `drawImage` con `imageSmoothingQuality: "high"` remuestrea con
// filtro de área/bilineal: la misma altura baja, pero con la línea entera.
// false = ruta de hoy, byte a byte.
let lienzoSuave: HTMLCanvasElement | null = null;

function pixelesSuaves(c: HTMLCanvasElement, rw: number, h: number): Uint8ClampedArray {
  let tmp = lienzoSuave;
  if (!tmp) tmp = lienzoSuave = canvasCon(rw, h);
  if (tmp.width !== rw || tmp.height !== h) {
    // Cambiar el tamaño del canvas RESETA el estado del contexto (incluidos
    // los flags de suavizado) — por eso el smoothing se fija DESPUÉS.
    tmp.width = rw;
    tmp.height = h;
  }
  const ctx = ctxDe(tmp);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(c, 0, 0, c.width, c.height, 0, 0, rw, h);
  return ctx.getImageData(0, 0, rw, h).data;
}

function tensorDeCanvases(
  ort: OrtModule,
  canvases: HTMLCanvasElement[],
  targetW: number,
  h: number,
  suave = false,
): OrtValue {
  const b = canvases.length;
  const data = new Float32Array(b * 3 * h * targetW);
  for (let i = 0; i < b; i++) {
    const c = canvases[i];
    const { width: cw, height: ch } = c;
    // resize PaddleOCR: h fija (knob `ocrRecAltura`), ancho objetivo
    // min(ceil(h·ratio), targetW) (pad de ceros a la derecha — el buffer ya
    // nace en 0).
    const rw = Math.min(Math.max(1, Math.ceil((h * cw) / ch)), targetW);
    const base = i * 3 * h * targetW;
    const paso = h * targetW;
    if (suave) {
      // El ImageData YA tiene el tamaño del destino ⇒ copia directa (el
      // remuestreo lo hizo el filtro del canvas, no este bucle).
      const px = pixelesSuaves(c, rw, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < rw; x++) {
          const idx = (y * rw + x) * 4;
          const o = base + y * targetW + x;
          data[o] = (px[idx + 2] / 255 - 0.5) / 0.5; // B
          data[o + paso] = (px[idx + 1] / 255 - 0.5) / 0.5; // G
          data[o + 2 * paso] = (px[idx] / 255 - 0.5) / 0.5; // R
        }
      }
      continue;
    }
    const ctx = ctxDe(c);
    const img = ctx.getImageData(0, 0, cw, ch);
    for (let y = 0; y < h; y++) {
      const sy = Math.min(ch - 1, Math.floor((y * ch) / h));
      for (let x = 0; x < rw; x++) {
        const sx = Math.min(cw - 1, Math.floor((x * cw) / rw));
        const idx = (sy * cw + sx) * 4;
        const o = base + y * targetW + x;
        data[o] = (img.data[idx + 2] / 255 - 0.5) / 0.5; // B
        data[o + paso] = (img.data[idx + 1] / 255 - 0.5) / 0.5; // G
        data[o + 2 * paso] = (img.data[idx] / 255 - 0.5) / 0.5; // R
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

/** CTC decode: argmax por t; colapsar repetidos; ignorar blank (0);
 *  1..6622 → dict[idx-1]; 6623 → " "; conf = media de las probs softmax de
 *  los tokens seleccionados (CTCLabelDecode del paquete). */
function ctcDecode(
  tensor: OrtValue,
  dict: string[],
): { texto: string; conf: number } {
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
      if (v > mejorV) {
        mejorV = v;
        mejor = c;
      }
    }
    if (mejor !== 0 && mejor !== ultimo) {
      // conf = prob del token: el ONNX del rec ya sale con softmax (igual que
      // el paquete: preds.max(axis=2) sin re-normalizar — el doble softmax
      // con shift aplastaba la conf a ~0 y descartaba TODAS las líneas).
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

// ─── Inferencia det ─────────────────────────────────────────────────────────

interface DetSalida {
  boxesFuente: { x: number; y: number }[][];
  msDet: number;
  nBoxes: number;
  /** D62 T2 — SOLO en HIT del memo: ms de det que esta llamada NO pagó
   *  (los pagó el probe sobre el MISMO bitmap). Ausente = miss/computo. */
  memoMsAhorrado?: number;
}

// ─── KIT e14-probe-adaptativo-v1 (D62 T2): memo del det por identidad ────────
// Cuando el probe NO aplica rotación (aplicado=0), el det a 1280 del probe
// (rapidOcrCropsOrientacion) y el det a 1280 de la pasada-1 del escalonado
// (rapidOcrReconocer con detCap=DET_CAP_RAPIDO) corren sobre el MISMO bitmap —
// el segundo es gratis si se memoiza. Clave = el PROPIO string dataURL de
// entrada (identidad exacta: rotar ⇒ re-encode ⇒ string distinto ⇒ miss
// natural, cero ramas especiales) + cap (en producción 1920 la clave jamás
// matchea la del probe 1280 ⇒ sin cambio de comportamiento). GUARD HONESTO:
// el memo JAMÁS decide score/gate — devuelve el MISMO resultado que computaría
// det (determinismo wasm: mismo bitmap + mismo cap ⇒ mismo boxesFuente/msDet;
// se devuelve la MISMA referencia). Tope 2 entradas: insertar desplaza la más
// vieja (probe y pasada-1 son consecutivos; nunca coexisten más). El memo es
// solo de ejecución (no persiste) y no corre en SIM (el probe no corre allí —
// guard del bridge; si otra vía alimenta el memo, devuelve lo mismo que
// computaría — inofensivo).
interface DetMemoEntrada {
  cap: number;
  boxesFuente: { x: number; y: number }[][];
  msDet: number;
  nBoxes: number;
}

const DET_MEMO_TOPE = 2;
const detMemo = new Map<string, DetMemoEntrada>();

function detMemoGuardar(clave: string, entrada: DetMemoEntrada): void {
  if (detMemo.size >= DET_MEMO_TOPE) {
    const masVieja = detMemo.keys().next().value; // 1.ª insertada = más vieja
    if (masVieja !== undefined) detMemo.delete(masVieja);
  }
  detMemo.delete(clave); // si la clave ya estaba (otro cap), renueva posición
  detMemo.set(clave, entrada);
}

async function inferDet(
  rt: RapidRuntime,
  src: HTMLImageElement,
  cap: number = DET_CAP_PROD,
  // D62 T2 — identidad del bitmap de origen (dataURL) para el memo; los 2
  // callers la pasan (reconocer + cropsOrientacion). Ausente = sin memo.
  claveOrigen?: string,
): Promise<DetSalida> {
  // D62 T2 — HIT: el probe ACABA de computar este mismo det (mismo dataURL +
  // mismo cap, aplicado=0). Devuelve el MISMO resultado que computaría det —
  // jamás decide score/gate. Los "det run" no se emiten (no corrió aquí).
  if (claveOrigen != null) {
    const hit = detMemo.get(claveOrigen);
    if (hit !== undefined && hit.cap === cap) {
      return {
        boxesFuente: hit.boxesFuente,
        msDet: hit.msDet,
        nBoxes: hit.nBoxes,
        memoMsAhorrado: hit.msDet,
      };
    }
  }
  const t0 = performance.now();
  const { canvas, ops } = preDet(src, cap);
  const ctx = ctxDe(canvas);
  const { width: w, height: h } = canvas;
  const img = ctx.getImageData(0, 0, w, h);
  // PaddleOCR trabaja en BGR (cv2) — los ONNX del PP-OCRv4 esperan ese orden.
  const data = new Float32Array(w * h * 3);
  for (let i = 0, px = 0; i < img.data.length; i += 4, px++) {
    data[px] = (img.data[i + 2] / 255 - 0.5) / 0.5; // B
    data[w * h + px] = (img.data[i + 1] / 255 - 0.5) / 0.5; // G
    data[2 * w * h + px] = (img.data[i] / 255 - 0.5) / 0.5; // R
  }
  const tensor = new rt.ort.Tensor("float32", data, [1, 3, h, w]);
  logger.info(`[e14-rapidocr] det run [1,3,${h},${w}]...`);
  const res = await rt.det.run({ [rt.det.inputNames[0]]: tensor });
  logger.info(`[e14-rapidocr] det run OK (${Math.round(performance.now() - t0)}ms)`);
  const out = res[rt.det.outputNames[0]];
  const pred = out.data as Float32Array;
  const pw = out.dims[3];
  const ph = out.dims[2];
  // KIT e14-post-det-worker-v1 (R-45, 2026-11-19): el postproceso DB
  // (binarizar > 0.3 → dilate 2×2 → CCL → hull → min-area rect → score →
  // unclip → esquinas + mapeo) corría INLINE aquí — un único bloque síncrono
  // de hasta 7,25 s medidos que congelaba el hilo principal. Ahora corre en
  // el WORKER db-postprocess.worker.js vía dbPostprocessRemoto: MISMO módulo
  // puro (db-postprocess.ts, transcripción literal caracterizada por el test
  // del supervisor), MISMO contrato {boxesFuente, nBoxes}; `ops` es el
  // registro EXACTO que preDet produce (el mismo shape que consumía el
  // bloque inline). Worker ausente/roto/vencido ⇒ el módulo puro corre
  // local (jamás throw, jamás reintento tras rotura — doctrina del
  // conservador). SIN transfer list: el fallback local necesita `pred`
  // vivo y el memo DetMemoEntrada guarda DetSalida (NUNCA pred — verificado).
  const post = await dbPostprocessRemoto(pred, pw, ph, ops, src.naturalWidth, src.naturalHeight);
  // msDet cierra al RECIBIR el resultado del worker: preDet + det.run + post
  // completo (la fase det ES esto — el round-trip del post entra en su
  // medición, misma semántica observable de fase, ahora sin congelar la UI).
  const msDet = Math.round(performance.now() - t0);
  const salida: DetSalida = { boxesFuente: post.boxesFuente, msDet, nBoxes: post.nBoxes };
  // D62 T2 — MISS: alimenta el memo (tope 2; insertar desplaza la más vieja).
  if (claveOrigen != null) detMemoGuardar(claveOrigen, { cap, ...salida });
  return salida;
}

// ─── Reconocer (secuencia completa) ─────────────────────────────────────────

/**
 * Secuencia completa det→cls→rec. KIT e14-motor-rapidocr-v1 (PROD-2 §4.3-C4):
 * `onProgress` OPCIONAL — tras cada lote de rec (6 líneas) reporta i/total
 * (0→1). Sin callback: comportamiento byte a byte del instrumento (el informe
 * NO lo pasa — matriz congelada).
 */
export async function rapidOcrReconocer(
  rt: RapidRuntime,
  dataUrl: string,
  onProgress?: (p: number) => void,
  opts?: {
    detCap?: number;
    omitirCls?: boolean;
    sinRescateBordes?: boolean;
    esperaSink?: EsperaOcrSink;
  },
): Promise<RapidOcrResultado> {
  // KIT e14-init-por-intencion-v1 (R-47): el primer gesto de escaneo arranca
  // la descarga de modelos (fire-and-forget — si ya está caliente resuelve
  // al instante; el await real del caller llega por rapidOcrInit).
  void asegurarRapidOcr().catch(() => {});
  // FASE 3 — salud del motor (de S): contar la inferencia para el reinicio
  // seguro (reiniciarMotorOcrSiInactivo). Cero costo en la ruta.
  reconocimientosEnVuelo++;
  try {
    return await rapidOcrReconocerInterno(rt, dataUrl, onProgress, opts);
  } finally {
    reconocimientosEnVuelo--;
  }
}

async function rapidOcrReconocerInterno(
  rt: RapidRuntime,
  dataUrl: string,
  onProgress?: (p: number) => void,
  // KIT e14-ocr-escalonado-v1 (§2.1-§2.2): cap det de ESTA llamada —
  // ausente = DET_CAP_PROD (comportamiento de hoy byte a byte); la 1.ª
  // pasada del escalonado pasa DET_CAP_RAPIDO. La sesión/cls/rec NO cambian.
  // KIT e14-velocidad-5s-v1: `omitirCls` ⇒ NO corre el sondeo de rotación
  // (180°) — solo lo pide el bridge cuando la BRÚJULA QR ya fijó la
  // orientación del acta (el cls existe para lo mismo que el QR resuelve con
  // más evidencia). `nBoxes`/`msCls` viajan en la salida para la traza.
  // `sinRescateBordes` ⇒ se cobra SOLO la lectura por bandas (cabecera+pie):
  // la red de seguridad que relee las líneas omitidas no corre. La pide el
  // bridge en el RECHAZO TEMPRANO, cuando el veredicto ya está bloqueado antes
  // del OCR y ningún ancla extra cambia el desenlace.
  opts?: {
    detCap?: number;
    omitirCls?: boolean;
    sinRescateBordes?: boolean;
    esperaSink?: EsperaOcrSink;
  },
): Promise<RapidOcrResultado> {
  const tTotal = performance.now();
  const src = await loadImageMemo(dataUrl); // SPRINT-A A2 — decode memoizado del repo
  // D62 T2 — claveOrigen: el memo del det (probe 1280 ↔ pasada-1 1280 sobre el
  // MISMO bitmap ⇒ HIT; aplicado=1 cambia el string ⇒ miss natural).
  const detCap = opts?.detCap ?? DET_CAP_PROD;
  const { boxesFuente, msDet, memoMsAhorrado } = colaOcrActiva()
    ? await conTurnoOcr(() => inferDet(rt, src, detCap, dataUrl), opts?.esperaSink)
    : await inferDet(rt, src, detCap, dataUrl);

  if (boxesFuente.length === 0) {
    return { lineas: [], texto: "", confMedia: 0, msDet, msCls: 0, msRec: 0, msRunRec: 0, msCrops: 0, nBoxes: 0 };
  }

  // 5) crops por línea (desde la FUENTE, resolución nativa).
  //    KIT e14-remediacion-movil-v1 (C2 — P2 #17): crops PEREZOSOS. Antes se
  //    recortaban TODAS las cajas (~40 drawImage) aunque el rec solo lee
  //    cabecera+pie (filtro `leibles`): coste puro tirado salvo rescate.
  //    Ahora el ratio y el centro-Y salen de la GEOMETRÍA de la caja (EL MISMO
  //    cálculo de cropLinea — sin canvas) y el recorte ocurre SOLO para las
  //    líneas que se leen; el rescate por bordes recorta on-demand. Con knobs
  //    0/0, leibles = todas ⇒ byte-idéntico al flujo de hoy.
  const ratioDeCaja = (b: { x: number; y: number }[]): number => {
    const { w, h } = medidasDeCaja(b);
    // Misma guarda de siempre: una caja degenerada no puede dividir por cero.
    return w / Math.max(1, h);
  };
  // geometría (ver arriba) — el filtro `leibles` se decidió ANTES de recortar
  // (C2). `knobs` del tensor del rec (flags — default HOY byte a byte).
  const knobs = recKnobs();
  const porY = boxesFuente.map((b, i) => ({
    i,
    ratio: ratioDeCaja(b),
    y: b.reduce((s, p) => s + p.y, 0) / b.length,
  }));
  const porAltura = [...porY].sort((a, b) => a.y - b.y);
  const mantenerSet = new Set<number>();
  if (knobs.cabecera > 0 || knobs.pie > 0) {
    for (const o of porAltura.slice(0, knobs.cabecera)) mantenerSet.add(o.i);
    for (const o of porAltura.slice(-knobs.pie)) mantenerSet.add(o.i);
  }
  const bordes = mantenerSet.size > 0;
  const leibles = bordes ? porY.filter((o) => mantenerSet.has(o.i)) : porY;
  const omitidas = bordes ? porY.filter((o) => !mantenerSet.has(o.i)) : [];

  // KIT e14-remediacion-movil-v1 (C1 fase 1 — P1 #6): el anillo deja de
  // congelarse en el 65 % — progreso emitido también en det (~40 %) y crops
  // (~55 %), y yields entre fases (det → crops → cls/rec) para que el hilo
  // principal pinte entre bloques. El rec escala SOLO su tramo desde el 55 %
  // (MONÓTONO — antes el 1.er lote reportaba ~0.15 y cualquier emisión previa
  // hacía RETROCEDER el anillo). FASE 2 APLICADA — KIT e14-post-det-worker-v1
  // (R-45, 2026-11-19): el postproceso DB que aquí era un único bloque
  // síncrono dentro de det (hasta 7,25 s medidos) corre en el WORKER
  // db-postprocess.worker.js (cliente db-postprocess-client.ts; fallback
  // local al módulo puro db-postprocess.ts si el worker no está, roto o
  // vencido) — el hilo principal deja de congelarse durante el det.
  const ceder = async (): Promise<void> => {
    await new Promise<void>((r) => setTimeout(r, 0));
  };
  const emitirProgresoRec = (fraccionCajas: number): void => {
    onProgress?.(Math.min(1, 0.55 + 0.45 * Math.max(0, fraccionCajas)));
  };
  await ceder();
  onProgress?.(0.4); // det completo (~40 % del tramo OCR)

  const totalCajas = porY.length;
  let cajasLeidas = 0;
  const lineas: RapidOcrLinea[] = new Array(boxesFuente.length);
  let msRunRec = 0; // acumulado de `await run()` — ver RapidOcrResultado.msRunRec
  let msCls = 0; // C2: acumulado por subconjunto (leibles + rescate on-demand)
  let msCrops = 0; // B3 — el recorte REAL (solo lo que se lee + rescate)

  // C2 — recorte perezoso con memo por índice: cls y rec rescatan el lienzo
  // bruto (1 drawImage por caja, JAMÁS dos) y la rotación se aplica perezosa.
  const lienzoBruto = new Map<number, HTMLCanvasElement>();
  const lienzoDe = (i: number): HTMLCanvasElement => {
    let c = lienzoBruto.get(i);
    if (!c) {
      const t0 = performance.now();
      c = cropLinea(src, boxesFuente[i]).canvas;
      msCrops += performance.now() - t0;
      lienzoBruto.set(i, c);
    }
    return c;
  };
  const rotacion = new Array<boolean>(boxesFuente.length).fill(false);
  const lienzoFinal = new Map<number, HTMLCanvasElement>();
  const finalDe = (i: number): HTMLCanvasElement => {
    let c = lienzoFinal.get(i);
    if (!c) {
      const bruto = lienzoDe(i);
      if (!rotacion[i]) {
        c = bruto;
      } else {
        // aplicar rotación (re-crop volteado 180°) — MISMO código de siempre
        const tmp = canvasCon(bruto.width, bruto.height); // SPRINT-A A3 — factory
        const ctx = ctxDe(tmp);
        ctx.translate(bruto.width, bruto.height);
        ctx.rotate(Math.PI);
        ctx.drawImage(bruto, 0, 0);
        c = tmp;
      }
      lienzoFinal.set(i, c);
    }
    return c;
  };

  // 6) cls por lote de 6 (rotación 180 si score > 0.9) — OMITIDO cuando la
  //    brújula QR ya decidió (KIT e14-velocidad-5s-v1: el sondeo responde a la
  //    MISMA pregunta que el cuadrante del QR y con MENOS evidencia; su costo
  //    queda ahora visible en la traza como msCls). C2: corre sobre el
  //    SUBCONJUNTO pedido (antes: TODAS las cajas) — el cls es por-línea
  //    independiente (softmax por ítem del lote), así que la rotación de cada
  //    línea es IDÉNTICA aunque cambie el agrupado en lotes.
  const correrClsSubconjunto = async (lista: typeof porY): Promise<void> => {
    if (opts?.omitirCls) return;
    for (let i = 0; i < lista.length; i += 6) {
      const lote = lista.slice(i, i + 6);
      const tensors = lote.map((o) => {
        // cls: h=48, w=min(192, ceil(48·ratio)) con pad a 192
        const cv = lienzoDe(o.i);
        const ratio = cv.width / cv.height;
        const wObj = Math.min(192, Math.max(1, Math.ceil(48 * ratio)));
        const tmp = canvasCon(wObj, 48); // SPRINT-A A3 — factory
        ctxDe(tmp).drawImage(cv, 0, 0, wObj, 48);
        return tmp;
      });
      const tLote = performance.now();
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
  };

  // 7) rec por lotes (líneas ordenadas por ratio w/h — acelera). Los tres
  // knobs del tensor salen de las flags (default = HOY byte a byte).
  const t2 = performance.now();
  // KIT e14-velocidad-5s-v1 (`ocrRecCabecera` / `ocrRecPie`) — leer solo las N
  // líneas de ARRIBA y las M de ABAJO (por posición VERTICAL de la caja, no por
  // índice del det: el orden de salida del det no garantiza lectura top→bottom).
  // El recorte NO se toca — lo que se ahorra son los `run()` del rec. Medido
  // línea por línea en el A56 sobre un acta real de 40 líneas: las anclas y los
  // campos del clasificador caen en la cabecera (código 1D, Ver/Pag, E-14,
  // CONSULADO, PAÍS, ZONA+PUESTO+MESA) y en el pie (SUMA TOTAL, No.Fom, KIT, CV);
  // el MEDIO de la hoja es la tabla de candidatos y votos y NINGÚN consumidor del
  // texto decide con ella (`clasificarCabecera`, `tipoDeBanda`,
  // `faltaSeccionInferior`, `senalDeContenido`, `ocrTextIsValid`, anclas).
  // ─── LAZO SECUENCIAL (el canalizado y las sesiones hermanas, DESCARTADOS) ─
  // Se probó despachar 2 lotes en vuelo y partir los lotes entre DOS sesiones
  // del mismo rec (con `proxy: true` cada sesión vive en SU worker): en el A56
  // no movió ni un ms (msRunRec 5,604 con 2 sesiones · 5,360 con una · 5,244
  // otra vez — todo dentro del ruido) y la razón es la medida de /proc/stat:
  // durante el rec el celular está a 7,7 de 8 núcleos. No hay worker libre que
  // explotar; lo único que baja el rec es que el tensor sea más chico.
  const correrLotes = async (lista: typeof porY) => {
    const orden = [...lista].sort((a, b) => a.ratio - b.ratio);
    for (let k = 0; k < orden.length; k += knobs.lote) {
      const lote = orden.slice(k, k + knobs.lote);
      // El lote entero corre al ancho de su línea más ancha; sin cap, una sola
      // línea de 864 px hinchaba TODOS los tensores del lote (0.56 ms/unidad).
      // El piso es 320 de ANCHO (no 320/48 de ratio): así, aunque baje la
      // altura, los ~40 pasos del CTC y su decodificación se mantienen como siempre.
      const maxRatio = Math.max(320 / knobs.alto, ...lote.map((o) => o.ratio));
      // `ocrRecWfija` — PROBADO Y DESCARTADO con datos (2026-11-05, A56): la
      // teoría era que cada `run()` paga ~130 ms FIJOS y que el ORT re-optimiza el
      // grafo al cambiar la forma [n,3,h,W] (lote 2 = 20 runs → rec 5,17 s vs
      // 3,49 s con 7). Fijando W al cap se tienen MISMA cantidad de runs con forma
      // constante: rec SUBIÓ a 4,76 s. O sea el fijo no era forma sino PAD de ceros
      // — el lote chico corre barato porque el W angosto de verdad se calcula
      // menos. El flag queda (perilla de A/B), el default es false.
      const W = knobs.wFija
        ? knobs.anchoMax
        : Math.min(knobs.anchoMax, Math.floor(knobs.alto * maxRatio));
      const tensor = tensorDeCanvases(
        rt.ort,
        lote.map((o) => finalDe(o.i)),
        W,
        knobs.alto,
        knobs.suave,
      );
      const tRun = performance.now();
      const res = await rt.rec.run({ [rt.rec.inputNames[0]]: tensor });
      msRunRec += performance.now() - tRun;
      const out = res[rt.rec.outputNames[0]];
      for (let m = 0; m < lote.length; m++) {
        const dims = out.dims;
        const sub: OrtValue = {
          dims: [1, dims[1], dims[2]],
          data: (out.data as Float32Array).subarray(
            m * dims[1] * dims[2],
            (m + 1) * dims[1] * dims[2],
          ) as Float32Array,
          type: out.type,
        };
        const { texto, conf } = ctcDecode(sub, rt.dict);
        if (conf >= TEXT_SCORE && texto.trim().length > 0) {
          lineas[lote[m].i] = { texto: texto.trim(), conf, box: boxesFuente[lote[m].i] };
        }
      }
      cajasLeidas += lote.length;
      // C1: el rec reporta SOLO su tramo (55 % → 100 %) — monótono.
      emitirProgresoRec(cajasLeidas / totalCajas);
    }
  };
  await correrClsSubconjunto(leibles);
  await ceder();
  onProgress?.(0.55); // crops+cls del subconjunto leíble (~55 % del tramo OCR)
  await correrLotes(leibles);
  // RED DE SEGURIDAD del recorte por bordes: si leyendo solo cabecera y pie no
  // salen las anclas que definen un acta útil, se leen AHÍ MISMO las líneas que
  // se dejaron sin leer (C2: los recortes se crean ON-DEMAND aquí — el det no
  // se repite; cuesta solo los drawImage + `run()` del resto). Sin este rescate
  // el recorte por bordes sería una APUESTA: una hoja con la cabecera cortada,
  // torcida o con el código de barras en otro lado perdería identificación y
  // autoenvío por ahorrar 1,4 s. Medido: 14+8 bordes da rec 2,07 s (vs 3,49
  // TODO) y 8 anclas en la foto fácil.
  let rescateBordes = 0;
  let anclasBordes = -1; // -1 = no aplica (bordes off)
  let pieBordes = -1; // -1 = no aplica · 0 = el pie NO se ve en los bordes
  if (bordes && knobs.bordesRescate > 0 && omitidas.length > 0 && !opts?.sinRescateBordes) {
    const textoBordes = lineas
      .filter((l): l is RapidOcrLinea => !!l)
      .map((l) => l.texto)
      .join("\n");
    anclasBordes = contarAnclas(textoBordes);
    // El PIE manda además de las anclas: `faltaSeccionInferior` (clasificador
    // .ts) condena `recortada` exigiendo «SUMA TOTAL» en P1 y «FIRMA» en P≥2,
    // y acá el OCR NO conoce la página — si los bordes no muestran NINGUNA de
    // las dos, se lee el resto. Medido sin esta condición: 14+14 en 085053
    // perdió «SUMA TOTAL» con 10 anclas y el acta cayó de 10 ENVIADA a 7.9
    // ADVERTENCIA — el ahorro de 1,9 s costaba el autoenvío.
    pieBordes = /SUMA\s*TOTAL|FIRMA/i.test(textoBordes) ? 1 : 0;
    if (anclasBordes < knobs.bordesRescate || pieBordes === 0) {
      rescateBordes = omitidas.length;
      await correrClsSubconjunto(omitidas); // C2: recorte+cls on-demand del rescate
      await correrLotes(omitidas);
    }
  }
  // PROD-2 (§4.3-C4): el lazo terminó — el tope del progreso, por si el loteo
  // no lo alcanzó (cajas vacías, conf < TEXT_SCORE, etc.).
  onProgress?.(1);
  const msRec = Math.round(performance.now() - t2);

  const aceptadas = lineas.filter((l): l is RapidOcrLinea => !!l);
  const texto = aceptadas.map((l) => l.texto).join("\n");
  const confMedia =
    aceptadas.length === 0 ? 0 : aceptadas.reduce((s, l) => s + l.conf, 0) / aceptadas.length;
  logger.info(
    `[e14-rapidocr] celda: det=${msDet}ms cls=${msCls}ms rec=${msRec}ms (run=${msRunRec} js=${msRec - msRunRec}) · ${boxesFuente.length} cajas · ${aceptadas.length} líneas · conf ${(confMedia * 100).toFixed(1)}% · ${Math.round(performance.now() - tTotal)}ms detMemo=${memoMsAhorrado != null ? `hit msAhorrado=${memoMsAhorrado}` : "miss"} · leidas=${leibles.length}/${totalCajas} anclasBordes=${anclasBordes} pieBordes=${pieBordes} rescate=${rescateBordes} crops=${Math.round(msCrops)}ms`,
  );
  return {
    lineas: aceptadas,
    texto,
    confMedia,
    msDet,
    msCls,
    msRec,
    msRunRec,
    msCrops: Math.round(msCrops),
    nBoxes: boxesFuente.length,
  };
}

// ─── KIT e14-orientacion-auto-v1 (T-A1): soporte del probe de orientación ───

/**
 * det + K crops repartidos por el acta para el probe de orientación (§2.1
 * paso 1): UNA pasada det (el MISMO inferDet de producción — sin sesión
 * nueva, §2.2) y crops ANTES del cls (el cls puede sesgar el probe en 180°,
 * kit §2.1). Selección (kit: «p. ej. boxesFuente cada len/8» — el p. ej.
 * deja la muestra a criterio): las 3 líneas MÁS LARGAS + el resto repartido
 * cada n/K por orden de centro Y. La LONGITUD importa: las anclas de
 * ANCLAS_LECTURA (cabecera E-14, fila CONSULADO/PAIS/ZONA/PUESTO/MESA,
 * código 1D) viven en las líneas largas — verificad en sandbox con dump
 * visual: el spread puro cayó todo en el cuerpo (VOTOS NULOS / TOTAL...)
 * y el probe quedó sin anclas en 180° (score 0.99 < 0+1.5 → no aplicaba).
 * El largo se mide como el lado MAYOR del rect (p0→p1 o p1→p2): en actas
 * ±90° las líneas son verticales y tl→tr daría el GROSOR, no el largo
 * (regresión medida en sandbox: score(270) 3.83→1.06 → no aplicaba).
 */
export async function rapidOcrCropsOrientacion(
  rt: RapidRuntime,
  dataUrl: string,
  k: number,
  esperaSink?: EsperaOcrSink,
): Promise<{ crops: HTMLCanvasElement[]; w: number; h: number; msDet: number }> {
  // KIT e14-init-por-intencion-v1 (R-47): intención del probe — mismo
  // fire-and-forget que el reconocer (el probe corre ANTES de la 1.ª pasada;
  // si el usuario jamás llegó aquí, nada se descargó).
  void asegurarRapidOcr().catch(() => {});
  const src = await loadImageMemo(dataUrl); // SPRINT-A A2 — decode memoizado del repo
  // D56 §3 T2: det del probe a DET_CAP_RAPIDO (banco B3 GO: −56%, 0 cajas
  // perdidas) — el probe no necesita det de producción, sí caber en presupuesto.
  // D62 T2 — claveOrigen: este det ALIMENTA el memo (mismo bitmap + cap 1280
  // ⇒ la pasada-1 del escalonado con aplicado=0 hace HIT y no repite el det).
  const { boxesFuente, msDet } = colaOcrActiva()
    ? await conTurnoOcr(() => inferDet(rt, src, DET_CAP_RAPIDO, dataUrl), esperaSink)
    : await inferDet(rt, src, DET_CAP_RAPIDO, dataUrl);
  const n = boxesFuente.length;
  const crops: HTMLCanvasElement[] = [];
  if (n > 0) {
    const kk = Math.min(k, n);
    const largoDe = (b: { x: number; y: number }[]) =>
      Math.max(
        Math.hypot(b[1].x - b[0].x, b[1].y - b[0].y),
        Math.hypot(b[2].x - b[1].x, b[2].y - b[1].y),
      );
    const nAnchas = Math.min(3, kk);
    const anchas = [...boxesFuente]
      .sort((a, b) => largoDe(b) - largoDe(a))
      .slice(0, nAnchas);
    const enAnchas = new Set(anchas);
    const resto = [...boxesFuente]
      .sort(
        (a, b) => a.reduce((s, p) => s + p.y, 0) - b.reduce((s, p) => s + p.y, 0),
      )
      .filter((b) => !enAnchas.has(b));
    const faltan = kk - anchas.length;
    const paso = resto.length / Math.max(1, faltan); // ≥ 1 → índices sin repetir
    const elegidas = [...anchas];
    for (let i = 0; i < faltan; i++) {
      elegidas.push(resto[Math.floor(i * paso)]);
    }
    for (const b of elegidas) crops.push(cropLinea(src, b).canvas);
  }
  return { crops, w: src.naturalWidth, h: src.naturalHeight, msDet };
}

/**
 * rec CRUDO de un lote de crops para el probe (§2.1 paso 2): el MISMO pre/post
 * del rec de producción (orden por ratio → lotes de 6 → tensorDeCanvases →
 * ctcDecode) SIN cls y SIN filtro TEXT_SCORE — el probe necesita la conf
 * cruda de TODAS las líneas (un crop mal rotado debe puntuar BAJO, no
 * desaparecer del cómputo de conf/anclas). Sin sesiones nuevas: recibe el
 * MISMO runtime singleton del caller (§2.2).
 */
export async function rapidOcrRecLote(
  rt: RapidRuntime,
  canvases: HTMLCanvasElement[],
  esperaSink?: EsperaOcrSink,
): Promise<{ texto: string; conf: number }[]> {
  // Cola FIFO cuando la app la activa (S/pool≥2) — UN client ORT a la vez.
  if (colaOcrActiva()) {
    return conTurnoOcr(() => rapidOcrRecLoteInterno(rt, canvases), esperaSink);
  }
  return rapidOcrRecLoteInterno(rt, canvases);
}

async function rapidOcrRecLoteInterno(
  rt: RapidRuntime,
  canvases: HTMLCanvasElement[],
): Promise<{ texto: string; conf: number }[]> {
  const salida: { texto: string; conf: number }[] = new Array(canvases.length);
  // MISMO knobs que el rec de producción (el probe promete el MISMO pre/post
  // y su conf cruda tiene que ser comparable — y el sondeo de 4 rotaciones es
  // el mayor consumidor de CPU del pipeline cuando decide el sondeo).
  const knobs = recKnobs();
  const orden = canvases
    .map((c, i) => ({ i, ratio: c.width / c.height }))
    .sort((a, b) => a.ratio - b.ratio);
  for (let k = 0; k < orden.length; k += knobs.lote) {
    const lote = orden.slice(k, k + knobs.lote);
    const maxRatio = Math.max(320 / knobs.alto, ...lote.map((o) => o.ratio));
    const W = knobs.wFija
      ? knobs.anchoMax
      : Math.min(knobs.anchoMax, Math.floor(knobs.alto * maxRatio));
    const tensor = tensorDeCanvases(
      rt.ort,
      lote.map((o) => canvases[o.i]),
      W,
      knobs.alto,
      knobs.suave,
    );
    const res = await rt.rec.run({ [rt.rec.inputNames[0]]: tensor });
    const out = res[rt.rec.outputNames[0]];
    for (let m = 0; m < lote.length; m++) {
      const dims = out.dims;
      const sub: OrtValue = {
        dims: [1, dims[1], dims[2]],
        data: (out.data as Float32Array).subarray(
          m * dims[1] * dims[2],
          (m + 1) * dims[1] * dims[2],
        ) as Float32Array,
        type: out.type,
      };
      salida[lote[m].i] = ctcDecode(sub, rt.dict);
    }
  }
  return salida;
}

// KIT e14-optimizacion-v1 (T4): notaWebgpu BORRADA — residuo del informe
// (kit fuera-informes retiró a sus consumidores; 0 refs en src/, verificado
// con rg). WebGPU sigue anotado, no usado (EP wasm fijo, determinismo).

// KIT e14-init-por-intencion-v1 (R-47, 2026-11-19): el pre-warm AL IMPORTAR
// el módulo (KIT e14-motor-rapidocr-v1, PROD-2 §4.1-C5) se RETIRA —
// descargaba ~30 MB (wasm ORT + det/cls/rec + dict) al importar el módulo
// aunque el usuario jamás escaneara. AHORA la descarga es POR INTENCIÓN:
//   · asegurarRapidOcr() — alias memoizado de rapidOcrInit (mismo singleton,
//     reintentable) que los puntos de entrada públicos del OCR invocan
//     fire-and-forget al ARRANCAR: el primer gesto de escaneo descarga Y
//     funciona igual que con el pre-warm de import.
//   · rapidOcrPrecalentar() (ScanView/orquestador de masiva) sigue igual:
//     calienta ADEMÁS con una inferencia real al montar la pantalla.
// La intención JAMÁS lanza: .catch(() => {}) — un fallo de descarga lo paga
// el escaneo con su propio rapidOcrInit (reintentable), no el import.

/** init por intención — descarga los ~30 MB en el primer gesto de escaneo,
 *  no al importar. Alias memoizado de rapidOcrInit: mismo singleton de
 *  sesión (una sola descarga por carga de página), mismo reintento ante
 *  fallo. Los puntos de entrada del motor lo invocan fire-and-forget
 *  (`void asegurarRapidOcr().catch(() => {})` — la intención jamás lanza). */
export function asegurarRapidOcr(): Promise<RapidRuntime> {
  return rapidOcrInit();
}
