// Flags de runtime (overridables por el operador desde localStorage) —
// kill-switches del mantenedor y afinado del piso escénico.

export interface Flags {
  /** Piso del progreso escénico durante el análisis (ms). */
  pisoEscenicoMs: number;
  /** Cierra la animación de análisis apenas resuelve el pipeline. */
  cierreInstantaneo: boolean;
  /** OCR en cascada (Tesseract después de Rapid) para lecturas difíciles. */
  ocrCascada: boolean;
  /** FASE 0 (blueprint DLA): ejecutar el molde activo tras el gate. */
  evaluacionMolde: boolean;
  /** FASE A3 (blueprint DLA): corrección de inclinación residual (deskew ≤10°). */
  deskew: boolean;
  /** FASE B (blueprint DLA): señales ONNX en el navegador (casillas/layout). */
  dlaOnnx: boolean;
  /** KIT velocidad-5s: dims de JPEG desde el contenedor (sin decodificar) y
   *  re-escalado fuera del hilo para imports/capturas por encima del tope. */
  importRutaCorta: boolean;
  /** Rescate F-HEIC (sin heic2any en Tamiz: hoy solo clasifica el rechazo). */
  heicTopeMp: number;
  heicLimiteMs: number;
  /** D3 — brújula QR primero; sondeo OCR de respaldo (upstream). */
  qrBrujulaOrientacion: boolean;
  /** Pases del rescate hi-res guiado por el quad (upstream: 2). */
  qrBrujulaWarpPases: number;
  probeMiniLado: number;
  /** P2-D (plan agente externo, tarea D) — usar el bucle de frames del CORE
   *  (CameraFrameLoop: rVFC + detección OpenCV en worker + disparo k-de-n +
   *  compuerta de quietud MotionStabilizer) en lugar del rAF propio de 250 ms
   *  de useSesionCamara. OFF por defecto: cambia el disparo de la auto-captura
   *  y exige validación táctil en el A56 (REPORTE-DIAG §9.3) antes de
   *  encenderlo en campo — kill-switch del mantenedor. */
  frameLoop: boolean;
}

const CLAVE = 'tamiz.flags.v1';

const DEFAULTS: Flags = {
  pisoEscenicoMs: 300,
  cierreInstantaneo: true,
  ocrCascada: true,
  // FASE 0: la evaluación de molde SOLO corre si hay molde activo
  // (molde/registry.ts) — activa por defecto es segura.
  evaluacionMolde: true,
  // FASE A3: el deskew corrige ángulos pequeños medidos por proyección;
  // kill-switch disponible para el operador.
  deskew: true,
  // FASE B: OFF por defecto — requiere modelo configurado (URL) y su primera
  // validación contra el banco (lessons/). Activable desde el Panel DEV.
  dlaOnnx: false,
  importRutaCorta: true,
  heicTopeMp: 24,
  heicLimiteMs: 15_000,
  qrBrujulaOrientacion: true,
  qrBrujulaWarpPases: 2,
  probeMiniLado: 1280,
  // P2-D: el lazo k-de-n del core queda APAGADO hasta la validación táctil
  // del A56 (TODO(A56) en useSesionCamara) — el rAF propio manda.
  frameLoop: false,
};

let cache: Flags | null = null;

export function refrescarFlags(): void {
  cache = null;
  if (typeof window === 'undefined') return;
  try {
    const crudo = window.localStorage.getItem(CLAVE);
    if (crudo) cache = { ...DEFAULTS, ...(JSON.parse(crudo) as Partial<Flags>) };
  } catch {
    cache = null;
  }
}

export function leerFlags(): Flags {
  if (!cache) refrescarFlags();
  return cache ?? DEFAULTS;
}

/** Opciones del rescate F-HEIC para los DOS lectores de File (useDestello y
 *  la memo del bridge) — un único lector de flags (upstream flags.ts:344). */
export type OpcionesRescateHeic = { topeMpHeic?: number; limiteMsHeic?: number };
export function opcionesRescateHeic(): OpcionesRescateHeic {
  const f = leerFlags();
  return { topeMpHeic: f.heicTopeMp, limiteMsHeic: f.heicLimiteMs };
}
