/// <reference lib="webworker" />
/**
 * KIT e14-post-det-worker-v1 (R-45, 2026-11-19) — WORKER del postproceso DB
 * de detección.
 *
 * El postproceso DB de `inferDet` (`dbPostprocess`: binarizar > 0.3 →
 * dilate 2×2 → CCL 4-conectividad → convex hull → min-area rect →
 * box_score_fast → unclip → esquinas TL,TR,BR,BL + mapeo a la fuente) corría
 * INLINE en el hilo principal — un único bloque síncrono de hasta 7,25 s
 * medidos que congelaba el anillo de progreso con la UI (límite conocido del
 * KIT e14-remediacion-movil-v1 C1 fase 1: «eso es la fase 2 (worker DB)»).
 * AHORA el main manda el `pred` plano de la salida del det y AQUÍ corre el
 * módulo PURO `src/ocr/db-postprocess.ts` (transcripción literal del bloque,
 * caracterizado por el test del supervisor — misma entrada, MISMA salida).
 *
 * CONTRATO de mensajes:
 *   petición  `{ id, pred: Float32Array, pw, ph, ops: OpsDet, srcW, srcH }`
 *             — `pred` = `out.data` del det (dims [1,1,ph,pw], el caller pasa
 *             `pw = out.dims[3]`, `ph = out.dims[2]`); `ops` = el registro
 *             EXACTO que `preDet` produce; `srcW/srcH` = dimensiones de la
 *             imagen FUENTE.
 *   respuesta `{ id, ok: true, boxesFuente, nBoxes }`
 *             `{ id, ok: false, error }` ante CUALQUIER fallo.
 *
 * RED LINES (mismo patrón que reescalar-import.worker):
 *  · JAMÁS throw sin capturar: cualquier error → `{ok:false}` y el cliente
 *    (db-postprocess-client.ts) cae al fallback local — el MISMO módulo puro
 *    corre en el hilo principal y el llamador jamás ve la rotura.
 *  · El cómputo es SÍNCRONO y puede tardar segundos — INTENCIONAL: es el
 *    trabajo que hoy congela la UI; el worker lo absorbe entero.
 *  · Sin estado de módulo: cada mensaje es independiente (el cliente
 *    serializa sus peticiones de facto — una acta a la vez por la cola OCR).
 */

import { dbPostprocess, type OpsDet } from "../ocr/db-postprocess";

interface PeticionDbPost {
  id: number;
  pred: Float32Array;
  pw: number;
  ph: number;
  ops: OpsDet;
  srcW: number;
  srcH: number;
}

type RespuestaDbPost =
  | { id: number; ok: true; boxesFuente: { x: number; y: number }[][]; nBoxes: number }
  | { id: number; ok: false; error: string };

/** Postproceso DB de UNA petición — total: cualquier fallo responde
 *  {ok:false} honesto, jamás lanza hacia el cableado del worker. */
function procesar(p: PeticionDbPost): RespuestaDbPost {
  try {
    const { boxesFuente, nBoxes } = dbPostprocess(p.pred, p.pw, p.ph, p.ops, p.srcW, p.srcH);
    return { id: p.id, ok: true, boxesFuente, nBoxes };
  } catch (e) {
    return {
      id: p.id,
      ok: false,
      error: e instanceof Error ? e.message : "fallo del postproceso DB",
    };
  }
}

/** Cableado SOLO en un entorno de worker real (el archivo se importa desde
 *  tests como módulo puro — mismo guard que reescalar-import.worker). */
if (typeof window === "undefined" && typeof self !== "undefined") {
  self.onmessage = (e: MessageEvent<PeticionDbPost>) => {
    void Promise.resolve(e.data)
      .then((p) => procesar(p))
      .then((r: RespuestaDbPost) => {
        self.postMessage(r);
      });
  };
}
