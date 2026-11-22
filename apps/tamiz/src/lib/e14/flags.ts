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
