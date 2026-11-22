// Calibración del molde Acta E-14 Exterior (consul/embajador + transmisión).
// 1) OCR (spa, psm4, 1000px) de las 6 páginas y caché de palabras.
// 2) Imprime rects de anclas sobre la plantilla de referencia.
// 3) Evalúa un molde JSON contra los 3 documentos (como el motor de la app).
// Uso:
//   bun scripts/calibrar-e14-nuevo.ts anclas    -> rects de anclas de referencia
//   bun scripts/calibrar-e14-nuevo.ts probar    -> evalúa el molde en los 3 docs
//   bun scripts/calibrar-e14-nuevo.ts crear     -> genera el JSON del molde

import { createWorker, type Worker } from 'tesseract.js';
import sharp from 'sharp';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const DIR = 'scripts/actas-nuevas';
const CACHE = 'scripts/actas-nuevas/ocr-cache.json';
const MOLDE_PATH = 'templates/e14/molde-e14.json';

const DOCS = [
  { doc: 'plantilla', p1: `${DIR}/plantilla-nairobi-1.png`, p2: `${DIR}/plantilla-nairobi-2.png`, tipo: 'escaneo' },
  { doc: 'transmision', p1: `${DIR}/transmision-barcelona-1.png`, p2: `${DIR}/transmision-barcelona-2.png`, tipo: 'escaneo' },
  { doc: 'cairo', p1: `${DIR}/foto-cairo-1.png`, p2: `${DIR}/foto-cairo-2.png`, tipo: 'foto' },
];

export interface Pal { t: string; x0: number; y0: number; x1: number; y1: number; c: number }
export interface PagOcr { pals: Pal[]; W: number; H: number }

function normTxt(s: string): string {
  return s.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array<number>(n + 1), cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/** Igual que buscarAncla del motor (con fallback orden-insensible). */
export function buscarAncla(texto: string, pag: PagOcr, esperado?: [number, number, number, number]) {
  const objetivo = normTxt(texto);
  const objetivoPals = objetivo.split(' ');
  const tol = Math.max(1, Math.floor(objetivo.length * 0.35));
  const objetivoOrdenado = normTxt([...objetivoPals].sort((a, b) => a.localeCompare(b)).join(' '));
  const orden = [...pag.pals].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const lineas: Pal[][] = [];
  for (const p of orden) {
    const l = lineas[lineas.length - 1];
    if (l && Math.abs(p.y0 - l[0].y0) < Math.max(10, (l[0].y1 - l[0].y0) * 0.6)) l.push(p);
    else lineas.push([p]);
  }
  let mejor: { rect: [number, number, number, number]; score: number } | null = null;
  for (const l of lineas) {
    const n = l.length;
    for (let i = 0; i < n; i++) {
      for (let j = i; j < Math.min(n, i + objetivoPals.length + 1); j++) {
        const ventana = l.slice(i, j + 1);
        const frase = normTxt(ventana.map((p) => p.t).join(' '));
        const fraseOrd = normTxt(ventana.map((p) => p.t).sort((a, b) => a.localeCompare(b)).join(' '));
        if (!frase) continue;
        let score = -1;
        const d = editDistance(objetivo, frase);
        if (d <= tol) score = 1 - d / objetivo.length;
        if (fraseOrd) {
          const dOrd = editDistance(objetivoOrdenado, fraseOrd);
          if (dOrd <= tol) score = Math.max(score, (1 - dOrd / objetivo.length) * 0.95);
        }
        if (score < 0) continue;
        if (esperado) {
          const cx = (ventana[0].x0 + ventana[ventana.length - 1].x1) / 2 / pag.W;
          const cy = (ventana[0].y0 + ventana[ventana.length - 1].y1) / 2 / pag.H;
          const dx = Math.abs(cx - (esperado[0] + esperado[2] / 2));
          const dy = Math.abs(cy - (esperado[1] + esperado[3] / 2));
          score *= Math.max(0.1, 1 - (dx + dy) * 4);
        }
        const rect: [number, number, number, number] = [
          ventana[0].x0 / pag.W,
          ventana[0].y0 / pag.H,
          (ventana[ventana.length - 1].x1 - ventana[0].x0) / pag.W,
          (ventana[ventana.length - 1].y1 - ventana[0].y0) / pag.H,
        ];
        if (!mejor || score > mejor.score) mejor = { rect, score };
      }
    }
  }
  return mejor;
}

// ---- OCR cache ----
let worker: Worker | null = null;
async function getWorker(): Promise<Worker> {
  if (!worker) {
    worker = await createWorker('spa', 1, {});
    await worker.setParameters({ tessedit_pageseg_mode: '4' as never, preserve_interword_spaces: '1' });
  }
  return worker;
}

export async function ocrTodasLasPaginas(): Promise<Record<string, PagOcr>> {
  if (existsSync(CACHE)) {
    console.log('OCR cache encontrado (scripts/actas-nuevas/ocr-cache.json)');
    return JSON.parse(readFileSync(CACHE, 'utf8'));
  }
  const w = await getWorker();
  const out: Record<string, PagOcr> = {};
  for (const d of DOCS) {
    for (const [key, path] of [[`${d.doc}-p1`, d.p1], [`${d.doc}-p2`, d.p2]] as const) {
      const buf = await sharp(path).resize({ width: 1000 }).png().toBuffer();
      const meta = await sharp(buf).metadata();
      const W = meta.width ?? 1000, H = meta.height ?? 1000;
      const { data } = await w.recognize(buf, {}, { text: true, blocks: true });
      const pals: Pal[] = [];
      const blocks = (data as unknown as { blocks?: unknown[] }).blocks ?? [];
      for (const b of blocks as Array<{ paragraphs?: Array<{ lines?: Array<{ words?: Array<{ text: string; bbox: { x0: number; y0: number; x1: number; y1: number }; confidence: number }> }> }> }>) {
        for (const p of b.paragraphs ?? []) {
          for (const l of p.lines ?? []) {
            for (const wd of l.words ?? []) {
              const t = (wd.text ?? '').trim();
              if (t) pals.push({ t, x0: wd.bbox.x0, y0: wd.bbox.y0, x1: wd.bbox.x1, y1: wd.bbox.y1, c: wd.confidence });
            }
          }
        }
      }
      out[key] = { pals, W, H };
      console.log(`OCR ${key}: ${pals.length} palabras (${W}x${H})`);
    }
  }
  writeFileSync(CACHE, JSON.stringify(out));
  return out;
}

// ---- medición de tinta (port de imageproc, misma lógica) ----
function gaussianKernel(blockSize: number): Float32Array {
  const sigma = 0.3 * ((blockSize - 1) * 0.5 - 1) + 0.8;
  const r = (blockSize - 1) >> 1;
  const k = new Float32Array(blockSize);
  let sum = 0;
  for (let i = 0; i < blockSize; i++) {
    const v = Math.exp(-((i - r) * (i - r)) / (2 * sigma * sigma));
    k[i] = v;
    sum += v;
  }
  for (let i = 0; i < blockSize; i++) k[i] /= sum;
  return k;
}

function blurReplicate(src: Float32Array, w: number, h: number, kernel: Float32Array): Float32Array {
  const r = (kernel.length - 1) >> 1;
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += src[row + Math.min(w - 1, Math.max(0, x + k))] * kernel[k + r];
      tmp[row + x] = acc;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x] * kernel[k + r];
      out[y * w + x] = acc;
    }
  }
  return out;
}

function adaptiveThresholdInv(gray: Uint8Array, w: number, h: number, blockSize = 31, C = 12): Uint8Array {
  const f = new Float32Array(gray.length);
  for (let i = 0; i < gray.length; i++) f[i] = gray[i];
  const b = blurReplicate(f, w, h, gaussianKernel(blockSize));
  const out = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) out[i] = gray[i] <= Math.round(b[i]) - C ? 1 : 0;
  return out;
}

function opening1D(bin: Uint8Array, w: number, h: number, k: number, dir: 'h' | 'v'): Uint8Array {
  const out = new Uint8Array(w * h);
  const n = dir === 'h' ? w : h;
  const lines = dir === 'h' ? h : w;
  const r = (k - 1) >> 1;
  const idx = dir === 'h' ? (i: number, j: number) => i * w + j : (i: number, j: number) => j * w + i;
  const deque = new Int32Array(n + 1);
  const eroded = new Uint8Array(n);
  for (let i = 0; i < lines; i++) {
    let head = 0, tail = 0;
    for (let j = 0; j < n; j++) {
      const v = bin[idx(i, j)];
      while (tail > head && bin[idx(i, deque[tail - 1])] >= v) tail--;
      deque[tail++] = j;
      const jmin = Math.max(0, j - r);
      while (deque[head] < jmin) head++;
      eroded[j] = bin[idx(i, deque[head])];
    }
    head = 0; tail = 0;
    const dil = new Uint8Array(n);
    for (let j = 0; j < n; j++) {
      const v = eroded[j];
      while (tail > head && eroded[deque[tail - 1]] <= v) tail--;
      deque[tail++] = j;
      const jmin = Math.max(0, j - r);
      while (deque[head] < jmin) head++;
      dil[j] = eroded[deque[head]];
    }
    if (dir === 'h') out.set(dil, i * w);
    else for (let j = 0; j < n; j++) out[j * w + i] = dil[j];
  }
  return out;
}

export function binarizeNoLines(gray: Uint8Array, w: number, h: number): Uint8Array {
  const bin = adaptiveThresholdInv(gray, w, h, 31, 12);
  const k = Math.max(20, Math.floor(w * 0.083)) | 1;
  const hor = opening1D(bin, w, h, k, 'h');
  const ver = opening1D(bin, w, h, k, 'v');
  const data = new Uint8Array(w * h);
  for (let i = 0; i < data.length; i++) data[i] = bin[i] && !(hor[i] || ver[i]) ? 1 : 0;
  return data;
}

export function connectedComponents(bin: Uint8Array, w: number, h: number) {
  const labels = new Int32Array(w * h).fill(-1);
  const stats: Array<{ x: number; y: number; w: number; h: number; area: number }> = [];
  const stack = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (bin[start] === 0 || labels[start] !== -1) continue;
    const id = stats.length;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = id;
    let minX = w, maxX = -1, minY = h, maxY = -1, area = 0;
    while (sp > 0) {
      const p = stack[--sp];
      const px = p % w, py = (p / w) | 0;
      area++;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      const y0 = Math.max(0, py - 1), y1 = Math.min(h - 1, py + 1);
      const x0 = Math.max(0, px - 1), x1 = Math.min(w - 1, px + 1);
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          const q = yy * w + xx;
          if (bin[q] === 1 && labels[q] === -1) { labels[q] = id; stack[sp++] = q; }
        }
      }
    }
    stats.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, area });
  }
  return { labels, stats };
}

/** Densidad de tinta en la zona (px) con filtro de líneas — igual que inkRatio del motor. */
export function inkRatio(bin: Uint8Array, W: number, zone: [number, number, number, number]): number {
  const [zx0, zy0, zx1, zy1] = zone;
  const x0 = Math.max(0, Math.floor(zx0)), y0 = Math.max(0, Math.floor(zy0));
  const x1 = Math.min(W, Math.ceil(zx1)), y1 = Math.min(W, Math.ceil(zy1));
  const zw = x1 - x0, zh = y1 - y0;
  if (zw <= 0 || zh <= 0) return 0;
  const H = bin.length / W;
  if (y1 > H) return 0;
  const crop = new Uint8Array(zw * zh);
  for (let y = 0; y < zh; y++) for (let x = 0; x < zw; x++) crop[y * zw + x] = bin[(y0 + y) * W + x0 + x];
  const { labels, stats } = connectedComponents(crop, zw, zh);
  for (let i = 0; i < stats.length; i++) {
    const s = stats[i];
    if (s.w >= 0.5 * zw && s.area <= 6 * s.w) {
      for (let y = s.y; y < s.y + s.h; y++) {
        for (let x = s.x; x < s.x + s.w; x++) {
          if (labels[y * zw + x] === i) crop[y * zw + x] = 0;
        }
      }
    }
  }
  let ink = 0;
  for (let i = 0; i < crop.length; i++) ink += crop[i];
  return ink / crop.length;
}

/** Grises de una zona (px) desde el PNG a 1000px. */
export async function grisesZona(path: string, rect: [number, number, number, number]) {
  const { data, info } = await sharp(path).resize({ width: 1000 }).grayscale().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const mx = rect[2] * 0.004 + 0.002, my = rect[3] * 0.004 + 0.002;
  const x0 = Math.max(0, Math.floor((rect[0] - mx) * W));
  const y0 = Math.max(0, Math.floor((rect[1] - my) * H));
  const x1 = Math.min(W, Math.ceil((rect[0] + rect[2] + mx) * W));
  const y1 = Math.min(H, Math.ceil((rect[1] + rect[3] + my) * H));
  const zw = x1 - x0, zh = y1 - y0;
  if (zw <= 2 || zh <= 2) return null;
  const gray = new Uint8Array(zw * zh);
  for (let y = 0; y < zh; y++) for (let x = 0; x < zw; x++) gray[y * zw + x] = data[(y0 + y) * W + x0 + x];
  return { gray, zw, zh };
}

export function medirTinta(path: string, rect: [number, number, number, number]): number | null {
  return grisesZona(path, rect).then((z) => {
    if (!z) return null;
    const bin = binarizeNoLines(z.gray, z.zw, z.zh);
    return inkRatio(bin, z.zw, [0, 0, z.zw, z.zh]);
  });
}

/** OCR de una zona (psm 7, whitelist opcional) — igual que ocrTextoUnico. */
export async function ocrTextoZona(path: string, rect: [number, number, number, number], whitelist?: string) {
  const z = await grisesZona(path, rect);
  if (!z) return { texto: '', conf: 0 };
  const png = await sharp(Buffer.from(z.gray), { raw: { width: z.zw, height: z.zh, channels: 1 } })
    .png().toBuffer();
  const w = await getWorker();
  await w.setParameters({
    tessedit_pageseg_mode: '7' as never,
    tessedit_char_whitelist: whitelist ?? '',
  });
  const ret = await w.recognize(png, {}, { text: true, blocks: false });
  const conf = (ret.data as unknown as { confidence?: number }).confidence ?? 0;
  return { texto: (ret.data.text ?? '').trim().replace(/\s+/g, ' '), conf: conf / 100 };
}

// ---- comandos ----

const ANCLAS_REF = {
  p1: [
    'CONSULADO', 'PAIS', 'ZONA', 'PUESTO', 'MESA', 'LUGAR',
    'TOTAL VOTANTES FORMULARIO E11', 'TOTAL VOTOS EN LA URNA', 'TOTAL VOTOS INCINERADOS',
    'IVAN CEPEDA CASTRO', 'ABELARDO DE LA ESPRIELLA',
    'VOTOS EN BLANCO', 'VOTOS NULOS', 'VOTOS NO MARCADOS', 'SUMA TOTAL',
  ],
  p2: [
    'CONSTANCIAS DE LOS JURADOS', 'HUBO RECUENTO',
    'FIRMA JURADO 1', 'FIRMA JURADO 2', 'FIRMA JURADO 3', 'FIRMA JURADO 4',
  ],
};

async function cmdAnclas() {
  const ocr = await ocrTodasLasPaginas();
  for (const pag of ['plantilla-p1', 'plantilla-p2']) {
    console.log(`\n===== ANCLAS ${pag} (${ocr[pag].W}x${ocr[pag].H}) =====`);
    const anclas = pag.endsWith('p1') ? ANCLAS_REF.p1 : ANCLAS_REF.p2;
    for (const a of anclas) {
      const hit = buscarAncla(a, ocr[pag]);
      if (hit) {
        const [x, y, w, h] = hit.rect;
        console.log(`  ${a.padEnd(34)} [${x.toFixed(4)}, ${y.toFixed(4)}, ${w.toFixed(4)}, ${h.toFixed(4)}]  score=${hit.score.toFixed(3)}`);
      } else {
        console.log(`  ${a.padEnd(34)} NO ENCONTRADA`);
      }
    }
  }
}

async function cmdProbar() {
  if (!existsSync(MOLDE_PATH)) {
    console.error(`No existe ${MOLDE_PATH}. Genera primero con: bun scripts/calibrar-e14-nuevo.ts crear`);
    process.exit(1);
  }
  const molde = JSON.parse(readFileSync(MOLDE_PATH, 'utf8'));
  const ocr = await ocrTodasLasPaginas();
  console.log(`Molde: ${molde.nombre} — ${molde.campos.length} campos`);
  for (const d of DOCS) {
    console.log(`\n===== DOC ${d.doc} (${d.tipo}) =====`);
    let ok = 0;
    for (const campo of molde.campos) {
      const pagKey = `${d.doc}-p${campo.pagina}`;
      const pag = ocr[pagKey];
      const path = campo.pagina === 1 ? d.p1 : d.p2;
      let rectFinal: [number, number, number, number] | null = null;
      let fuente = 'referencia';
      if (campo.estrategia === 'zona_fija') {
        rectFinal = [campo.zona.x, campo.zona.y, campo.zona.w, campo.zona.h];
        fuente = 'fija';
      } else if (campo.ancla) {
        const esperado = campo.ancla.rect ? [campo.ancla.rect.x, campo.ancla.rect.y, campo.ancla.rect.w, campo.ancla.rect.h] as [number, number, number, number] : undefined;
        const hit = buscarAncla(campo.ancla.texto, pag, esperado);
        if (hit && hit.score >= 0.72) {
          rectFinal = [
            campo.x_absoluto ? campo.zona.x : hit.rect[0] + campo.zona.x,
            hit.rect[1] + campo.zona.y,
            campo.zona.w,
            campo.zona.h,
          ];
          fuente = 'ancla';
        } else if (campo.ancla_respaldo) {
          const h2 = buscarAncla(campo.ancla_respaldo, pag, esperado);
          if (h2 && h2.score >= 0.72) {
            rectFinal = [
              campo.x_absoluto ? campo.zona.x : h2.rect[0] + campo.zona.x,
              h2.rect[1] + campo.zona.y,
              campo.zona.w,
              campo.zona.h,
            ];
            fuente = 'respaldo';
          }
        }
        if (!rectFinal && campo.ancla.rect) {
          rectFinal = [
            campo.x_absoluto ? campo.zona.x : campo.ancla.rect.x + campo.zona.x,
            campo.ancla.rect.y + campo.zona.y,
            campo.zona.w,
            campo.zona.h,
          ];
          fuente = 'referencia';
        }
      }
      if (!rectFinal) {
        console.log(`  ✗ ${campo.etiqueta.padEnd(42)} sin rect`);
        continue;
      }
      if (campo.tipo === 'texto') {
        const primera = await ocrTextoZona(path, rectFinal, campo.whitelist);
        let valor = primera.texto;
        let conf = primera.conf;
        const cumple = (v: string) => !campo.patron || new RegExp(campo.patron, 'i').test(v);
        if ((!valor || !cumple(valor) || conf < 0.5) && campo.realce) {
          // realce: contraste + ampliación 3x + otsu (igual que el motor)
          const z = await grisesZona(path, rectFinal);
          if (z) {
            const hist = new Uint32Array(256);
            for (let i = 0; i < z.gray.length; i++) hist[z.gray[i]]++;
            const n = z.gray.length;
            let acc = 0, p5 = 0, p95 = 255;
            for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.05) { p5 = v; break; } }
            acc = 0;
            for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.95) { p95 = v; break; } }
            const span = Math.max(8, p95 - p5);
            const realzado = new Uint8Array(z.gray.length);
            for (let i = 0; i < z.gray.length; i++) {
              realzado[i] = Math.min(255, Math.max(0, ((z.gray[i] - p5) * 255 / span))) | 0;
            }
            const escala = Math.min(4, Math.floor(4000 / z.zw)) || 4;
            const pngGray4 = await sharp(Buffer.from(z.gray), { raw: { width: z.zw, height: z.zh, channels: 1 } })
              .resize({ width: z.zw * escala, height: z.zh * escala, kernel: 'cubic' })
              .png().toBuffer();
            const pngBig = await sharp(Buffer.from(realzado), { raw: { width: z.zw, height: z.zh, channels: 1 } })
              .resize({ width: z.zw * escala, height: z.zh * escala, kernel: 'cubic' })
              .png().toBuffer();
            const variantes: Array<{ png: Buffer; otsu: boolean; psm: '7' | '8' | '13' }> = [
              { png: pngGray4, otsu: false, psm: '7' },
            ];
            // otsu del realzado
            const hist2 = new Uint32Array(256);
            for (let i = 0; i < realzado.length; i++) hist2[realzado[i]]++;
            let sum = 0;
            for (let t = 0; t < 256; t++) sum += t * hist2[t];
            let sumB = 0, wB = 0, best = 0, thr = 127;
            for (let t = 0; t < 256; t++) {
              wB += hist2[t];
              if (wB === 0) continue;
              const wF = realzado.length - wB;
              if (wF === 0) break;
              sumB += t * hist2[t];
              const mB = sumB / wB, mF = (sum - sumB) / wF;
              const between = wB * wF * (mB - mF) * (mB - mF);
              if (between > best) { best = between; thr = t; }
            }
            const otsu = new Uint8Array(realzado.length);
            for (let i = 0; i < realzado.length; i++) otsu[i] = realzado[i] <= thr ? 0 : 255;
            const pngOtsu = await sharp(Buffer.from(otsu), { raw: { width: z.zw, height: z.zh, channels: 1 } })
              .resize({ width: z.zw * escala, height: z.zh * escala, kernel: 'cubic' })
              .png().toBuffer();
            variantes.push({ png: pngOtsu, otsu: true, psm: '7' }, { png: pngBig, otsu: false, psm: '8' }, { png: pngBig, otsu: false, psm: '13' }, { png: pngOtsu, otsu: true, psm: '13' });
            for (const v of variantes) {
              const wkr = await getWorker();
              await wkr.setParameters({ tessedit_pageseg_mode: v.psm as never, tessedit_char_whitelist: campo.whitelist ?? '' });
              const re = await wkr.recognize(v.png, {}, { text: true, blocks: false });
              const t = (re.data.text ?? '').trim().replace(/\s+/g, ' ');
              if (!t) continue;
              if (cumple(t)) { valor = t; conf = ((re.data as unknown as { confidence?: number }).confidence ?? 0) / 100; fuente += '+realce'; break; }
              if (!valor) { valor = t; conf = ((re.data as unknown as { confidence?: number }).confidence ?? 0) / 100; fuente += '+realce'; }
            }
          }
        }
        const estadoOk = valor && cumple(valor) ? 'OK' : 'FAIL';
        if (estadoOk === 'OK') ok++;
        console.log(`  ${estadoOk === 'OK' ? '✓' : '✗'} ${campo.etiqueta.padEnd(42)} "${(valor || '').slice(0, 40)}"  conf=${conf.toFixed(2)}  ${fuente}  rect=[${rectFinal.map((v) => v.toFixed(3)).join(',')}]`);
      } else {
        const ratio = await medirTinta(path, rectFinal);
        if (ratio === null) { console.log(`  ✗ ${campo.etiqueta.padEnd(42)} zona_invalida`); continue; }
        const dilig = ratio >= campo.umbral;
        if (dilig) ok++;
        console.log(`  ${dilig ? '✓' : '✗'} ${campo.etiqueta.padEnd(42)} ratio=${ratio.toFixed(4)} umbral=${campo.umbral} ${dilig ? 'DILIGENCIADO' : 'VACIO'}  ${fuente}  rect=[${rectFinal.map((v) => v.toFixed(3)).join(',')}]`);
      }
    }
    console.log(`  ----> ${ok}/${molde.campos.length} campos OK`);
  }
}

async function main() {
  const cmd = process.argv[2] ?? 'anclas';
  if (cmd === 'anclas') await cmdAnclas();
  else if (cmd === 'probar') await cmdProbar();
  else console.error('Comandos: anclas | probar');
  worker?.terminate();
}
main().catch((e) => { console.error(e); process.exit(1); });
