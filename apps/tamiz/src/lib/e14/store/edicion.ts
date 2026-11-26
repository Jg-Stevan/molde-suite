/**
 * §5 (plan cierre 2 agentes, 2026-11-26) — SLICE DE EDICIÓN DEL OPERADOR:
 * verificación y ACTUALIZACIÓN de los datos de un documento capturado.
 *
 * Flujo al corregir un campo desde el panel de verificación (REVISIÓN):
 *  1. Se re-evalúa el documento con los valores corregidos
 *     (`reevaluarResumenConEdiciones` — override de campo con la MISMA
 *     semántica de agregación del motor y las validaciones cruzadas).
 *  2. Se persiste la actualización en IndexedDB (misma acta, valores
 *     nuevos + marca EDITADO — slot «en-revision» de jornada.ts). El hash
 *     de la foto cruda NO cambia; el JSON del acta sí.
 *  3. El veredicto y la fila de HISTORIAL reflejan el nuevo estado — UNA
 *     sola fila (la que archivó/envió el acta), estado EDITADO.
 *  4. REGLA DE ORO (§4): si la corrección completa los datos obligatorios
 *     y el documento queda legible → auto-guardado INMEDIATO (la misma
 *     decisión pura `decidirAutoGuardado` del flujo de captura).
 */
import type { Acta } from '@molde-suite/scanner-core/dominio/types';
import { logger } from '../../logger';
import { leerFlags } from '../flags';
import { decidirAutoGuardado } from '../politica/auto-guardado';
import { reevaluarResumenConEdiciones, campoEditable } from '../molde/edicion';
import { candidatosDeSesion } from '../molde/enrutamiento';
import { guardarActaEnRevision } from '../jornada';
import { registrarEnvio, tituloPaginaActual } from './envio';
import type { E14Get, E14Set } from './tipos';

/** Título de la fila al editar — el mismo del acta (sin re-derivar). */
function tituloDeEdicion(get: E14Get, acta: Acta): string {
  return (
    acta.titulo ||
    acta.evaluacionMolde?.moldeNombre ||
    tituloPaginaActual(get)
  );
}

/**
 * Corrige el valor de un campo capturado. `true` = la edición aplicó
 * (re-evaluación + persistencia + historial + regla de oro). `false` =
 * guard honesto (sin acta, campo inexistente/no editable, molde
 * indisponible — el panel conserva el valor anterior).
 */
export async function editarCampoActa(
  set: E14Set,
  get: E14Get,
  campoId: string,
  valor: string | boolean,
): Promise<boolean> {
  const acta = get().actaActual;
  if (!acta) return false;
  const resumenPrevio = acta.evaluacionMolde ?? null;
  if (!resumenPrevio || !resumenPrevio.campos) return false;
  const fila = resumenPrevio.campos.find((c) => c.id === campoId);
  if (!fila || !campoEditable(fila)) return false;

  // 1) Molde que produjo el resumen (activo o biblioteca por nombre) —
  //    sin la definición no hay patrón/validaciones honestos que re-derivar.
  const candidatos = await candidatosDeSesion();
  const molde = candidatos.find((m) => m.nombre === resumenPrevio.moldeNombre);
  if (!molde) {
    logger.warn('[store] edición sin molde disponible', { molde: resumenPrevio.moldeNombre });
    return false;
  }

  // 2) Re-evaluación con override de campo (misma semántica del motor).
  const valoresEditados: Record<string, string | boolean> = {
    ...(acta.valoresEditados ?? {}),
    [campoId]: valor,
  };
  const re = reevaluarResumenConEdiciones(resumenPrevio, molde, valoresEditados);

  // 3) Acta nueva: mismos ids/fotos/hash — DATOS nuevos + marca EDITADO.
  const veredicto = re.veredicto;
  const actaEditada: Acta = {
    ...acta,
    evaluacionMolde: re.resumen,
    ...(veredicto
      ? { score: veredicto.score, status: veredicto.status, rechazo: veredicto.rechazo }
      : {}),
    valoresEditados,
    corregidoPorOperador: true,
    editadoEn: new Date().toISOString(),
  };

  // 4) Fila de HISTORIAL: UNA sola (la que archivó/envió el acta) —
  //    estado EDITADO con el veredicto nuevo en la nota. Sin fila previa
  //    (captura aún sin archivar) no se crea aquí: la regla de oro de
  //    abajo decide si se guarda (registrarEnvio estampa SU fila).
  const filaId = acta.historialFilaId;
  let historial = get().historial;
  if (filaId) {
    historial = historial.map((h) =>
      h.id === filaId
        ? {
            ...h,
            estado: 'EDITADO',
            nota: `DATOS CORREGIDOS · VEREDICTO ${actaEditada.status}${
              re.resumen.obligatoriosFaltantes.length > 0
                ? ` · FALTA ${re.resumen.obligatoriosFaltantes.join(' / ')}`
                : ''
            }`,
          }
        : h,
    );
  }

  set({
    actaActual: actaEditada,
    historial,
    // El libro de PDF lleva el estado por entrada — se alinea con la fila.
    pdfLibro: filaId
      ? get().pdfLibro.map((p) => (p.id === filaId ? { ...p, estado: 'EDITADO' } : p))
      : get().pdfLibro,
  });

  // 5) Persistencia IndexedDB (§5 — misma acta, valores nuevos + EDITADO).
  await guardarActaEnRevision(actaEditada);

  // 6) REGLA DE ORO §4 — la corrección pudo COMPLETAR los obligatorios:
  //    documento legible → SE GUARDA SOLO inmediatamente (registrarEnvio
  //    estampa su fila y la marca EDITADO — corregidoPorOperador ya está).
  const decision = decidirAutoGuardado(actaEditada, leerFlags().autoGuardado);
  if (decision.autoEnviar && actaEditada.status !== 'ENVIADA') {
    try {
      const { hora } = await registrarEnvio(set, get, tituloDeEdicion(get, actaEditada));
      const actual = get().actaActual;
      const nuevaFilaId = actual?.historialFilaId;
      set({
        actaActual: actual ? { ...actual, status: 'ENVIADA', enviadoAutomaticamente: hora } : actual,
        // La fila del auto-guardado también refleja la edición (una sola).
        historial: nuevaFilaId
          ? get().historial.map((h) =>
              h.id === nuevaFilaId
                ? { ...h, estado: 'EDITADO', nota: `DATOS CORREGIDOS · AUTO-GUARDADO ${hora}` }
                : h,
            )
          : get().historial,
      });
      logger.info('[store] edición completó obligatorios — auto-guardado inmediato', {
        campo: campoId,
        status: get().actaActual?.status,
      });
    } catch (e) {
      logger.warn('[store] auto-guardado tras edición falló', { mensaje: (e as Error).message });
    }
  }

  logger.info('[store] campo corregido por el operador', {
    campo: campoId,
    status: get().actaActual?.status,
    obligatoriosCompletos: re.obligatoriosCompletos,
  });
  return true;
}
