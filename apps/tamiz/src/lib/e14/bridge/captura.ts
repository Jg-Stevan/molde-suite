// Captura: entrada del pipeline (File o dataUrl), decodificación memoizada,
// captura síncrona de frames de video y entradas de simulación.

import type { Quad } from '@jg-stevan/scanner-core/core/types';
import { dibujarImagenSimulada, type ImagenSimuladaId } from '../simulacion-imagenes';

/** Quad identidad (normalizado 0..1). */
export const QUAD_IDENTITY: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

/** Entrada del pipeline L2. */
export type EntradaPipeline = { archivo: File } | { dataUrl: string };

/** Captura un frame del video a dataURL JPEG (síncrono; null si no hay señal). */
export function capturarFrame(video: HTMLVideoElement): string | null {
  if (video.readyState < 2 || !video.videoWidth) return null;
  const c = document.createElement('canvas');
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  c.getContext('2d', { willReadFrequently: true })!.drawImage(video, 0, 0);
  return c.toDataURL('image/jpeg', 0.92);
}

const cacheDecode = new Map<File, string>();

/** Decodifica un File a dataURL con caché (evita re-leer el mismo archivo). */
export async function decodeArchivoMemo(archivo: File): Promise<string> {
  const hit = cacheDecode.get(archivo);
  if (hit) return hit;
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result ?? ''));
    fr.onerror = () => reject(fr.error ?? new Error('No se pudo leer el archivo'));
    fr.readAsDataURL(archivo);
  });
  if (cacheDecode.size > 12) cacheDecode.clear(); // control de memoria
  cacheDecode.set(archivo, dataUrl);
  return dataUrl;
}

/** Entrada de pipeline desde el catálogo de simulación. */
export async function entradaSimDeImagen(id: ImagenSimuladaId): Promise<{ archivo: File }> {
  const dataUrl = dibujarImagenSimulada(id);
  const blob = await (await fetch(dataUrl)).blob();
  const archivo = new File([blob], `sim-${id}.jpg`, { type: 'image/jpeg' });
  return { archivo };
}

let workerCaliente = false;

/** Warm-up del worker de procesado (canvas en esta implementación mínima). */
export async function esperarWorkerCaliente(): Promise<void> {
  if (workerCaliente) return;
  // Doble requestAnimationFrame: fuerza la compilación JIT de los paths de canvas.
  await new Promise<void>((res) => requestAnimationFrame(() => requestAnimationFrame(() => res())));
  workerCaliente = true;
}
