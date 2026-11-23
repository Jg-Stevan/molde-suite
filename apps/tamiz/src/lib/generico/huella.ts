// Huella de plantilla (Fase 6 «cartero en cascada», paso 2 — frases clave):
// cada molde universal declara ANCLAS con texto literal en su página 1; esas
// frases son su huella. Funciones PURAS (sin OCR ni DOM) para que sean
// testeables y reutilizables por el reconocimiento y por la verificación
// por página.

import type { MoldeUniversal } from '@jg-stevan/scanner-core/molde/universal-types';

/** Normaliza texto para comparación: MAYÚSCULAS, sin acentos, 1 espacio. */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9Ñ]+/g, ' ')
    .trim();
}

/**
 * Frases clave del molde. Con `soloEncabezado` filtra a las anclas de la
 * FRANJA SUPERIOR de la página 1 (rect.y ≤ 0.24) — las únicas que la banda
 * OCR del reconocimiento puede leer. Si el molde no tiene anclas arriba,
 * usa sus 3 primeras frases para no quedarse sin huella.
 */
export function frasesDeHuella(molde: MoldeUniversal, soloEncabezado = false): string[] {
  const anclas = molde.campos.filter(
    (c) => c.pagina === 1 && typeof c.ancla?.texto === 'string',
  );
  const enZona = soloEncabezado
    ? anclas.filter((c) => (c.ancla?.rect?.y ?? 1) <= 0.24)
    : anclas;
  const elegidas = enZona.length > 0 ? enZona : soloEncabezado ? anclas.slice(0, 3) : anclas;
  const frases = new Set<string>();
  for (const campo of elegidas) {
    const normalizada = normalizarTexto(campo.ancla!.texto);
    if (normalizada.length >= 4) frases.add(normalizada);
  }
  // Respaldo: si el molde no declara anclas en página 1, usa su nombre.
  if (frases.size === 0 && !soloEncabezado) {
    const nombre = normalizarTexto(molde.nombre);
    if (nombre.length >= 4) frases.add(nombre);
  }
  return [...frases];
}

/**
 * Coincidencia de UNA frase contra el texto OCR normalizado del encabezado:
 * la frase puede aparecer completa, o cumplir ≥ 80% de sus tokens (el OCR
 * fusiona/divide palabras — ver lección 2026-11-21-frankfurt-colision-anclas).
 */
function fraseCoincide(frase: string, textoNormalizado: string, tokensTexto: Set<string>): boolean {
  if (textoNormalizado.includes(frase)) return true;
  const tokens = frase.split(' ').filter((t) => t.length >= 2);
  if (tokens.length === 0) return false;
  const presentes = tokens.filter((t) => tokensTexto.has(t)).length;
  return presentes / tokens.length >= 0.8;
}

export interface CoincidenciaMolde {
  nombre: string;
  /** Ratio 0..1 de frases de la huella encontradas en el encabezado. */
  score: number;
  /** Frases de la huella que SÍ aparecieron (para UI honesta). */
  coincidencias: string[];
}

/**
 * Puntúa UN molde contra el texto OCR del encabezado (ya normalizado).
 * Frases más largas pesan lo mismo que cortas: el ratio simple es suficiente
 * porque las anclas son literales largos y distintivos (verificado en el
 * catálogo: «RECIBO DE PAGO», «CUADRO DE RESULTADOS…»).
 */
export function puntuarMolde(
  molde: MoldeUniversal,
  textoNormalizado: string,
): CoincidenciaMolde {
  const tokensTexto = new Set(textoNormalizado.split(' ').filter(Boolean));
  // Solo frases del encabezado: es lo único que lee la banda OCR (el resto
  // de anclas está fuera de la franja y las contaría como no encontradas).
  const frases = frasesDeHuella(molde, true);
  const coincidencias: string[] = [];
  for (const frase of frases) {
    if (fraseCoincide(frase, textoNormalizado, tokensTexto)) {
      coincidencias.push(frase);
    }
  }
  const score = frases.length > 0 ? coincidencias.length / frases.length : 0;
  return { nombre: molde.nombre, score, coincidencias };
}
