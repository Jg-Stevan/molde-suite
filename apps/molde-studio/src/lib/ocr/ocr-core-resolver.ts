/**
 * Resolvedor de core de Tesseract para molde-suite (GitHub Pages).
 *
 * Corrige el hallazgo P1 del diagnóstico (2026-11-21):
 *   tesseract.js v7.0.0, sin `corePath`, elige en runtime la variante
 *   `tesseract-core-relaxedsimd-lstm.wasm.js` (jsDelivr) en navegadores con
 *   relaxed-SIMD. Ese build está roto: el WASM importa
 *   `_ZN9tesseract13DotProductSSEEPKfS1_i` que el build no incluye →
 *   `Aborted(missing function: ...)` en ciertos CPUs.
 *
 * Solución:
 *   Fijar `corePath` a variantes sanas AUTO-HOSPEDADAS en el propio sitio
 *   (public/tesseract/, misma origen — sin jsDelivr en runtime):
 *   - tesseract-core-simd-lstm.wasm.js  → navegadores con SIMD128 (modernos)
 *   - tesseract-core-lstm.wasm.js       → fallback sin SIMD128
 *   NUNCA devolver una variante `relaxedsimd` hasta que upstream lo corrija.
 *
 * Ambos archivos son builds single-file (WASM embebido en base64): no requieren
 * .wasm externo. Al pasar un `corePath` que termina en `.wasm.js`, tesseract.js
 * omite su detección de variantes y usa exactamente ese archivo.
 *
 * Uso:
 *   const worker = await createWorker(lang, 1, { ...tesseractWorkerOptions() });
 */

/** basePath del despliegue (GH Pages: /molde-suite). En sandbox/dev es ''. */
const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/$/, '');

/** Directorio público donde viven los cores (public/tesseract/). */
const TESSERACT_DIR = `${BASE_PATH}/tesseract`;

/** Probe oficial de SIMD128 (WebAssembly.validate) — el mismo que usa tesseract.js. */
const SIMD128_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0,
  10, 15, 1, 13, 0, 65, 1, 253, 15, 65, 2, 253, 15, 253, 128, 2, 11,
]);

/** Cacheamos el resultado: validate es barato pero se llama por worker creado. */
let cachedVariant: 'simd-lstm' | 'lstm' | null = null;

export function supportsSimd128(): boolean {
  if (typeof WebAssembly === 'undefined') return false;
  try {
    return WebAssembly.validate(SIMD128_PROBE);
  } catch {
    return false;
  }
}

/**
 * Devuelve la URL (same-origin, respeta basePath) del core seguro para este
 * navegador. Siempre apunta a un archivo `.wasm.js` → tesseract.js omite su
 * selección de variantes y NO puede cargar el binario defectuoso (relaxedsimd).
 */
export function resolveTesseractCorePath(): string {
  if (!cachedVariant) {
    cachedVariant = supportsSimd128() ? 'simd-lstm' : 'lstm';
  }
  return `${TESSERACT_DIR}/tesseract-core-${cachedVariant}.wasm.js`;
}

/** Ruta del worker de tesseract.js v7.0.0 auto-hospedado (misma origen). */
export function resolveTesseractWorkerPath(): string {
  return `${TESSERACT_DIR}/worker.min.js`;
}

/** Directorio de datos de idioma auto-hospedados (spa.traineddata.gz). */
export function resolveTesseractLangPath(): string {
  return `${TESSERACT_DIR}/lang-data`;
}

/**
 * Opciones completas para createWorker con TODOS los assets auto-hospedados.
 * worker.min.js y los cores son de tesseract.js@7.0.0 / tesseract.js-core@7.0.0
 * (fijados en bun.lock): si se actualiza tesseract.js, actualizar TAMBIÉN estos
 * archivos en public/tesseract/ — mantener versión fijada, nunca @latest.
 */
export function tesseractWorkerOptions(): {
  corePath: string;
  workerPath: string;
  langPath: string;
} {
  return {
    corePath: resolveTesseractCorePath(),
    workerPath: resolveTesseractWorkerPath(),
    langPath: resolveTesseractLangPath(),
  };
}
