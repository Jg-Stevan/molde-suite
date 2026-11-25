// Captura: entrada del pipeline (File o dataUrl), decodificación memoizada,
// captura síncrona de frames de video y entradas de simulación.

import { defaultQuad, type Quad } from '@molde-suite/scanner-core/core/types';
import { getScannerWorker } from '@molde-suite/scanner-core/core/detector-client';
import { dibujarImagenSimulada, type ImagenSimuladaId } from '../simulacion-imagenes';

/**
 * Quad identidad (normalizado 0..1). Fase 3 (migración): ya no se duplica —
 * se evalúa desde `defaultQuad()` del paquete (D1). Siguiendo siendo un valor
 * para no cambiar la semántica para los consumidores (real-core-bridge).
 */
export const QUAD_IDENTITY: Quad = defaultQuad();

/** Entrada del pipeline L2. */
export type EntradaPipeline = { archivo: File } | { dataUrl: string };

/** Captura un frame del video a dataURL JPEG (síncrono; null si no hay señal). */
export function capturarFrame(video: HTMLVideoElement): string | null {
  if (video.readyState < 2 || !video.videoWidth) return null;
  try {
    const c = document.createElement('canvas');
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    c.getContext('2d', { willReadFrequently: true })!.drawImage(video, 0, 0);
    return c.toDataURL('image/jpeg', 0.92);
  } catch {
    // Upstream: el grab es un camino de captura — null honesto, no excepción.
    return null;
  }
}

// PR-2 upstream (kit e14-masiva-tiempos-v1): memo POR INSTANCIA con WeakMap —
// el GC puede liberar el File y su dataURL; un Map<File,string> fijo retenía
// hasta 12 dataURLs completos (~50-100 MB en RAM con fotos de 12 MP).
const cacheDecode = new WeakMap<File, string>();

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

/** Tope del warm-up: cubre el arranque en frío del worker en móvil (medido
 *  2.7–6.7 s en el A56) sin colgar el escaneo si el worker no arranca. */
const ESPERA_WORKER_MS = 10_000;

let workerCaliente = false;

/** Warm-up REAL del worker OpenCV — la MISMA vía que detecta el quad. Tras
 *  recargar la PWA el worker arranca en frío; sin esta espera la detección
 *  caía al Sobel/identidad y la «procesada» era el fotograma entero. */
export async function esperarWorkerCaliente(): Promise<void> {
  if (workerCaliente) return;
  try {
    const worker = getScannerWorker();
    if (worker && !worker.isDead) {
      const listo = await Promise.race([
        worker.waitReady(),
        new Promise<boolean>((res) => window.setTimeout(() => res(false), ESPERA_WORKER_MS)),
      ]);
      if (listo) {
        workerCaliente = true;
        return;
      }
    }
  } catch {
    /* worker roto → el detector cae al Sobel del core */
  }
  // Sin worker: deja el hilo en condiciones para el fallback canvas.
  await new Promise<void>((res) => requestAnimationFrame(() => requestAnimationFrame(() => res())));
}
