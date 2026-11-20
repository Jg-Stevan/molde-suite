// OCR por palabra de las FOTOS reales (Frankfurt, Cairo) para validar anclas
// y medir la variación de posición vs el escaneo de referencia.
import { createWorker } from 'tesseract.js';
import sharp from 'sharp';
import { execSync } from 'node:child_process';

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

function mostrar(pals: Pal[], W: number, H: number, yMin: number, yMax: number, titulo: string) {
  console.log(`--- ${titulo} ---`);
  const sel = pals
    .filter((p) => p.y0 / H >= yMin && p.y0 / H <= yMax)
    .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  for (const p of sel) {
    console.log(
      `${p.t.padEnd(16)} [${(p.x0 / W).toFixed(3)},${(p.y0 / H).toFixed(3)} -> ${(p.x1 / W).toFixed(3)},${(p.y1 / H).toFixed(3)}]`,
    );
  }
}

async function fotoPdf(pdf: string, tag: string) {
  execSync(`pdftoppm -png -r 96 "${pdf}" /tmp/fotos/${tag}`, { stdio: 'ignore' });
}

async function main() {
  execSync('mkdir -p /tmp/fotos', { stdio: 'ignore' });
  await fotoPdf('/home/z/my-project/public/actas/frankfurt.pdf', 'frank');
  await fotoPdf('/home/z/my-project/public/actas/el-cairo.pdf', 'cairo');

  for (const f of ['/tmp/fotos/frank-1.png', '/tmp/fotos/frank-2.png', '/tmp/fotos/cairo-1.png', '/tmp/fotos/cairo-2.png']) {
    const { pals, W, H } = await ocr(f);
    console.log(`\n########## ${f} (${W}x${H}) ##########`);
    if (f.endsWith('-1.png')) {
      mostrar(pals, W, H, 0.10, 0.24, 'DIVIPOL');
      mostrar(pals, W, H, 0.38, 0.55, 'NIVELACION+CAND1');
      mostrar(pals, W, H, 0.55, 0.90, 'CAND2+FINAL');
    } else {
      mostrar(pals, W, H, 0.60, 0.99, 'FIRMAS');
    }
  }
}

main();
