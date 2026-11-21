// Wake Lock: mantiene la pantalla encendida durante el escaneo/análisis.
// No-op elegante en navegadores sin la API (iOS < 16.4, Safari antiguo).

import { useEffect } from 'react';

type WakeLockSentinelLike = { release: () => Promise<void>; addEventListener?: (t: string, l: () => void) => void };

export function useWakeLock(activo: boolean): void {
  useEffect(() => {
    if (!activo || typeof navigator === 'undefined') return;
    let sentinel: WakeLockSentinelLike | null = null;
    let liberado = false;
    const nav = navigator as Navigator & {
      wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinelLike> };
    };
    const adquirir = async () => {
      try {
        if (!nav.wakeLock) return;
        sentinel = await nav.wakeLock.request('screen');
        // Re-adquisición al volver de segundo plano.
        sentinel.addEventListener?.('release', () => {
          if (!liberado) void adquirir();
        });
      } catch {
        /* sin wake lock: la app sigue funcionando */
      }
    };
    const alVisible = () => {
      if (document.visibilityState === 'visible') void adquirir();
    };
    void adquirir();
    document.addEventListener('visibilitychange', alVisible);
    return () => {
      liberado = true;
      document.removeEventListener('visibilitychange', alVisible);
      void sentinel?.release().catch(() => undefined);
    };
  }, [activo]);
}
