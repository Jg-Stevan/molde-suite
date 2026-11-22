// Primitivas de imagen del motor v2, portadas de Python/OpenCV a TypeScript.
// - adaptiveThreshold (gaussiano aproximado con dos box-blur con replicacion de bordes)
// - binarizacion "sin_lineas" (apertura morfologica H/V y XOR)
// - componentes conexos con estadisticas (8-conectividad)
// - ink_ratio con filtro de lineas combadas + medida por componentes

export interface BinImage {
  w: number;
  h: number;
  data: Uint8Array; // 1 = tinta
}

export interface CompStats {
  x: number;
  y: number;
  w: number;
  h: number;
  area: number;
}

export function grayFromImageData(img: ImageData): Uint8Array {
  const { width: w, height: h, data } = img;
  const g = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    g[i] = (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) | 0;
  }
  return g;
}

/** Gaussiana separable con replicacion de bordes (BORDER_REPLICATE), igual que
 * cv2.GaussianBlur dentro de adaptiveThreshold. */
function gaussianBlurReplicate(
  src: Float32Array,
  w: number,
  h: number,
  kernel: Float32Array,
): Float32Array {
  const r = (kernel.length - 1) >> 1;
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  // horizontal
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) {
        const xx = Math.min(w - 1, Math.max(0, x + k));
        acc += src[row + xx] * kernel[k + r];
      }
      tmp[row + x] = acc;
    }
  }
  // vertical
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) {
        const yy = Math.min(h - 1, Math.max(0, y + k));
        acc += tmp[yy * w + x] * kernel[k + r];
      }
      out[y * w + x] = acc;
    }
  }
  return out;
}

/** Kernel gaussiano con la misma sigma que usa cv2 para adaptiveThreshold:
 * sigma = 0.3 * ((blockSize - 1) * 0.5 - 1) + 0.8 */
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

/** adaptiveThreshold gaussiano invertido (aprox): tinta=1 cuando gray <= blur - C. */
export function adaptiveThresholdInv(
  gray: Uint8Array,
  w: number,
  h: number,
  blockSize = 31,
  C = 12,
): BinImage {
  const f = new Float32Array(gray.length);
  for (let i = 0; i < gray.length; i++) f[i] = gray[i];
  const kernel = gaussianKernel(blockSize);
  const b = gaussianBlurReplicate(f, w, h, kernel);
  const out = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    // OpenCV trabaja en CV_8U: la media se redondea a entero antes de comparar
    out[i] = gray[i] <= Math.round(b[i]) - C ? 1 : 0;
  }
  return { w, h, data: out };
}

/** Erosión+dilatación 1D (kernel k) sobre una dirección, con replicación de
 * bordes — ventana CENTRADA [j-r, j+r], igual que cv2 (N-12).
 *
 * FIX (Fase 5.2): antes la ventana efectiva era [j-r, j] (media ventana, ≈k/2
 * elementos), así que la apertura borraba trazos horizontales de longitud entre
 * k/2 y k — una raya de subrayado manuscrita en SUMA TOTAL desaparecía antes
 * de medir tinta. Con la ventana completa la semántica es la de OpenCV: la
 * apertura elimina solo estructuras de extensión horizontal ≥ k (líneas
 * impresas de verdad) y conserva los trazos más cortos. */
/** Apertura morfologica 1D (erosion+dilatacion) — expuesta para el port
 * SPARTAN de tabla-imagen.ts: la misma mascara que borra reglas las ENCUENTRA. */
export function opening1D(bin: BinImage, k: number, dir: 'h' | 'v'): Uint8Array {
  const { w, h, data } = bin;
  const out = new Uint8Array(w * h);
  const n = dir === 'h' ? w : h;
  const lines = dir === 'h' ? h : w;
  const r = (k - 1) >> 1;
  const idx = dir === 'h' ? (i: number, j: number) => i * w + j : (i: number, j: number) => j * w + i;
  const deque = new Int32Array(n + 1);
  const eros = new Uint8Array(n); // erosión con ventana completa
  const dil = new Uint8Array(n); // dilatación (sobre la erosión) con ventana completa
  for (let i = 0; i < lines; i++) {
    // ---- erosión: min sobre [max(0,j-r), min(n-1,j+r)] ----
    // Deque monótono con lookahead: al procesar j, la ventana ya contiene
    // los índices [max(0,j-r), min(n-1,j+r)] (los bordes se truncan, que en
    // erosión/dilatación equivale a la replicación de cv2.BORDER_REPLICATE).
    let head = 0;
    let tail = 0;
    const pushEros = (j: number) => {
      const v = data[idx(i, j)];
      while (tail > head && data[idx(i, deque[tail - 1])] >= v) tail--;
      deque[tail++] = j;
    };
    for (let x = 0; x <= Math.min(r, n - 1); x++) pushEros(x); // prefill j=0
    for (let j = 0; j < n; j++) {
      if (j > 0 && j + r <= n - 1) pushEros(j + r);
      while (deque[head] < j - r) head++;
      eros[j] = data[idx(i, deque[head])];
    }
    // ---- dilatación: max sobre la misma ventana de la erosión ----
    head = 0;
    tail = 0;
    const pushDil = (j: number) => {
      const v = eros[j];
      while (tail > head && eros[deque[tail - 1]] <= v) tail--;
      deque[tail++] = j;
    };
    for (let x = 0; x <= Math.min(r, n - 1); x++) pushDil(x);
    for (let j = 0; j < n; j++) {
      if (j > 0 && j + r <= n - 1) pushDil(j + r);
      while (deque[head] < j - r) head++;
      dil[j] = eros[deque[head]];
    }
    if (dir === 'h') out.set(dil, i * w);
    else for (let j = 0; j < n; j++) out[j * w + i] = dil[j];
  }
  return out;
}

/** Binarizacion "sin_lineas" (B2): adaptive threshold + apertura H/V + XOR. */
export function binarizeNoLines(
  gray: Uint8Array,
  w: number,
  h: number,
  kernelLineaFrac = 0.083,
): BinImage {
  const bin = adaptiveThresholdInv(gray, w, h, 31, 12);
  const k = Math.max(20, Math.floor(w * kernelLineaFrac)) | 1;
  const hor = opening1D(bin, k, 'h');
  const ver = opening1D(bin, k, 'v');
  const data = new Uint8Array(w * h);
  for (let i = 0; i < data.length; i++) {
    data[i] = bin.data[i] && !(hor[i] || ver[i]) ? 1 : 0;
  }
  return { w, h, data };
}

/** Componentes conexos (8) con estadisticas. labels: -1 = fondo. */
export function connectedComponents(
  bin: Uint8Array,
  w: number,
  h: number,
): { labels: Int32Array; stats: CompStats[] } {
  const labels = new Int32Array(w * h).fill(-1);
  const stats: CompStats[] = [];
  const stack = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (bin[start] === 0 || labels[start] !== -1) continue;
    const id = stats.length;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = id;
    let minX = w;
    let maxX = -1;
    let minY = h;
    let maxY = -1;
    let area = 0;
    while (sp > 0) {
      const p = stack[--sp];
      const px = p % w;
      const py = (p / w) | 0;
      area++;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      const y0 = Math.max(0, py - 1);
      const y1 = Math.min(h - 1, py + 1);
      const x0 = Math.max(0, px - 1);
      const x1 = Math.min(w - 1, px + 1);
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          const q = yy * w + xx;
          if (bin[q] === 1 && labels[q] === -1) {
            labels[q] = id;
            stack[sp++] = q;
          }
        }
      }
    }
    stats.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, area });
  }
  return { labels, stats };
}

export interface FiltroLinea {
  fraccion_ancho: number;
  grosor_max: number;
}

/** Densidad de tinta en la zona (px), con filtro de lineas combadas dentro de la zona. */
export function inkRatio(
  bin: BinImage,
  zone: [number, number, number, number],
  filtro?: FiltroLinea,
): number {
  const { w: W } = bin;
  const [zx0, zy0, zx1, zy1] = zone;
  const x0 = Math.max(0, Math.floor(zx0));
  const y0 = Math.max(0, Math.floor(zy0));
  const x1 = Math.min(bin.w, Math.ceil(zx1));
  const y1 = Math.min(bin.h, Math.ceil(zy1));
  const zw = x1 - x0;
  const zh = y1 - y0;
  if (zw <= 0 || zh <= 0) return 0;
  const crop = new Uint8Array(zw * zh);
  for (let y = 0; y < zh; y++) {
    for (let x = 0; x < zw; x++) {
      crop[y * zw + x] = bin.data[(y0 + y) * W + x0 + x];
    }
  }
  if (filtro) {
    const { labels, stats } = connectedComponents(crop, zw, zh);
    for (let i = 0; i < stats.length; i++) {
      const s = stats[i];
      if (s.w >= filtro.fraccion_ancho * zw && s.area <= filtro.grosor_max * s.w) {
        // apagar el componente (borde impreso combado)
        for (let y = s.y; y < s.y + s.h; y++) {
          for (let x = s.x; x < s.x + s.w; x++) {
            if (labels[y * zw + x] === i) crop[y * zw + x] = 0;
          }
        }
      }
    }
  }
  let ink = 0;
  for (let i = 0; i < crop.length; i++) ink += crop[i];
  return ink / crop.length;
}

export interface MedidaComponentesCfg {
  area_min: number;
  min_comps: number;
  dens_alta: number;
}

/** Medida por componentes conexos para celdas de digitos manuscritos. */
export function medidaCelda(
  bin: BinImage,
  zone: [number, number, number, number],
  cfg: MedidaComponentesCfg,
  filtro?: FiltroLinea,
): { nBig: number; dens: number } {
  const { w: W } = bin;
  const [zx0, zy0, zx1, zy1] = zone;
  const x0 = Math.max(0, Math.floor(zx0));
  const y0 = Math.max(0, Math.floor(zy0));
  const x1 = Math.min(bin.w, Math.ceil(zx1));
  const y1 = Math.min(bin.h, Math.ceil(zy1));
  const zw = x1 - x0;
  const zh = y1 - y0;
  if (zw <= 0 || zh <= 0) return { nBig: 0, dens: 0 };
  const crop = new Uint8Array(zw * zh);
  for (let y = 0; y < zh; y++) {
    for (let x = 0; x < zw; x++) {
      crop[y * zw + x] = bin.data[(y0 + y) * W + x0 + x];
    }
  }
  if (filtro) {
    const { labels, stats } = connectedComponents(crop, zw, zh);
    for (let i = 0; i < stats.length; i++) {
      const s = stats[i];
      if (s.w >= filtro.fraccion_ancho * zw && s.area <= filtro.grosor_max * s.w) {
        for (let y = s.y; y < s.y + s.h; y++) {
          for (let x = s.x; x < s.x + s.w; x++) {
            if (labels[y * zw + x] === i) crop[y * zw + x] = 0;
          }
        }
      }
    }
  }
  const { stats } = connectedComponents(crop, zw, zh);
  const nBig = stats.filter((s) => s.area >= cfg.area_min).length;
  let ink = 0;
  for (let i = 0; i < crop.length; i++) ink += crop[i];
  return { nBig, dens: ink / crop.length };
}

/** Umbral de Otsu sobre escala de grises (para la re-lectura del ID). */
export function otsuThreshold(gray: Uint8Array): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      thr = t;
    }
  }
  return thr;
}

/** Canvas en escala de grises a partir de otro canvas (para OCR y relecturas). */
export function canvasGrayscale(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let p = 0; p < d.length; p += 4) {
    const g = (0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]) | 0;
    d[p] = g;
    d[p + 1] = g;
    d[p + 2] = g;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * Realce para relectura OCR de recortes difíciles (manuscritos / fotos borrosas):
 * escala de grises + estiramiento de contraste por percentiles (p5-p95) + ampliación.
 */
export function canvasRealce(src: HTMLCanvasElement, escala = 3): HTMLCanvasElement {
  const gray = canvasGrayscale(src);
  const ctx = gray.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, gray.width, gray.height);
  const d = img.data;
  // histograma de grises
  const hist = new Uint32Array(256);
  const n = gray.width * gray.height;
  for (let i = 0, p = 0; i < n; i++, p += 4) hist[d[p]]++;
  // percentiles p5 y p95
  let acc = 0;
  let p5 = 0;
  let p95 = 255;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= n * 0.05) {
      p5 = v;
      break;
    }
  }
  acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= n * 0.95) {
      p95 = v;
      break;
    }
  }
  const span = Math.max(8, p95 - p5);
  const px = new Uint8ClampedArray(d.length);
  for (let p = 0; p < d.length; p += 4) {
    const v = Math.min(255, Math.max(0, ((d[p] - p5) * 255) / span));
    px[p] = v;
    px[p + 1] = v;
    px[p + 2] = v;
    px[p + 3] = 255;
  }
  const out = document.createElement('canvas');
  // FIX: preservar el aspecto al clampear a 4000 px. Antes ancho y alto se
  // limitaban por separado y un recorte alto (p.ej. 900x1181 a escala 4) quedaba
  // distorsionado (4000 clamp solo en un eje), rompiendo el OCR del realce.
  const maxSide = 4000;
  let w = Math.round(src.width * escala);
  let h = Math.round(src.height * escala);
  if (w > maxSide || h > maxSide) {
    const k = Math.min(maxSide / w, maxSide / h);
    w = Math.max(1, Math.round(w * k));
    h = Math.max(1, Math.round(h * k));
  }
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d', { willReadFrequently: true })!;
  const tmp = document.createElement('canvas');
  tmp.width = gray.width;
  tmp.height = gray.height;
  tmp.getContext('2d')!.putImageData(new ImageData(px, gray.width, gray.height), 0, 0);
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(tmp, 0, 0, out.width, out.height);
  return out;
}

/** Variante binarizada (Otsu) del canvas realzado — misma ruta que la relectura del ID. */
export function canvasOtsu(src: HTMLCanvasElement): HTMLCanvasElement {
  const gray = canvasGrayscale(src);
  const gctx = gray.getContext('2d', { willReadFrequently: true })!;
  const gData = gctx.getImageData(0, 0, gray.width, gray.height);
  const grayArr = new Uint8Array(gray.width * gray.height);
  for (let i = 0, p = 0; i < grayArr.length; i++, p += 4) grayArr[i] = gData.data[p];
  const thr = otsuThreshold(grayArr);
  const out = document.createElement('canvas');
  out.width = gray.width;
  out.height = gray.height;
  const octx = out.getContext('2d', { willReadFrequently: true })!;
  const img = octx.createImageData(gray.width, gray.height);
  for (let i = 0, p = 0; i < grayArr.length; i++, p += 4) {
    const v = grayArr[i] <= thr ? 0 : 255;
    img.data[p] = v;
    img.data[p + 1] = v;
    img.data[p + 2] = v;
    img.data[p + 3] = 255;
  }
  octx.putImageData(img, 0, 0);
  return out;
}
