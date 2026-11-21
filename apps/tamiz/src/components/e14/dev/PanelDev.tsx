'use client';

// Panel de diagnóstico (DEV): estado del puente, sesión y modo dev.

import { useEffect, useState } from 'react';
import { useE14Store } from '@/lib/e14/store';
import { estadoPuente, hubEnUso } from '@/lib/e14/puente/envio';
import { sesionActual } from '@/lib/e14/rastreo/motor';
import { alternarModoDev, useModoDev } from './puente';

interface Props {
  onClose: () => void;
}

export function PanelDev({ onClose }: Props) {
  const store = useE14Store();
  const modoDev = useModoDev();
  const [puente, setPuente] = useState(estadoPuente());
  useEffect(() => setPuente(estadoPuente()), []);
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-end bg-black/40 p-4" role="presentation">
      <div
        role="dialog"
        aria-label="Panel de diagnóstico"
        className="mt-12 w-80 rounded-2xl border border-brand-border bg-brand-surface p-4 text-white"
      >
        <div className="flex items-center justify-between pb-3">
          <p className="font-mono text-xs font-bold text-brand-green">DIAGNÓSTICO</p>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-white/60 hover:text-white">
            ✕
          </button>
        </div>
        <dl className="space-y-1.5 font-mono text-[10px] leading-relaxed">
          <div className="flex justify-between">
            <dt className="text-white/50">sesión</dt>
            <dd>{sesionActual() || '—'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-white/50">vista</dt>
            <dd>{store.vista}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-white/50">actas sesión</dt>
            <dd>{store.actasSesion}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-white/50">cola offline</dt>
            <dd>{store.colaOffline}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-white/50">puente activo</dt>
            <dd>{puente.activo ? 'SÍ' : 'NO'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-white/50">hub</dt>
            <dd className="max-w-[55%] truncate">{hubEnUso() ?? '—'}</dd>
          </div>
        </dl>
        <button
          type="button"
          onClick={alternarModoDev}
          aria-pressed={modoDev}
          className="mt-4 w-full rounded-lg border border-brand-border px-3 py-2 font-mono text-[10px] font-bold text-white/80 hover:border-brand-green"
        >
          MODO DEV: {modoDev ? 'ON' : 'OFF'}
        </button>
      </div>
    </div>
  );
}
