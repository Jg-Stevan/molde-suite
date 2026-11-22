'use client';

// Panel de diagnóstico (DEV): estado del puente, sesión y modo dev.

import { useEffect, useState } from 'react';
import { useE14Store } from '@/lib/e14/store';
import { estadoPuente, hubEnUso } from '@/lib/e14/puente/envio';
import { sesionActual } from '@/lib/e14/rastreo/motor';
import { alternarModoDev, useModoDev } from './puente';
// FASE 0 (blueprint DLA): molde activo (motor universal compartido) + flags DLA.
import { activarMolde, desactivarMolde, moldeActivo } from '@/lib/e14/molde/registry';
import { leerFlags } from '@/lib/e14/flags';
import type { MoldeUniversal } from '@jg-stevan/scanner-core/molde/universal-types';

interface Props {
  onClose: () => void;
}

export function PanelDev({ onClose }: Props) {
  const store = useE14Store();
  const modoDev = useModoDev();
  const [puente, setPuente] = useState(estadoPuente());
  useEffect(() => setPuente(estadoPuente()), []);
  // FASE 0 (blueprint DLA): molde activo — import JSON, estado y apagado.
  const [molde, setMolde] = useState<MoldeUniversal | null>(moldeActivo());
  const [avisoMolde, setAvisoMolde] = useState<string | null>(null);
  async function onImportarMolde(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    e.target.value = '';
    if (!archivo) return;
    try {
      const texto = await archivo.text();
      const res = activarMolde(JSON.parse(texto) as unknown);
      if (res.ok) {
        setMolde(moldeActivo());
        setAvisoMolde(`MOLDE ACTIVO: ${res.nombre}`);
      } else {
        setAvisoMolde(`MOLDE RECHAZADO: ${res.errores[0] ?? 'estructura inválida'}`);
      }
    } catch (err) {
      setAvisoMolde(`JSON ILEGIBLE: ${(err as Error).message.slice(0, 60)}`);
    }
  }
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
        {/* FASE 0 (blueprint DLA): molde activo — el pipeline ejecuta el motor
            universal compartido tras el gate cuando hay molde registrado. */}
        <div className="mt-4 rounded-lg border border-brand-border p-2.5">
          <p className="font-mono text-[10px] font-bold text-white/70">MOLDE ACTIVO (DLA)</p>
          <dl className="mt-1.5 space-y-1 font-mono text-[10px] leading-relaxed">
            <div className="flex justify-between gap-2">
              <dt className="text-white/50">nombre</dt>
              <dd className="max-w-[55%] truncate">{molde?.nombre ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-white/50">campos</dt>
              <dd>{molde ? molde.campos.length : '—'}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-white/50">flags</dt>
              <dd>
                eval:{leerFlags().evaluacionMolde ? 'ON' : 'OFF'} · deskew:{leerFlags().deskew ? 'ON' : 'OFF'} · onnx:{leerFlags().dlaOnnx ? 'ON' : 'OFF'}
              </dd>
            </div>
          </dl>
          {avisoMolde ? (
            <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-white/60" role="status">
              {avisoMolde}
            </p>
          ) : null}
          <label className="mt-2 block w-full cursor-pointer rounded-lg border border-brand-border px-3 py-2 text-center font-mono text-[10px] font-bold text-white/80 hover:border-brand-green">
            IMPORTAR MOLDE .JSON
            <input type="file" accept="application/json,.json" className="hidden" onChange={onImportarMolde} />
          </label>
          {molde ? (
            <button
              type="button"
              onClick={() => {
                desactivarMolde();
                setMolde(null);
                setAvisoMolde('MOLDE DESACTIVADO');
              }}
              className="mt-1.5 w-full rounded-lg border border-brand-border px-3 py-2 font-mono text-[10px] font-bold text-white/80 hover:border-brand-green"
            >
              DESACTIVAR MOLDE
            </button>
          ) : null}
        </div>
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
