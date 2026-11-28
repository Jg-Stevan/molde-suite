// Índice del store e14 (zustand): compone los slices navegación + envío +
// captura/análisis/edición y expone useE14Store + tipos.

import { create } from 'zustand';
import type { PaginaObjetivo } from '@molde-suite/scanner-core/dominio/bridge';
import type { Acta, ProgresoAnalisis } from '@molde-suite/scanner-core/dominio/types';
import type { PageFilter, Quad } from '@molde-suite/scanner-core/core/types';
import type { ClasificacionE14 } from '@molde-suite/scanner-core/dominio/clasificador';
import { getBridge } from '../get-bridge';
import { rotarDataUrl90 } from '@molde-suite/scanner-core/core/canvas-imagen';
import { IMAGENES_SIMULADAS, type ImagenSimuladaId } from '../simulacion-imagenes';
import { TEXTO_MOTIVO, esFalloMemoriaMotor, type AvisoOperador, type MotivoOperador } from '../errores';
import { logger } from '../../logger';
import { crearNavegacion } from './navegacion';
import { archivarCaptura, crearEnvio, registrarEnvio, tituloPaginaActual } from './envio';
import { refrescarMesasDeArchivo } from './guion';
import { moldeActivo, paginasEsperadas } from '../molde/registry';
import { veredictoDeResumen } from '../molde/enrutamiento';
import type { ResumenMoldeActa } from '@molde-suite/scanner-core/dominio/types';
import type { DocumentoEnCurso } from './tipos';
import {
  cargarJornada,
  enFalloEscrituraJornada,
  guardarActaEnRevision,
  guardarJornada,
  TOPE_HISTORIAL,
} from '../jornada';
import { ErrorRescateHeic } from '@molde-suite/scanner-core/core/image-processor';
import { reiniciarMotorOcrSiInactivo } from '@molde-suite/scanner-core/ocr/rapidocr';
import { reiniciarWorkerTesseractSiInactivo } from '../bridge/ocr-worker';
import { leerFlags } from '../flags';
import { decidirAutoGuardado, procedeArchivadoAutomatico } from '../politica/auto-guardado';
import { editarCampoActa } from './edicion';
import type { E14Get, E14Store, Vista } from './tipos';

export type { Vista, ActaArchivada, PuestoActual, HuecoArchivado, E14Store } from './tipos';

// ---------------------------------------------------------------------------
// Slice de CAPTURA + ANÁLISIS + EDICIÓN (la parte que faltaba del store).
// ---------------------------------------------------------------------------

/** Guard anti doble-rotación (espejo del rotandoFotoEnVuelo del upstream
 *  store/edicion.ts:24 — la rotación rápida es async y un doble tap
 *  giraría 180°). */
let rotandoFotoEnVuelo = false;

/** Título humano del registro de archivo/envío. El `titulo` del acta solo es
 *  FIABLE cuando hay clasificación electoral AUTO (puesto/mesa reales); sin
 *  ella el clasificador deja «— · DOC — —» con huecos y el nombre del MOLDE
 *  enrutado identifica el documento (medido 2026-11-26 en el A56). */
function tituloDeArchivo(get: E14Get, respaldo?: string | null): string {
  const acta = get().actaActual;
  const tituloElectoral =
    acta?.clasificacion?.nivel === 'AUTO' && acta.titulo ? acta.titulo : '';
  return (
    tituloElectoral ||
    acta?.evaluacionMolde?.moldeNombre ||
    respaldo ||
    moldeActivo()?.nombre ||
    tituloPaginaActual(get)
  );
}

/** F4 — reciclado best-effort de workers OCR tras el veredicto. Libera
 *  memoria nativa WASM; jamás bloquea la UI ni lanza. Kill-switch:
 *  ocrReciclarPostEscaneo=false ⇒ no-op (comportamiento histórico). */
function reciclarWorkersPostEscaneo(): void {
  if (!leerFlags().ocrReciclarPostEscaneo) return;
  void reiniciarMotorOcrSiInactivo().catch(() => {});
  void reiniciarWorkerTesseractSiInactivo().catch(() => {});
}

function crearCaptura(
  set: (partial: Partial<E14Store> | ((s: E14Store) => Partial<E14Store>)) => void,
  get: () => E14Store,
): Pick<
  E14Store,
  | 'actaActual'
  | 'paginaObjetivo'
  | 'fuente'
  | 'archivoPendiente'
  | 'importPendiente'
  | 'framePendiente'
  | 'progresoAnalisis'
  | 'analisisResuelto'
  | 'analisisEnVuelo'
  | 'recortando'
  | 'errorRecorte'
  | 'revelando'
  | 'rechazosConsecutivos'
  | 'documentoEnCurso'
  | 'siguientePagina'
  | 'cancelarDocumento'
  | 'modoSimulacion'
  | 'simCompleta'
  | 'simUltima'
  | 'avisoVisor'
  | 'autoCapturaDesarmada'
  | 'setFuente'
  | 'setArchivoPendiente'
  | 'setImportPendiente'
  | 'setFramePendiente'
  | 'dispararEscaneo'
  | 'destellar'
  | 'simularImagen'
  | 'alternarModoSimulacion'
  | 'avanzarSimulacion'
  | 'analisisCompletado'
  | 'rescatarActaPostTimeout'
  | 'repetirFoto'
  | 'aplicarRecorte'
  | 'cambiarFiltro'
  | 'reconocerTextoActa'
  | 'rotarFoto'
  | 'mejorarFotoActa'
  | 'mostrarAvisoVisor'
  | 'descartarAvisoVisor'
  | 'setAutoCapturaDesarmada'
  | 'editarCampoActa'
  | 'cancelarAnalisis'
  | 'interrumpirAnalisis'
> {
  return {
    actaActual: null,
    paginaObjetivo: null,
    fuente: 'CAMARA',
    archivoPendiente: null,
    importPendiente: false,
    framePendiente: null,
    progresoAnalisis: null,
    analisisResuelto: false,
    analisisEnVuelo: false,
    recortando: false,
    errorRecorte: null,
    revelando: false,
    rechazosConsecutivos: 0,
    documentoEnCurso: null,
    modoSimulacion: false,
    simCompleta: false,
    simUltima: null,
    avisoVisor: null,
    autoCapturaDesarmada: false,

    setFuente: (fuente) => set({ fuente }),
    setArchivoPendiente: (archivo) => set({ archivoPendiente: archivo }),
    setImportPendiente: (v) => set({ importPendiente: v }),
    setFramePendiente: (frame) => set({ framePendiente: frame }),

    destellar: () => set((s) => ({ destelloKey: s.destelloKey + 1 })),

    dispararEscaneo: async (intentoArg, sim) => {
      const estado = get();
      if (estado.analisisEnVuelo) return;
      const archivo = estado.archivoPendiente;
      const frame = estado.framePendiente ?? undefined;
      const fuente = sim ? 'SIMULACION' : estado.fuente;
      if (fuente !== 'CAMARA' && !archivo && fuente === 'ARCHIVO') {
        estado.mostrarAvisoVisor({ tipo: 'error', motivo: 'ARCHIVO_INVALIDO', accion: 'reintentar' });
        return;
      }
      set({
        vista: 'analizando',
        vistaPrevia: 'escanear',
        progresoAnalisis: { etapa: 'DETECTANDO', progreso: 0 },
        analisisResuelto: false,
        analisisEnVuelo: true,
        avisoVisor: null,
      });
      const bridge = getBridge();
      const opciones: Parameters<typeof bridge.escanearActa>[0] = {
        archivo: archivo ?? undefined,
        fuente,
        frameActual: frame,
        intento: intentoArg ?? 1,
        maxIntentos: 3,
        objetivo: get().paginaObjetivo,
        imagenSimulada: sim?.imagenSimulada,
        onProgreso: (p: ProgresoAnalisis) => set({ progresoAnalisis: p }),
      };
      try {
        // A4 (remediación móvil): el fallo de sesión del motor OCR (familia
        // bad_alloc de ONNX Runtime) reinicia el runtime REAL y reintenta UNA
        // vez; si vuelve a fallar, el catch externo monta MEMORIA_AGOTADA
        // (nunca una cadena de reintentos condenados).
        const acta = await (async (): Promise<Acta> => {
          try {
            return await bridge.escanearActa(opciones);
          } catch (errPrimero) {
            if (!esFalloMemoriaMotor(errPrimero)) throw errPrimero;
            logger.error('[e14] sesión OCR caída (familia bad_alloc) — reinicio real del motor + 1 reintento', {
              mensaje: errPrimero instanceof Error ? errPrimero.message : String(errPrimero),
            });
            try {
              const { rapidOcrReiniciar } = await import('@molde-suite/scanner-core/ocr/rapidocr');
              await rapidOcrReiniciar();
            } catch {
              /* el reinicio es best-effort — el reintento decide */
            }
            // Desarmar la auto-captura hasta interacción del operador (fin del
            // bucle condenado). La bandera es persistente en la jornada.
            set({ autoCapturaDesarmada: true });
            return await bridge.escanearActa(opciones);
          }
        })();
        set({ actaActual: acta, analisisResuelto: true, archivoPendiente: null, framePendiente: null });
      } catch (e) {
        logger.warn('[store] escaneo falló', { mensaje: (e as Error).message });
        // El decode clasifica la causa: HEIC (iPhone) merece SU aviso, no el
        // genérico ESCANEO_FALLIDO (upstream: guard HEIC_NO_SOPORTADO); el
        // motor sin memoria exige RECARGAR, no otro reintento.
        const esHeic = e instanceof ErrorRescateHeic;
        const esMemoria = esFalloMemoriaMotor(e);
        set({
          actaActual: null,
          analisisResuelto: true,
          avisoVisor: {
            tipo: 'error',
            motivo: esMemoria ? 'MEMORIA_AGOTADA' : esHeic ? 'HEIC_NO_SOPORTADO' : 'ESCANEO_FALLIDO',
            accion: esMemoria ? 'recargar' : esHeic ? 'entendido' : 'reintentar',
          },
        });
      } finally {
        set({ analisisEnVuelo: false });
      }
    },

    simularImagen: (id) => {
      set({ fuente: 'SIMULACION' });
      void get().dispararEscaneo(1, { imagenSimulada: id });
    },

    alternarModoSimulacion: () =>
      set((s) => ({
        modoSimulacion: !s.modoSimulacion,
        fuente: !s.modoSimulacion ? 'SIMULACION' : 'CAMARA',
      })),

    avanzarSimulacion: () => {
      const ids = IMAGENES_SIMULADAS.map((i) => i.id);
      const idxActual = get().simUltima ? ids.indexOf(get().simUltima as ImagenSimuladaId) : -1;
      if (idxActual === ids.length - 1) {
        set({ simCompleta: true });
        return;
      }
      const siguiente = ids[idxActual + 1];
      set({ simUltima: siguiente });
      get().simularImagen(siguiente);
    },

    analisisCompletado: async () => {
      const { actaActual, analisisEnVuelo, rechazosConsecutivos, documentoEnCurso } = get();
      if (analisisEnVuelo) return;
      if (!actaActual) {
        set({ vista: 'escanear', progresoAnalisis: null, analisisResuelto: false });
        return;
      }
      // Fase 3 (multipágina REAL): con molde de >1 páginas, cada captura con
      // fotografía FÍSICAMENTE válida es una página del documento — se
      // acumula y, al completar las esperadas, `evaluarMoldeMultipagina`
      // evalúa el lote y su veredicto manda (misma ruta del pipeline:
      // veredictoDeResumen sobre el resumen enrutado). OJO: la evaluación
      // POR PÁGINA del bridge corre el molde COMPLETO sobre esa foto, así
      // que un `RECHAZADA` tipo MOLDE (faltan campos de OTRAS páginas) NO
      // descalifica la captura: solo los rechazos FÍSICOS (vacía, recorte
      // incompleto, ilegible, baja calidad, timeout) piden repetir.
      // AUTO: las páginas las declara el molde EVALUADO en esta acta (identificado
      // o activo como fallback); sin evaluación, el molde activo de siempre.
      const esperadas = actaActual.evaluacionMolde?.paginasDelMolde ?? paginasEsperadas();
      const rechazo = actaActual.rechazo;
      const rechazoFisico =
        rechazo != null &&
        (rechazo.tipo === 'INCOMPLETA' ||
          rechazo.tipo === 'ILEGIBLE' ||
          rechazo.tipo === 'SIN_VOTOS' ||
          rechazo.tipo === 'BAJO' ||
          rechazo.tipo === 'TIMEOUT');
      const fotoPagina = actaActual.fotoProcesada;
      if (esperadas > 1 && fotoPagina && !actaActual.procesadaVacia && !rechazoFisico) {
        const sesion: DocumentoEnCurso = documentoEnCurso ?? {
          // AUTO: la identidad del documento en curso es el molde que eligió el
          // router (no el activo de localStorage) — de ahí salen el nombre de
          // archivo y el batch del ZIP.
          moldeNombre: actaActual.evaluacionMolde?.moldeNombre || moldeActivo()?.nombre || '',
          esperadas,
          paginas: [],
        };
        const paginas = [
          ...sesion.paginas,
          {
            pagina: sesion.paginas.length + 1,
            fotoProcesada: fotoPagina,
            fotoOriginal: actaActual.fotoOriginal,
            quad: actaActual.quadDetectado,
            rotation: actaActual.rotation,
          },
        ];
        if (paginas.length < sesion.esperadas) {
          // 2026-11-26: cada PÁGINA capturada es evidencia — se archiva sola
          // con su veredicto antes de pedir la siguiente.
          try {
            await archivarCaptura(set, get, tituloDeArchivo(get, sesion.moldeNombre));
          } catch (e) {
            logger.warn('[store] archivado de página falló', { mensaje: (e as Error).message });
          }
          // Documento INCOMPLETO: la UI muestra PROGRESO (N/M) + CTA
          // ESCANEAR PÁGINA N+1; sin veredicto final todavía.
          set({
            documentoEnCurso: { ...sesion, paginas },
            vista: 'revision',
            progresoAnalisis: null,
            analisisResuelto: false,
            rechazosConsecutivos: 0,
          });
          return;
        }
        let resumen: ResumenMoldeActa | null = null;
        try {
          const { evaluarMoldeMultipagina } = await import('../molde/evaluacion');
          resumen = await evaluarMoldeMultipagina(
            paginas.map((p) => p.fotoProcesada),
            sesion.moldeNombre,
          );
        } catch (e) {
          // El lote es el veredicto del documento, pero su fallo no debe
          // tumbar la sesión: queda el veredicto de la última página.
          logger.warn('[store] evaluación multipágina falló — queda el veredicto de la página', {
            mensaje: (e as Error).message,
          });
        }
        let actaFinal = actaActual;
        if (resumen) {
          const veredicto = veredictoDeResumen(resumen);
          actaFinal = {
            ...actaActual,
            score: veredicto.score,
            status: veredicto.status,
            rechazo: veredicto.rechazo,
            evaluacionMolde: resumen,
          };
        }
        set({
          actaActual: actaFinal,
          documentoEnCurso: { ...sesion, paginas },
          vista: 'revision',
          progresoAnalisis: null,
          analisisResuelto: false,
          rechazosConsecutivos:
            actaFinal.status === 'RECHAZADA' ? rechazosConsecutivos + 1 : 0,
        });
        // Documento multipágina COMPLETO: REGLA DE ORO §4 (plan cierre 2
        // agentes) — la decisión la toma decidirAutoGuardado (pura, testeada):
        // lote legible (ÓPTIMA o ADVERTENCIA con obligatorios completos y sin
        // relacion_ambigua) → UN solo registrarEnvio (una fila de historial);
        // lote NO legible (RECHAZADA / obligatorios faltantes / sin tinta) →
        // la última captura queda archivada con su veredicto real.
        const decisionLote = decidirAutoGuardado(actaFinal, leerFlags().autoGuardado);
        if (decisionLote.autoEnviar) {
          try {
            await registrarEnvio(set, get, tituloDeArchivo(get, sesion.moldeNombre));
          } catch (e) {
            logger.warn('[store] registro del documento multipágina falló', {
              mensaje: (e as Error).message,
            });
          }
        } else {
          logger.info('[store] lote multipágina sin auto-guardado', {
            motivo: decisionLote.motivo,
            status: actaFinal.status,
          });
          // T3 (matiz V5, 2026-11-26): alineación con el flujo de UNA página —
          // EN_REVISION_HUMANA queda fuera de TODO archivado automático
          // (requiere humano). Ocurre cuando la evaluación del lote falló y
          // el veredicto vigente es el de la última página en revisión.
          // RECHAZADA/ADVERTENCIA sí archivan su evidencia (regla 2026-11-26).
          if (procedeArchivadoAutomatico(actaFinal.status) && !actaFinal.capturaArchivada) {
            try {
              await archivarCaptura(set, get, tituloDeArchivo(get, sesion.moldeNombre));
            } catch (e) {
              logger.warn('[store] archivado del lote rechazado falló', {
                mensaje: (e as Error).message,
              });
            }
          }
        }
        reciclarWorkersPostEscaneo();
        return;
      }
      // REGLA DE ORO §4 (recalcada por el dueño 2026-11-26) — documento de UNA
      // página: la decisión del auto-guardado sale de decidirAutoGuardado:
      //  · ÓPTIMA legible → auto-envío (regla existente D4/G4, ahora bajo el
      //    flag `autoGuardado`).
      //  · ADVERTENCIA legible (obligatorios completos, sin
      //    `relacion_ambigua`) → HUECO CERRADO (B4): antes era decisión
      //    manual (D20) y un documento legible podía quedar sin guardar.
      //  · RECHAZADA / EN_REVISION_HUMANA / `relacion_ambigua` / sin tinta /
      //    flag apagado → NO auto-guarda (excepciones del plan).
      // Al enviar: status ENVIADA para que REVISIÓN muestre el banner
      // «ENVIADO AUTOMÁTICAMENTE» + CTA SEGUIR ESCANEANDO.
      const decision = decidirAutoGuardado(actaActual, leerFlags().autoGuardado);
      if (decision.autoEnviar) {
        try {
          const { hora } = await registrarEnvio(set, get, tituloDeArchivo(get));
          const actual = get().actaActual;
          if (actual) {
            set({
              actaActual: { ...actual, status: 'ENVIADA', enviadoAutomaticamente: hora },
            });
          }
        } catch (e) {
          // registrarEnvio es no-lanzable (hash null honesto, fotoLibro en
          // try) — si algo fallara, el acta queda ÓPTIMA/ADVERTENCIA y
          // REVISIÓN da la salida (no se pierde en silencio).
          logger.warn('[store] auto-guardado del acta legible falló', {
            mensaje: (e as Error).message,
          });
        }
        set({
          vista: 'revision',
          progresoAnalisis: null,
          analisisResuelto: false,
          rechazosConsecutivos: 0,
        });
        reciclarWorkersPostEscaneo();
        return;
      }
      logger.info('[store] sin auto-guardado', { motivo: decision.motivo, status: actaActual.status });
      // RECHAZADA también va a REVISIÓN: el veredicto y su motivo (incluido
      // el corte temprano del gate estructural) deben llegar al operador —
      // volver a ESCANEAR en silencio ocultaba la regla que faltó.
      // 2026-11-26 («aceptar y guardar automáticamente las imágenes»):
      // ADVERTENCIA y RECHAZADA se ARCHIVAN solas con su veredicto real antes
      // de mostrar REVISIÓN — el operador decide repetir/revisar, pero la
      // imagen ya no se pierde. (La legible se envió arriba por §4.)
      // §4 test obligatorio (3): EN_REVISION_HUMANA NO guarda solo — queda
      // fuera de TODO archivado automático (requiere humano). T3: el MISMO
      // predicado puro gobierna el lote multipágina (paridad garantizada).
      if (
        procedeArchivadoAutomatico(actaActual.status) &&
        !actaActual.capturaArchivada &&
        (actaActual.fotoProcesada || actaActual.fotoOriginal)
      ) {
        try {
          await archivarCaptura(set, get, tituloDeArchivo(get));
        } catch (e) {
          logger.warn('[store] archivado automático de la captura falló', {
            mensaje: (e as Error).message,
          });
        }
      }
      set({
        vista: 'revision',
        progresoAnalisis: null,
        analisisResuelto: false,
        // Fase 2 (guardar cruda): contador de rechazos CONSECUTIVOS — cruza
        // capturas (repetirFoto NO lo toca); cualquier desenlace distinto lo
        // pone a cero. ≥ 2 → REVISIÓN ofrece GUARDAR CRUDA.
        rechazosConsecutivos:
          actaActual.status === 'RECHAZADA' ? rechazosConsecutivos + 1 : 0,
      });
      reciclarWorkersPostEscaneo();
    },

    rescatarActaPostTimeout: (vencida, real, tiempoRealMs) => {
      // Solo actas válidas rescatan el rechazo por tiempo (e67 cambio B).
      if (real.status === 'OPTIMA' || real.status === 'ADVERTENCIA') {
        logger.info('[store] rescate post-timeout', { ms: tiempoRealMs, id: vencida.id });
        set({ actaActual: real });
      }
    },

    repetirFoto: () =>
      set((s) => {
        // Fase 3 (multipágina): repetir DESCARTAR la última página capturada
        // del documento — solo si el acta actual ES esa página (una captura
        // RECHAZADA nunca se acumuló y conserva las anteriores). Documento
        // completo (veredicto final) → repetir empieza un documento nuevo.
        let docNuevo = s.documentoEnCurso;
        if (docNuevo) {
          if (docNuevo.paginas.length < docNuevo.esperadas) {
            const ultima = docNuevo.paginas[docNuevo.paginas.length - 1];
            if (s.actaActual && ultima && ultima.fotoProcesada === s.actaActual.fotoProcesada) {
              const paginas = docNuevo.paginas.slice(0, -1);
              docNuevo = paginas.length > 0 ? { ...docNuevo, paginas } : null;
            }
          } else {
            docNuevo = null;
          }
        }
        return {
          vista: 'escanear',
          vistaPrevia: s.vista,
          actaActual: null,
          progresoAnalisis: null,
          analisisResuelto: false,
          documentoEnCurso: docNuevo,
        };
      }),

    siguientePagina: () =>
      set({
        vista: 'escanear',
        actaActual: null,
        progresoAnalisis: null,
        analisisResuelto: false,
      }),

    cancelarDocumento: () =>
      set({
        documentoEnCurso: null,
        vista: 'escanear',
        actaActual: null,
        progresoAnalisis: null,
        analisisResuelto: false,
      }),

    aplicarRecorte: async (quad, rotacionNueva) => {
      const acta = get().actaActual;
      if (!acta?.fotoOriginal) return false;
      // Guard SIMÉTRICO (upstream edicion.ts FIX M5): un revelado/mejora en
      // vuelo compite por el motor y su resolve tardío sobrescribiría el
      // recorte recién aplicado.
      if (get().recortando || get().revelando) return false;
      set({ recortando: true, progresoAnalisis: null, errorRecorte: null });
      try {
        const bridge = getBridge();
        const actaNueva = await bridge.recortar(
          acta,
          quad,
          (p) => set({ progresoAnalisis: p }),
          rotacionNueva,
          undefined,
          true,
        );
        set({ actaActual: actaNueva, progresoAnalisis: null, recortando: false });
        return true;
      } catch (e) {
        // Upstream T2: el fallo DEJA DE SER SILENCIOSO — píldora con copy fijo
        // (nunca el message crudo del Error) y el editor se queda abierto.
        logger.error('[store] aplicarRecorte falló:', { mensaje: e instanceof Error ? e.message : String(e) });
        set({
          recortando: false,
          progresoAnalisis: null,
          errorRecorte: 'NO SE PUDO RECORTAR — INTENTA DE NUEVO',
        });
        return false;
      }
    },

    cambiarFiltro: async (filtro) => {
      const acta = get().actaActual;
      if (!acta?.fotoOriginal) return;
      if (get().revelando) return; // guard de reentrada (upstream edicion.ts:154)
      set({ revelando: true });
      try {
        const bridge = getBridge();
        const actaNueva = await bridge.revelar(acta, filtro as PageFilter);
        // Identidad al resolver (upstream FIX M5): un recorte aplicado durante
        // el revelado NO debe ser sobrescrito por este resolve.
        if (get().actaActual !== acta) return;
        set({ actaActual: actaNueva });
      } catch (e) {
        // El revelado es un preview: al fallar, el acta conserva la foto y el
        // filtro anterior (upstream edicion.ts:168-174) — sin rechazo propagado.
        logger.debug('[store] revelado del filtro falló — la foto anterior queda', {
          mensaje: (e as Error).message,
        });
      } finally {
        set({ revelando: false });
      }
    },

    reconocerTextoActa: async () => {
      const acta = get().actaActual;
      // Guard (upstream spec §F2.1): sin foto procesada no hay nada que reconocer.
      if (!acta?.fotoProcesada) return;
      try {
        const bridge = getBridge();
        const texto = await bridge.reconocerTexto(acta);
        // ocrTextIsValid del upstream (edicion.ts:189): una lectura vacía NO
        // sobrescribe el OCR previo válido.
        if (texto.trim().length > 0) {
          set({ actaActual: { ...acta, ocrTexto: texto } });
        }
      } catch (e) {
        logger.debug('[store] re-OCR falló — el texto previo queda', {
          mensaje: (e as Error).message,
        });
      }
    },

    rotarFoto: async () => {
      const acta = get().actaActual;
      // F-ROT-RAPID (upstream edicion.ts:123-147): gira la PROCESADA sin
      // re-ejecutar el pipeline (rápido, sin OCR) y la rotación queda HORNEADA.
      if (!acta?.fotoProcesada) return;
      if (rotandoFotoEnVuelo) return;
      rotandoFotoEnVuelo = true;
      try {
        const url = await rotarDataUrl90(acta.fotoProcesada);
        set({
          actaActual: {
            ...acta,
            fotoProcesada: url,
            rotation: ((acta.rotation ?? 0) + 90) % 360,
          },
        });
      } catch {
        // La rotación fallida no cambia estado — el acta conserva su foto.
      } finally {
        rotandoFotoEnVuelo = false;
      }
    },

    mejorarFotoActa: async (fotoNueva, objetivo) => {
      // Guardas del lab (upstream edicion.ts:199-205 — silenciosas: el upgrade
      // JAMÁS rompe nada): identidad de captura, acta ya enviada, recorte o
      // revelado en vuelo.
      const acta = get().actaActual;
      if (!acta || acta !== objetivo) return;
      if (acta.status === 'ENVIADA') return;
      if (get().recortando || get().revelando) return;
      if (!acta.fotoOriginal) return;
      set({ revelando: true });
      try {
        const bridge = getBridge();
        const actaNueva = await bridge.mejorarResolucion(objetivo, fotoNueva, (p) =>
          set({ progresoAnalisis: p }),
        );
        // El usuario pudo actuar mientras el upgrade volaba: solo escribo si
        // el acta SIGUE siendo la misma (identidad por referencia).
        if (get().actaActual !== objetivo) return;
        set({ actaActual: actaNueva, progresoAnalisis: null });
      } catch (e) {
        logger.debug('[store] upgrade silencioso falló — el acta queda como está', {
          mensaje: (e as Error).message,
        });
      } finally {
        set({ revelando: false });
      }
    },

    mostrarAvisoVisor: (aviso) => set({ avisoVisor: aviso as AvisoOperador }),
    descartarAvisoVisor: () => set({ avisoVisor: null }),
    setAutoCapturaDesarmada: (v) => set({ autoCapturaDesarmada: v }),
    editarCampoActa: (campoId, valor) => editarCampoActa(set, get, campoId, valor),
    cancelarAnalisis: () =>
      set({ vista: 'escanear', progresoAnalisis: null, analisisResuelto: false, analisisEnVuelo: false }),
    interrumpirAnalisis: () =>
      set({ vista: 'escanear', progresoAnalisis: null, analisisResuelto: false, analisisEnVuelo: false }),
  };
}

// ---------------------------------------------------------------------------
// Slice de JORNADA (arranque/reinicio + persistencia).
// ---------------------------------------------------------------------------

function crearJornada(
  set: (partial: Partial<E14Store> | ((s: E14Store) => Partial<E14Store>)) => void,
  get: () => E14Store,
): Pick<E14Store, 'arrancarJornada' | 'reiniciarJornada' | 'contarMotivoNoEnvioActa'> {
  return {
    arrancarJornada: async () => {
      try {
        const registro = await cargarJornada();
        if (registro) {
          set({
            archivadas: registro.archivadas,
            puestoActual: registro.puestoActual,
            historial: registro.historial.slice(-TOPE_HISTORIAL),
            completadas: registro.completadas,
            asignadasHoy: registro.asignadasHoy,
            actasSesion: registro.actasSesion,
            colaOffline: registro.colaOffline,
            solicitudesRescaneo: registro.solicitudesRescaneo,
            motivosNoEnvio: registro.motivosNoEnvio,
          });
          refrescarMesasDeArchivo(set as never, get);
        }
      } catch {
        logger.warn('[store] jornada ilegible: arranca limpia');
      }
    },
    reiniciarJornada: async () => {
      set({
        archivadas: {},
        puestoActual: null,
        historial: [],
        mesas: [],
        completadas: 0,
        asignadasHoy: 0,
        actasSesion: 0,
        colaOffline: 0,
        solicitudesRescaneo: 0,
        motivosNoEnvio: {},
        rechazosConsecutivos: 0,
        documentoEnCurso: null,
        actaActual: null,
        vista: 'escanear',
      });
      await guardarJornada({
        version: 1,
        archivadas: {},
        puestoActual: null,
        historial: [],
        completadas: 0,
        asignadasHoy: 0,
        actasSesion: 0,
        colaOffline: 0,
        solicitudesRescaneo: 0,
        motivosNoEnvio: {},
      });
      await guardarActaEnRevision(null);
    },
    contarMotivoNoEnvioActa: (acta) => {
      const motivo = acta.status === 'RECHAZADA' ? 'RECHAZADA' : acta.status;
      set((s) => ({
        motivosNoEnvio: { ...s.motivosNoEnvio, [motivo]: (s.motivosNoEnvio[motivo] ?? 0) + 1 },
      }));
    },
  };
}

// ---------------------------------------------------------------------------
// Composición del store.
// ---------------------------------------------------------------------------

export const useE14Store = create<E14Store>()((set, get) => ({
  ...crearNavegacion(set, get),
  ...crearEnvio(set, get),
  ...crearCaptura(set, get),
  ...crearJornada(set, get),
  // Estado derivado restante (contadores de sesión).
  actasSesion: 0,
    pdfLibro: [],
  mesas: [],
  archivadas: {},
  puestoActual: null,
  completadas: 0,
  asignadasHoy: 0,
  colaOffline: 0,
  solicitudesRescaneo: 0,
  historial: [],
  motivosNoEnvio: {},
}));

/** §6.10 — fallos de escritura de la jornada EXPUESTOS: sin este cable, un
 *  QuotaExceededError (almacenamiento lleno / modo incógnito) se tragaba en
 *  silencio y el turno se perdía sin señal (kit upstream store/persistencia). */
if (typeof window !== 'undefined') {
  enFalloEscrituraJornada((fallo) => {
    useE14Store.setState({
      avisoVisor: {
        tipo: 'warning',
        motivo: 'ALMACENAMIENTO_LLENO',
        accion: 'entendido',
      },
    });
    logger.warn('[store] escritura de jornada falló', {
      contexto: fallo.contexto,
      quota: fallo.quota,
    });
  });
}

/** Persistencia de la jornada al cerrar (best-effort). */
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    const s = useE14Store.getState();
    void guardarJornada({
      version: 1,
      archivadas: s.archivadas,
      puestoActual: s.puestoActual,
      historial: s.historial.slice(-TOPE_HISTORIAL),
      completadas: s.completadas,
      asignadasHoy: s.asignadasHoy,
      actasSesion: s.actasSesion,
      colaOffline: s.colaOffline,
      solicitudesRescaneo: s.solicitudesRescaneo,
      motivosNoEnvio: s.motivosNoEnvio,
    }).catch(() => undefined);
  });
}

export { TEXTO_MOTIVO };
export type { AvisoOperador, MotivoOperador, ImagenSimuladaId };
