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
  | 'ESCANEO_FALLIDO'
  | 'MEMORIA_AGOTADA';

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
  MEMORIA_AGOTADA: 'La memoria del motor se agotó. Toca RECARGAR para continuar.',
};

/** A4 (kit e14-remediacion-movil-v1) — ¿el fallo es de memoria del motor OCR
 *  (std::bad_alloc de ONNX Runtime)? Familia medida en el A13: `bad_alloc`,
 *  ERROR_CODE 6, «Can't create a session», RangeError de ArrayBuffer. El
 *  store la usa para reiniciar el runtime real y reintentar UNA vez. */
export function esFalloMemoriaMotor(err: unknown): boolean {
  let nombre = '';
  let mensaje = '';
  if (err instanceof Error) {
    nombre = typeof err.name === 'string' ? err.name : '';
    mensaje = typeof err.message === 'string' ? err.message : '';
  } else {
    try {
      mensaje = String(err);
    } catch {
      /* entrada hostil: clasificador cae a false */
    }
  }
  const todo = `${nombre} ${mensaje}`.toLowerCase();
  return (
    /bad_alloc/.test(todo) ||
    /error_code:?\s*6\b/.test(todo) ||
    /can't create a session|cannot create a session/.test(todo) ||
    /array buffer allocation/.test(todo) ||
    (nombre.toLowerCase() === 'rangeerror' && /allocation|memory|buffer/.test(mensaje.toLowerCase()))
  );
}
