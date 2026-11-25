// Precalentamiento del motor OCR principal — RapidOCR PP-OCRv4 (el motor de
// producción de digielect14): det/cls/rec en worker, singleton de sesión.

let caliente = false;
let promesa: Promise<void> | null = null;

/** Idempotente: fuerza la carga del motor la primera vez. */
export async function rapidOcrPrecalentar(): Promise<void> {
  if (caliente) return;
  if (promesa) return promesa;
  promesa = (async () => {
    try {
      const motor = await import('@molde-suite/scanner-core/ocr/rapidocr');
      await motor.rapidOcrInit();
      await motor.rapidOcrPrecalentar();
      caliente = true;
    } catch {
      /* el precalentamiento jamás rompe el arranque */
    } finally {
      promesa = null;
    }
  })();
  return promesa;
}
