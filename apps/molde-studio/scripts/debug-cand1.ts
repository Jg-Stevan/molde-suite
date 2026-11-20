// Debug: binarización de la zona de votación candidato 1 en plantilla
import sharp from 'sharp';
import { binarizeNoLines } from './calibrar-e14-nuevo.ts';

async function main() {
  const path = 'scripts/actas-nuevas/plantilla-nairobi-1.png';
  const rect: [number, number, number, number] = [0.684, 0.432, 0.240, 0.075];
  const { data, info } = await sharp(path).resize({ width: 1000 }).grayscale().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const mx = rect[2] * 0.004 + 0.002, my = rect[3] * 0.004 + 0.002;
  const x0 = Math.max(0, Math.floor((rect[0] - mx) * W));
  const y0 = Math.max(0, Math.floor((rect[1] - my) * H));
  const x1 = Math.min(W, Math.ceil((rect[0] + rect[2] + mx) * W));
  const y1 = Math.min(H, Math.ceil((rect[1] + rect[3] + my) * H));
  const zw = x1 - x0, zh = y1 - y0;
  console.log(`zona px: x=${x0}..${x1} y=${y0}..${y1} (${zw}x${zh})`);
  const gray = new Uint8Array(zw * zh);
  for (let y = 0; y < zh; y++) for (let x = 0; x < zw; x++) gray[y * zw + x] = data[(y0 + y) * W + x0 + x];
  await sharp(Buffer.from(gray), { raw: { width: zw, height: zh, channels: 1 } }).png().toFile('scripts/actas-nuevas/debug-cand1-gray.png');
  const bin = binarizeNoLines(gray, zw, zh);
  const binImg = new Uint8Array(zw * zh);
  for (let i = 0; i < bin.length; i++) binImg[i] = bin[i] ? 0 : 255;
  await sharp(Buffer.from(binImg), { raw: { width: zw, height: zh, channels: 1 } }).png().toFile('scripts/actas-nuevas/debug-cand1-bin.png');
  // ratio por franjas verticales para localizar la tinta
  for (let fx = 0; fx < 5; fx++) {
    const zx0 = Math.floor((fx * zw) / 5), zx1 = Math.floor(((fx + 1) * zw) / 5);
    let ink = 0, tot = 0;
    for (let y = 0; y < zh; y++) for (let x = zx0; x < zx1; x++) { ink += bin[y * zw + x]; tot++; }
    console.log(`franja x ${fx}: ratio=${(ink / tot).toFixed(4)}`);
  }
  for (let fy = 0; fy < 5; fy++) {
    const zy0 = Math.floor((fy * zh) / 5), zy1 = Math.floor(((fy + 1) * zh) / 5);
    let ink = 0, tot = 0;
    for (let y = zy0; y < zy1; y++) for (let x = 0; x < zw; x++) { ink += bin[y * zw + x]; tot++; }
    console.log(`franja y ${fy}: ratio=${(ink / tot).toFixed(4)}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
