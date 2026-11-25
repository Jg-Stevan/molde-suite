/**
 * TESTS DEL ESTABILIZADOR + DISPARO k-de-n (tarea D — P2, flag frameLoop).
 *
 * Cubre la LÓGICA PURA que gobierna la auto-captura del bucle nuevo
 * (CameraFrameLoop, hoy detrás del flag `frameLoop` de `tamiz.flags.v1`,
 * DEFAULT OFF — ver flags.ts y useSesionCamara.ts):
 *   · MotionStabilizer — compuerta de quietud por DeviceMotion: un salto
 *     (acc > 1.25 m/s² o rot > 14 deg/s) REINICIA la ventana y exige 280 ms
 *     de calma; por debajo del umbral no reinicia nada; destroy() desconecta
 *     la escucha; sin window (SSR/node) el modo queda permisible.
 *   · quality.ts       — la decisión k-de-n del disparo
 *     (computeShutterDecision / shouldTriggerShutter, la que CameraFrameLoop
 *     consulta por frame): última muestra buena, ventana temporal pura de
 *     1200 ms, k dinámico ≥ 70 % de la ventana y sostenimiento continuo ≥
 *     400 ms; una muestra mala en medio del tramo REINICIA la cuenta.
 *
 * Patrón del repo: funciones puras + INYECCIÓN — los deltas devicemotion se
 * inyectan despachando eventos sintéticos sobre un EventTarget falso como
 * `window` (bun no trae DOM; la clase NO se toca — paridad upstream intacta)
 * y los quads/scores entran como arreglos planos. CameraFrameLoop en sí es
 * puro DOM/worker (rVFC, createImageBitmap, postMessage): no se fuerza aquí;
 * su decisión de disparo delega en las funciones puras de arriba.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  MotionStabilizer,
  requestMotionPermission,
} from "../src/lib/e14/core/motion-stabilizer";
import {
  computeShutterDecision,
  computeStabilityScore,
  detectionTimedOut,
  quadTouchesEdge,
  shouldTriggerShutter,
  type QuadSample,
  type ScoreSample,
} from "../src/lib/e14/core/quality";
import { leerFlags } from "../src/lib/e14/flags";
import type { Quad } from "@molde-suite/scanner-core/core/types";

// ───────────────────────── Utilidades de inyección (sin DOM) ───────────────

const espera = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

type GlobalConVentana = typeof globalThis & { window?: unknown };

/** EventTarget falso que hace de `window`: MotionStabilizer.init() engancha
 *  su listener devicemotion aquí y los tests despachan eventos con los
 *  deltas a inyectar. El handler calcula hypot(x,y,z) → con el mismo valor
 *  en los tres ejes, |v| = valor·√3 (misma aritmética que en el dispositivo). */
let ventanaFalsa: EventTarget | null = null;

function instalarVentana(): void {
  ventanaFalsa = new EventTarget();
  (globalThis as GlobalConVentana).window = ventanaFalsa;
}

function quitarVentana(): void {
  delete (globalThis as GlobalConVentana).window;
  ventanaFalsa = null;
}

/** Evento devicemotion sintético con deltas inyectados. */
function eventoMovimiento(opts: {
  acc?: number;
  rot?: number;
}): DeviceMotionEvent {
  const e = new Event("devicemotion") as unknown as DeviceMotionEvent;
  const acc = opts.acc ?? 0;
  const rot = opts.rot ?? 0;
  (
    e as unknown as {
      acceleration: { x: number; y: number; z: number } | null;
    }
  ).acceleration = { x: acc, y: acc, z: acc };
  (
    e as unknown as {
      rotationRate: { alpha: number; beta: number; gamma: number } | null;
    }
  ).rotationRate = { alpha: rot, beta: rot, gamma: rot };
  return e;
}

/** Serie de muestras de score equiespaciadas (t en ms). */
function serie(intervaloMs: number, scores: number[], t0 = 1000): ScoreSample[] {
  return scores.map((score, i) => ({ t: t0 + i * intervaloMs, score }));
}

/** Quad fijo a 400-clase (documento centrado, esquinas estables). */
function quadBase(): Quad {
  return [
    { x: 100, y: 100 },
    { x: 300, y: 100 },
    { x: 300, y: 400 },
    { x: 100, y: 400 },
  ];
}

// ───────────────── MotionStabilizer — compuerta de quietud ─────────────────

describe("MotionStabilizer — compuerta de quietud (con deltas inyectados)", () => {
  beforeEach(() => {
    instalarVentana();
  });

  afterEach(() => {
    quitarVentana();
  });

  test("N frames de calma consecutivos (delta bajo) → stable=true", async () => {
    const s = new MotionStabilizer();
    // Temblor leve por debajo de los umbrales (hypot 0.69 ≤ 1.25 y
    // 12.1 ≤ 14): NO reinicia la ventana de quietud (que corre desde el
    // constructor).
    for (let i = 0; i < 4; i++) {
      ventanaFalsa!.dispatchEvent(eventoMovimiento({ acc: 0.4, rot: 7 }));
      await espera(40);
    }
    // La ventana exige 280 ms de calma TOTAL (n frames consecutivos).
    await espera(220);
    const r = s.isDeviceStable(280);
    expect(r.stable).toBe(true);
    expect(r.acc).toBeLessThanOrEqual(1.25);
    expect(r.calmMs).toBeGreaterThanOrEqual(280);
    s.destroy();
  });

  test("un salto fuerte reinicia la cuenta y exige la calma completa (280 ms)", async () => {
    const s = new MotionStabilizer();
    // El dispositivo viene quieto desde la construcción: la ventana
    // corre desde ahí → tras 300 ms ya cumple la exigencia de 280 ms.
    await espera(300);
    expect(s.isDeviceStable(280).stable).toBe(true);
    // La mano acomoda el teléfono: salto brusco (hypot 3.46 > 1.25).
    ventanaFalsa!.dispatchEvent(eventoMovimiento({ acc: 2 }));
    const trasSalto = s.isDeviceStable(280);
    expect(trasSalto.stable).toBe(false);
    expect(trasSalto.calmMs).toBeLessThan(50);
    // La señal queda alta hasta que llega calma (el device motion real es
    // continuo): con acc alta la compuerta no se abre NI con calmMs cumplido.
    expect(s.isDeviceStable(0).stable).toBe(false);
    // Vuelve la calma: la ventana corre desde el salto.
    ventanaFalsa!.dispatchEvent(eventoMovimiento({ acc: 0.5 }));
    await espera(120);
    // k-1 del tiempo (120 ms < 280 ms): todavía bloqueado.
    expect(s.isDeviceStable(280).stable).toBe(false);
    await espera(220);
    expect(s.isDeviceStable(280).stable).toBe(true);
    s.destroy();
  });

  test("un salto en plena calma CANCELA la ventana ya ganada (reset correcto)", async () => {
    const s = new MotionStabilizer();
    await espera(300);
    expect(s.isDeviceStable(280).stable).toBe(true);
    // Giro de muñeca sin aceleración lineal (hypot 34.6 > 14 deg/s) —
    // también reinicia.
    ventanaFalsa!.dispatchEvent(eventoMovimiento({ rot: 20 }));
    expect(s.isDeviceStable(280).stable).toBe(false);
    s.destroy();
  });

  test("movimiento bajo el umbral NO reinicia la ventana ganada", async () => {
    const s = new MotionStabilizer();
    await espera(300);
    expect(s.isDeviceStable(280).stable).toBe(true);
    // Temblor fisiológico (4-8 Hz) debajo de ambos umbrales.
    ventanaFalsa!.dispatchEvent(eventoMovimiento({ acc: 0.4, rot: 7 }));
    expect(s.isDeviceStable(280).stable).toBe(true);
    s.destroy();
  });

  test("destroy() desconecta la escucha: los eventos dejan de reiniciar", async () => {
    const s = new MotionStabilizer();
    await espera(300);
    s.destroy();
    // Salto brusco después del destroy: no llega al handler.
    ventanaFalsa!.dispatchEvent(eventoMovimiento({ acc: 2 }));
    expect(s.isDeviceStable(280).stable).toBe(true);
  });

  test("isDeviceStable respeta el minQuiescenceMs pedido por el llamador", async () => {
    const s = new MotionStabilizer();
    // La compuerta del frame-loop pide 280 ms; una exigencia mayor no se
    // cumple aunque el dispositivo esté quieto desde la construcción.
    expect(s.isDeviceStable(60_000).stable).toBe(false);
    expect(s.isDeviceStable(0).stable).toBe(true);
    s.destroy();
  });
});

describe("MotionStabilizer — entornos sin DeviceMotion", () => {
  test("sin window (SSR/node): constructor no lanza y el modo queda permisible", () => {
    const s = new MotionStabilizer();
    const r = s.isDeviceStable(0);
    expect(r.stable).toBe(true);
    expect(r.acc).toBe(0);
    s.destroy(); // no-op sin escucha
  });

  test("requestMotionPermission sin la API de iOS → false y UN SOLO intento", async () => {
    instalarVentana();
    try {
      const primera = await requestMotionPermission();
      const segunda = await requestMotionPermission();
      expect(primera).toBe(false);
      // Un intento por sesión (motionPermissionAsked del módulo).
      expect(segunda).toBe(false);
    } finally {
      quitarVentana();
    }
  });
});

// ───────────── Disparo k-de-n — la decisión que consulta el loop ────────────

describe("Disparo k-de-n — computeShutterDecision / shouldTriggerShutter", () => {
  test("6 muestras buenas a 120 ms (tramo 600 ms) → dispara con k=5 de 6", () => {
    const h = serie(120, [0.9, 0.9, 0.9, 0.9, 0.9, 0.9]);
    const d = computeShutterDecision(h);
    expect(d.reason).toBe("ok");
    // K dinámico: max(2, ceil(6 × 0.7)) = 5.
    expect(d.kRequired).toBe(5);
    expect(d.goodInWindow).toBe(6);
    expect(shouldTriggerShutter(h)).toBe(true);
  });

  test("k-1 buenas no alcanza (not-enough-good)", () => {
    // 4 buenas de 6 (k=5) con tramo continuo ≥ 400 ms (150 ms × 3): pasa el
    // gate de sostenimiento y FALLA el de proporción — el k exacto manda.
    const h = serie(150, [0.5, 0.5, 0.9, 0.9, 0.9, 0.9]);
    const d = computeShutterDecision(h);
    expect(d.reason).toBe("not-enough-good");
    expect(d.goodInWindow).toBe(d.kRequired - 1);
    expect(shouldTriggerShutter(h)).toBe(false);
  });

  test("la ÚLTIMA muestra mala manda (last-bad) aunque el resto sea bueno", () => {
    const h = serie(120, [0.9, 0.9, 0.9, 0.9, 0.9, 0.5]);
    const d = computeShutterDecision(h);
    expect(d.reason).toBe("last-bad");
    expect(shouldTriggerShutter(h)).toBe(false);
  });

  test("una mala en medio del tramo REINICIA la cuenta (sustain)", () => {
    // 3 buenas finales tras una mala: el tramo continuo hacia atrás solo
    // cubre 240 ms (< 400 ms exigidos) → no dispara aunque la proporción
    // global de buenas (5/6) pase el k.
    const h = serie(120, [0.9, 0.9, 0.5, 0.9, 0.9, 0.9]);
    const d = computeShutterDecision(h);
    expect(d.reason).toBe("sustain");
    expect(d.sustainedGoodMs).toBe(240);
    expect(shouldTriggerShutter(h)).toBe(false);
  });

  test("ventana temporal PURA: la muestra vieja (>1200 ms) no cuenta", () => {
    // 6 muestras a 300 ms = span de 1500 ms → entran 5 (la de t0 queda fuera)
    // y aún así dispara: la decisión es invariante al FPS, no por índice.
    const h = serie(300, [0.9, 0.9, 0.9, 0.9, 0.9, 0.9]);
    const d = computeShutterDecision(h);
    expect(d.windowSamples).toBe(5);
    expect(d.reason).toBe("ok");
    expect(shouldTriggerShutter(h)).toBe(true);
  });

  test("borde inferior del k dinámico: 2 muestras buenas con tramo ≥ 400 ms → dispara", () => {
    const h = serie(400, [0.9, 0.9]);
    const d = computeShutterDecision(h);
    expect(d.kRequired).toBe(2);
    expect(d.reason).toBe("ok");
    expect(shouldTriggerShutter(h)).toBe(true);
  });

  test("borde k=3: ventana de 4 muestras exige 3 buenas exactas", () => {
    const h = serie(200, [0.5, 0.9, 0.9, 0.9]);
    const d = computeShutterDecision(h);
    expect(d.kRequired).toBe(3);
    expect(d.goodInWindow).toBe(3);
    expect(shouldTriggerShutter(h)).toBe(true);
    // Una buena menos Y con la mala al medio del tramo: sostenimiento roto.
    const h2 = serie(200, [0.9, 0.5, 0.9, 0.9]);
    expect(computeShutterDecision(h2).reason).toBe("sustain");
    expect(shouldTriggerShutter(h2)).toBe(false);
  });

  test("pocos datos: una sola muestra nunca dispara (few-samples)", () => {
    const h: ScoreSample[] = [{ t: 1000, score: 0.9 }];
    const d = computeShutterDecision(h);
    expect(d.reason).toBe("few-samples");
    expect(shouldTriggerShutter(h)).toBe(false);
  });

  test("historial vacío → few-samples (sin disparo)", () => {
    expect(shouldTriggerShutter([])).toBe(false);
    expect(computeShutterDecision([]).reason).toBe("few-samples");
  });
});

// ───────── Estabilidad del DOCUMENTO — el «delta bajo» del quad ─────────────

describe("computeStabilityScore — ventana por timestamp (600 ms)", () => {
  test("quads idénticos (delta cero) → score 1", () => {
    const h: QuadSample[] = [
      { t: 0, quad: quadBase() },
      { t: 100, quad: quadBase() },
      { t: 200, quad: quadBase() },
    ];
    expect(computeStabilityScore(h, 250)).toBe(1);
  });

  test("un salto de esquinas baja el score (y queda en rango 0..1)", () => {
    const salto: Quad = quadBase().map((p) => ({ x: p.x + 6, y: p.y }));
    const h: QuadSample[] = [
      { t: 0, quad: quadBase() },
      { t: 100, quad: quadBase() },
      { t: 200, quad: quadBase() },
      { t: 300, quad: salto },
    ];
    const s = computeStabilityScore(h, 320);
    expect(s).toBeGreaterThan(0.5);
    expect(s).toBeLessThan(1);
  });

  test("menos de 2 muestras en la ventana de 600 ms → 0 (por timestamp)", () => {
    const h: QuadSample[] = [
      { t: 0, quad: quadBase() },
      { t: 100, quad: quadBase() },
    ];
    // Ambas muestras envejecidas fuera de la ventana (hueco > 600 ms).
    expect(computeStabilityScore(h, 800)).toBe(0);
    // Una sola muestra fresca tampoco alcanza.
    expect(computeStabilityScore([{ t: 700, quad: quadBase() }], 800)).toBe(0);
  });
});

// ─────────── Insumos de decisión del loop (timeout y borde del quad) ────────

describe("decisiones auxiliares del bucle (detectionTimedOut / quadTouchesEdge)", () => {
  test("detectionTimedOut usa el umbral de 8 s EXCLUSIVO", () => {
    expect(detectionTimedOut(0, 8000)).toBe(false);
    expect(detectionTimedOut(0, 8001)).toBe(true);
    expect(detectionTimedOut(5000, 9000)).toBe(false);
  });

  test("quadTouchesEdge: papel pegado al encuadre posterga el disparo", () => {
    expect(quadTouchesEdge([{ x: 0.01, y: 0.5 }])).toBe(true);
    expect(quadTouchesEdge([{ x: 0.5, y: 0.01 }])).toBe(true);
    expect(
      quadTouchesEdge([
        { x: 0.2, y: 0.2 },
        { x: 0.8, y: 0.2 },
        { x: 0.8, y: 0.8 },
        { x: 0.2, y: 0.8 },
      ]),
    ).toBe(false);
  });
});

// ───────────────────── El flag de la tarea (default OFF) ────────────────────

describe("flag frameLoop (tamiz.flags.v1) — default OFF", () => {
  test("sin localStorage el flag cae en false: el rAF propio de 250 ms manda", () => {
    // bun no trae localStorage: leerFlags() cae a DEFAULTS — que trae
    // frameLoop: false (comportamiento byte-idéntico al pre-tarea D).
    expect(leerFlags().frameLoop).toBe(false);
  });
});
