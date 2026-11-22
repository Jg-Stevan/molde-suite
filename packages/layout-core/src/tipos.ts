// Contratos del motor de layout estructural (PLAN-AGENTE-LAYOUT §4.2/§4.3).
// PUREZA: este módulo NO importa DOM ni ORT — el evaluador corre igual en
// bun test, en el worker de dla-onnx y en el navegador. Las detecciones
// entran como cajas en PIXELS de la página (W/H los da el llamador).

import type { ClaseLayout, ReglaLayout } from '@jg-stevan/scanner-core/molde/universal-types';

export type { ClaseLayout, ReglaLayout };

/** Modelo del gate: S (rápido, 4,9 MB) o plus-L (fino, 129,7 MB). */
export type ModeloLayout = 's' | 'plusL';

/** Caja de layout en PIXELS de la página (x1,y1 = esquina sup-izq). */
export interface CajaLayout {
  /** Clase canónica normalizada (ver clases.ts) o la cruda si es desconocida. */
  clase: ClaseLayout | string;
  score: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Resultado de una detección completa de página. */
export interface DeteccionLayout {
  modelo: ModeloLayout;
  ms: number;
  boxes: CajaLayout[];
  debug?: { raw: number; maxScore: number; byClass: Record<string, number> };
}

/**
 * Parte de un contenedor dividido por plantilla (regla con `dividir`).
 * Las N cortes producen N+1 partes; cada parte puede enlazar un campo OCR.
 */
export interface ParteReglaLayout {
  etiqueta?: string;
  campoId?: string;
  caja: CajaLayout;
}

/** Resultado de UNA regla estructural sobre la página. */
export interface ResultadoReglaLayout {
  reglaId: string;
  etiqueta: string;
  /** ok: conteo dentro de [minimo, maximo]. faltante: menos de lo exigido.
   *  sobrante: más de lo permitido. baja_confianza: hay candidatos dentro de
   *  la zona pero por debajo del minScore (banda de 0.05). */
  estado: 'ok' | 'faltante' | 'sobrante' | 'baja_confianza';
  /** Cajas que satisfacen la regla (partes incluidas si hubo `dividir`). */
  cajas: CajaLayout[];
  /** Partes del contenedor dividido (solo reglas con `dividir`). */
  partes?: ParteReglaLayout[];
  /** Mejor score de las cajas aceptadas (null si no hubo ninguna). */
  score: number | null;
  /** Motivo legible cuando el estado no es ok. */
  motivo?: string;
}

/** Resultado del gate estructural de UNA página. */
export interface ResultadoEstructura {
  modelo: ModeloLayout;
  ms: number;
  reglas: ResultadoReglaLayout[];
  /** IDs de reglas obligatorias en faltante/baja_confianza (rechazo temprano). */
  obligatorias_faltantes: string[];
  /** true = todas las obligatorias ok (y ningún sobrante obligatorio). */
  ok: boolean;
  /** true = solo opcionales con problemas (continúa a OCR con advertencia). */
  requiere_revision: boolean;
}

/**
 * Motor de detección (implementado por dla-onnx con ORT Web). layout-core
 * solo define el CONTRATO: el evaluador de reglas no depende de él.
 */
export interface LayoutEngine {
  detect(canvas: HTMLCanvasElement, opts?: { poolMinScore?: number }): Promise<DeteccionLayout>;
  dispose(): Promise<void>;
}

/** Opciones del evaluador (defaults del plan §7: margen 0.02, NMS 0.5). */
export interface OpcionesEstructura {
  /** Margen default de pertenencia a zona cuando la regla no define tolerancia. */
  margenDefault?: number;
  /** IoU del NMS interno de grupos (títulos/footers). Default 0.5. */
  nmsInterno?: number;
  /** Ancho de la banda de baja confianza bajo el minScore. Default 0.05. */
  bandaBaja?: number;
  /** Filtra reglas por página 1-indexada (las reglas sin `pagina` cuentan
   *  como página 1). Ausente = evalúa todas. */
  pagina?: number;
}
