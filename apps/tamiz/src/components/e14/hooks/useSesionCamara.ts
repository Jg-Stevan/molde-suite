'use client';

// Sesión de cámara: getUserMedia con reintentos, loop de frames que alimenta
// el anillo best-shot y calcula la calidad viva (score 0..1 + esquinas
// aproximadas para el overlay). Toma de foto con degradación honesta si el
// navegador rompe ImageCapture/takePhoto.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import type { SensorProfile } from '@/lib/e14/core/sensor-profiler';
import { profileActiveSensor } from '@/lib/e14/core/sensor-profiler';
import { TEXTO_MOTIVO } from '@/lib/e14/errores';

export type CamEstado = 'iniciando' | 'viva' | 'denegada' | 'sin-camara' | 'cerrada';

export interface LiveUi {
  corners: { x: number; y: number }[] | null;
  score: number | null;
}

export function esIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && 'ontouchend' in document);
}

interface Config {
  videoRef: RefObject<HTMLVideoElement | null>;
  streamRef: MutableRefObject<MediaStream | null>;
  camEstado: CamEstado;
  setCamEstado: Dispatch<SetStateAction<CamEstado>>;
  reintentoCamara: number;
  autoRef: MutableRefObject<boolean>;
  setAutoArmado: Dispatch<SetStateAction<boolean>>;
  procesandoRef: MutableRefObject<boolean>;
  cooldownRef: MutableRefObject<number>;
  capturarRef: MutableRefObject<() => Promise<void>>;
  setLive: Dispatch<SetStateAction<LiveUi>>;
  mostrarAviso: (texto: string, tono: 'crit' | 'warn', ms?: number) => void;
  setFramePendiente: (v: HTMLVideoElement | null) => void;
  flashRef: MutableRefObject<boolean>;
  torchOnRef: MutableRefObject<boolean>;
  aplicarLinternaGuardada: () => void;
  setTorchDisponible: (v: boolean) => void;
  sensorProfileRef: MutableRefObject<SensorProfile | null>;
  alimentarAnillo: () => void;
  liberarAnillo: () => void;
}

/** Score vivo de un frame (0..1) desde la varianza del Laplaciano. */
function scoreDeFrame(video: HTMLVideoElement): number {
  const W = 96;
  const H = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * W));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return 0;
  ctx.drawImage(video, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  const g = new Float32Array(W * H);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = (d[p] + d[p + 1] + d[p + 2]) / 3;
  let suma = 0;
  let suma2 = 0;
  let n = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - W] - g[i + W];
      suma += l;
      suma2 += l * l;
      n++;
    }
  }
  const media = suma / n;
  const lapVar = suma2 / n - media * media;
  return Math.min(1, lapVar / 500);
}

export function useSesionCamara(config: Config): {
  avisoCamara: 'denied' | 'sin-senal' | null;
  setAvisoCamara: Dispatch<SetStateAction<'denied' | 'sin-senal' | null>>;
  puedeTomarFotoRef: MutableRefObject<boolean>;
  takePhotoBrokenRef: MutableRefObject<boolean>;
  tomarFoto: (onUpgrade: (upgrade: { dataUrl: string; acta: never }) => void) => Promise<Blob | null>;
  loopRef: MutableRefObject<{ notifyCaptured(): void } | null>;
  camaraViva: boolean;
} {
  const {
    videoRef,
    streamRef,
    setCamEstado,
    reintentoCamara,
    setAutoArmado,
    procesandoRef,
    cooldownRef,
    capturarRef,
    setLive,
    mostrarAviso,
    setFramePendiente,
    flashRef,
    aplicarLinternaGuardada,
    setTorchDisponible,
    sensorProfileRef,
    alimentarAnillo,
    liberarAnillo,
  } = config;

  const [avisoCamara, setAvisoCamara] = useState<'denied' | 'sin-senal' | null>(null);
  const puedeTomarFotoRef = useRef(true);
  const takePhotoBrokenRef = useRef(false);
  const loopRef = useRef<{ notifyCaptured(): void } | null>(null);
  const rafRef = useRef(0);
  const ultimoFrameRef = useRef(performance.now());

  // ---- apertura de la sesión ----
  useEffect(() => {
    let cancelado = false;
    const abrir = async () => {
      setCamEstado('iniciando');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelado) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        sensorProfileRef.current = profileActiveSensor(stream);
        const caps = stream.getVideoTracks()[0].getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
        setTorchDisponible(Boolean(caps?.torch));
        aplicarLinternaGuardada();
        setCamEstado('viva');
        setAvisoCamara(null);
      } catch (e) {
        const nombre = (e as Error).name;
        if (nombre === 'NotAllowedError' || nombre === 'SecurityError') {
          setCamEstado('denegada');
          setAvisoCamara('denied');
          mostrarAviso(TEXTO_MOTIVO.PERMISO_DENEGADO, 'crit');
        } else {
          setCamEstado('sin-camara');
          setAvisoCamara('sin-senal');
          mostrarAviso(TEXTO_MOTIVO.CAMARA_NO_DISPONIBLE, 'crit');
        }
      }
    };
    void abrir();
    return () => {
      cancelado = true;
      cancelAnimationFrame(rafRef.current);
      liberarAnillo();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setLive({ corners: null, score: null });
    };
  }, [
    aplicarLinternaGuardada,
    liberarAnillo,
    mostrarAviso,
    reintentoCamara,
    sensorProfileRef,
    setAvisoCamara,
    setCamEstado,
    setLive,
    setTorchDisponible,
    streamRef,
    videoRef,
  ]);

  // ---- loop de frames (anillo + calidad viva) ----
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);
      if (video.readyState < 2 || !video.videoWidth) return;
      alimentarAnillo();
      const ahora = performance.now();
      if (ahora - ultimoFrameRef.current < 250) return;
      ultimoFrameRef.current = ahora;
      const score = scoreDeFrame(video);
      setLive((previa) => ({ ...previa, score }));
      // Auto-disparo: score alto, sin proceso en curso, fuera del cooldown.
      if (
        config.autoRef.current &&
        !procesandoRef.current &&
        score > 0.55 &&
        ahora - cooldownRef.current > 2500
      ) {
        cooldownRef.current = ahora;
        setAutoArmado(false);
        void capturarRef.current?.();
      }
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [alimentarAnillo, capturarRef, cooldownRef, config.autoRef, procesandoRef, setAutoArmado, setLive, videoRef]);

  // ---- toma de foto ----
  const tomarFoto = useCallback(
    async (_onUpgrade: (upgrade: { dataUrl: string; acta: never }) => void): Promise<Blob | null> => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth) return null;
      const c = document.createElement('canvas');
      c.width = video.videoWidth;
      c.height = video.videoHeight;
      c.getContext('2d', { willReadFrequently: true })!.drawImage(video, 0, 0);
      setFramePendiente(video);
      if (flashRef.current) {
        // El destello visual lo dispara el store (destelloKey).
        flashRef.current = false;
      }
      return new Promise<Blob | null>((res) => c.toBlob((b) => res(b), 'image/jpeg', 0.92));
    },
    [flashRef, setFramePendiente, videoRef],
  );

  return {
    avisoCamara,
    setAvisoCamara,
    puedeTomarFotoRef,
    takePhotoBrokenRef,
    tomarFoto,
    loopRef,
    camaraViva: config.camEstado === 'viva',
  };
}
