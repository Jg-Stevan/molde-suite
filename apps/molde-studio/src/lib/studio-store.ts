'use client';

// Estado global del Molde Studio (zustand): molde en uso, biblioteca,
// historial de pruebas y navegación entre pestañas.

import { create } from 'zustand';
import type { MoldeUniversal } from '@/lib/molde/universal-types';
import { toast } from '@/hooks/use-toast';

export type Pestana = 'moldes' | 'editor' | 'verificacion';

export interface MoldeDB {
  id: string;
  nombre: string;
  descripcion: string | null;
  documento: string | null;
  json: string;
  imagenRef: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { pruebas: number };
  pruebas?: { score: number | null }[];
}

export interface PruebaDB {
  id: string;
  moldeId: string;
  archivo: string;
  score: number | null;
  requiereRevision: boolean;
  createdAt: string;
  /** URL del documento fuente (/uploads/...) si la corrida es re-ejecutable. */
  fuenteUrl?: string | null;
  /** Momento de la última ejecución/re-ejecución (detección de versión). */
  updatedAt?: string;
  molde?: { nombre: string };
}

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
      const res = await fetch('/api/moldes');
      if (res.ok) set({ moldes: await res.json() });
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
    const res = await fetch(`/api/moldes/${moldeId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ json: molde, nombre: molde.nombre }),
    });
    if (res.ok) {
      await get().cargarMoldes();
      toast({ title: 'Molde guardado', description: molde.nombre });
      return true;
    }
    const err = await res.json().catch(() => ({ error: 'Error al guardar' }));
    toast({ title: 'Error al guardar', description: err.error, variant: 'destructive' });
    return false;
  },

  cargarPruebas: async (moldeId) => {
    const id = moldeId ?? get().moldeId ?? undefined;
    const url = id ? `/api/pruebas?moldeId=${id}` : '/api/pruebas';
    const res = await fetch(url);
    if (res.ok) set({ pruebas: await res.json() });
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
    const res = await fetch(`/api/moldes/${id}`, { method: 'DELETE' });
    if (res.ok) {
      if (get().moldeId === id) set({ moldeId: null, molde: null, pruebas: [] });
      await get().cargarMoldes();
      toast({ title: 'Molde eliminado' });
    }
  },
}));
