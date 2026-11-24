'use client';

// Selector de fuente: IMPORTAR (file picker) y FOTO DE CÁMARA (input capture)
// con reintentos de sesión cuando el navegador la bloquea.

import { useCallback, useState, type ChangeEvent, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { FuenteCaptura } from '@/lib/e14/fachada';
import { TEXTO_MOTIVO } from '@/lib/e14/errores';

export function useSelectorFuente({
  procesandoRef,
  mostrarAviso,
  archivoDentroDeTope,
  setArchivoPendiente,
  setFuente,
  dispararEscaneo,
  despacharArchivo,
}: {
  procesandoRef: RefObject<boolean>;
  mostrarAviso: (texto: string, tono: 'crit' | 'warn', ms?: number) => void;
  archivoDentroDeTope: (archivo: File, robusto: boolean) => Promise<File | null>;
  setArchivoPendiente: (f: File | null) => void;
  setFuente: (f: FuenteCaptura) => void;
  dispararEscaneo: () => Promise<void>;
  despacharArchivo: (blob: Blob, desdeCamara: boolean) => void;
}): {
  reintentoCamara: number;
  setReintentoCamara: Dispatch<SetStateAction<number>>;
  alElegirArchivo: (e: ChangeEvent<HTMLInputElement>) => void;
  alElegirFotoCamara: (e: ChangeEvent<HTMLInputElement>) => void;
} {
  const [reintentoCamara, setReintentoCamara] = useState(0);

  const alElegir = useCallback(
    async (e: ChangeEvent<HTMLInputElement>, desdeCamara: boolean) => {
      const archivo = e.target.files?.[0];
      e.target.value = '';
      if (!archivo) return;
      if (!archivo.type.startsWith('image/')) {
        mostrarAviso(TEXTO_MOTIVO.ARCHIVO_INVALIDO, 'crit');
        return;
      }
      if (procesandoRef.current) return;
      if (desdeCamara) {
        // Foto de cámara (input capture): misma vía que el obturador
        // (despacharArchivo aplica el tope por dentro — upstream).
        setFuente('CAMARA');
        despacharArchivo(archivo, true);
        return;
      }
      // IMPORTAR: tope por gama con la capa del destello (decode único +
      // re-escalado fuera del hilo). null = HEIC/fallo → aviso clasificado.
      let final: File | null = null;
      try {
        final = await archivoDentroDeTope(archivo, true);
      } catch (e) {
        void e; // ErrorRescateHeic: el catch del store ya lo clasifica
        final = null;
      }
      if (!final) {
        mostrarAviso('ARCHIVO FUERA DE TOPE — IMPORTA UNA FOTO JPEG MENOR A 12 MP', 'warn');
        return;
      }
      setFuente('ARCHIVO');
      setArchivoPendiente(final);
      void dispararEscaneo();
    },
    [
      archivoDentroDeTope,
      despacharArchivo,
      dispararEscaneo,
      mostrarAviso,
      procesandoRef,
      setArchivoPendiente,
      setFuente,
    ],
  );

  const alElegirArchivo = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => alElegir(e, false),
    [alElegir],
  );
  const alElegirFotoCamara = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => alElegir(e, true),
    [alElegir],
  );

  return { reintentoCamara, setReintentoCamara, alElegirArchivo, alElegirFotoCamara };
}
