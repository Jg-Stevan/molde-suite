// Calidad fotográfica del acta (escala del mantenedor, score 0..10).
//
// Fase 3 (migración scanner-core): la IMPLEMENTACIÓN vive ahora en
// packages/scanner-core/core/calidad.ts (absorbida verbatim en la Fase 2a).
// Este módulo conserva la ruta de importación histórica como re-export para
// que pipeline-recorte.ts y demás consumidores no cambien (D6/D2).

export {
  calidadDeActa,
  contrasteEfectivoDe,
  scoreDeCalidad,
  esquinasDeActa,
} from '@molde-suite/scanner-core/core/calidad';
