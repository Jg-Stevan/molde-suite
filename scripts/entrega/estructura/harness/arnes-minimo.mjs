/**
 * arnes-minimo.mjs — Arnés OCR mínimo del Agente 2 (prueba S, plan V3 §4/§5).
 *
 * Contexto: el plan §5 prevé usar el arnés del Agente 1 (bench-ocr, CDP crudo).
 * Al momento de sincronizar, `bench/agente-1-arnes-motores` solo contiene la fase
 * A1 (investigación) — no hay ARNÉS-READY —, así que la prueba S corre sobre este
 * arnés mínimo: MISMO motor que producción (tesseract.js 7, traineddata
 * `4.0.0_fast` spa, WASM) pero en Node en vez de Chrome/CDP. Los convertidores
 * (src/estructura.mjs) son JS puro y se enganchan al arnés del navegador sin cambios.
 *
 * Salida por imagen: scripts/resultados/bench-ocr/salidas/bruto/<doc>/<img>.json
 *   { texto, tsv, hocr, ms, heapDeltaMB, motor, variante, psm, ruta }
 * El dataset vive en scripts/resultados/fixtures-reales/ (gitignored, NUNCA al repo).
 *
 * Uso:  node harness/arnes-minimo.mjs [--subset recibo-escaneado] [--best]
 */
import { createWorker } from 'tesseract.js';
import { mkdirSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import process from 'node:process';

const RAIZ_DATASET = '/home/z/my-project/molde-suite/scripts/resultados/fixtures-reales/3-DOCUMENTOS-IMPRESOS - copia';
const SALIDA = '/home/z/my-project/molde-suite/scripts/resultados/bench-ocr/salidas/bruto';
const VARIANTE = process.argv.includes('--best') ? '4.0.0_best' : '4.0.0_fast';
const LANG = VARIANTE === '4.0.0_best' ? 'spa' : 'spa';
const LANGPATH = VARIANTE === '4.0.0_best'
  ? 'https://tessdata.projectnaptha.com/4.0.0_best'
  : 'https://tessdata.projectnaptha.com/4.0.0';

// Subconjuntos por nombre de carpeta; por defecto TODO el dataset.
const SUBSETS = {
  'recibo-escaneado': ['01-RECIBO-DE-PAGO/escaneado'],
  'e26-p1': ['03-E26-ACTA-PARCIAL-6PAG/escaneado/pag-01.png'],
};

function imagenesDelDataset(subset) {
  const carpetas = (subset && SUBSETS[subset]
    ? SUBSETS[subset].map((c) => join(RAIZ_DATASET, c))
    : readdirSync(RAIZ_DATASET).map((d) => join(RAIZ_DATASET, d))
  ).filter((p) => existsSync(p) && (statSync(p).isDirectory() || /\.(png|jpe?g)$/i.test(p)));
  const out = [];
  for (const carpeta of carpetas) {
    if (basename(carpeta).startsWith('.')) continue;
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(dir, e.name));
        else if (/\.(png|jpe?g)$/i.test(e.name)) out.push(join(dir, e.name));
      }
    };
    if (/\.(png|jpe?g)$/i.test(carpeta)) { out.push(carpeta); continue; }
    if (existsSync(carpeta)) walk(carpeta);
  }
  return out.sort();
}

async function main() {
  const idxSubset = process.argv.indexOf('--subset');
  const subset = idxSubset >= 0 ? process.argv[idxSubset + 1] : null;
  const imagenes = imagenesDelDataset(subset);
  if (imagenes.length === 0) { console.error('Sin imágenes para', subset); process.exit(1); }
  mkdirSync(SALIDA, { recursive: true });

  console.log(`Arnés mínimo · motor=tesseract.js variante=${VARIANTE} · ${imagenes.length} imágenes`);
  const worker = await createWorker(LANG, 1, { langPath: LANGPATH });
  await worker.setParameters({ tessedit_pageseg_mode: '3' });

  const resumen = [];
  for (const ruta of imagenes) {
    const rel = ruta.slice(RAIZ_DATASET.length + 1);
    const doc = rel.split('/')[0];
    const nombre = basename(rel).replace(/\.[^.]+$/, '');
    const dirSalida = join(SALIDA, doc);
    mkdirSync(dirSalida, { recursive: true });
    const destino = join(dirSalida, `${nombre}.json`);
    if (existsSync(destino)) { console.log('  ↷ ya existe', destino); continue; }

    const t0 = performance.now();
    const heap0 = process.memoryUsage().heapUsed;
    const { data } = await worker.recognize(ruta, {}, { text: true, tsv: true, hocr: true });
    const ms = Math.round(performance.now() - t0);
    const heapDelta = Math.round((process.memoryUsage().heapUsed - heap0) / 1048576 * 10) / 10;

    writeFileSync(destino, JSON.stringify({
      ruta: rel, motor: 'tesseract.js', variante: VARIANTE, psm: 3, oem: 1,
      ms, heapDeltaMB: heapDelta, texto: data.text, tsv: data.tsv, hocr: data.hocr,
    }));
    resumen.push({ ruta: rel, ms, heapDeltaMB: heapDelta });
    console.log(`  ✓ ${rel} · ${ms} ms · +${heapDelta} MB heap`);
  }
  await worker.terminate();
  const archivoResumen = join(SALIDA, `resumen-arnes-${VARIANTE}${subset ? '-' + subset : ''}.json`);
  writeFileSync(archivoResumen, JSON.stringify({ motor: 'tesseract.js', variante: VARIANTE, corridas: resumen }, null, 2));
  console.log('Resumen →', archivoResumen);
}

main().catch((e) => { console.error(e); process.exit(1); });
