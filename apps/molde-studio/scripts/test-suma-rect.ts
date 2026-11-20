import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';
import { grisesZona } from './calibrar-e14-nuevo.ts';
const path = 'scripts/actas-nuevas/plantilla-nairobi-1.png';
const worker = await createWorker('spa', 1, {});
for (const rect of [[0.684, 0.813, 0.247, 0.050], [0.684, 0.810, 0.247, 0.050], [0.684, 0.808, 0.247, 0.050]] as [number, number, number, number][]) {
  const z = await grisesZona(path, rect);
  if (!z) { console.log(`rect y=${rect[1]}: null`); continue; }
  const png = await sharp(Buffer.from(z.gray), { raw: { width: z.zw, height: z.zh, channels: 1 } })
    .resize({ width: z.zw * 4, height: z.zh * 4, kernel: 'cubic' }).png().toBuffer();
  await worker.setParameters({ tessedit_pageseg_mode: '7' as never, tessedit_char_whitelist: '0123456789' });
  const r = await worker.recognize(png, {}, { text: true });
  console.log(`rect y=${rect[1]} (${z.zw}x${z.zh}): "${(r.data.text ?? '').trim()}"`);
}
await worker.terminate();
process.exit(0);
