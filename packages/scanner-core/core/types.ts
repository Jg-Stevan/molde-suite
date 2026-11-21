// Tipos núcleo de imagen (D8 opción B). Quad en fracciones 0..1 (4 esquinas
// en orden TL, TR, BR, BL), filtros de revelado y métricas de calidad.

export interface Punto {
  x: number;
  y: number;
}

/** Esquinas del documento en fracciones 0..1: [TL, TR, BR, BL]. */
export type Quad = [Punto, Punto, Punto, Punto];

/** Filtros de revelado del documento procesado. */
export type PageFilter = "original" | "bw" | "contrast";

/** Métricas de calidad fotográfica (escalas internas del motor). */
export interface PageQuality {
  /** Varianza del Laplaciano (nitidez). */
  sharpness: number;
  /** Brillo medio 0..255. */
  brightness: number;
  /** Desviación estándar de gris (contraste). */
  contrast: number;
}

/** Quad identidad = documento ocupa toda la imagen (sin recorte). */
export function defaultQuad(): Quad {
  return [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
}

/** ¿El quad es (aprox) el documento completo? */
export function esQuadIdentidad(q: Quad, eps = 0.01): boolean {
  const id = defaultQuad();
  return q.every((p, i) => Math.abs(p.x - id[i].x) <= eps && Math.abs(p.y - id[i].y) <= eps);
}
