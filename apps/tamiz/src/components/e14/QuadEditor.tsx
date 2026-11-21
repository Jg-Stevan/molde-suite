'use client';

// Editor de quad: arrastra las 4 esquinas sobre la foto original para
// corregir el recorte manualmente (rescate D20). Aplica al soltar Confirmar.

import { useEffect, useRef, useState } from 'react';
import type { Quad } from '@/lib/e14/fachada';
import { ToolbarBtn } from './primitives';
import { StitchCropIcon, StitchRotateIcon } from './icons';

interface Props {
  fotoOriginal: string;
  quadInicial: Quad;
  rotation: number;
  aplicando: boolean;
  onCancelar: () => void;
  onAplicar: (quad: Quad, rotacion: number) => void;
}

export function QuadEditor({ fotoOriginal, quadInicial, rotation, aplicando, onCancelar, onAplicar }: Props) {
  const [quad, setQuad] = useState<Quad>(() => quadInicial.map((p) => ({ ...p })) as Quad);
  const [rotacion, setRotacion] = useState(rotation);
  const [sel, setSel] = useState<number | null>(null);
  const contRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ idx: number; x0: number; y0: number } | null>(null);

  useEffect(() => {
    setQuad(quadInicial.map((p) => ({ ...p })) as Quad);
    setRotacion(rotation);
  }, [quadInicial, rotation]);

  useEffect(() => {
    const mover = (e: PointerEvent) => {
      const d = dragRef.current;
      const cont = contRef.current;
      if (!d || !cont) return;
      const r = cont.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      setQuad((q) => q.map((p, i) => (i === d.idx ? { x, y } : p)) as Quad);
    };
    const soltar = () => {
      dragRef.current = null;
    };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
    return () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
    };
  }, []);

  const polygon = quad.map((p) => `${p.x * 100},${p.y * 100}`).join(' ');

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-brand-black/95 p-4">
      <div className="flex items-center justify-between pb-3">
        <p className="font-mono text-xs font-bold text-brand-green">AJUSTAR RECORTE</p>
        <div className="flex items-center gap-2">
          <ToolbarBtn
            icon={<StitchRotateIcon className="h-4 w-4" />}
            label={`ROTAR ${rotacion}°`}
            onClick={() => setRotacion((r) => (r + 90) % 360)}
          />
        </div>
      </div>
      <div
        ref={contRef}
        className="relative flex-1 touch-none overflow-hidden rounded-xl border border-brand-border"
      >
        <img
          src={fotoOriginal}
          alt="Foto original"
          className="block max-h-full max-w-full select-none object-contain"
          style={{ transform: `rotate(${rotacion}deg)` }}
          draggable={false}
        />
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polygon points={polygon} fill="rgba(16,185,129,0.12)" stroke="#10b981" strokeWidth="0.5" />
          {quad.map((p, i) => (
            <circle
              key={i}
              cx={p.x * 100}
              cy={p.y * 100}
              r={sel === i ? 1.6 : 1.1}
              fill={sel === i ? '#fbbf24' : '#10b981'}
            />
          ))}
        </svg>
        {quad.map((p, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Esquina ${i + 1}`}
            onPointerDown={(e) => {
              e.preventDefault();
              setSel(i);
              dragRef.current = { idx: i, x0: e.clientX, y0: e.clientY };
            }}
            className="absolute h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
            style={{
              left: `${p.x * 100}%`,
              top: `${p.y * 100}%`,
              borderColor: sel === i ? '#fbbf24' : '#10b981',
              backgroundColor: 'rgba(16,185,129,0.25)',
            }}
          />
        ))}
      </div>
      <div className="flex items-center justify-between gap-3 pt-3">
        <button
          type="button"
          onClick={onCancelar}
          disabled={aplicando}
          className="rounded-xl border border-brand-border px-4 py-2.5 text-xs font-bold text-white/80 disabled:opacity-40"
        >
          CANCELAR
        </button>
        <button
          type="button"
          onClick={() => onAplicar(quad, rotacion)}
          disabled={aplicando}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-green px-4 py-2.5 text-xs font-bold text-black disabled:opacity-40"
        >
          <StitchCropIcon className="h-4 w-4" />
          {aplicando ? 'APLICANDO…' : 'APLICAR RECORTE'}
        </button>
      </div>
    </div>
  );
}
