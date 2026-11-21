// Observabilidad de dispositivo: red (Network Information API) y salud.

export interface RedInfo {
  tipo: string;
  downlinkMbps: number | null;
}

/** Snapshot de la red actual (null sin API). */
export function redActual(): RedInfo | null {
  if (typeof navigator === 'undefined') return null;
  const conn = (navigator as Navigator & {
    connection?: { effectiveType?: string; downlink?: number };
  }).connection;
  if (!conn) return null;
  return { tipo: conn.effectiveType ?? 'desconocida', downlinkMbps: conn.downlink ?? null };
}

let muestreo = false;

/** Idempotente: muestrea la salud del dispositivo (memoria/nivel de batería). */
export function iniciarMuestreoSalud(): void {
  if (muestreo || typeof window === 'undefined') return;
  muestreo = true;
  // La primera muestra se toma al arrancar; luego por evento visibilitychange.
  document.addEventListener('visibilitychange', () => {
    const memoria = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    if (memoria) {
      console.debug('[obs] salud', { heapMb: Math.round(memoria.usedJSHeapSize / 1e6) });
    }
  });
}
