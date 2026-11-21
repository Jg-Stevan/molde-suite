// Plan de adaptación por capacidad del dispositivo: presupuesto de tiempo
// del pipeline según tier (KIT e14-ocr-tessbest-v1: ALTO 120s · MEDIO 240s ·
// BAJO 480s) y tope seguro de resolución del sensor.

import { TIMEOUT_ALTO_MS, TIMEOUT_BAJO_MS, TIMEOUT_MEDIO_MS } from '../politica/umbrales';

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
