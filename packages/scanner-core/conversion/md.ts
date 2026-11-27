/**
 * Export Markdown en el formato exacto de datalab-convert (calibrado contra
 * los .md del RAR con el comparador):
 *  - empieza con "\n\n", bloques unidos con "\n\n", SIN newline final.
 *  - PageFooter/PageHeader se omiten (datalab no los exporta).
 *  - encabezados: las líneas se unen con espacio (`<br/>` -> ' '), `<b>` -> `**`.
 *  - párrafos: `<br/>` -> salto duro "  \n"; `<b>` -> `**`; img -> `![alt](fn)`.
 *  - tablas pipe: ancho de columna = max(len celda) + 2; el separador usa ese
 *    mismo ancho en guiones; una celda con colspan expande con celdas vacías;
 *    tabla sin th -> fila de encabezado vacía + separador + filas + separador;
 *    tabla con th -> encabezado + separador + filas (sin separador final).
 *  - las imágenes se referencian por su filename `{hash}_img.jpg` (sin data:).
 */

import type { ConversionChandra } from './types';

function mdDeHtmlInterno(html: string): string {
  // contenido de un <p> o de un <h{n}>: br -> espacio (encabezados) se decide fuera
  return html.replaceAll(/<b>(.*?)<\/b>/g, '**$1**');
}

function celdasDeHtmlTabla(htmlTabla: string): { celdas: string[][]; colspan: number[][]; enc: boolean } {
  const filasHtml = [...htmlTabla.matchAll(/<tr>(.*?)<\/tr>/g)].map((m) => m[1]);
  const celdas: string[][] = [];
  const colspan: number[][] = [];
  let enc = false;
  filasHtml.forEach((fila, fi) => {
    const cs: string[] = [];
    const sp: number[] = [];
    let esTh = false;
    for (const m of fila.matchAll(/<(th|td)([^>]*)>(.*?)<\/\1>/g)) {
      if (m[1] === 'th') esTh = true;
      const spanM = m[2].match(/colspan="(\d+)"/);
      // contenido CRUDO (solo <br/> -> <br>); <b> se convierte al renderizar,
      // porque los anchos de columna se miden sobre el crudo (regla datalab)
      const contenido = m[3].replaceAll('<br/>', '<br>');
      cs.push(contenido);
      sp.push(spanM ? parseInt(spanM[1], 10) : 1);
    }
    if (fi === 0 && esTh) enc = true;
    celdas.push(cs);
    colspan.push(sp);
  });
  return { celdas, colspan, enc };
}

/** Expande los colspan con celdas vacías sobre la retícula de columnas real. */
function expandir(celdas: string[][], colspan: number[][]): string[][] {
  const filas: string[][] = [];
  for (let f = 0; f < celdas.length; f++) {
    const fila: string[] = [];
    for (let c = 0; c < celdas[f].length; c++) {
      fila.push(celdas[f][c]);
      for (let k = 1; k < colspan[f][c]; k++) fila.push('');
    }
    filas.push(fila);
  }
  return filas;
}

export function tablaAMd(htmlTabla: string): string {
  const { celdas, colspan, enc } = celdasDeHtmlTabla(htmlTabla);
  // datalab mide el ancho sobre el contenido CRUDO de la celda (con <b>...</b>,
  // <br> literales) y convierte las etiquetas solo al renderizar
  const filas = expandir(celdas, colspan);
  const ncols = Math.max(...filas.map((f) => f.length));
  const anchos: number[] = [];
  for (let c = 0; c < ncols; c++) {
    anchos[c] = Math.max(...filas.map((f) => (f[c] ?? '').length), 0) + 2;
  }
  const renderFila = (celdas2: (string | null)[]) =>
    // quirk datalab: el contenido de las celdas va CRUDO al markdown
    // (<b>...</b> sin convertir); los anchos se midieron sobre ese crudo
    '|' + celdas2.map((t, i) => ' ' + (t ?? '').padEnd(anchos[i] - 2) + ' ').join('|') + '|';
  const sep = '|' + anchos.map((a) => '-'.repeat(a)).join('|') + '|';
  const lineas: string[] = [];
  if (enc) {
    lineas.push(renderFila(filas[0]));
    lineas.push(sep);
    for (let f = 1; f < filas.length; f++) lineas.push(renderFila(filas[f]));
  } else {
    // datalab emite encabezado vacío + separador + filas + separador
    lineas.push(renderFila(filas[0].map(() => '')));
    lineas.push(sep);
    for (let f = 0; f < filas.length; f++) lineas.push(renderFila(filas[f]));
    lineas.push(sep);
  }
  return lineas.join('\n');
}

function imgAMd(html: string): string {
  // `<img alt="A" ... src="fn"/>` -> `![A](fn)`
  return html.replaceAll(/<img alt="([^"]*)"[^>]*src="([^"]+)"[^>]*\/?>/g, '![$1]($2)');
}

function bloqueAMd(b: ConversionChandra['children'][number]['children'][number]): string {
  if (b.block_type === 'Picture') {
    // solo la etiqueta img (el div img-description no va al markdown)
    const m = b.html.match(/<img [^>]*>/);
    return m ? imgAMd(m[0]) : '';
  }
  const m = b.html.match(/^<(h[1-6])>(.*)<\/\1>$/s);
  if (m) {
    let dentro = m[2];
    const mp = dentro.match(/^<p>(.*)<\/p>$/s);
    if (mp) dentro = mp[1];
    const nivel = parseInt(m[1][1], 10);
    const contenido = mdDeHtmlInterno(dentro)
      .replaceAll('<br/>', ' ')
      .replaceAll('<br>', ' ');
    return '#'.repeat(nivel) + ' ' + contenido;
  }
  // párrafos (Text / PageFooter / firma inline)
  const mp = b.html.match(/^<p>(.*)<\/p>$/s);
  if (mp) {
    const cuerpo = mdDeHtmlInterno(imgAMd(mp[1]));
    const lineas = cuerpo.split('<br/>');
    return lineas.map((l) => l.trimEnd()).join('  \n');
  }
  return mdDeHtmlInterno(imgAMd(b.html));
}

/** Markdown completo del documento convertido (formato datalab-convert). */
export function exportarMarkdown(conv: ConversionChandra): string {
  const bloquesMd: string[] = [];
  for (const pag of conv.children) {
    for (const b of pag.children) {
      if (b.block_type === 'PageFooter' || b.block_type === 'PageHeader') continue;
      if (b.block_type === 'Table' || b.block_type === 'Form') {
        bloquesMd.push(tablaAMd(b.html));
      } else {
        bloquesMd.push(bloqueAMd(b));
      }
    }
  }
  return '\n\n' + bloquesMd.join('\n\n');
}
