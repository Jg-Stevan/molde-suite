'use client';

// Lectura del codigo de barras del E-14 con ZXing (equivalente a pyzbar).
// Intenta: pagina completa 1x, franja superior ampliada 2x y 3x.

import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} from '@zxing/library';

function luminanceFromCanvas(canvas: HTMLCanvasElement): { lum: Uint8ClampedArray; w: number; h: number } {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const lum = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    lum[i] = (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) | 0;
  }
  return { lum, w: width, h: height };
}

function cropCanvas(
  canvas: HTMLCanvasElement,
  x0f: number,
  y0f: number,
  x1f: number,
  y1f: number,
  escala: number,
): HTMLCanvasElement {
  const x0 = Math.floor(canvas.width * x0f);
  const y0 = Math.floor(canvas.height * y0f);
  const x1 = Math.floor(canvas.width * x1f);
  const y1 = Math.floor(canvas.height * y1f);
  const c = document.createElement('canvas');
  c.width = Math.round((x1 - x0) * escala);
  c.height = Math.round((y1 - y0) * escala);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, x0, y0, x1 - x0, y1 - y0, 0, 0, c.width, c.height);
  return c;
}

function decodeOnce(reader: MultiFormatReader, canvas: HTMLCanvasElement): string[] {
  const out: string[] = [];
  const { lum, w, h } = luminanceFromCanvas(canvas);
  const source = new RGBLuminanceSource(lum, w, h, w, h, 0, 0);
  const bitmap = new BinaryBitmap(new HybridBinarizer(source));
  try {
    const res = reader.decode(bitmap);
    out.push(String(res.getText()).trim());
  } catch {
    /* NotFoundException */
  }
  return out;
}

/** Decodifica candidatos de codigo de barras (15 digitos) desde la pagina. */
export function decodeBarcodes(canvas: HTMLCanvasElement): string[] {
  const resultados: string[] = [];
  let reader: MultiFormatReader;
  try {
    reader = new MultiFormatReader();
    const hints = new Map();
    hints.set(DecodeHintType.TRY_HARDER, true);
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.ITF,
      BarcodeFormat.CODABAR,
      BarcodeFormat.EAN_13,
    ]);
    reader.setHints(hints);
  } catch {
    return resultados;
  }
  const intentos: HTMLCanvasElement[] = [canvas];
  try {
    intentos.push(cropCanvas(canvas, 0.3, 0, 1, 0.18, 2));
    intentos.push(cropCanvas(canvas, 0.3, 0, 1, 0.2, 3));
  } catch {
    /* recortes opcionales */
  }
  for (const c of intentos) {
    for (const v of decodeOnce(reader, c)) {
      if (/^7\d{14}$/.test(v) && !resultados.includes(v)) resultados.push(v);
    }
    if (resultados.length > 0) break;
  }
  return resultados;
}
