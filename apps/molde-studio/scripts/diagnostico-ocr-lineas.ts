// Diagnóstico: qué lee el OCR exactamente en las líneas donde fallan las anclas.
// Uso: bun scripts/diagnostico-ocr-lineas.ts

import { createWorker } from 'tesseract.js';
import sharp from 'sharp';

const CASOS = [
  { path: 'scripts/actas-nuevas/foto-cairo-1.png', lang: 'spa', psm: '4', zona: [0.0, 0.28, 1.0, 1.0], etiqueta: 'CAIRO-P1 (spa psm4 1000px) — mitad inferior' },
  { path: 'scripts/actas-nuevas/transmision-barcelona-1.png', lang: 'spa', psm: '4', zona: [0.0, 0.28, 1.0, 0.36], etiqueta: 'TRANSMISION-P1 — banda NIVELACION' },
];

interface Pal { t: string; x0: number; y0: number; x1: number; y1: number }

async function main() {
  for (const caso of CASOS) {
    const buf = await sharp(caso.path).resize({ width: 1000 }).png().toBuffer();
    const meta = await sharp(buf).metadata();
    const W = meta.width ?? 1000, H = meta.height ?? 1000;
    const worker = await createWorker(caso.lang, 1, {});
    await worker.setParameters({ tessedit_pageseg_mode: caso.psm as never, preserve_interword_spaces: '1' });
    const { data } = await worker.recognize(buf, {}, { text: true, blocks: true });
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
    await worker.terminate();
    // líneas
    const orden = [...pals].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
    const lineas: Pal[][] = [];
    for (const p of orden) {
      const l = lineas[lineas.length - 1];
      if (l && Math.abs(p.y0 - l[0].y0) < Math.max(10, (l[0].y1 - l[0].y0) * 0.6)) l.push(p);
      else lineas.push([p]);
    }
    console.log(`\n##### ${caso.etiqueta} (${W}x${H}) #####`);
    for (const l of lineas) {
      const y0n = l[0].y0 / H;
      if (y0n < caso.zona[1] || y0n > caso.zona[1] + caso.zona[3]) continue;
      const txt = l.map((p) => p.t).join(' ');
      const ny = y0n.toFixed(3);
      const nx = (l[0].x0 / W).toFixed(3);
      console.log(`  y=${ny} x=${nx}  "${txt}"`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
