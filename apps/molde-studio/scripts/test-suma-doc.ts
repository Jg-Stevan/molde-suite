import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';
import { ocrTodasLasPaginas, buscarAncla, grisesZona } from './calibrar-e14-nuevo.ts';

const DOC = process.argv[2];
const PATHS: Record<string, string> = {
  plantilla: 'scripts/actas-nuevas/plantilla-nairobi-1.png',
  transmision: 'scripts/actas-nuevas/transmision-barcelona-1.png',
  cairo: 'scripts/actas-nuevas/foto-cairo-1.png',
};
const path = PATHS[DOC];
const molde = JSON.parse(readFileSync('scripts/molde-e14-nuevo.json', 'utf8'));
const campo = molde.campos.find((c) => c.id === 'suma_total');
const ocr = await ocrTodasLasPaginas();
const esperado = [campo.ancla.rect.x, campo.ancla.rect.y, campo.ancla.rect.w, campo.ancla.rect.h];
const hit = buscarAncla(campo.ancla.texto, ocr[DOC + '-p1'], esperado);
const zona = { x: 0.73, y: -0.008, w: 0.20, h: 0.05 };
const rect: [number, number, number, number] = hit && hit.score >= 0.72
  ? [zona.x, hit.rect[1] + zona.y, zona.w, zona.h]
  : [zona.x, campo.ancla.rect.y + zona.y, zona.w, zona.h];
console.log(`DOC=${DOC} rect=[${rect.map((v) => v.toFixed(3)).join(',')}] ancla=${hit ? hit.score.toFixed(2) : 'no'}`);
const z = await grisesZona(path, rect);
if (!z) { console.log('zona invalida'); process.exit(0); }
// realce (contraste percentil)
const hist = new Uint32Array(256);
for (let i = 0; i < z.gray.length; i++) hist[z.gray[i]]++;
const n = z.gray.length;
let acc = 0, p5 = 0, p95 = 255;
for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.05) { p5 = v; break; } }
acc = 0;
for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.95) { p95 = v; break; } }
const span = Math.max(8, p95 - p5);
const realzado = new Uint8Array(z.gray.length);
for (let i = 0; i < z.gray.length; i++) realzado[i] = Math.min(255, Math.max(0, ((z.gray[i] - p5) * 255 / span))) | 0;
// otsu
const hist2 = new Uint32Array(256);
for (let i = 0; i < realzado.length; i++) hist2[realzado[i]]++;
let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist2[t];
let sumB = 0, wB = 0, best = 0, thr = 127;
for (let t = 0; t < 256; t++) {
  wB += hist2[t]; if (wB === 0) continue;
  const wF = realzado.length - wB; if (wF === 0) break;
  sumB += t * hist2[t];
  const mB = sumB / wB, mF = (sum - sumB) / wF;
  const between = wB * wF * (mB - mF) * (mB - mF);
  if (between > best) { best = between; thr = t; }
}
const otsu = new Uint8Array(realzado.length);
for (let i = 0; i < realzado.length; i++) otsu[i] = realzado[i] <= thr ? 0 : 255;
const escala = 4;
const pngGray = await sharp(Buffer.from(z.gray), { raw: { width: z.zw, height: z.zh, channels: 1 } }).resize({ width: z.zw * escala, height: z.zh * escala, kernel: 'cubic' }).png().toBuffer();
const pngRealce = await sharp(Buffer.from(realzado), { raw: { width: z.zw, height: z.zh, channels: 1 } }).resize({ width: z.zw * escala, height: z.zh * escala, kernel: 'cubic' }).png().toBuffer();
const pngOtsu = await sharp(Buffer.from(otsu), { raw: { width: z.zw, height: z.zh, channels: 1 } }).resize({ width: z.zw * escala, height: z.zh * escala, kernel: 'cubic' }).png().toBuffer();
const worker = await createWorker('spa', 1, {});
for (const [nombre, png] of [['gray', pngGray], ['realce', pngRealce], ['otsu', pngOtsu]] as const) {
  for (const psm of ['6', '7', '13']) {
    await worker.setParameters({ tessedit_pageseg_mode: psm as never, tessedit_char_whitelist: '0123456789' });
    const r = await worker.recognize(png, {}, { text: true });
    const t = (r.data.text ?? '').trim().replace(/\s+/g, ' ');
    const c = ((r.data as unknown as { confidence?: number }).confidence ?? 0).toFixed(0);
    if (t) console.log(`  ${nombre} psm${psm}: "${t}" conf=${c}`);
  }
}
await worker.terminate();
process.exit(0);
