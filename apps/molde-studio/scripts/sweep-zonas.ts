// Barrido de optimización de zonas presencia + suma_total contra ground-truth
// de los 3 documentos. Elige la geometría con máxima separación
// lleno/vacío (o lecturas correctas para texto).
// Uso: bun scripts/sweep-zonas.ts

import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { ocrTodasLasPaginas, buscarAncla, grisesZona, binarizeNoLines, inkRatio, ocrTextoZona } from './calibrar-e14-nuevo.ts';

const DOCS = [
  { doc: 'plantilla', p1: 'scripts/actas-nuevas/plantilla-nairobi-1.png', p2: 'scripts/actas-nuevas/plantilla-nairobi-2.png' },
  { doc: 'transmision', p1: 'scripts/actas-nuevas/transmision-barcelona-1.png', p2: 'scripts/actas-nuevas/transmision-barcelona-2.png' },
  { doc: 'cairo', p1: 'scripts/actas-nuevas/foto-cairo-1.png', p2: 'scripts/actas-nuevas/foto-cairo-2.png' },
];

// ground truth diligenciado [plantilla, transmision, cairo]
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

// suma_total esperado por doc (para tipo texto)
const GT_SUMA: Record<string, string> = { plantilla: '9', transmision: '102', cairo: '17' };

interface Zona { x: number; y: number; w: number; h: number }

async function ratioEn(campo: any, doc: (typeof DOCS)[number], pagOcrKey: string, ocr: any, zona: Zona, anclaXabs: boolean): Promise<number | null> {
  const pag = ocr[pagOcrKey];
  const path = pagOcrKey.endsWith('p1') ? doc.p1 : doc.p2;
  const esperado = campo.ancla.rect ? [campo.ancla.rect.x, campo.ancla.rect.y, campo.ancla.rect.w, campo.ancla.rect.h] as [number, number, number, number] : undefined;
  let rectFinal: [number, number, number, number] | null = null;
  const hit = buscarAncla(campo.ancla.texto, pag, esperado);
  if (hit && hit.score >= 0.72) {
    rectFinal = [anclaXabs ? zona.x : hit.rect[0] + zona.x, hit.rect[1] + zona.y, zona.w, zona.h];
  } else if (campo.ancla_respaldo) {
    const h2 = buscarAncla(campo.ancla_respaldo, pag, esperado);
    if (h2 && h2.score >= 0.72) rectFinal = [anclaXabs ? zona.x : h2.rect[0] + zona.x, h2.rect[1] + zona.y, zona.w, zona.h];
  }
  if (!rectFinal && campo.ancla.rect) {
    rectFinal = [anclaXabs ? zona.x : campo.ancla.rect.x + zona.x, campo.ancla.rect.y + zona.y, zona.w, zona.h];
  }
  if (!rectFinal) return null;
  const z = await grisesZona(path, rectFinal);
  if (!z) return null;
  const bin = binarizeNoLines(z.gray, z.zw, z.zh);
  return inkRatio(bin, z.zw, [0, 0, z.zw, z.zh]);
}

async function sweepPresencia(id: string, molde: any, ocr: any) {
  const campo = molde.campos.find((c: any) => c.id === id);
  if (!campo) return;
  const gt = GT[id];
  const anclaY = campo.ancla.rect.y;
  const mejor = { sep: -999, zona: campo.zona, ratios: [] as number[] };
  const dxs = campo.x_absoluto ? [-0.03, -0.015, 0, 0.015] : [0];
  const dys = [-0.02, -0.012, -0.006, 0, 0.006, 0.012];
  const hs = campo.x_absoluto && id.startsWith('votos') ? [0.02, 0.028, 0.036] : [campo.zona.h, campo.zona.h * 0.8, campo.zona.h * 1.2];
  const ws = campo.x_absoluto ? [campo.zona.w - 0.06, campo.zona.w - 0.03, campo.zona.w] : [campo.zona.w];
  for (const dx of dxs) {
    for (const dy of dys) {
      for (const h of hs) {
        for (const w of ws) {
          const zona: Zona = { x: campo.zona.x + dx, y: campo.zona.y + dy, w, h };
          const ratios: number[] = [];
          let valido = true;
          for (let i = 0; i < DOCS.length; i++) {
            const r = await ratioEn(campo, DOCS[i], `${DOCS[i].doc}-p${campo.pagina}`, ocr, zona, campo.x_absoluto);
            if (r === null) { valido = false; break; }
            ratios.push(r);
          }
          if (!valido) continue;
          // separación: mínimo lleno - máximo vacío
          const llenos = ratios.filter((_, i) => gt[i]);
          const vacios = ratios.filter((_, i) => !gt[i]);
          const minL = Math.min(...llenos);
          const maxV = Math.max(...vacios);
          // umbral óptimo entre maxV y minL (con holgura 1.3x)
          if (minL <= maxV * 1.3 + 0.0002) continue;
          const umbral = Math.max(maxV * 1.5, Math.min(minL * 0.6, (minL + maxV) / 2));
          const sep = Math.log(minL / Math.max(maxV, 1e-6));
          if (sep > mejor.sep) {
            mejor.sep = sep;
            mejor.zona = zona;
            mejor.ratios = ratios;
            (mejor as any).umbral = umbral;
          }
        }
      }
    }
  }
  if (mejor.sep < 0) {
    console.log(`${id}: SIN separación válida — mantener actual`);
    return;
  }
  const estado = mejor.ratios.map((r, i) => `${DOCS[i].doc}=${r.toFixed(4)}${gt[i] ? 'L' : 'V'}`).join(' ');
  console.log(`${id}:`);
  console.log(`  zona nueva: x=${mejor.zona.x.toFixed(4)} y=${mejor.zona.y.toFixed(4)} w=${mejor.zona.w.toFixed(4)} h=${mejor.zona.h.toFixed(4)} umbral=${((mejor as any).umbral ?? 0.015).toFixed(4)}`);
  console.log(`  ratios: ${estado}  (sep=${mejor.sep.toFixed(2)})`);
}

async function sweepSuma(molde: any, ocr: any) {
  const campo = molde.campos.find((c: any) => c.id === 'suma_total');
  const baseZ = campo.zona;
  const resultados: Array<{ zona: Zona; lecturas: string[]; correctas: number }> = [];
  const xs = [0.684, 0.69, 0.7, 0.71];
  const dys = [-0.008, -0.004, 0, 0.004, 0.008];
  const hs = [0.026, 0.032, 0.04];
  const ws = [0.22, 0.247];
  for (const x of xs) {
    for (const dy of dys) {
      for (const h of hs) {
        for (const w of ws) {
          const zona: Zona = { x, y: baseZ.y + dy, w, h };
          const lecturas: string[] = [];
          for (const d of DOCS) {
            const esperado = [campo.ancla.rect.x, campo.ancla.rect.y, campo.ancla.rect.w, campo.ancla.rect.h] as [number, number, number, number];
            const hit = buscarAncla(campo.ancla.texto, ocr[`${d.doc}-p1`], esperado);
            let rect: [number, number, number, number];
            if (hit && hit.score >= 0.72) rect = [zona.x, hit.rect[1] + zona.y, zona.w, zona.h];
            else rect = [zona.x, campo.ancla.rect.y + zona.y, zona.w, zona.h];
            const primera = await ocrTextoZona(d.p1, rect, campo.whitelist);
            lecturas.push(primera.texto);
          }
          let correctas = 0;
          for (let i = 0; i < DOCS.length; i++) {
            const esp = GT_SUMA[DOCS[i].doc];
            const norm = lecturas[i].replace(/\s+/g, '');
            if (norm === esp || norm.split('').every((ch) => esp.includes(ch)) && norm.length === esp.length) correctas++;
          }
          resultados.push({ zona, lecturas, correctas });
        }
      }
    }
  }
  resultados.sort((a, b) => b.correctas - a.correctas);
  for (const r of resultados.slice(0, 5)) {
    console.log(`suma_total: x=${r.zona.x} y=${r.zona.y.toFixed(4)} w=${r.zona.w} h=${r.zona.h} correctas=${r.correctas}/3 lecturas=[${r.lecturas.map((l) => `"${l}"`).join(', ')}]`);
  }
}

async function main() {
  const molde = JSON.parse(readFileSync('scripts/molde-e14-nuevo.json', 'utf8'));
  const ocr = await ocrTodasLasPaginas();
  const ids = [
    'total_votantes_e11', 'total_votos_urna', 'total_votos_incinerados',
    'votos_candidato_1', 'votos_candidato_2', 'votos_en_blanco',
    'votos_nulos', 'votos_no_marcados', 'constancias_presencia', 'recuento_marca',
  ];
  for (const id of ids) await sweepPresencia(id, molde, ocr);
  console.log('');
  // suma se barré aparte
}
main().catch((e) => { console.error(e); process.exit(1); });
