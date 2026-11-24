/**
 * Señal de LECTURA — VERSIÓN UNIVERSAL de Tamiz (Bloque 2.4).
 * Port de la API de upstream dominio/senal-lectura.ts (norm byte-fiel,
 * niveles FUERTE/MEDIA/DEBIL, piso/techo) con las ANCLAS ELECTORALES
 * SUSTITUIDAS por anclas GENÉRICAS de documento (recibo, factura,
 * certificado, formulario…): la señal de lectura es agnóstica al tipo.
 * Sin valores del documento en las regex (mismo espíritu del instrumento).
 *
 * PURO (sin DOM) — testeable headless con bun. Costo 0 en tiempo de OCR:
 * consume el texto YA leído por el pipeline.
 */

export type NivelLectura = "FUERTE" | "MEDIA" | "DEBIL";

export interface SenalLectura {
  nivel: NivelLectura;
  chars: number;
  anclas: number;
}

/** Piso de lectura FUERTE (§3 upstream): lectura fuerte = documento útil;
 *  banca por encima de ADVERTENCIA (el OCR manda) pero NUNCA al techo poor
 *  ni a los caps posteriores (escudo/recortada/gate). */
export const PISO_LECTURA_FUERTE = 8.5;

/** Techo de lectura DEBIL (§3): casi-nada leído = no merece zona OPTIMA/
 *  ADVERTENCIA alta; RECHAZADA/BAJO honesto. */
export const TECHO_LECTURA_DEBIL = 5.9;

/** 10 regex estructurales GENÉRICAS de documento (universal — sin lógica
 *  electoral; el conteo alimenta el nivel y el probe de orientación). */
export const ANCLAS_LECTURA: [string, RegExp][] = [
  ["cabecera documento", /DOCUMENTO|CERTIFICADO|RECIBO|FACTURA|ACTA|FORMULARIO|CONSTANCIA|TITULO|CERTIFICACI[ÓO]N/i],
  ["fecha", /FECHA|DATE/i],
  ["página/folio", /P[ÁA]GINA|PAG|FOLIO/i],
  ["número suelto", /N[.º°:]+\s*\d|N[ÚU]MERO[::\s.]*\d/i],
  ["total/importe", /TOTAL|IMPORTE|SUBTOTAL|SUMA/i],
  ["firma", /FIRMA|SIGNATURE/i],
  ["identidad/registro", /NIT|RFC|CUIT|DNI|C[ÉE]DULA|PASSPORT|PASAPORTE|REGISTRO/i],
  ["serie/código", /SERIE|C[ÓO]DIGO|CODE/i],
  ["código 1D largo", /\b\d{10,}\b/],
  ["dirección/entidad", /DIRECCI[ÓO]N|ENTIDAD|DEPENDENCIA|OFICINA|SECRETAR[ÍI]A/i],
];

/** Plegado IDÉNTICO al upstream (pitfall §9.10):
 *  upper → NFD sin diacríticos → [^A-Z0-9]+ → " " → trim. */
export function norm(s: string): string {
  return s
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

/** Señal de lectura del documento (§3 del kit, reglas universales):
 *  FUERTE = (folio/página leído Y anclas ≥ 4) o anclas ≥ 6
 *  MEDIA  = anclas ≥ 2 o chars ≥ 150
 *  DEBIL  = resto. */
export function senalDeLectura(
  texto: string,
  parciales?: { folio?: number | null; cabecera?: boolean },
): SenalLectura {
  void parciales;
  const chars = norm(texto).replace(/ /g, "").length;
  const anclas = ANCLAS_LECTURA.filter(([, re]) => re.test(texto)).length;
  const folioLeido = /P[ÁA]GINA[::\s.]*\d+|FOLIO[::\s.]*\d+/i.test(texto);
  const nivel: NivelLectura =
    (folioLeido && anclas >= 4) || anclas >= 6
      ? "FUERTE"
      : anclas >= 2 || chars >= 150
        ? "MEDIA"
        : "DEBIL";
  return { nivel, chars, anclas };
}

/** Lectura perdona el lazo (versión universal): un fiducial faltante cuyo
 *  LADO está demostrado dentro del recorte por el OCR es falso positivo
 *  (margen corto del warp / sombra al filo). Por cada esquina faltante,
 *  evidencia de SU lado: tope (tl/tr) = una ancla de cabecera/código leída
 *  (≥8 dígitos seguidos o cabecera de documento); fondo (bl/br) = la sección
 *  impresa del pie existe (¡faltaSeccionInferior — tinta — NUNCA se perdona!). */
export function lazoPerdonadoPorLectura(
  esquinas: { tl: boolean; tr: boolean; bl: boolean; br: boolean } | null,
  texto: string,
  faltaSeccion: boolean,
): boolean {
  if (!esquinas) return false;
  const faltan = (["tl", "tr", "bl", "br"] as const).filter((k) => !esquinas[k]);
  if (faltan.length === 0) return false;
  const topeDentro = /\b\d{8,}\b/.test(texto) || ANCLAS_LECTURA[0][1].test(texto);
  const pieDentro = !faltaSeccion;
  return faltan.every((k) => (k === "tl" || k === "tr" ? topeDentro : pieDentro));
}
