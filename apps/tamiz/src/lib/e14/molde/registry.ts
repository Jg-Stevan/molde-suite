// FASE 0 (blueprint DLA): registro del MOLDE ACTIVO de Tamiz. El molde es el
// contrato Studio↔Tamiz (MoldeUniversal v3): el operador importa el JSON del
// molde (desde el Panel de diagnóstico, DEV) y el pipeline lo ejecuta tras el
// gate en CADA escaneo — evaluación de campos por zona/ancla con el motor
// universal compartido (packages/scanner-core/molde).
//
// Persistencia: localStorage (`tamiz.moldeActivo.v1`) — sobrevive recargas
// del PWA sin backend. El JSON de un molde E-14 v3 ronda los ~20-60 KB
// (imagen de referencia aparte): bajo el presupuesto de localStorage.

import { esMoldeUniversal, erroresMolde, type MoldeUniversal } from '@jg-stevan/scanner-core/molde/universal-types';

const CLAVE = 'tamiz.moldeActivo.v1';

let cache: MoldeUniversal | null | undefined = undefined;

/** Molde activo de la sesión (null = sin molde: el pipeline no evalúa nada). */
export function moldeActivo(): MoldeUniversal | null {
  if (cache !== undefined) return cache;
  if (typeof window === 'undefined') return null;
  try {
    const crudo = window.localStorage.getItem(CLAVE);
    if (!crudo) {
      cache = null;
      return null;
    }
    const parsed: unknown = JSON.parse(crudo);
    cache = esMoldeUniversal(parsed) ? parsed : null;
  } catch {
    cache = null;
  }
  return cache;
}

/** Activa un molde (valida estructura v3 — un molde malformado NO se activa). */
export function activarMolde(json: unknown): { ok: boolean; errores: string[]; nombre?: string } {
  if (!esMoldeUniversal(json)) {
    return { ok: false, errores: erroresMolde(json) };
  }
  cache = json;
  try {
    window.localStorage.setItem(CLAVE, JSON.stringify(json));
  } catch {
    /* localStorage lleno/indisponible: el molde vive solo en memoria */
  }
  return { ok: true, errores: [], nombre: json.nombre };
}

/** Desactiva el molde activo (el pipeline vuelve al comportamiento de siempre). */
export function desactivarMolde(): void {
  cache = null;
  try {
    window.localStorage.removeItem(CLAVE);
  } catch {
    /* memoria ya queda limpiada */
  }
}
