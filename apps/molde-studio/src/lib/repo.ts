'use client';

// Capa de acceso a datos del Molde Studio con DOS implementaciones:
// - apiRepo (por defecto, despliegue con servidor): habla con /api/* (Prisma + SQLite).
// - repoIdb (build estático, GitHub Pages): persiste TODO en IndexedDB del navegador.
// La selección se hace en TIEMPO DE COMPILACIÓN vía NEXT_PUBLIC_STATIC=1, así que
// el bundle estático publicado en Pages no contiene ninguna llamada al backend.
//
// Contrato: todos los métodos devuelven { ok, data | error } y NUNCA lanzan
// (excepto resolverUrl, que sí puede fallar si el archivo local no existe).

import { useEffect, useState } from 'react';
import type { MoldeDB, PruebaDB } from '@/lib/studio-store';
import type { MoldeUniversal } from '@/lib/molde/universal-types';
import { repoIdb } from '@/lib/repo-idb';

export type Resultado<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export interface MoldeInput {
  json: MoldeUniversal;
  nombre?: string;
  descripcion?: string | null;
  documento?: string | null;
}

export interface MoldePatch {
  json?: MoldeUniversal;
  nombre?: string;
  descripcion?: string | null;
}

export interface PruebaInput {
  moldeId: string;
  archivo: string;
  fuenteUrl?: string | null;
  resultados: unknown;
  score: number;
  requiereRevision: boolean;
}

export interface PruebaPatch {
  resultados: unknown;
  score: number;
  requiereRevision: boolean;
}

/** Reporte completo de una corrida (mismo contrato que GET /api/pruebas/:id). */
export interface PruebaDetalleDB {
  id: string;
  moldeId: string;
  archivo: string;
  fuente_url: string | null;
  score: number | null;
  requiere_revision: boolean;
  createdAt: string;
  updated_at: string;
  resultados: unknown;
}

export interface Repo {
  readonly esEstatico: boolean;
  listarMoldes(): Promise<Resultado<MoldeDB[]>>;
  crearMolde(input: MoldeInput): Promise<Resultado<{ id: string }>>;
  actualizarMolde(id: string, patch: MoldePatch): Promise<Resultado<undefined>>;
  eliminarMolde(id: string): Promise<Resultado<undefined>>;
  listarPruebas(moldeId?: string): Promise<Resultado<PruebaDB[]>>;
  obtenerPrueba(id: string): Promise<Resultado<PruebaDetalleDB>>;
  crearPrueba(input: PruebaInput): Promise<Resultado<{ id: string }>>;
  actualizarPrueba(id: string, patch: PruebaPatch): Promise<Resultado<undefined>>;
  eliminarPrueba(id: string): Promise<Resultado<undefined>>;
  /** Guarda un documento y devuelve su URL persistida (/uploads/x o idb:x). */
  subirArchivo(file: File | Blob, nombre: string): Promise<Resultado<{ url: string }>>;
  /** Convierte una URL persistida en algo usable por <img> / fetch (object URL en IDB). */
  resolverUrl(url: string): Promise<string>;
}

/** true cuando el bundle fue compilado para hosting estático (GitHub Pages). */
export const MODO_ESTATICO = process.env.NEXT_PUBLIC_STATIC === '1';

async function leerError(res: Response, fallback: string): Promise<string> {
  try {
    const j = (await res.json()) as { error?: string };
    return j.error || fallback;
  } catch {
    return fallback;
  }
}

const apiRepo: Repo = {
  esEstatico: false,

  async listarMoldes() {
    try {
      const res = await fetch('/api/moldes');
      if (!res.ok) return { ok: false, error: await leerError(res, 'No se pudo cargar la biblioteca') };
      return { ok: true, data: (await res.json()) as MoldeDB[] };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },

  async crearMolde(input) {
    try {
      const res = await fetch('/api/moldes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: input.json }),
      });
      if (!res.ok) return { ok: false, error: await leerError(res, 'No se pudo crear el molde') };
      const j = (await res.json()) as { id?: string };
      return { ok: true, data: { id: j.id ?? '' } };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },

  async actualizarMolde(id, patch) {
    try {
      const body: Record<string, unknown> = {};
      if (patch.json !== undefined) body.json = patch.json;
      if (patch.nombre !== undefined) body.nombre = patch.nombre;
      if (patch.descripcion !== undefined) body.descripcion = patch.descripcion;
      const res = await fetch(`/api/moldes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) return { ok: false, error: await leerError(res, 'No se pudo guardar el molde') };
      return { ok: true, data: undefined };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },

  async eliminarMolde(id) {
    try {
      const res = await fetch(`/api/moldes/${id}`, { method: 'DELETE' });
      if (!res.ok) return { ok: false, error: await leerError(res, 'No se pudo eliminar el molde') };
      return { ok: true, data: undefined };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },

  async listarPruebas(moldeId) {
    try {
      const url = moldeId ? `/api/pruebas?moldeId=${moldeId}` : '/api/pruebas';
      const res = await fetch(url);
      if (!res.ok) return { ok: false, error: 'No se pudo cargar el historial de corridas' };
      return { ok: true, data: (await res.json()) as PruebaDB[] };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },

  async obtenerPrueba(id) {
    try {
      const res = await fetch(`/api/pruebas/${id}`);
      if (!res.ok) return { ok: false, error: 'No se pudo cargar la corrida' };
      return { ok: true, data: (await res.json()) as PruebaDetalleDB };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },

  async crearPrueba(input) {
    try {
      const res = await fetch('/api/pruebas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) return { ok: false, error: await leerError(res, 'No se pudo guardar la corrida') };
      const j = (await res.json()) as { id?: string };
      return { ok: true, data: { id: j.id ?? '' } };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },

  async actualizarPrueba(id, patch) {
    try {
      const res = await fetch(`/api/pruebas/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) return { ok: false, error: await leerError(res, 'No se pudo actualizar la corrida') };
      return { ok: true, data: undefined };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },

  async eliminarPrueba(id) {
    try {
      const res = await fetch(`/api/pruebas/${id}`, { method: 'DELETE' });
      if (!res.ok) return { ok: false, error: 'No se pudo eliminar la corrida' };
      return { ok: true, data: undefined };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },

  async subirArchivo(file, nombre) {
    try {
      const fd = new FormData();
      fd.append('file', file, nombre);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!res.ok) return { ok: false, error: await leerError(res, 'No se pudo guardar el archivo') };
      const j = (await res.json()) as { url?: string };
      if (!j.url) return { ok: false, error: 'El servidor no devolvió la URL del archivo' };
      return { ok: true, data: { url: j.url } };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },

  async resolverUrl(url) {
    return url;
  },
};

export const repo: Repo = MODO_ESTATICO ? repoIdb : apiRepo;

/** Hook para renderizar URLs de documentos persistidos (/uploads/... o idb:...):
 * en modo estático resuelve la clave IndexedDB a un object URL del navegador. */
export function useUrlResuelta(url: string | null | undefined): string | null {
  const [resuelta, setResuelta] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    // Siempre asíncrono: sin URL resuelve a null (evita setState síncrono en el efecto).
    const promesa = url ? repo.resolverUrl(url) : Promise.resolve(null);
    promesa
      .then((u) => {
        if (vivo) setResuelta(u);
      })
      .catch(() => {
        if (vivo) setResuelta(null);
      });
    return () => {
      vivo = false;
    };
  }, [url]);
  return resuelta;
}
