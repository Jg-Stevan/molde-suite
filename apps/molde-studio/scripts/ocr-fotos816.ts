import { createWorker } from 'tesseract.js';
import sharp from 'sharp';

interface Pal { t: string; x0: number; y0: number; x1: number; y1: number }

async function ocr(path: string) {
  const worker = await createWorker('spa+eng', 1, {});
  await worker.setParameters({ tessedit_pageseg_mode: '4' as never, preserve_interword_spaces: '1' });
  const { data } = await worker.recognize(path, {}, { text: true, blocks: true });
  const meta = await sharp(path).metadata();
  const W = meta.width ?? 800, H = meta.height ?? 2500;
  const pals: Pal[] = [];
  for (const b of (data as unknown as { blocks?: unknown[] }).blocks ?? []) {
    for (const p of (b as { paragraphs?: unknown[] }).paragraphs ?? []) {
      for (const l of (p as { lines?: unknown[] }).lines ?? []) {
        for (const w of (l as { words?: unknown[] }).words ?? []) {
          const ww = w as { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } };
          const t = (ww.text ?? '').trim();
          if (!t) continue;
          pals.push({ t, x0: ww.bbox.x0, y0: ww.bbox.y0, x1: ww.bbox.x1, y1: ww.bbox.y1 });
        }
      }
    }
  }
  await worker.terminate();
  return { pals, W, H };
}

function show(pals: Pal[], W: number, H: number, yMin: number, yMax: number, titulo: string) {
  console.log(`--- ${titulo} ---`);
  for (const p of pals.filter((p) => p.y0 / H >= yMin && p.y0 / H <= yMax).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) {
    console.log(`${p.t.padEnd(18)} [${(p.x0 / W).toFixed(3)},${(p.y0 / H).toFixed(3)} -> ${(p.x1 / W).toFixed(3)},${(p.y1 / H).toFixed(3)}]`);
  }
}

async function main() {
  for (const f of ['/tmp/fotos/frank816-1.png', '/tmp/fotos/frank816-2.png', '/tmp/fotos/cairo816-1.png', '/tmp/fotos/cairo816-2.png']) {
    const { pals, W, H } = await ocr(f);
    console.log(`\n########## ${f} (${W}x${H}) ##########`);
    if (f.endsWith('-1.png')) {
      show(pals, W, H, 0.12, 0.26, 'DIVIPOL+X');
      show(pals, W, H, 0.24, 0.36, 'NIVELACION');
      show(pals, W, H, 0.42, 0.55, 'CAND1');
      show(pals, W, H, 0.60, 0.87, 'CAND2+FINAL');
    } else {
      show(pals, W, H, 0.63, 0.75, 'RECUENTO');
      show(pals, W, H, 0.80, 0.99, 'FIRMAS');
    }
  }
}
main();
