'use client';

// Galería de imágenes simuladas (selector del modo SIMULACIÓN).

import { IMAGENES_SIMULADAS, type ImagenSimuladaId } from '@/lib/e14/simulacion-imagenes';

interface Props {
  abierta: boolean;
  onCerrar: () => void;
  onElegir: (id: ImagenSimuladaId) => void;
}

export function GaleriaSimulacion({ abierta, onCerrar, onElegir }: Props) {
  if (!abierta) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-label="Galería de simulación"
        className="w-full max-w-md rounded-2xl border border-brand-border bg-brand-surface p-4"
      >
        <div className="flex items-center justify-between pb-3">
          <p className="font-mono text-xs font-bold text-brand-green">IMÁGENES DE PRUEBA</p>
          <button type="button" onClick={onCerrar} aria-label="Cerrar galería" className="text-white/60 hover:text-white">
            ✕
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {IMAGENES_SIMULADAS.map((img) => (
            <button
              key={img.id}
              type="button"
              onClick={() => onElegir(img.id)}
              className="flex flex-col items-start gap-1 rounded-xl border border-brand-border bg-brand-surfacelight p-3 text-left transition hover:border-brand-green"
            >
              <span className="text-xs font-bold text-white">{img.titulo}</span>
              <span className="text-[10px] leading-snug text-white/60">{img.descripcion}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
