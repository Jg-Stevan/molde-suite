/**
 * turno-fifo.ts — primitiva PURA de cola FIFO de turnos.
 *
 * Serializa el acceso a un recurso NO reentrante: el singleton de RapidOCR/ORT
 * del navegador. Dos inferencias concurrentes sobre el MISMO runtime proxy no
 * regresan jamás (gpu8/gpu13) y el warm-up F4 contra el primer escaneo
 * rapid-first intercala det/cls/rec del mismo proxy (A56 2026-11-26,
 * comprobante-a-02 RECHAZADA tras 295 s con F2+F1 ON).
 *
 * Extraída de rapidocr.ts como módulo puro para poder TESTEAR la semántica
 * de la intercalación sin ORT ni canvas (KIT A2 del plan de cierre
 * PLAN-CIERRE-2-AGENTES-2026-11-26 §A2).
 *
 * Contrato:
 * - Las tareas arrancan en ESTRICTO orden de pedido y una a una (cero solape).
 * - Un rechazo NO envenena la cola: el error solo le llega al llamador de esa
 *   tarea y el siguiente turno entra igual.
 * - `alObtenerTurno` opcional: callback con los ms que la tarea esperó su
 *   turno (observabilidad barata — el log >200ms de rapidocr.ts).
 * - Cero costo en la ruta única (la primera llamada no espera nada).
 */
export interface TurnoFifo {
  /** Encola `fn`. Resuelve con el resultado de `fn`; rechaza SOLO con su error. */
  correr<T>(fn: () => Promise<T>, alObtenerTurno?: (esperaMs: number) => void): Promise<T>;
}

export function crearTurnoFifo(): TurnoFifo {
  let cola: Promise<unknown> = Promise.resolve();
  return {
    correr<T>(fn: () => Promise<T>, alObtenerTurno?: (esperaMs: number) => void): Promise<T> {
      const tPedido = performance.now();
      const arrancar = () => {
        alObtenerTurno?.(performance.now() - tPedido);
        return fn();
      };
      const turno = cola.then(arrancar, arrancar);
      // La cola nunca se encola con un rechazo: el siguiente entra igual.
      cola = turno.then(
        () => undefined,
        () => undefined,
      );
      return turno;
    },
  };
}
