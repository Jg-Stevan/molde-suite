// Banco v2: psm 6 para el bloque divipol + recorte inteligente al manuscrito
// (componentes conexos -> bbox de tinta -> OCR del recorte ajustado).
import { createWorker } from 'tesseract.js';
import sharp from 'sharp';

interface Recorte {
  nombre: string;
  archivo: string;
  W: number;
  H: number;
  rect: { x: number; y: number; w: number; h: number };
}

const recortes: Recorte[] = [
  { nombre: 'frank-divipol-bloque', archivo: '/tmp/fotos/frank816-1.png', W: 815, H: 2526, rect: { x: 0.05, y: 0.1515, w: 0.65, h: 0.062 } },
  { nombre: 'cairo-divipol-bloque', archivo: '/tmp/fotos/cairo816-1.png', W: 817, H: 2526, rect: { x: 0.05, y: 0.1505, w: 0.65, h: 0.062 } },
  { nombre: 'frank-suma-ancho', archivo: '/tmp/fotos/frank816-1.png', W: 815, H: 2526, rect: { x: 0.79, y: 0.8002, w: 0.185, h: 0.034 } },
  { nombre: 'cairo-suma-ancho', archivo: '/tmp/fotos/cairo816-1.png', W: 817, H: 2526, rect: { x: 0.79, y: 0.8051, w: 0.185, h: 0.034 } },
];

function otsuThr(gray: Uint8Array): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thr = t; }
  }
  return thr;
}

// Componentes conexos 8-sobre binaria; devuelve areas y bbox global de los grandes
function componentesInk(bin: Uint8Array, w: number, h: number, areaMin: number) {
  const labels = new Int32Array(w * h).fill(-1);
  const stack = new Int32Array(w * h);
  let minX = w, minY = h, maxX = -1, maxY = -1, grandes = 0;
  for (let s = 0; s < w * h; s++) {
    if (bin[s] === 0 || labels[s] !== -1) continue;
    let sp = 0;
    stack[sp++] = s;
    labels[s] = 1;
    let area = 0;
    let ax0 = w, ay0 = h, ax1 = -1, ay1 = -1;
    while (sp > 0) {
      const p = stack[--sp];
      const px = p % w, py = (p / w) | 0;
      area++;
      if (px < ax0) ax0 = px;
      if (px > ax1) ax1 = px;
      if (py < ay0) ay0 = py;
      if (py > ay1) ay1 = py;
      for (let yy = Math.max(0, py - 1); yy <= Math.min(h - 1, py + 1); yy++) {
        for (let xx = Math.max(0, px - 1); xx <= Math.min(w - 1, px + 1); xx++) {
          const q = yy * w + xx;
          if (bin[q] === 1 && labels[q] === -1) { labels[q] = 1; stack[sp++] = q; }
        }
      }
    }
    if (area >= areaMin) {
      grandes++;
      if (ax0 < minX) minX = ax0;
      if (ay0 < minY) minY = ay0;
      if (ax1 > maxX) maxX = ax1;
      if (ay1 > maxY) maxY = ay1;
    }
  }
  return { minX, minY, maxX, maxY, grandes };
}

async function main() {
  const worker = await createWorker('spa+eng', 1, {});
  for (const r of recortes) {
    const left = Math.max(0, Math.floor(r.rect.x * r.W));
    const top = Math.max(0, Math.floor(r.rect.y * r.H));
    const width = Math.min(r.W - left, Math.round(r.rect.w * r.W));
    const height = Math.min(r.H - top, Math.round(r.rect.h * r.H));
    const plainBuf = await sharp(r.archivo).extract({ left, top, width, height }).png().toBuffer();
    const realzadoBuf = await sharp(r.archivo).extract({ left, top, width, height }).greyscale()
      .normalise(5, 95)
      .resize(Math.min(4000, width * 3), Math.min(4000, height * 3), { kernel: 'lanczos3' })
      .png().toBuffer();
    const { data: rz } = await sharp(realzadoBuf).greyscale().raw().toBuffer({ resolveWithObject: true });
    const thr = otsuThr(rz);
    const otsuBuf = await sharp(realzadoBuf).greyscale().threshold(thr).png().toBuffer();

    console.log(`\n===== ${r.nombre} (${width}x${height}) otsu=${thr} =====`);
    for (const psm of ['6', '4'] as const) {
      for (const [tag, buf] of [['plain', plainBuf], ['realce', realzadoBuf], ['otsu', otsuBuf]] as const) {
        await worker.setParameters({ tessedit_pageseg_mode: psm as never, tessedit_char_whitelist: '' });
        const { data: d } = await worker.recognize(buf);
        const t2 = (d.text ?? '').replace(/\s+/g, ' ').trim();
        if (t2) console.log(`  [${tag} psm${psm}] "${t2.slice(0, 150)}"`);
      }
    }

    // recorte inteligente al manuscrito (solo suma)
    if (r.nombre.includes('suma')) {
      const { data: g, info } = await sharp(plainBuf).greyscale().raw().toBuffer({ resolveWithObject: true });
      const bin = new Uint8Array(g.length);
      for (let i = 0; i < g.length; i++) bin[i] = g[i] < 120 ? 1 : 0;
      const c = componentesInk(bin, info.width, info.height, 40);
      if (c.grandes > 0 && c.maxX >= 0) {
        const pad = 6;
        const bx = Math.max(0, c.minX - pad), by = Math.max(0, c.minY - pad);
        const bw = Math.min(info.width - bx, c.maxX - c.minX + 1 + 2 * pad);
        const bh = Math.min(info.height - by, c.maxY - c.minY + 1 + 2 * pad);
        console.log(`  ink bbox: (${c.minX},${c.minY})-(${c.maxX},${c.maxY}) grandes=${c.grandes}`);
        const inkBuf = await sharp(plainBuf).extract({ left: bx, top: by, width: bw, height: bh })
          .resize(bw * 4, bh * 4, { kernel: 'lanczos3' }).png().toBuffer();
        const inkRealce = await sharp(inkBuf).greyscale().normalise(5, 95).png().toBuffer();
        const { data: rz2 } = await sharp(inkRealce).greyscale().raw().toBuffer({ resolveWithObject: true });
        const thr2 = otsuThr(rz2);
        const inkOtsu = await sharp(inkRealce).greyscale().threshold(thr2).png().toBuffer();
        await sharp(inkOtsu).toFile(`/tmp/ink-${r.nombre}.png`);
        for (const psm of ['7', '8', '13'] as const) {
          for (const [tag, buf] of [['ink-plain', inkBuf], ['ink-realce', inkRealce], ['ink-otsu', inkOtsu]] as const) {
            await worker.setParameters({ tessedit_pageseg_mode: psm as never, tessedit_char_whitelist: '0123456789' });
            const { data: d } = await worker.recognize(buf);
            const t3 = (d.text ?? '').trim().replace(/\s+/g, ' ');
            console.log(`  [${tag} psm${psm} wl] "${t3}"`);
          }
        }
      } else {
        console.log('  sin componentes de tinta grandes');
      }
    }
  }
  await worker.terminate();
}
main();
