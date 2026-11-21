// Perfil del sensor de la cámara: resolución nativa del track + tope seguro
// de lado largo por gama del dispositivo (las fotos full-res se limitan antes
// de entrar al pipeline).

import { topeLadoLargoPx } from '../adaptacion/plan';

export interface SensorProfile {
  ancho: number;
  alto: number;
  /** Tope de lado largo aceptado por el pipeline (px). */
  topeLadoLargo: number;
  label: string;
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
