// Flags de runtime (overridables por el operador desde localStorage) —
// kill-switches del mantenedor y afinado del piso escénico.

export interface Flags {
  /** Piso del progreso escénico durante el análisis (ms). */
  pisoEscenicoMs: number;
  /** Cierra la animación de análisis apenas resuelve el pipeline. */
  cierreInstantaneo: boolean;
  /** OCR en cascada (Tesseract después de Rapid) para lecturas difíciles. */
  ocrCascada: boolean;
}

const CLAVE = 'tamiz.flags.v1';

const DEFAULTS: Flags = {
  pisoEscenicoMs: 300,
  cierreInstantaneo: true,
  ocrCascada: true,
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
