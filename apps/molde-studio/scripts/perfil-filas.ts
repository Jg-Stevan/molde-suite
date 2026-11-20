// Perfil fino de tinta por filas problemáticas (cand1, cand2, recuento, constancias).
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { ocrTodasLasPaginas, binarizeNoLines } from './calibrar-e14-nuevo.ts';

const DOCS = [
  { doc: 'plantilla', p1: 'scripts/actas-nuevas/plantilla-nairobi-1.png', p2: 'scripts/actas-nuevas/plantilla-nairobi-2.png' },
  { doc: 'transmision', p1: 'scripts/actas-nuevas/transmision-barcelona-1.png', p2: 'scripts/actas-nuevas/transmision-barcelona-2.png' },
  { doc: 'cairo', p1: 'scripts/actas-nuevas/foto-cairo-1.png', p2: 'scripts/actas-nuevas/foto-cairo-2.png' },
];
const GRAY: Record<string, { data: Uint8Array; W: number; H: number }> = {};
async function precargar() {
  for (const d of DOCS) {
    for (const key of [`${d.doc}-p1`, `${d.doc}-p2`] as const) {
      const path = key.endsWith('p1') ? d.p1 : d.p2;
      const { data, info } = await sharp(path).resize({ width: 1000 }).grayscale().raw().toBuffer({ resolveWithObject: true });
      GRAY[key] = { data: new Uint8Array(data), W: info.width, H: info.height };
    }
  }
}
function binZona(key: string, rect: [number, number, number, number]) {
  const g = GRAY[key];
  const x0 = Math.max(0, Math.floor(rect[0] * g.W));
  const y0 = Math.max(0, Math.floor(rect[1] * g.H));
  const x1 = Math.min(g.W, Math.ceil((rect[0] + rect[2]) * g.W));
  const y1 = Math.min(g.H, Math.ceil((rect[1] + rect[3]) * g.H));
  const zw = x1 - x0, zh = y1 - y0;
  if (zw <= 2 || zh <= 2) return null;
  const gray = new Uint8Array(zw * zh);
  for (let y = 0; y < zh; y++) for (let x = 0; x < zw; x++) gray[y * zw + x] = g.data[(y0 + y) * g.W + x0 + x];
  return { bin: binarizeNoLines(gray, zw, zh), zw, zh };
}
function perfilY(key: string, rect: [number, number, number, number], franjas = 12) {
  const z = binZona(key, rect);
  if (!z) return;
  const out: string[] = [];
  for (let f = 0; f < franjas; f++) {
    const y0 = Math.floor((f * z.zh) / franjas), y1 = Math.floor(((f + 1) * z.zh) / franjas);
    let ink = 0, tot = 0;
    for (let y = y0; y < y1; y++) for (let x = 0; x < z.zw; x++) { ink += z.bin[y * z.zw + x]; tot++; }
    out.push(`${(((rect[1] + (f * rect[3]) / franjas))).toFixed(3)}-${(((rect[1] + ((f + 1) * rect[3]) / franjas))).toFixed(3)}:${(ink / tot).toFixed(4)}`);
  }
  console.log(`  ${key}: ${out.join('  ')}`);
}
function perfilX(key: string, rect: [number, number, number, number], franjas = 8) {
  const z = binZona(key, rect);
  if (!z) return;
  const out: string[] = [];
  for (let f = 0; f < franjas; f++) {
    const x0 = Math.floor((f * z.zw) / franjas), x1 = Math.floor(((f + 1) * z.zw) / franjas);
    let ink = 0, tot = 0;
    for (let y = 0; y < z.zh; y++) for (let x = x0; x < x1; x++) { ink += z.bin[y * z.zw + x]; tot++; }
    out.push(`${(rect[0] + (f * rect[2]) / franjas).toFixed(3)}-${(rect[0] + ((f + 1) * rect[2]) / franjas).toFixed(3)}:${(ink / tot).toFixed(4)}`);
  }
  console.log(`  ${key}: ${out.join('  ')}`);
}

async function main() {
  await precargar();
  const molde = JSON.parse(readFileSync('scripts/molde-e14-nuevo.json', 'utf8'));
  const c1 = molde.campos.find((c: any) => c.id === 'votos_candidato_1');
  const c2 = molde.campos.find((c: any) => c.id === 'votos_candidato_2');
  const rc = molde.campos.find((c: any) => c.id === 'recuento_marca');

  console.log('### CAND1: perfil Y (zona x 0.66-0.96, y ancla-0.09 .. ancla+0.02) ###');
  for (const d of DOCS) {
    const aY = c1.ancla.rect.y;
    perfilY(`${d.doc}-p1`, [0.66, aY - 0.09, 0.30, 0.11]);
  }
  console.log('\n### CAND1: perfil X (banda digitos y ancla-0.055..-0.005) ###');
  for (const d of DOCS) {
    const aY = c1.ancla.rect.y;
    perfilX(`${d.doc}-p1`, [0.66, aY - 0.055, 0.30, 0.05]);
  }
  console.log('\n### CAND2: perfil Y ###');
  for (const d of DOCS) {
    const aY = c2.ancla.rect.y;
    perfilY(`${d.doc}-p1`, [0.66, aY - 0.09, 0.30, 0.11]);
  }
  console.log('\n### CAND2: perfil X (banda y ancla-0.05..ancla) ###');
  for (const d of DOCS) {
    const aY = c2.ancla.rect.y;
    perfilX(`${d.doc}-p1`, [0.66, aY - 0.05, 0.30, 0.05]);
  }
  console.log('\n### RECUENTO: perfil Y (x 0.42-0.60, y 0.655..0.695 aprox) ###');
  for (const d of DOCS) {
    perfilY(`${d.doc}-p2`, [0.42, 0.655, 0.18, 0.04]);
  }
  console.log('\n### RECUENTO: perfil X (y 0.668..0.680) ###');
  for (const d of DOCS) {
    perfilX(`${d.doc}-p2`, [0.30, 0.668, 0.40, 0.012]);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
