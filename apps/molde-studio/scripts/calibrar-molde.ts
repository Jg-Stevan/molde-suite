// Calibración del molde E-14 exterior (escaneo Nairobi) con Tesseract.js en Node.
// Mide bboxes de palabras clave sobre las imágenes de referencia y arma el
// JSON del molde universal v3 con anclas + zonas relativas/absolutas.
// Uso: bun scripts/calibrar-molde.ts

import { createWorker } from 'tesseract.js';
import sharp from 'sharp';

const P1 = 'public/actas/nairobi-p1.png';
const P2 = 'public/actas/nairobi-p2.png';

interface Pal {
  t: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  c: number;
}

async function ocrImagen(path: string): Promise<{ pals: Pal[]; W: number; H: number }> {
  const worker = await createWorker('spa+eng', 1, {});
  await worker.setParameters({
    tessedit_pageseg_mode: '4' as never, // SINGLE_COLUMN igual que la app
    // (psm 4 como en la app: SINGLE_COLUMN)
    preserve_interword_spaces: '1',
  });
  const { data } = await worker.recognize(path, {}, { text: true, blocks: true });
  const meta = await sharp(path).metadata();
  const W = meta.width ?? 1000;
  const H = meta.height ?? 3000;
  const pals: Pal[] = [];
  const blocks = (data as unknown as { blocks?: unknown[] }).blocks ?? [];
  for (const b of blocks as Array<{ paragraphs?: Array<{ lines?: Array<{ words?: Array<{ text: string; bbox: { x0: number; y0: number; x1: number; y1: number }; confidence: number }> }> }> }>) {
    for (const p of b.paragraphs ?? []) {
      for (const l of p.lines ?? []) {
        for (const w of l.words ?? []) {
          const t = (w.text ?? '').trim();
          if (!t) continue;
          pals.push({ t, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1, c: w.confidence });
        }
      }
    }
  }
  await worker.terminate();
  return { pals, W, H };
}

function normTxt(s: string): string {
  return s
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Agrupa palabras en líneas por proximidad vertical
function lineas(pals: Pal[]): Pal[][] {
  const orden = [...pals].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const out: Pal[][] = [];
  for (const p of orden) {
    const l = out[out.length - 1];
    if (l && Math.abs(p.y0 - l[0].y0) < Math.max(10, (l[0].y1 - l[0].y0) * 0.6)) l.push(p);
    else out.push([p]);
  }
  return out;
}

async function main() {
  for (const [nombre, path] of [
    ['PAGINA 1', P1],
    ['PAGINA 2', P2],
  ] as const) {
    const { pals, W, H } = await ocrImagen(path);
    console.log(`\n===== ${nombre} (${W}x${H}) =====`);
    for (const l of lineas(pals)) {
      const x0 = Math.min(...l.map((p) => p.x0));
      const y0 = Math.min(...l.map((p) => p.y0));
      const x1 = Math.max(...l.map((p) => p.x1));
      const y1 = Math.max(...l.map((p) => p.y1));
      const txt = l.map((p) => p.t).join(' ');
      const nx = (v: number) => (v / W).toFixed(4);
      const ny = (v: number) => (v / H).toFixed(4);
      console.log(
        `[${nx(x0)},${ny(y0)} -> ${nx(x1)},${ny(y1)}]  ${txt.slice(0, 110)}`,
      );
    }
  }
}

main();
