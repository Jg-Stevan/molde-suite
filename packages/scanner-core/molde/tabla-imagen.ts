// FASE A1 (blueprint DLA — port de la heurística de SPARTAN/spartan-tables a
// TypeScript, sin dependencias nuevas): retícula de tabla DESDE LA IMAGEN en
// vez de desde las palabras OCR.
//
// Cómo funciona (misma idea del original, con las primitivas que imageproc.ts
// ya porta de OpenCV):
//   1. Binarizar SOLO la zona arrastrada (adaptiveThresholdInv).
//   2. Apertura morfológica horizontal (opening1D) con kernel grande → quedan
//      SOLO las líneas/rayas HORIZONTALES largas (reglas de fila).
//   3. Apertura vertical con kernel grande → SOLO las reglas de columna.
//   4. Proyección de cada máscara: filas = picos del perfil H; columnas =
//      picos del perfil V. La retícula sale de la IMAGEN.
//   5. Las celdas son las intersecciones: una columna completamente vacía
//      (casilla OMR sin texto) EXISTE — el gap documentado de tabla-detect.ts
//      ("las columnas nacen de palabras reconocidas") desaparece.
//
// Tabla sin bordes (sin reglas dibujadas): no hay picos → senal 'ninguno' y
// el llamador cae a la vía por palabras OCR (columnasPorOcupacion/Voto), que
// sigue intacta. Ambas vías comparten el mismo tipo TablaDetectada.

import { adaptiveThresholdInv, grayFromImageData, opening1D, type BinImage } from './imageproc';
import type { RectNorm } from './universal-types';

export interface Banda {
  a: number; // inicio (px, coordenadas del canvas de página)
  b: number; // fin
}

export interface ReticulaImagen {
  filas: Banda[];
  columnas: Banda[];
  /** 'bordes' = retícula desde reglas impresas · 'ninguno' = no hay señal. */
  senal: 'bordes' | 'ninguno';
}

/** Kernel mínimo de apertura para considerar "regla" una raya (px). */
const KERNEL_MIN = 24;
/** Fracción del ancho de la zona que debe cubrir una regla horizontal. */
const KERNEL_H_FRACCION = 0.45;
/** Fracción de la altura de la zona que debe cubrir una regla vertical. */
const KERNEL_V_FRACCION = 0.3;
/** Umbral del perfil para declarar pico (fracción del kernel aplicado). */
const PICO_UMBRAL_H = 0.6;
const PICO_UMBRAL_V = 0.5;
/** Grosor máximo de una regla (px) — una banda más gruesa es un bloque de tinta. */
const GROSOR_MAX = 12;
/** Tamaño mínimo de zona para intentar la vía imagen. */
const ZONA_MIN_PX = 60;

/** Extrae el crop de la zona y lo binariza (gris → adaptive threshold). */
function binarizarZona(
  canvas: HTMLCanvasElement,
  zona: RectNorm,
): { bin: { w: number; h: number; data: Uint8Array }; ox: number; oy: number } | null {
  const x0 = Math.max(0, Math.floor(zona.x * canvas.width));
  const y0 = Math.max(0, Math.floor(zona.y * canvas.height));
  const x1 = Math.min(canvas.width, Math.ceil((zona.x + zona.w) * canvas.width));
  const y1 = Math.min(canvas.height, Math.ceil((zona.y + zona.h) * canvas.height));
  const zw = x1 - x0;
  const zh = y1 - y0;
  if (zw < ZONA_MIN_PX || zh < ZONA_MIN_PX) return null;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.getImageData(x0, y0, zw, zh);
  const gray = grayFromImageData(img);
  const bin = adaptiveThresholdInv(gray, zw, zh, 31, 12);
  return { bin, ox: x0, oy: y0 };
}

/** Picos de una proyección: posiciones donde el perfil supera el umbral,
 * agrupadas en bandas contiguas de grosor razonable (una regla impresa). */
function bandasDesdePerfil(
  perfil: Int32Array,
  umbral: number,
  offset: number,
): Banda[] {
  const bandas: Banda[] = [];
  let inicio = -1;
  for (let i = 0; i < perfil.length; i++) {
    const esPico = perfil[i] >= umbral;
    if (esPico && inicio < 0) inicio = i;
    if ((!esPico || i === perfil.length - 1) && inicio >= 0) {
      const fin = esPico ? i : i - 1;
      if (fin - inicio + 1 <= GROSOR_MAX) {
        bandas.push({ a: offset + inicio, b: offset + fin + 1 });
      }
      inicio = -1;
    }
  }
  return bandas;
}

/**
 * Retícula desde imagen para la zona dada. Coordenadas de las bandas en px
 * ABSOLUTAS del canvas de página (el llamador las normaliza).
 */
export function reticulaDesdeImagen(
  canvas: HTMLCanvasElement,
  zona: RectNorm,
): ReticulaImagen | null {
  const prep = binarizarZona(canvas, zona);
  if (!prep) return null;
  const { bin } = prep;
  const { w: zw, h: zh } = bin;

  // Aperturas: kernel según el tamaño de la zona (una regla de fila atraviesa
  // gran parte del ancho; una de columna, varios renglones).
  const kH = Math.max(KERNEL_MIN, Math.round(zw * KERNEL_H_FRACCION)) | 1;
  const kV = Math.max(KERNEL_MIN, Math.round(zh * KERNEL_V_FRACCION)) | 1;
  const zonaBin: BinImage = { w: zw, h: zh, data: bin.data };
  const maskH = opening1D(zonaBin, kH, 'h');
  const maskV = opening1D(zonaBin, kV, 'v');

  // Perfiles de proyección de cada máscara.
  const perfilH = new Int32Array(zh);
  const perfilV = new Int32Array(zw);
  for (let y = 0; y < zh; y++) {
    let acc = 0;
    const row = y * zw;
    for (let x = 0; x < zw; x++) acc += maskH[row + x];
    perfilH[y] = acc;
  }
  for (let x = 0; x < zw; x++) {
    let acc = 0;
    for (let y = 0; y < zh; y++) acc += maskV[y * zw + x];
    perfilV[x] = acc;
  }

  const umbralH = Math.max(1, Math.round(kH * PICO_UMBRAL_H));
  const umbralV = Math.max(1, Math.round(kV * PICO_UMBRAL_V));
  // El offset real vuelve a coordenadas de página: binarizarZona recortó desde
  // zona.x/y del canvas — reconstruimos el origen de la zona en px.
  const ox = Math.max(0, Math.floor(zona.x * canvas.width));
  const oy = Math.max(0, Math.floor(zona.y * canvas.height));
  const filas = bandasDesdePerfil(perfilH, umbralH, oy);
  const columnas = bandasDesdePerfil(perfilV, umbralV, ox);

  const hayFilas = filas.length >= 2;
  const hayCols = columnas.length >= 2;
  if (!hayFilas && !hayCols) return { filas: [], columnas: [], senal: 'ninguno' };
  return { filas, columnas, senal: 'bordes' };
}

/** Expande los bordes de la retícula a los límites de la zona (la primera
 * regla puede estar en el filo; la primera fila empieza donde empieza la
 * tabla, no donde termina la regla superior). */
export function bandasAContenido(
  reglas: Banda[],
  desde: number,
  hasta: number,
): Banda[] {
  if (reglas.length === 0) return [];
  const bordes: number[] = [desde, ...reglas.flatMap((r) => [r.a, r.b]), hasta];
  // Cada par consecutivo [reglaFin_i, reglaInicio_i+1] es una fila de contenido;
  // antes de la primera regla y después de la última también puede haber contenido.
  const contenidos: Banda[] = [];
  // Cabecera antes de la primera regla (si hay hueco).
  if (reglas[0].a - desde > 4) contenidos.push({ a: desde, b: reglas[0].a });
  for (let i = 0; i < reglas.length - 1; i++) {
    const a = reglas[i].b;
    const b = reglas[i + 1].a;
    if (b - a > 4) contenidos.push({ a, b });
  }
  // Pie después de la última regla.
  const ultima = reglas[reglas.length - 1];
  if (hasta - ultima.b > 4) contenidos.push({ a: ultima.b, b: hasta });
  return contenidos;
}

export { KERNEL_MIN };
