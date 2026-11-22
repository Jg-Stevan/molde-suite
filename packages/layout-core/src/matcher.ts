// MATCHER de métricas contra GT (port del prototipo estructura-e14.js §match):
// greedy por score, uno-a-uno, con IoU >= minIou O contención >= minCont.
// El GT de Chandra vive normalizado 0-1 (docs/investigacion/pp-doclayout/);
// aquí todo se compara en px de la página (el llamador escala el GT).

import { area, contencion, iou, type RectXYXY } from './geom';

export interface CajaGT extends RectXYXY {
  /** Tipo del bloque GT (Text/Picture/Table/...) y fragmento de texto. */
  type?: string;
  text?: string;
  score?: number;
}

export interface ParMatch<P, G> {
  pred: P;
  gt: G;
  iou: number;
  cont: number;
}

export interface MetricasMatch {
  tp: number;
  preds: number;
  gt: number;
  P: number;
  R: number;
  F1: number;
  pairs: ParMatch<unknown, unknown>[];
}

/**
 * Match uno-a-uno codicioso por score (el prototipo validado). Un pred matchea
 * un GT sin usar si IoU >= minIou (0.5) o contención >= minCont (0.8).
 */
export function matchVsGt<P extends RectXYXY & { score?: number }, G extends RectXYXY>(
  preds: P[],
  gts: G[],
  minIou = 0.5,
  minCont = 0.8,
): { tp: number; pairs: ParMatch<P, G>[] } {
  const usados = new Set<number>();
  const pairs: ParMatch<P, G>[] = [];
  let tp = 0;
  const orden = [...preds].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  for (const p of orden) {
    let mejor: { i: number; v: number; c: number; g: G } | null = null;
    for (let i = 0; i < gts.length; i++) {
      if (usados.has(i)) continue;
      const g = gts[i];
      const v = iou(p, g);
      const c = contencion(p, g);
      if (v >= minIou || c >= minCont) {
        if (!mejor || v > mejor.v) mejor = { i, v, c, g };
      }
    }
    if (mejor) {
      usados.add(mejor.i);
      tp++;
      pairs.push({ pred: p, gt: mejor.g, iou: Math.round(mejor.v * 100) / 100, cont: Math.round(mejor.c * 100) / 100 });
    }
  }
  return { tp, pairs };
}

export function metricas<P extends RectXYXY & { score?: number }, G extends RectXYXY>(
  preds: P[],
  gts: G[],
  minIou = 0.5,
  minCont = 0.8,
): MetricasMatch {
  const { tp, pairs } = matchVsGt(preds, gts, minIou, minCont);
  const P = preds.length ? tp / preds.length : 0;
  const R = gts.length ? tp / gts.length : 0;
  return {
    tp,
    preds: preds.length,
    gt: gts.length,
    P: Math.round(P * 1000) / 1000,
    R: Math.round(R * 1000) / 1000,
    F1: Math.round((P + R ? (2 * P * R) / (P + R) : 0) * 1000) / 1000,
    pairs: pairs as ParMatch<unknown, unknown>[],
  };
}

/** Utilidad de corpus: sin predicciones el matcher es honesto (0 TP). */
export function metricasVacias(gt: RectXYXY[]): MetricasMatch {
  return metricas([], gt.map((g) => ({ ...g, score: 0 })));
}

void area;
