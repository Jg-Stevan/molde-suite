/**
 * Entorno del paquete (FASE 1 — punto de inversión §3.3 del mapa v2.3).
 *
 * El paquete NO importa env de las apps (regla §0: app → núcleo, nunca al
 * revés). La URL del catálogo DIVIPOL y de los workers entra por
 * configuración; el DEFAULT es la MISMA expresión que ya usaba el core
 * vendorizado (`NEXT_PUBLIC_BASE_PATH ?? ""` — detector-client/ocr, hoy vía
 * urlAssetPublico) — sin configurar, el comportamiento es byte-idéntico al
 * de hoy en ambas apps.
 *
 * La app anfitriona llama UNA vez en su bootstrap:
 *   configurarPublicBase(PUBLIC_BASE);   // S: src/shared/env.ts · D: env directo
 *
 * R-46 (unificación del loader de assets): los assets estáticos del paquete
 * (wasm, modelos, workers, vendor) NO concatenan el prefijo a mano NI leen el
 * env directo — usan `urlAssetPublico(ruta)` para que el prefijo se resuelva
 * SIEMPRE LAZY (en el punto de uso, nunca congelado al importar el módulo)
 * y con el MISMO convenio de barra inicial.
 */
let publicBaseConfigurado: string | null = null;

/** Fija el prefijo público de los assets estáticos (p. ej. "/supervision-e14"). */
export function configurarPublicBase(base: string): void {
  publicBaseConfigurado = base;
}

/** Prefijo público efectivo (configurado, o el env del core — default histórico). */
export function publicBaseEfectivo(): string {
  if (publicBaseConfigurado !== null) return publicBaseConfigurado;
  return process.env.NEXT_PUBLIC_BASE_PATH ?? "";
}

/** URL absoluta-de-base para assets estáticos del paquete (wasm, modelos, workers). */
export function urlAssetPublico(rutaRelativa: string): string {
  const base = publicBaseEfectivo();
  return `${base}${rutaRelativa.startsWith("/") ? rutaRelativa : `/${rutaRelativa}`}`;
}

/** SOLO tests (R-46): restaura el estado SIN configurar — `configurarPublicBase("")`
 *  NO es equivalente ("" configurado suprime legítimamente el fallback del env),
 *  y bun test comparte el estado de módulo entre archivos del mismo proceso. */
export function restablecerPublicBaseParaTest(): void {
  publicBaseConfigurado = null;
}
