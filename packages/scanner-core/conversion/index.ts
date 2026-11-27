/**
 * API pública del módulo de conversión datalab-like.
 * En el repo Tamiz esto vive en packages/scanner-core/conversion/.
 */

export * from './types';
export {
  convertirAChandra,
  convertirTodo,
  pareceChandraPropio,
  MAPEO_CLASES,
} from './serializar';
export { exportarMarkdown } from './md';
export { exportarHtml } from './exportHtml';
export { armarTabla, htmlDeEstructura } from './tablas';
export {
  ordenarRegiones,
  esFooter,
  esHeader,
  CLASES_HEADER,
  CLASES_FOOTER,
} from './lectura';
export {
  recortarConOffscreen,
  recortarConCanvas,
  recortarTodos,
  bitmapDesdeBytes,
} from './recortes';
export {
  md5Hex,
  nombreArchivoImagen,
  bytesABase64,
  base64ABytes,
} from './md5';
export { escapar, htmlTexto, htmlSeccion, htmlFirmaInline, htmlPicture } from './html';
