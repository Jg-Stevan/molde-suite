// Barrido de optimización de zonas presencia (rápido: páginas precargadas).
// Uso: bun scripts/sweep-zonas2.ts

import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { ocrTodasLasPaginas, buscarAncla, binarizeNoLines, inkRatio } from './calibrar-e14-nuevo.ts';

const DOCS = [
  { doc: 'plantilla', p1: 'scripts/actas-nuevas/plantilla-nairobi-1.png', p2: 'scripts/actas-nuevas/plantilla-nairobi-2.png' },
  { doc: 'transmision', p1: 'scripts/actas-nuevas/transmision-barcelona-1.png', p2: 'scripts/actas-nuevas/transmision-barcelona-2.png' },
  { doc: 'cairo', p1: 'scripts/actas-nuevas/foto-cairo-1.png', p2: 'scripts/actas-nuevas/foto-cairo-2.png' },
];

const GT: Record<string, [boolean, boolean, boolean]> = {
  total_votantes_e11: [true, true, true],
  total_votos_urna: [true, true, true],
  total_votos_incinerados: [false, true, false],
  votos_candidato_1: [true, true, true],
  votos_candidato_2: [true, true, true],
  votos_en_blanco: [true, true, true],
  votos_nulos: [false, true, false],
  votos_no_marcados: [false, true, false],
  constancias_presencia: [false, true, true],
  recuento_marca: [true, false, true],
  firma_jurado_1: [true, true, true],
  firma_jurado_2: [true, true, true],
  firma_jurado_3: [true, true, true],
  firma_jurado_4: [false, true, false],
};

// precarga grises de cada página
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
  if (!g) return null;
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

let OCR: Record<string, any> = {};

async function sweep(id: string, molde: any) {
  const campo = molde.campos.find((c: any) => c.id === id);
  if (!campo) return;
  const gt = GT[id];
  const mejor = { sep: -999, zona: campo.zona, ratios: [] as number[], umbral: campo.umbral };
  const dxs = campo.x_absoluto ? [-0.03, -0.015, 0, 0.015] : [0];
  const dys = [-0.02, -0.012, -0.006, 0, 0.006, 0.012];
  const hs = [campo.zona.h * 0.6, campo.zona.h * 0.8, campo.zona.h, campo.zona.h * 1.2];
  const ws = campo.x_absoluto ? [campo.zona.w - 0.08, campo.zona.w - 0.04, campo.zona.w] : [campo.zona.w];
  for (const dx of dxs) {
    for (const dy of dys) {
      for (const h of hs) {
        for (const w of ws) {
          const zona = { x: campo.zona.x + dx, y: campo.zona.y + dy, w, h };
          const ratios: number[] = [];
          let valido = true;
          for (let i = 0; i < DOCS.length; i++) {
            const rect = resolverRect(campo, `${DOCS[i].doc}-p${campo.pagina}`, zona);
            if (!rect) { valido = false; break; }
            const r = ratioZona(`${DOCS[i].doc}-p${campo.pagina}`, rect);
            if (r === null) { valido = false; break; }
            ratios.push(r);
          }
          if (!valido) continue;
          const llenos = ratios.filter((_, i) => gt[i]);
          const vacios = ratios.filter((_, i) => !gt[i]);
          const minL = Math.min(...llenos);
          const maxV = Math.max(...vacios);
          if (minL <= maxV * 1.3 + 0.0002) continue;
          const sep = Math.log(minL / Math.max(maxV, 1e-6));
          if (sep > mejor.sep) {
            const umbral = Math.max(maxV * 1.5, Math.min(minL * 0.55, (minL + maxV) / 2));
            mejor.sep = sep;
            mejor.zona = zona;
            mejor.ratios = ratios;
            mejor.umbral = Math.round(umbral * 10000) / 10000;
          }
        }
      }
    }
  }
  if (mejor.sep < 0) {
    console.log(`${id}: SIN separación válida — mantener zona actual`);
    return;
  }
  const estado = mejor.ratios.map((r, i) => `${r.toFixed(4)}${gt[i] ? 'L' : 'V'}`).join(' ');
  console.log(`${id}: zona x=${mejor.zona.x.toFixed(4)} y=${mejor.zona.y.toFixed(4)} w=${mejor.zona.w.toFixed(4)} h=${mejor.zona.h.toFixed(4)} umbral=${mejor.umbral} | ratios ${estado} | sep=${mejor.sep.toFixed(2)}`);
}

async function main() {
  const molde = JSON.parse(readFileSync('scripts/molde-e14-nuevo.json', 'utf8'));
  console.log('Precargando OCR cache...');
  OCR = await ocrTodasLasPaginas();
  console.log('Precargando grises...');
  await precargar();
  const ids = [
    'total_votantes_e11', 'total_votos_urna', 'total_votos_incinerados',
    'votos_candidato_1', 'votos_candidato_2', 'votos_en_blanco',
    'votos_nulos', 'votos_no_marcados', 'constancias_presencia', 'recuento_marca',
    'firma_jurado_1', 'firma_jurado_2', 'firma_jurado_3', 'firma_jurado_4',
  ];
  for (const id of ids) await sweep(id, molde);
}
main().catch((e) => { console.error(e); process.exit(1); });
