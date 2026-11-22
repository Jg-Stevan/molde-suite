'use client';

// F6 (PLAN-AGENTE-LAYOUT) — Importación de moldes UNIVERSALES a Tamiz.
//
// Acepta DOS formas (retrocompatible con los exportes viejos de Studio):
//  1) Molde plano: { tipo: 'universal', version, nombre, campos, ... } —
//     exactamente lo que Studio siempre descargó.
//  2) Sobre con checksum (nuevo botón "Descargar .molde.json (con checksum)"):
//     { tipo: 'universal', version, nombre, checksum: <sha256 hex>, molde: {...} }
//     → se recalcula el SHA-256 del cuerpo y se compara con el declarado.
//
// Seguridad (decisión del plan):
//  · Límite de entrada: 2 MB — lo que exceda se rechaza ANTES de parsear.
//  · JAMÁS eval: validación puramente estructural (esMoldeUniversal/erroresMolde
//    de scanner-core) + chequeos de campo.
//  · paginasRef[].imagen con URL http(s) ABSOLUTA → rechazo duro ("El molde
//    referencia URLs remotas arbitrarias"). Las imágenes válidas son dataURLs
//    o claves de IndexedDB que TAMIZ resuelve localmente.
//  · dataURLs de referencia que sumen > 500 KB → aviso (no error).

import {
  esMoldeUniversal,
  erroresMolde,
  type MoldeUniversal,
} from '@jg-stevan/scanner-core/molde/universal-types';

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const AVISO_IMAGENES_BYTES = 500 * 1024; // 500 KB

export type ResultadoImportacion =
  | { ok: true; molde: MoldeUniversal; avisos: string[]; checksum?: string }
  | { ok: false; errores: string[] };

/** ArrayBuffer → hex en bloques (sin apply sobre buffers grandes). */
function aHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/** Detecta el sobre { checksum, molde } conservando el molde plano. */
function esSobreConMolde(p: unknown): p is { checksum: string; molde: unknown } {
  if (typeof p !== 'object' || p === null) return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.checksum === 'string' &&
    o.checksum.length > 0 &&
    typeof o.molde === 'object' &&
    o.molde !== null
  );
}

/** Suma del tamaño (caracteres) de las imágenes de referencia, y detección de
 *  URLs remotas http(s) — esas son rechazo DURO. */
function revisarPaginasRef(molde: unknown): { bytes: number; urlRemota: boolean } {
  let bytes = 0;
  let urlRemota = false;
  if (typeof molde !== 'object' || molde === null) return { bytes, urlRemota };
  const refs = (molde as Record<string, unknown>).paginasRef;
  if (!Array.isArray(refs)) return { bytes, urlRemota };
  for (const r of refs) {
    const imagen = (r as Record<string, unknown> | null)?.imagen;
    if (typeof imagen !== 'string') continue;
    bytes += imagen.length;
    if (/^https?:\/\//i.test(imagen.trim())) urlRemota = true;
  }
  return { bytes, urlRemota };
}

/**
 * Importa un molde desde texto JSON (archivo o textarea). Devuelve el molde
 * validado + avisos, o errores legibles en español. Async por crypto.subtle
 * (verificación de checksum del sobre).
 */
export async function importarMoldeDesdeTexto(texto: string): Promise<ResultadoImportacion> {
  if (!texto || !texto.trim()) {
    return { ok: false, errores: ['El texto está vacío: no hay molde que importar.'] };
  }
  const bytesTexto = new TextEncoder().encode(texto).length;
  if (bytesTexto > MAX_BYTES) {
    return {
      ok: false,
      errores: [
        `El archivo pesa ${(bytesTexto / (1024 * 1024)).toFixed(1)} MB y supera el límite de 2 MB.`,
      ],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(texto);
  } catch (err) {
    return {
      ok: false,
      errores: [`JSON ilegible: ${(err as Error).message.slice(0, 120)}`],
    };
  }

  let cuerpo: unknown = parsed;
  const avisos: string[] = [];
  let checksum: string | undefined;

  // Sobre con checksum: recalcular SHA-256 del cuerpo y comparar.
  if (esSobreConMolde(parsed)) {
    const sobre = parsed;
    // Sobre "medio": checksum presente pero 'molde' ausente se detecta arriba;
    // el caso inverso (molde sin checksum) cae al molde plano más abajo.
    if (!globalThis.crypto?.subtle) {
      return {
        ok: false,
        errores: [
          'Este contexto no permite verificar el checksum (requiere HTTPS o localhost). Importación cancelada.',
        ],
      };
    }
    const digest = await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(sobre.molde)),
    );
    const recalculado = aHex(digest);
    if (recalculado.toLowerCase() !== sobre.checksum.trim().toLowerCase()) {
      return {
        ok: false,
        errores: ['El checksum no coincide (archivo corrompido o alterado).'],
      };
    }
    cuerpo = sobre.molde;
    checksum = recalculado;
  } else if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'molde' in parsed &&
    typeof (parsed as Record<string, unknown>).molde === 'object'
  ) {
    return {
      ok: false,
      errores: ['El archivo trae un sobre con "molde" pero sin checksum: reexporta desde Studio con el botón de checksum.'],
    };
  }

  // Rechazo duro: URLs remotas arbitrarias en paginasRef.
  const refs = revisarPaginasRef(cuerpo);
  if (refs.urlRemota) {
    return {
      ok: false,
      errores: ['El molde referencia URLs remotas arbitrarias (paginasRef[].imagen http/https). No se permite.'],
    };
  }
  if (refs.bytes > AVISO_IMAGENES_BYTES) {
    avisos.push(
      `Las imágenes de referencia pesan ~${Math.round(refs.bytes / 1024)} KB en total: la importación funciona, pero considera moldes sin dataURL pesado.`,
    );
  }

  // Validación estructural del contrato universal v3 (motor compartido).
  if (!esMoldeUniversal(cuerpo)) {
    return { ok: false, errores: erroresMolde(cuerpo) };
  }

  return { ok: true, molde: cuerpo, avisos, checksum };
}
