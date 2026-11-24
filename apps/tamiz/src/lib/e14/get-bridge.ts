// Singleton del bridge de escaneo (la UI siempre habla con ESTE).

import type { E14Bridge } from '@molde-suite/scanner-core/dominio/bridge';
import { RealCoreBridge } from './bridge/real-core-bridge';

let bridge: E14Bridge | null = null;

export function getBridge(): E14Bridge {
  if (!bridge) bridge = new RealCoreBridge();
  return bridge;
}
