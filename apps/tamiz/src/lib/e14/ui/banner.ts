// AUTO (2026-11-27) — textos de la tarjeta de REVISIÓN. Módulo PURO: tipos del
// dominio y strings, cero `window`, cero React. Así se prueba sin DOM y el
// banner deja de ser una cadena pegada dentro del componente.
//
// Regla que fija estos textos: la IDENTIFICACIÓN (¿qué documento es?) y el
// VEREDICTO (¿se acepta?) son cosas distintas. El banner nombra el documento
// que la biblioteca reconoció; si la clasificación electoral sí trae datos,
// esos datos (el puesto) son más útiles y mandan — es el fix del mantenedor de
// 14-oct. Y si no hay nada, lo dice: NUNCA imprime el título electoral con
// huecos («— · DOC — — DOC»), que es lo que el dueño vio en el campo.

import type { Acta, ResumenMoldeActa } from '@molde-suite/scanner-core/dominio/types';
import type { ClasificacionE14 } from '@molde-suite/scanner-core/dominio/clasificador';
import { clasificarDesenlace, etiquetasInseguras } from '../molde/desenlaces';

export const DOCUMENTO_NO_IDENTIFICADO = 'DOCUMENTO NO IDENTIFICADO';

/**
 * ¿La clasificación electoral trae algo REAL? `pipeline` inyecta una
 * clasificación `SUGERIDA` aunque el OCR no lea cabecera — con ella por
 * `tituloYUbicacionDe` el título sale «— · DOC — — DOC» (puesto, mesa y tipo
 * son huecos). Este predicado exige al menos un componente con valor.
 */
export function estaClasificado(c?: ClasificacionE14 | null): boolean {
  if (!c) return false;
  return (
    c.tipo != null ||
    c.mesa != null ||
    c.pagina != null ||
    (c.puesto?.nombre != null && c.puesto.nombre !== '' && c.puesto.nombre !== '—')
  );
}

/** ¿La biblioteca identificó el documento por sus anclas? AUTO usa
 *  `identificado`; se acepta `enrutado` como sinónimo histórico (toda acta
 *  enrutada está identificada). */
export function estaIdentificado(ev?: ResumenMoldeActa | null): boolean {
  return Boolean(ev && (ev.identificado || ev.enrutado));
}

/**
 * ¿Mandan las FILAS DEL MOLDE en la VERIFICACIÓN DOCUMENTAL? La identificación
 * manda sobre el checklist electoral hardcodeado — SALVO cuando el gate
 * electoral ya tiene una clasificación real: un acta E-14 reconocida conserva
 * su check list curado (el mismo criterio con el que `debeEnrutar` le cede el
 * veredicto al gate).
 */
export function mandaElMolde(acta: Acta): boolean {
  return estaIdentificado(acta.evaluacionMolde) && !estaClasificado(acta.clasificacion);
}

/** Etiquetas de los obligatorios cuya AUSENCIA quedó comprobada (el resumen
 *  trae ids o etiquetas; las legibles van en las filas). `tope` para no
 *  reventar una línea de 412 px. Sin filas → faltantes declarados por el
 *  motor (comportamiento histórico). */
export function faltantesDelMolde(ev: ResumenMoldeActa | null | undefined, tope = 3): string[] {
  if (!ev) return [];
  const desenlace = clasificarDesenlace(ev);
  if (desenlace) {
    return [...new Set(desenlace.ausentes.map((c) => c.etiqueta))].slice(0, tope);
  }
  const ids = new Set(ev.obligatoriosFaltantes);
  const etiquetas = (ev.campos ?? [])
    .filter((c) => ids.has(c.id) || ids.has(c.etiqueta))
    .map((c) => c.etiqueta);
  const unicas = [...new Set(etiquetas.length > 0 ? etiquetas : ev.obligatoriosFaltantes)];
  return unicas.slice(0, tope);
}

/** Título de la tarjeta: puesto electoral real → documento identificado por la
 *  biblioteca → estado honesto. No hay cuarto caso. */
export function textoDelBanner(acta: Acta): string {
  if (estaClasificado(acta.clasificacion)) return acta.titulo;
  const ev = acta.evaluacionMolde;
  if (estaIdentificado(ev) && ev!.moldeNombre) return ev!.moldeNombre;
  return DOCUMENTO_NO_IDENTIFICADO;
}

/** Título del bloque ámbar de REVISIÓN: tres estados y uno solo verdadero.
 *  Un obligatorio SIN LECTURA SEGURA no se anuncia como «datos incompletos»:
 *  no se puede afirmar que falte lo que no se localizó (plan §5). */
export function tituloDelAviso(acta: Acta): string {
  if (mandaElMolde(acta)) {
    return acta.status === 'EN_REVISION_HUMANA' ? 'NO SE PUDO VERIFICAR' : 'DATOS INCOMPLETOS';
  }
  if (estaClasificado(acta.clasificacion)) return 'REVISIÓN HUMANA';
  return DOCUMENTO_NO_IDENTIFICADO;
}

/** Línea secundaria del bloque de aviso. `null` = no hay nada que decir. Sin
 *  contadores de intentos: repetir la foto no cambia una biblioteca que no
 *  tiene plantilla para este papel. */
export function notaDelBanner(acta: Acta): string | null {
  const ev = acta.evaluacionMolde;
  if (mandaElMolde(acta)) {
    const desenlace = clasificarDesenlace(ev);
    if (acta.status === 'EN_REVISION_HUMANA') {
      const nombres = desenlace ? etiquetasInseguras(desenlace).map((n) => n.toUpperCase()) : [];
      return nombres.length > 0
        ? `SIN LECTURA O UBICACIÓN SEGURA · ${nombres.join(' · ')}`
        : 'La captura no resolvió todos los obligatorios · revisa el check list';
    }
    if (desenlace && desenlace.regla.length > 0) {
      const nombres = [...new Set(desenlace.regla)].slice(0, 3).map((n) => n.toUpperCase());
      return `REGLA DEL MOLDE INCUMPLIDA · ${nombres.join(' · ')}`;
    }
    const faltan = desenlace ? desenlace.ausentes.length : ev!.obligatoriosFaltantes.length;
    if (faltan === 0) {
      return ev!.requiereRevision
        ? 'Datos completos · revisa las lecturas marcadas en el check list'
        : null;
    }
    const totalObligatorios = (ev!.campos ?? []).filter((c) => c.obligatorio).length;
    const nombres = faltantesDelMolde(ev).join(' · ');
    return `FALTAN ${faltan}${totalObligatorios ? ` DE ${totalObligatorios}` : ''} DATOS OBLIGATORIOS${nombres ? ` · ${nombres.toUpperCase()}` : ''}`;
  }
  if (estaClasificado(acta.clasificacion)) {
    return 'El gate electoral no quedó satisfecho con esta captura.';
  }
  return 'Ninguna plantilla de la biblioteca coincide con esta foto.';
}
