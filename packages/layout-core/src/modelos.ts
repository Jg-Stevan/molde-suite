// Registro DECLARATIVO de los modelos PP-DocLayout (stock — PROHIBIDO
// reentrenar, cuantizar o modificar los ONNX). Los BYTES y el SHA-256 son del
// dossier (MODELOS-Y-DATOS §1): el consumidor (dla-onnx / PWA) verifica el
// hash tras descargar y NUNCA precachea plus-L (descarga opcional explícita).
//
// Los modelos NO viven en el repo: se sirven desde /models/ en desarrollo
// (ruta ignorada por git) o desde una URL versionada con CORS en producción.

import type { ModeloLayout } from './tipos';

export interface ContratoPreproceso {
  /** Tamaño de entrada cuadrado del modelo. */
  lado: number;
  /** Reescalado ESTIRADO (sin letterbox): scale_factor = [lado/h, lado/w]. */
  escala: 'estirado';
  /** Normalización de píxeles. */
  normalizacion: 'imagenet' | '0-1';
  mean?: [number, number, number];
  std?: [number, number, number];
  /** Orden de canales. */
  canales: 'rgb';
}

export interface ContratoSalida {
  /** plus-L: [300,6] filas [cls, score, x1, y1, x2, y2] en coords originales.
   *  S: [100,6] igual formato con NMS horneado. */
  formato: '[N,6]';
  /** El ONNX de plus-L NO trae NMS: el consumidor aplica nmsClaseAgnostico. */
  nmsIncluido: boolean;
  iouNms?: number;
  maxCajas: number;
  /** Clase en la fila como NOMBRE (las exportaciones canónicas traen strings)
   *  — jamás comparar contra índices numéricos. */
  clasePorNombre: true;
}

export interface ContratoModeloLayout {
  id: ModeloLayout;
  archivo: string;
  bytes: number;
  sha256: string;
  /** Presupuesto de inferencia observado (dossier §4 — NO universal: medir
   *  de nuevo por dispositivo). */
  inferenciaObservada: { celularMs: number; pcMs: number };
  preproceso: ContratoPreproceso;
  salida: ContratoSalida;
  /** Número de clases canónicas del exporte. */
  nClases: number;
  /** Rol tras la Fase 0 (docs/investigacion/2026-11-22-spike-s-estructura.md). */
  rol: 'gate-default' | 'pre-gate' | 'validacion-fina';
}

export const MODELOS_LAYOUT: Record<ModeloLayout, ContratoModeloLayout> = {
  s: {
    id: 's',
    archivo: 'pp_doclayout_s.onnx',
    bytes: 4_917_852,
    sha256: '33688dbee1c23e34b81777e97cb428eb40f24b242c02b5f623484959e830aec8',
    inferenciaObservada: { celularMs: 380, pcMs: 670 },
    preproceso: {
      lado: 480,
      escala: 'estirado',
      normalizacion: 'imagenet',
      mean: [0.485, 0.456, 0.406],
      std: [0.229, 0.224, 0.225],
      canales: 'rgb',
    },
    salida: {
      formato: '[N,6]',
      nmsIncluido: true,
      maxCajas: 100,
      clasePorNombre: true,
    },
    nClases: 23,
    // Decisión de la Fase 0 (spike, docs/investigacion/2026-11-22-spike-s-estructura.md):
    // S + estructura de plantilla alcanza 16/19 con 0 FP -> CUMPLE el criterio
    // (>= 16/19, <= 1 FP) y queda como MODELO POR DEFECTO del gate. Limitación:
    // barcode_text y candidatos deben quedar OPCIONALES en moldes pensados para S.
    rol: 'gate-default',
  },
  plusL: {
    id: 'plusL',
    archivo: 'pp_doclayout_plus_l.onnx',
    bytes: 129_736_329,
    sha256: '77afb2caa74dd13240d087d2eced91d7fcd2caebd16006a0a66162fc8707ff0e',
    inferenciaObservada: { celularMs: 5800, pcMs: 13200 },
    preproceso: {
      lado: 800,
      escala: 'estirado',
      normalizacion: '0-1',
      canales: 'rgb',
    },
    salida: {
      formato: '[N,6]',
      nmsIncluido: false,
      iouNms: 0.5,
      maxCajas: 300,
      clasePorNombre: true,
    },
    nClases: 20,
    // plus-L + reglas estructurales: F1 = 1.0 (19/19) contra el GT de Chandra
    // en E-14 p1 — validación FINA opcional (descarga explícita en la PWA):
    // resuelve las zonas que S no puede garantizar (barcode_text, candidatos).
    rol: 'validacion-fina',
  },
};

/** Verificación de integridad: el tamaño declarado debe coincidir byte a byte
 *  y el SHA-256 es el que la PWA comprueba tras la descarga opcional. */
export function verificarContratoModelo(id: ModeloLayout, bytesReales: number, sha256Real: string): boolean {
  const m = MODELOS_LAYOUT[id];
  return m.bytes === bytesReales && m.sha256 === sha256Real.toLowerCase();
}
