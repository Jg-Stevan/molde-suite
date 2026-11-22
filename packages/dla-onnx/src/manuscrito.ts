// FASE B4 (blueprint DLA): PRESENCIA de manuscrito con D-FINE
// (dfine-egret-x-rukopys — clase `handwritten`). Es DETECCIÓN, no
// reconocimiento: ninguna lectura de texto sale de aquí (el HTR queda en su
// lugar: revisión humana, principio de honestidad del motor).

import { crearDetector, configuracionLista } from './runtime';
import { PRESETS, type Deteccion } from './tipos';

/** Detector de manuscrito (null = sin modelo configurado). */
export async function crearDetectorManuscrito(): Promise<{
  detectar: (canvas: HTMLCanvasElement, confMin?: number) => Promise<Deteccion[]>;
} | null> {
  if (!configuracionLista('manuscrito')) return null;
  const d = await crearDetector('manuscrito');
  return { detectar: (canvas, confMin) => d.detectar(canvas, confMin ?? PRESETS.manuscrito.confMin) };
}

/** Regiones manuscritas de la página (clase handwritten, confianza filtrada). */
export async function regionesManuscritas(
  canvas: HTMLCanvasElement,
): Promise<Deteccion[] | null> {
  const d = await crearDetectorManuscrito();
  if (!d) return null;
  const lista = await d.detectar(canvas);
  return lista.filter((r) => r.clase.toLowerCase().includes('handwritten'));
}
