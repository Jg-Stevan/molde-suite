// Geometría de cajas xyxy (px de la página). Única fuente de verdad de
// IoU/contención — el matcher del GT y el NMS interno comparten estas fórmulas
// (prototipo docs/investigacion/pp-doclayout/estructura-e14.js, tipado).

export interface RectXYXY {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function area(a: RectXYXY): number {
  return Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);
}

export function inter(a: RectXYXY, b: RectXYXY): number {
  const w = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const h = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  return w * h;
}

export function iou(a: RectXYXY, b: RectXYXY): number {
  const i = inter(a, b);
  const u = area(a) + area(b) - i;
  return u > 0 ? i / u : 0;
}

/** Contención del más pequeño dentro del más grande (inter / min(area)). */
export function contencion(a: RectXYXY, b: RectXYXY): number {
  const min = Math.min(area(a), area(b));
  return min > 0 ? inter(a, b) / min : 0;
}

export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Clamp de una caja a los bordes de la página (px) — el escalado del
 *  decodificador puede salir 1-2 px por redondeo. */
export function clampPagina<T extends RectXYXY>(c: T, w: number, h: number): T {
  return {
    ...c,
    x1: Math.max(0, Math.min(c.x1, w)),
    y1: Math.max(0, Math.min(c.y1, h)),
    x2: Math.max(0, Math.min(c.x2, w)),
    y2: Math.max(0, Math.min(c.y2, h)),
  };
}
