'use client';

// Implementación IndexedDB del Repo para builds estáticos (GitHub Pages).
// Stores:
// - moldes:  { id, nombre, descripcion, documento, json, imagenRef, createdAt, updatedAt }
// - pruebas: { id, moldeId, archivo, fuenteUrl, score, requiereRevision, createdAt, updatedAt, resultadoJson }
// - archivos: { key, blob, tipo }  (documentos fuente y escaneos de referencia)
//
// Las URLs de documentos usan el esquema "idb:<uuid>/<nombre>" y se resuelven a
// object URLs del navegador vía resolverUrl(). IndexedDB se abre de forma LAZY
// (primera operación), nunca al importar el módulo: el prerender del build
// estático no toca el navegador.

import type { MoldeDB, PruebaDB } from '@/lib/studio-store';
import type {
  MoldeInput,
  MoldePatch,
  PruebaDetalleDB,
  PruebaInput,
  PruebaPatch,
  Repo,
  Resultado,
} from '@/lib/repo';

const DB_NOMBRE = 'molde-studio';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function abrir(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NOMBRE, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('moldes')) {
          db.createObjectStore('moldes', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('pruebas')) {
          const s = db.createObjectStore('pruebas', { keyPath: 'id' });
          s.createIndex('moldeId', 'moldeId', { unique: false });
        }
        if (!db.objectStoreNames.contains('archivos')) {
          db.createObjectStore('archivos', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB no disponible en este navegador'));
    });
  }
  return dbPromise;
}

function pedir<T>(
  store: string,
  modo: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return abrir().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, modo);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('Error de almacenamiento local'));
      }),
  );
}

interface MoldeRegistro {
  id: string;
  nombre: string;
  descripcion: string | null;
  documento: string | null;
  json: string;
  imagenRef: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PruebaRegistro {
  id: string;
  moldeId: string;
  archivo: string;
  fuenteUrl: string | null;
  score: number | null;
  requiereRevision: boolean;
  createdAt: string;
  updatedAt: string;
  resultadoJson: string;
}

interface ArchivoRegistro {
  key: string;
  blob: Blob;
  tipo: string;
}

function fallo(e: unknown): { ok: false; error: string } {
  return { ok: false, error: e instanceof Error ? e.message : 'Error de almacenamiento local' };
}

async function seguro<T>(fn: () => Promise<Resultado<T>>): Promise<Resultado<T>> {
  try {
    return await fn();
  } catch (e) {
    return fallo(e);
  }
}

function ahora(): string {
  return new Date().toISOString();
}

/** Caché de object URLs por clave idb: (evita recrear blobs en cada render). */
const objectUrls = new Map<string, string>();

export const repoIdb: Repo = {
  esEstatico: true,

  listarMoldes: () =>
    seguro(async () => {
      const moldes = await pedir<MoldeRegistro[]>('moldes', 'readonly', (s) => s.getAll());
      const pruebas = await pedir<PruebaRegistro[]>('pruebas', 'readonly', (s) => s.getAll());
      const conteo = new Map<string, number>();
      for (const p of pruebas) conteo.set(p.moldeId, (conteo.get(p.moldeId) ?? 0) + 1);
      const data: MoldeDB[] = moldes
        .map((m) => ({ ...m, _count: { pruebas: conteo.get(m.id) ?? 0 } }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return { ok: true, data };
    }),

  crearMolde: (input) =>
    seguro(async () => {
      const now = ahora();
      const reg: MoldeRegistro = {
        id: crypto.randomUUID(),
        nombre: input.nombre ?? input.json.nombre ?? 'Molde',
        descripcion: input.descripcion ?? null,
        documento:
          input.documento ?? (typeof input.json.documento === 'string' ? input.json.documento : null),
        json: JSON.stringify(input.json),
        imagenRef: null,
        createdAt: now,
        updatedAt: now,
      };
      await pedir('moldes', 'readwrite', (s) => s.put(reg));
      return { ok: true, data: { id: reg.id } };
    }),

  actualizarMolde: (id, patch) =>
    seguro(async () => {
      const reg = await pedir<MoldeRegistro | undefined>('moldes', 'readonly', (s) => s.get(id));
      if (!reg) return { ok: false as const, error: 'Molde no encontrado' };
      if (patch.json !== undefined) {
        reg.json = JSON.stringify(patch.json);
        reg.nombre = patch.nombre ?? patch.json.nombre ?? reg.nombre;
      } else if (patch.nombre !== undefined) {
        reg.nombre = patch.nombre;
      }
      if (patch.descripcion !== undefined) reg.descripcion = patch.descripcion;
      reg.updatedAt = ahora();
      await pedir('moldes', 'readwrite', (s) => s.put(reg));
      return { ok: true as const, data: undefined };
    }),

  eliminarMolde: (id) =>
    seguro(async () => {
      const ids = await pedir<IDBValidKey[]>(
        'pruebas',
        'readonly',
        (s) => s.index('moldeId').getAllKeys(IDBKeyRange.only(id)),
      );
      for (const pid of ids) {
        await pedir('pruebas', 'readwrite', (s) => s.delete(pid));
      }
      await pedir('moldes', 'readwrite', (s) => s.delete(id));
      return { ok: true as const, data: undefined };
    }),

  listarPruebas: (moldeId) =>
    seguro(async () => {
      const registros = moldeId
        ? await pedir<PruebaRegistro[]>(
            'pruebas',
            'readonly',
            (s) => s.index('moldeId').getAll(IDBKeyRange.only(moldeId)),
          )
        : await pedir<PruebaRegistro[]>('pruebas', 'readonly', (s) => s.getAll());
      const moldes = await pedir<MoldeRegistro[]>('moldes', 'readonly', (s) => s.getAll());
      const nombres = new Map(moldes.map((m) => [m.id, m.nombre]));
      const data: PruebaDB[] = registros
        .map((p) => ({
          id: p.id,
          moldeId: p.moldeId,
          archivo: p.archivo,
          score: p.score,
          requiereRevision: p.requiereRevision,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          fuenteUrl: p.fuenteUrl,
          molde: { nombre: nombres.get(p.moldeId) ?? '' },
        }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { ok: true, data };
    }),

  obtenerPrueba: (id) =>
    seguro(async () => {
      const p = await pedir<PruebaRegistro | undefined>('pruebas', 'readonly', (s) => s.get(id));
      if (!p) return { ok: false as const, error: 'Corrida no encontrada' };
      let resultados: unknown = null;
      try {
        resultados = JSON.parse(p.resultadoJson || 'null');
      } catch {
        resultados = null;
      }
      const data: PruebaDetalleDB = {
        id: p.id,
        moldeId: p.moldeId,
        archivo: p.archivo,
        fuente_url: p.fuenteUrl,
        score: p.score,
        requiere_revision: p.requiereRevision,
        createdAt: p.createdAt,
        updated_at: p.updatedAt,
        resultados,
      };
      return { ok: true as const, data };
    }),

  crearPrueba: (input) =>
    seguro(async () => {
      const now = ahora();
      const reg: PruebaRegistro = {
        id: crypto.randomUUID(),
        moldeId: input.moldeId,
        archivo: input.archivo,
        fuenteUrl: input.fuenteUrl ?? null,
        score: input.score,
        requiereRevision: input.requiereRevision,
        createdAt: now,
        updatedAt: now,
        resultadoJson: JSON.stringify(input.resultados ?? null),
      };
      await pedir('pruebas', 'readwrite', (s) => s.put(reg));
      return { ok: true, data: { id: reg.id } };
    }),

  actualizarPrueba: (id, patch: PruebaPatch) =>
    seguro(async () => {
      const p = await pedir<PruebaRegistro | undefined>('pruebas', 'readonly', (s) => s.get(id));
      if (!p) return { ok: false as const, error: 'Corrida no encontrada' };
      p.resultadoJson = JSON.stringify(patch.resultados ?? null);
      p.score = patch.score;
      p.requiereRevision = patch.requiereRevision;
      p.updatedAt = ahora();
      await pedir('pruebas', 'readwrite', (s) => s.put(p));
      return { ok: true as const, data: undefined };
    }),

  eliminarPrueba: (id) =>
    seguro(async () => {
      await pedir('pruebas', 'readwrite', (s) => s.delete(id));
      return { ok: true as const, data: undefined };
    }),

  subirArchivo: (file, nombre) =>
    seguro(async () => {
      const key = `idb:${crypto.randomUUID()}/${nombre}`;
      const reg: ArchivoRegistro = { key, blob: file, tipo: file.type || '' };
      await pedir('archivos', 'readwrite', (s) => s.put(reg));
      return { ok: true, data: { url: key } };
    }),

  resolverUrl: (url) =>
    (async () => {
      if (!url.startsWith('idb:')) return url;
      const cacheada = objectUrls.get(url);
      if (cacheada) return cacheada;
      const reg = await pedir<ArchivoRegistro | undefined>('archivos', 'readonly', (s) => s.get(url));
      if (!reg) throw new Error('El archivo ya no está en el almacenamiento local');
      const u = URL.createObjectURL(reg.blob);
      objectUrls.set(url, u);
      return u;
    })(),
};
