// Mini-sweep de suma_total: prueba variantes de zona con OCR real (una sola pasada).
import { readFileSync } from 'node:fs';
import { ocrTodasLasPaginas, buscarAncla, ocrTextoZona } from './calibrar-e14-nuevo.ts';

const DOCS = [
  { doc: 'plantilla', p1: 'scripts/actas-nuevas/plantilla-nairobi-1.png' },
  { doc: 'transmision', p1: 'scripts/actas-nuevas/transmision-barcelona-1.png' },
  { doc: 'cairo', p1: 'scripts/actas-nuevas/foto-cairo-1.png' },
];
const ESPERA: Record<string, string> = { plantilla: '9', transmision: '102', cairo: '17' };

async function main() {
  const molde = JSON.parse(readFileSync('scripts/molde-e14-nuevo.json', 'utf8'));
  const campo = molde.campos.find((c: any) => c.id === 'suma_total');
  const ocr = await ocrTodasLasPaginas();
  const variantes = [
    { x: 0.684, y: -0.0047, w: 0.2466, h: 0.03 },
    { x: 0.684, y: -0.008, w: 0.2466, h: 0.05 },
    { x: 0.70, y: -0.006, w: 0.23, h: 0.045 },
    { x: 0.684, y: -0.002, w: 0.2466, h: 0.04 },
    { x: 0.72, y: -0.004, w: 0.21, h: 0.05 },
  ];
  for (const v of variantes) {
    const lecturas: string[] = [];
    for (const d of DOCS) {
      const esperado = [campo.ancla.rect.x, campo.ancla.rect.y, campo.ancla.rect.w, campo.ancla.rect.h] as [number, number, number, number];
      const hit = buscarAncla(campo.ancla.texto, ocr[`${d.doc}-p1`], esperado);
      const rect: [number, number, number, number] = hit && hit.score >= 0.72
        ? [v.x, hit.rect[1] + v.y, v.w, v.h]
        : [v.x, campo.ancla.rect.y + v.y, v.w, v.h];
      const primera = await ocrTextoZona(d.p1, rect, campo.whitelist);
      lecturas.push(`"${primera.texto.trim() || '(vacio)'}"`);
    }
    const ok = DOCS.filter((d, i) => lecturas[i].replace(/\s/g, '') === ESPERA[d.doc]).length;
    console.log(`zona=[x=${v.x} y=${v.y} w=${v.w} h=${v.h}] correctas=${ok}/3  ${DOCS.map((d, i) => `${d.doc}:${lecturas[i]}`).join('  ')}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
