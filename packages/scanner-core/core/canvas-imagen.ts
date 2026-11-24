// Primitivas de canvas sobre dataURLs (Fase 2a — migración scanner-core).
//
// ABSORBE y unifica los helpers triplicados de tamiz (D6 del Plan de
// Reconciliación): fotoACanvas (evaluacion.ts:51, ocr-dinamico.ts:64),
// fotoACanvasTope (estructura.ts:103), dataUrlAGris (calidad.ts:7) y el
// bloque de realce p5-p95 de bridge/ocr.ts:48-89 (D2). Se porta el
// algoritmo EXACTO (mismos redondeos y máximos) para no cambiar
// comportamiento. Sin dependencias; canvas puro.

export type OpcionesCanvasDesdeDataUrl = {
  /** Escala a este ancho exacto (semántica de fotoACanvas). */
  ancho?: number;
  /** Escala para que el lado MAYOR mida este valor, sin agrandar (fotoACanvasTope). */
  maxLado?: number;
  /** Tope del ancho: min(anchoMaximo, naturalWidth) (semántica de dataUrlAGris). */
  anchoMaximo?: number;
};

/** Carga un dataURL a canvas (opcionalmente escalado), listo para getImageData. */
export async function canvasDesdeDataUrl(
  dataUrl: string,
  opciones?: OpcionesCanvasDesdeDataUrl,
): Promise<HTMLCanvasElement> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();

  const c = document.createElement('canvas');
  if (opciones?.ancho !== undefined) {
    c.width = opciones.ancho;
    c.height = Math.max(1, Math.round((img.naturalHeight / Math.max(1, img.naturalWidth)) * opciones.ancho));
  } else if (opciones?.maxLado !== undefined) {
    const ladoMayor = Math.max(img.naturalWidth, img.naturalHeight);
    const escala = ladoMayor > opciones.maxLado ? opciones.maxLado / ladoMayor : 1;
    c.width = Math.max(1, Math.round(img.naturalWidth * escala));
    c.height = Math.max(1, Math.round(img.naturalHeight * escala));
  } else if (opciones?.anchoMaximo !== undefined) {
    const W = Math.min(opciones.anchoMaximo, img.naturalWidth);
    c.width = W;
    c.height = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * W));
  } else {
    // Tamaño natural (semántica del realce de bridge/ocr.ts).
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
  }
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/** Grises 0..255 (luma 0.299/0.587/0.114) de todo el canvas. */
export function grisesDesdeCanvas(c: HTMLCanvasElement): { g: Float32Array; w: number; h: number } {
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const g = new Float32Array(c.width * c.height);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    g[i] = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
  }
  return { g, w: c.width, h: c.height };
}

/**
 * Estiramiento de contraste p5-p95 EN EL LUGAR (gris por luma, histograma
 * Uint32Array(256), span = max(8, p95-p5)). Port exacto del bloque de realce
 * de apps/tamiz/src/lib/e14/bridge/ocr.ts (reconocerRapidOcrCascada) y del
 * filtro de core/image-processor.
 */
export function estirarContrasteEnCanvas(c: HTMLCanvasElement): void {
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    hist[(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) | 0]++;
  }
  const totalPx = px.length / 4;
  let acc = 0;
  let p5 = 0;
  let p95 = 255;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= totalPx * 0.05) {
      p5 = v;
      break;
    }
  }
  acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= totalPx * 0.95) {
      p95 = v;
      break;
    }
  }
  const span = Math.max(8, p95 - p5);
  for (let i = 0; i < px.length; i += 4) {
    const v = Math.min(255, Math.max(0, ((0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2] - p5) * 255) / span));
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(data, 0, 0);
}

/** Rota un data URL 90° en sentido horario (espejo de rotateProcessedDataUrl
 *  del upstream — dominio/image-utils.ts:254). La rotación rápida del editor
 *  consume esto: un decode, un canvas y un re-encode JPEG 0.92. */
export async function rotarDataUrl90(dataUrl: string): Promise<string> {
  const c = await canvasDesdeDataUrl(dataUrl);
  const r = document.createElement('canvas');
  r.width = c.height;
  r.height = c.width;
  const rc = r.getContext('2d', { willReadFrequently: true })!;
  rc.translate(r.width / 2, r.height / 2);
  rc.rotate(Math.PI / 2);
  rc.drawImage(c, -c.width / 2, -c.height / 2);
  return r.toDataURL('image/jpeg', 0.92);
}
