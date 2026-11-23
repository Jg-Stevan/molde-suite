'use client';

// Implementación IndexedDB del Repo para builds estáticos (GitHub Pages).
// Stores:
// - moldes:  { id, nombre, descripcion, documento, json, imagenRef, createdAt, updatedAt }
// - pruebas: { id, moldeId, archivo, fuenteUrl, fuenteUrls?, score, requiereRevision, createdAt, updatedAt, resultadoJson }
// - archivos: { key, blob, tipo }  (documentos fuente y escaneos de referencia)
//
// Las URLs de documentos usan el esquema "idb:<uuid>/<nombre>" y se resuelven a
// object URLs del navegador vía resolverUrl(). IndexedDB se abre de forma LAZY
// (primera operación), nunca al importar el módulo: el prerender del build
// estático no toca el navegador.

import type {
  MoldeDB,
  MoldeInput,
  MoldePatch,
  PruebaDB,
  PruebaDetalleDB,
  PruebaInput,
  PruebaPatch,
  Repo,
  Resultado,
} from '@/lib/repo-types';

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
  /** D1: páginas fuente ordenadas de una corrida multi-página (set completo). */
  fuenteUrls?: string[] | null;
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

/** N-7c: revoca el object URL de una clave idb: y borra su blob del store. */
async function revocarArchivo(key: string | null | undefined): Promise<void> {
  if (!key || !key.startsWith('idb:')) return;
  const u = objectUrls.get(key);
  if (u) {
    URL.revokeObjectURL(u);
    objectUrls.delete(key);
  }
  await pedir('archivos', 'readwrite', (s) => s.delete(key)).catch(() => undefined);
}

// ---- Semilla: molde del Acta E-14 preinstalado en el modo estático ----
// Al abrir el sitio en GitHub Pages la biblioteca nacía vacía (el IndexedDB es
// por dispositivo). En la PRIMERA visita se siembra el molde del Acta E-14
// Exterior con sus páginas de referencia (/actas-e14/*.png servidas por el
// propio build), para que la biblioteca llegue con el acta lista para usar.
// Un flag en localStorage evita duplicar la semilla y evita resucitar el molde
// si el usuario lo eliminó a propósito.
import moldeE14Seed from '../../templates/e14/molde-e14.json';
import moldeComprobanteSeed from '../../templates/genericos/comprobante_entrega.molde.json';
import moldeReciboSeed from '../../templates/genericos/recibo_pago.molde.json';
import moldeE22Seed from '../../templates/genericos/e22_resolucion.molde.json';
import moldeE24Seed from '../../templates/genericos/e24_cuadro.molde.json';
import moldeE26Seed from '../../templates/genericos/e26_acta_parcial.molde.json';

const ID_SEMILLA_E14 = 'semilla-acta-e14-exterior';
const FLAG_SEMILLA_E14 = 'molde-studio-semilla-e14';

// ---- Semilla: moldes genéricos creados para Tamiz ----
// La biblioteca de Pages arranca solo con el E-14. Estos moldes ya viajan en
// el build de Tamiz; aquí se siembran en Molde Studio para poder abrirlos y
// calibrarlos. Flag propio y versionado: los visitantes anteriores reciben la
// siembra una vez, y un molde borrado a propósito no resucita.
const FLAG_SEMILLA_GENERICOS = 'molde-studio-semilla-genericos-v1';

const SEMILLAS_GENERICAS = [
  { id: 'semilla-generico-comprobante-entrega', json: moldeComprobanteSeed },
  { id: 'semilla-generico-recibo-pago', json: moldeReciboSeed },
  { id: 'semilla-generico-e22-resolucion', json: moldeE22Seed },
  { id: 'semilla-generico-e24-cuadro', json: moldeE24Seed },
  { id: 'semilla-generico-e26-acta-parcial', json: moldeE26Seed },
];

async function sembrarGenericosSiToca(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const existentes = await pedir<MoldeRegistro[]>('moldes', 'readonly', (s) => s.getAll());
    const porId = new Map(existentes.map((m) => [m.id, m]));
    const now = ahora();
    // Siembras anteriores (sin referencias): se les añade paginasRef sin tocar
    // el resto del molde, que puede tener ediciones del usuario.
    for (const { id, json } of SEMILLAS_GENERICAS) {
      const reg = porId.get(id);
      if (!reg) continue;
      try {
        const guardado = JSON.parse(reg.json) as { paginasRef?: unknown };
        if (guardado.paginasRef) continue;
        guardado.paginasRef = json.paginasRef;
        reg.json = JSON.stringify(guardado);
        reg.imagenRef = reg.imagenRef ?? json.paginasRef?.[0]?.imagen ?? null;
        reg.updatedAt = now;
        await pedir('moldes', 'readwrite', (s) => s.put(reg));
      } catch {
        /* json corrupto: no tocar */
      }
    }
    if (localStorage.getItem(FLAG_SEMILLA_GENERICOS)) return;
    for (const { id, json } of SEMILLAS_GENERICAS) {
      if (porId.has(id)) continue;
      const reg: MoldeRegistro = {
        id,
        nombre: json.nombre,
        descripcion: json.descripcion ?? null,
        documento: json.documento ?? null,
        json: JSON.stringify(json),
        imagenRef: json.paginasRef?.[0]?.imagen ?? null,
        createdAt: now,
        updatedAt: now,
      };
      await pedir('moldes', 'readwrite', (s) => s.put(reg));
    }
    localStorage.setItem(FLAG_SEMILLA_GENERICOS, 'v1');
  } catch {
    /* la semilla jamás debe romper la app */
  }
}

async function sembrarE14SiToca(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    if (localStorage.getItem(FLAG_SEMILLA_E14)) return;
    // Se marca ANTES de revisar: si ya hay moldes (usuario avanzado que importó
    // los suyos), no se duplica nada y futuras visitas no reintenta.
    localStorage.setItem(FLAG_SEMILLA_E14, 'e14');
    const existentes = await pedir<MoldeRegistro[]>('moldes', 'readonly', (s) => s.getAll());
    if (existentes.length > 0) return;
    const paginas = (moldeE14Seed.paginasRef ?? []).map((p) => ({
      pagina: p.pagina,
      imagen: p.imagen,
    }));
    const primera = paginas.find((pg) => pg.pagina === 1)?.imagen ?? paginas[0]?.imagen ?? null;
    const now = ahora();
    const reg: MoldeRegistro = {
      id: ID_SEMILLA_E14,
      nombre: moldeE14Seed.nombre,
      descripcion: moldeE14Seed.descripcion ?? null,
      documento: moldeE14Seed.documento ?? null,
      json: JSON.stringify(moldeE14Seed),
      imagenRef: primera,
      createdAt: now,
      updatedAt: now,
    };
    await pedir('moldes', 'readwrite', (s) => s.put(reg));
  } catch {
    /* la semilla jamás debe romper la app */
  }
}

export const repoIdb: Repo = {
  esEstatico: true,

  listarMoldes: () =>
    seguro(async () => {
      await sembrarE14SiToca();
      await sembrarGenericosSiToca();
      const moldes = await pedir<MoldeRegistro[]>('moldes', 'readonly', (s) => s.getAll());
      const pruebas = await pedir<PruebaRegistro[]>('pruebas', 'readonly', (s) => s.getAll());
      const conteo = new Map<string, number>();
      // N-1: score de la ÚLTIMA corrida por molde (igual que la API con
      // orderBy createdAt desc + take 1) — antes el score real nunca llegaba
      // a la Biblioteca en modo estático.
      const ultimoScore = new Map<string, number | null>();
      for (const p of [...pruebas].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
        if (!conteo.has(p.moldeId)) {
          conteo.set(p.moldeId, 0);
          ultimoScore.set(p.moldeId, p.score);
        }
        conteo.set(p.moldeId, (conteo.get(p.moldeId) ?? 0) + 1);
      }
      const data: MoldeDB[] = moldes
        .map((m) => ({
          ...m,
          _count: { pruebas: conteo.get(m.id) ?? 0 },
          pruebas: ultimoScore.has(m.id) ? [{ score: ultimoScore.get(m.id) ?? null }] : [],
        }))
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
        // N-7c: si el JSON nuevo trae menos escaneos de referencia (p. ej. se
        // reemplazó la imagen de una página), los blobs huérfanos se borran.
        const clavesNuevas = new Set((patch.json.paginasRef ?? []).map((p) => p.imagen));
        try {
          const viejo = JSON.parse(reg.json) as { paginasRef?: { imagen: string }[] };
          for (const p of viejo.paginasRef ?? []) {
            if (!clavesNuevas.has(p.imagen)) await revocarArchivo(p.imagen);
          }
        } catch {
          /* json viejo corrupto: nada que limpiar */
        }
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
      // N-7b: recopila las URLs de blobs (fuentes de las corridas + escaneos de
      // referencia del molde) para revocarlas y borrarlas del store archivos —
      // antes quedaban MB huérfanos en IndexedDB para siempre.
      const reg = await pedir<MoldeRegistro | undefined>('moldes', 'readonly', (s) => s.get(id));
      let paginasRef: string[] = [];
      if (reg) {
        try {
          const json = JSON.parse(reg.json) as { paginasRef?: { imagen: string }[] };
          paginasRef = (json.paginasRef ?? []).map((p) => p.imagen);
        } catch {
          /* json corrupto: sin blobs de referencia que limpiar */
        }
      }
      const pruebas = await pedir<PruebaRegistro[]>(
        'pruebas',
        'readonly',
        (s) => s.index('moldeId').getAll(IDBKeyRange.only(id)),
      );
      for (const p of pruebas) {
        await revocarArchivo(p.fuenteUrl);
        // D1: revoca también todas las páginas fuente multi-página.
        for (const url of p.fuenteUrls ?? []) await revocarArchivo(url);
        await pedir('pruebas', 'readwrite', (s) => s.delete(p.id));
      }
      for (const key of paginasRef) await revocarArchivo(key);
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
          fuente_urls: p.fuenteUrls ?? null,
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
        fuente_urls: p.fuenteUrls ?? null,
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
        // D1: set completo de páginas (el cliente solo lo envía si todas subieron).
        fuenteUrls: input.fuenteUrls && input.fuenteUrls.length >= 2 ? input.fuenteUrls : null,
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
      // N-7c: la fuente de una corrida eliminada ya no se usa: se revoca.
      // D1: con fuentes multi-página se revocan TODAS las páginas.
      const p = await pedir<PruebaRegistro | undefined>('pruebas', 'readonly', (s) => s.get(id));
      if (p) {
        await revocarArchivo(p.fuenteUrl);
        for (const url of p.fuenteUrls ?? []) await revocarArchivo(url);
      }
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
      if (!url.startsWith('idb:')) {
        // Build estático (GitHub Pages): las rutas absolutas a archivos de /public
        // (p. ej. paginasRef "/actas-e14/referencia-p1.png" de un molde importado)
        // necesitan el prefijo del basePath; sin él el navegador pedía
        // /actas-e14/... fuera de /molde-suite/ y obtenía un 404.
        const base = process.env.NEXT_PUBLIC_BASE_PATH;
        return base && url.startsWith('/') ? `${base}${url}` : url;
      }
      const cacheada = objectUrls.get(url);
      if (cacheada) return cacheada;
      const reg = await pedir<ArchivoRegistro | undefined>('archivos', 'readonly', (s) => s.get(url));
      if (!reg) throw new Error('El archivo ya no está en el almacenamiento local');
      const u = URL.createObjectURL(reg.blob);
      objectUrls.set(url, u);
      return u;
    })(),
};
