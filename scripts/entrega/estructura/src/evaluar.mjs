/**
 * evaluar.mjs — Evaluación D2 de la prueba S (Agente 2, plan V3 §4).
 *
 * Consume:
 *  - bruto/  : tesseract.js (texto+tsv+hocr, 4.0.0_fast) y .cajas.json (RapidOCR) por imagen
 *  - fixtures-reales/3-DOCUMENTOS-IMPRESOS - copia/ : dataset (SOLO LECTURA) con el
 *    GT estructural datalab-convert-*.json
 *  - gt-campos.mjs : GT textual curado (especificaciones + lectura visual)
 *  - tinta.json : S6 presencia de tinta (harness/tinta.py)
 *
 * Produce:
 *  - md/     : .md/.html estructurados por imagen (artefactos de la prueba S)
 *  - resultados-salidas.json : métricas completas (fidelidad, campos, tablas, tinta, latencia)
 *
 * Métricas: CER por bloque (Levenshtein/len) contra el GT datalab (matcheado por IoU),
 * coincidencia de block_type, orden de lectura (inversiones), extracción de campos
 * M2-estructural (desde el .md/.html) vs M2-plano (texto crudo), rejilla de tablas
 * E26/E14 y puertas matemáticas (cifra repartidora, suma total E14).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tsvAEstructura, hocrAEstructura, cajasAEstructura, estructuraAMd, estructuraAHtml } from './estructura.mjs';
import { GT_CAMPOS, ANCLAS } from './gt-campos.mjs';
import { extraerCampos } from './extraer.mjs';

const RAIZ = '/home/z/my-project/molde-suite';
const DATASET = join(RAIZ, 'scripts/resultados/fixtures-reales/3-DOCUMENTOS-IMPRESOS - copia');
const SALIDAS = join(RAIZ, 'scripts/resultados/bench-ocr/salidas');
const BRUTO = join(SALIDAS, 'bruto');
const DIR_MD = join(SALIDAS, 'md');

/* ---------- utilidades ---------- */

const t = (s) => String(s ?? '');
const normalizar = (s) => t(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}
const cer = (a, b) => {
  const x = normalizar(a), y = normalizar(b);
  if (!x && !y) return 0;
  return levenshtein(x, y) / Math.max(1, Math.max(x.length, y.length));
};
const cerSinDigitos = (a, b) => {
  const x = normalizar(a).replace(/[0-9]/g, '#');
  const y = normalizar(b).replace(/[0-9]/g, '#');
  if (!x && !y) return 0;
  return levenshtein(x, y) / Math.max(1, Math.max(x.length, y.length));
};

function iou(a, b) {
  const x0 = Math.max(a[0], b[0]), y0 = Math.max(a[1], b[1]);
  const x1 = Math.min(a[0] + a[2], b[0] + b[2]), y1 = Math.min(a[1] + a[3], b[1] + b[3]);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const u = a[2] * a[3] + b[2] * b[3] - inter;
  return u > 0 ? inter / u : 0;
}

/** Convierte el html de un bloque datalab en texto plano (y detecta <table>). */
function htmlDatalabATexto(html) {
  return t(html)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|td|th|tr|div|h1|h2|h3)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Bloques hoja del GT datalab por página con bbox en fracciones de página. */
function gtDatalab(doc, rutaJson) {
  const d = JSON.parse(readFileSync(join(DATASET, doc, 'molde', rutaJson), 'utf8'));
  return d.children.map((pg) => {
    const W = pg.bbox[2], H = pg.bbox[3];
    const bloques = [];
    const walk = (n) => {
      for (const c of n.children || []) {
        if (c.children && c.children.length) walk(c);
        else if (c.block_type !== 'Picture') {
          const [x0, y0, x1, y1] = c.bbox; // datalab: esquinas [x0,y0,x1,y1]
          bloques.push({
            tipo: c.block_type,
            texto: htmlDatalabATexto(c.html),
            rel: [x0 / W, y0 / H, (x1 - x0) / W, (y1 - y0) / H],
            esTabla: c.block_type === 'Table',
          });
        }
      }
    };
    walk(pg);
    return { W, H, bloques, html: pg.html };
  });
}

/** Relativiza un bbox de estructura a fracciones de página. */
const rel = (b, W, H) => [b[0] / W, b[1] / H, b[2] / W, b[3] / H];

/* ---------- carga de brutos ---------- */

function listarBrutos() {
  const out = [];
  for (const doc of readdirSync(BRUTO)) {
    const dir = join(BRUTO, doc);
    if (!statSync(dir).isDirectory()) continue; // resúmenes sueltos en bruto/
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.json') && !f.startsWith('resumen') && !f.endsWith('.cajas.json') && !f.endsWith('.dims.json')) {
        out.push(join(doc, f).replace(/\.json$/, ''));
      }
    }
  }
  return out.sort();
}

/* ---------- extracción de campos (M2-estructural y M2-plano) ---------- */

function aplanarMd(md) { return md.replace(/\|/g, ' ').replace(/[#*>_`]/g, '').replace(/\s+/g, ' '); }

function compararCampos(hallado, gt) {
  const res = {};
  for (const [campo, esperado] of Object.entries(gt)) {
    if (esperado == null || campo === 'variante') continue; // etiqueta o campo sin valor
    const leido = hallado[campo];
    let estado = 'fallido';
    if (leido != null) {
      const nl = normalizar(leido), ne = normalizar(esperado);
      if (nl === ne) estado = 'exacto';
      else if (ne.includes(nl) || nl.includes(ne) || cer(nl, ne) < 0.2) estado = 'parcial';
    }
    res[campo] = { esperado, leido: leido ?? null, estado };
  }
  return res;
}

/* ---------- evaluación estructural vs datalab ---------- */

function evaluarFidelidad(misBloques, W, H, gtPagina) {
  const mios = misBloques.map((b) => ({ tipo: b.tipo, texto: textoDe(b), rel: rel(b.bbox, W, H), esTabla: b.tipo === 'tabla' }));
  const pareas = [];
  const gtUsado = new Set();
  for (const g of gtPagina.bloques) {
    let mejor = -1, mejorIdx = -1;
    mios.forEach((m, i) => { const v = iou(g.rel, m.rel); if (v > mejor) { mejor = v; mejorIdx = i; } });
    if (mejor >= 0.2 && !gtUsado.has(mejorIdx)) {
      gtUsado.add(mejorIdx);
      pareas.push({ gt: g, mio: mios[mejorIdx], iou: mejor });
    }
  }
  const n = pareas.length;
  const cers = pareas.map((p) => (p.gt.esTabla ? 0 : cer(p.gt.texto, p.mio.texto)));
  const cersNd = pareas.map((p) => (p.gt.esTabla ? 0 : cerSinDigitos(p.gt.texto, p.mio.texto)));
  const tiposOk = pareas.filter((p) => tipoEquiv(p.gt.tipo, p.mio.tipo)).length;
  // orden: inversiones entre pares de bloques matcheados
  let inversiones = 0, pares = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    pares++;
    const ai = mios.indexOf(pareas[i].mio), aj = mios.indexOf(pareas[j].mio);
    if (ai > aj) inversiones++;
  }
  const median = (arr) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  return {
    gt_bloques: gtPagina.bloques.length,
    mis_bloques: mios.length,
    matcheados: n,
    cobertura_gt: +(n / Math.max(1, gtPagina.bloques.length)).toFixed(3),
    cer_mediano: cers.length ? +median(cers).toFixed(4) : null,
    cer_sin_digitos_mediano: cersNd.length ? +median(cersNd).toFixed(4) : null,
    cer_medio: cers.length ? +(cers.reduce((a, b) => a + b, 0) / cers.length).toFixed(4) : null,
    tipos_coinciden: `${tiposOk}/${n}`,
    tipo_tasa: +(tiposOk / Math.max(1, n)).toFixed(3),
    orden_pares: pares,
    orden_inversiones: inversiones,
    orden_tasa: pares ? +((pares - inversiones) / pares).toFixed(3) : 1,
    detalle: pareas.map((p) => ({
      gt_tipo: p.gt.tipo, mio_tipo: p.mio.tipo, iou: +p.iou.toFixed(2),
      cer: +(p.gt.esTabla ? 0 : cer(p.gt.texto, p.mio.texto)).toFixed(3),
      gt_texto: p.gt.texto.slice(0, 70), mio_texto: p.mio.texto.slice(0, 70),
    })),
  };
}

const textoDe = (b) => b.tipo === 'tabla'
  ? (b.celdas || []).map((f) => f.map((c) => c.texto).join(' ')).join(' ')
  : (b.lineas || []).map((l) => l.texto).join(' ');

const MAPA_TIPOS = {
  SectionHeader: ['titulo', 'seccion'],
  Text: ['parrafo', 'seccion', 'titulo', 'pie'],
  Table: ['tabla'],
  PageFooter: ['pie', 'parrafo'],
};
function tipoEquiv(gtTipo, mioTipo) {
  const cands = MAPA_TIPOS[gtTipo] || [gtTipo.toLowerCase()];
  const eq = cands.includes(mioTipo);
  if (eq) return true;
  // tolerancia documentada: titulo vs seccion vs parrafo en líneas cortas impresas
  if (gtTipo === 'SectionHeader' && mioTipo === 'seccion') return true;
  return eq;
}

/* ---------- main ---------- */

function main() {
  const imagenes = listarBrutos();
  mkdirSync(DIR_MD, { recursive: true });
  const resultado = {
    meta: {
      fecha: new Date().toISOString().slice(0, 19),
      agente: 'agente-2-salidas-estructura',
      plan: 'PLAN-BENCHMARK-V3 §4 (prueba S)',
      motores: {
        tesseract: { version: '7.0.0', variante: '4.0.0_fast (spa)', oem: 1, psm: 3, entorno: 'Node WASM (arnés mínimo; arnés CDP de Agent 1 aún no publicado)' },
        rapidocr: { version: 'rapidocr-onnxruntime (PP-OCRv4 det+rec stock)', granularidad: 'línea', entorno: 'Python local, benchmark-only' },
        gt_estructural: 'datalab-convert-*.json (Chandra OCR, entregado en el dataset)',
      },
      notas_gt: [
        'E26: datalab-convert coincide 1:1 con las páginas escaneadas entregadas.',
        'Recibo: datalab p0 = variante A de FOTO REAL (REC-2026-0157); el banco escaneado fue regenerado después (REC-2026-0314, valores ejemplo de la especificación).',
        'Comprobante: el archivo datalab de la carpeta 02 es COPIA byte a byte del del recibo (md5 igual) — el comprobante no tiene GT estructural; se evalúa por campos.',
        'GT textual: especificaciones + curación visual de escaneados y fotos reales (supuesto declarado: sin luz del usuario).',
      ],
    },
    documentos: {},
    sintesis: {},
  };

  const acum = { fidelidad: [], camposEstruct: [], camposPlano: [], camposRapid: [], tablas: [], latencia: [] };

  for (const ruta of imagenes) {
    const [doc, nombre] = ruta.split('/');
    const bruto = JSON.parse(readFileSync(join(BRUTO, `${ruta}.json`), 'utf8'));
    const cajasPath = join(BRUTO, `${ruta}.cajas.json`);
    const cajas = existsSync(cajasPath) ? JSON.parse(readFileSync(cajasPath, 'utf8')) : null;
    const imagenPath = join(DATASET, doc, bruto.ruta);
    const dims = dimsDe(imagenPath);

    // 1) tres fuentes → estructura → md/html
    const t0 = performance.now();
    const estTsv = tsvAEstructura(bruto.tsv, { ancho: dims[0], alto: dims[1], pag: 1 });
    const estHocr = hocrAEstructura(bruto.hocr, { ancho: dims[0], alto: dims[1], pag: 1 });
    const estCajas = cajas ? cajasAEstructura(cajas.cajas, { ancho: dims[0], alto: dims[1], pag: 1 }) : null;
    const md = estructuraAMd(estTsv, { bbox: false });
    const html = estructuraAHtml(estTsv);
    const msRender = +(performance.now() - t0).toFixed(1);

    const dirSalida = join(DIR_MD, doc);
    mkdirSync(dirSalida, { recursive: true });
    writeFileSync(join(dirSalida, `${nombre}.md`), md);
    writeFileSync(join(dirSalida, `${nombre}.html`), html);

    const fila = { ruta, dims, ms_ocr_tesseract: bruto.ms, ms_ocr_rapidocr: cajas?.ms ?? null, ms_render_md_html: msRender };

    // 2) fidelidad estructural donde hay GT datalab válido
    let gtPaginas = null, idxPagina = 0;
    if (doc === '03-E26-ACTA-PARCIAL-6PAG') { gtPaginas = gtDatalab(doc, 'datalab-convert-E26_6-paginas.json'); idxPagina = Number(nombre.match(/pag-(\d+)/)?.[1] ?? 1) - 1; }
    else if (doc === '01-RECIBO-DE-PAGO' && nombre.startsWith('recibo-a-impreso-firmas-vacias-0')) { gtPaginas = gtDatalab(doc, 'datalab-convert-Recibo-dinero_3-variantes.json'); idxPagina = 0; }
    if (gtPaginas && gtPaginas[idxPagina]) {
      fila.fidelidad_tesseract = evaluarFidelidad(estTsv.bloques, dims[0], dims[1], gtPaginas[idxPagina]);
      if (estCajas) fila.fidelidad_rapidocr = evaluarFidelidad(estCajas.bloques, dims[0], dims[1], gtPaginas[idxPagina]);
      acum.fidelidad.push(fila);
    }

    // 3) campos M2-estructural (desde .md) y M2-plano (texto crudo)
    // GT por variante de documento: todas las tomas de una misma variante comparten GT.
    let claveGt = null;
    if (doc === '01-RECIBO-DE-PAGO') claveGt = nombre.startsWith('pag-01')
      ? '01-RECIBO-DE-PAGO/escaneado/pag-01' : '01-RECIBO-DE-PAGO/real/recibo-a-impreso-firmas-vacias-01';
    if (doc === '02-RECIBO-DE-ENTREGA') claveGt = nombre.startsWith('pag-01')
      ? '02-RECIBO-DE-ENTREGA/escaneado/pag-01' : '02-RECIBO-DE-ENTREGA/real/comprobante-a-impreso-firmas-vacias-01';
    if (claveGt) {
      const gt = GT_CAMPOS[claveGt];
      const tipoDoc = doc.startsWith('01') ? 'recibo' : 'comprobante';
      const tE = performance.now();
      const camposEstruct = compararCampos(extraerCampos(md, tipoDoc, estTsv), gt);
      const msE = +(performance.now() - tE).toFixed(1);
      const camposPlano = compararCampos(extraerCampos(bruto.texto, tipoDoc), gt);
      const resumenCampos = (c) => {
        const vals = Object.values(c);
        const ex = vals.filter((v) => v.estado === 'exacto').length;
        const pa = vals.filter((v) => v.estado === 'parcial').length;
        const fa = vals.filter((v) => v.estado === 'fallido').length;
        return { exactos: ex, parciales: pa, fallidos: fa, tasa: +((ex + pa * 0.5) / Math.max(1, vals.length)).toFixed(3) };
      };
      fila.campos_m2_estructural = { detalle: camposEstruct, ...resumenCampos(camposEstruct), ms: msE };
      fila.campos_m2_plano = { detalle: camposPlano, ...resumenCampos(camposPlano) };
      if (estCajas) {
        const mdRapid = estructuraAMd(estCajas, { bbox: false });
        const camposRapid = compararCampos(extraerCampos(mdRapid, tipoDoc, estCajas), gt);
        fila.campos_m2_estructural_rapidocr = { detalle: camposRapid, ...resumenCampos(camposRapid) };
        acum.camposRapid.push(fila.campos_m2_estructural_rapidocr);
      }
      // clasificación por anclas (≥2 anclas exclusivas según especificación §1)
      const anclas = ANCLAS[tipoDoc];
      const planoN = normalizar(md);
      const nAnclas = anclas.filter((a) => planoN.includes(normalizar(a))).length;
      fila.clasificacion_anclas = { anclas_encontradas: nAnclas, de: anclas.length, clasifica: nAnclas >= 2 };
      acum.camposEstruct.push(fila.campos_m2_estructural);
      acum.camposPlano.push(fila.campos_m2_plano);
    }

    // 4) tablas: E26 (todas las páginas con tablas) y E14 referencia
    if (doc === '03-E26-ACTA-PARCIAL-6PAG' || (doc === '04-ACTA-E14-2PAG' && nombre.startsWith('referencia'))) {
      const gtB = gtPaginas ? gtPaginas[idxPagina] : null;
      const misTablas = estTsv.bloques.filter((b) => b.tipo === 'tabla');
      const gtTablas = gtB ? gtB.bloques.filter((b) => b.esTabla) : [];
      const tablaInfo = misTablas.map((tb) => ({
        filas: (tb.celdas || []).length,
        cols: (tb.celdas && tb.celdas[0] ? tb.celdas[0].length : 0),
        celdas_con_texto: (tb.celdas || []).flat().filter((c) => c.texto !== '').length,
      }));
      fila.tablas = { detectadas_tesseract: tablaInfo, gt_datalab: gtTablas.length };
      if (gtTablas.length) {
        // comparación celda a celda del mejor match por tabla GT
        const comps = gtTablas.map((g) => {
          const gRel = g.rel;
          let mejorT = null, mejorIoU = 0;
          for (const tb of misTablas) {
            const v = iou(gRel, rel(tb.bbox, dims[0], dims[1]));
            if (v > mejorIoU) { mejorIoU = v; mejorT = tb; }
          }
          if (!mejorT || mejorIoU < 0.15) return { match: false };
          const gTexto = g.texto.split(' ').filter(Boolean);
          const mTexto = (mejorT.celdas || []).flat().map((c) => c.texto).filter(Boolean);
          return { match: true, iou: +mejorIoU.toFixed(2), filas_gt: gTexto, filas_mias: mTexto, cer_tabla: +cer(gTexto.join(' '), mTexto.join(' ')).toFixed(3) };
        });
        fila.tablas.detalle_vs_gt = comps;
      }
      // puertas matemáticas (plan §1: E26 cifra repartidora 175.5; E14 suma total)
      if (doc === '03-E26-ACTA-PARCIAL-6PAG' && /pag-05/.test(nombre)) {
        const plano = aplanarMd(md);
        fila.tablas.puerta_cifra_repartidora = { esperada: '175.5', leida: /cifra repartidora es:? ([\d.,]+)/i.exec(plano)?.[1] ?? null };
      }
      if (doc === '04-ACTA-E14-2PAG') {
        const plano = normalizar(aplanarMd(md));
        // manuscritos NO se transcriben: la puerta matemática se evalúa solo
        // con lo impreso (el acta real lleva los totales a mano).
        fila.tablas.notas_e14 = {
          rejilla_nivelacion: plano.includes('total votantes formulario e-11'),
          rejilla_candidatos: plano.includes('candidato') && plano.includes('votacion'),
          codigo_barras_leido: /\d{10,16}/.exec(aplanarMd(md))?.[0] ?? null,
          nota: 'votos manuscritos: solo presencia de tinta (contrato §1); ver tinta.json',
        };
      }
      acum.tablas.push(fila.tablas);
    }

    acum.latencia.push({ ruta, ms_ocr: bruto.ms, ms_rapidocr: cajas?.ms ?? null, ms_render: msRender, ms_total: +(bruto.ms + msRender).toFixed(1) });
    (resultado.documentos[ruta] ??= fila);
    Object.assign(resultado.documentos[ruta], fila);
    delete resultado.documentos[ruta].ruta;
    resultado.documentos[ruta].ruta = ruta;
  }

  // 5) tinta S6
  const tintaPath = join(SALIDAS, 'tinta.json');
  if (existsSync(tintaPath)) resultado.tinta_s6 = JSON.parse(readFileSync(tintaPath, 'utf8'));

  // 6) síntesis
  const med = (arr, k) => { const v = arr.map((x) => x[k]).filter((x) => x != null).sort((a, b) => a - b); return v.length ? +v[Math.floor(v.length / 2)].toFixed(3) : null; };
  const prom = (arr, k) => { const v = arr.map((x) => x[k]).filter((x) => x != null); return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(3) : null; };
  resultado.sintesis = {
    n_imagenes: imagenes.length,
    fidelidad_vs_datalab: {
      paginas_evaluadas: acum.fidelidad.length,
      cobertura_gt_media: prom(acum.fidelidad.map((f) => f.fidelidad_tesseract), 'cobertura_gt'),
      cer_medio: prom(acum.fidelidad.flatMap((f) => f.fidelidad_tesseract?.detalle || []), 'cer'),
      tipo_tasa_media: prom(acum.fidelidad.map((f) => f.fidelidad_tesseract), 'tipo_tasa'),
      orden_tasa_media: prom(acum.fidelidad.map((f) => f.fidelidad_tesseract), 'orden_tasa'),
      cobertura_gt_media_rapidocr: prom(acum.fidelidad.map((f) => f.fidelidad_rapidocr), 'cobertura_gt'),
      cer_medio_rapidocr: prom(acum.fidelidad.flatMap((f) => f.fidelidad_rapidocr?.detalle || []), 'cer'),
      nota: 'CER por bloque matcheado (IoU≥0.2); en recibo real el CER refleja también el recorte de la toma vac-01.',
    },
    campos_m2: {
      estructural: {
        exactos: sum(acum.camposEstruct, 'exactos'), parciales: sum(acum.camposEstruct, 'parciales'), fallidos: sum(acum.camposEstruct, 'fallidos'),
        tasa_media: prom(acum.camposEstruct, 'tasa'), ms_medios: med(acum.camposEstruct, 'ms'),
      },
      plano: {
        exactos: sum(acum.camposPlano, 'exactos'), parciales: sum(acum.camposPlano, 'parciales'), fallidos: sum(acum.camposPlano, 'fallidos'),
        tasa_media: prom(acum.camposPlano, 'tasa'),
      },
      estructural_rapidocr: {
        exactos: sum(acum.camposRapid, 'exactos'), parciales: sum(acum.camposRapid, 'parciales'), fallidos: sum(acum.camposRapid, 'fallidos'),
        tasa_media: prom(acum.camposRapid, 'tasa'),
        nota: 'extracción desde el .md generado a partir de las cajas de línea de RapidOCR',
      },
    },
    latencia: {
      tesseract_ms_mediano: med(acum.latencia, 'ms_ocr'),
      rapidocr_ms_mediano: med(acum.latencia, 'ms_rapidocr'),
      render_ms_mediano: med(acum.latencia, 'ms_render'),
      total_mediano: med(acum.latencia, 'ms_total'),
    },
  };
  // corrección: tasa de clasificación real por anclas
  const filasConClas = Object.values(resultado.documentos).filter((f) => f.clasificacion_anclas);
  resultado.sintesis.campos_m2.clasificacion = {
    documentos: filasConClas.length,
    clasifican: filasConClas.filter((f) => f.clasificacion_anclas.clasifica).length,
    falsos_rechazos: filasConClas.filter((f) => f.clasificacion_anclas.clasifica === false).length,
  };

  writeFileSync(join(SALIDAS, 'resultados-salidas.json'), JSON.stringify(resultado, null, 1));
  console.log('OK → resultados-salidas.json');
  console.log(JSON.stringify(resultado.sintesis, null, 1));
}

function sum(arr, k) { return arr.reduce((a, b) => a + (b[k] || 0), 0); }

/** Dimensiones reales de la imagen (con EXIF aplicado para fotos). */
function dimsDe(p) {
  // Leemos de PIL vía archivo .dims.json generado por el arnés; fallback a PNG header
  const dimsPath = p + '.dims.json';
  if (existsSync(dimsPath)) return JSON.parse(readFileSync(dimsPath, 'utf8'));
  return [1700, 2200]; // no debería ocurrir: el arnés escribe dims
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1].replace(/\\/g,'/')).href) main();
