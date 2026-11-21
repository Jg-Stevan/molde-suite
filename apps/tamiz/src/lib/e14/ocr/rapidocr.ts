// Precalentamiento del motor OCR principal (Tesseract spa — el mismo que usa
// Molde Studio; el producto original hablaba de RapidOCR).

let caliente = false;
let promesa: Promise<void> | null = null;

/** Idempotente: fuerza la carga del worker + modelo la primera vez. */
export async function rapidOcrPrecalentar(): Promise<void> {
  if (caliente) return;
  if (promesa) return promesa;
  promesa = (async () => {
    try {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('spa', 1);
      await worker.terminate();
      caliente = true;
    } catch {
      /* el precalentamiento jamás rompe el arranque */
    } finally {
      promesa = null;
    }
  })();
  return promesa;
}
