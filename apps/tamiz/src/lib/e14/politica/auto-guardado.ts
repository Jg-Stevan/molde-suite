// §4 (REGLA DE ORO — plan cierre 2 agentes, 2026-11-26) — DECISIÓN PURA de
// auto-guardado. La regla recalzada por el dueño:
//
//   «Si un documento es LEGIBLE y cuenta con TODOS los datos obligatorios,
//    SE GUARDA AUTOMÁTICAMENTE. Sin toque del operador.»
//
// Definición de LEGIBLE (verbatim del plan): veredicto OPTIMA (o ADVERTENCIA)
// con TODOS los campos obligatorios presentes y válidos (patrón cumple, sin
// `relacion_ambigua`, sin obligatorios vacíos).
//
// Excepciones (NO auto-guardan, requieren humano): RECHAZADA,
// EN_REVISION_HUMANA, `relacion_ambigua`, actas sin tinta. El flujo GUARDAR
// CRUDA tras ≥2 rechazos se mantiene como está.
//
// Esta función es PURA (sin store, sin bridge, sin window) para que los 4
// tests obligatorios del plan §4 corran en bun test sin navegador:
//  (1) documento legible con obligatorios completos → guarda solo;
//  (2) legible pero con UN obligatorio faltante → NO guarda solo;
//  (3) EN_REVISION_HUMANA → NO guarda solo;
//  (4) multipágina: lote 2/2 válido → auto-guardado (una sola vez — el
//      llamador del store garantiza el «una sola fila»; aquí se decide el
//      SÍ del lote con el veredicto del acta final).
//
// Auditoría del auto-guardado existente (tarea B4) y el hueco que cierra:
//  · ÓPTIMA de una página → YA se auto-enviaba (D4/G4, registrarEnvio).
//  · Multipágina lote válido (ÓPTIMA/ADVERTENCIA) → YA se auto-enviaba.
//  · HUECO CERRADO: ADVERTENCIA de UNA página era decisión manual (D20) —
//    con obligatorios completos y sin relacion_ambigua es LEGIBLE por la
//    definición del plan y ahora SE GUARDA SOLA.
//  · HUECO CERRADO: EN_REVISION_HUMANA quedaba en la rama del archivado de
//    evidencia — ahora queda fuera de TODO auto-guardado (test 3).

import type { ActaStatus, ResumenMoldeActa, ResumenMoldeCampo } from '@molde-suite/scanner-core/dominio/types';

/** Motivos HONESTOS de NO auto-guardado (telemetría/aviso del operador). */
export type MotivoNoAutoGuardado =
  | 'FLAG_APAGADA'
  | 'RECHAZADA'
  | 'EN_REVISION_HUMANA'
  | 'OBLIGATORIO_FALTANTE'
  | 'RELACION_AMBIGUA'
  | 'SIN_TINTA'
  | 'SIN_EVIDENCIA_DE_CAMPOS';

export interface EntradaAutoGuardado {
  status: ActaStatus;
  /** Foto procesada sin tinta (warp degenerado) — acta «sin tinta». */
  procesadaVacia?: boolean;
  /** Resumen del motor universal (presente cuando un molde evaluó el acta).
   *  OJO: si `enrutado !== true` el resumen es ADITIVO (el gate E-14 manda) —
   *  sus obligatorios NO son los del veredicto y NO bloquean la regla. */
  evaluacionMolde?: ResumenMoldeActa | null;
}

export interface DecisionAutoGuardado {
  /** true = el llamador debe correr registrarEnvio + banner ENVIADA. */
  autoEnviar: boolean;
  /** Por qué NO (null cuando autoEnviar). Motivo honesto para el log/UI. */
  motivo: MotivoNoAutoGuardado | null;
}

/** ¿El campo obligatorio está PRESENTE y VÁLIDO (definición §4)?
 *  · estado 'ok' → válido (lectura verificada).
 *  · Manuscrito (firma/htr) con TINTA medida (`tinta === true`, semáforo
 *    v1.5.1) → válido por evidencia de trazo: un manuscrito jamás queda
 *    'ok' por diseño (MOLDE-SPEC P4), pero su PRESENCIA está medida —
 *    «sin obligatorios vacíos» se cumple.
 *  · Banda `relacion_ambigua` → NUNCA válido (excepción explícita §4:
 *    el motor no pudo escoger — requiere humano).
 *  · Resto (no_encontrado / requiere_revision sin tinta) → NO válido. */
export function obligatorioValido(c: ResumenMoldeCampo): boolean {
  if ((c.banderas ?? []).includes('relacion_ambigua')) return false;
  if (c.estado === 'ok') return true;
  const esManuscrito = c.tipo === 'firma' || c.htr === true;
  return esManuscrito && c.tinta === true;
}

/** ¿La acta es LEGIBLE según §4? (todos los obligatorios presentes/válidos
 *  + sin tinta vacía). Exportada para que la edición §5 reúsa la MISMA
 *  definición al decidir el auto-guardado tras corregir un campo. */
export function esLegible(entrada: EntradaAutoGuardado): boolean {
  return decidirAutoGuardado(entrada, true).autoEnviar;
}

/**
 * DECISIÓN §4 — ¿esta acta SE GUARDA SOLA (registrarEnvio → ENVIADA)?
 * · Excepciones del plan (jamás): RECHAZADA, EN_REVISION_HUMANA,
 *   `relacion_ambigua`, actas sin tinta, flag apagado.
 * · Con el molde como VEREDICTO (`enrutado: true`): los obligatorios del
 *   resumen son la autoridad — obligatoriosFaltantes no vacío o algún
 *   obligatorio sin lectura/tinta → NO legible.
 * · Con resumen ADITIVO (acta E-14 del gate; `enrutado` ausente/false): el
 *   gate electoral es la autoridad — ÓPTIMA → auto-envío (regla existente
 *   D4, sin regresión); ADVERTENCIA → conservador (sin evidencia de campos,
 *   decisión del operador como siempre).
 * · Sin molde alguno: ÓPTIMA → auto-envío; ADVERTENCIA → conservador.
 */
export function decidirAutoGuardado(
  entrada: EntradaAutoGuardado,
  autoGuardado: boolean,
): DecisionAutoGuardado {
  if (!autoGuardado) return { autoEnviar: false, motivo: 'FLAG_APAGADA' };
  if (entrada.status === 'RECHAZADA') return { autoEnviar: false, motivo: 'RECHAZADA' };
  if (entrada.status === 'EN_REVISION_HUMANA')
    return { autoEnviar: false, motivo: 'EN_REVISION_HUMANA' };
  if (entrada.status !== 'OPTIMA' && entrada.status !== 'ADVERTENCIA')
    return { autoEnviar: false, motivo: 'RECHAZADA' }; // ENVIADA/DUPLICADA: no-op honesto
  if (entrada.procesadaVacia === true) return { autoEnviar: false, motivo: 'SIN_TINTA' };

  const resumen = entrada.evaluacionMolde ?? null;
  const esVeredictoDelMolde = resumen?.enrutado === true;

  // Sin veredicto del molde (sin resumen o ADITIVO): el gate manda —
  // ÓPTIMA legible por definición; ADVERTENCIA sin evidencia → conservador.
  if (!esVeredictoDelMolde) {
    return entrada.status === 'OPTIMA'
      ? { autoEnviar: true, motivo: null }
      : { autoEnviar: false, motivo: 'SIN_EVIDENCIA_DE_CAMPOS' };
  }

  // Veredicto del MOLDE: los campos del resumen son la autoridad.
  const campos = resumen.campos ?? [];
  for (const c of campos) {
    if (!c.obligatorio) continue;
    if ((c.banderas ?? []).includes('relacion_ambigua'))
      return { autoEnviar: false, motivo: 'RELACION_AMBIGUA' };
    if (!obligatorioValido(c)) return { autoEnviar: false, motivo: 'OBLIGATORIO_FALTANTE' };
  }
  if (resumen.obligatoriosFaltantes.length > 0)
    return { autoEnviar: false, motivo: 'OBLIGATORIO_FALTANTE' };
  return { autoEnviar: true, motivo: null };
}
