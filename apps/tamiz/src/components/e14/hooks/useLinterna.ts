'use client';

// Linterna (torch) del track de cámara + flash por pantalla (destello) como
// fallback en dispositivos sin torch.

import { useCallback, useRef, useState } from 'react';
import type { RefObject } from 'react';

export function useLinterna({
  streamRef,
  camEstado,
  mostrarAviso,
}: {
  streamRef: RefObject<MediaStream | null>;
  camEstado: string;
  mostrarAviso: (texto: string, tono: 'crit' | 'warn', ms?: number) => void;
}): {
  flashRef: RefObject<boolean>;
  torchOnRef: RefObject<boolean>;
  torchOn: boolean;
  torchDisponible: boolean;
  aplicarLinternaGuardada: () => void;
  alternarLinterna: () => void | Promise<void>;
  setTorchDisponible: (v: boolean) => void;
} {
  const [torchOn, setTorchOn] = useState(false);
  const [torchDisponible, setTorchDisponible] = useState(false);
  const torchOnRef = useRef(false);
  const flashRef = useRef(false);

  const aplicar = useCallback(async (encender: boolean) => {
    const pista = streamRef.current?.getVideoTracks()[0];
    if (!pista) return;
    const caps = pista.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean };
    if (!caps?.torch) {
      setTorchDisponible(false);
      mostrarAviso('ESTE DISPOSITIVO NO TIENE LINTERNA', 'warn');
      return;
    }
    try {
      await pista.applyConstraints({ advanced: [{ torch: encender } as MediaTrackConstraintSet] });
      torchOnRef.current = encender;
      setTorchOn(encender);
    } catch {
      mostrarAviso('NO SE PUDO ENCENDER LA LINTERNA', 'warn');
    }
  }, [mostrarAviso, streamRef]);

  const alternarLinterna = useCallback(() => {
    if (camEstado !== 'viva') return;
    void aplicar(!torchOnRef.current);
  }, [aplicar, camEstado]);

  const aplicarLinternaGuardada = useCallback(() => {
    if (torchOnRef.current) void aplicar(true);
  }, [aplicar]);

  return {
    flashRef,
    torchOnRef,
    torchOn,
    torchDisponible,
    aplicarLinternaGuardada,
    alternarLinterna,
    setTorchDisponible,
  };
}
