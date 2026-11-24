// Progreso del análisis: rampa de pesos por etapa (la UI muestra el porcentaje
// global con piso escénico para que no salte de golpe).

import type { EtapaAnalisis, ProgresoAnalisis } from '@molde-suite/scanner-core/dominio/types';

/** Peso relativo de cada etapa (normalizado al vuelo). */
export const PESOS: Record<EtapaAnalisis, number> = {
  DETECTANDO: 1,
  RECORTANDO: 1.5,
  REALZANDO: 1,
  CALIDAD: 0.5,
  // PLAN-AGENTE-LAYOUT F4: el gate estructural es UNA inferencia S + evaluador
  // puro — peso pequeño entre CALIDAD y OCR (el OCR domina como siempre).
  LAYOUT: 0.5,
  OCR: 3,
};

/** Orden canónico de las etapas. */
export const ORDEN_ETAPAS: EtapaAnalisis[] = [
  'DETECTANDO',
  'RECORTANDO',
  'REALZANDO',
  'CALIDAD',
  'LAYOUT',
  'OCR',
];

const total = ORDEN_ETAPAS.reduce((acc, e) => acc + PESOS[e], 0);

function baseDe(etapa: EtapaAnalisis): number {
  let acc = 0;
  for (const e of ORDEN_ETAPAS) {
    if (e === etapa) break;
    acc += PESOS[e];
  }
  return acc / total;
}

/**
 * Ramp: convierte (etapa, fracción interna 0..1) en un ProgresoAnalisis
 * global monótono. Clamp de la fracción para nunca retroceder.
 */
export function conRampa(etapa: EtapaAnalisis, fraccion: number): ProgresoAnalisis {
  const f = Math.min(1, Math.max(0, fraccion));
  const desde = baseDe(etapa);
  const hasta = desde + PESOS[etapa] / total;
  return { etapa, progreso: Math.round((desde + (hasta - desde) * f) * 1000) / 1000 };
}
