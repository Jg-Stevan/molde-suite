// Perfil del sensor de la cámara: resolución nativa del track + tope seguro
// de lado largo por gama del dispositivo (las fotos full-res se limitan antes
// de entrar al pipeline).

import { topeLadoLargoPx } from '../adaptacion/plan';
import {
  PROCESSED_MAX_LONG_SIDE,
  jpegDimensionsFromBlob,
} from '@molde-suite/scanner-core/core/image-processor';

export interface SensorProfile {
  ancho: number;
  alto: number;
  /** Tope de lado largo aceptado por el pipeline (px). */
  topeLadoLargo: number;
  /** Alias del contrato upstream (useDestello/loop: safeCapPx). */
  safeCapPx: number;
  label: string;
}

/** Tope técnico ÚNICO (fix v3 upstream): 4032 px — canvas iOS ~16.7 MP. */
export function getSensorSafeCap(): number {
  return PROCESSED_MAX_LONG_SIDE;
}

/** Margen del tope (KIT captura-fluida-v1): sensores que anuncian el tope
 *  +48 px (Galaxy A56: 4080) no pagan un re-encode por 48 px. */
export const MARGEN_TOPE_PX = 64;

/** ¿El lado mayor cae dentro del tope (margen incluido)? */
export function dentroDelTope(lado: number, capPx: number): boolean {
  return capPx > 0 && lado <= capPx + MARGEN_TOPE_PX;
}

/** Capa 2 del F-SENSOR-PROFILER: si el blob excede el tope, recorta (decode
 *  fuera de la ruta normal vía dims del contenedor — sin decode si cabe). */
export async function clampBlobToSafeCap(blob: Blob, capPx: number): Promise<Blob> {
  if (!capPx || capPx <= 0) return blob;
  const dims = await jpegDimensionsFromBlob(blob);
  if (dims && dentroDelTope(Math.max(dims.w, dims.h), capPx)) return blob;
  try {
    const bitmap = await createImageBitmap(blob);
    try {
      const long = Math.max(bitmap.width, bitmap.height);
      if (dentroDelTope(long, capPx)) return blob;
      const scale = capPx / long;
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return blob;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, w, h);
      const out = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92),
      );
      if (!out || out.size === 0) return blob;
      return out;
    } finally {
      bitmap.close?.();
    }
  } catch {
    return blob; // HEIC/PNG ilegible o fallo: blob intacto (el pipeline decide)
  }
}

/** Perfila el track ACTIVO de la cámara (null sin pista de video). */
export function profileActiveSensor(stream: MediaStream | null): SensorProfile | null {
  const pista = stream?.getVideoTracks()[0];
  if (!pista) return null;
  const cfg = pista.getSettings();
  const ancho = cfg.width ?? 1280;
  const alto = cfg.height ?? 720;
  return {
    ancho,
    alto,
    topeLadoLargo: topeLadoLargoPx(),
    safeCapPx: topeLadoLargoPx(),
    label: pista.label || `${ancho}x${alto}`,
  };
}

/** Verifica/limita un archivo contra el tope del perfil (dimensiones). */
export function archivoDentroDeTope(archivo: File, perfil: SensorProfile | null): { ok: boolean; razon?: string } {
  if (!perfil) return { ok: true };
  // Límite aproximado por bytes: un JPEG del tope rara vez supera 8 MB.
  const topeBytesAprox = 8 * 1024 * 1024;
  if (archivo.size > topeBytesAprox) {
    return { ok: false, razon: 'La foto excede el tamaño esperado del sensor' };
  }
  return { ok: true };
}
