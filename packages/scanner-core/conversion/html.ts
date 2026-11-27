/**
 * Emisores de HTML por bloque, con las convenciones exactas de datalab-convert:
 *  - `<br/>` como separador de líneas dentro del JSON.
 *  - Escape de & < > en el texto OCR (los acentos van literales).
 *  - SectionHeader: `<h1>texto</h1>` si es una línea sin negrita; si hay
 *    varias líneas o negrita, se envuelve en <p>: `<h4><p><b>...</b></p></h4>`.
 *  - Firma inline dentro de un Text: `<p><img alt="..." data-bbox="x0 y0 x1 y1"
 *    src="{hash}_img.jpg"/><br/>caption</p>`.
 *  - Picture: `<img .../><div class="img-description" style="border: 1px solid
 *    #ccc; padding: 10px;"></div>`.
 */

import type { BBox, LineaOcr, RecorteImagen } from './types';

export function escapar(texto: string): string {
  return texto
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/**
 * Une líneas con `<br/>`. Las líneas consecutivas en negrita se envuelven en
 * UN solo `<b>` que cruza los `<br/>` internos (así lo hace datalab: el
 * `<h1>` del E-26 lleva `<b>ACTA PARCIAL...<br/>CONCEJO</b>`).
 */
export function unirLineas(lineas: LineaOcr[]): string {
  const partes: string[] = [];
  let buf: string[] = [];
  let bufNegrita = false;
  const vaciar = () => {
    if (buf.length === 0) return;
    const texto = buf.join('<br/>');
    partes.push(bufNegrita ? `<b>${texto}</b>` : texto);
    buf = [];
  };
  for (const l of lineas) {
    const negrita = !!l.negrita;
    if (buf.length > 0 && negrita !== bufNegrita) vaciar();
    buf.push(escapar(l.texto));
    bufNegrita = negrita;
  }
  vaciar();
  return partes.join('<br/>');
}

export interface OpcionesTexto {
  /** Regla de molde: la etiqueta hasta ':' del primer renglón va en negrita. */
  negritaEtiqueta?: boolean;
}

/** Párrafo de texto: `<p>linea1<br/>linea2</p>`. */
export function htmlTexto(lineas: LineaOcr[], opts: OpcionesTexto = {}): string {
  const cuerpo = lineas
    .map((l, i) => {
      let t = escapar(l.texto);
      if (i === 0 && opts.negritaEtiqueta) {
        const pos = t.indexOf(':');
        if (pos > 0 && pos < t.length - 1) t = `<b>${t.slice(0, pos + 1)}</b>${t.slice(pos + 1)}`;
        else if (pos === t.length - 1) t = `<b>${t}</b>`;
      } else if (l.negrita) {
        t = `<b>${t}</b>`;
      }
      return t;
    })
    .join('<br/>');
  return `<p>${cuerpo}</p>`;
}

/**
 * Encabezado de sección. datalab envuelve el contenido en <p> cuando hay
 * varias líneas o negrita (E-26: `<h1><p>...<br/><b>ACTA...</b></p></h1>`).
 */
export function htmlSeccion(nivel: number, lineas: LineaOcr[]): string {
  const n = Math.min(Math.max(nivel, 1), 6);
  const variasLineas = lineas.length > 1;
  const conNegrita = lineas.some((l) => l.negrita);
  const cuerpo = unirLineas(lineas);
  if (variasLineas || conNegrita) return `<h${n}><p>${cuerpo}</p></h${n}>`;
  return `<h${n}>${cuerpo}</h${n}>`;
}

/** Footer/header de página: párrafo simple. */
export function htmlPie(lineas: LineaOcr[]): string {
  return `<p>${unirLineas(lineas)}</p>`;
}

/** Bloque Picture (imagen / sello como bloque propio). */
export function htmlPicture(filename: string): string {
  return (
    `<img alt="" src="${filename}"/>` +
    `<div class="img-description" style="border: 1px solid #ccc; padding: 10px;"></div>`
  );
}

/**
 * Texto con firma recortada inline (patrón datalab): el crop lleva su
 * data-bbox propio (coords de página) y el caption impreso queda como texto
 * tras un <br/>.
 */
export function htmlFirmaInline(
  recorte: RecorteImagen,
  filename: string,
  caption: string,
): string {
  const [x0, y0, x1, y1] = recorte.bbox.map(Math.round);
  const alt = escapar(recorte.alt ?? 'Handwritten signature');
  const img = `<img alt="${alt}" data-bbox="${x0} ${y0} ${x1} ${y1}" src="${filename}"/>`;
  return caption ? `<p>${img}<br/>${escapar(caption)}</p>` : `<p>${img}</p>`;
}
