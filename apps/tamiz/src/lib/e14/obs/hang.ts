// Detector de cuelgues (hangs): tareas largas (long tasks) y bloqueos del hilo.

let iniciado = false;

/** Idempotente: suscribe PerformanceObserver de longtask. */
export function iniciarDetectorHang(): void {
  if (iniciado || typeof window === 'undefined') return;
  iniciado = true;
  try {
    const po = new PerformanceObserver((lista) => {
      for (const entrada of lista.getEntries()) {
        if (entrada.duration > 200) {
          console.debug('[obs] longtask', { ms: Math.round(entrada.duration) });
        }
      }
    });
    po.observe({ entryTypes: ['longtask'] });
  } catch {
    /* navegador sin soporte de longtask: sin detector, no rompe nada */
  }
}
