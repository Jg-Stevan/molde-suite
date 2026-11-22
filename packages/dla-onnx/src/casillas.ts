// FASE B2 (blueprint DLA): segunda opinión de CASILLAS con checkbox-detector
// (YOLO12n ONNX). Consumidor típico: campos checkbox que el motor universal
// dejó en `requiere_revision` (banda indeterminada del ratio de tinta).
// Señal, no veredicto: los consumidores aplican su política de honestidad.

import { crearDetector, configuracionLista } from './runtime';
import { PRESETS, type Deteccion } from './tipos';

export interface DeteccionCasilla extends Deteccion {
  /** Clase dominante interpretada: ¿la casilla está marcada? */
  marcada: boolean;
}

/** Detector de casillas (null = sin modelo configurado → señal apagada). */
export async function crearDetectorCasillas(): Promise<{
  detectar: (canvas: HTMLCanvasElement, confMin?: number) => Promise<DeteccionCasilla[]>;
} | null> {
  if (!configuracionLista('casillas')) return null;
  const d = await crearDetector('casillas');
  const clasesMarcada = new Set(['marcada', 'marked', 'checked', 'si']);
  return {
    detectar: async (canvas, confMin) => {
      const lista = await d.detectar(canvas, confMin ?? PRESETS.casillas.confMin);
      return lista.map((det) => ({
        ...det,
        marcada: clasesMarcada.has(det.clase.toLowerCase()) || !det.clase.toLowerCase().includes('vacia'),
      }));
    },
  };
}
