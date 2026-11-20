// Ronda 2: combinaciones finas + diagnóstico de anclas fallidas en la foto del Cairo.
// Uso: bun scripts/benchmark-motores-r2.ts

import { createWorker, type Worker } from 'tesseract.js';
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const DIR = 'scripts/actas-nuevas';
const IMGS = [
  { doc: 'plantilla', pag: 1, path: `${DIR}/plantilla-nairobi-1.png` },
  { doc: 'plantilla', pag: 2, path: `${DIR}/plantilla-nairobi-2.png` },
  { doc: 'transmision', pag: 1, path: `${DIR}/transmision-barcelona-1.png` },
  { doc: 'transmision', pag: 2, path: `${DIR}/transmision-barcelona-2.png` },
  { doc: 'cairo', pag: 1, path: `${DIR}/foto-cairo-1.png` },
  { doc: 'cairo', pag: 2, path: `${DIR}/foto-cairo-2.png` },
];
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
  return s.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}
function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array<number>(n + 1), cur = new Array<number>(n + 1);
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
function buscarAncla(texto: string, pals: Pal[], W: number, H: number): { score: number; rect: [number, number, number, number] } | null {
  const objetivo = normTxt(texto);
  if (!objetivo) return null;
  const objetivoPals = objetivo.split(' ');
  const tol = Math.max(1, Math.floor(objetivo.length * 0.35));
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
          mejor = { score, rect: [l[i].x0 / W, l[i].y0 / H, (l[j].x1 - l[i].x0) / W, (l[j].y1 - l[i].y0) / H] };
        }
      }
    }
  }
  return mejor;
}

const CONFIGS = [
  { id: 'I spa oem1 psm3', lang: 'spa', oem: 1 as const, psm: '3' },
  { id: 'J spa oem1 psm4 1200px', lang: 'spa', oem: 1 as const, psm: '4', escala: 1200 },
  { id: 'K spa oem1 psm3 1200px', lang: 'spa', oem: 1 as const, psm: '3', escala: 1200 },
];

async function ocrPagina(worker: Worker, path: string, escala: number) {
  const buf = await sharp(path).resize({ width: escala }).png().toBuffer();
  const meta = await sharp(buf).metadata();
  const W = meta.width ?? escala, H = meta.height ?? escala;
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
  return { pals, W, H, ms };
}

async function main() {
  const out: Record<string, { msPag: number; recall: number; fallidas: Record<string, string[]> }> = {};
  for (const cfg of CONFIGS) {
    const worker = await createWorker(cfg.lang, cfg.oem, {});
    await worker.setParameters({ tessedit_pageseg_mode: cfg.psm as never, preserve_interword_spaces: '1' });
    let total = 0, esperadas = 0, encontradas = 0;
    const fallidas: Record<string, string[]> = {};
    for (const img of IMGS) {
      const { pals, W, H, ms } = await ocrPagina(worker, img.path, cfg.escala ?? 1000);
      total += ms;
      const anclas = img.pag === 1 ? ANCLAS_P1 : ANCLAS_P2;
      esperadas += anclas.length;
      const misses: string[] = [];
      for (const a of anclas) {
        const hit = buscarAncla(a, pals, W, H);
        if (hit && hit.score >= 0.5) encontradas++;
        else misses.push(a);
      }
      if (misses.length) fallidas[`${img.doc}-p${img.pag}`] = misses;
    }
    await worker.terminate();
    out[cfg.id] = { msPag: Math.round(total / IMGS.length), recall: encontradas / esperadas, fallidas };
    console.log(`\n=== ${cfg.id} ===  ${out[cfg.id].msPag}ms/pag  recall ${(out[cfg.id].recall * 100).toFixed(1)}%`);
    for (const [doc, misses] of Object.entries(fallidas)) console.log(`  ${doc}: FALTAN ${misses.join(' | ')}`);
  }
  writeFileSync('scripts/benchmark-motores-r2.json', JSON.stringify(out, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
