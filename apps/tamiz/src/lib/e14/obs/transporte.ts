// Transporte de observabilidad: hoy consola (prefijo [obs]); el enchufe real
// (hub HTTP) se conecta cuando exista un endpoint.

import { breadcrumb } from '@molde-suite/scanner-core/obs-base/breadcrumbs';

let iniciado = false;

/** Idempotente: enruta los breadcrumbs al transporte disponible. */
export function iniciarTransporte(): void {
  if (iniciado || typeof window === 'undefined') return;
  iniciado = true;
  breadcrumb('obs.transporte', { modo: 'consola' });
}
