// Contrato del molde .json — Fase 2b (migración scanner-core).
//
// FUENTE ÚNICA del contrato entre Molde Studio (produce) y Tamiz (consume).
// Re-exporta el validador estructural del motor universal y añade las guardas
// del contrato de nivel superior (formato de `version`, `campos` no vacío).
// Guardas MANUALES (decisión D4a): cero dependencias nuevas.
//
// Claves top-level del contrato:
//   tipo, version, nombre, descripcion?, documento?, idioma?, paginasRef?,
//   campos, validaciones?, layout?, meta?
// (paginasRef solo en Studio; layout es v3.1+ y opcional por retrocompat).

import {
  esMoldeUniversal,
  erroresMolde,
  MOLDE_UNIVERSAL_VERSION,
  type MoldeUniversal,
} from '../../molde/universal-types';

export { esMoldeUniversal, erroresMolde, MOLDE_UNIVERSAL_VERSION };
export type { MoldeUniversal };

/** Claves top-level reconocidas por el contrato (documentación viva). */
export const CLAVES_TOP_LEVEL = [
  'tipo',
  'version',
  'nombre',
  'descripcion',
  'documento',
  'idioma',
  'paginasRef',
  'campos',
  'validaciones',
  'layout',
  'meta',
] as const;

const SEMVER = /^\d+\.\d+\.\d+$/;

/**
 * Validación del CONTRATO completo: estructura del motor (erroresMolde) +
 * guardas de nivel superior. Aditiva: todo molde que pase erroresMolde y sea
 * semver con campos no vacíos pasa erroresContrato (retrocompatible v1.x+).
 */
export function erroresContrato(obj: unknown): string[] {
  const errores = erroresMolde(obj);
  if (typeof obj !== 'object' || obj === null) return errores;
  const m = obj as Record<string, unknown>;
  if (typeof m.version !== 'string' || !SEMVER.test(m.version)) {
    errores.push('version debe ser semver (por ejemplo "3.2.0")');
  }
  if (Array.isArray(m.campos) && m.campos.length === 0) {
    errores.push('campos no puede estar vacío: un molde sin campos no valida nada');
  }
  return errores;
}
