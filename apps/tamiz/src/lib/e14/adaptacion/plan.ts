// Plan de adaptación por capacidad del dispositivo: presupuesto de tiempo
// del pipeline según tier (KIT e14-ocr-tessbest-v1: ALTO 120s · MEDIO 240s ·
// BAJO 480s) y tope seguro de resolución del sensor.

import { TIMEOUT_ALTO_MS, TIMEOUT_BAJO_MS, TIMEOUT_MEDIO_MS } from '../politica/umbrales';
import { leerFlags } from '../flags';

export type TierDispositivo = 'ALTO' | 'MEDIO' | 'BAJO';

export function tierDelDispositivo(): TierDispositivo {
  if (typeof navigator === 'undefined') return 'ALTO';
  const nucleos = navigator.hardwareConcurrency ?? 4;
  const memoriaGb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  if (nucleos >= 6 && memoriaGb >= 6) return 'ALTO';
  if (nucleos >= 4 || memoriaGb >= 4) return 'MEDIO';
  return 'BAJO';
}

/** Presupuesto total (ms) del pipeline para este dispositivo. */
export function presupuestoEscaneoEfectivo(): number {
  switch (tierDelDispositivo()) {
    case 'ALTO':
      return TIMEOUT_ALTO_MS;
    case 'MEDIO':
      return TIMEOUT_MEDIO_MS;
    default:
      return TIMEOUT_BAJO_MS;
  }
}

/** Tope seguro de lado largo de foto por gama (px). */
export function topeLadoLargoPx(): number {
  switch (tierDelDispositivo()) {
    case 'ALTO':
      return 4032;
    case 'MEDIO':
      return 3200;
    default:
      return 2560;
  }
}

/** KIT e14-ocr-tessbest-v1 — presupuesto del PROBE de orientación por tier
 *  (upstream adaptacion/plan.ts: BAJO 150 s · MEDIO 60 s · ALTO 12 s). */
const PROBE_ORIENTACION_MS: Record<TierDispositivo, number> = {
  BAJO: 150_000,
  MEDIO: 60_000,
  ALTO: 12_000,
};
export function presupuestoProbeOrientacionEfectivo(): number {
  return PROBE_ORIENTACION_MS[tierDelDispositivo()];
}

// KIT e14-gama-baja-20s-v1 — knobs OCR por tier (SOLO PERFORMANCE; jamás
// reglas de negocio: scores, gates, umbrales y desenlaces NO se tocan).
// Port digielect14: hilos 2/3/6 (capados por hardware) y 2.º intento del
// escalonado = ROI-cabecera con ventana 15 s (BAJO) / 45 s (MEDIO/ALTO).
const HILOS_OCR_POR_TIER: Record<TierDispositivo, number> = {
  BAJO: 2,
  MEDIO: 3,
  ALTO: 6,
};

export interface PlanOcrAdaptativo {
  /** false = kill-switch `adaptacionDispositivo` OFF ⇒ histórico puro. */
  adaptado: boolean;
  /** Modo del 2.º intento cuando la 1.ª pasada sale débil. */
  ocrReOcrModo: 'completo' | 'roi-cabecera';
  /** Tope PARED (ms) para PERMITIR el intento extra (null = sin tope propio). */
  ocrSegundaPresupuestoMs: number | null;
}

const KNOBS_OCR_POR_TIER: Record<TierDispositivo, Omit<PlanOcrAdaptativo, 'adaptado'>> = {
  BAJO: { ocrReOcrModo: 'roi-cabecera', ocrSegundaPresupuestoMs: 15_000 },
  MEDIO: { ocrReOcrModo: 'roi-cabecera', ocrSegundaPresupuestoMs: 45_000 },
  ALTO: { ocrReOcrModo: 'roi-cabecera', ocrSegundaPresupuestoMs: 45_000 },
};

/** Plan OCR por tier (SYNC/barato, jamás lanza). Kill-switch del operador:
 *  `{"adaptacionDispositivo": false}` ⇒ idéntico al histórico (2.ª pasada
 *  completa sin tope propio). */
export function planOcrAdaptativo(): PlanOcrAdaptativo {
  try {
    if (!leerFlags().adaptacionDispositivo) {
      return { adaptado: false, ocrReOcrModo: 'completo', ocrSegundaPresupuestoMs: null };
    }
    return { adaptado: true, ...KNOBS_OCR_POR_TIER[tierDelDispositivo()] };
  } catch {
    return { adaptado: false, ocrReOcrModo: 'completo', ocrSegundaPresupuestoMs: null };
  }
}

/** Hilos wasm del OCR efectivos (SAB + COOP/COEP obligatorios; sin ellos
 *  el wasm corre a 1 hilo — mismo criterio de digielect14). */
export function numThreadsOcrEfectivos(): number {
  let hilosOk = false;
  try {
    hilosOk =
      typeof SharedArrayBuffer !== 'undefined' &&
      typeof self !== 'undefined' &&
      self.crossOriginIsolated === true;
  } catch {
    hilosOk = false;
  }
  if (!hilosOk) return 1;
  const nucleos = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 1) : 1;
  return Math.max(1, Math.min(HILOS_OCR_POR_TIER[tierDelDispositivo()], Math.max(1, nucleos)));
}

/** Knobs del tensor del rec (flags del operador con clamps en flags.ts). */
export function knobsRecOcrEfectivos(): {
  anchoMax: number;
  alto: number;
  lote: number;
  suave: boolean;
  wFija: boolean;
  cabecera: number;
  pie: number;
  bordesRescate: number;
} {
  const f = leerFlags();
  return {
    anchoMax: f.ocrRecWmax,
    alto: f.ocrRecAltura,
    lote: f.ocrRecLote,
    suave: f.ocrRecSuave,
    wFija: f.ocrRecWfija,
    cabecera: f.ocrRecCabecera,
    pie: f.ocrRecPie,
    bordesRescate: f.ocrRecBordesRescate,
  };
}
