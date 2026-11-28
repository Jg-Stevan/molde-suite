/** Contrato de resolución de la foto original del acta.
 *
 *  El OCR nunca consume más de 1920 px de lado mayor de la página
 *  (preprocess op1 `reduce_max_side 1920` y detCap 1920 de la 2.ª pasada;
 *  la 1.ª pasada usa 1280). Con márgenes de encuadre del 10–20 %, un
 *  original de 2048 deja el papel en ~1700–1850 px útiles: satura el techo
 *  sin pagar memoria extra (A4 ≈ 175 dpi). Por debajo de 1600 el papel
 *  queda bajo el piso de 1280 de la 1.ª pasada tras los márgenes y se pierde
 *  contenido real, no solo suavizado. Esos dos valores son el contrato:
 *  objetivo 2048, piso duro 1600 (o el máximo del sensor si es menor).
 */
export const OBJETIVO_LADO_CAPTURA = 2048;
export const MINIMO_LADO_CAPTURA = 1600;

export interface PlanRefuerzo {
  width: { ideal: number };
  height: { ideal: number };
}

function medidasValidas(w: number, h: number): boolean {
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0;
}

function ladoMayor(w: number, h: number): number {
  return medidasValidas(w, h) ? Math.max(w, h) : 0;
}

/** Ya se alcanzó el objetivo: no se tocan las constraints. */
export function necesitaRefuerzo(w: number, h: number): boolean {
  const largo = ladoMayor(w, h);
  return largo > 0 && largo < OBJETIVO_LADO_CAPTURA;
}

/** El frame actual cumple el piso duro del contrato. */
export function alcanzaMinimo(w: number, h: number): boolean {
  return ladoMayor(w, h) >= MINIMO_LADO_CAPTURA;
}

/** Constraints temporales para el peldaño de 2048 conservando la
 *  orientación actual del track (los teléfonos reportan 720×1280 en
 *  vertical, no 1280×720). */
export function planRefuerzo(w: number, h: number): PlanRefuerzo | null {
  if (!necesitaRefuerzo(w, h)) return null;
  const corto = Math.round((OBJETIVO_LADO_CAPTURA * 3) / 4);
  return h >= w
    ? { width: { ideal: corto }, height: { ideal: OBJETIVO_LADO_CAPTURA } }
    : { width: { ideal: OBJETIVO_LADO_CAPTURA }, height: { ideal: corto } };
}
