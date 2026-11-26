'use client';

// Registro del Service Worker + banner de nueva versión (PWA). Sin SW
// desplegado queda en silencio (no rompe el arranque).
//
// FIX (§5/B1 — plan cierre 2 agentes 2026-11-26): el cleanup del effect
// DES-REGISTRABA el SW al desmontar — cualquier remonte del shell (HMR en
// dev, re-render del árbol) mataba el registro y la app perdía el modo
// offline hasta la recarga. El registro del SW es GLOBAL y persistente:
// se registra UNA vez y el cleanup no lo toca (idempotente — el navegador
// deduplica el register del mismo script).

import { useEffect, useState } from 'react';
import { rutaPublica } from '@/lib/rutas';

let registroEnVuelo: Promise<ServiceWorkerRegistration | null> | null = null;

/** Registro idempotente del SW (una sola vez por carga de página). */
function registrarSw(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return Promise.resolve(null);
  }
  registroEnVuelo ??= navigator.serviceWorker
    .register(rutaPublica('/sw.js'), { scope: rutaPublica('/') })
    .catch(() => {
      /* sin sw.js: la app funciona igual */
      return null;
    });
  return registroEnVuelo;
}

export function PwaRegister() {
  const [actualizacion, setActualizacion] = useState(false);
  useEffect(() => {
    let vivo = true;
    void registrarSw().then((r) => {
      if (!r || !vivo) return;
      r.addEventListener('updatefound', () => {
        if (vivo) setActualizacion(true);
      });
    });
    return () => {
      vivo = false; // el registro del SW SOBREVIVE al desmonte (no unregister)
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
