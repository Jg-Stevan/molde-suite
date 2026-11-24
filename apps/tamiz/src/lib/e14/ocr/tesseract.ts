// Precalentamiento del OCR de cascada (segundo motor — mismo Tesseract con
// parámetros de página distintos).

let caliente = false;

/** Idempotente y silencioso. */
export function tessPrecalentar(): void {
  if (caliente) return;
  caliente = true;
  void import('../bridge/ocr-worker')
    .then(async ({ getWorker }) => {
      // Mismo criterio P7a: el singleton compartido es el que se calienta.
      await getWorker();
    })
    .catch(() => {
      /* silencioso por diseño (kill-switch del mantenedor) */
    });
}
