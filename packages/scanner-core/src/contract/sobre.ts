// Sobre con checksum del molde .molde.json — Fase 2b (migración scanner-core).
//
// ABSORBE el protocolo espejado (D5 del Plan de Reconciliación):
//  · Productor (Studio, EditorTab.tsx:1513-1533): { tipo, version, nombre,
//    checksum: <sha256 hex de JSON.stringify(molde)>, molde }
//  · Consumidor (Tamiz, importar.ts): recalcula el SHA-256 del cuerpo y lo
//    compara en minúsculas.
// Se porta byte a byte (JSON.stringify + TextEncoder + SHA-256 hex) para que
// los sobres existentes sigan verificando. WebCrypto puro; sin crypto.subtle
// la verificación FALLA (jamás acepta un sobre sin verificar).

import type { MoldeUniversal } from '../../molde/universal-types';
import { sha256HexDeTexto } from '../../core/hash';

export interface SobreMolde {
  tipo: 'universal';
  version: string;
  nombre: string;
  /** SHA-256 hex de JSON.stringify(molde). */
  checksum: string;
  molde: MoldeUniversal;
}

/** Detecta el sobre { checksum, molde } (misma semántica que consumía tamiz). */
export function esSobreConMolde(p: unknown): p is { checksum: string; molde: unknown } {
  if (typeof p !== 'object' || p === null) return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.checksum === 'string' &&
    o.checksum.length > 0 &&
    typeof o.molde === 'object' &&
    o.molde !== null
  );
}

/** SHA-256 hex del cuerpo del molde (null sin crypto.subtle). */
export async function checksumDeMolde(molde: unknown): Promise<string | null> {
  return sha256HexDeTexto(JSON.stringify(molde));
}

/** Crea el sobre firmado. null sin crypto.subtle (no inventa checksum). */
export async function crearSobreMolde(molde: MoldeUniversal): Promise<SobreMolde | null> {
  const checksum = await checksumDeMolde(molde);
  if (!checksum) return null;
  return {
    tipo: 'universal',
    version: molde.version,
    nombre: molde.nombre,
    checksum,
    molde,
  };
}

export type VerificacionSobre =
  | { ok: true; checksum: string }
  | { ok: false; motivo: 'sin_crypto' | 'checksum_invalido' };

/** Verifica el sobre: recalcula el SHA-256 del cuerpo y compara (case-insensitive). */
export async function verificarSobreMolde(
  sobre: { checksum: string; molde: unknown },
): Promise<VerificacionSobre> {
  if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle) {
    return { ok: false, motivo: 'sin_crypto' };
  }
  const recalculado = await checksumDeMolde(sobre.molde);
  if (!recalculado || recalculado.toLowerCase() !== sobre.checksum.trim().toLowerCase()) {
    return { ok: false, motivo: 'checksum_invalido' };
  }
  return { ok: true, checksum: recalculado };
}
