/**
 * Fase 3 — recortes de firma/sello/imagen como JPEG base64 (patrón datalab).
 *
 * El recorte se hace donde ya vive la imagen de la página (el bitmap que el
 * pipeline decodificó para layout/OCR), ANTES de serializar: se llena
 * recorte.jpegB64 con las funciones de abajo. Así el serializador queda puro
 * y síncrono (útil dentro del worker), y el HTML exportado puede inlinar el
 * data URI sin tocar de nuevo la imagen.
 */

import { bytesABase64 } from './md5';
import type { BBox, RegionLayout } from './types';

export interface FuenteImagen {
  drawImage(
    fuente: CanvasImageSource,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
}

export async function bitmapDesdeBytes(
  bytes: Uint8Array,
  tipo = 'image/jpeg',
): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap !== 'undefined') {
    return createImageBitmap(new Blob([bytes as BlobPart], { type: tipo }));
  }
  // respaldo con <img> + object URL (navegadores viejos)
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: tipo }));
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('No se pudo decodificar la imagen de la página'));
    img.src = url;
  });
  return img;
}

/** Un recorte: JPEG base64 sin prefijo data:, o null si el bbox es vacío. */
async function recortar(
  fuente: CanvasImageSource,
  bbox: BBox,
  calidad: number,
  usarOffscreen: boolean,
): Promise<string | null> {
  try {
    const [x0, y0, x1, y1] = bbox.map((v) => Math.max(0, Math.round(v)));
    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 0 || h <= 0) return null;
    let blob: Blob | null = null;
    if (usarOffscreen && typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(fuente, x0, y0, w, h, 0, 0, w, h);
      blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: calidad });
    } else if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(fuente, x0, y0, w, h, 0, 0, w, h);
      blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', calidad));
    } else {
      return null; // sin DOM ni OffscreenCanvas (Node puro): inyectar cropper propio
    }
    if (!blob) return null;
    return bytesABase64(new Uint8Array(await blob.arrayBuffer()));
  } catch {
    return null;
  }
}

/** Camino worker: OffscreenCanvas (Chrome/Firefox modernos). */
export async function recortarConOffscreen(
  fuente: CanvasImageSource,
  bbox: BBox,
  calidad = 0.85,
): Promise<string | null> {
  return recortar(fuente, bbox, calidad, true);
}

/** Camino main thread: canvas 2d + toBlob. */
export async function recortarConCanvas(
  fuente: CanvasImageSource,
  bbox: BBox,
  calidad = 0.85,
): Promise<string | null> {
  return recortar(fuente, bbox, calidad, false);
}

/**
 * Rellena recorte.jpegB64 de todas las regiones de la página usando la fuente.
 * Devuelve el número de recortes que no pudo obtener (para avisar en UI).
 */
export async function recortarTodos(
  fuente: CanvasImageSource,
  regiones: RegionLayout[],
  calidad = 0.85,
): Promise<number> {
  let faltantes = 0;
  for (const r of regiones) {
    for (const rec of r.recortes ?? []) {
      const b64 = await recortar(fuente, rec.bbox, calidad, true);
      if (b64) rec.jpegB64 = b64;
      else faltantes++;
    }
  }
  return faltantes;
}
