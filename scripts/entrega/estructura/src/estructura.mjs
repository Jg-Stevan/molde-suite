/**
 * estructura.mjs — Convertidores OCR → árbol de bloques → Markdown/HTML (Agente 2, prueba S).
 *
 * Plan V3 §4: convertir salidas de motores (TSV/hOCR de Tesseract.js, cajas de línea de
 * RapidOCR) en documentos estructurados `.md`/`.html` estilo Chandra OCR, con
 * `data-bbox` opcional para trazabilidad de coordenadas.
 *
 * Reglas del repo respetadas:
 * - JS puro, sin dependencias externas ni APIs de Node → ejecutable igual en el
 *   arnés del navegador (scripts/entrega/bench-ocr) cuando Agent 1 publique ARNÉS-READY.
 * - No transcribe manuscritos ni inventa contenido: solo reorganiza texto leído por OCR.
 *
 * Formato del árbol de bloques ("estructura"):
 * {
 *   tipo: 'pagina', ancho, alto, pag,
 *   bloques: [ { tipo: 'titulo'|'seccion'|'parrafo'|'tabla'|'pie',
 *                bbox: [x, y, w, h],            // píxeles de la imagen
 *                lineas: [ { texto, bbox, palabras?: [ { texto, bbox, conf } ] } ],
 *                celdas?: [ [ { texto, bbox } ] ]  // solo para tipo 'tabla'
 *              } ]
 * }
 */

/** Crea un bbox [x, y, w, h] a partir de un rect de Tesseract [x0, y0, x1, y1]. */
export function rectABbox(x0, y0, x1, y1) {
  return [x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0)];
}

/** Texto de una línea a partir de sus palabras (une con espacios; colapsa espacios). */
function unirPalabras(palabras) {
  return palabras.map((p) => p.texto).join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Convierte el TSV de Tesseract (nivel 1–5, 12 columnas) en estructura.
 * Columnas TSV: level page_num block_num par_num line_num word_num
 *               left top width height conf text.
 */
export function tsvAEstructura(tsv, { ancho, alto, pag = 1 } = {}) {
  const filas = tsv.split(/\r?\n/).filter((l) => l.trim() !== '');
  const bloques = new Map(); // block_num -> bloque provisional
  const orden = [];
  for (const fila of filas) {
    const c = fila.split('\t');
    if (c.length < 12) continue;
    const nivel = Number(c[0]);
    if (nivel !== 2 && nivel !== 4 && nivel !== 5) continue;
    const idBloque = `${c[1]}:${c[2]}`;
    const idPar = `${idBloque}:${c[3]}`;
    const idLinea = `${idPar}:${c[4]}`;
    if (nivel === 2) {
      if (!bloques.has(idBloque)) {
        bloques.set(idBloque, {
          _id: idBloque,
          bbox: rectABbox(Number(c[6]), Number(c[7]), Number(c[6]) + Number(c[8]), Number(c[7]) + Number(c[9])),
          _pars: new Map(),
        });
        orden.push(idBloque);
      }
      continue;
    }
    const bloque = bloques.get(idBloque);
    if (!bloque) continue;
    if (nivel === 4) {
      if (!bloque._pars.has(idPar)) bloque._pars.set(idPar, new Map());
      const par = bloque._pars.get(idPar);
      if (!par.has(idLinea)) {
        par.set(idLinea, {
          bbox: rectABbox(Number(c[6]), Number(c[7]), Number(c[6]) + Number(c[8]), Number(c[7]) + Number(c[9])),
          palabras: [],
        });
      }
      continue;
    }
    // nivel 5: palabra
    const par = bloque._pars.get(idPar);
    const linea = par && par.get(idLinea);
    const texto = c[11] ?? '';
    if (!linea || texto.trim() === '') continue;
    linea.palabras.push({
      texto,
      bbox: rectABbox(Number(c[6]), Number(c[7]), Number(c[6]) + Number(c[8]), Number(c[7]) + Number(c[9])),
      conf: Number(c[10]),
    });
  }
  const bloquesOut = [];
  for (const id of orden) {
    const b = bloques.get(id);
    const paresLineas = [...b._pars.values()].map((m) => [...m.values()]);
    const lineas = paresLineas.flat();
    if (lineas.length === 0) continue;
    for (const linea of lineas) linea.texto = unirPalabras(linea.palabras);
    bloquesOut.push({ bbox: b.bbox, _lineasPorPar: [lineas] });
  }
  const arbol = { tipo: 'pagina', ancho, alto, pag, bloques: bloquesOut };
  return postprocesar(arbol);
}

/**
 * Convierte hOCR de Tesseract en estructura. Parser mínimo (regex) de la
 * jerarquía ocr_page/ocr_carea/ocr_par/ocr_line/ocrx_word con `title="bbox x0 y0 x1 y1"`.
 */
export function hocrAEstructura(hocr, { ancho, alto, pag = 1 } = {}) {
  const bboxDe = (title) => {
    const m = /bbox (\d+(?:\.\d+)?) (\d+(?:\.\d+)?) (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)/.exec(title || '');
    return m ? rectABbox(+m[1], +m[2], +m[3], +m[4]) : null;
  };
  const bloquesOut = [];
  // Cada bloque hOCR: <div class='ocr_carea' ...> que contiene <span class='ocr_par'>...
  const careas = hocr.split(/<div[^>]*class='ocr_carea'/i).slice(1);
  for (const carea of careas) {
    const tituloCarea = carea.slice(0, carea.indexOf('>'));
    const bboxBloque = bboxDe(tituloCarea);
    const pars = carea.split(/<span[^>]*class='ocr_par'/i).slice(1);
    const lineasPorPar = [];
    for (const par of pars) {
      const lineas = [];
      const spansLinea = par.split(/<span[^>]*class='ocr_line'/i).slice(1);
      for (const span of spansLinea) {
        const titulo = span.slice(0, span.indexOf('>'));
        const bbox = bboxDe(titulo);
        const palabras = [];
        const spansPal = span.split(/<span[^>]*class='ocrx_word'/i).slice(1);
        for (const sp of spansPal) {
          const tPal = sp.slice(0, sp.indexOf('>'));
          const fin = sp.indexOf('</span>');
          const crudo = sp.slice(sp.indexOf('>') + 1, fin === -1 ? undefined : fin);
          const texto = decodificarEntidades(crudo).replace(/<[^>]+>/g, '').trim();
          if (texto === '') continue;
          palabras.push({ texto, bbox: bboxDe(tPal), conf: -1 });
        }
        if (palabras.length === 0) continue;
        lineas.push({ bbox, palabras, texto: unirPalabras(palabras) });
      }
      if (lineas.length > 0) lineasPorPar.push(lineas);
    }
    if (lineasPorPar.length > 0) bloquesOut.push({ bbox: bboxBloque, _lineasPorPar: lineasPorPar });
  }
  return postprocesar({ tipo: 'pagina', ancho, alto, pag, bloques: bloquesOut });
}

/**
 * Convierte cajas de línea (formato RapidOCR: lista de { texto, poly|bbox, score })
 * en estructura. Granularidad de LÍNEA: agrupa líneas en bloques por proximidad
 * vertical y solapamiento horizontal.
 * poly puede ser [x0,y0, x1,y1, x2,y2, x3,y3] (4 vértices) o [x, y, w, h].
 */
export function cajasAEstructura(cajas, { ancho, alto, pag = 1 } = {}) {
  const lineas = [];
  for (const caja of cajas) {
    const texto = String(caja.texto || '').trim();
    if (texto === '') continue;
    const poly = caja.poly || caja.polygon || caja.bbox;
    const bbox = polyABbox(poly);
    if (!bbox) continue;
    lineas.push({ texto, bbox, palabras: [], score: caja.score ?? caja.conf ?? -1 });
  }
  lineas.sort((a, b) => (a.bbox[1] - b.bbox[1]) || (a.bbox[0] - b.bbox[0]));
  // Agrupación en bloques: mismo bloque si gap vertical ≤ 1.4×altura y solapa en x.
  const bloquesOut = [];
  let actual = null;
  for (const linea of lineas) {
    if (actual && perteneceAlBloque(actual, linea)) {
      actual._lineasPorPar[0].push(linea);
      expandirBbox(actual, linea.bbox);
    } else {
      actual = { bbox: [...linea.bbox], _lineasPorPar: [[linea]] };
      bloquesOut.push(actual);
    }
  }
  return postprocesar({ tipo: 'pagina', ancho, alto, pag, bloques: bloquesOut });
}

/** poly 4 vértices (plano [[x0,y0,x1,y1,...]] o anidado [[[x,y],[x,y],...]]) | [x,y,w,h] → [x, y, w, h]. */
export function polyABbox(poly) {
  if (!Array.isArray(poly) || poly.length < 4) return null;
  let plano = poly;
  if (Array.isArray(poly[0])) plano = poly.flat(); // lista de puntos anidada (RapidOCR)
  if (plano.length === 4 && typeof plano[2] === 'number' && plano.every((n) => n >= 0)) {
    // Ambigüedad: [x,y,w,h] se asume cuando w/h son positivos y x3/x1 ausentes.
    if (plano.length === 4) return [plano[0], plano[1], plano[2], plano[3]];
  }
  const xs = [], ys = [];
  for (let i = 0; i + 1 < plano.length; i += 2) { xs.push(plano[i]); ys.push(plano[i + 1]); }
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return rectABbox(x0, y0, x1, y1);
}

function perteneceAlBloque(bloque, linea) {
  const ultima = bloque._lineasPorPar[0][bloque._lineasPorPar[0].length - 1];
  const gap = linea.bbox[1] - (ultima.bbox[1] + ultima.bbox[3]);
  const hRef = Math.max(ultima.bbox[3], linea.bbox[3]);
  const xSolapa = linea.bbox[0] < bloque.bbox[0] + bloque.bbox[2] && bloque.bbox[0] < linea.bbox[0] + linea.bbox[2];
  return gap <= hRef * 1.4 && gap > -hRef && (xSolapa || gap < hRef * 0.3);
}

function expandirBbox(bloque, bbox) {
  const x1 = Math.max(bloque.bbox[0] + bloque.bbox[2], bbox[0] + bbox[2]);
  const y1 = Math.max(bloque.bbox[1] + bloque.bbox[3], bbox[1] + bbox[3]);
  bloque.bbox[0] = Math.min(bloque.bbox[0], bbox[0]);
  bloque.bbox[1] = Math.min(bloque.bbox[1], bbox[1]);
  bloque.bbox[2] = x1 - bloque.bbox[0];
  bloque.bbox[3] = y1 - bloque.bbox[1];
}

/** Aplana párrafos, detecta tablas, clasifica bloques y ordena lectura. */
export function postprocesar(arbol) {
  const W = arbol.ancho || 0, H = arbol.alto || 0;
  // 1) aplanar: cada bloque provisional → bloques con líneas planas
  let bloques = [];
  for (const b of arbol.bloques) {
    const pares = b._lineasPorPar || [[{ texto: b.texto, bbox: b.bbox, palabras: b.palabras || [] }]];
    for (const lineas of pares) {
      if (lineas.length === 0) continue;
      const bbox = bboxUnion(lineas.map((l) => l.bbox));
      bloques.push({ bbox, lineas });
    }
  }
  // 2) alturas de línea para heurísticas tipográficas
  const alturas = bloques.flatMap((b) => b.lineas.map((l) => l.bbox[3])).filter((h) => h > 0).sort((a, b) => a - b);
  const alturaMediana = alturas.length ? alturas[Math.floor(alturas.length / 2)] : 0;

  // 3) detectar tablas (grupos de ≥3 líneas con ≥2 columnas estables)
  const marcados = new Set();
  bloques = detectarTablas(bloques, marcados, W);
  fusionarTablas(bloques, marcados);

  // 4) clasificación tipográfica
  for (const b of bloques) {
    if (marcados.has(b)) { b.tipo = 'tabla'; continue; }
    const hMax = Math.max(...b.lineas.map((l) => l.bbox[3] || 0));
    const texto = b.lineas.map((l) => l.texto).join(' ');
    const esCorto = texto.length <= 60;
    const cercaTop = H > 0 && b.bbox[1] < H * 0.22;
    const cercaPie = H > 0 && b.bbox[1] + b.bbox[3] > H * 0.94;
    if (cercaPie && esCorto) b.tipo = 'pie';
    else if (cercaTop && esCorto && esMayusculas(texto) && texto.length <= 45) b.tipo = 'titulo';
    else if (hMax >= alturaMediana * 1.35 && esCorto) b.tipo = 'titulo';
    else if ((hMax >= alturaMediana * 1.15 && esCorto) || (esCorto && esMayusculas(texto) && texto.length <= 45)) b.tipo = 'seccion';
    else b.tipo = 'parrafo';
  }

  // 5) fusionar bloques contiguos del mismo tipo texto (parrafo/seccion) si están cerca
  bloques = fusionarBloquesTexto(bloques, alturaMediana, marcados);

  // 6) orden de lectura: arriba→abajo, y a igual banda de línea, izquierda→derecha
  bloques.sort((a, b) => (a.bbox[1] - b.bbox[1]) / Math.max(1, Math.min(a.bbox[3], b.bbox[3]) * 1.2) || a.bbox[0] - b.bbox[0]);

  arbol.bloques = bloques.map(({ bbox, lineas, tipo, celdas }) =>
    tipo === 'tabla' ? { tipo, bbox, celdas } : { tipo, bbox, lineas: lineas.map(({ texto, bbox: lb, palabras }) => ({ texto, bbox: lb, palabras })) }
  );
  return arbol;
}

function esMayusculas(t) {
  const letras = t.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '');
  return letras.length > 2 && letras === letras.toUpperCase();
}

function bboxUnion(bboxes) {
  const x0 = Math.min(...bboxes.map((b) => b[0]));
  const y0 = Math.min(...bboxes.map((b) => b[1]));
  const x1 = Math.max(...bboxes.map((b) => b[0] + b[2]));
  const y1 = Math.max(...bboxes.map((b) => b[1] + b[3]));
  return rectABbox(x0, y0, x1, y1);
}

/**
 * Fusiona bloques-tabla contiguos (una "fila" detectada por bloque Tesseract)
 * en una sola tabla: solape horizontal fuerte + gap vertical pequeño.
 */
function fusionarTablas(bloques, marcados) {
  const tablas = bloques.filter((b) => marcados.has(b)).sort((a, b) => a.bbox[1] - b.bbox[1]);
  const puedeFusionar = (ult, t) => {
    const gap = t.bbox[1] - (ult.bbox[1] + ult.bbox[3]);
    const solape = Math.min(ult.bbox[0] + ult.bbox[2], t.bbox[0] + t.bbox[2]) - Math.max(ult.bbox[0], t.bbox[0]);
    const anchoMin = Math.min(ult.bbox[2], t.bbox[2]);
    const nColU = (ult.celdas && ult.celdas[0] ? ult.celdas[0].length : 0);
    const nColT = (t.celdas && t.celdas[0] ? t.celdas[0].length : 0);
    return gap <= (ult.bbox[3] + t.bbox[3]) * 1.2 && solape >= anchoMin * 0.6 && (nColU === 0 || nColT === 0 || nColU === nColT);
  };
  const grupos = [];
  for (const t of tablas) {
    const g = grupos[grupos.length - 1];
    if (g && puedeFusionar(g[g.length - 1], t)) g.push(t);
    else grupos.push([t]);
  }
  const eliminar = new Set();
  for (const g of grupos) {
    if (g.length === 1) continue;
    const cabeza = g[0];
    cabeza.celdas = g.flatMap((t) => t.celdas || []);
    cabeza.bbox = bboxUnion(g.map((t) => t.bbox));
    for (const t of g.slice(1)) eliminar.add(t);
  }
  for (let i = bloques.length - 1; i >= 0; i--) {
    if (eliminar.has(bloques[i])) { marcados.delete(bloques[i]); bloques.splice(i, 1); }
  }
}

/**
 * Detección de tablas: ventanas de bloques consecutivos (por y) donde cada
 * bloque tiene ≥2 palabras por línea y ≥3 bloques comparten columnas estables
 * (clustering de centros x por gaps).
 */
function detectarTablas(bloques, marcados, W) {
  const tolCol = Math.max(12, (W || 1000) * 0.015);
  // Candidatos a fila de tabla: TODAS sus líneas tienen ≥2 palabras.
  const candidatos = bloques
    .filter((b) => !marcados.has(b) && b.lineas.length > 0 && b.lineas.every((l) => (l.palabras || []).length >= 2))
    .sort((a, b) => a.bbox[1] - b.bbox[1]);
  const alturaLineas = (b) => Math.max(...b.lineas.map((l) => l.bbox[3] || 0));
  let ventana = [];
  const consumir = () => {
    if (ventana.length >= 3) {
      const centros = [];
      for (const b of ventana) for (const l of b.lineas) for (const p of l.palabras || []) centros.push(p.bbox[0] + p.bbox[2] / 2);
      const cols = cluster1D(centros.sort((a, b) => a - b), tolCol * 2.2);
      if (cols.length >= 2) {
        for (const b of ventana) marcados.add(b);
        construirCeldas(ventana, cols, tolCol);
      }
    }
    ventana = [];
  };
  let yAnt = null, hAnt = null;
  for (const b of candidatos) {
    if (yAnt !== null && b.bbox[1] - yAnt > Math.max(hAnt, alturaLineas(b)) * 2.5) consumir();
    ventana.push(b);
    yAnt = b.bbox[1];
    hAnt = alturaLineas(b);
  }
  consumir();
  return bloques;
}

function alturaTipica(ventana) {
  const hs = ventana.map((v) => v.b.bbox[3]).filter((h) => h > 0);
  return hs.length ? hs.reduce((a, b) => a + b, 0) / hs.length : 20;
}

function cluster1D(valoresOrdenados, gapMin) {
  const clusters = [];
  let actual = [valoresOrdenados[0]];
  for (let i = 1; i < valoresOrdenados.length; i++) {
    if (valoresOrdenados[i] - valoresOrdenados[i - 1] <= gapMin) actual.push(valoresOrdenados[i]);
    else { clusters.push(actual); actual = [valoresOrdenados[i]]; }
  }
  clusters.push(actual);
  return clusters.map((c) => c.reduce((a, b) => a + b, 0) / c.length);
}

function construirCeldas(bloquesVentana, cols, tol) {
  // cada bloque-ventana es una "fila lógica"; puede contener varias líneas
  for (const b of bloquesVentana) {
    const celdas = cols.map(() => []);
    for (const l of b.lineas) {
      for (const p of l.palabras || []) {
        const cx = p.bbox[0] + p.bbox[2] / 2;
        let idx = -1, mejor = Infinity;
        cols.forEach((c, i) => { const d = Math.abs(c - cx); if (d < mejor) { mejor = d; idx = i; } });
        if (idx >= 0 && mejor <= tol * 4) celdas[idx].push(p);
      }
    }
    const fila = celdas.map((palabras) => ({
      texto: palabras.map((p) => p.texto).join(' ').replace(/\s+/g, ' ').trim(),
      bbox: palabras.length ? bboxUnion(palabras.map((p) => p.bbox)) : null,
    }));
    if (fila.some((c) => c.texto !== '')) {
      b.celdas = b.celdas || [];
      b.celdas.push(fila);
    }
  }
}

function fusionarBloquesTexto(bloques, alturaMediana, marcados) {
  const texto = bloques.filter((b) => !marcados.has(b));
  const salida = [];
  for (const b of texto) {
    const prev = salida[salida.length - 1];
    if (
      prev && (prev.tipo === 'parrafo' || prev.tipo === 'seccion') &&
      (b.tipo === 'parrafo' || b.tipo === 'seccion') && prev.tipo === b.tipo
    ) {
      const gap = b.bbox[1] - (prev.bbox[1] + prev.bbox[3]);
      const xSolapa = b.bbox[0] < prev.bbox[0] + prev.bbox[2] && prev.bbox[0] < b.bbox[0] + b.bbox[2];
      if (xSolapa && gap > -alturaMediana && gap < alturaMediana * 1.6) {
        prev.lineas.push(...b.lineas);
        prev.bbox = bboxUnion([prev.bbox, b.bbox]);
        continue;
      }
    }
    salida.push(b);
  }
  // reinsertar tablas en su posición por y
  const tablas = bloques.filter((b) => marcados.has(b));
  const todos = salida.concat(tablas);
  todos.sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
  return todos;
}

function decodificarEntidades(s) {
  const NOMBRADAS = {
    aacute: 'á', Aacute: 'Á', eacute: 'é', Eacute: 'É', iacute: 'í', Iacute: 'Í',
    oacute: 'ó', Oacute: 'Ó', uacute: 'ú', Uacute: 'Ú', uuml: 'ü', Uuml: 'Ü',
    ntilde: 'ñ', Ntilde: 'Ñ', iexcl: '¡', ordm: 'º', deg: '°', mdash: '—', ndash: '–',
    laquo: '«', raquo: '»', middot: '·', nbsp: ' ',
  };
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => NOMBRADAS[name] ?? m)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

/* ------------------------------------------------------------------ */
/* Renderizadores                                                      */
/* ------------------------------------------------------------------ */

/** Escapa HTML básico. */
export function escaparHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Escapa la barra vertical para tablas Markdown. */
function escaparMd(s) { return String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' '); }

/**
 * estructura → Markdown (estilo Chandra: títulos #, párrafos, tablas pipe).
 * op.bboxInline: añade `<!-- bbox:x,y,w,h -->` tras cada bloque (trazabilidad).
 */
export function estructuraAMd(arbol, op = {}) {
  const out = [];
  for (const b of arbol.bloques) {
    const bboxTag = op.bbox ? `<!-- bbox:${b.bbox.join(',')} -->` : '';
    if (b.tipo === 'tabla') {
      const filas = b.celdas || [];
      if (filas.length === 0) continue;
      const nCol = Math.max(...filas.map((f) => f.length));
      const norm = filas.map((f) => {
        const c = f.map((cell) => escaparMd(cell.texto));
        while (c.length < nCol) c.push('');
        return c;
      });
      out.push('', `|${norm[0].map((c) => ` ${c} `).join('|')}|`, '');
      out.push(`|${Array(nCol).fill(' --- ').join('|')}|`);
      for (const fila of norm.slice(1)) out.push(`|${fila.map((c) => ` ${c} `).join('|')}|`);
      out.push('', bboxTag);
      continue;
    }
    const texto = b.lineas.map((l) => l.texto).filter((t) => t !== '').join('\n');
    if (texto === '') continue;
    if (b.tipo === 'titulo') out.push(`# ${texto.replace(/\n/g, ' ')}`, '');
    else if (b.tipo === 'seccion') out.push(`## ${texto.replace(/\n/g, ' ')}`, '');
    else if (b.tipo === 'pie') out.push(`*${texto.replace(/\n/g, ' ')}*`, '');
    else out.push(texto, '');
    if (bboxTag) out.push(bboxTag, '');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/**
 * estructura → HTML semántico con data-bbox en cada bloque (trazabilidad §4.2).
 * Estilo Chandra: <h1/h2>, <p>, <table>/<tr>/<td>, <footer> para pie.
 */
export function estructuraAHtml(arbol, op = {}) {
  const bbox = (b) => (op.bbox === false ? '' : ` data-bbox="${b.bbox.join(',')}"`);
  const partes = [];
  partes.push(`<!doctype html><html lang="es"><head><meta charset="utf-8">`);
  partes.push(`<meta name="viewport" content="width=device-width, initial-scale=1">`);
  partes.push(`<title>OCR página ${arbol.pag ?? 1}</title></head><body>`);
  partes.push(`<article data-pagina="${arbol.pag ?? 1}" data-ancho="${arbol.ancho ?? ''}" data-alto="${arbol.alto ?? ''}">`);
  for (const b of arbol.bloques) {
    if (b.tipo === 'tabla') {
      const filas = b.celdas || [];
      if (filas.length === 0) continue;
      let html = `<table${bbox(b)}>`;
      filas.forEach((fila, i) => {
        html += '<tr>';
        for (const c of fila) html += `<${i === 0 ? 'th' : 'td'}${c.bbox && op.bbox !== false ? ` data-bbox="${c.bbox.join(',')}"` : ''}>${escaparHtml(c.texto)}</${i === 0 ? 'th' : 'td'}>`;
        html += '</tr>';
      });
      html += '</table>';
      partes.push(html);
      continue;
    }
    const texto = b.lineas.map((l) => l.texto).filter((t) => t !== '');
    if (texto.length === 0) continue;
    if (b.tipo === 'titulo') partes.push(`<h1${bbox(b)}>${escaparHtml(texto.join(' '))}</h1>`);
    else if (b.tipo === 'seccion') partes.push(`<h2${bbox(b)}>${escaparHtml(texto.join(' '))}</h2>`);
    else if (b.tipo === 'pie') partes.push(`<footer${bbox(b)}><p>${escaparHtml(texto.join(' '))}</p></footer>`);
    else partes.push(`<p${bbox(b)}>${texto.map((t) => escaparHtml(t)).join('<br>')}</p>`);
  }
  partes.push('</article></body></html>');
  return partes.join('\n');
}
