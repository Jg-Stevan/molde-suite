// FASE A2 (blueprint DLA — port de la heurística de checkbox-extractor a
// TypeScript, sin dependencias nuevas): clasificación de la MARCA de una
// casilla por FORMA/TOPOLOGÍA de componentes conexos, sobre las primitivas
// que imageproc.ts ya porta de OpenCV (adaptiveThresholdInv, opening1D,
// connectedComponents).
//
// Idea central (misma del extractor original): la casilla impresa es una caja
// HUECA (rectángulo de trazo fino con interior vacío) y la marca del usuario
// es un componente INTERIOR no conectado al borde impreso. Con eso se
// separan tres estados sin entrenar nada:
//   vacia   — interior limpio (ruido de papel por debajo del piso)
//   marcada — hay componente(s) interior(es) con área/lleno de marca
//   borrosa — todo lo demás (banda honesta: equivale a la banda
//             indeterminada 0.6x–1.4x del ratio de tinta)
//
// Principio de honestidad del motor: la forma es SEÑAL, no veredicto. La
// integración en evaluarCampo (universal-engine) discipula el resultado:
// tinta y forma en desacuerdo → `forma_discrepa` + requiere_revision.

import { adaptiveThresholdInv, binarizeNoLines, connectedComponents, grayFromImageData, inkRatio, type BinImage, type CompStats } from './imageproc';
import type { RectNorm } from './universal-types';

export type EstadoMarca = 'vacia' | 'marcada' | 'borrosa';

export interface MetricaMarca {
  estado: EstadoMarca;
  /** Tinta del interior de la caja / área del interior (0-1) — null sin caja. */
  fillInterior: number | null;
  /** Componentes interiores no conectados al borde impreso. */
  nInterior: number;
  /** ¿Se identificó la caja impresa hueca? false → la zona no parece casilla. */
  cajaEncontrada: boolean;
}

/** Piso de "vacia": menos del 3% de tinta interior = papel limpio. */
const PISO_VACIA = 0.03;
/** Techo de "marcada": más del 35% de tinta interior = marca sólida. */
const TECHO_MARCADA = 0.35;
/** Área mínima de un componente interior para contar como marca
 * (fracción del área interior) — un check fino puede llenar poco pero
 * EXISTE como componente conectado distinguible. */
const MARCA_COMP_FRACCION = 0.04;
/** Fill mínimo del interior para declarar marca por llenado. Calibrado con
 * casillas sintéticas: una X fina que toca el borde llena ~0.09 del interior
 * (se conecta al trazo impreso y deja de ser componente separado); un check
 * manuscrito fino puede llenar ~0.05-0.09. Por debajo, el RATIO del motor
 * decide (la forma se declara borrosa — honesto, no inventa). */
const MARCA_FILL_MIN = 0.07;

/** Densidad de tinta en el PERÍMETRO del bbox de un componente: 1.0 = anillo
 * completo de tinta (rectángulo impreso); los bloques de texto quedan lejos. */
function densidadBorde(
  bin: BinImage,
  labels: Int32Array,
  id: number,
  s: { x: number; y: number; w: number; h: number },
): number {
  const { w } = bin;
  let conTinta = 0;
  let total = 0;
  const marca = (x: number, y: number): void => {
    total++;
    if (labels[y * w + x] === id) conTinta++;
  };
  for (let x = s.x; x < s.x + s.w; x++) {
    marca(x, s.y);
    if (s.h > 1) marca(x, s.y + s.h - 1);
  }
  for (let y = s.y + 1; y < s.y + s.h - 1; y++) {
    marca(s.x, y);
    if (s.w > 1) marca(s.x + s.w - 1, y);
  }
  return total > 0 ? conTinta / total : 0;
}

/** ¿El componente "toca" el borde del bbox de la caja? (conectado al trazo
 * impreso → no es marca, es la caja misma o suciedad pegada al borde). */
function compTocaBorde(
  bin: BinImage,
  labels: Int32Array,
  id: number,
  caja: { x: number; y: number; w: number; h: number },
): boolean {
  const { w, h } = bin;
  // Anillo del perímetro completo del bbox de la caja (regla impresa).
  const esPerimetro = (x: number, y: number): boolean =>
    y === caja.y || y === caja.y + caja.h - 1 || x === caja.x || x === caja.x + caja.w - 1;
  for (let y = caja.y; y < caja.y + caja.h && y < h; y++) {
    for (let x = caja.x; x < caja.x + caja.w && x < w; x++) {
      if (!esPerimetro(x, y)) continue;
      if (labels[y * w + x] === id) return true;
    }
  }
  return false;
}

/** Clasificación de marca sobre una imagen binaria ya preparada. */
export function clasificarMarcaBin(bin: BinImage): MetricaMarca {
  const { w, h, data } = bin;
  const zw = w;
  const zh = h;
  if (zw < 10 || zh < 10) {
    return { estado: 'borrosa', fillInterior: null, nInterior: 0, cajaEncontrada: false };
  }
  const { labels, stats } = connectedComponents(data, zw, zh);

  // 1) Caja impresa hueca: componente dominante con tres señales simultáneas
  //    (cobertura lineal, fill bajo, perímetro completo). FASE 2: el criterio
  //    vive en `senalCajaHueca` (factorización — mismos umbrales, mismo orden,
  //    mismo puntaje: comportamiento equivalente).
  let cajaIdx = -1;
  let mejorPuntaje = 0;
  for (let i = 0; i < stats.length; i++) {
    const senal = senalCajaHueca(bin, labels, stats, i, zw, zh);
    if (!senal) continue;
    if (senal.puntaje > mejorPuntaje) {
      mejorPuntaje = senal.puntaje;
      cajaIdx = i;
    }
  }

  if (cajaIdx < 0) {
    // Sin caja identificable: la zona puede ser una banda OMR con burbujas o
    // un recorte desplazado. La forma NO se pronuncia (borrosa sin caja).
    return { estado: 'borrosa', fillInterior: null, nInterior: 0, cajaEncontrada: false };
  }

  const caja = stats[cajaIdx];
  // 2) Interior de la caja: bbox insetado por el grosor del trazo impreso
  //    (≈10% del lado menor, mínimo 2 px).
  const inset = Math.max(2, Math.round(0.1 * Math.min(caja.w, caja.h)));
  const ix0 = caja.x + inset;
  const iy0 = caja.y + inset;
  const ix1 = caja.x + caja.w - inset;
  const iy1 = caja.y + caja.h - inset;
  const iw = ix1 - ix0;
  const ih = iy1 - iy0;
  if (iw <= 3 || ih <= 3) {
    return { estado: 'borrosa', fillInterior: null, nInterior: 0, cajaEncontrada: true };
  }

  // 3) Marca = componentes con centroide DENTRO del interior que NO tocan el
  //    borde impreso de la caja (la marca del usuario vive adentro; lo que
  //    conecta con el borde es la propia caja).
  let tintaInterior = 0;
  const areaInterior = iw * ih;
  const interiores = new Set<number>();
  for (let y = iy0; y < iy1; y++) {
    for (let x = ix0; x < ix1; x++) {
      const v = data[y * zw + x];
      if (v) tintaInterior++;
      const l = labels[y * zw + x];
      if (l >= 0 && l !== cajaIdx && !interiores.has(l)) {
        // Centroide aproximado: cualquier píxel del componente dentro del
        // interior cuenta; el filtro de borde decide después.
        interiores.add(l);
      }
    }
  }
  let nInterior = 0;
  let areaInteriorMarcas = 0;
  for (const l of interiores) {
    const s = stats[l];
    if (!s) continue;
    // El componente debe vivir (casi) entero dentro del interior.
    const centroCx = s.x + s.w / 2;
    const centroCy = s.y + s.h / 2;
    const dentro =
      centroCx >= ix0 && centroCx <= ix1 && centroCy >= iy0 && centroCy <= iy1;
    if (!dentro) continue;
    if (compTocaBorde(bin, labels, l, { x: caja.x, y: caja.y, w: caja.w, h: caja.h })) continue;
    nInterior++;
    areaInteriorMarcas += s.area;
  }

  const fillInterior = tintaInterior / areaInterior;
  const marcaPorComponente =
    nInterior > 0 && areaInteriorMarcas >= MARCA_COMP_FRACCION * areaInterior;

  let estado: EstadoMarca;
  if (fillInterior <= PISO_VACIA && !marcaPorComponente) {
    estado = 'vacia';
  } else if (fillInterior >= MARCA_FILL_MIN || marcaPorComponente) {
    estado = 'marcada';
  } else {
    estado = 'borrosa';
  }
  // Un interior MUY lleno (≥ techo) siempre es marca (relleno total, bolígrafo grueso).
  if (estado !== 'marcada' && fillInterior >= TECHO_MARCADA) estado = 'marcada';
  return { estado, fillInterior, nInterior, cajaEncontrada: true };
}

/** Clasificación de marca sobre el CROP (canvas) de un campo: gris →
 * binarización sin líneas → componentes → forma. Mismo pre-proceso que
 * medirTinta del motor (coherencia de binarización entre ratio y forma). */
export function clasificarMarcaSobreCrop(crop: HTMLCanvasElement): MetricaMarca {
  const ctx = crop.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, crop.width, crop.height);
  const gray = grayFromImageData(img);
  const bin = binarizeNoLines(gray, crop.width, crop.height, 0.083);
  return clasificarMarcaBin(bin);
}

// ---- FASE 2 (v3.2.0 — faro): exposición de la detección de cajas huecas ----
// La detección de recuadro impreso hueco YA EXISTÍA dentro de clasificarMarcaBin
// (cobertura ≥ 0.45 · fill ≤ 0.4 · perímetro ≥ 0.45): aquí SOLO se factoriza y
// se expone como lista — cero matemática nueva, la misma que funciona.

export interface SenalCajaHueca {
  cobertura: number;
  fill: number;
  densidadBorde: number;
  /** Cobertura × (1 − fill) — el mismo puntaje que usa clasificarMarcaBin. */
  puntaje: number;
}

/**
 * ¿El componente `i` es una caja impresa hueca plausible? Triple condición
 * extraída VERBATIM del bucle de clasificarMarcaBin: (a) cobertura lineal
 * dominante ≥ 0.45, (b) fill ≤ 0.4 (borde delgado, interior vacío), (c)
 * perímetro denso ≥ 0.45 (los 4 bordes completos — un bloque de texto deja
 * huecos y no pasa). Devuelve las señales para el puntaje, null si no pasa.
 */
export function senalCajaHueca(
  bin: BinImage,
  labels: Int32Array,
  stats: CompStats[],
  i: number,
  zw: number,
  zh: number,
): SenalCajaHueca | null {
  const s = stats[i];
  const cobertura = Math.max(s.w / zw, s.h / zh); // cobertura lineal dominante
  const fill = s.area / Math.max(1, s.w * s.h);
  if (cobertura < 0.45) return null; // la caja debe dominar la zona
  if (fill > 0.4) return null; // un bloque sólido no es una caja hueca
  const densidad = densidadBorde(bin, labels, i, s);
  if (densidad < 0.45) return null; // perímetro completo
  return { cobertura, fill, densidadBorde: densidad, puntaje: cobertura * (1 - fill) };
}

/**
 * TODOS los recuadros impresos huecos de una imagen binaria (bbox en px,
 * ordenados por puntaje descendente). Misma detección que ya funcionaba en
 * clasificarMarcaBin — expuesta para la resolución relacional (que='caja').
 */
export function cajasHuecasEnBin(
  bin: BinImage,
): { x: number; y: number; w: number; h: number; puntaje: number }[] {
  const { w, h, data } = bin;
  if (w < 10 || h < 10) return [];
  const { labels, stats } = connectedComponents(data, w, h);
  const cajas: { x: number; y: number; w: number; h: number; puntaje: number }[] = [];
  for (let i = 0; i < stats.length; i++) {
    const senal = senalCajaHueca(bin, labels, stats, i, w, h);
    if (!senal) continue;
    cajas.push({ x: stats[i].x, y: stats[i].y, w: stats[i].w, h: stats[i].h, puntaje: senal.puntaje });
  }
  return cajas.sort((a, b) => b.puntaje - a.puntaje);
}

/**
 * Recuadros huecos dentro de un CROP del canvas de página (gris →
 * binarizeNoLines → componentes — el MISMO pre-proceso de
 * clasificarMarcaSobreCrop, coherente con la forma del motor).
 * Devuelve rects NORMALIZADOS respecto al canvas COMPLETO (0-1 de la página).
 * `limite` (opcional, normalizado a la página) recorta el análisis al faro:
 * fuera del faro no se busca nada (regla del dueño #2).
 */
export function detectarCajasHuecas(canvas: HTMLCanvasElement, limite?: RectNorm): RectNorm[] {
  const W = canvas.width;
  const H = canvas.height;
  // Ventana de análisis: el faro cuando viene, o la página entera.
  const vx0 = limite ? Math.max(0, Math.floor(limite.x * W)) : 0;
  const vy0 = limite ? Math.max(0, Math.floor(limite.y * H)) : 0;
  const vx1 = limite ? Math.min(W, Math.ceil((limite.x + limite.w) * W)) : W;
  const vy1 = limite ? Math.min(H, Math.ceil((limite.y + limite.h) * H)) : H;
  const vw = vx1 - vx0;
  const vh = vy1 - vy0;
  if (vw < 10 || vh < 10) return [];
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.getImageData(vx0, vy0, vw, vh);
  const gray = grayFromImageData(img);
  const bin = binarizeNoLines(gray, vw, vh, 0.083);
  const cajas = cajasHuecasEnBin(bin);
  // Normalización al canvas completo (el desplazamiento de la ventana cuenta).
  return cajas.map((c) => ({
    x: (vx0 + c.x) / W,
    y: (vy0 + c.y) / H,
    w: c.w / W,
    h: c.h / H,
  }));
}

// ---- FASE 3 (v3.2.0 — endurecimiento de firmas): métricas de firma ----
// Factorización de lo EXISTENTE (mismo pre-proceso de clasificarMarcaSobreCrop:
// gris → binarizeNoLines → componentes conexos): densidad de tinta (la medida
// que el motor ya usaba), NÚMERO DE TRAZOS (componentes conexos de tinta con
// área significativa — una rúbrica real deja 1-6 componentes; el ruido del
// papel queda fuera por el piso de área) y EXTENSIÓN (fracción del crop que
// ocupa el bbox de los trazos — firma real extensa vs un punto).

export interface MetricasFirma {
  /** Densidad de tinta del crop (inkRatio — la MISMA medida que medirTinta). */
  densidad: number;
  /** Nº de componentes conexos de tinta con área significativa (trazos). */
  trazos: number;
  /** Fracción del área del crop ocupada por el bbox de los trazos (0-1). */
  extension: number;
}

/**
 * Métricas de firma sobre un CROP (factorización — cero matemática nueva).
 * Piso de área por trazo: max(8 px, 0.02% del área) — elimina el grano del
 * papel y el polvo del escáner sin tocar rúbricas finas. El bbox de trazos da
 * la extensión (una firma real cruza el ancho de su banda; un punto no).
 */
export function metricasFirma(crop: HTMLCanvasElement): MetricasFirma {
  const w = crop.width;
  const h = crop.height;
  if (w < 4 || h < 4) return { densidad: 0, trazos: 0, extension: 0 };
  const ctx = crop.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, w, h);
  const gray = grayFromImageData(img);
  const bin = binarizeNoLines(gray, w, h, 0.083);
  const densidad = inkRatio(bin, [0, 0, w, h]);
  const { stats } = connectedComponents(bin.data, bin.w, bin.h);
  const pisoArea = Math.max(8, Math.round(w * h * 0.0002));
  const trazos = stats.filter((s) => s.area >= pisoArea);
  if (!trazos.length) return { densidad, trazos: 0, extension: 0 };
  const x0 = Math.min(...trazos.map((s) => s.x));
  const y0 = Math.min(...trazos.map((s) => s.y));
  const x1 = Math.max(...trazos.map((s) => s.x + s.w));
  const y1 = Math.max(...trazos.map((s) => s.y + s.h));
  const extension = ((x1 - x0) * (y1 - y0)) / (w * h);
  return { densidad, trazos: trazos.length, extension };
}


// ---- Diferencial SÍ/NO (v2 B3 recuperado) ----

export interface VentanasSiNo {
  /** Rects normalizados RELATIVOS al rect resuelto del campo (0-1 del crop). */
  ventana_si: { x: number; y: number; w: number; h: number };
  ventana_no: { x: number; y: number; w: number; h: number };
}

function ratioTintaSubCanvas(
  crop: HTMLCanvasElement,
  v: { x: number; y: number; w: number; h: number },
): number {
  const w = Math.max(2, Math.round(v.w * crop.width));
  const h = Math.max(2, Math.round(v.h * crop.height));
  const x0 = Math.max(0, Math.min(crop.width - 2, Math.round(v.x * crop.width)));
  const y0 = Math.max(0, Math.min(crop.height - 2, Math.round(v.y * crop.height)));
  const c = document.createElement('canvas');
  c.width = Math.min(w, crop.width - x0);
  c.height = Math.min(h, crop.height - y0);
  if (c.width <= 2 || c.height <= 2) return 0;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(crop, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const gray = grayFromImageData(img);
  const bin = adaptiveThresholdInv(gray, c.width, c.height, 31, 12);
  let tinta = 0;
  for (let i = 0; i < bin.data.length; i++) tinta += bin.data[i];
  return tinta / bin.data.length;
}

/**
 * Delta de tinta entre las ventanas SÍ y NO. Las etiquetas impresas ("SÍ"/
 * "NO" serigrafiadas) aparecen en AMBAS ventanas con intensidad parecida y se
 * cancelan: decide la marca, no el texto impreso. Devuelve null cuando el
 * delta no discrimina (no se inventa el lado).
 */
export function diferencialSiNo(
  crop: HTMLCanvasElement,
  ventanas: VentanasSiNo,
): 'si' | 'no' | null {
  const rSi = ratioTintaSubCanvas(crop, ventanas.ventana_si);
  const rNo = ratioTintaSubCanvas(crop, ventanas.ventana_no);
  const delta = rSi - rNo;
  // Piso de decisión: 0.004 absoluto o 15% del mayor — por debajo, el flash/
  // papel domina y el lado es indistinguible.
  const piso = Math.max(0.004, 0.15 * Math.max(rSi, rNo));
  if (Math.abs(delta) <= piso) return null;
  return delta > 0 ? 'si' : 'no';
}
