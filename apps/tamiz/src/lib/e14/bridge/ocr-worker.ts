// FASE 0 (blueprint DLA): singleton del worker Tesseract spa — extraído de
// bridge/ocr.ts para que TAMBIÉN el proveedor OCR del motor universal
// compartido (molde/ocr-proveedor.ts) use EL MISMO worker caliente (un solo
// motor por app: el OCR de bandas del pipeline y el OCR de líneas/palabras
// del motor universal comparten sesión). Sin cambios de comportamiento.

import { logger } from '../../logger';

export type TesseractWorkerLike = {
  recognize: (imagen: unknown, opts?: unknown, out?: unknown) => Promise<{ data: { text?: string; confidence?: number } }>;
  setParameters: (p: Record<string, string>) => Promise<unknown>;
  terminate?: () => Promise<unknown>;
};

let workerPromise: Promise<TesseractWorkerLike> | null = null;

/** Worker caliente único de Tamiz (createWorker('spa', 1), logger silencioso). */
export function getWorker(): Promise<TesseractWorkerLike> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('spa', 1, {
        logger: () => {
          /* silencioso: el progreso vive en el pipeline */
        },
      });
      return worker as unknown as TesseractWorkerLike;
    })();
  }
  return workerPromise;
}
