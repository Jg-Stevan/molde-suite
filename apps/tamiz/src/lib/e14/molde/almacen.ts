'use client';

// F6 (PLAN-AGENTE-LAYOUT) — Almacenamiento INDEXEDDB de moldes importados.
//
// localStorage (`tamiz.moldeActivo.v1`, registry.ts) sigue siendo la fuente del
// molde ACTIVO; esta base agrega una BIBLIOTECA local por dispositivo:
//  · DB: `tamiz-moldes-v1` · store: `moldes` (keyPath 'id').
//  · Cada fila: { id, nombre, guardadoEn (ISO), version, json (molde plano),
//    checksum? } — el json se guarda SIN sobre (ya validado al importar).
//  · API cruda de IndexedDB, sin dependencias nuevas.
//  · activarGuardado NO revalida: delega en activarMolde() del registry
//    (misma validación que siempre — un solo camino de verdad).
//  · migrarDesdeLocalStorage(): si hay un molde activo viejo en localStorage,
//    lo copia a la biblioteca (idempotente — mismo contenido, misma id).

import type { MoldeUniversal } from '@molde-suite/scanner-core/molde/universal-types';
import { activarMolde } from './registry';

const DB_NOMBRE = 'tamiz-moldes-v1';
const STORE = 'moldes';

export interface GuardadoMolde {
  id: string;
  nombre: string;
  /** Fecha de guardado en ISO 8601. */
  guardadoEn: string;
  version: string;
  /** El MOLDE plano (sin sobre/checksum) — listo para activarMolde(). */
  json: MoldeUniversal;
  /** Hex del sha256 si vino del sobre con checksum de Studio. */
  checksum?: string;
}

/** Promisifica una IDBRequest mínima (sin polyfills externos). */
function pedir<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB: error desconocido'));
  });
}

/** Abre (y migra si hace falta) la base. Falla honesto si no hay IndexedDB. */
function abrirDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB no está disponible en este entorno'));
      return;
    }
    const req = indexedDB.open(DB_NOMBRE, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB: no se pudo abrir'));
  });
}

/** ID determinista por contenido: mismo molde → misma fila (actualiza en vez
 *  de duplicar). Sin checksum (molde plano), cae a fecha de guardado. */
function idDe(molde: MoldeUniversal, checksum?: string): string {
  if (checksum) return `molde_${checksum.slice(0, 16)}`;
  return `molde_${Date.now().toString(36)}_${molde.nombre.replace(/\s+/g, '-').slice(0, 24)}`;
}

/** Lista de moldes guardados, más recientes primero. */
export async function listarMoldes(): Promise<GuardadoMolde[]> {
  try {
    const db = await abrirDb();
    const filas = await pedir(db.transaction(STORE, 'readonly').objectStore(STORE).getAll() as IDBRequest<GuardadoMolde[]>);
    db.close();
    return filas.sort((a, b) => (a.guardadoEn < b.guardadoEn ? 1 : -1));
  } catch {
    return [];
  }
}

/** Guarda (o actualiza) un molde en la biblioteca del dispositivo. */
export async function guardarMolde(molde: MoldeUniversal, checksum?: string): Promise<GuardadoMolde> {
  const db = await abrirDb();
  const fila: GuardadoMolde = {
    id: idDe(molde, checksum),
    nombre: molde.nombre,
    guardadoEn: new Date().toISOString(),
    version: molde.version,
    json: molde,
    ...(checksum ? { checksum } : {}),
  };
  await pedir(db.transaction(STORE, 'readwrite').objectStore(STORE).put(fila));
  db.close();
  return fila;
}

/** Borra un molde por id. */
export async function borrarMolde(id: string): Promise<void> {
  const db = await abrirDb();
  await pedir(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id));
  db.close();
}

/** Busca una fila por id. */
export async function obtenerMolde(id: string): Promise<GuardadoMolde | undefined> {
  try {
    const db = await abrirDb();
    const fila = await pedir(db.transaction(STORE, 'readonly').objectStore(STORE).get(id) as IDBRequest<GuardadoMolde | undefined>);
    db.close();
    return fila;
  } catch {
    return undefined;
  }
}

/**
 * AUTO (2026-11-27): el molde IDENTIFICADO por el router vive en la biblioteca,
 * no en localStorage — el lote multipágina y las páginas esperadas lo necesitan
 * por nombre. Más nuevo primero si hubiera dos filas con el mismo nombre.
 */
export async function moldePorNombre(nombre: string): Promise<MoldeUniversal | null> {
  if (!nombre) return null;
  const fila = (await listarMoldes()).find((f) => f.nombre === nombre);
  return fila?.json ?? null;
}

/** Carga la fila y activa su molde vía el registry EXISTENTE (validación
 *  única — aquí no se duplica esMoldeUniversal). */
export async function activarGuardado(
  id: string,
): Promise<{ ok: boolean; errores: string[]; nombre?: string }> {
  const db = await abrirDb();
  const fila = await pedir(db.transaction(STORE, 'readonly').objectStore(STORE).get(id) as IDBRequest<GuardadoMolde | undefined>);
  db.close();
  if (!fila) return { ok: false, errores: ['El molde guardado ya no existe en el dispositivo.'] };
  return activarMolde(fila.json);
}

/** Migra el molde activo viejo (localStorage `tamiz.moldeActivo.v1`) a la
 *  biblioteca IndexedDB. Silencioso e idempotente: si no hay nada o ya existe
 *  la fila, no hace nada. */
export async function migrarDesdeLocalStorage(): Promise<void> {
  try {
    if (typeof window === 'undefined') return;
    const crudo = window.localStorage.getItem('tamiz.moldeActivo.v1');
    if (!crudo) return;
    const molde = JSON.parse(crudo) as MoldeUniversal;
    if (typeof molde?.nombre !== 'string' || typeof molde?.campos === 'undefined') return;
    const db = await abrirDb();
    const id = `molde_local_${molde.nombre.replace(/\s+/g, '-').slice(0, 24)}`;
    const fila: GuardadoMolde = {
      id,
      nombre: molde.nombre,
      guardadoEn: new Date().toISOString(),
      version: molde.version,
      json: molde,
    };
    await pedir(db.transaction(STORE, 'readwrite').objectStore(STORE).put(fila));
    db.close();
  } catch {
    /* migración best-effort: nunca bloquea el panel */
  }
}
