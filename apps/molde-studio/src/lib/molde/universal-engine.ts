'use client';

// Motor universal v3: evalúa un molde (zona_fija / ancla_relativa) sobre
// páginas renderizadas (foto o PDF). Todo en el navegador con Tesseract.js.
//
// Pipeline por página:
//   1. OCR completo (líneas con palabras y bbox) — una sola pasada.
//   2. Para cada campo de esa página:
//      - Resolver el rect final (fijo, ancla fuzzy, respaldo o fallback).
//      - Recortar y binarizar sin líneas impresas -> densidad de tinta.
//      - tipo presencia/firma/checkbox: diligenciado si ratio >= umbral.
//      - tipo texto: OCR del recorte (psm 7) + regex opcional.
//      - Generar la captura JPEG de la zona (crop) para la verificación.

import {
  binarizeNoLines,
  canvasGrayscale,
  canvasOtsu,
  canvasRealce,
  inkRatio,
} from '@/lib/molde/imageproc';
import { ocrLines, ocrTextoUnico } from '@/lib/ocr/ocr-client';
import { canvasToJpeg } from '@/lib/ocr/pdf-client';
import type { LineaOcr } from '@/lib/molde/types';
import {
  hexTipo,
  type CampoUniversal,
  type MoldeUniversal,
  type RectNorm,
  type ResultadoCampoUniversal,
  type ResultadoPaginaUniversal,
  type ResultadoUniversal,
} from './universal-types';

// ---- utilidades ----

export function normTxt(s: string): string {
  return s
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array<number>(n + 1);
  let cur = new Array<number>(n + 1);
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

export interface HitAncla {
  rect: RectNorm;
  score: number;
}

/** Busca un texto (fuzzy) en las líneas OCR. Prioriza cercanía a rect esperado. */
export function buscarAncla(
  texto: string,
  lineas: LineaOcr[],
  canvasW: number,
  canvasH: number,
  rectEsperado?: RectNorm,
): HitAncla | null {
  const objetivo = normTxt(texto);
  if (!objetivo) return null;
  const objetivoPals = objetivo.split(' ');
  const tol = Math.max(1, Math.floor(objetivo.length * 0.35));
  let mejor: HitAncla | null = null;
  for (const l of lineas) {
    const palabras = l.palabras;
    const n = palabras.length;
    for (let i = 0; i < n; i++) {
      for (let j = i; j < Math.min(n, i + objetivoPals.length + 1); j++) {
        const frase = normTxt(palabras.slice(i, j + 1).map((p) => p.texto).join(' '));
        if (!frase) continue;
        const d = editDistance(objetivo, frase);
        if (d > tol) continue;
        let score = 1 - d / objetivo.length;
        if (rectEsperado) {
          const cx = (palabras[i].bbox[0] + palabras[j].bbox[2]) / 2 / canvasW;
          const cy = (palabras[i].bbox[1] + palabras[j].bbox[3]) / 2 / canvasH;
          const dx = Math.abs(cx - (rectEsperado.x + rectEsperado.w / 2));
          const dy = Math.abs(cy - (rectEsperado.y + rectEsperado.h / 2));
          score *= Math.max(0.1, 1 - (dx + dy) * 4);
        }
        if (!mejor || score > mejor.score) {
          mejor = {
            rect: {
              x: palabras[i].bbox[0] / canvasW,
              y: palabras[i].bbox[1] / canvasH,
              w: (palabras[j].bbox[2] - palabras[i].bbox[0]) / canvasW,
              h: (palabras[j].bbox[3] - palabras[i].bbox[1]) / canvasH,
            },
            score,
          };
        }
      }
    }
  }
  return mejor;
}

export interface RectResuelto {
  rect: RectNorm;
  fuente: 'ancla' | 'respaldo' | 'referencia' | 'fija';
  ancla_encontrada: boolean;
  score?: number;
}

/** Resuelve el rectángulo final de un campo sobre una página OCR-izada. */
export function resolverRectCampo(
  campo: CampoUniversal,
  lineas: LineaOcr[],
  canvasW: number,
  canvasH: number,
): RectResuelto | null {
  if (campo.estrategia === 'zona_fija') {
    return { rect: { ...campo.zona }, fuente: 'fija', ancla_encontrada: true };
  }
  const ancla = campo.ancla;
  if (!ancla?.texto) return null;

  const aplicarOffset = (base: RectNorm): RectNorm => ({
    x: campo.x_absoluto ? campo.zona.x : base.x + campo.zona.x,
    y: base.y + campo.zona.y,
    w: campo.zona.w,
    h: campo.zona.h,
  });

  const hit = buscarAncla(ancla.texto, lineas, canvasW, canvasH, ancla.rect);
  if (hit) {
    return { rect: aplicarOffset(hit.rect), fuente: 'ancla', ancla_encontrada: true, score: hit.score };
  }
  if (campo.ancla_respaldo) {
    const hit2 = buscarAncla(campo.ancla_respaldo, lineas, canvasW, canvasH, ancla.rect);
    if (hit2) {
      return { rect: aplicarOffset(hit2.rect), fuente: 'respaldo', ancla_encontrada: true, score: hit2.score };
    }
  }
  // Fallback: usar la posición de referencia guardada en el molde.
  if (ancla.rect) {
    return { rect: aplicarOffset(ancla.rect), fuente: 'referencia', ancla_encontrada: false };
  }
  return null;
}

/** Rect resuelto SIN OCR (para dibujar en el editor): usa la referencia guardada. */
export function rectEditor(campo: CampoUniversal): RectNorm | null {
  if (campo.estrategia === 'zona_fija') return { ...campo.zona };
  if (!campo.ancla?.rect) return campo.ancla?.texto ? null : { ...campo.zona };
  return {
    x: campo.x_absoluto ? campo.zona.x : campo.ancla.rect.x + campo.zona.x,
    y: campo.ancla.rect.y + campo.zona.y,
    w: campo.zona.w,
    h: campo.zona.h,
  };
}

function rectAPx(rect: RectNorm, w: number, h: number, margen = 0.004): [number, number, number, number] {
  const mx = rect.w * margen + 0.002;
  const my = rect.h * margen + 0.002;
  const x0 = Math.max(0, Math.floor((rect.x - mx) * w));
  const y0 = Math.max(0, Math.floor((rect.y - my) * h));
  const x1 = Math.min(w, Math.ceil((rect.x + rect.w + mx) * w));
  const y1 = Math.min(h, Math.ceil((rect.y + rect.h + my) * h));
  return [x0, y0, x1 - x0, y1 - y0];
}

function recortar(
  canvas: HTMLCanvasElement,
  rect: RectNorm,
): { crop: HTMLCanvasElement } | null {
  const [x, y, cw, ch] = rectAPx(rect, canvas.width, canvas.height);
  if (cw <= 2 || ch <= 2) return null;
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(canvas, x, y, cw, ch, 0, 0, cw, ch);
  return { crop: c };
}

function cropDataUrl(canvas: HTMLCanvasElement, rect: RectNorm, maxPx = 420, q = 0.72): string | null {
  const r = recortar(canvas, rect);
  if (!r) return null;
  const { crop } = r;
  let src = crop;
  if (crop.width > maxPx) {
    src = document.createElement('canvas');
    src.width = maxPx;
    src.height = Math.max(1, Math.round((crop.height * maxPx) / crop.width));
    const ctx = src.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(crop, 0, 0, src.width, src.height);
  }
  return src.toDataURL('image/jpeg', q);
}

function medirTinta(crop: HTMLCanvasElement): number {
  const gray = canvasGrayscale(crop);
  const ctx = gray.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, gray.width, gray.height);
  const g = new Uint8Array(gray.width * gray.height);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = img.data[p];
  const bin = binarizeNoLines(g, gray.width, gray.height, 0.083);
  return inkRatio(bin, [0, 0, gray.width, gray.height], { fraccion_ancho: 0.5, grosor_max: 6 });
}

function confPresencia(ratio: number, umbral: number): number {
  const margen = Math.abs(ratio - umbral) / Math.max(umbral, 0.02);
  return Math.min(0.97, 0.55 + 0.42 * Math.min(1, margen));
}

// ---- evaluación de un campo ----

async function evaluarCampo(
  campo: CampoUniversal,
  canvas: HTMLCanvasElement,
  lineas: LineaOcr[],
): Promise<ResultadoCampoUniversal> {
  const base: ResultadoCampoUniversal = {
    id: campo.id,
    etiqueta: campo.etiqueta,
    tipo: campo.tipo,
    pagina: campo.pagina,
    estado: 'no_encontrado',
    valor: null,
    conf: 0,
    rect: null,
    crop: null,
    fuente: null,
    banderas: [],
  };
  const resuelto = resolverRectCampo(campo, lineas, canvas.width, canvas.height);
  if (!resuelto) {
    base.banderas.push('sin_rect');
    if (campo.estrategia === 'ancla_relativa') base.banderas.push('ancla_no_encontrada');
    return base;
  }
  base.rect = resuelto.rect;
  base.fuente = resuelto.fuente;
  if (!resuelto.ancla_encontrada) base.banderas.push('ancla_no_encontrada');
  if (resuelto.fuente === 'respaldo') base.banderas.push('ancla_respaldo');

  const rec = recortar(canvas, resuelto.rect);
  if (!rec) {
    base.banderas.push('zona_invalida');
    return base;
  }

  const ratio = medirTinta(rec.crop);
  base.ratio = ratio;

  if (campo.tipo === 'presencia' || campo.tipo === 'firma' || campo.tipo === 'checkbox') {
    const diligenciado = ratio >= campo.umbral;
    base.estado = diligenciado ? 'ok' : 'no_encontrado';
    base.valor = diligenciado;
    base.conf = confPresencia(ratio, campo.umbral);
    if (diligenciado && Math.abs(ratio - campo.umbral) / Math.max(campo.umbral, 0.02) < 0.25) {
      base.banderas.push('umbral_al_borde');
    }
    base.crop = cropDataUrl(canvas, resuelto.rect);
    return base;
  }

  // tipo texto: OCR de la línea del recorte
  const { texto, conf: confOcr } = await ocrTextoUnico(rec.crop, { whitelist: campo.whitelist });
  const limpio = texto.replace(/\s+/g, ' ').trim();
  base.crop = cropDataUrl(canvas, resuelto.rect);
  base.conf = confOcr;
  if (!limpio) {
    base.banderas.push('ocr_vacio');
    if (ratio < campo.umbral * 0.6) base.banderas.push('zona_vacia');
    if (!campo.realce) return base;
  }
  let valorFinal = limpio;
  let confFinal = confOcr;
  const cumplePatron = (v: string): boolean => {
    if (!campo.patron) return true;
    try {
      return new RegExp(campo.patron, 'i').test(v);
    } catch {
      base.banderas.push('patron_invalido');
      return true;
    }
  };
  if (campo.realce && (!valorFinal || !cumplePatron(valorFinal))) {
    // Reintento con realce (grises + contraste percentil + ampliación 3x) y,
    // si sigue fallando, con binarización Otsu y psm 8 — misma ruta que la
    // relectura del ID del acta. Se acepta la primera lectura que cumpla.
    const realzado = canvasRealce(rec.crop, 3);
    const variantes: Array<{ c: HTMLCanvasElement; psm: '7' | '8' }> = [
      { c: realzado, psm: '7' },
      { c: canvasOtsu(realzado), psm: '7' },
      { c: realzado, psm: '8' },
    ];
    for (const v of variantes) {
      const re = await ocrTextoUnico(v.c, { whitelist: campo.whitelist, psm: v.psm });
      const limpioRe = re.texto.replace(/\s+/g, ' ').trim();
      if (!limpioRe) continue;
      if (cumplePatron(limpioRe)) {
        valorFinal = limpioRe;
        confFinal = re.conf;
        base.banderas.push('realce_retry');
        break;
      }
      if (!valorFinal) {
        // sin primera lectura: aceptar aunque no cumpla el patrón (peor es nada)
        valorFinal = limpioRe;
        confFinal = re.conf;
        base.banderas.push('realce_retry', 'patron_no_cumple');
        break;
      }
    }
  }
  if (!valorFinal) return base;
  base.valor = valorFinal;
  base.conf = confFinal;
  if (!cumplePatron(valorFinal)) {
    base.banderas.push('patron_no_cumple');
    return base;
  }
  base.estado = 'ok';
  return base;
}

// ---- evaluación de un documento completo ----

export async function evaluarDocumentoUniversal(
  canvases: HTMLCanvasElement[],
  molde: MoldeUniversal,
  nombreArchivo: string,
  onProgreso?: (msg: string) => void,
): Promise<ResultadoUniversal> {
  const t0 = performance.now();
  const renderMs = 0;
  const paginas: ResultadoPaginaUniversal[] = [];
  const ocrMsTotal = 0;
  let ocrMs = 0;
  const motorT0 = performance.now();

  for (let p = 0; p < canvases.length; p++) {
    const canvas = canvases[p];
    onProgreso?.(`OCR página ${p + 1}/${canvases.length}...`);
    const tOcr = performance.now();
    const { lines, conf } = await ocrLines(canvas);
    ocrMs += performance.now() - tOcr;

    const camposPagina = molde.campos.filter((c) => c.pagina === p + 1);
    const resultados: ResultadoCampoUniversal[] = [];
    for (let i = 0; i < camposPagina.length; i++) {
      const c = camposPagina[i];
      onProgreso?.(`Página ${p + 1}: campo ${i + 1}/${camposPagina.length} — ${c.etiqueta}`);
      resultados.push(await evaluarCampo(c, canvas, lines));
    }
    paginas.push({
      pagina: p + 1,
      ocr_conf: conf,
      preview: canvasToJpeg(canvas, 900, 0.7),
      campos: resultados,
    });
  }

  // campos de páginas inexistentes
  const faltantes: ResultadoCampoUniversal[] = molde.campos
    .filter((c) => c.pagina > canvases.length)
    .map((c) => ({
      id: c.id,
      etiqueta: c.etiqueta,
      tipo: c.tipo,
      pagina: c.pagina,
      estado: 'no_encontrado',
      valor: null,
      conf: 0,
      rect: null,
      crop: null,
      fuente: null,
      banderas: ['pagina_faltante'],
    }));
  if (faltantes.length) {
    paginas.push({ pagina: -1, ocr_conf: 0, campos: faltantes });
  }

  const motorMs = performance.now() - motorT0;
  const todos = paginas.flatMap((p) => p.campos);
  const ok = todos.filter((r) => r.estado === 'ok');
  const obligatoriosFaltantes = molde.campos
    .filter((c) => c.obligatorio)
    .filter((c) => !todos.some((r) => r.id === c.id && r.estado === 'ok'))
    .map((c) => c.etiqueta);

  return {
    archivo: nombreArchivo,
    paginas,
    total: todos.length,
    ok_count: ok.length,
    score: todos.length ? Math.round((ok.length / todos.length) * 1000) / 10 : 0,
    obligatorios_faltantes: obligatoriosFaltantes,
    requiere_revision: obligatoriosFaltantes.length > 0,
    tiempos: { render_ms: Math.round(renderMs), ocr_ms: Math.round(ocrMs), motor_ms: Math.round(motorMs + (performance.now() - t0 - ocrMs - motorMs)) },
  };
}

/** Alinea las anclas de un molde con el OCR de la imagen de referencia de UNA página.
 * Devuelve un nuevo molde con ancla.rect actualizada donde se encontró. */
export async function alinearAnclas(
  molde: MoldeUniversal,
  canvas: HTMLCanvasElement,
  pagina?: number,
): Promise<{ molde: MoldeUniversal; encontradas: number; total: number; detalles: Record<string, 'ancla' | 'respaldo' | 'no'> }> {
  const { lines } = await ocrLines(canvas);
  const detalles: Record<string, 'ancla' | 'respaldo' | 'no'> = {};
  let encontradas = 0;
  const campos = molde.campos.map((c) => {
    if (c.estrategia !== 'ancla_relativa' || !c.ancla?.texto) return c;
    if (pagina !== undefined && c.pagina !== pagina) return c;
    const hit = buscarAncla(c.ancla.texto, lines, canvas.width, canvas.height, c.ancla.rect);
    if (hit) {
      encontradas++;
      detalles[c.id] = 'ancla';
      return { ...c, ancla: { ...c.ancla, rect: hit.rect } };
    }
    if (c.ancla_respaldo) {
      const hit2 = buscarAncla(c.ancla_respaldo, lines, canvas.width, canvas.height, c.ancla.rect);
      if (hit2) {
        encontradas++;
        detalles[c.id] = 'respaldo';
        return { ...c, ancla: { ...c.ancla, rect: hit2.rect } };
      }
    }
    detalles[c.id] = 'no';
    return c;
  });
  return { molde: { ...molde, campos }, encontradas, total: detalles ? Object.keys(detalles).length : 0, detalles };
}

export { hexTipo };
