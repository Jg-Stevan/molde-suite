'use client';

// Estado global del Molde Studio (zustand): molde en uso, biblioteca,
// historial de pruebas y navegación entre pestañas.

import { create } from 'zustand';
import type { MoldeUniversal } from '@/lib/molde/universal-types';
import { repo } from '@/lib/repo';
import type { MoldeDB, PruebaDB } from '@/lib/repo-types';
import { toast } from '@/hooks/use-toast';

// Re-exporta los tipos de la capa de datos (viven en repo-types para evitar
// el ciclo repo ↔ repo-idb).
export type { MoldeDB, PruebaDB } from '@/lib/repo-types';

export type Pestana = 'moldes' | 'editor' | 'verificacion';

interface StudioState {
  pestana: Pestana;
  moldes: MoldeDB[];
  cargandoMoldes: boolean;
  moldeId: string | null;
  molde: MoldeUniversal | null;
  pruebas: PruebaDB[];
  pruebaId: string | null;
  campoSeleccionadoId: string | null;
  /**
   * Bandera one-shot: "Probar Plantilla" la activa tras navegar a Verificación
   * para que la corrida visible se RE-EJECUTE automáticamente con el molde
   * recién guardado (sin volver a subir el archivo). VerificacionTab la
   * consume al cargar la corrida y la apaga.
   */
  pendienteReejecutar: boolean;

  setPestana: (p: Pestana) => void;
  cargarMoldes: () => Promise<void>;
  abrirMolde: (id: string) => void;
  setMoldeActual: (m: MoldeUniversal | null) => void;
  guardarMoldeActual: () => Promise<boolean>;
  cargarPruebas: (moldeId?: string) => Promise<void>;
  setPruebaId: (id: string | null) => void;
  setCampoSeleccionado: (id: string | null) => void;
  irAEditorCampo: (campoId: string) => void;
  irAVerificacion: (pruebaId: string) => void;
  solicitarReejecucion: () => void;
  consumirReejecucion: () => void;
  eliminarMolde: (id: string) => Promise<void>;
}

export const useStudio = create<StudioState>((set, get) => ({
  pestana: 'moldes',
  moldes: [],
  cargandoMoldes: false,
  moldeId: null,
  molde: null,
  pruebas: [],
  pruebaId: null,
  campoSeleccionadoId: null,
  pendienteReejecutar: false,

  setPestana: (p) => set({ pestana: p }),

  cargarMoldes: async () => {
    set({ cargandoMoldes: true });
    try {
      const r = await repo.listarMoldes();
      if (r.ok) set({ moldes: r.data });
    } finally {
      set({ cargandoMoldes: false });
    }
  },

  abrirMolde: (id) => {
    const m = get().moldes.find((x) => x.id === id);
    if (!m) return;
    let parsed: MoldeUniversal | null = null;
    try {
      parsed = JSON.parse(m.json) as MoldeUniversal;
    } catch {
      parsed = null;
    }
    set({ moldeId: id, molde: parsed, campoSeleccionadoId: null, pruebaId: null });
    get().cargarPruebas(id);
  },

  setMoldeActual: (m) => set({ molde: m }),

  guardarMoldeActual: async () => {
    const { moldeId, molde } = get();
    if (!moldeId || !molde) return false;
    const r = await repo.actualizarMolde(moldeId, { json: molde, nombre: molde.nombre });
    if (r.ok) {
      await get().cargarMoldes();
      toast({ title: 'Molde guardado', description: molde.nombre });
      return true;
    }
    toast({ title: 'Error al guardar', description: r.error, variant: 'destructive' });
    return false;
  },

  cargarPruebas: async (moldeId) => {
    const id = moldeId ?? get().moldeId ?? undefined;
    const r = await repo.listarPruebas(id);
    if (r.ok) set({ pruebas: r.data });
  },

  setPruebaId: (id) => set({ pruebaId: id }),
  setCampoSeleccionado: (id) => set({ campoSeleccionadoId: id }),

  irAEditorCampo: (campoId) => {
    set({ pestana: 'editor', campoSeleccionadoId: campoId });
  },

  irAVerificacion: (pruebaId) => {
    set({ pestana: 'verificacion', pruebaId });
  },

  solicitarReejecucion: () => set({ pendienteReejecutar: true }),

  consumirReejecucion: () => set({ pendienteReejecutar: false }),

  eliminarMolde: async (id) => {
    const r = await repo.eliminarMolde(id);
    if (r.ok) {
      if (get().moldeId === id) set({ moldeId: null, molde: null, pruebas: [] });
      await get().cargarMoldes();
      toast({ title: 'Molde eliminado' });
    } else {
      toast({ title: 'No se pudo eliminar el molde', description: r.error, variant: 'destructive' });
    }
  },
}));
