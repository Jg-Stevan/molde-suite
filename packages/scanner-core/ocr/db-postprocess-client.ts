/**
 * KIT e14-post-det-worker-v1 (R-45, 2026-11-19) — cliente del WORKER del
 * postproceso DB de detección.
 *
 * `dbPostprocess` (módulo puro — transcripción literal del bloque inline de
 * `inferDet`) medía hasta 7,25 s SÍNCRONOS en el hilo principal: el anillo de
 * progreso y la UI se congelaban con él (límite conocido del KIT
 * e14-remediacion-movil-v1 C1 fase 1: «eso es la fase 2 (worker DB)»).
 * AHORA el det manda `pred` al worker (`db-postprocess.worker.js`) y recibe
 * cajas + conteo; el módulo puro queda como RED local: si el worker no está
 * (tests headless, SSR), falló al crearse, rompió una vez o no responde a
 * tiempo, la MISMA función corre en el hilo principal y el llamador jamás ve
 * la diferencia (mismo resultado observable — worker o local indistinguibles).
 *
 * Mismo patrón que reescalo-worker (E2): worker roto ⇒ modo local para toda
 * la sesión, JAMÁS reintento tras rotura, JAMÁS throw hacia el llamador
 * (degradación conservadora — el postproceso es imprescindible para tener
 * cajas, así que el fallback local no es opcional: SIEMPRE hay resultado).
 *
 * NOTA de buffers: el mensaje NO usa transfer list — si se transfiriera
 * `pred.buffer` y el worker muriera (timeout/onerror), el fallback local se
 * quedaría SIN datos con que recalcular. El structured clone del postMessage
 * copia (~15 MB peor caso con det cap 1920) — despreciable frente a los
 * 7,25 s que el bloque saca del hilo principal. El memo del det
 * (DetMemoEntrada en rapidocr.ts) guarda DetSalida (boxesFuente/msDet/
 * nBoxes), NUNCA `pred` — verificado antes del rewiring: nada memoizado se
 * desapega.
 */
import { publicBaseEfectivo } from "../dominio/entorno";
import { logger } from "../dominio/logger";
import { dbPostprocess, type OpsDet } from "./db-postprocess";

export interface ResultadoDbPost {
  boxesFuente: { x: number; y: number }[][];
  /** nº de rects candidatos ANTES del filtro de mapeo — el `nBoxes` del
   *  log/telemetría es este valor (contrato de `dbPostprocess`). */
  nBoxes: number;
}

interface RespuestaOk extends ResultadoDbPost {
  id: number;
  ok: true;
}
interface RespuestaMal {
  id: number;
  ok: false;
  error: string;
}
type Respuesta = RespuestaOk | RespuestaMal;

interface PeticionDbPost {
  id: number;
  pred: Float32Array;
  pw: number;
  ph: number;
  ops: OpsDet;
  srcW: number;
  srcH: number;
}

let worker: Worker | null = null;
let roto = false;
let seq = 0;
const pendientes = new Map<
  number,
  { resolver: (r: ResultadoDbPost) => void; rechazar: (e: Error) => void }
>();

/** ¿La ruta en worker está disponible en ESTE entorno? Sin window/Worker
 *  (tests headless, SSR) o con sesión rota ⇒ false — el llamador corre el
 *  módulo puro local. */
export function dbPostprocessEnWorkerHabilitado(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof Worker === "function" &&
    !roto
  );
}

function romper(motivo: string): void {
  if (roto) return;
  roto = true;
  // info (dev) y NO warn: la degradación es conservadora y el pipeline sigue
  // byte-idéntico vía el módulo puro local — la sesión entera queda en modo
  // local sin reintento (traza de campo para diagnosticar, sin ruido obs).
  logger.info(`[e14-dbpost] worker roto (${motivo}) — fallback local para la sesión`);
  if (worker) {
    try {
      worker.terminate();
    } catch {
      /* noop */
    }
    worker = null;
  }
  for (const [id, p] of pendientes) {
    pendientes.delete(id);
    p.rechazar(new Error(`db-postprocess-worker: ${motivo}`));
  }
}

function obtenerWorker(): Worker {
  if (!worker) {
    const w = new Worker(`${publicBaseEfectivo()}/scanner/db-postprocess.worker.js`, {
      name: "db-postprocess-v1",
    });
    w.onmessage = (e: MessageEvent<Respuesta>) => {
      const p = pendientes.get(e.data.id);
      if (!p) return;
      pendientes.delete(e.data.id);
      if (e.data.ok) {
        const { boxesFuente, nBoxes } = e.data;
        p.resolver({ boxesFuente, nBoxes });
      } else {
        p.rechazar(new Error(e.data.error));
      }
    };
    w.onerror = () => romper("onerror del worker");
    worker = w;
  }
  return worker;
}

/** Postproceso DB en worker con fallback local TOTAL — el MISMO contrato que
 *  `dbPostprocess` (mismo resultado, jamás throw). Orden de degradación:
 *   1. worker (hilo aparte — la UI no se congela),
 *   2. sin window/Worker o sesión rota ⇒ módulo puro local directo,
 *   3. fallo de creación/postMessage/respuesta/timeout (45 s, como reescalo)
 *      ⇒ módulo puro local + sesión en modo local sin reintento. */
export async function dbPostprocessRemoto(
  pred: Float32Array,
  pw: number,
  ph: number,
  ops: OpsDet,
  srcW: number,
  srcH: number,
  tiempoMaxMs = 45_000,
): Promise<ResultadoDbPost> {
  if (!dbPostprocessEnWorkerHabilitado()) {
    // Tests headless / SSR / sesión rota: el módulo puro corre local — MISMO
    // resultado, sin round-trip (dbPostprocess es total: no lanza).
    return dbPostprocess(pred, pw, ph, ops, srcW, srcH);
  }
  let w: Worker;
  try {
    w = obtenerWorker();
  } catch {
    // Worker imposible de crear (URL/CSP): romper() marca la sesión rota — el módulo puro corre local para siempre.
    romper("no se pudo crear el worker");
    return dbPostprocess(pred, pw, ph, ops, srcW, srcH);
  }
  const id = ++seq;
  const respuesta = new Promise<ResultadoDbPost>((resolver, rechazar) => {
    pendientes.set(id, { resolver, rechazar });
  });
  const reloj = setTimeout(() => {
    const p = pendientes.get(id);
    if (!p) return;
    pendientes.delete(id);
    p.rechazar(new Error("db-postprocess-worker: timeout"));
    romper(`sin respuesta en ${Math.round(tiempoMaxMs / 1000)} s`);
  }, tiempoMaxMs);
  try {
    // Sin transfer list (ver cabecera): el fallback local necesita `pred`
    // vivo — el structured clone copia el buffer en el postMessage.
    w.postMessage({ id, pred, pw, ph, ops, srcW, srcH });
    return await respuesta;
  } catch {
    // postMessage fallido o respuesta rechazada (error/timeout ya contados
    // por romper): el módulo puro corre local — el llamador jamás ve la rotura.
    return dbPostprocess(pred, pw, ph, ops, srcW, srcH);
  } finally {
    clearTimeout(reloj);
    pendientes.delete(id);
  }
}
