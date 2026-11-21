// Tipos compartidos de la capa de datos (contrato Repo). Viven en su propio
// módulo para que `repo.ts` (implementación API) y `repo-idb.ts`
// (implementación IndexedDB) dependan de este archivo y NO entre sí
// (rompe el ciclo de imports repo ↔ repo-idb detectado en la auditoría).

import type { MoldeUniversal } from '@/lib/molde/universal-types';

export type Resultado<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

/** Molde persistido (API Prisma o registro IndexedDB). */
export interface MoldeDB {
  id: string;
  nombre: string;
  descripcion: string | null;
  documento: string | null;
  json: string;
  imagenRef: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { pruebas: number };
  /** Score de la corrida más reciente (para la tarjeta de la Biblioteca). */
  pruebas?: { score: number | null }[];
}

export interface PruebaDB {
  id: string;
  moldeId: string;
  archivo: string;
  score: number | null;
  requiereRevision: boolean;
  createdAt: string;
  /** URL del documento fuente (/uploads/... o idb:...) si la corrida es re-ejecutable. */
  fuenteUrl?: string | null;
  /** D1: páginas fuente ordenadas de una corrida multi-página (todas subidas). */
  fuente_urls?: string[] | null;
  /** Momento de la última ejecución/re-ejecución (detección de versión). */
  updatedAt?: string;
  molde?: { nombre: string };
}

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
  /** D1: URLs de TODAS las páginas fuente, ordenadas (corridas multi-página).
   * Solo se declara la corrida re-ejecutable multi-página si el set está completo. */
  fuenteUrls?: string[] | null;
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
  /** D1: páginas fuente ordenadas (multi-página); null en corridas de 1 página. */
  fuente_urls?: string[] | null;
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
