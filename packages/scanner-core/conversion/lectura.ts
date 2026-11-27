/**
 * Orden de lectura formalizado para el serializador.
 *
 * Reglas (en este orden de prioridad):
 *  1. Si el molde declara `orden` explícito en alguna región, manda el molde
 *     (el humano define el mapa, la máquina lo ejecuta).
 *  2. Si no, orden geométrico top-down (y0 ascendente; empate -> x0).
 *  3. PageHeader/PageFooter salen del flujo: el header va primero y el footer
 *     al final (lo maneja serializar.ts; aquí solo se detectan por clase).
 *
 * Nota honesta: el orden de Chandra viene de su modelo (predicción de orden),
 * no de una regla geométrica; en la fila de firmas del E-26 intercala el
 * caption de cada firma. Con molde calibrado nuestro orden es al menos tan
 * bueno; sin molde puede diferir en filas multi-columna (documentado).
 */

import type { RegionLayout } from './types';

export const CLASES_HEADER = ['header', 'page_header'];
export const CLASES_FOOTER = ['footer', 'page_footer'];

export function esHeader(r: RegionLayout): boolean {
  return CLASES_HEADER.includes(r.clase.toLowerCase());
}

export function esFooter(r: RegionLayout): boolean {
  return CLASES_FOOTER.includes(r.clase.toLowerCase());
}

/**
 * Ordena las regiones del flujo principal (sin header/footer).
 * Devuelve [header, ...flujo, footer] o solo el flujo si no hay ninguno.
 */
export function ordenarRegiones(regiones: RegionLayout[]): RegionLayout[] {
  const headers: RegionLayout[] = [];
  const footers: RegionLayout[] = [];
  const flujo: RegionLayout[] = [];
  for (const r of regiones) {
    if (esHeader(r)) headers.push(r);
    else if (esFooter(r)) footers.push(r);
    else flujo.push(r);
  }

  const conOrden = flujo.some((r) => r.orden !== undefined);
  let ordenado: RegionLayout[];
  if (conOrden) {
    // Orden explícito del molde; regiones sin orden van al final por geometría.
    ordenado = [...flujo].sort((a, b) => {
      const oa = a.orden ?? Number.MAX_SAFE_INTEGER;
      const ob = b.orden ?? Number.MAX_SAFE_INTEGER;
      if (oa !== ob) return oa - ob;
      if (a.bbox[1] !== b.bbox[1]) return a.bbox[1] - b.bbox[1];
      return a.bbox[0] - b.bbox[0];
    });
  } else {
    ordenado = [...flujo].sort((a, b) => {
      if (a.bbox[1] !== b.bbox[1]) return a.bbox[1] - b.bbox[1];
      return a.bbox[0] - b.bbox[0];
    });
  }

  const ordenarEdge = (arr: RegionLayout[]) =>
    arr.sort((a, b) =>
      a.orden !== undefined && b.orden !== undefined
        ? a.orden - b.orden
        : a.bbox[1] - b.bbox[1],
    );
  return [...ordenarEdge(headers), ...ordenado, ...ordenarEdge(footers)];
}
