// Rastreo de sesiones (motor): correlación ligera de la sesión de trabajo.

let iniciado = false;
let sesionId = '';

/** Idempotente: genera el id de sesión y lo deja accesible. */
export function iniciarRastreo(): void {
  if (iniciado || typeof window === 'undefined') return;
  iniciado = true;
  sesionId = `ses-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  document.documentElement.dataset.sesionId = sesionId;
}

export function sesionActual(): string {
  return sesionId;
}
