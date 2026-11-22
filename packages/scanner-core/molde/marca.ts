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

import { adaptiveThresholdInv, binarizeNoLines, connectedComponents, grayFromImageData, type BinImage } from './imageproc';

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

  // 1) Caja impresa hueca: componente dominante con tres señales simultáneas:
  //    (a) cubre gran parte de la zona (lineal), (b) fill BAJO (borde delgado,
  //    interior vacío) y (c) PERÍMETRO denso de tinta — un rectángulo impreso
  //    tiene sus 4 bordes completos; un bloque de texto deja huecos entre
  //    palabras y no pasa (a) ni (c). Triple condición = pocos falsos positivos.
  let cajaIdx = -1;
  let mejorPuntaje = 0;
  for (let i = 0; i < stats.length; i++) {
    const s = stats[i];
    const cobertura = Math.max(s.w / zw, s.h / zh); // cobertura lineal dominante
    const fill = s.area / Math.max(1, s.w * s.h);
    if (cobertura < 0.45) continue; // la caja debe dominar la zona
    if (fill > 0.4) continue; // un bloque sólido no es una caja hueca
    if (densidadBorde(bin, labels, i, s) < 0.45) continue; // perímetro completo
    const puntaje = cobertura * (1 - fill);
    if (puntaje > mejorPuntaje) {
      mejorPuntaje = puntaje;
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
