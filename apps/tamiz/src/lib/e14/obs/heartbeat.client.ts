// Sensor de hangs EN CURSO (heartbeat del cliente): marca en el documento
// que el hilo principal está vivo (un watchdog externo lo lee).

let iniciado = false;

/** Idempotente: publica el latido en document.title (inofensivo) y en el dataset. */
export function iniciarSensorHangEnCurso(): void {
  if (iniciado || typeof document === 'undefined') return;
  iniciado = true;
  document.documentElement.dataset.hangHeartbeat = String(Date.now());
  window.setInterval(() => {
    document.documentElement.dataset.hangHeartbeat = String(Date.now());
  }, 2000);
}
