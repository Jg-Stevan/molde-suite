'use client';

// Sesión de cámara: getUserMedia con reintentos, loop de frames que alimenta
// el anillo best-shot y calcula la calidad viva (score 0..1 + esquinas
// aproximadas para el overlay). Toma de foto con degradación honesta si el
// navegador rompe ImageCapture/takePhoto.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import type { SensorProfile } from '@/lib/e14/core/sensor-profiler';
import {
  clampBlobToSafeCap,
  getSensorSafeCap,
  profileActiveSensor,
} from '@/lib/e14/core/sensor-profiler';
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

/* ── Constantes de cámara (upstream useSesionCamara — DUAL PIPELINE D7) ──── */

// FIX v6 6.1 del lab — Safari moderno expone ImageCapture pero takePhoto()
// se cuelga: el régimen se decide por UA Android, no por typeof ImageCapture.
const IS_ANDROID = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);
/** takePhoto() fiable SOLO en Android (Chrome). */
const CAN_TAKEPHOTO = IS_ANDROID && typeof ImageCapture !== 'undefined';

// LOTE 5 (F5-A) — escalera rápida de photoSettings: el takePhoto DESNUDO
// tarda ~15 s (ISP full-res); 2048×1536 tarda ~1.0 s. El desnudo queda como
// ÚLTIMO recurso (con carrera de 8 s).
const FOTO_LADDER: Array<{ imageWidth: number; imageHeight: number }> = [
  { imageWidth: 2048, imageHeight: 1536 },
  { imageWidth: 1280, imageHeight: 960 },
];

// LOTE 5.5 — «calidad primero»: SOLO equipos con 8+ GB pagan la espera del
// desnudo full-res. Se lee en cada captura, NUNCA en render.
function esCalidadPrimero(): boolean {
  try {
    const dm = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    return CAN_TAKEPHOTO && dm === 8;
  } catch {
    return false;
  }
}

/** takePhoto puede colgarse (lab error #29): carrera de 8 s SOLO para el
 *  último peldaño (el desnudo); los intermedios fallan rápido. */
const TAKEPHOTO_TIMEOUT_MS = 8000;

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
  tomarFoto: (onUpgrade?: (upgrade: Promise<Blob>) => void) => Promise<Blob | null>;
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
  const puedeTomarFotoRef = useRef(CAN_TAKEPHOTO);
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
        cooldownRef.current <= Date.now()
      ) {
        setAutoArmado(false);
        void capturarRef.current?.();
      }
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [alimentarAnillo, capturarRef, cooldownRef, config.autoRef, procesandoRef, setAutoArmado, setLive, videoRef]);

  // ---- toma de foto (D7 — DUAL PIPELINE upstream: escalera FOTO_LADDER +
  // carrera 8 s + lista negra + upgrade LOTE 5.4. NADA de pantallazo del
  // <video> como "foto del sensor": el frame del visor queda SOLO como
  // último recurso del dispatch de ScanView) ----
  const tomarFoto = useCallback(
    async (onUpgrade?: (upgrade: Promise<Blob>) => void): Promise<Blob | null> => {
      if (!CAN_TAKEPHOTO) return null; // FIX v6 6.1 del lab — Android only
      const track = streamRef.current?.getVideoTracks()[0];
      if (!track) return null;
      try {
        const capture = new ImageCapture(track);
        const profile = sensorProfileRef.current;
        // LOTE 5.5 — calidad primero (deviceMemory 8+): el desnudo de primero.
        const qualityFirst = esCalidadPrimero();
        const settings = qualityFirst ? undefined : FOTO_LADDER[0];
        let winnerSettings: { imageWidth: number; imageHeight: number } | undefined =
          settings;
        const attempt = async (
          ps?: { imageWidth: number; imageHeight: number },
          conCarrera?: boolean,
        ): Promise<Blob | null> => {
          try {
            const photoPromise = capture.takePhoto(ps as PhotoSettings);
            if (!conCarrera) {
              const b = await photoPromise;
              return b && b.size > 0 ? b : null;
            }
            const blob = await Promise.race([
              photoPromise,
              new Promise<never>((_, reject) =>
                window.setTimeout(
                  () => reject(new Error('takePhoto timeout 8s')),
                  TAKEPHOTO_TIMEOUT_MS,
                ),
              ),
            ]);
            return blob && blob.size > 0 ? blob : null;
          } catch {
            return null;
          }
        };
        let blob = await attempt(settings, settings === undefined);
        const escalera: Array<{ imageWidth: number; imageHeight: number } | undefined> =
          qualityFirst ? [...FOTO_LADDER] : [...FOTO_LADDER.slice(1), undefined];
        for (const ps of escalera) {
          if (blob) break;
          winnerSettings = ps;
          blob = await attempt(ps, ps === undefined);
        }
        // FIX v4 4.1 — lista negra temporal: respondió → rehabilitar.
        if (blob) takePhotoBrokenRef.current = false;
        else takePhotoBrokenRef.current = true;
        if (!blob) return null;
        // LOTE 5.4 (F5.4-A) — upgrade solo si lo que ganó fue un PELDAÑO.
        // Fire-and-forget: la promesa NUNCA se espera aquí (~15 s del desnudo).
        if (winnerSettings !== undefined && onUpgrade) {
          try {
            onUpgrade(capture.takePhoto(undefined));
          } catch {
            /* throw sincrónico raro del sensor: nunca rompe la captura */
          }
        }
        // Capa 2 — red de seguridad post-decode (solo recorta si excede el tope).
        return await clampBlobToSafeCap(blob, profile?.safeCapPx ?? getSensorSafeCap());
      } catch {
        // takePhoto es un camino, no el único: null → el flujo cae al frame del visor
        return null;
      }
    },
    [streamRef, sensorProfileRef, takePhotoBrokenRef],
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
