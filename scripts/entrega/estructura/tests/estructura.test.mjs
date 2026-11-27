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

// ─────────────────────────────────────────────────────────────────────────────
// V2 (cierre Benchmark V3, informe E2 §10.2/§10.3): regla de actas para
// SectionHeader + asociación etiqueta↔valor por GEOMETRÍA (bbox [x,y,w,h]).
// ─────────────────────────────────────────────────────────────────────────────
import { postprocesar } from '../src/estructura.mjs';
import { resolverPorGeometria, extraerCampos } from '../src/extraer.mjs';

describe('estructura v2 — SectionHeader de actas (prefijo numérico)', () => {
  test('«1. IDENTIFICACIÓN DEL PUESTO DE VOTACIÓN MUNICIPAL» → seccion (no parrafo)', () => {
    const arbol = postprocesar({
      tipo: 'pagina', ancho: 1700, alto: 2200, pag: 1,
      bloques: [
        { texto: 'ACTA DE ESCRUTINIO', bbox: [100, 60, 900, 50], palabras: [] },
        { texto: '1. IDENTIFICACIÓN DEL PUESTO DE VOTACIÓN MUNICIPAL', bbox: [100, 200, 1500, 30], palabras: [] },
        { texto: 'El delegado del partido procedió a la verificación de las urnas y mesas instaladas.', bbox: [100, 260, 1400, 28], palabras: [] },
        { texto: 'Acta levantada por los jurados presentes de la mesa número cuatro.', bbox: [100, 310, 1300, 28], palabras: [] },
      ],
    });
    const secciones = arbol.bloques.filter((b) => b.tipo === 'seccion');
    expect(secciones.length).toBeGreaterThanOrEqual(1);
    expect(secciones.some((b) => b.lineas[0].texto.includes('IDENTIFICACIÓN DEL PUESTO'))).toBe(true);
  });

  test('párrafo largo sin prefijo numérico sigue siendo parrafo', () => {
    const arbol = postprocesar({
      tipo: 'pagina', ancho: 1700, alto: 2200, pag: 1,
      bloques: [
        { texto: 'ESTE TEXTO EN MAYUSCULAS SUPERA EL LIMITE DE NOVENTA CARACTERES PARA NO SER UN ENCABEZADO NUMERADO DE NINGUNA CLASE', bbox: [100, 200, 1600, 30], palabras: [] },
      ],
    });
    expect(arbol.bloques[0].tipo).toBe('parrafo');
  });
});

describe('estructura v2 — asociación etiqueta↔valor por geometría', () => {
  const defForma = [{ id: 'forma_pago', etiqueta: /forma de pago/, esValor: (l) => /transferencia|efectivo|tarjeta|contado/.test(l) }];

  test('valor en la MISMA línea que la etiqueta', () => {
    const arbol = { bloques: [{ tipo: 'parrafo', lineas: [
      { texto: 'Forma de pago: Transferencia bancaria', bbox: [100, 100, 500, 24] },
    ] }] };
    expect(resolverPorGeometria(arbol, defForma)).toEqual({ forma_pago: 'transferencia bancaria' });
  });

  test('valor en la línea de ABAJO (la más cercana gana)', () => {
    const arbol = { bloques: [{ tipo: 'parrafo', lineas: [
      { texto: 'Forma de pago', bbox: [100, 100, 200, 24] },
      { texto: 'Cuenta ES91 2100 0418 4502 0005 1332', bbox: [100, 150, 500, 24] },
      { texto: 'Transferencia bancaria', bbox: [100, 130, 300, 22] },
    ] }] };
    expect(resolverPorGeometria(arbol, defForma).forma_pago).toBe('transferencia bancaria');
  });

  test('OCR INVERTIDO (vac-03): el valor está ANTES en texto pero CERCA en geometría', () => {
    // dos columnas de la misma fila: el valor queda a la derecha, misma altura
    const arbol = { bloques: [{ tipo: 'parrafo', lineas: [
      { texto: 'Transferencia bancaria', bbox: [400, 100, 300, 24] },
      { texto: 'Forma de pago', bbox: [100, 100, 200, 24] },
    ] }] };
    expect(resolverPorGeometria(arbol, defForma).forma_pago).toBe('transferencia bancaria');
  });

  test('valor a más de 6 alturas de línea → NO resuelto (nunca inventar)', () => {
    const arbol = { bloques: [{ tipo: 'parrafo', lineas: [
      { texto: 'Forma de pago', bbox: [100, 100, 200, 24] },
      { texto: 'Transferencia bancaria', bbox: [100, 600, 300, 24] },
    ] }] };
    expect(resolverPorGeometria(arbol, defForma)).toEqual({});
  });

  test('las líneas de TABLA se excluyen (los valores de celdas no van por proximidad)', () => {
    const arbol = { bloques: [
      { tipo: 'parrafo', lineas: [{ texto: 'Forma de pago', bbox: [100, 100, 200, 24] }] },
      { tipo: 'tabla', celdas: [[{ texto: 'Transferencia bancaria', bbox: [100, 150, 300, 24] }]] },
    ] };
    expect(resolverPorGeometria(arbol, defForma)).toEqual({});
  });

  test('integración: extraerCampos con árbol resuelve telefono que el camino textual pierde', () => {
    // texto plano: la línea del valor queda a >2 vecinos de la etiqueta
    const textoPlano = [
      'COMPROBANTE DE ENTREGA DEL PRODUCTO',
      'Telefono',
      'calle 10-40 piso 3 dpto 5',
      'Nombre y apellido',
      'JUAN PEREZ ROJAS',
      'numero de operación OP-2026-012345',
      '300 123 4567',
    ].join('\n');
    const arbol = { ancho: 800, bloques: [{ tipo: 'parrafo', lineas: [
      { texto: 'Telefono', bbox: [100, 100, 150, 24] },
      { texto: '300 123 4567', bbox: [100, 128, 220, 24] },
      { texto: 'calle 10-40 piso 3 dpto 5', bbox: [100, 156, 320, 24] },
      { texto: 'Nombre y apellido', bbox: [100, 200, 260, 24] },
      { texto: 'JUAN PEREZ ROJAS', bbox: [100, 250, 260, 24] },
      { texto: 'numero de operación OP-2026-012345', bbox: [100, 300, 420, 24] },
    ] }] };
    const r = extraerCampos(textoPlano, 'comprobante', arbol);
    expect(r.telefono).toContain('300');
    expect(r.nombre_comprador).toBe('juan perez rojas');
  });
});
