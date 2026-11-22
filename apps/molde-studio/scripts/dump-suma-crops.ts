import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { ocrTodasLasPaginas, buscarAncla, grisesZona } from './calibrar-e14-nuevo.ts';
const PATHS: Record<string, string> = {
  plantilla: 'scripts/actas-nuevas/plantilla-nairobi-1.png',
  transmision: 'scripts/actas-nuevas/transmision-barcelona-1.png',
  cairo: 'scripts/actas-nuevas/foto-cairo-1.png',
};
const molde = JSON.parse(readFileSync('templates/e14/molde-e14.json', 'utf8'));
const campo = molde.campos.find((c) => c.id === 'suma_total');
const ocr = await ocrTodasLasPaginas();
for (const [DOC, path] of Object.entries(PATHS)) {
  const esperado = [campo.ancla.rect.x, campo.ancla.rect.y, campo.ancla.rect.w, campo.ancla.rect.h];
  const hit = buscarAncla(campo.ancla.texto, ocr[DOC + '-p1'], esperado);
  const zona = { x: 0.684, y: -0.008, w: 0.2466, h: 0.05 };
  const rect: [number, number, number, number] = hit && hit.score >= 0.72
    ? [zona.x, hit.rect[1] + zona.y, zona.w, zona.h]
    : [zona.x, campo.ancla.rect.y + zona.y, zona.w, zona.h];
  const z = await grisesZona(path, rect);
  if (!z) continue;
  await sharp(Buffer.from(z.gray), { raw: { width: z.zw, height: z.zh, channels: 1 } })
    .resize({ width: z.zw * 2, height: z.zh * 2, kernel: 'cubic' }).png()
    .toFile(`scripts/actas-nuevas/suma-${DOC}.png`);
  console.log(`${DOC}: rect=[${rect.map((v) => v.toFixed(3)).join(',')}]`);
}
process.exit(0);
