// Benchmark de motores OCR para detección de ANCLAS del Acta E-14.
// Compara configs (idioma / OEM / PSM / preprocesado) midiendo:
//   - tiempo OCR por página (ms)
//   - recall de anclas (fuzzy, igual que buscarAncla del motor)
//   - score medio de match
// Objetivo: elegir el motor más preciso/liviano/rápido para celulares.
// Uso: bun scripts/benchmark-motores-anclas.ts

import { createWorker, type Worker } from 'tesseract.js';
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const DIR = 'scripts/actas-nuevas';
const IMGS = [
  { doc: 'plantilla', pag: 1, path: `${DIR}/plantilla-nairobi-1.png`, tipo: 'escaneo' },
  { doc: 'plantilla', pag: 2, path: `${DIR}/plantilla-nairobi-2.png`, tipo: 'escaneo' },
  { doc: 'transmision', pag: 1, path: `${DIR}/transmision-barcelona-1.png`, tipo: 'escaneo' },
  { doc: 'transmision', pag: 2, path: `${DIR}/transmision-barcelona-2.png`, tipo: 'escaneo' },
  { doc: 'cairo', pag: 1, path: `${DIR}/foto-cairo-1.png`, tipo: 'foto' },
  { doc: 'cairo', pag: 2, path: `${DIR}/foto-cairo-2.png`, tipo: 'foto' },
];

// Anclas esperadas por página (texto normalizado objetivo, igual que el motor)
const ANCLAS_P1 = [
  'CONSULADO', 'PAIS', 'ZONA', 'PUESTO', 'MESA', 'LUGAR',
  'TOTAL VOTANTES FORMULARIO E11', 'TOTAL VOTOS EN LA URNA', 'TOTAL VOTOS INCINERADOS',
  'IVAN CEPEDA CASTRO', 'ABELARDO DE LA ESPRIELLA',
  'VOTOS EN BLANCO', 'VOTOS NULOS', 'VOTOS NO MARCADOS', 'SUMA TOTAL',
];
const ANCLAS_P2 = [
  'CONSTANCIAS DE LOS JURADOS', 'HUBO RECUENTO',
  'FIRMA JURADO 1', 'FIRMA JURADO 2', 'FIRMA JURADO 3', 'FIRMA JURADO 4',
];

function normTxt(s: string): string {
  return s
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array<number>(n + 1);
  let cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

interface Pal { t: string; x0: number; y0: number; x1: number; y1: number }

/** Busca ancla (misma lógica que buscarAncla del motor, sin rect esperado). */
function buscarAncla(texto: string, pals: Pal[], W: number, H: number): { score: number; rect: [number, number, number, number] } | null {
  const objetivo = normTxt(texto);
  if (!objetivo) return null;
  const objetivoPals = objetivo.split(' ');
  const tol = Math.max(1, Math.floor(objetivo.length * 0.35));
  // líneas por proximidad vertical
  const orden = [...pals].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const lineas: Pal[][] = [];
  for (const p of orden) {
    const l = lineas[lineas.length - 1];
    if (l && Math.abs(p.y0 - l[0].y0) < Math.max(10, (l[0].y1 - l[0].y0) * 0.6)) l.push(p);
    else lineas.push([p]);
  }
  let mejor: { score: number; rect: [number, number, number, number] } | null = null;
  for (const l of lineas) {
    const n = l.length;
    for (let i = 0; i < n; i++) {
      for (let j = i; j < Math.min(n, i + objetivoPals.length + 1); j++) {
        const frase = normTxt(l.slice(i, j + 1).map((p) => p.t).join(' '));
        if (!frase) continue;
        const d = editDistance(objetivo, frase);
        if (d > tol) continue;
        const score = 1 - d / objetivo.length;
        if (!mejor || score > mejor.score) {
          mejor = {
            score,
            rect: [l[i].x0 / W, l[i].y0 / H, (l[j].x1 - l[i].x0) / W, (l[j].y1 - l[i].y0) / H],
          };
        }
      }
    }
  }
  return mejor;
}

interface ConfigOcr {
  id: string;
  lang: string;
  oem: 0 | 1 | 2;
  psm: string;
  prep?: 'otsu';
  escala?: number;
}

const CONFIGS: ConfigOcr[] = [
  { id: 'A spa+eng oem1 psm4 (actual app)', lang: 'spa+eng', oem: 1, psm: '4' },
  { id: 'B spa oem1 psm4', lang: 'spa', oem: 1, psm: '4' },
  { id: 'C eng oem1 psm4', lang: 'eng', oem: 1, psm: '4' },
  { id: 'D spa+eng oem1 psm3', lang: 'spa+eng', oem: 1, psm: '3' },
  { id: 'E spa+eng oem1 psm6', lang: 'spa+eng', oem: 1, psm: '6' },
  { id: 'F spa+eng oem0 legacy', lang: 'spa+eng', oem: 0, psm: '4' },
  { id: 'G spa+eng oem1 psm4 otsu', lang: 'spa+eng', oem: 1, psm: '4', prep: 'otsu' },
  { id: 'H spa+eng oem1 psm4 1200px', lang: 'spa+eng', oem: 1, psm: '4', escala: 1200 },
];

async function prepararImagen(cfg: ConfigOcr, path: string): Promise<{ buf: Buffer; W: number; H: number }> {
  const escala = cfg.escala ?? 1000;
  let img = sharp(path).resize({ width: escala });
  if (cfg.prep === 'otsu') {
    img = img.grayscale();
  }
  const buf = await img.png().toBuffer();
  const meta = await sharp(buf).metadata();
  return { buf, W: meta.width ?? escala, H: meta.height ?? escala };
}

async function ocrPagina(worker: Worker, cfg: ConfigOcr, path: string) {
  const { buf, W, H } = await prepararImagen(cfg, path);
  const t0 = performance.now();
  const { data } = await worker.recognize(buf, {}, { text: true, blocks: true });
  const ms = performance.now() - t0;
  const pals: Pal[] = [];
  const blocks = (data as unknown as { blocks?: unknown[] }).blocks ?? [];
  for (const b of blocks as Array<{ paragraphs?: Array<{ lines?: Array<{ words?: Array<{ text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }> }> }> }>) {
    for (const p of b.paragraphs ?? []) {
      for (const l of p.lines ?? []) {
        for (const w of l.words ?? []) {
          const t = (w.text ?? '').trim();
          if (t) pals.push({ t, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 });
        }
      }
    }
  }
  return { pals, W, H, ms, conf: (data as unknown as { confidence?: number }).confidence ?? 0 };
}

async function main() {
  const resultados: Record<string, {
    tiempoMsTotal: number; tiempoMsPag: number; confMedia: number;
    anclasEsperadas: number; anclasEncontradas: number; recall: number;
    scoreMedio: number; porDoc: Record<string, { found: number; total: number; ms: number }>;
  }> = {};

  for (const cfg of CONFIGS) {
    let worker: Worker | null = null;
    try {
      worker = await createWorker(cfg.lang, cfg.oem, {});
      await worker.setParameters({
        tessedit_pageseg_mode: cfg.psm as never,
        preserve_interword_spaces: '1',
      });
    } catch (e) {
      console.log(`[SKIP] ${cfg.id}: motor no disponible (${(e as Error).message.slice(0, 80)})`);
      continue;
    }
    const filas = {
      tiempoMsTotal: 0, tiempoMsPag: 0, confMedia: 0,
      anclasEsperadas: 0, anclasEncontradas: 0, recall: 0, scoreMedio: 0,
      porDoc: {} as Record<string, { found: number; total: number; ms: number }>,
    };
    let sumaScore = 0;
    let sumaConf = 0;
    for (const img of IMGS) {
      const { pals, W, H, ms, conf } = await ocrPagina(worker, cfg, img.path);
      filas.tiempoMsTotal += ms;
      sumaConf += conf;
      const anclas = img.pag === 1 ? ANCLAS_P1 : ANCLAS_P2;
      filas.anclasEsperadas += anclas.length;
      filas.porDoc[`${img.doc}-p${img.pag}`] = { found: 0, total: anclas.length, ms };
      for (const a of anclas) {
        const hit = buscarAncla(a, pals, W, H);
        if (hit && hit.score >= 0.5) {
          filas.anclasEncontradas++;
          filas.porDoc[`${img.doc}-p${img.pag}`].found++;
          sumaScore += hit.score;
        }
      }
    }
    await worker.terminate();
    filas.tiempoMsPag = Math.round(filas.tiempoMsTotal / IMGS.length);
    filas.confMedia = sumaConf / IMGS.length;
    filas.recall = filas.anclasEncontradas / filas.anclasEsperadas;
    filas.scoreMedio = filas.anclasEncontradas ? sumaScore / filas.anclasEncontradas : 0;
    resultados[cfg.id] = filas;
    console.log(`\n=== ${cfg.id} ===`);
    console.log(`  tiempo: ${Math.round(filas.tiempoMsTotal)}ms total (${filas.tiempoMsPag}ms/pag)  conf: ${filas.confMedia.toFixed(1)}%`);
    console.log(`  anclas: ${filas.anclasEncontradas}/${filas.anclasEsperadas} (recall ${(filas.recall * 100).toFixed(1)}%)  score medio ${filas.scoreMedio.toFixed(3)}`);
    for (const [doc, d] of Object.entries(filas.porDoc)) {
      console.log(`    ${doc}: ${d.found}/${d.total} anclas, ${Math.round(d.ms)}ms`);
    }
  }

  writeFileSync('scripts/benchmark-motores-resultados.json', JSON.stringify(resultados, null, 2));
  console.log('\nResultados guardados en scripts/benchmark-motores-resultados.json');
}

main().catch((e) => { console.error(e); process.exit(1); });
