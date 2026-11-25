/**
 * orquestacion/cascada.ts — la CASCADA ÚNICA del paquete (port move-only
 * desde digielect14). Con telemetría por etapa (EventoCascada — 3.6).
 *
 * KIT e14-ocr-cascada-v1 (K3 fase 2) — núcleo PURO de la CASCADA OCR:
 * intento 1 → GATE (clasificador inyectado) → core RapidOCR → rescate por
 * ROIs top/bottom. El flag `ocrCascada` decide si el pipeline la corre; con
 * flag OFF el camino es el OCR ESCALONADO de siempre byte a byte (este
 * módulo SOLO CONSUME `necesitaSegunda` y `elegirMejor`, jamás los re-define).
 *
 * REGLAS DEL JUEZ (kit §1 — fuente de verdad del brief):
 *  · El GATE decide ENTRE MOTORES: si el intento 1 (Tesseract u otro) ubica
 *    y clasifica (nivel AUTO) ⇒ listo; su texto JAMÁS entra a `elegirMejor`
 *    (conf Tesseract vs RapidOCR NO es comparable).
 *  · `elegirMejor` SOLO recibe pasadas RapidOCR (1280 | 1920 | ROI cap 1920
 *    — mismo motor, mismo espacio de conf).
 *  · JAMÁS tumba: cualquier fallo del gate → "MANUAL" (sigue como hoy);
 *    fallo de un ROI → ese ROI se descarta; el intento 1 SÍ propaga su
 *    fallo igual que hoy (misma 1.ª pasada del escalonado).
 *  · Presupuesto: el timeout EXISTENTE del pipeline manda (§3 del kit
 *    escalonado) — vencido ⇒ no se abre ninguna etapa nueva.
 *
 * PURO (sin DOM, sin OCR, sin clasificador) — testeable headless con bun.
 * Las dependencias reales viajan INYECTADAS en `DepsOcrCascada`.
 */

import { elegirMejor, necesitaSegunda, type PasadaOcr } from "../dominio/ocr-escalonado";

/** Nivel del GATE — en digielect lo produce `clasificarCabecera(...).nivel`;
 *  en Tamiz lo resuelve la app (identificación universal) e iguala la señal
 *  de lectura FUERTE a AUTO. */
type NivelGate = "AUTO" | "SUGERIDA" | "MANUAL";

/** Una pasada de la cascada — `PasadaOcr` (texto+conf, comparable entre
 *  pasadas del MISMO motor) + etiqueta para la traza. */
export interface PasadaCascada extends PasadaOcr {
  /** 1280 | 1920 | "roi" | "tess" — etiqueta del cap para la traza `elegido=`. */
  cap: number | "roi" | "tess";
  msDet?: number;
  msRec?: number;
  /** KIT e14-ocr-tessbest-v1 (GO-B) — motor REAL que produjo la pasada.
   *  Ausente = "rapidocr" (retro-compat). La REUSABILIDAD del intento 1 se
   *  decide por ESTE campo: solo una pasada RapidOCR puede reusarse como
   *  1.ª pasada del core (mismo espacio de conf); una pasada Tesseract vale
   *  SOLO por el gate. */
  motor?: "rapidocr" | "tesseract";
  /** TAMAÑO de la pasada (cajas del det y líneas aceptadas). */
  nBoxes?: number;
  nLineas?: number;
  /** ms ESPERANDO el run() del rec (wasm + IPC) — la resta con msRec es hilo
   *  principal. Solo RapidOCR lo separa. */
  msRunRec?: number;
}

/** Esquema de eventos de lectura: la cascada emite uno por etapa INTENTADA y
 *  uno final de ACEPTACIÓN. */
export interface EventoCascada {
  paso: "intento1" | "1280" | "1920" | "roi" | "rescate-motor";
  motor: "rapidocr" | "tesseract" | (string & {});
  /** Veredicto del gate sobre el texto de ESTA etapa. */
  validacion: "AUTO" | "SUGERIDA" | "MANUAL";
  /** true = el texto de esta etapa es la lectura FINAL aceptada. */
  aceptada: boolean;
  ms: number;
}

/** Fracciones Y de los ROIs de rescate sobre el warp: top = 0-25% (cabecera)
 *  · bottom = 75-100% (pie). Constante del contrato — el banco la copia. */
export const ROI_FRACCIONES = {
  top: [0, 0.25],
  bottom: [0.75, 1],
} as const;

/** KIT e14-remediacion-movil-v1 (D6 — P2 #12): coste ESPERADO del rescate
 *  final de otro motor — 11-13 s medidos (2 rescates, §4). Si el presupuesto
 *  restante no lo cubre, el rescate no puede terminar antes del watchdog →
 *  no se abre (condición (b) del ítem). */
export const RESCATE_COSTE_ESPERADO_MS = 13_000;

/** ¿La cascada corre en ESTA pasada? Guard del call-site del pipeline: flag
 *  del mantenedor ON y NUNCA en SIM. Con false el caller usa el escalonado. */
export function cascadaActiva(ocrCascada: boolean, simular: boolean | undefined): boolean {
  return ocrCascada === true && simular !== true;
}

/** ¿La pasada del intento 1 es RapidOCR? (motor declarado manda —
 *  ausente = "rapidocr", retro-compat). */
function esRapidOcr(p: PasadaCascada): boolean {
  return (p.motor ?? "rapidocr") === "rapidocr";
}

/**
 * Compuesta de los ROIs para `elegirMejor` — SOLO pasadas RapidOCR (mismo
 * motor que el core, mismo espacio de conf).
 *  · null entrada = ese ROI falló/no existe → se ignora.
 *  · texto vacío/blanco = ROI sin lectura → NO aporta (ni texto ni conf).
 *  · Sin ROI útil → null (no hay rescate: el core queda como está).
 *  · conf = media de las pasadas ÚTILES (las que aportaron texto).
 */
export function pasadaRoiCompuesta(
  top: PasadaCascada | null,
  bottom: PasadaCascada | null,
): PasadaCascada | null {
  const utiles = [top, bottom].filter(
    (p): p is PasadaCascada => p != null && typeof p.texto === "string" && p.texto.trim().length > 0,
  );
  if (utiles.length === 0) return null;
  const texto = utiles.map((p) => p.texto.trim()).join("\n");
  const conf = utiles.reduce((s, p) => s + p.conf, 0) / utiles.length;
  return { texto, conf, cap: "roi" };
}

/** Dependencias INYECTADAS de la cascada (producción: bridge; tests: mocks).
 *  Las funciones JAMÁS lanzan salvo `intento1` (misma 1.ª pasada del
 *  escalonado: su fallo sigue el camino controlado de hoy). */
export interface DepsOcrCascada {
  /** Intento 1 — RapidOCR 1280 (`mismoMotorIntento1: true`) o Tesseract
   *  completo (`mismoMotorIntento1: false`). */
  intento1: (foto: string) => Promise<PasadaCascada>;
  /** true ⇒ el intento 1 ES RapidOCR → su pasada entra al core como 1.ª
   *  pasada (hoy). false ⇒ OTRO motor: su texto SOLO vale por el GATE
   *  (jamás `elegirMejor`) y el core abre su propia 1.ª pasada a 1280. */
  mismoMotorIntento1: boolean;
  /** Core RapidOCR a 1280 (1.ª pasada del escalonado de siempre). */
  ocr1280: (foto: string) => Promise<PasadaCascada>;
  /** Core RapidOCR a 1920 (2.ª pasada del escalonado de siempre). */
  ocr1920: (foto: string) => Promise<PasadaCascada>;
  /** Core RapidOCR sobre el dataUrl de UN ROI (cap prod 1920 — brief). */
  ocrRoi: (roiDataUrl: string) => Promise<PasadaCascada>;
  /** Recorte del ROI [y0Frac, y1Frac] del warp re-escalado a cap 1920 →
   *  dataUrl. null = fallo (ese ROI se descarta — jamás tumba). */
  recortarRoi: (foto: string, y0Frac: number, y1Frac: number) => Promise<string | null>;
  /** GATE puro — `clasificarNivel(texto)` bound al juez del caller.
   *  Lanza → tratado como "MANUAL" (conservador). */
  clasificarNivel: (texto: string) => NivelGate;
  /** Presupuesto del pipeline (timeout EXISTENTE) — vencido ⇒ no se abre
   *  ninguna etapa nueva. */
  presupuestoVencido: () => boolean;
  /** Hooks de telemetría por etapa. La telemetría jamás tumba la cascada. */
  onEvento?: (e: EventoCascada) => void;
  /** KIT e14-velocidad-5s-v1 — rescate FINAL de OTRO motor (Tesseract best).
   *  Ausente ⇒ la cascada es la de siempre byte a byte. Solo se abre cuando
   *  el core RapidOCR (1280 → 1920 → ROI) terminó SIN nivel AUTO. Su texto
   *  vale SOLO por el GATE — jamás entra a `elegirMejor`. */
  rescateMotor?: (foto: string) => Promise<PasadaCascada | null>;
  /** ANCLAS DEL GATE AÚN POR CUBRIR (faltantes). Si el gate ya tiene todo lo
   *  necesario, el rescate NO puede cambiarlo → no se paga. Ausente ⇒
   *  condición neutralizada. */
  anclasFaltantes?: (texto: string) => number;
  /** Presupuesto RESTANTE del pipeline en ms. Si no alcanza el coste esperado
   *  del rescate, no se abre. Ausente ⇒ condición neutralizada. */
  presupuestoRestanteMs?: () => number;
}

/** Salida de la cascada — el caller consume texto/conf y métricas. */
interface SalidaCascada {
  texto: string;
  conf: number;
  /** Cap de la pasada elegida: 1280 | 1920 | "roi" | "tess" | cap intento 1. */
  elegidoCap: number | "roi" | "tess";
  /** Motor que produjo el INTENTO 1 (traza). */
  motorIntento1: "rapidocr" | "tesseract";
  /** Etapa donde quedó. */
  paso: "intento1" | "1280" | "1920" | "roi" | "rescate-motor";
  /** true = el rescate ROI CORRIÓ (gane o pierda — la métrica cuenta
   *  INTENTOS de rescate). */
  rescate: boolean;
  msIntento1: number;
  ms1280: number | null; // solo cuando el core abrió su 1.ª pasada propia
  ms1920: number | null;
  msRoi: number | null;
  /** ms del rescate final de OTRO motor (null si no corrió). */
  msMotor: number | null;
  /** Métricas det/rec de la ELEGIDA (n/d → 0 si el motor no separa). */
  detMs?: number;
  recMs?: number;
  nBoxes?: number;
  nLineas?: number;
  msRunRec?: number;
}

/** Emisión a prueba de fallos — la telemetría jamás tumba la cascada. */
function emitir(deps: DepsOcrCascada, e: EventoCascada): void {
  try {
    deps.onEvento?.(e);
  } catch {
    /* silencio */
  }
}

/** Gate a prueba de fallos (conservador — jamás tumba la cascada). */
function gateSeguro(deps: DepsOcrCascada, texto: string): NivelGate {
  try {
    return deps.clasificarNivel(texto);
  } catch {
    // Gate del caller roto ⇒ «MANUAL» conservador: jamás AUTO por omisión.
    return "MANUAL";
  }
}

/** ROI a prueba de fallos: fallo del OCR del ROI → null (descartado). */
async function ocrRoiSeguro(
  deps: DepsOcrCascada,
  roiDataUrl: string,
): Promise<PasadaCascada | null> {
  try {
    return await deps.ocrRoi(roiDataUrl);
  } catch {
    return null;
  }
}

/**
 * La cascada (kit §2 — punto de corte del brief: tras SU warp full-res,
 * ANTES del clasificador del pipeline):
 *
 *  1. intento 1 (TESSERACT BEST con GO-B · RapidOCR 1280 sin GO)
 *     → GATE AUTO ⇒ listo.
 *  2. sin AUTO ⇒ core RapidOCR COMO HOY: 1280 (reusada SOLO si la pasada
 *     del intento 1 es RapidOCR) → `necesitaSegunda` → 1920 → `elegirMejor`.
 *  3. sin AUTO y lectura débil ⇒ rescate ROI top/bottom (cap 1920) →
 *     compuesta → `elegirMejor` SOLO entre pasadas RapidOCR.
 *  4. sin AUTO tras el core ⇒ rescate final de OTRO motor (si la dep viaja).
 *
 * La decisión de re-OCR (`necesitaSegunda`) y la de elección (`elegirMejor`)
 * son EXACTAMENTE las del KIT e14-ocr-escalonado-v1 — ninguna regla nueva.
 * La única decisión nueva es el GATE entre etapas (entre motores manda).
 */
export async function correrCascadaOcr(
  foto: string,
  deps: DepsOcrCascada,
): Promise<SalidaCascada> {
  // 1) intento 1 — TESSERACT BEST con caída honesta a RapidOCR 1280 (el
  //    caller declara el motor REAL en cada pasada).
  const t1 = performance.now();
  const r1 = await deps.intento1(foto);
  const msIntento1 = Math.round(performance.now() - t1);
  const motorIntento1 = esRapidOcr(r1) ? "rapidocr" : "tesseract";
  const validacion1 = gateSeguro(deps, r1.texto);
  emitir(deps, { paso: "intento1", motor: motorIntento1, validacion: validacion1, aceptada: false, ms: msIntento1 });
  if (validacion1 === "AUTO") {
    emitir(deps, { paso: "intento1", motor: motorIntento1, validacion: validacion1, aceptada: true, ms: msIntento1 });
    return {
      texto: r1.texto,
      conf: r1.conf,
      elegidoCap: r1.cap,
      paso: "intento1",
      rescate: false,
      motorIntento1,
      msIntento1,
      ms1280: null,
      ms1920: null,
      msRoi: null,
      msMotor: null,
      detMs: r1.msDet,
      recMs: r1.msRec,
      nBoxes: r1.nBoxes,
      nLineas: r1.nLineas,
      msRunRec: r1.msRunRec,
    };
  }

  // 2) core RapidOCR COMO HOY (escalonado §2.3/§2.4 — ninguna regla nueva).
  let acumulado: PasadaCascada;
  let ms1280: number | null = null;
  if (deps.mismoMotorIntento1 || esRapidOcr(r1)) {
    // La 1.ª pasada YA pagada se reusa (caída honesta Tess→RapidOCR jamás
    // paga dos veces la misma pasada del mismo motor).
    acumulado = r1;
  } else {
    // intento 1 de OTRO motor (Tess best): su texto JAMÁS entra a
    // elegirMejor — el core abre su propia 1.ª pasada.
    const t = performance.now();
    acumulado = await deps.ocr1280(foto);
    ms1280 = Math.round(performance.now() - t);
    emitir(deps, { paso: "1280", motor: "rapidocr", validacion: gateSeguro(deps, acumulado.texto), aceptada: false, ms: ms1280 });
  }
  let ms1920: number | null = null;
  if (necesitaSegunda(acumulado.texto) && !deps.presupuestoVencido()) {
    const t = performance.now();
    const r2 = await deps.ocr1920(foto);
    ms1920 = Math.round(performance.now() - t);
    emitir(deps, { paso: "1920", motor: "rapidocr", validacion: gateSeguro(deps, elegirMejor(acumulado, r2).texto), aceptada: false, ms: ms1920 });
    // MISMO motor SIEMPRE aquí (1280 vs 1920 RapidOCR) — §2.4 del kit.
    acumulado = elegirMejor(acumulado, r2);
  }

  // 3) rescate ROI — SOLO si el gate sigue sin AUTO Y la lectura es débil
  //    (una lectura FUERTE sin AUTO no lo arregla el ROI: falla la ruta/
  //    clasificación, no la lectura) Y el presupuesto lo permite.
  let msRoi: number | null = null;
  let rescate = false;
  if (
    gateSeguro(deps, acumulado.texto) !== "AUTO" &&
    necesitaSegunda(acumulado.texto) &&
    !deps.presupuestoVencido()
  ) {
    const topUrl = await deps.recortarRoi(foto, ROI_FRACCIONES.top[0], ROI_FRACCIONES.top[1]);
    const bottomUrl = await deps.recortarRoi(foto, ROI_FRACCIONES.bottom[0], ROI_FRACCIONES.bottom[1]);
    const t = performance.now();
    const rTop = topUrl ? await ocrRoiSeguro(deps, topUrl) : null;
    const rBottom = bottomUrl ? await ocrRoiSeguro(deps, bottomUrl) : null;
    msRoi = Math.round(performance.now() - t);
    const compuesta = pasadaRoiCompuesta(rTop, rBottom);
    if (compuesta) {
      emitir(deps, { paso: "roi", motor: "rapidocr", validacion: gateSeguro(deps, compuesta.texto), aceptada: false, ms: msRoi });
      // SOLO pasadas RapidOCR (1280|1920 core + ROI cap 1920).
      acumulado = elegirMejor(acumulado, compuesta);
      rescate = true;
    }
  }

  // 4) rescate final de OTRO motor (Tesseract best). Dep ausente ⇒ nada de
  //    esto corre. Solo se abre si el core RapidOCR cerró SIN AUTO y el
  //    rescate APORTA: (a) quedan anclas del gate por cubrir y (b) el
  //    presupuesto restante ≥ coste esperado. Manda la regla §1 — entre
  //    motores decide el GATE, jamás `elegirMejor`.
  let msMotor: number | null = null;
  const restanteMs = deps.presupuestoRestanteMs?.() ?? Number.POSITIVE_INFINITY;
  const anclasPorCubrir = deps.anclasFaltantes?.(acumulado.texto) ?? 1;
  if (
    deps.rescateMotor &&
    gateSeguro(deps, acumulado.texto) !== "AUTO" &&
    !deps.presupuestoVencido() &&
    anclasPorCubrir > 0 &&
    restanteMs >= RESCATE_COSTE_ESPERADO_MS
  ) {
    const t = performance.now();
    const rm = await deps.rescateMotor(foto).catch(() => null);
    msMotor = Math.round(performance.now() - t);
    const validacionRm = rm ? gateSeguro(deps, rm.texto) : "MANUAL";
    emitir(deps, { paso: "rescate-motor", motor: "tesseract", validacion: validacionRm, aceptada: false, ms: msMotor });
    if (rm && validacionRm === "AUTO") {
      emitir(deps, { paso: "rescate-motor", motor: "tesseract", validacion: validacionRm, aceptada: true, ms: msMotor });
      return {
        texto: rm.texto,
        conf: rm.conf,
        elegidoCap: rm.cap,
        paso: "rescate-motor",
        rescate,
        motorIntento1,
        msIntento1,
        ms1280,
        ms1920,
        msRoi,
        msMotor,
        detMs: rm.msDet,
        recMs: rm.msRec,
        nBoxes: rm.nBoxes,
        nLineas: rm.nLineas,
        msRunRec: rm.msRunRec,
      };
    }
  }

  const paso: SalidaCascada["paso"] = rescate
    ? "roi"
    : ms1920 != null
      ? "1920"
      : ms1280 != null
        ? "1280"
        : acumulado.cap === 1280
          ? "1280"
          : "intento1";
  emitir(deps, {
    paso,
    motor: motorIntento1 === "tesseract" && paso === "intento1" ? "tesseract" : "rapidocr",
    validacion: gateSeguro(deps, acumulado.texto),
    aceptada: true,
    ms: msIntento1 + (ms1280 ?? 0) + (ms1920 ?? 0) + (msRoi ?? 0),
  });
  return {
    texto: acumulado.texto,
    conf: acumulado.conf,
    elegidoCap: acumulado.cap,
    paso,
    rescate,
    motorIntento1,
    msIntento1,
    ms1280,
    ms1920,
    msRoi,
    msMotor,
    detMs: acumulado.msDet,
    recMs: acumulado.msRec,
    nBoxes: acumulado.nBoxes,
    nLineas: acumulado.nLineas,
    msRunRec: acumulado.msRunRec,
  };
}
