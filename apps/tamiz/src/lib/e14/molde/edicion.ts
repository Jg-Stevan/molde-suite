// §5 (plan cierre 2 agentes, 2026-11-26) — RE-EVALUACIÓN con valores
// corregidos por el operador (VERIFICACIÓN Y ACTUALIZACIÓN DE DATOS).
//
// El plan pide: «Se re-evalúa el documento con los valores corregidos
// (evaluarDocumentoUniversal con override de campo)». El motor universal
// lee la foto con OCR — re-correlo completo produciría LA MISMA lectura
// (la foto no cambió) y pagaría un OCR entero por nada. El override tiene
// sentido POST-lectura: la palabra del operador SUSTITUYE a la del OCR y
// el estado/veredicto SE RE-DERIVA con la MISMA semántica de agregación
// del motor (score = ok/total, obligatoriosFaltantes por etiqueta,
// requiereRevision global). Este módulo implementa esa re-derivación de
// forma PURA sobre el resumen existente:
//  · valor → patrón del molde (anclado, como el motor G-8) → ok / requiere_revision
//  · vacío → no_encontrado (obligatorio vacío = documento incompleto)
//  · checkbox/presencia → booleano del operador → ok / no_encontrado
//  · conf = 1 (entrada del operador: confianza plena declarada, honesta —
//    es lo que el operador afirma, no lo que el OCR midió)
//  · banderas += 'valor_editado_operador' (trazabilidad — jamás se oculta)
//  · validaciones cruzadas (igualdad/rango): se re-evalúan con el MISMO
//    `evaluarValidaciones` del motor (exportado) — una corrección puede
//    REPARAR o ROMPER una validación aritmética y el veredicto honesto
//    debe reflejarlo (democión `validacion_fallida` intacta).
//
// Conexión con la REGLA DE ORO (§4): si la corrección completa los datos
// obligatorios y el documento queda legible → auto-guardado INMEDIATO
// (lo decide el store con decidirAutoGuardado sobre el resumen nuevo).
//
// Contrato aditivo: Acta += valoresEditados / corregidoPorOperador /
// editadoEn (scanner-core/dominio/types.ts); el hash de la foto cruda NO
// cambia; el JSON del acta sí.

import { evaluarValidaciones } from '@molde-suite/scanner-core/molde/universal-engine';
import type {
  MoldeUniversal,
  CampoUniversal,
  ResultadoCampoUniversal,
  ResultadoValidacion,
} from '@molde-suite/scanner-core/molde/universal-types';
import type {
  ResumenMoldeActa,
  ResumenMoldeCampo,
} from '@molde-suite/scanner-core/dominio/types';
import type { VeredictoMolde } from './enrutamiento';
import { veredictoDeResumen } from './enrutamiento';

/** Banda de trazabilidad de toda edición del operador. */
export const BANDERA_EDICION = 'valor_editado_operador';

/** Tipos de campo que el operador puede CORREGIR desde el panel.
 *  firma/huella/manuscrito NO son editables: su evidencia es la tinta
 *  medida (semáforo de tinta v1.5.1), no un texto que se teclee. */
export function campoEditable(c: ResumenMoldeCampo): boolean {
  return c.tipo === 'texto' || c.tipo === 'checkbox';
}

/** ¿El texto cumple el patrón del molde? MISMA semántica del motor (G-8):
 *  patrón ANCLADO — se envuelve con ^(?:...)$ si no trae anclajes propios. */
function patronCumple(valor: string, campo?: CampoUniversal): boolean {
  const patron = campo?.patron;
  if (!patron) return true; // sin patrón declarado → no hay condición
  const anclado = /[\^$]/.test(patron) ? patron : `^(?:${patron})$`;
  try {
    return new RegExp(anclado).test(valor);
  } catch {
    return false; // patrón inválido del molde → no se inventa un ok
  }
}

/** Adapta una fila del resumen al ResultadoCampoUniversal que consume el
 *  motor para sus validaciones (la fila del resumen es un subconjunto
 *  aditivo — misma información relevante: id/estado/valor/etiqueta/tipo). */
function filaAResultado(f: ResumenMoldeCampo): ResultadoCampoUniversal {
  return {
    id: f.id,
    etiqueta: f.etiqueta,
    tipo: f.tipo,
    pagina: f.pagina ?? 1,
    estado: f.estado,
    valor: f.valor,
    conf: f.conf,
    rect: f.rect ?? null,
    ancla_rect: f.ancla_rect ?? null,
    fuente: f.fuente ?? null,
    banderas: f.banderas ?? [],
  };
}

function validacionesDe(molde: MoldeUniversal, filas: ResumenMoldeCampo[]): ResultadoValidacion[] {
  try {
    const porId = new Map(filas.map((f) => [f.id, filaAResultado(f)]));
    return evaluarValidaciones(molde, porId);
  } catch {
    return []; // la re-validación es aditiva: su fallo no rompe la edición
  }
}

export interface ResultadoReevaluacion {
  /** Resumen re-derivado (mismo moldeNombre, campos con overrides aplicados). */
  resumen: ResumenMoldeActa;
  /** Veredicto nuevo del acta (SOLO si el resumen era el veredicto — enrutado). */
  veredicto: VeredictoMolde | null;
  /** Todos los obligatorios presentes/válidos tras la edición (§4). */
  obligatoriosCompletos: boolean;
}

/**
 * Re-deriva el resumen del acta aplicando los valores corregidos
 * (`valoresEditados: campoId → valor nuevo`). Devuelve null cuando no hay
 * resumen previo o el molde no está disponible (no se puede re-derivar un
 * estado honesto sin la definición — el llamador conserva el acta intacta).
 */
export function reevaluarResumenConEdiciones(
  resumenPrevio: ResumenMoldeActa,
  molde: MoldeUniversal,
  valoresEditados: Record<string, string | boolean>,
): ResultadoReevaluacion {
  const defPorId = new Map(molde.campos.map((c) => [c.id, c]));

  const campos: ResumenMoldeCampo[] = (resumenPrevio.campos ?? []).map((fila) => {
    if (!(fila.id in valoresEditados)) {
      // COPIA (no referencia): el bucle de validaciones de abajo demueve
      // estados/banderas — mutar la fila del resumen PREVIO corrompería el
      // acta original y las copias del historial/libro (fuga de estado).
      return { ...fila };
    }
    const def = defPorId.get(fila.id);
    const nuevo = valoresEditados[fila.id];
    // Manuscritos: NO editables (su evidencia es tinta medida). Se devuelve
    // la fila intacta — la UI no ofrece el lápiz, esto es la segunda guarda.
    if (!campoEditable(fila)) return fila;
    let estado: ResumenMoldeCampo['estado'];
    let valor: string | boolean | null;
    if (fila.tipo === 'texto') {
      const texto = typeof nuevo === 'string' ? nuevo.trim() : '';
      valor = texto;
      if (!texto) {
        estado = 'no_encontrado'; // obligatorio vacío — documento incompleto
      } else if (!patronCumple(texto, def)) {
        estado = 'requiere_revision'; // el operador lo tecleó pero no cumple el formato
      } else {
        estado = 'ok';
      }
    } else {
      // checkbox/presencia: el booleano del operador manda.
      valor = nuevo === true || nuevo === 'true';
      estado = valor ? 'ok' : 'no_encontrado';
    }
    const banderas = (fila.banderas ?? []).filter(
      (b) =>
        b !== 'validacion_fallida' &&
        b !== 'validacion_no_evaluable' &&
        b !== 'relacion_ambigua',
    );
    banderas.push(BANDERA_EDICION);
    return {
      ...fila,
      valor,
      estado,
      conf: 1, // entrada del operador — confianza plena declarada
      banderas,
    };
  });

  // Validaciones cruzadas re-evaluadas con los valores nuevos (MISMA regla
  // que la corrida original — exportada por el motor).
  const validaciones = validacionesDe(molde, campos);
  const porIdFila = new Map(campos.map((f) => [f.id, f]));
  for (const v of validaciones) {
    if (v.ok === true) continue;
    for (const id of v.campos) {
      const fila = porIdFila.get(id);
      if (!fila) continue;
      const limpias = (fila.banderas ?? []).filter(
        (b) => b !== 'validacion_fallida' && b !== 'validacion_no_evaluable',
      );
      if (v.ok === false) {
        limpias.push('validacion_fallida');
        // Defensa principal del motor: un cierre que NO cuadra jamás queda
        // 'ok' (las "2"≠17 de la auditoría mueren aquí — mismo criterio).
        if (fila.estado === 'ok') fila.estado = 'requiere_revision';
      } else {
        limpias.push('validacion_no_evaluable');
      }
      fila.banderas = limpias;
    }
  }

  // Re-agregación con la MISMA semántica del motor (G-2/G-13).
  const okCount = campos.filter((c) => c.estado === 'ok').length;
  const total = campos.length;
  const score = total > 0 ? Math.round((okCount / total) * 1000) / 10 : 0;
  const obligatoriosFaltantes = campos
    .filter((c) => c.obligatorio && c.estado !== 'ok')
    .map((c) => c.etiqueta);
  const requiereRevision =
    obligatoriosFaltantes.length > 0 ||
    validaciones.some((v) => v.ok !== true) ||
    campos.some((c) => c.estado === 'requiere_revision');

  const resumen: ResumenMoldeActa = {
    ...resumenPrevio,
    total,
    ok: okCount,
    score,
    requiereRevision,
    obligatoriosFaltantes,
    campos,
  };

  return {
    resumen,
    // El veredicto nuevo SOLO aplica cuando el resumen era el veredicto del
    // acta (enrutado): en evaluación ADITIVA el gate electoral manda y la
    // fila editada se refleja sin tocar score/estado.
    veredicto: resumenPrevio.enrutado ? veredictoDeResumen(resumen) : null,
    obligatoriosCompletos: obligatoriosFaltantes.length === 0,
  };
}
