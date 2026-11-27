/**
 * Fase 2 — tablas como HTML real.
 * Asigna las líneas OCR a celdas sobre la retícula SPARTAN y emite
 * `<table><tr><td>…</td></tr></table>` (mismo formato que datalab-convert).
 *
 * Reglas deducidas del GT:
 *  - th en la primera fila cuando el molde la declara encabezado.
 *  - colspan por banda de fila: en cada banda (par de separadoresY) solo
 *    cuentan los segmentos verticales que la cruzan; el colspan de una celda
 *    es la distancia entre sus dos límites en la retícula global de columnas.
 *    (Así sale el `colspan="4"` del encabezado del comprobante y el
 *    `colspan="2"` de la fila TOTAL del E-26.)
 *  - celda vacía -> `<td></td>`; líneas dentro de una celda -> `<br/>`.
 *  - negrita por fila (regla de molde para la fila TOTAL) -> `<b>...</b>`.
 */

import { escapar } from './html';
import type { BBox, LineaOcr, Retricula, SegmentoV } from './types';

export interface CeldaTabla {
  texto: string;
  colspan: number;
  esEncabezado: boolean;
  negrita: boolean;
}

export interface TablaEstructurada {
  filas: CeldaTabla[][];
  /** true si la primera fila es de encabezados (th). */
  conEncabezado: boolean;
}

export interface OpcionesTabla {
  thPrimeraFila?: boolean;
  filasNegrita?: number[];
}

const TOL = 3; // px de tolerancia para considerar que un segmento cruza una banda

function unicos(vals: number[]): number[] {
  return [...new Set(vals)].sort((a, b) => a - b);
}

function centroEn(bbox: BBox, rect: BBox): boolean {
  const cx = (bbox[0] + bbox[2]) / 2;
  const cy = (bbox[1] + bbox[3]) / 2;
  return cx >= rect[0] && cx <= rect[2] && cy >= rect[1] && cy <= rect[3];
}

/**
 * Divide las líneas entre las celdas de la retícula y construye la estructura.
 * Las líneas cuyo centro cae dentro del bbox de la tabla se consideran de la
 * tabla; cada una va a la celda que contiene su centro (caída a la más
 * cercana por x si toca un borde).
 */
export function armarTabla(
  ret: Retricula,
  lineas: LineaOcr[],
  bbox: BBox,
  opts: OpcionesTabla = {},
): { html: string; estructura: TablaEstructurada } {
  const [x0, y0, x1, y1] = bbox;
  // Normalización: la retícula debe incluir los bordes de la tabla.
  const segs: SegmentoV[] = ret.segmentosV ?? [];
  const cols = unicos([...ret.separadoresX, x0, x1]);
  const filas = unicos([...ret.separadoresY, y0, y1]);

  const indiceCol = (x: number) => {
    let mejor = 0;
    let mejorD = Infinity;
    cols.forEach((c, i) => {
      const d = Math.abs(c - x);
      if (d < mejorD) { mejorD = d; mejor = i; }
    });
    return mejor;
  };

  const conEncabezado = !!opts.thPrimeraFila;
  const estructura: TablaEstructurada = { filas: [], conEncabezado };

  for (let f = 0; f < filas.length - 1; f++) {
    const ya = filas[f];
    const yb = filas[f + 1];
    // límites verticales activos en esta banda
    let activos: number[];
    if (segs.length > 0) {
      activos = unicos(
        segs.filter((s) => s.y0 <= ya + TOL && s.y1 >= yb - TOL).map((s) => s.x),
      );
      if (activos.length < 2) activos = [x0, x1]; // banda sin líneas: celda completa
      if (activos[0] > x0 + TOL) activos = [x0, ...activos];
      if (activos[activos.length - 1] < x1 - TOL) activos = [...activos, x1];
    } else {
      activos = cols; // retícula completa asumida
    }

    const fila: CeldaTabla[] = [];
    const negritaFila = (opts.filasNegrita ?? []).includes(f);
    for (let c = 0; c < activos.length - 1; c++) {
      const ca = activos[c];
      const cb = activos[c + 1];
      const rect: BBox = [ca, ya, cb, yb];
      const deLaCelda = lineas
        .filter((l) => centroEn(l.bbox, rect))
        .sort((a, b) =>
          a.bbox[1] !== b.bbox[1] ? a.bbox[1] - b.bbox[1] : a.bbox[0] - b.bbox[0],
        );
      const texto = deLaCelda.map((l) => escapar(l.texto)).join('<br/>');
      fila.push({
        texto: negritaFila && texto ? `<b>${texto}</b>` : texto,
        colspan: indiceCol(cb) - indiceCol(ca),
        esEncabezado: conEncabezado && f === 0,
        negrita: negritaFila,
      });
    }
    estructura.filas.push(fila);
  }

  return { html: htmlDeEstructura(estructura), estructura };
}

/** Emite el `<table>` datalab desde la estructura ya construida. */
export function htmlDeEstructura(estructura: TablaEstructurada): string {
  const partes: string[] = ['<table>'];
  for (const fila of estructura.filas) {
    const celdas = fila
      .map((c) => {
        const tag = c.esEncabezado ? 'th' : 'td';
        const span = c.colspan > 1 ? ` colspan="${c.colspan}"` : '';
        return `<${tag}${span}>${c.texto}</${tag}>`;
      })
      .join('');
    partes.push(`<tr>${celdas}</tr>`);
  }
  partes.push('</table>');
  return partes.join('');
}
