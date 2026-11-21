// Precalentamiento del OCR de cascada (segundo motor — mismo Tesseract con
// parámetros de página distintos).

let caliente = false;

/** Idempotente y silencioso. */
export function tessPrecalentar(): void {
  if (caliente) return;
  caliente = true;
  void import('tesseract.js')
    .then(async ({ createWorker }) => {
      const worker = await createWorker('spa', 1);
      await worker.setParameters({ tessedit_pageseg_mode: '3' as never });
      await worker.terminate();
    })
    .catch(() => {
      /* silencioso por diseño (kill-switch del mantenedor) */
    });
}
