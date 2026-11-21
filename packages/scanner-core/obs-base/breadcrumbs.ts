// Breadcrumbs de observabilidad base (D8 opción B): registro ligero de
// eventos de navegación/errores en consola con prefijo. No-op si no hay
// consola (SSR/prerender).

type Escucha = (evento: string, datos?: Record<string, unknown>) => void;

const listeners: Escucha[] = [];

export function onBreadcrumb(escucha: Escucha): () => void {
  listeners.push(escucha);
  return () => {
    const i = listeners.indexOf(escucha);
    if (i >= 0) listeners.splice(i, 1);
  };
}

export function breadcrumb(evento: string, datos?: Record<string, unknown>): void {
  for (const l of listeners) {
    try {
      l(evento, datos);
    } catch {
      /* una escucha rota no tumba el registro */
    }
  }
}

let instalado = false;

/** Idempotente: registra el breadcrumb base (consola) para toda la app. */
export function iniciarBreadcrumbs(): void {
  if (instalado || typeof window === 'undefined') return;
  instalado = true;
  onBreadcrumb((evento, datos) => {
    // Trazabilidad de desarrollo sin backend de observabilidad.
    console.info(`[bc] ${evento}`, datos ?? '');
  });
  breadcrumb('app.iniciada', { ts: Date.now() });
}
