// Índice del store e14 (zustand): compone los slices navegación + envío +
// captura/análisis/edición y expone useE14Store + tipos.

import { create } from 'zustand';
import type { PaginaObjetivo } from '@jg-stevan/scanner-core/dominio/bridge';
import type { Acta, ProgresoAnalisis } from '@jg-stevan/scanner-core/dominio/types';
import type { PageFilter, Quad } from '@jg-stevan/scanner-core/core/types';
import type { ClasificacionE14 } from '@jg-stevan/scanner-core/dominio/clasificador';
import { getBridge } from '../get-bridge';
import { IMAGENES_SIMULADAS, type ImagenSimuladaId } from '../simulacion-imagenes';
import { TEXTO_MOTIVO, type AvisoOperador, type MotivoOperador } from '../errores';
import { logger } from '../../logger';
import { crearNavegacion } from './navegacion';
import { crearEnvio } from './envio';
import { refrescarMesasDeArchivo } from './guion';
import {
  cargarJornada,
  guardarActaEnRevision,
  guardarJornada,
  TOPE_HISTORIAL,
} from '../jornada';
import type { E14Store, Vista } from './tipos';

export type { Vista, ActaArchivada, PuestoActual, HuecoArchivado, E14Store } from './tipos';

// ---------------------------------------------------------------------------
// Slice de CAPTURA + ANÁLISIS + EDICIÓN (la parte que faltaba del store).
// ---------------------------------------------------------------------------

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
      try {
        const acta = await bridge.escanearActa({
          archivo: archivo ?? undefined,
          fuente,
          frameActual: frame,
          intento: intentoArg ?? 1,
          maxIntentos: 3,
          objetivo: get().paginaObjetivo,
          imagenSimulada: sim?.imagenSimulada,
          onProgreso: (p: ProgresoAnalisis) => set({ progresoAnalisis: p }),
        });
        set({ actaActual: acta, analisisResuelto: true, archivoPendiente: null, framePendiente: null });
      } catch (e) {
        logger.warn('[store] escaneo falló', { mensaje: (e as Error).message });
        set({
          actaActual: null,
          analisisResuelto: true,
          avisoVisor: { tipo: 'error', motivo: 'ESCANEO_FALLIDO', accion: 'reintentar' },
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
      const { actaActual, analisisEnVuelo } = get();
      if (analisisEnVuelo) return;
      if (!actaActual) {
        set({ vista: 'escanear', progresoAnalisis: null, analisisResuelto: false });
        return;
      }
      if (actaActual.status === 'RECHAZADA') {
        set({ vista: 'escanear', progresoAnalisis: null, analisisResuelto: false });
        return;
      }
      set({ vista: 'revision', progresoAnalisis: null, analisisResuelto: false });
    },

    rescatarActaPostTimeout: (vencida, real, tiempoRealMs) => {
      // Solo actas válidas rescatan el rechazo por tiempo (e67 cambio B).
      if (real.status === 'OPTIMA' || real.status === 'ADVERTENCIA') {
        logger.info('[store] rescate post-timeout', { ms: tiempoRealMs, id: vencida.id });
        set({ actaActual: real });
      }
    },

    repetirFoto: () =>
      set((s) => ({
        vista: 'escanear',
        vistaPrevia: s.vista,
        actaActual: null,
        progresoAnalisis: null,
        analisisResuelto: false,
      })),

    aplicarRecorte: async (quad, rotacionNueva) => {
      const acta = get().actaActual;
      if (!acta?.fotoOriginal) return false;
      set({ recortando: true, errorRecorte: null });
      try {
        const bridge = getBridge();
        const actaNueva = await bridge.recortar(acta, quad, undefined, rotacionNueva, undefined, true);
        set({ actaActual: actaNueva, recortando: false });
        return true;
      } catch (e) {
        set({ recortando: false, errorRecorte: (e as Error).message });
        return false;
      }
    },

    cambiarFiltro: async (filtro) => {
      const acta = get().actaActual;
      if (!acta?.fotoOriginal) return;
      set({ revelando: true });
      try {
        const bridge = getBridge();
        const actaNueva = await bridge.revelar(acta, filtro as PageFilter);
        set({ actaActual: actaNueva });
      } finally {
        set({ revelando: false });
      }
    },

    reconocerTextoActa: async () => {
      const acta = get().actaActual;
      if (!acta) return;
      const bridge = getBridge();
      const texto = await bridge.reconocerTexto(acta);
      set({ actaActual: { ...acta, ocrTexto: texto } });
    },

    rotarFoto: async () => {
      const acta = get().actaActual;
      if (!acta?.fotoOriginal) return;
      set({ recortando: true, errorRecorte: null });
      try {
        const bridge = getBridge();
        const rotacion = ((acta.rotation ?? 0) + 90) % 360;
        const actaNueva = await bridge.recortar(
          acta,
          acta.quadDetectado as Quad,
          undefined,
          rotacion,
          undefined,
          true,
        );
        set({ actaActual: actaNueva, recortando: false });
      } catch (e) {
        set({ recortando: false, errorRecorte: (e as Error).message });
      }
    },

    mejorarFotoActa: async (fotoNueva, objetivo) => {
      const bridge = getBridge();
      const actaNueva = await bridge.mejorarResolucion(objetivo, fotoNueva);
      if (get().actaActual?.id === objetivo.id) set({ actaActual: actaNueva });
    },

    mostrarAvisoVisor: (aviso) => set({ avisoVisor: aviso as AvisoOperador }),
    descartarAvisoVisor: () => set({ avisoVisor: null }),
    setAutoCapturaDesarmada: (v) => set({ autoCapturaDesarmada: v }),
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
