// Puente de envío: estado del hub de sincronización. Sin hub desplegado,
// sincronizarAhora resuelve con detalle honesto ("sin hub") y la cola se
// cuenta desde el store local.

export interface EstadoPuente {
  activo: boolean;
  enviadasOk: number;
  ultimaSyncTs: number | null;
  ultimoError: string | null;
}

const CLAVE_HUB = 'tamiz.puente.hub';

let estado: EstadoPuente = {
  activo: false,
  enviadasOk: 0,
  ultimaSyncTs: null,
  ultimoError: null,
};

/** Snapshot COPIA del estado del puente. */
export function estadoPuente(): EstadoPuente {
  return { ...estado };
}

/** URL del hub en uso (null = sin hub). */
export function hubEnUso(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(CLAVE_HUB);
}

/** true si el hub apunta al propio origen. */
export function esOrigenLocal(): boolean {
  return hubEnUso() === window.location.origin;
}

/**
 * Apunta el hub al origen local (true) o lo limpia (false). Devuelve el hub
 * resultante o null si el navegador bloqueó el almacenamiento.
 */
export function fijarHubLocal(apuntarALocal: boolean): string | null {
  if (typeof window === 'undefined') return null;
  try {
    if (apuntarALocal) {
      window.localStorage.setItem(CLAVE_HUB, window.location.origin);
      return window.location.origin;
    }
    window.localStorage.removeItem(CLAVE_HUB);
    return null;
  } catch {
    return null;
  }
}

/** Intenta sincronizar la cola con el hub (sin hub: detalle honesto). */
export async function sincronizarAhora(): Promise<{ detalle: string; enviadas: number }> {
  const hub = hubEnUso();
  if (!hub) {
    estado = { ...estado, ultimoError: 'SIN HUB CONFIGURADO' };
    return { detalle: 'SIN HUB CONFIGURADO — ENVÍO LOCAL ÚNICAMENTE', enviadas: 0 };
  }
  try {
    const res = await fetch(`${hub}/api/puente/ping`, { method: 'HEAD' });
    if (!res.ok) throw new Error(`HUB RESPONDIÓ ${res.status}`);
    estado = { ...estado, activo: true, ultimaSyncTs: Date.now(), ultimoError: null };
    return { detalle: 'HUB CONECTADO', enviadas: 0 };
  } catch (e) {
    estado = { ...estado, activo: false, ultimoError: (e as Error).message };
    return { detalle: `HUB NO ALCANZABLE (${(e as Error).message})`, enviadas: 0 };
  }
}

/** Supervisión del puente: reconecta el hub al volver online (idempotente). */
export function iniciarPuenteSupervision(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('online', () => {
    void sincronizarAhora();
  });
}
