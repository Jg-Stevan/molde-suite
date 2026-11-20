// Motor de extraccion v2 para el molde e14.schema.v2.json — port a TypeScript.
// Implementa fielmente la semantica del motor de referencia (verify-e14/simular_molde_v2.py):
//  - binarizacion 'sin_lineas' (elimina lineas impresas H/V por morfologia)
//  - anclas en cadena con filas_abajo (paso de fila)
//  - primitivas de zona: fila | banda | casilla_firma | fija
//  - ancla a nivel de PALABRA (fuzzy) para FIRMA JURADO n + rejilla 2x2
//  - recuento SI/NO diferencial con ventanas iguales
//  - ID: codigo de barras -> OCR -> re-OCR amplificado, consenso con tolerancia de edicion

import {
  AnclaLinea,
  CampoMolde,
  CandidatoId,
  LineaOcr,
  Molde,
  ResultadoActa,
  ResultadoCampo,
  ResultadoPagina,
  Validacion,
} from './types';
import {
  BinImage,
  FiltroLinea,
  MedidaComponentesCfg,
  binarizeNoLines,
  grayFromImageData,
  inkRatio,
  medidaCelda,
} from './imageproc';
import schema from './e14.schema.v2.json';

export const MOLDE = schema as unknown as Molde;
export const MOLDE_VERSION = MOLDE.version;

const MOTOR = MOLDE.motor;
const CAMPOS = MOLDE.campos;
const PASE_FILA = MOTOR.paso_fila ?? 0.031;
const FILTRO = MOTOR.filtro_linea_zona as FiltroLinea | undefined;
const MEDIDA = (MOTOR.medida_componentes ?? { area_min: 150, min_comps: 3, dens_alta: 0.05 }) as MedidaComponentesCfg;

// ---------- helpers OCR ----------

export function ocrTexto(lines: LineaOcr[]): string {
  return lines.map((l) => l.texto).join('\n');
}

function findLine(lines: LineaOcr[], pattern: string): LineaOcr | null {
  const rx = new RegExp(pattern, 'i');
  for (const l of lines) {
    if (rx.test(l.texto)) return l;
  }
  return null;
}

// ---------- anclas y zonas ----------

function resolverAncla(
  campo: CampoMolde,
  lines: LineaOcr[],
  H: number,
): { line: LineaOcr | null; rowY0: number | null; patron: string | null } {
  for (const a of campo.anclas ?? ([] as AnclaLinea[])) {
    const line = findLine(lines, a.patron);
    if (line) {
      const rowY0 = line.bbox[1] / H + (a.filas_abajo ?? 0) * PASE_FILA;
      return { line, rowY0, patron: a.patron };
    }
  }
  return { line: null, rowY0: null, patron: null };
}

type Zone = [number, number, number, number];

function zonaDe(
  campo: CampoMolde,
  H: number,
  W: number,
  anclaLine: LineaOcr | null,
  rowY0: number | null,
): Zone | null {
  const z = campo.zona as { tipo?: string; [k: string]: unknown } | undefined;
  const tipo = z?.tipo;
  if (tipo === 'fila' && rowY0 !== null) {
    const y0 = (rowY0 + (z!.y0_rel as number)) * H;
    const y1 = (rowY0 + (z!.y1_rel as number)) * H;
    return [(z!.columna_x0 as number) * W, y0, (z!.columna_x1 as number) * W, y1];
  }
  if (tipo === 'banda' && anclaLine) {
    const ly0 = anclaLine.bbox[1] / H;
    return [
      (z!.x0 as number) * W,
      (ly0 + (z!.y0_rel as number)) * H,
      (z!.x1 as number) * W,
      (ly0 + (z!.y1_rel as number)) * H,
    ];
  }
  if (campo.zona_fija) {
    const zf = campo.zona_fija;
    return [zf.x0 * W, zf.y0 * H, zf.x1 * W, zf.y1 * H];
  }
  return null;
}

// ---------- B4: ancla de palabra JURADO + rejilla 2x2 ----------

function findJuradoAnchors(lines: LineaOcr[], W: number): Record<number, LineaOcr['palabras'][0]> {
  const out: Record<number, LineaOcr['palabras'][0]> = {};
  for (const l of lines) {
    const ws = l.palabras;
    for (let j = 0; j < ws.length; j++) {
      const w = ws[j];
      const t = w.texto.toUpperCase();
      if (t.includes('JURADO') || t.startsWith('JURA') || t.startsWith('JUR')) {
        const cands = [w, ...ws.slice(j + 1, j + 3)];
        for (const c of cands) {
          const digits = (c.texto.match(/[1-4]/g) ?? []) as string[];
          if (digits.length > 0) {
            if (
              c.bbox[0] >= w.bbox[0] - 0.02 * W &&
              c.bbox[0] <= w.bbox[2] + 0.15 * W
            ) {
              const num = parseInt(digits[0], 10);
              if (!(num in out)) out[num] = w;
              break;
            }
          }
        }
      }
    }
  }
  return out;
}

export interface EtiquetaJurado {
  y0: number | null;
  y1: number | null;
  origen: string;
}

function resolverEtiquetasJurado(
  lines: LineaOcr[],
  W: number,
  H: number,
): Record<number, EtiquetaJurado> {
  const paso = MOTOR.paso_rejilla_firmas ?? 0.068;
  const estH = 0.01;
  const anchors = findJuradoAnchors(lines, W);
  const filas: Record<number, number[]> = {};
  for (const n of [1, 2]) {
    if (n in anchors) (filas[1] ??= []).push(anchors[n].bbox[1] / H);
  }
  for (const n of [3, 4]) {
    if (n in anchors) (filas[2] ??= []).push(anchors[n].bbox[1] / H);
  }
  const median = (arr: number[]) => {
    const s = [...arr].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const row1 = filas[1] ? median(filas[1]) : null;
  const row2 = filas[2] ? median(filas[2]) : null;
  const r1 = row1 !== null ? row1 : row2 !== null ? row2 - paso : null;
  const r2 = row2 !== null ? row2 : row1 !== null ? row1 + paso : null;
  const res: Record<number, EtiquetaJurado> = {};
  for (let n = 1; n <= 4; n++) {
    if (n in anchors) {
      const b = anchors[n].bbox;
      res[n] = { y0: b[1] / H, y1: b[3] / H, origen: 'ancla_palabra' };
    } else if (n <= 2 && r1 !== null) {
      res[n] = { y0: r1, y1: r1 + estH, origen: 'rejilla_fila1' };
    } else if (n >= 3 && r2 !== null) {
      res[n] = { y0: r2, y1: r2 + estH, origen: 'rejilla_fila2' };
    } else {
      res[n] = { y0: null, y1: null, origen: 'sin_etiqueta' };
    }
  }
  return res;
}

// ---------- B3-diferencial: recuento SI/NO ----------

interface RecuentoInfo {
  zonaSi: Zone;
  zonaNo: Zone;
  ratioSi: number;
  ratioNo: number;
  deltaNo: number;
  deltaSi: number;
}

function evalRecuento(lines: LineaOcr[], bin: BinImage): RecuentoInfo | null {
  const line = findLine(lines, 'RECUENTO');
  if (!line) return null;
  const { w: W, h: H } = bin;
  const ws = line.palabras;
  const [lx0, ly0, lx1, ly1] = line.bbox;
  const lw = lx1 - lx0;
  const siW = ws.find((w) => /^S/i.test(w.texto) && w.texto.length <= 3) ?? null;
  const noW = ws.find((w) => /^N/i.test(w.texto) && w.texto.length <= 3) ?? null;
  const centro = (b: [number, number, number, number]) =>
    [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] as [number, number];
  const cSi = siW ? centro(siW.bbox) : [lx0 + 0.74 * lw, (ly0 + ly1) / 2];
  const cNo = noW ? centro(noW.bbox) : [lx1 - 0.06 * lw, (ly0 + ly1) / 2];
  const wsz = 0.055 * W;
  const hsz = 0.018 * H;
  const zSi: Zone = [cSi[0] - wsz / 2, cSi[1] - hsz / 2, cSi[0] + wsz / 2, cSi[1] + hsz / 2];
  const zNo: Zone = [cNo[0] - wsz / 2, cNo[1] - hsz / 2, cNo[0] + wsz / 2, cNo[1] + hsz / 2];
  const rSi = inkRatio(bin, zSi, FILTRO);
  const rNo = inkRatio(bin, zNo, FILTRO);
  return {
    zonaSi: zSi,
    zonaNo: zNo,
    ratioSi: rSi,
    ratioNo: rNo,
    deltaNo: rNo - rSi,
    deltaSi: rSi - rNo,
  };
}

// ---------- ID: barras -> OCR + consenso ----------

export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] !== b[j - 1] ? 1 : 0));
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

export function consensoId(
  cands: CandidatoId[],
): { valor: string | null; politica: string; flag: boolean } {
  if (cands.length === 0) return { valor: null, politica: 'sin_id', flag: false };
  const valores = cands.map((c) => c.valor);
  if (new Set(valores).size === 1) return { valor: cands[0].valor, politica: 'unanime', flag: false };
  const exactos: Record<string, CandidatoId[]> = {};
  for (const c of cands) (exactos[c.valor] ??= []).push(c);
  const maxCount = Math.max(...Object.values(exactos).map((v) => v.length));
  if (maxCount >= 2) {
    const mejor = Object.entries(exactos).sort(
      (a, b) =>
        b[1].length - a[1].length ||
        Math.max(...b[1].map((c) => c.conf)) - Math.max(...a[1].map((c) => c.conf)),
    )[0][0];
    return { valor: mejor, politica: 'mayoria', flag: true };
  }
  const score = (v: string) => valores.reduce((acc, o) => acc + editDistance(v, o), 0);
  const mejor = [...valores].sort(
    (a, b) =>
      score(a) - score(b) ||
      Math.max(...cands.filter((c) => c.valor === b).map((c) => c.conf)) -
        Math.max(...cands.filter((c) => c.valor === a).map((c) => c.conf)),
  )[0];
  return { valor: mejor, politica: 'medoide', flag: true };
}

// ---------- evaluacion de campos ----------

function confPresencia(margen: number): number {
  return Math.round(Math.min(1, 0.5 + margen / 0.06) * 100) / 100;
}

function banderasPorMargen(res: ResultadoCampo, ratio: number, umbral: number): void {
  const margen = Math.abs(ratio - umbral);
  if (margen < 0.005) res.banderas.push('umbral_dudoso');
  else if (margen < 0.01) res.banderas.push('cerca_de_umbral');
  res.confianza = confPresencia(margen);
}

function capPieDePagina(lines: LineaOcr[], H: number): number | null {
  for (const l of lines) {
    if (l.bbox[1] / H > 0.9 && /KIT|Form|Civ/i.test(l.texto)) {
      return l.bbox[1] / H - 0.004;
    }
  }
  return null;
}

export interface MotorContext {
  lines: LineaOcr[];
  bin: BinImage;
  W: number;
  H: number;
  etiquetasJ: Record<number, EtiquetaJurado>;
  recuento: RecuentoInfo | null;
  capPie: number | null;
}

function evalCampo(campo: CampoMolde, ctx: MotorContext): ResultadoCampo {
  const res: ResultadoCampo = {
    nombre: campo.nombre,
    tipo: campo.tipo,
    estado: 'no_encontrado',
    valor: null,
    ratio: null,
    umbral: campo.umbral_tinta ?? null,
    zona: null,
    origen: null,
    confianza: 0,
    banderas: [],
  };
  const umbral = campo.umbral_tinta ?? (MOTOR.umbral_tinta_default ?? 0.03);
  res.umbral = umbral;

  // --- regex ---
  if (campo.estrategia === 'regex') {
    const rx = new RegExp(campo.patron!, 'i');
    for (const l of ctx.lines) {
      const m = l.texto.match(rx);
      if (m) {
        const g = m[campo.grupo ?? 1];
        res.valor = g ? g.trim() : null;
        res.estado = 'ok';
        res.origen = 'regex';
        res.zona = l.bbox;
        const confs = l.palabras.map((w) => w.conf);
        res.confianza = confs.length ? Math.round(Math.max(...confs) / 100 * 100) / 100 : 0.5;
        return res;
      }
    }
    res.origen = 'regex_sin_match';
    return res;
  }

  // --- recuento SI/NO ---
  if (campo.estrategia === 'recuento_si_no') {
    const r = ctx.recuento;
    if (!r) {
      res.origen = 'ancla_RECUENTO_no_encontrada';
      return res;
    }
    const lado = campo.lado!;
    const delta = lado === 'SI' ? r.deltaSi : r.deltaNo;
    const zona = lado === 'SI' ? r.zonaSi : r.zonaNo;
    res.ratio = Math.round(delta * 10000) / 10000;
    res.zona = zona;
    res.origen = `recuento_diferencial_${lado}`;
    res.valor = delta >= umbral;
    res.estado = 'ok';
    banderasPorMargen(res, delta, umbral);
    return res;
  }

  // --- ancla a nivel de palabra (firmas / C.C. jurados) ---
  if (campo.ancla_nivel === 'palabra') {
    const et = ctx.etiquetasJ;
    const n = campo.jurado_num!;
    const z = campo.zona as {
      col_izq: [number, number];
      col_der: [number, number];
      desde: 'etiqueta_y0' | 'etiqueta_y1';
      dy0: number;
      dy1: number;
    };
    const e = et[n] ?? { y0: null, y1: null, origen: 'sin_etiqueta' };
    const col = n % 2 === 1 ? z.col_izq : z.col_der;
    let zona: Zone;
    if (e.y0 !== null && e.y1 !== null) {
      let y0n: number;
      let y1n: number;
      if (z.desde === 'etiqueta_y1') {
        y0n = e.y1 + z.dy0;
        y1n = e.y1 + z.dy1;
      } else {
        y0n = e.y0 + z.dy0;
        y1n = e.y0 + z.dy1;
      }
      if (z.desde === 'etiqueta_y0' && ctx.capPie !== null) {
        y1n = Math.min(y1n, ctx.capPie);
      }
      zona = [col[0] * ctx.W, y0n * ctx.H, col[1] * ctx.W, y1n * ctx.H];
      res.origen = e.origen;
    } else {
      const zf = campo.zona_fija;
      if (!zf) {
        res.origen = 'sin_zona';
        return res;
      }
      zona = [zf.x0 * ctx.W, zf.y0 * ctx.H, zf.x1 * ctx.W, zf.y1 * ctx.H];
      res.origen = 'zona_fija';
      res.banderas.push('zona_fija_fallback');
    }
    if (campo.medida === 'componentes') {
      const { nBig, dens } = medidaCelda(ctx.bin, zona, MEDIDA, FILTRO);
      res.ratio = Math.round(dens * 10000) / 10000;
      res.n_componentes = nBig;
      res.zona = zona;
      res.estado = 'ok';
      res.valor = nBig >= MEDIDA.min_comps || dens >= MEDIDA.dens_alta;
      res.confianza = confPresencia(Math.min(Math.abs(dens - 0.035), 0.03 * Math.abs(nBig - 2)));
    } else {
      const ratio = inkRatio(ctx.bin, zona, FILTRO);
      res.ratio = Math.round(ratio * 10000) / 10000;
      res.zona = zona;
      res.estado = 'ok';
      res.valor = ratio >= umbral;
      banderasPorMargen(res, ratio, umbral);
    }
    return res;
  }

  // --- ancla_zona con cadena de lineas ---
  const { line, rowY0, patron } = resolverAncla(campo, ctx.lines, ctx.H);
  let zona: Zone | null = null;
  if (line) {
    zona = zonaDe(campo, ctx.H, ctx.W, line, rowY0);
    res.origen = `ancla:${patron}`;
  }
  if (zona === null && campo.zona_fija) {
    const zf = campo.zona_fija;
    zona = [zf.x0 * ctx.W, zf.y0 * ctx.H, zf.x1 * ctx.W, zf.y1 * ctx.H];
    res.origen = res.origen ? `${res.origen}|zona_fija` : 'zona_fija';
    res.banderas.push('zona_fija_fallback');
  }
  if (zona === null) {
    res.origen = res.origen ?? 'sin_zona';
    return res;
  }
  if (campo.medida === 'componentes') {
    const { nBig, dens } = medidaCelda(ctx.bin, zona, MEDIDA, FILTRO);
    res.ratio = Math.round(dens * 10000) / 10000;
    res.n_componentes = nBig;
    res.zona = zona;
    res.estado = 'ok';
    res.valor = nBig >= MEDIDA.min_comps || dens >= MEDIDA.dens_alta;
    res.confianza = confPresencia(Math.min(Math.abs(dens - 0.035), 0.03 * Math.abs(nBig - 2)));
  } else {
    const ratio = inkRatio(ctx.bin, zona, FILTRO);
    res.ratio = Math.round(ratio * 10000) / 10000;
    res.zona = zona;
    res.estado = 'ok';
    res.valor = ratio >= umbral;
    banderasPorMargen(res, ratio, umbral);
  }
  return res;
}

// ---------- pipeline de acta ----------

export interface MotorHelpers {
  ocrLines(canvas: HTMLCanvasElement): Promise<{ lines: LineaOcr[]; conf: number }>;
  relecturaId(canvas: HTMLCanvasElement, lines: LineaOcr[]): Promise<string | null>;
  decodeBarcodes(canvas: HTMLCanvasElement): string[];
}

export async function procesarPagina(
  canvas: HTMLCanvasElement,
  helpers: MotorHelpers,
  renderMs: number,
): Promise<ResultadoPagina> {
  const W = canvas.width;
  const H = canvas.height;

  const t0 = performance.now();
  const { lines, conf } = await helpers.ocrLines(canvas);
  const ocrMs = performance.now() - t0;

  const t1 = performance.now();
  const ctxImg = canvas.getContext('2d', { willReadFrequently: true })!;
  const imgData = ctxImg.getImageData(0, 0, W, H);
  const gray = grayFromImageData(imgData);
  const bin = binarizeNoLines(gray, W, H, MOTOR.kernel_linea_frac ?? 0.083);
  const motorMs = performance.now() - t1;

  const texto = ocrTexto(lines);

  // ID de la pagina: barras -> OCR -> re-OCR
  const t2 = performance.now();
  const ids: CandidatoId[] = [];
  for (const v of helpers.decodeBarcodes(canvas)) {
    if (/^7\d{14}$/.test(v)) {
      ids.push({ valor: v, fuente: 'codigo_barras', conf: 0.99 });
      break;
    }
  }
  const patron = new RegExp(MOLDE.identificacion.patron);
  const fallback = new RegExp(MOLDE.identificacion.fallback);
  const confs = lines.flatMap((l) =>
    l.palabras.filter((w) => patron.test(w.texto) || fallback.test(w.texto)).map((w) => w.conf),
  );
  const m = patron.exec(texto) ?? fallback.exec(texto);
  if (m) {
    ids.push({ valor: m[0], fuente: 'ocr', conf: confs.length ? Math.max(...confs) / 100 : 0.5 });
  }
  const reo = await helpers.relecturaId(canvas, lines);
  if (reo) ids.push({ valor: reo, fuente: 'ocr_relectura', conf: 0.7 });
  const { valor: idPag } = consensoId(ids);
  const idMs = performance.now() - t2;

  // numero de pagina: marcador -> ID -> inferencia por palabras clave
  let num: number | null = null;
  let fuenteNum: string | null = null;
  const marcador = new RegExp(MOLDE.paginas.marcador, 'i').exec(texto);
  if (marcador) {
    num = parseInt(marcador[1], 10);
    fuenteNum = 'marcador';
  } else if (idPag && idPag.length === 15) {
    num = parseInt(idPag[MOLDE.identificacion.digito_pagina], 10);
    fuenteNum = 'id_digito13';
  } else {
    const clave = MOLDE.paginas.inferencia;
    const p2 = clave.pagina_2.filter((k) => new RegExp(k, 'i').test(texto)).length;
    const p1 = clave.pagina_1.filter((k) => new RegExp(k, 'i').test(texto)).length;
    if (p2 > p1 && p2 >= 2) {
      num = 2;
      fuenteNum = 'inferencia';
    } else if (p1 >= 1) {
      num = 1;
      fuenteNum = 'inferencia';
    }
  }

  // clasificacion E-14
  const anclasOk = MOLDE.clasificacion.anclas.filter((a) => new RegExp(a, 'i').test(texto)).length;
  const regexOk = new RegExp(MOLDE.clasificacion.regex, 'i').test(texto);
  const esE14 = anclasOk >= MOLDE.clasificacion.min_anclas || regexOk;

  const ctx: MotorContext = {
    lines,
    bin,
    W,
    H,
    etiquetasJ: resolverEtiquetasJurado(lines, W, H),
    recuento: evalRecuento(lines, bin),
    capPie: capPieDePagina(lines, H),
  };

  const campos: Record<string, ResultadoCampo> = {};
  for (const c of CAMPOS) {
    if (c.pagina === num) campos[c.nombre] = evalCampo(c, ctx);
  }

  return {
    pagina: num,
    fuente_numero: fuenteNum,
    es_e14: esE14,
    id_candidatos: ids,
    id_estimado: idPag,
    ocr_texto: texto,
    ocr_confianza: conf,
    campos,
    tiempos: {
      render_ms: Math.round(renderMs),
      ocr_ms: Math.round(ocrMs),
      motor_ms: Math.round(motorMs),
      id_ms: Math.round(idMs),
    },
  };
}

export function validarActa(
  paginas: ResultadoPagina[],
  camposTodos: Record<string, ResultadoCampo>,
  docId: string | null,
): { validaciones: Validacion[]; flagsId: boolean } {
  const val: Validacion[] = [];
  const nums = paginas
    .map((p) => p.pagina)
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);
  val.push({
    regla: 'paginas_completas',
    ok: JSON.stringify(nums) === JSON.stringify(Array.from({ length: MOLDE.paginas.requeridas }, (_, i) => i + 1)),
    detalle: `paginas=[${nums.join(', ')}]`,
  });
  const tol = MOLDE.identificacion.consenso.tolerancia_edicion;
  let flagsId = false;
  for (const p of paginas) {
    const raices = [...new Set(p.id_candidatos.map((c) => c.valor.slice(0, 12)))];
    for (let i = 0; i < raices.length; i++) {
      for (let j = i + 1; j < raices.length; j++) {
        if (editDistance(raices[i], raices[j]) > tol) flagsId = true;
      }
    }
  }
  if (docId && docId.length === 15) {
    const raizDoc = docId.slice(0, 12);
    const dists: number[] = [];
    const raicesVistas: string[] = [];
    for (const p of paginas) {
      if (p.id_candidatos.length > 0) {
        const d = Math.min(...p.id_candidatos.map((c) => editDistance(c.valor.slice(0, 12), raizDoc)));
        dists.push(d);
        const mejorCand = [...p.id_candidatos].sort(
          (a, b) => editDistance(a.valor.slice(0, 12), raizDoc) - editDistance(b.valor.slice(0, 12), raizDoc),
        )[0];
        raicesVistas.push(mejorCand.valor.slice(0, 12));
      }
    }
    const completa = dists.length === MOLDE.paginas.requeridas;
    const tolerada = dists.some((d) => d > 0);
    val.push({
      regla: 'misma_raiz',
      ok: completa && dists.every((d) => d <= tol),
      tolerada,
      detalle: `raiz_consenso=${raizDoc} paginas=[${raicesVistas.join(', ')}] d_min=[${dists.join(', ')}]`,
    });
  } else {
    val.push({ regla: 'misma_raiz', ok: false, detalle: 'sin id de consenso' });
  }
  const idsPag = paginas.map((p) => p.id_estimado).filter((i): i is string => !!i && i.length === 15);
  const digs = idsPag.map((i) => i[12]);
  val.push({
    regla: 'orden_paginas',
    ok: JSON.stringify(digs) === JSON.stringify(['1', '2']),
    detalle: `digitos=[${digs.join(', ')}]`,
  });
  val.push({ regla: 'clasificacion_e14', ok: paginas.every((p) => p.es_e14), detalle: `e14=${paginas.map((p) => p.es_e14).join(', ')}` });
  const firmas = ['firma_jurado_1', 'firma_jurado_2', 'firma_jurado_3', 'firma_jurado_4'].filter(
    (f) => camposTodos[f]?.valor === true,
  ).length;
  val.push({ regla: 'firmas_minimas', ok: firmas >= 2, detalle: `firmas=${firmas}` });
  const oblig = CAMPOS.filter((c) => c.obligatorio).map((c) => c.nombre);
  const faltan = oblig.filter((n) => camposTodos[n]?.estado !== 'ok');
  val.push({
    regla: 'obligatorios_presentes',
    ok: faltan.length === 0,
    detalle: faltan.length ? `faltantes=[${faltan.join(', ')}]` : 'todos presentes',
  });
  return { validaciones: val, flagsId };
}

export async function procesarActa(
  canvases: HTMLCanvasElement[],
  helpers: MotorHelpers,
  renderMsPorPagina: number[],
): Promise<ResultadoActa> {
  const paginas: ResultadoPagina[] = [];
  for (let i = 0; i < canvases.length; i++) {
    paginas.push(await procesarPagina(canvases[i], helpers, renderMsPorPagina[i] ?? 0));
  }
  const camposTodos: Record<string, ResultadoCampo> = {};
  for (const p of paginas) Object.assign(camposTodos, p.campos);
  const crudos = paginas.flatMap((p) => p.id_candidatos);
  const { valor: docId, politica } = consensoId(crudos);
  for (const p of paginas) {
    if (docId && p.id_candidatos.length > 0) {
      const mejor = [...p.id_candidatos].sort(
        (a, b) => editDistance(a.valor, docId) - editDistance(b.valor, docId) || b.conf - a.conf,
      )[0];
      p.id_estimado = mejor.valor;
    }
  }
  const { validaciones, flagsId } = validarActa(paginas, camposTodos, docId);
  const id1 = paginas.find((p) => p.pagina === 1 && p.id_estimado)?.id_estimado ?? docId ?? '';
  const dudoso = Object.values(camposTodos).some((c) => c.banderas.includes('umbral_dudoso'));
  const toleradaId = validaciones.some((v) => v.regla === 'misma_raiz' && v.tolerada);
  const requiere =
    !validaciones.every((v) => v.ok) ||
    flagsId ||
    toleradaId ||
    dudoso ||
    Object.values(camposTodos).some((c) => c.estado !== 'ok');
  const confs = Object.values(camposTodos)
    .filter((c) => c.estado === 'ok')
    .map((c) => c.confianza);
  const raiz = docId && docId.length === 15 ? docId.slice(0, 12) : null;
  return {
    documento_id: docId,
    id_politica: politica,
    raiz,
    id_pagina_1: id1 || null,
    paginas,
    campos: camposTodos,
    validaciones,
    requiere_revision: requiere,
    confianza_global: confs.length ? Math.round((confs.reduce((a, b) => a + b, 0) / confs.length) * 100) / 100 : 0,
    gt: null,
  };
}
