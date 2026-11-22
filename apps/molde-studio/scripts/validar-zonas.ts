// Validación dirigida de geometrías candidatas (bandas de dígitos reales).
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { ocrTodasLasPaginas, buscarAncla, binarizeNoLines, inkRatio } from './calibrar-e14-nuevo.ts';

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
function ratioZona(key: string, rect: [number, number, number, number]): number | null {
  const g = GRAY[key];
  const mx = rect[2] * 0.004 + 0.002, my = rect[3] * 0.004 + 0.002;
  const x0 = Math.max(0, Math.floor((rect[0] - mx) * g.W));
  const y0 = Math.max(0, Math.floor((rect[1] - my) * g.H));
  const x1 = Math.min(g.W, Math.ceil((rect[0] + rect[2] + mx) * g.W));
  const y1 = Math.min(g.H, Math.ceil((rect[1] + rect[3] + my) * g.H));
  const zw = x1 - x0, zh = y1 - y0;
  if (zw <= 2 || zh <= 2) return null;
  const gray = new Uint8Array(zw * zh);
  for (let y = 0; y < zh; y++) for (let x = 0; x < zw; x++) gray[y * zw + x] = g.data[(y0 + y) * g.W + x0 + x];
  const bin = binarizeNoLines(gray, zw, zh);
  return inkRatio(bin, zw, [0, 0, zw, zh]);
}

let OCR: Record<string, any> = {};
function resolverRect(campo: any, pagKey: string, zona: { x: number; y: number; w: number; h: number }): [number, number, number, number] | null {
  const esperado = campo.ancla.rect ? [campo.ancla.rect.x, campo.ancla.rect.y, campo.ancla.rect.w, campo.ancla.rect.h] as [number, number, number, number] : undefined;
  const pag = OCR[pagKey];
  const hit = buscarAncla(campo.ancla.texto, pag, esperado);
  if (hit && hit.score >= 0.72) return [campo.x_absoluto ? zona.x : hit.rect[0] + zona.x, hit.rect[1] + zona.y, zona.w, zona.h];
  if (campo.ancla_respaldo) {
    const h2 = buscarAncla(campo.ancla_respaldo, pag, esperado);
    if (h2 && h2.score >= 0.72) return [campo.x_absoluto ? zona.x : h2.rect[0] + zona.x, h2.rect[1] + zona.y, zona.w, zona.h];
  }
  if (campo.ancla.rect) return [campo.x_absoluto ? zona.x : campo.ancla.rect.x + zona.x, campo.ancla.rect.y + zona.y, zona.w, zona.h];
  return null;
}

function evalPresencia(id: string, molde: any, zona: { x: number; y: number; w: number; h: number }, umbral: number) {
  const campo = molde.campos.find((c: any) => c.id === id);
  const out: string[] = [];
  for (const d of DOCS) {
    const key = `${d.doc}-p${campo.pagina}`;
    const rect = resolverRect(campo, key, zona);
    const r = rect ? ratioZona(key, rect) : null;
    const ref = rect && Math.abs(rect[1] - (campo.ancla.rect.y + zona.y)) < 1e-9 ? ' REF' : '';
    out.push(`   ${d.doc}: ratio=${r === null ? 'null' : r.toFixed(4)} -> ${r !== null && r >= umbral ? 'LLENO' : 'VACIO'}${ref}`);
  }
  console.log(`${id} zona=[x=${zona.x.toFixed(3)} y=${zona.y.toFixed(4)} w=${zona.w.toFixed(3)} h=${zona.h.toFixed(3)}] umbral=${umbral}`);
  for (const l of out) console.log(l);
}

async function main() {
  const molde = JSON.parse(readFileSync('templates/e14/molde-e14.json', 'utf8'));
  OCR = await ocrTodasLasPaginas();
  await precargar();

  console.log('=== CAND1 banda digitos ===');
  evalPresencia('votos_candidato_1', molde, { x: 0.684, y: -0.050, w: 0.240, h: 0.042 }, 0.015);
  console.log('=== CAND2 banda digitos ===');
  evalPresencia('votos_candidato_2', molde, { x: 0.703, y: -0.058, w: 0.216, h: 0.058 }, 0.015);
  console.log('=== JURADO1 bajo etiqueta ===');
  evalPresencia('firma_jurado_1', molde, { x: -0.145, y: 0.006, w: 0.452, h: 0.05 }, 0.02);
  console.log('=== JURADO2 bajo etiqueta ===');
  evalPresencia('firma_jurado_2', molde, { x: -0.143, y: 0.006, w: 0.45, h: 0.05 }, 0.02);
  console.log('=== JURADO3 bajo etiqueta ===');
  evalPresencia('firma_jurado_3', molde, { x: -0.145, y: 0.006, w: 0.45, h: 0.05 }, 0.02);
  console.log('=== JURADO4 bajo etiqueta ===');
  evalPresencia('firma_jurado_4', molde, { x: -0.145, y: 0.006, w: 0.452, h: 0.05 }, 0.02);
  console.log('=== JURADO4 zona actual ===');
  evalPresencia('firma_jurado_4', molde, { x: -0.145, y: -0.003, w: 0.452, h: 0.066 }, 0.012);
  console.log('=== E11 ===');
  evalPresencia('total_votantes_e11', molde, { x: 0.66, y: -0.003, w: 0.3, h: 0.026 }, 0.015);
  console.log('=== URNA ===');
  evalPresencia('total_votos_urna', molde, { x: 0.66, y: -0.004, w: 0.3, h: 0.026 }, 0.015);
  console.log('=== INCINERADOS ===');
  evalPresencia('total_votos_incinerados', molde, { x: 0.66, y: -0.002, w: 0.3, h: 0.022 }, 0.012);
  console.log('=== BLANCO ===');
  evalPresencia('votos_en_blanco', molde, { x: 0.6815, y: -0.0115, w: 0.257, h: 0.0295 }, 0.015);
  console.log('=== NULOS ===');
  evalPresencia('votos_nulos', molde, { x: 0.6836, y: -0.0105, w: 0.246, h: 0.028 }, 0.012);
  console.log('=== NOMARCADOS ===');
  evalPresencia('votos_no_marcados', molde, { x: 0.675, y: -0.0084, w: 0.259, h: 0.022 }, 0.012);
  console.log('=== CONSTANCIAS ===');
  evalPresencia('constancias_presencia', molde, { x: 0.05, y: 0.01, w: 0.9, h: 0.39 }, 0.0015);
  console.log('=== RECUENTO ===');
  evalPresencia('recuento_marca', molde, { x: 0.42, y: -0.005, w: 0.18, h: 0.022 }, 0.008);
}
main().catch((e) => { console.error(e); process.exit(1); });
