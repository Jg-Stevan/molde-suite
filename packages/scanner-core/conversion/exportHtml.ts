/**
 * Export HTML en el formato de datalab-convert (fragmento con sangría):
 *  - bloques a 2 espacios, separados por línea en blanco;
 *  - tablas: `<tbody><tr>` juntos a 3 espacios, celdas a 4, `</tbody></table>`
 *    a 2; `<br/>` se normaliza a `<br>`;
 *  - encabezados multi-línea: `<h1>` / contenido a 3 / `</h1>`;
 *  - imágenes: src pasa de filename a data URI con el base64 del bloque;
 *  - PageHeader/PageFooter se omiten (datalab no los exporta).
 */

import type { BloqueChandra } from './types';
import type { ConversionChandra } from './types';

function dataUri(b: BloqueChandra, filename: string): string | null {
  const b64 = b.images[filename];
  if (!b64) return null;
  return `data:image/jpeg;base64,${b64}`;
}

/** Reemplaza los src="{hash}_img.jpg" por data URIs cuando el bloque tiene el recorte. */
function inlinearImagenes(b: BloqueChandra, html: string): string {
  let out = html;
  for (const fn of Object.keys(b.images)) {
    const uri = dataUri(b, fn);
    if (uri) out = out.replaceAll(`src="${fn}"`, `src="${uri}"`);
  }
  return out;
}

function renderTabla(b: BloqueChandra): string[] {
  const lineas: string[] = ['  <table>'];
  const filas = [...b.html.matchAll(/<tr>(.*?)<\/tr>/g)].map((m) => m[1]);
  filas.forEach((fila, i) => {
    const pref = i === 0 ? '   <tbody><tr>' : '   <tr>';
    lineas.push(pref);
    for (const m of fila.matchAll(/<(th|td)([^>]*)>(.*?)<\/\1>/g)) {
      const contenido = m[3].replaceAll('<br/>', '<br>');
      lineas.push(`    <${m[1]}${m[2]}>${contenido}</${m[1]}>`);
    }
    lineas.push('   </tr>');
  });
  lineas.push('  </tbody></table>');
  return lineas;
}

function renderBloque(b: BloqueChandra): string[] | null {
  if (b.block_type === 'PageFooter' || b.block_type === 'PageHeader') return null;

  const mTabla = b.html.match(/^<table>.*<\/table>$/s);
  if (mTabla) return renderTabla(b);

  if (b.block_type === 'Picture') {
    // datalab separa el <img .../> y el <div class="img-description"> en dos líneas
    const html = inlinearImagenes(b, b.html);
    const corte = html.indexOf('/>') + 2; // fin del <img .../> (el base64 no contiene '>')
    const imgTag = html.slice(0, corte);
    const resto = html.slice(corte);
    const lineas = ['  ' + imgTag.replaceAll('<br/>', '<br>')];
    if (resto) lineas.push('  ' + resto);
    return lineas;
  }

  const mH = b.html.match(/^<(h[1-6])>(.*)<\/\1>$/s);
  if (mH) {
    const dentro = mH[2];
    const mp = dentro.match(/^<p>(.*)<\/p>$/s);
    if (mp) {
      // encabezado multi-línea: <h1> / <p>...</p> / </h1>
      const cuerpo = inlinearImagenes(b, mp[1]).replaceAll('<br/>', '<br>');
      return [`  <${mH[1]}>`, `   <p>${cuerpo}</p>`, `  </${mH[1]}>`];
    }
    return [`  <${mH[1]}>${inlinearImagenes(b, dentro).replaceAll('<br/>', '<br>')}</${mH[1]}>`];
  }

  // párrafos simples (Text, firma inline)
  return ['  ' + inlinearImagenes(b, b.html).replaceAll('<br/>', '<br>')];
}

/** HTML completo del documento convertido (fragmento, formato datalab-convert). */
export function exportarHtml(conv: ConversionChandra): string {
  const bloques: string[] = [];
  for (const pag of conv.children) {
    for (const b of pag.children) {
      const lineas = renderBloque(b);
      if (lineas) bloques.push(lineas.join('\n'));
    }
  }
  // datalab: salto inicial + bloques adyacentes (sin separación en blanco)
  return '\n' + bloques.join('\n');
}
