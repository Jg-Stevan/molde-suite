'use client';

// F5 (PLAN-AGENTE-LAYOUT) — descarga OPCIONAL del modelo plus-L
// (PP-DocLayout-L, 129,7 MB) con verificación SHA-256 y Cache Storage.
//
// Reglas del plan:
//  · La metadata (bytes, sha256) viene de MODELOS_LAYOUT (@jg-stevan/layout-core):
//    ÚNICA fuente de verdad — aquí NO se duplica ningún hash.
//  · NUNCA se precachea plus-L en el Service Worker: es una descarga explícita
//    del operador (botón "Descargar plus-L"), verificada byte a byte antes de
//    entrar a `tamiz-modelos-v1`.
//  · El cache usa SIEMPRE la clave canónica '/models/pp_doclayout_plus_l.onnx'
//    para que el SW (cache-first de /models/) y las cabeceras _headers
//    (immutable) la sirvan igual venga de la URL que venga.
//  · La INFERENCIA con plus-L llega en una fase posterior (el preset no existe
//    aún en dla-onnx): este módulo solo cubre descarga/verificación/borrado.
//
// PRIVACIDAD: este módulo solo mueve BINARIOS del modelo — jamás toca fotos
// de documentos (esas viven en memoria/dataURLs de la app, sin URL cacheable).

import { MODELOS_LAYOUT } from '@jg-stevan/layout-core';

/** Clave canónica en Cache Storage (coincide con el patrón /models/ del SW). */
const CLAVE_CACHE = '/models/pp_doclayout_plus_l.onnx';
const CACHE_MODELOS = 'tamiz-modelos-v1';

const MODELO_PLUS_L = MODELOS_LAYOUT.plusL;

/** URL de origen del binario: build-time env o la ruta canónica servida
 *  junto a la app (desarrollo: apps/tamiz/public/models/). */
export function urlPlusL(): string {
  return process.env.NEXT_PUBLIC_DLA_MODELO_PLUSL ?? '/models/pp_doclayout_plus_l.onnx';
}

/** Progreso de descarga para la barra de UI. total/pct null = el servidor no
 *  envió Content-Length (se muestra el conteo de bytes crudo). */
export interface ProgresoPlusL {
  recibidos: number;
  total: number | null;
  pct: number | null;
}

export type ResultadoDescarga =
  | { ok: true; bytes: number; sha256: string }
  | { ok: false; error: string };

/** Buffer de origen → hex (minúsculas), en bloques para no explotar el stack
 *  con Function.prototype.apply sobre 130 MB. */
function aHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/** Une los trozos del stream en UN buffer exacto (para digest y cache.put). */
function combinarTrozos(trozos: Uint8Array[], total: number): Uint8Array {
  const todo = new Uint8Array(total);
  let offset = 0;
  for (const t of trozos) {
    todo.set(t, offset);
    offset += t.byteLength;
  }
  return todo;
}

/**
 * Descarga plus-L con progreso (ReadableStream), verifica el SHA-256 contra
 * MODELOS_LAYOUT y — solo si coincide byte a byte — lo escribe en
 * `tamiz-modelos-v1` bajo la clave canónica. Cualquier fallo devuelve un
 * mensaje honesto en español y NO escribe el cache.
 */
export async function descargarPlusL(
  onProgreso?: (p: ProgresoPlusL) => void,
): Promise<ResultadoDescarga> {
  if (!globalThis.crypto?.subtle) {
    return {
      ok: false,
      error:
        'Este contexto no permite verificar el SHA-256 (se requiere HTTPS o localhost). Descarga cancelada por seguridad.',
    };
  }
  const fuente = urlPlusL();
  let respuesta: Response;
  try {
    respuesta = await fetch(fuente);
  } catch (err) {
    return { ok: false, error: `No se pudo conectar: ${(err as Error).message}` };
  }
  if (!respuesta.ok) {
    return {
      ok: false,
      error: `La descarga falló (HTTP ${respuesta.status}) desde ${fuente}. Verifica que el modelo esté publicado en esa ruta.`,
    };
  }

  const total = Number(respuesta.headers.get('content-length') ?? '') || null;
  const trozos: Uint8Array[] = [];
  let recibidos = 0;

  if (respuesta.body) {
    const lector = respuesta.body.getReader();
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      if (value) {
        trozos.push(value);
        recibidos += value.byteLength;
        const pct = total ? Math.min(100, Math.round((recibidos / total) * 100)) : null;
        onProgreso?.({ recibidos, total, pct });
      }
    }
  } else {
    // Navegador sin ReadableStream en Response (raro): baja directo y reporta
    // un solo golpe de progreso.
    const todo = new Uint8Array(await respuesta.arrayBuffer());
    trozos.push(todo);
    recibidos = todo.byteLength;
    onProgreso?.({ recibidos, total, pct: 100 });
  }

  // Verificación 1: tamaño declarado en el contrato (byte a byte).
  if (recibidos !== MODELO_PLUS_L.bytes) {
    return {
      ok: false,
      error: `Tamaño incorrecto: descargados ${formatearMB(recibidos)} pero el contrato exige ${formatearMB(MODELO_PLUS_L.bytes)}. No se guardó nada.`,
    };
  }

  // Verificación 2: SHA-256 del buffer COMPLETO (se concatena tras descargar).
  const combinado = combinarTrozos(trozos, recibidos);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', combinado.buffer as ArrayBuffer);
  const sha256 = aHex(digest);
  if (sha256 !== MODELO_PLUS_L.sha256) {
    return {
      ok: false,
      error: `El checksum no coincide (obtenido ${sha256.slice(0, 12)}…, esperado ${MODELO_PLUS_L.sha256.slice(0, 12)}…). Archivo corrompido o alterado: NO se guardó.`,
    };
  }

  // Todo verificado: se escribe en el cache de modelos (clave canónica).
  const cache = await caches.open(CACHE_MODELOS);
  await cache.put(
    CLAVE_CACHE,
    new Response(combinado.buffer as ArrayBuffer, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(recibidos),
        'X-Tamiz-Sha256': sha256,
      },
    }),
  );
  onProgreso?.({ recibidos, total, pct: 100 });
  return { ok: true, bytes: recibidos, sha256 };
}

/** Estado del modelo en el dispositivo (lee cabeceras — no materializa 130 MB). */
export async function estadoPlusL(): Promise<{ presente: boolean; bytes: number | null }> {
  try {
    const cache = await caches.open(CACHE_MODELOS);
    const golpe = await cache.match(CLAVE_CACHE);
    if (!golpe) return { presente: false, bytes: null };
    const cl = Number(golpe.headers.get('content-length') ?? '') || null;
    return { presente: true, bytes: cl };
  } catch {
    return { presente: false, bytes: null };
  }
}

/** Borra la entrada de plus-L del cache de modelos. */
export async function borrarPlusL(): Promise<boolean> {
  try {
    const cache = await caches.open(CACHE_MODELOS);
    return await cache.delete(CLAVE_CACHE);
  } catch {
    return false;
  }
}

// ── Almacenamiento del dispositivo (persistencia del navegador) ────────────

export async function usoAlmacenamiento(): Promise<{ uso: number; cuota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    return { uso: usage ?? 0, cuota: quota ?? 0 };
  } catch {
    return null;
  }
}

export async function persistenciaActiva(): Promise<boolean> {
  if (!navigator.storage?.persisted) return false;
  try {
    return await navigator.storage.persisted();
  } catch {
    return false;
  }
}

/** Pide almacenamiento persistente (evita que el SO evapore caches/models). */
export async function pedirPersistencia(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** Formato español "129,7 MB" — coma decimal, una cifra. */
export function formatearMB(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1).replace('.', ',')} MB`;
}
