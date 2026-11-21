// Política de umbrales del gate (7.1 — C3: ÚNICA fuente de verdad de los
// números del producto). Escala del mantenedor: score 0..10.

/** Score mínimo para NO rechazar directo (≤ esto → RECHAZADA/BAJO). */
export const UMBRAL_RECHAZO_SCORE = 6.5;

/** Score de disparo del obturador automático (0..1, calidad de cámara viva). */
export const SHUTTER_SCORE_VISOR = 0.55;

/** Techo de score cuando no hay señal de contenido (solo foto bonita). */
export const TECHO_SIN_SENAL = 6.9;

/** Techo de score cuando el escudo de fondo tapa el documento (flash/sombra). */
export const TECHO_ESCUDO_FONDO = 7.2;

/** Techos por intento: el segundo intento no puede superar al primero. */
export const TECHO_SEGUNDO_INTENTO = 8.9;

/** Timeout por tier de dispositivo (adaptacion/plan.ts). */
export const TIMEOUT_ALTO_MS = 120_000;
export const TIMEOUT_MEDIO_MS = 240_000;
export const TIMEOUT_BAJO_MS = 480_000;
