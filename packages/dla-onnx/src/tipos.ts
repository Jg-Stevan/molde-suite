// Contratos del paquete dla-onnx (FASE B del blueprint DLA).
//
// Filosofía (misma del blueprint): los detectores aportan SEÑALES (cajas
// normalizadas 0-1 con confianza), nunca veredictos — el gate y el principio
// de honestidad del motor deciden. Sin modelo configurado, las señales quedan
// APAGADAS y el producto corre en Nivel 1 (TS puro) sin cambios.

export interface Caja {
  /** Normalizado 0-1 sobre el canvas analizado. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Detección cruda de cualquier modelo del paquete. */
export interface Deteccion {
  clase: string;
  conf: number;
  caja: Caja;
}

/** Preset de pre/post-proceso por familia de modelo. Calibrable: los valores
 * son los estándar de cada arquitectura y se ajustan con el banco de pruebas
 * (lessons/) antes de activar por defecto. */
export interface PresetOnnx {
  /** Lado de entrada del modelo (cuadrado, letterbox). */
  tamEntrada: number;
  /** Decodificador de salida: 'yolo' = [1, 4+nc, N] (v8/v12, con NMS);
   * 'detr' = boxes [1,N,4] + scores [1,N,nc] (RT-DETR/PP-DocLayout/D-FINE,
   * top-k sin NMS). */
  decodificador: 'yolo' | 'detr';
  /** Confianza mínima para reportar una detección. */
  confMin: number;
  /** IoU de supresión (solo decodificador yolo). */
  iou?: number;
  /** Nombres de clase por índice (si el modelo no los embebe). */
  clases?: string[];
  /** Normalización de entrada. */
  entrada: '0-1' | '0-255';
}

export const PRESETS: Record<'casillas' | 'layout' | 'manuscrito', PresetOnnx> = {
  // checkbox-detector (YOLO12n ONNX): casillas vacías y marcadas.
  casillas: {
    tamEntrada: 640,
    decodificador: 'yolo',
    confMin: 0.5,
    iou: 0.45,
    clases: ['marcada', 'vacia'],
    entrada: '0-1',
  },
  // PP-DocLayout stock (S 480px / plus-L 800px): [N,6] en coords originales.
  // Pool 0.2 del benchmark estructural (el evaluador aplica minScore 0.2);
  // el NMS clase-agnóstico 0.5 se aplica en la app para ambas variantes.
  layout: {
    tamEntrada: 800,
    decodificador: 'detr',
    confMin: 0.2,
    entrada: '0-1',
  },
  // D-FINE (dfine-egret-x-rukopys): presencia de manuscrito (NO HTR).
  manuscrito: {
    tamEntrada: 640,
    decodificador: 'detr',
    confMin: 0.5,
    entrada: '0-1',
  },
};

export type PresetKey = keyof typeof PRESETS;

// ---- Protocolo del worker (runtime ↔ worker.ts) ----

export type MensajeWorker =
  | { tipo: 'cargar'; id: number; url: string; presetKey: PresetKey }
  | { tipo: 'detectar'; id: number; bitmap: ImageBitmap; confMin?: number }
  | { tipo: 'cerrar'; id: number };

export type RespuestaWorker =
  | { tipo: 'listo'; id: number; clases?: string[] }
  | { tipo: 'detecciones'; id: number; lista: Deteccion[] }
  | { tipo: 'error'; id: number; mensaje: string };
