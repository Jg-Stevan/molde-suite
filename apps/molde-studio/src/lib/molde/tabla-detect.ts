// Detección de tablas sobre la capa OCR del editor: agrupa líneas OCR en
// renglones (solape vertical de centros) e infiere columnas con dos
// estrategias en cascada + un respaldo de banda única:
//
// 1. Perfil de ocupación vertical — franjas x sin NINGUNA palabra en ningún
//    renglón separan columnas. Preciso en tablas limpias.
// 2. Consenso de huecos por renglón — un corte en x se acepta cuando ≥2
//    renglones tienen un hueco grande en esa misma posición. Robusto cuando
//    algún renglón cruza varias columnas (ese renglón simplemente no vota).
// 3. Banda única — sin cortes confiables, la tabla se detecta como lista de
//    renglones (1 columna): genera un campo por fila.
//
// Limitación documentada: las columnas "nacen" de palabras reconocidas, así
// que una columna completamente vacía en el escaneo de referencia (p. ej. una
// casilla OMR sin texto) no se detecta sola — se le agregan campos manuales.

import type { LineaOcr } from '@/lib/molde/types';
import type { RectNorm } from '@/lib/molde/universal-types';

/** Celda detectada: texto reconocido + rect normalizado (banda fila ∩ banda columna). */
export interface CeldaTabla {
  texto: string;
  rect: RectNorm;
  nPalabras: number;
}

/** Tabla detectada sobre la capa OCR de una página. */
export interface TablaDetectada {
  /** filas[f][c]; una fila siempre tiene filas.length celdas (texto '' si no hay palabras). */
  filas: CeldaTabla[][];
  nLineas: number;
  /** true si se recortaron renglones o columnas por los límites máximos. */
  truncada: boolean;
}

const MAX_FILAS_DEFAULT = 40;
const MAX_COLS_DEFAULT = 14;
/** Resolución del histograma de ocupación (bins sobre el ancho de la zona). */
const NBINS = 160;
/** Separador de columna (estrategia 1): franja vacía ≥ ~1.8% del ancho de la zona. */
const SEPARADOR_FRACCION = 0.018;
/** Hueco mínimo para votar un corte (estrategia 2): ≥ 2% del ancho de página.
    Los espacios normales entre palabras quedan debajo; los separadores de
    columna real (etiqueta→valor) quedan encima. */
const HUECO_VOTO_FRACCION = 0.02;
/** Tolerancia para agrupar votos del mismo corte (estrategia 2). */
const TOLERANCIA_VOTO_FRACCION = 0.018;
/** Ancho mínimo de una banda de columna (fracción del ancho de página). */
const BANDA_MIN_FRACCION = 0.012;

function CLAMP01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Estrategia 1: columnas por perfil de ocupación vertical. */
function columnasPorOcupacion(
  palabras: { bbox: [number, number, number, number] }[],
  zona: RectNorm,
  dims: { w: number; h: number },
  maxCols: number,
): { x0: number; x1: number }[] | null {
  const xMinPx = zona.x * dims.w;
  const xMaxPx = Math.max(xMinPx + 1, (zona.x + zona.w) * dims.w);
  const anchoBin = (xMaxPx - xMinPx) / NBINS;
  const hist = new Array<number>(NBINS).fill(0);
  for (const p of palabras) {
    const b0 = Math.max(0, Math.floor((p.bbox[0] - xMinPx) / anchoBin));
    const b1 = Math.min(NBINS - 1, Math.floor((p.bbox[2] - xMinPx) / anchoBin));
    for (let b = b0; b <= b1; b++) hist[b] += 1;
  }
  const ocupadas: { b0: number; b1: number }[] = [];
  for (let b = 0; b < NBINS; b++) {
    if (hist[b] === 0) continue;
    const ultima = ocupadas[ocupadas.length - 1];
    if (ultima && b === ultima.b1 + 1) ultima.b1 = b;
    else ocupadas.push({ b0: b, b1: b });
  }
  const sepMinBins = Math.max(2, Math.round(NBINS * SEPARADOR_FRACCION));
  const fusionadas: { b0: number; b1: number }[] = [];
  for (const bd of ocupadas) {
    const ultima = fusionadas[fusionadas.length - 1];
    if (ultima && bd.b0 - ultima.b1 - 1 < sepMinBins) ultima.b1 = bd.b1;
    else fusionadas.push({ ...bd });
  }
  if (fusionadas.length < 2) return null;
  if (fusionadas.length > maxCols) fusionadas.length = maxCols;
  return fusionadas.map(({ b0, b1 }) => ({
    x0: xMinPx + b0 * anchoBin,
    x1: xMinPx + (b1 + 1) * anchoBin,
  }));
}

/** Estrategia 2: columnas por consenso de huecos entre renglones. */
function columnasPorVoto(
  grupos: LineaOcr[][],
  dims: { w: number; h: number },
  maxCols: number,
): { x0: number; x1: number }[] | null {
  const w = dims.w;
  const minGap = HUECO_VOTO_FRACCION * w;
  const tolerancia = TOLERANCIA_VOTO_FRACCION * w;
  const mids: number[] = [];
  for (const g of grupos) {
    const ws = g
      .flatMap((l) => l.palabras)
      .filter((p) => p.texto.trim() !== '')
      .sort((a, b) => a.bbox[0] - b.bbox[0]);
    for (let i = 1; i < ws.length; i++) {
      const gap = ws[i].bbox[0] - ws[i - 1].bbox[1];
      if (gap >= minGap) mids.push((ws[i].bbox[0] + ws[i - 1].bbox[1]) / 2);
    }
  }
  if (mids.length === 0) return null;
  mids.sort((a, b) => a - b);
  const clusters: { sum: number; n: number; mid: number }[] = [];
  for (const m of mids) {
    const u = clusters[clusters.length - 1];
    if (u && m - u.mid <= tolerancia) {
      u.sum += m;
      u.n += 1;
      u.mid = u.sum / u.n;
    } else {
      clusters.push({ sum: m, n: 1, mid: m });
    }
  }
  const cortes = clusters
    .filter((c) => c.n >= 2)
    .map((c) => c.mid)
    .sort((a, b) => a - b);
  const todas = grupos.flatMap((g) => g.flatMap((l) => l.palabras).filter((p) => p.texto.trim() !== ''));
  if (todas.length === 0 || cortes.length === 0) return null;
  const minX = Math.min(...todas.map((p) => p.bbox[0]));
  const maxX = Math.max(...todas.map((p) => p.bbox[2]));
  const bordes = [minX, ...cortes, maxX];
  const bandas: { x0: number; x1: number }[] = [];
  for (let i = 0; i < bordes.length - 1; i++) {
    const x0 = bordes[i];
    const x1 = bordes[i + 1];
    if (x1 - x0 < BANDA_MIN_FRACCION * w) continue;
    bandas.push({ x0, x1 });
    if (bandas.length >= maxCols) {
      return bandas;
    }
  }
  return bandas.length >= 2 ? bandas : null;
}

/** Detecta una tabla dentro de `zona` (0–1 de la página) usando las líneas OCR. */
export function detectarTabla(
  lines: LineaOcr[],
  zona: RectNorm,
  dims: { w: number; h: number },
  opts?: { maxFilas?: number; maxCols?: number },
): TablaDetectada | null {
  const maxFilas = opts?.maxFilas ?? MAX_FILAS_DEFAULT;
  const maxCols = opts?.maxCols ?? MAX_COLS_DEFAULT;

  // 1) Líneas cuyo centro cae dentro de la zona arrastrada.
  const dentro = lines.filter((l) => {
    const cx = (l.bbox[0] + l.bbox[2]) / 2;
    const cy = (l.bbox[1] + l.bbox[3]) / 2;
    return (
      cx >= zona.x * dims.w &&
      cx <= (zona.x + zona.w) * dims.w &&
      cy >= zona.y * dims.h &&
      cy <= (zona.y + zona.h) * dims.h
    );
  });
  if (dentro.length < 2) return null;

  // 2) Renglones: ordenar por y-centro y agrupar líneas cuyos centros distan
  //    menos de ~60% de la altura típica de línea (tolera ascendentes/descendentes).
  const alturas = dentro.map((l) => l.bbox[3] - l.bbox[1]).sort((a, b) => a - b);
  const hMed = alturas[Math.floor(alturas.length / 2)] || 1;
  const ordenadas = [...dentro].sort((a, b) => (a.bbox[1] + a.bbox[3]) / 2 - (b.bbox[1] + b.bbox[3]) / 2);
  const grupos: LineaOcr[][] = [];
  let truncada = false;
  for (const l of ordenadas) {
    const cy = (l.bbox[1] + l.bbox[3]) / 2;
    const g = grupos[grupos.length - 1];
    if (g) {
      const cyG = g.reduce((acc, x) => acc + (x.bbox[1] + x.bbox[3]) / 2, 0) / g.length;
      const hG = Math.max(...g.map((x) => x.bbox[3] - x.bbox[1]));
      if (Math.abs(cy - cyG) < 0.6 * Math.max(hMed, hG)) {
        g.push(l);
        continue;
      }
    }
    if (grupos.length >= maxFilas) {
      truncada = true;
      break;
    }
    grupos.push([l]);
  }
  if (grupos.length < 1) return null;

  // Bandas de renglón (px): y0 = min, y1 = max de sus líneas.
  const filasY = grupos.map((g) => ({
    y0: Math.min(...g.map((x) => x.bbox[1])),
    y1: Math.max(...g.map((x) => x.bbox[3])),
  }));

  const palabras = grupos
    .flatMap((g) => g.flatMap((l) => l.palabras))
    .filter((p) => p.texto.trim() !== '' && p.conf >= 0);
  if (palabras.length === 0) return null;

  // 3) Columnas: ocupación → consenso → banda única.
  let colsX = columnasPorOcupacion(palabras, zona, dims, maxCols);
  if (!colsX || colsX.length < 2) {
    const voto = columnasPorVoto(grupos, dims, maxCols);
    if (voto && voto.length >= 2) colsX = voto;
  }
  if (!colsX || colsX.length < 2) {
    // Respaldo: lista de renglones (1 columna que abarca todas las palabras).
    const minX = Math.min(...palabras.map((p) => p.bbox[0]));
    const maxX = Math.max(...palabras.map((p) => p.bbox[2]));
    colsX = [{ x0: minX, x1: maxX }];
  }

  // 4) Construir la grilla: cada palabra va a (renglón, columna) por su centro.
  //    Rect de celda = banda columna ∩ banda renglón, con un pequeño margen
  //    vertical de lectura (±15% de la altura del renglón).
  const filas: CeldaTabla[][] = grupos.map((g, f) => {
    const filaPalabras = g.flatMap((l) => l.palabras).filter((p) => p.texto.trim() !== '');
    const { y0, y1 } = filasY[f];
    const margenY = 0.15 * (y1 - y0);
    return colsX.map(({ x0, x1 }) => {
      const celdas = filaPalabras
        .filter((p) => {
          const cx = (p.bbox[0] + p.bbox[2]) / 2;
          return cx >= x0 && cx <= x1;
        })
        .sort((a, b) => a.bbox[0] - b.bbox[0]);
      return {
        texto: celdas.map((p) => p.texto).join(' ').trim(),
        nPalabras: celdas.length,
        rect: {
          x: CLAMP01(x0 / dims.w),
          y: CLAMP01((y0 - margenY) / dims.h),
          w: CLAMP01((x1 - x0) / dims.w),
          h: CLAMP01((y1 - y0 + 2 * margenY) / dims.h),
        },
      };
    });
  });

  return { filas, nLineas: dentro.length, truncada };
}
