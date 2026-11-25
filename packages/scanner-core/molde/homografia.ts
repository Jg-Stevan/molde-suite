// FASE A3 (blueprint DLA): homografía real de 4 puntos + warpPerspectiva +
// deskew por perfil de proyección. Todo en TypeScript puro (0 dependencias),
// corriendo en el mismo runtime que el resto de scanner-core.
//
// Antes: `processImage` recortaba el BOUNDING BOX del quad aunque Quad modela
// 4 esquinas libres — una foto en ángulo descentraba todas las zonas del
// molde y rompía las anclas. Ahora: resolverHomografia mapea el rect de
// salida → quad de origen (8 g.d.l., Gauss 8x8) y warpPerspectiva muestrea
// bilinealmente por píxel. El deskew por proyección corrige la INCLINACIÓN
// residual (5-10°) que queda tras el recorte y que degradaba OCR y bandas.
//
// Referencia de álgebra: la homografía plana x' = H·x se resuelve con 4
// pares de puntos → sistema lineal 8x8 (h9 fijo en 1). Es el mismo cálculo
// de cv2.getPerspectiveTransform, sin OpenCV.

import type { Quad } from '../core/types';
import { adaptiveThresholdInv, grayFromImageData } from './imageproc';

export type Matriz8 = [number, number, number, number, number, number, number, number];

/** Resuelve H (8 grados de libertad) para 4 pares de puntos: src → dst.
 * Orden de esquinas: [TL, TR, BR, BL] (convención Quad del core). */
export function resolverHomografia(src: { x: number; y: number }[], dst: { x: number; y: number }[]): Matriz8 {
  // x' = (h1·x + h2·y + h3) / (h7·x + h8·y + 1)
  // y' = (h4·x + h5·y + h6) / (h7·x + h8·y + 1)
  // Para cada par: [x, y, 1, 0, 0, 0, -x·x', -y·x'] · h = x'
  //                [0, 0, 0, x, y, 1, -x·y', -y·y'] · h = y'
  const A: number[][] = Array.from({ length: 8 }, () => new Array<number>(8).fill(0));
  const b = new Array<number>(8).fill(0);
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: X, y: Y } = dst[i];
    const f = i * 2;
    A[f][0] = x; A[f][1] = y; A[f][2] = 1;
    A[f][6] = -x * X; A[f][7] = -y * X;
    b[f] = X;
    const g = f + 1;
    A[g][3] = x; A[g][4] = y; A[g][5] = 1;
    A[g][6] = -x * Y; A[g][7] = -y * Y;
    b[g] = Y;
  }
  return gauss8(A, b);
}

/** Eliminación de Gauss con pivoteo parcial para el sistema 8x8. */
function gauss8(A: number[][], b: number[]): Matriz8 {
  const n = 8;
  for (let col = 0; col < n; col++) {
    // pivote
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    }
    if (Math.abs(A[piv][col]) < 1e-12) {
      throw new Error('Homografía degenerada (puntos colineales o repetidos)');
    }
    if (piv !== col) {
      [A[piv], A[col]] = [A[col], A[piv]];
      [b[piv], b[col]] = [b[col], b[piv]];
    }
    const inv = 1 / A[col][col];
    for (let r = col + 1; r < n; r++) {
      const f = A[r][col] * inv;
      if (f === 0) continue;
      for (let c = col; c < n; c++) A[r][c] -= f * A[col][c];
      b[r] -= f * b[col];
    }
  }
  const h = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let acc = b[r];
    for (let c = r + 1; c < n; c++) acc -= A[r][c] * h[c];
    h[r] = acc / A[r][r];
  }
  return h as Matriz8;
}

/** Aplica la homografía a un punto. */
export function aplicarHomografia(H: Matriz8, x: number, y: number): { x: number; y: number } {
  const d = H[6] * x + H[7] * y + 1;
  return { x: (H[0] * x + H[1] * y + H[2]) / d, y: (H[3] * x + H[4] * y + H[5]) / d };
}

/**
 * ¿El quad merece warp de perspectiva? true cuando alguna esquina se separa
 * del bounding box por más de `eps` (fracción del lado). Un quad axis-aligned
 * exacto no necesita homografía (el recorte recto es equivalente y más barato).
 */
export function quadSesgado(quad: Quad, eps = 0.004): boolean {
  const xs = quad.map((p) => p.x);
  const ys = quad.map((p) => p.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const w = Math.max(1e-6, x1 - x0);
  const h = Math.max(1e-6, y1 - y0);
  return quad.some(
    (p) =>
      Math.min(Math.abs(p.x - x0), Math.abs(p.x - x1)) > eps * w ||
      Math.min(Math.abs(p.y - y0), Math.abs(p.y - y1)) > eps * h,
  );
}

/**
 * Warp de perspectiva: recorta el quad del documento (fracciones 0-1 del
 * canvas origen) a un rect de salida de `ancho` px de ancho (alto proporcional
 * al perímetro del quad — regla estándar de escaners: media de lados cortos
 * y largos). Muestreo inverso bilineal por píxel.
 */
export function warpPerspectiva(
  src: HTMLCanvasElement,
  quad: Quad,
  ancho: number,
): HTMLCanvasElement {
  const w = src.width;
  const h = src.height;
  const px = quad.map((p) => ({ x: p.x * w, y: p.y * h }));
  // Tamaño de salida (convención de escáner: lados opuestos → promedios).
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
  const anchoMedio = (dist(px[0], px[1]) + dist(px[3], px[2])) / 2;
  const altoMedio = (dist(px[0], px[3]) + dist(px[1], px[2])) / 2;
  const outW = Math.max(16, Math.min(4000, Math.round(ancho)));
  const outH = Math.max(16, Math.min(4000, Math.round((anchoMedio > 0 ? altoMedio / anchoMedio : 1) * outW)));
  // H mapea esquinas del rect SALIDA → esquinas del quad ORIGEN (muestreo inverso).
  const dst = [
    { x: 0, y: 0 },
    { x: outW, y: 0 },
    { x: outW, y: outH },
    { x: 0, y: outH },
  ];
  const H = resolverHomografia(dst, px);
  const sctx = src.getContext('2d', { willReadFrequently: true })!;
  const simg = sctx.getImageData(0, 0, w, h);
  const sd = simg.data;
  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const octx = out.getContext('2d', { willReadFrequently: true })!;
  const oimg = octx.createImageData(outW, outH);
  const od = oimg.data;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const p = aplicarHomografia(H, x + 0.5, y + 0.5);
      const sx = Math.min(w - 1.001, Math.max(0, p.x - 0.5));
      const sy = Math.min(h - 1.001, Math.max(0, p.y - 0.5));
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const i00 = (y0 * w + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + w * 4;
      const i11 = i01 + 4;
      const o = (y * outW + x) * 4;
      for (let c = 0; c < 3; c++) {
        const v =
          sd[i00 + c] * (1 - fx) * (1 - fy) +
          sd[i10 + c] * fx * (1 - fy) +
          sd[i01 + c] * (1 - fx) * fy +
          sd[i11 + c] * fx * fy;
        od[o + c] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
      od[o + 3] = 255;
    }
  }
  octx.putImageData(oimg, 0, 0);
  return out;
}

/**
 * Deskew por perfil de proyección (Nivel 1 del blueprint, sin Hough ni ORB):
 * sobre una miniatura binarizada, probar ángulos y quedarse con el que MAXIMIZA
 * la varianza del perfil de filas (el texto apilado crea picos de fila cuando
 * está horizontal; inclinado, el perfil se aplana). Barrido grueso 2° + fino
 * 0.5° alrededor del mejor. Devuelve el ángulo CORRECTOR (grados, con signo:
 * rotar el canvas por -ángulo endereza el texto).
 *
 * FASE 2 (plan extracción relacional): el rango de búsqueda se amplía a ±25°
 * (antes ±10°, límite artificial — el algoritmo de perfil de proyección
 * funciona para cualquier ángulo y fotos de campo rotan más de 10°). El
 * barrido grueso de 2° barre [-25, 25] y el fino de 0.5° afina ±2° alrededor
 * del mejor. PRECAUCIÓN documentada: ángulos grandes (>15°) dejan márgenes
 * blancos tras corregirDeskew (rotación con relleno blanco) — el OCR los
 * tolera; corregirDeskew rellena con blanco, no con negro, y el perfil de
 * proyección se mide sobre binarización adaptativa que ignora el fondo blanco.
 */
export function anguloDeskew(src: HTMLCanvasElement): number {
  const W = 200;
  const H = Math.max(1, Math.round((src.height / Math.max(1, src.width)) * W));
  const mini = document.createElement('canvas');
  mini.width = W;
  mini.height = H;
  const mctx = mini.getContext('2d', { willReadFrequently: true })!;
  mctx.drawImage(src, 0, 0, W, H);
  const img = mctx.getImageData(0, 0, W, H);
  const gray = grayFromImageData(img);
  const bin = adaptiveThresholdInv(gray, W, H, 31, 12);

  const varianzaPerfil = (angDeg: number): number => {
    const rotada = rotarMiniatura(bin, W, H, angDeg);
    const perfil = new Float64Array(H);
    for (let y = 0; y < H; y++) {
      let acc = 0;
      const row = y * W;
      for (let x = 0; x < W; x++) acc += rotada[row + x];
      perfil[y] = acc;
    }
    const media = perfil.reduce((a, b) => a + b, 0) / H;
    return perfil.reduce((a, b) => a + (b - media) * (b - media), 0) / H;
  };

  // Barrido grueso (paso 2°, ±25° — FASE 2 del plan: antes ±10°) y refinado
  // (paso 0.5°) alrededor del mejor.
  let mejorAng = 0;
  let mejorVar = -1;
  for (let a = -25; a <= 25; a += 2) {
    const v = varianzaPerfil(a);
    if (v > mejorVar) {
      mejorVar = v;
      mejorAng = a;
    }
  }
  for (let a = mejorAng - 2; a <= mejorAng + 2; a += 0.5) {
    const v = varianzaPerfil(a);
    if (v > mejorVar) {
      mejorVar = v;
      mejorAng = a;
    }
  }
  // Sin inclinación real: no reportar micro-ángulos (ruido).
  return Math.abs(mejorAng) < 0.75 ? 0 : mejorAng;
}

/** Rota la imagen binaria (mapeo inverso Nearest) para el barrido de ángulos. */
function rotarMiniatura(bin: { w: number; h: number; data: Uint8Array }, w: number, h: number, angDeg: number): Uint8Array {
  const out = new Uint8Array(w * h);
  const rad = (angDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = w / 2;
  const cy = h / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Rotación INVERSA: buscar en el origen la fuente de este píxel.
      const dx = x - cx;
      const dy = y - cy;
      const sx = Math.round(cx + dx * cos - dy * sin);
      const sy = Math.round(cy + dx * sin + dy * cos);
      out[y * w + x] = sx >= 0 && sx < w && sy >= 0 && sy < h ? bin.data[sy * w + sx] : 0;
    }
  }
  return out;
}

/**
 * Aplica la corrección de inclinación a un canvas (rotación alrededor del
 * centro, rellenando con blanco — el papel es blanco y evita bordes negros).
 * `anguloCorrector` es lo que devuelve anguloDeskew: se rota por -ángulo.
 */
export function corregirDeskew(src: HTMLCanvasElement, anguloCorrector: number): HTMLCanvasElement {
  if (anguloCorrector === 0) return src;
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((-anguloCorrector * Math.PI) / 180);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return out;
}

// ---- FASE 5 (plan extracción relacional): arnés geométrico ----------------
// Ajuste AFÍN por mínimos cuadrados sobre N≥3 pares de puntos (referencia →
// encontrado). A diferencia de resolverHomografia (exacta, 4 pares), esta es
// la transformación del arnés: proyecta la posición de los campos cuyo ancla
// textual no apareció, usando los anclajes de alta confianza del resto. El
// modelo 2D completo (perspectiva) es inestable con pocos votos y el caso
// medido (recorte/ruido, no foto en ángulo) es afín: rotación + escala +
// traslación.

export type Afin6 = [number, number, number, number, number, number];

/** x' = a·x + b·y + c ; y' = d·x + e·y + f. Resuelve dos regresiones
 *  lineales 3-param (ecuaciones normales) sobre los pares. null si <3 pares
 *  o la matriz es singular (puntos colineales). */
export function ajustarAfin(
  src: { x: number; y: number }[],
  dst: { x: number; y: number }[],
): Afin6 | null {
  const n = Math.min(src.length, dst.length);
  if (n < 3) return null;
  // Ecuaciones normales de [x y 1]·[a b c]ᵀ = x' (y simétrica para y').
  let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0;
  let sxxd = 0, syxd = 0, sxd = 0, sxyd = 0, sydd = 0, syd = 0;
  for (let i = 0; i < n; i++) {
    const { x, y } = src[i];
    const { x: X, y: Y } = dst[i];
    sxx += x * x; sxy += x * y; syy += y * y; sx += x; sy += y;
    sxxd += x * X; syxd += y * X; sxd += X;
    sxyd += x * Y; sydd += y * Y; syd += Y;
  }
  const A3: number[][] = [
    [sxx, sxy, sx],
    [sxy, syy, sy],
    [sx, sy, n],
  ];
  const abc = gauss3(A3, [sxxd, syxd, sxd]);
  const def = gauss3(A3, [sxyd, sydd, syd]);
  if (!abc || !def) return null;
  return [abc[0], abc[1], abc[2], def[0], def[1], def[2]];
}

/** Aplica el afín a un punto. */
export function aplicarAfin(A: Afin6, x: number, y: number): { x: number; y: number } {
  return { x: A[0] * x + A[1] * y + A[2], y: A[3] * x + A[4] * y + A[5] };
}

/** Gauss 3x3 con pivoteo parcial; null si singular. */
function gauss3(A: number[][], b: number[]): [number, number, number] | null {
  const M = A.map((r, i) => [...r, b[i]]);
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-9) return null;
    if (piv !== col) [M[piv], M[col]] = [M[col], M[piv]];
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      if (f === 0) continue;
      for (let c = col; c < 4; c++) M[r][c] -= f * M[col][c];
    }
  }
  return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
}
