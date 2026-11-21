// Avisos al operador: motivos canónicos y su copy. Un aviso ES el feedback
// persistente de la UI (no toasts volátiles).

export type MotivoOperador =
  | 'CAMARA_NO_DISPONIBLE'
  | 'PERMISO_DENEGADO'
  | 'SIN_SENAL'
  | 'ANALISIS_INTERRUMPIDO'
  | 'ALMACENAMIENTO_LLENO'
  | 'ARCHIVO_INVALIDO'
  | 'HEIC_NO_SOPORTADO'
  | 'ESCANEO_FALLIDO';

export interface AvisoOperador {
  tipo: 'error' | 'warning' | 'info';
  motivo: MotivoOperador;
  accion: 'reintentar' | 'recargar' | 'entendido' | null;
}

/** Copy por motivo (visible en la píldora del visor). */
export const TEXTO_MOTIVO: Record<MotivoOperador, string> = {
  CAMARA_NO_DISPONIBLE: 'No hay cámara disponible en este dispositivo.',
  PERMISO_DENEGADO: 'Permiso de cámara denegado — habilítalo en el navegador.',
  SIN_SENAL: 'La cámara perdió la señal. Reintenta.',
  ANALISIS_INTERRUMPIDO: 'El análisis fue interrumpido.',
  ALMACENAMIENTO_LLENO: 'El almacenamiento local está lleno.',
  ARCHIVO_INVALIDO: 'El archivo elegido no es una imagen válida.',
  HEIC_NO_SOPORTADO: 'La foto HEIC no se pudo decodificar en este navegador.',
  ESCANEO_FALLIDO: 'El escaneo falló. Repite la captura.',
};
