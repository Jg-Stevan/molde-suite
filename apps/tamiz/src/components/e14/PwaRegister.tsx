'use client';

// Registro del Service Worker + banner de nueva versión (PWA). Sin SW
// desplegado queda en silencio (no rompe el arranque).

import { useEffect, useState } from 'react';
import { rutaPublica } from '@/lib/rutas';

export function PwaRegister() {
  const [actualizacion, setActualizacion] = useState(false);
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    let registro: ServiceWorkerRegistration | undefined;
    navigator.serviceWorker
      .register(rutaPublica('/sw.js'), { scope: rutaPublica('/') })
      .then((r) => {
        registro = r;
        r.addEventListener('updatefound', () => setActualizacion(true));
      })
      .catch(() => {
        /* sin sw.js: la app funciona igual */
      });
    return () => {
      void registro?.unregister?.().catch(() => undefined);
    };
  }, []);
  if (!actualizacion) return null;
  return (
    <div className="fixed bottom-4 left-4 z-50 rounded-xl border border-brand-border bg-brand-surface px-4 py-2.5 shadow-lg">
      <p className="text-[11px] font-semibold text-white">Nueva versión disponible</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-1 font-mono text-[10px] font-bold text-brand-green"
      >
        RECARGAR AHORA
      </button>
    </div>
  );
}
