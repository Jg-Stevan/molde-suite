// FASE 0 (blueprint DLA): singleton del worker Tesseract spa — extraído de
// bridge/ocr.ts para que TAMBIÉN el proveedor OCR del motor universal
// compartido (molde/ocr-proveedor.ts) use EL MISMO worker caliente (un solo
// motor por app: el OCR de bandas del pipeline y el OCR de líneas/palabras
// del motor universal comparten sesión). Sin cambios de comportamiento.

import { logger } from '../../logger';
import { BASE_PATH } from '../../rutas';

export type TesseractWorkerLike = {
  recognize: (imagen: unknown, opts?: unknown, out?: unknown) => Promise<{ data: { text?: string; confidence?: number } }>;
  setParameters: (p: Record<string, string>) => Promise<unknown>;
  terminate?: () => Promise<unknown>;
};

/** tesseract.js arma un worker sobre `blob:` y ahí `importScripts` NO resuelve
 *  rutas relativas: las tres rutas tienen que salir absolutas. */
function urlAbsoluta(ruta: string): string {
  if (typeof location === 'undefined') return ruta;
  return new URL(ruta, location.href).href;
}

const ASSET = (ruta: string) => urlAbsoluta(`${BASE_PATH}${ruta}`);

let workerPromise: Promise<TesseractWorkerLike> | null = null;
let reconocimientosEnVuelo = 0;

/** Worker caliente único de Tamiz (createWorker('spa', 1), logger silencioso). */
export function getWorker(): Promise<TesseractWorkerLike> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('spa', 1, {
        // Todo same-origin, servido por `bun run preparar`: sin esto la lib
        // hace importScripts al CDN y el OCR muere sin red en campo.
        // corePath es DIRECTORIO: la lib elige simd-lstm o lstm según la
        // sonda SIMD del dispositivo (los dos núcleos están vendorizados).
        workerPath: ASSET('/vendor/tesseract/worker.min.js'),
        corePath: ASSET('/vendor/tesseract'),
        langPath: ASSET('/models/tess/4.0.0_fast'),
        logger: () => {
          /* silencioso: el progreso vive en el pipeline */
        },
      });
      return worker as unknown as TesseractWorkerLike;
    })();
  }
  return workerPromise;
}

/** F4 — marca el inicio/fin de un reconocimiento para que el reciclado
 *  post-escaneo no mate un worker con OCR en vuelo. */
export function marcarReconocimientoTesseract(delta: 1 | -1): void {
  reconocimientosEnVuelo = Math.max(0, reconocimientosEnVuelo + delta);
}

/** F4 — recicla el worker Tesseract si no hay OCR en vuelo. Libera la
 *  memoria nativa WASM del singleton. Jamás lanza; false = no reiniciado. */
export async function reiniciarWorkerTesseractSiInactivo(): Promise<boolean> {
  try {
    if (reconocimientosEnVuelo > 0) return false;
    if (!workerPromise) return true;
    const w = await workerPromise;
    await w.terminate?.();
    workerPromise = null;
    return true;
  } catch {
    workerPromise = null;
    return false;
  }
}
