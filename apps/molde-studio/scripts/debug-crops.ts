// Debug: extrae recortes de zonas del molde para inspección visual.
import sharp from 'sharp';
import { readFileSync } from 'node:fs';

const MOLDE = JSON.parse(readFileSync('templates/e14/molde-e14.json', 'utf8'));
const IMG = 'scripts/actas-nuevas/plantilla-nairobi-1.png';

async function crop(path: string, rect: [number, number, number, number], out: string, escala = 1) {
  const { data, info } = await sharp(path).resize({ width: 1000 }).grayscale().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const mx = rect[2] * 0.004 + 0.002, my = rect[3] * 0.004 + 0.002;
  const x0 = Math.max(0, Math.floor((rect[0] - mx) * W));
  const y0 = Math.max(0, Math.floor((rect[1] - my) * H));
  const x1 = Math.min(W, Math.ceil((rect[0] + rect[2] + mx) * W));
  const y1 = Math.min(H, Math.ceil((rect[1] + rect[3] + my) * H));
  const zw = x1 - x0, zh = y1 - y0;
  const gray = new Uint8Array(zw * zh);
  for (let y = 0; y < zh; y++) for (let x = 0; x < zw; x++) gray[y * zw + x] = data[(y0 + y) * W + x0 + x];
  let pipe = sharp(Buffer.from(gray), { raw: { width: zw, height: zh, channels: 1 } });
  if (escala > 1) pipe = pipe.resize({ width: zw * escala, height: zh * escala, kernel: 'cubic' });
  await pipe.png().toFile(out);
  console.log(`${out}: ${zw}x${zh} (escala ${escala})`);
}

async function main() {
  const campos = ['divipol_consulado', 'divipol_zona', 'suma_total'];
  for (const id of campos) {
    const c = MOLDE.campos.find((x: { id: string }) => x.id === id);
    if (!c) continue;
    // zona final simulando ancla en plantilla
    const ancla = c.ancla.rect;
    const rect: [number, number, number, number] = [
      c.x_absoluto ? c.zona.x : ancla.x + c.zona.x,
      ancla.y + c.zona.y,
      c.zona.w,
      c.zona.h,
    ];
    await crop(IMG, rect, `scripts/actas-nuevas/debug-${id}-x1.png`, 1);
    await crop(IMG, rect, `scripts/actas-nuevas/debug-${id}-x3.png`, 3);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
