// Observabilidad de uso de la app: eventos de navegación y acciones clave.

import { breadcrumb } from '@molde-suite/scanner-core/obs-base/breadcrumbs';

let iniciado = false;

/** Idempotente: registra los eventos de uso (clicks en botones con data-uso). */
export function iniciarUso(): void {
  if (iniciado || typeof window === 'undefined') return;
  iniciado = true;
  document.addEventListener('click', (e) => {
    const objetivo = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-uso]');
    if (objetivo?.dataset.uso) breadcrumb('uso.click', { accion: objetivo.dataset.uso });
  });
  window.addEventListener('hashchange', () => breadcrumb('uso.hash', { hash: window.location.hash }));
}
