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
      // Calienta el SINGLETON real del pipeline (bridge/ocr-worker.getWorker):
      // crear y DESTRUIR un worker propio deja el motor real frío y la 1.ª
      // captura paga la inicialización completa (~4-8 s en gama media).
      const { getWorker } = await import('../bridge/ocr-worker');
      await getWorker();
      caliente = true;
    } catch {
      /* el precalentamiento jamás rompe el arranque */
    } finally {
      promesa = null;
    }
  })();
  return promesa;
}
