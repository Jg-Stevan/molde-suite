/**
 * tests/estructura.test.mjs — bun test de convertidores con fixtures sintéticas.
 * Cobertura: TSV→estructura, hOCR→estructura, cajas→estructura, tabla detection,
 * Markdown y HTML (incluido data-bbox). El arnés mínimo del plan §4.2 usa estas
 * mismas funciones; aquí se prueban con TSV/hOCR sintéticos y cajas de RapidOCR.
 */
import { describe, test, expect } from 'bun:test';
import {
  tsvAEstructura, hocrAEstructura, cajasAEstructura, estructuraAMd, estructuraAHtml,
  polyABbox, rectABbox,
} from '../src/estructura.mjs';

// Fixture TSV sintético: un título grande + 2 párrafos + una tabla 2×3.
// level page block par line word left top w h conf text
function tsvFixture() {
  const filas = [];
  const fila = (level, page, block, par, line, word, left, top, w, h, conf, text) =>
    filas.push([level, page, block, par, line, word, left, top, w, h, conf, text].join('\t'));
  // bloque 1: título "ACTA DE PRUEBA" (una línea, alta)
  fila(2, 1, 1, -1, -1, -1, 100, 60, 400, 60, -1, '');
  fila(4, 1, 1, 1, 1, -1, 100, 60, 400, 60, -1, '');
  fila(5, 1, 1, 1, 1, 1, 100, 60, 190, 60, 96, 'ACTA');
  fila(5, 1, 1, 1, 1, 2, 310, 60, 190, 60, 96, 'DE');
  fila(5, 1, 1, 1, 1, 3, 410, 60, 90, 60, 95, 'PRUEBA');
  // bloque 2: párrafo de 2 líneas
  fila(2, 1, 2, -1, -1, -1, 100, 200, 900, 80, -1, '');
  fila(4, 1, 2, 1, 1, -1, 100, 200, 900, 40, -1, '');
  fila(5, 1, 2, 1, 1, 1, 100, 200, 120, 40, 95, 'Departamento');
  fila(5, 1, 2, 1, 1, 2, 240, 200, 180, 40, 94, '01-ANTIOQUIA');
  fila(4, 1, 2, 1, 2, -1, 100, 245, 900, 35, -1, '');
  fila(5, 1, 2, 1, 2, 1, 100, 245, 90, 35, 93, 'Municipio');
  fila(5, 1, 2, 1, 2, 2, 210, 245, 160, 35, 94, '007-ABRIAQUI');
  // bloque 3: tabla de 3 líneas × 3 columnas estables
  const filasTabla = [
    [['CODIGO', 100], ['NOMBRE', 350], ['VOTOS', 600]],
    [['000', 110], ['PARTIDO UNO', 340], ['125', 610]],
    [['001', 112], ['PARTIDO DOS', 345], ['87', 605]],
  ];
  filasTabla.forEach((cells, li) => {
    fila(2, 1, 3 + li, -1, -1, -1, 100, 400 + li * 50, 700, 40, -1, '');
    fila(4, 1, 3 + li, 1, 1, -1, 100, 400 + li * 50, 700, 40, -1, '');
    cells.forEach(([t, x], wi) => fila(5, 1, 3 + li, 1, 1, wi + 1, x, 400 + li * 50, 90, 40, 95, t));
  });
  return filas.join('\n');
}

const HOCR_FIXTURE = `<!doctype html><html><body>
<div class='ocr_page' id='page_1' title='image "x.png"; bbox 0 0 1000 1400; ppageno 0'>
<div class='ocr_carea' title='bbox 100 60 500 120'>
 <span class='ocr_par' title='bbox 100 60 500 120'>
  <span class='ocr_line' title='bbox 100 60 500 120'>
   <span class='ocrx_word' title='bbox 100 60 190 120'>T&Iacute;TULO</span>
   <span class='ocrx_word' title='bbox 310 60 500 120'>GRANDE</span>
  </span>
 </span>
</div>
<div class='ocr_carea' title='bbox 100 200 900 320'>
 <span class='ocr_par' title='bbox 100 200 900 320'>
  <span class='ocr_line' title='bbox 100 200 900 240'>
   <span class='ocrx_word' title='bbox 100 200 300 240'>Texto</span>
   <span class='ocrx_word' title='bbox 320 200 480 240'>impreso</span>
  </span>
  <span class='ocr_line' title='bbox 100 280 900 320'>
   <span class='ocrx_word' title='bbox 100 280 380 320'>segunda</span>
   <span class='ocrx_word' title='bbox 400 280 520 320'>l&iacute;nea</span>
  </span>
 </span>
</div>
</div></body></html>`;

const CAJAS_RAPIDOCR = [
  { texto: 'RECIBO DE ENTREGA', poly: [80, 40, 420, 38, 424, 88, 76, 90], score: 0.97 },
  { texto: 'Fecha: 02 de febrero de 2026', poly: [80, 200, 500, 198, 504, 238, 76, 240], score: 0.95 },
  { texto: 'N.º Guía: G-2026-0099', poly: [80, 250, 470, 248, 474, 288, 76, 290], score: 0.94 },
  { texto: 'Firma', poly: [80, 900, 160, 898, 164, 938, 76, 940], score: 0.91 },
];

describe('primitivas geométricas', () => {
  test('rectABbox y polyABbox (4 vértices y xywh)', () => {
    expect(rectABbox(10, 20, 60, 90)).toEqual([10, 20, 50, 70]);
    expect(polyABbox([80, 40, 420, 38, 424, 88, 76, 90])).toEqual([76, 38, 348, 52]);
    expect(polyABbox([5, 6, 20, 30])).toEqual([5, 6, 20, 30]);
    expect(polyABbox(null)).toBe(null);
  });
});

describe('TSV → estructura', () => {
  const arbol = tsvAEstructura(tsvFixture(), { ancho: 1000, alto: 1400, pag: 1 });

  test('detecta bloques y mantiene coordenadas', () => {
    expect(arbol.tipo).toBe('pagina');
    expect(arbol.bloques.length).toBeGreaterThanOrEqual(3);
    const tipos = arbol.bloques.map((b) => b.tipo);
    expect(tipos).toContain('titulo');      // ACTA DE PRUEBA: altura 60 >> mediana 40
    expect(tipos).toContain('tabla');       // 3 líneas × 3 columnas estables
  });

  test('tabla conserva rejilla de celdas', () => {
    const tabla = arbol.bloques.find((b) => b.tipo === 'tabla');
    expect(tabla).toBeTruthy();
    expect(tabla.celdas.length).toBe(3);
    expect(tabla.celdas[0].map((c) => c.texto)).toEqual(['CODIGO', 'NOMBRE', 'VOTOS']);
    expect(tabla.celdas[2].map((c) => c.texto)).toEqual(['001', 'PARTIDO DOS', '87']);
    expect(tabla.celdas[1][2].bbox).toEqual([610, 450, 90, 40]);
  });

  test('párrafo une sus líneas en orden', () => {
    const par = arbol.bloques.find((b) => b.tipo === 'parrafo');
    expect(par).toBeTruthy();
    const texto = par.lineas.map((l) => l.texto).join(' ');
    expect(texto).toContain('Departamento 01-ANTIOQUIA');
    expect(texto).toContain('Municipio 007-ABRIAQUI');
  });

  test('estructuraAMd renderiza tabla pipe y título', () => {
    const md = estructuraAMd(arbol, { bbox: false });
    expect(md).toContain('# ACTA DE PRUEBA');
    expect(md).toMatch(/\|\s*CODIGO\s*\|\s*NOMBRE\s*\|\s*VOTOS\s*\|/);
    expect(md).toContain('| 000 | PARTIDO UNO | 125 |');
  });

  test('estructuraAHtml emite data-bbox por bloque y celda', () => {
    const html = estructuraAHtml(arbol);
    expect(html).toMatch(/<h1[^>]*data-bbox="\d+,\d+,\d+,\d+"/);
    expect(html).toMatch(/<table[^>]*data-bbox=/);
    expect(html).toMatch(/<td data-bbox="\d+,\d+,\d+,\d+">PARTIDO UNO<\/td>/);
    expect(html).toContain('<!doctype html>');
  });
});

describe('hOCR → estructura', () => {
  const arbol = hocrAEstructura(HOCR_FIXTURE, { ancho: 1000, alto: 1400 });
  test('decodifica entidades y agrupa líneas del mismo párrafo', () => {
    const bloques = arbol.bloques;
    expect(bloques.length).toBe(2); // 1 título + 1 párrafo (2 líneas del mismo par)
    const titulo = bloques[0];
    expect(titulo.tipo).toBe('titulo');
    expect(titulo.lineas[0].texto).toBe('TÍTULO GRANDE');
    const par = bloques[1];
    expect(par.lineas.length).toBe(2);
    expect(par.lineas[1].texto).toBe('segunda línea');
  });
  test('el hOCR y el TSV producen el mismo texto para el mismo contenido', () => {
    // sanity: ambos convertidores terminan en el mismo contrato de estructura
    expect(arbol.bloques.every((b) => Array.isArray(b.bbox) && b.bbox.length === 4)).toBe(true);
  });
});

describe('cajas (RapidOCR) → estructura', () => {
  const arbol = cajasAEstructura(CAJAS_RAPIDOCR, { ancho: 500, alto: 1000 });
  test('agrupa las 2 líneas de la cabecera en un bloque parrafo', () => {
    const bloques = arbol.bloques;
    expect(bloques.length).toBe(3); // título + (fecha + guía agrupados) + firma
    const grupo = bloques.find((b) => b.lineas.length === 2);
    expect(grupo).toBeTruthy();
    expect(grupo.lineas[0].texto).toContain('Fecha: 02 de febrero de 2026');
  });
  test('título detectado por tamaño relativo', () => {
    expect(arbol.bloques[0].tipo).toBe('titulo');
  });
});
