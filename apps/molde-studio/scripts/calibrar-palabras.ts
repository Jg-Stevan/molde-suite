// Volcado por palabra de regiones clave (para calcular offsets de zonas del molde).
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
}

async function ocr(path: string): Promise<{ pals: Pal[]; W: number; H: number }> {
  const worker = await createWorker('spa+eng', 1, {});
  await worker.setParameters({ tessedit_pageseg_mode: '4' as never, preserve_interword_spaces: '1' });
  const { data } = await worker.recognize(path, {}, { text: true, blocks: true });
  const meta = await sharp(path).metadata();
  const W = meta.width ?? 1000;
  const H = meta.height ?? 3000;
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

function print(pals: Pal[], W: number, H: number, yMin: number, yMax: number, titulo: string) {
  console.log(`\n--- ${titulo} (y ${yMin}-${yMax}) ---`);
  const sel = pals
    .filter((p) => p.y0 / H >= yMin && p.y0 / H <= yMax)
    .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  for (const p of sel) {
    console.log(
      `${p.t.padEnd(16)} [${(p.x0 / W).toFixed(4)},${(p.y0 / H).toFixed(4)} -> ${(p.x1 / W).toFixed(4)},${(p.y1 / H).toFixed(4)}]`,
    );
  }
}

async function main() {
  const a = await ocr(P1);
  console.log(`P1 ${a.W}x${a.H}`);
  print(a.pals, a.W, a.H, 0.14, 0.215, 'P1 DIVIPOL');
  print(a.pals, a.W, a.H, 0.235, 0.34, 'P1 NIVELACION');
  print(a.pals, a.W, a.H, 0.34, 0.40, 'P1 BANDA CANDIDATOS');
  print(a.pals, a.W, a.H, 0.42, 0.56, 'P1 CANDIDATO 1');
  print(a.pals, a.W, a.H, 0.58, 0.70, 'P1 CANDIDATO 2');
  print(a.pals, a.W, a.H, 0.72, 0.86, 'P1 BLANCO/NULOS/NO MARCADOS/SUMA');

  const b = await ocr(P2);
  console.log(`\nP2 ${b.W}x${b.H}`);
  print(b.pals, b.W, b.H, 0.23, 0.28, 'P2 BANDA CONSTANCIAS');
  print(b.pals, b.W, b.H, 0.64, 0.72, 'P2 RECUENTO');
  print(b.pals, b.W, b.H, 0.815, 0.99, 'P2 FIRMAS');
}

main();
