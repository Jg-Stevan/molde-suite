'use client';

// F5 (PLAN-AGENTE-LAYOUT) — Tarjeta "MODELOS" del panel de diagnóstico:
//  · Estado del modelo S (gate por defecto, 4,9 MB): configurado/no según la
//    env NEXT_PUBLIC_DLA_MODELO_LAYOUT (configuracionLista de dla-onnx).
//  · Descarga OPCIONAL y explícita del modelo plus-L (129,7 MB) con progreso,
//    verificación SHA-256 contra MODELOS_LAYOUT y guardado en Cache Storage
//    (tamiz-modelos-v1). NUNCA se precachea desde el Service Worker.
//  · Almacenamiento del dispositivo: uso/cuota y botón de persistencia.
//
// NOTA HONESTA (fases): la INFERENCIA con plus-L llega después (el preset no
// existe aún en dla-onnx) — hoy el gate estructural corre con S.

import { useCallback, useEffect, useState } from 'react';
import { configuracionLista } from '@jg-stevan/dla-onnx/runtime';
import '@/lib/e14/dla/config';
import { MODELOS_LAYOUT } from '@jg-stevan/layout-core';
import {
  borrarPlusL,
  descargarPlusL,
  estadoPlusL,
  formatearMB,
  pedirPersistencia,
  persistenciaActiva,
  type ProgresoPlusL,
  usoAlmacenamiento,
} from '@/lib/e14/dla/plusl';

export function PanelModelos() {
  const s = MODELOS_LAYOUT.s;
  const plusL = MODELOS_LAYOUT.plusL;
  const sLista = configuracionLista('layout');

  const [plusLEnCache, setPlusLEnCache] = useState<{ presente: boolean; bytes: number | null }>({
    presente: false,
    bytes: null,
  });
  const [descargando, setDescargando] = useState(false);
  const [progreso, setProgreso] = useState<ProgresoPlusL | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [almacenamiento, setAlmacenamiento] = useState<{ uso: number; cuota: number } | null>(null);
  const [persistida, setPersistida] = useState<boolean>(false);

  const refrescar = useCallback(async () => {
    setPlusLEnCache(await estadoPlusL());
    setAlmacenamiento(await usoAlmacenamiento());
    setPersistida(await persistenciaActiva());
  }, []);

  useEffect(() => {
    void refrescar();
  }, [refrescar]);

  async function onDescargar() {
    setDescargando(true);
    setMensaje('Descargando…');
    setProgreso({ recibidos: 0, total: plusL.bytes, pct: 0 });
    const r = await descargarPlusL((p) => setProgreso(p));
    setDescargando(false);
    setProgreso(null);
    if (r.ok) {
      setMensaje(`Verificado (SHA-256 OK). Guardado en el dispositivo: ${formatearMB(r.bytes)}.`);
    } else {
      setMensaje(`ERROR: ${r.error}`);
    }
    void refrescar();
  }

  async function onBorrar() {
    await borrarPlusL();
    setMensaje('plus-L borrado del dispositivo.');
    void refrescar();
  }

  async function onPersistir() {
    const ok = await pedirPersistencia();
    setPersistida(ok);
    setMensaje(ok ? 'Almacenamiento persistente activado.' : 'El navegador denegó la persistencia.');
  }

  const pct = progreso?.pct ?? null;

  return (
    <div className="mt-3 rounded-lg border border-brand-border p-2.5">
      <p className="font-mono text-[10px] font-bold text-white/70">MODELOS (DLA)</p>

      {/* Modelo S — gate por defecto */}
      <dl className="mt-1.5 space-y-1 font-mono text-[10px] leading-relaxed">
        <div className="flex justify-between gap-2">
          <dt className="text-white/50">S</dt>
          <dd className="text-right">
            {formatearMB(s.bytes)} — gate por defecto ·{' '}
            <span className={sLista ? 'text-brand-green' : 'text-white/40'}>
              {sLista ? 'CONFIGURADO' : 'NO CONFIGURADO'}
            </span>
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-white/50">fuente S</dt>
          <dd className="max-w-[55%] truncate text-white/60">
            {sLista ? 'NEXT_PUBLIC_DLA_MODELO_LAYOUT' : 'define NEXT_PUBLIC_DLA_MODELO_LAYOUT'}
          </dd>
        </div>
      </dl>

      {/* plus-L — descarga opcional */}
      <div className="mt-2 border-t border-brand-border pt-2">
        <dl className="space-y-1 font-mono text-[10px] leading-relaxed">
          <div className="flex justify-between gap-2">
            <dt className="text-white/50">plus-L</dt>
            <dd className="text-right">
              {formatearMB(plusL.bytes)} — validación fina ·{' '}
              <span className={plusLEnCache.presente ? 'text-brand-green' : 'text-white/40'}>
                {plusLEnCache.presente ? 'EN EL DISPOSITIVO' : 'NO DESCARGADO'}
              </span>
            </dd>
          </div>
        </dl>

        {plusLEnCache.presente ? (
          <button
            type="button"
            onClick={onBorrar}
            className="mt-1.5 w-full rounded-lg border border-brand-border px-3 py-2 font-mono text-[10px] font-bold text-white/80 hover:border-brand-green"
          >
            BORRAR PLUS-L
          </button>
        ) : (
          <button
            type="button"
            onClick={onDescargar}
            disabled={descargando}
            className="mt-1.5 w-full rounded-lg border border-brand-border px-3 py-2 font-mono text-[10px] font-bold text-white/80 hover:border-brand-green disabled:opacity-40"
          >
            {descargando ? 'DESCARGANDO…' : `Descargar plus-L (${formatearMB(plusL.bytes)})`}
          </button>
        )}

        {descargando && progreso ? (
          <div className="mt-1.5">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label="Progreso de descarga de plus-L">
              <div
                className="h-full bg-brand-green transition-[width]"
                style={{ width: `${pct ?? 0}%` }}
              />
            </div>
            <p className="mt-1 font-mono text-[10px] text-white/60" role="status">
              {pct !== null ? `${pct}% — ` : ''}
              {formatearMB(progreso.recibidos)}
              {progreso.total ? ` de ${formatearMB(progreso.total)}` : ''}
            </p>
          </div>
        ) : null}

        <p className="mt-1.5 font-mono text-[9px] leading-relaxed text-white/40">
          La inferencia con plus-L llega en una fase posterior; hoy el gate usa S. El binario se
          verifica (SHA-256) antes de guardarse.
        </p>
      </div>

      {/* Almacenamiento del dispositivo */}
      <div className="mt-2 border-t border-brand-border pt-2">
        <dl className="space-y-1 font-mono text-[10px] leading-relaxed">
          <div className="flex justify-between gap-2">
            <dt className="text-white/50">almacenamiento</dt>
            <dd className="text-right text-white/60">
              {almacenamiento
                ? `${formatearMB(almacenamiento.uso)} de ${formatearMB(almacenamiento.cuota)}`
                : 'no disponible'}
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-white/50">persistente</dt>
            <dd className={persistida ? 'text-brand-green' : 'text-white/60'}>
              {persistida ? 'SÍ' : 'NO'}
            </dd>
          </div>
        </dl>
        {!persistida ? (
          <button
            type="button"
            onClick={onPersistir}
            className="mt-1.5 w-full rounded-lg border border-brand-border px-3 py-2 font-mono text-[10px] font-bold text-white/80 hover:border-brand-green"
          >
            ACTIVAR ALMACENAMIENTO PERSISTENTE
          </button>
        ) : null}
      </div>

      {mensaje ? (
        <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-white/70" role="status">
          {mensaje}
        </p>
      ) : null}
    </div>
  );
}
