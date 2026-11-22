// NMS CLASE-AGNÓSTICO (IoU configurable, greedy por score).
//
// El ONNX de plus-L NO trae NMS (dossier §3): su salida son 300 queries y hay
// que suprimir duplicados SIN mirar la clase (el mismo bloque aparece como
// text/table/image). S trae NMS horneado, pero el NMS interno del evaluador
// también lo usa dentro de cada grupo de zona.

import { iou, type RectXYXY } from './geom';

export interface CajaConScore extends RectXYXY {
  score: number;
}

/**
 * Supresión no-máxima clase-agnóstica: ordena por score descendente y mantiene
 * la primera caja cuyo IoU contra las ya mantenidas sea < `iouUmbral`.
 * No muta la entrada; el orden de salida es el de los mantenidos (por score).
 */
export function nmsClaseAgnostico<T extends CajaConScore>(cajas: T[], iouUmbral: number): T[] {
  const orden = [...cajas].sort((a, b) => b.score - a.score);
  const keep: T[] = [];
  for (const d of orden) {
    if (keep.some((k) => iou(k, d) >= iouUmbral)) continue;
    keep.push(d);
  }
  return keep;
}
