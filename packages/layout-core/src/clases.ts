// Normalización de clases de los detectores PP-DocLayout a las clases
// canónicas del contrato (scanner-core/molde/universal-types ClaseLayout).
//
// REGLA DEL DOSSIER (MODELOS-Y-DATOS §3): usa NOMBRES de clase, jamás índices
// numéricos — los índices cambian entre exportaciones del ONNX. S tiene 23
// clases (agrega table_title/chart_title/header_image/footer_image); plus-L
// 20. Las reglas solo usan la semántica compartida.

import type { ClaseLayout } from './tipos';

/** Clases canónicas compartidas S/plus-L (las que usan las reglas). */
export const CLASES_CANONICAS: readonly ClaseLayout[] = [
  'text',
  'image',
  'table',
  'doc_title',
  'paragraph_title',
  'figure_title',
  'number',
  'header',
  'footer',
  'seal',
  'formula',
] as const;

export function esCanonica(c: string): c is ClaseLayout {
  return (CLASES_CANONICAS as readonly string[]).includes(c);
}

/** Alias crudos observados en exportaciones/GT → clase canónica.
 *  La clave se compara en minúsculas y sin guiones/espacios.
 *  F4 (typecheck Tamiz): el valor puede ser una clase canónica O una cruda
 *  SIN semántica en las reglas (abstract, chart…) que se conserva tal cual —
 *  por eso `ClaseLayout | string` (el evaluador ignora las no canónicas). */
const ALIAS: Record<string, ClaseLayout | string> = {
  text: 'text',
  plain_text: 'text',
  text_block: 'text',
  image: 'image',
  picture: 'image',
  figure: 'image',
  table: 'table',
  table_title: 'table', // S: el título pegado a la tabla sigue siendo zona de tabla
  doc_title: 'doc_title',
  title: 'doc_title',
  sectionheader: 'doc_title',
  paragraph_title: 'paragraph_title',
  subtitle: 'paragraph_title',
  figure_title: 'figure_title',
  number: 'number',
  header: 'header',
  footer: 'footer',
  pagefooter: 'footer',
  pageheader: 'header',
  seal: 'seal',
  stamp: 'seal',
  formula: 'formula',
  // Clases plus-L/S SIN semántica en las reglas: se conservan tal cual
  // (el evaluador las ignora si la regla no las acepta).
  abstract: 'abstract',
  content: 'content',
  reference: 'reference',
  footnote: 'footnote',
  algorithm: 'algorithm',
  chart: 'chart',
  formula_number: 'formula_number',
  aside_text: 'aside_text',
  reference_content: 'reference_content',
  chart_title: 'chart_title',
  header_image: 'header_image',
  footer_image: 'footer_image',
};

/** Normaliza las claves del mapa una sola vez (los alias pueden venir con
 *  guiones bajos, guiones o espacios; la entrada cruda se comprima igual). */
const ALIAS_N: Record<string, ClaseLayout | string> = Object.fromEntries(
  Object.entries(ALIAS).map(([k, v]) => [normalizaClave(k), v]),
);

function normalizaClave(c: string): string {
  return c.toLowerCase().replace(/[\s_-]+/g, '');
}

/** Clase canónica de una clase cruda del modelo/GT. Devuelve la entrada
 *  normalizada; si no hay alias, minúsculas sin separadores (desconocida). */
export function normalizarClase(c: string): string {
  const cruda = String(c ?? '').trim();
  return ALIAS_N[normalizaClave(cruda)] ?? normalizaClave(cruda);
}
