// @jg-stevan/layout-core — motor de layout estructural (PLAN F2).
// ÚNICA fuente de la lógica compartida Studio↔Tamiz: el prototipo del banco
// de pruebas es evidencia, no código de producción.

export * from './tipos';
export * from './geom';
export { CLASES_CANONICAS, esCanonica, normalizarClase } from './clases';
export { nmsClaseAgnostico, type CajaConScore } from './nms';
export {
  MODELOS_LAYOUT,
  verificarContratoModelo,
  type ContratoModeloLayout,
} from './modelos';
export {
  evaluarEstructura,
  conModelo,
  BANDA_BAJA,
  DEFAULT_MARGEN,
  DEFAULT_MIN_SCORE,
  DEFAULT_NMS_INTERNO,
} from './evaluar';
export { matchVsGt, metricas, metricasVacias, type MetricasMatch } from './matcher';
