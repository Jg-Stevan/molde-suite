'use client';

// Destello: dispara el escaneo desde un canvas (blob) y gestiona la mejora
// silenciosa con la foto full-res cuando aterriza.

import { useCallback, useRef } from 'react';
import type { RefObject } from 'react';
import type { Acta } from '@/lib/e14/fachada';
import type { SensorProfile } from '@/lib/e14/core/sensor-profiler';
import { archivoDentroDeTope } from '@/lib/e14/core/sensor-profiler';

export function useDestello({
  sensorProfileRef,
  procesandoRef,
  setProcesando,
  setArchivoPendiente,
  dispararEscaneo,
  mostrarAviso,
  mejorarFotoActa,
}: {
  sensorProfileRef: RefObject<SensorProfile | null>;
  procesandoRef: RefObject<boolean>;
  setProcesando: (v: boolean) => void;
  setArchivoPendiente: (f: File | null) => void;
  dispararEscaneo: () => Promise<void>;
  mostrarAviso: (texto: string, tono: 'crit' | 'warn', ms?: number) => void;
  mejorarFotoActa: (fotoNueva: string, objetivo: Acta) => Promise<void>;
}): {
  canvasABlob: (canvas: HTMLCanvasElement) => Promise<Blob | null>;
  archivoDentroDeTope: (archivo: File) => { ok: boolean; razon?: string };
  despacharArchivo: (blob: Blob, desdeCamara: boolean) => void;
  mejorarSilenciosa: (upgrade: { dataUrl: string; acta: Acta }) => void;
} {
  const upgradeRef = useRef<{ dataUrl: string; acta: Acta } | null>(null);

  const canvasABlob = useCallback(async (canvas: HTMLCanvasElement): Promise<Blob | null> => {
    return new Promise((res) => canvas.toBlob((b) => res(b), 'image/jpeg', 0.92));
  }, []);

  const dentroDeTope = useCallback(
    (archivo: File) => archivoDentroDeTope(archivo, sensorProfileRef.current),
    [sensorProfileRef],
  );

  const despacharArchivo = useCallback(
    (blob: Blob, desdeCamara: boolean) => {
      if (procesandoRef.current) return;
      const archivo = new File([blob], desdeCamara ? `captura-${Date.now()}.jpg` : `foto-${Date.now()}.jpg`, {
        type: 'image/jpeg',
      });
      const control = dentroDeTope(archivo);
      if (!control.ok) {
        mostrarAviso((control.razon ?? 'ARCHIVO FUERA DE TOPE').toUpperCase(), 'warn');
        return;
      }
      setArchivoPendiente(archivo);
      setProcesando(true);
      void dispararEscaneo().finally(() => setProcesando(false));
    },
    [dentroDeTope, dispararEscaneo, mostrarAviso, procesandoRef, setArchivoPendiente, setProcesando],
  );

  const mejorarSilenciosa = useCallback(
    (upgrade: { dataUrl: string; acta: Acta }) => {
      upgradeRef.current = upgrade;
      void mejorarFotoActa(upgrade.dataUrl, upgrade.acta).then(() => {
        upgradeRef.current = null;
      });
    },
    [mejorarFotoActa],
  );

  return {
    canvasABlob,
    archivoDentroDeTope: dentroDeTope,
    despacharArchivo,
    mejorarSilenciosa,
  };
}
