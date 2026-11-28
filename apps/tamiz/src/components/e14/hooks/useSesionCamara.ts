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
import { leerFlags } from '@/lib/e14/flags';
import { abrirCamaraTrasera } from '@/lib/e14/core/camara-principal';
import { alcanzaMinimo, MINIMO_LADO_CAPTURA, planRefuerzo } from '@/lib/e14/core/captura-refuerzo';
// P2-D (tarea D): TIPO del bucle del core — la clase se importa DINÁMICAMENTE
// solo con el flag ON (import type no viaja al bundle; con el flag OFF ni
// siquiera se carga el módulo: mismo grafo que hoy).
import type { CameraFrameLoop } from '@/lib/e14/core/frame-loop';
import { logger } from '@/lib/logger';

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

// Contrato de captura (captura-refuerzo.ts): espera máxima a que el track
// entregue el peldaño de 2048 tras applyConstraints; si no llega al piso de
// 1600 se devuelve null y el flujo sigue con el respaldo de siempre.
const REFUERZO_ESPERA_MS = 1200;

function dibujarFrame(video: HTMLVideoElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d')!.drawImage(video, 0, 0);
  return canvas;
}

async function esperarLadoMinimo(video: HTMLVideoElement, minimo: number, timeoutMs: number): Promise<boolean> {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    if (video.videoWidth && Math.max(video.videoWidth, video.videoHeight) >= minimo) return true;
    await new Promise((r) => setTimeout(r, 40));
  }
  return Math.max(video.videoWidth, video.videoHeight) >= minimo;
}

/** Refuerzo de captura cuando takePhoto no entrega el original: sube el track
 *  temporalmente a 2048 y toma un frame, restaurando el preview de 720. Si el
 *  equipo rechaza o ignora el cambio se devuelve null (respaldo habitual). */
export async function capturarAlRefuerzo(
  video: HTMLVideoElement | null,
  stream: MediaStream | null,
): Promise<HTMLCanvasElement | null> {
  if (!video || !stream || video.readyState < 2 || !video.videoWidth) return null;
  const track = stream.getVideoTracks()[0];
  if (!track) return null;
  const plan = planRefuerzo(video.videoWidth, video.videoHeight);
  if (!plan) return alcanzaMinimo(video.videoWidth, video.videoHeight) ? dibujarFrame(video) : null;
  let aplicado = false;
  try {
    await track.applyConstraints(plan);
    aplicado = true;
    if (!(await esperarLadoMinimo(video, MINIMO_LADO_CAPTURA, REFUERZO_ESPERA_MS))) return null;
    // Un frame con la nueva resolución ya dibujado antes de leerlo.
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    return dibujarFrame(video);
  } catch {
    return null;
  } finally {
    if (aplicado) {
      void track
        .applyConstraints({ width: { ideal: 1280 }, height: { ideal: 720 } })
        .catch(() => undefined);
    }
  }
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
        // F-LENS v5 (digielect14): sondas secuenciales + elección de la
        // trasera PRINCIPAL (caché + facing/AF/resolución). El
        // `facingMode:'environment'` blando negociaba la gran angular del A56
        // (foco fijo, sin linterna). La cascada interna del port ya incluye el
        // constraint legacy como respaldo, así que aquí no hay segundo camino.
        const eleccion = await abrirCamaraTrasera(navigator.mediaDevices, () => cancelado);
        if (cancelado) {
          eleccion.stream?.getTracks().forEach((t) => t.stop());
          return;
        }
        if (eleccion.permisoDenegado) {
          setCamEstado('denegada');
          setAvisoCamara('denied');
          mostrarAviso(TEXTO_MOTIVO.PERMISO_DENEGADO, 'crit');
          return;
        }
        const stream = eleccion.stream;
        if (!stream) {
          setCamEstado('sin-camara');
          setAvisoCamara('sin-senal');
          mostrarAviso(TEXTO_MOTIVO.CAMARA_NO_DISPONIBLE, 'crit');
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
  // P2-D (tarea D — plan agente externo): con el flag `frameLoop`
  // (tamiz.flags.v1, DEFAULT OFF) el bucle lo lleva CameraFrameLoop del core
  // (rVFC + detección OpenCV en worker + disparo k-de-n + compuerta de
  // quietud MotionStabilizer) y live.corners queda cableado al overlay del
  // quad. Con el flag OFF el camino es el rAF propio de 250 ms, EXACTO al
  // anterior. Defensa: cualquier fallo del bucle nuevo (worker de OpenCV sin
  // ready, callback roto, bucle estancado sin frames) CAE al rAF propio —
  // jamás rompe la captura. En SIMULACIÓN no hay <video>: el guard de
  // videoRef del onTrigger deja la auto-captura sim intacta (simularImagen →
  // dispararEscaneo, su propio camino).
  // El flag `frameLoop` está ON por defecto (funcionamiento de digielect14:
  // marcas en vivo + disparo k-de-n). Kill-switch del operador sin redeploy:
  // localStorage `tamiz.flags.v1` = {"frameLoop":false} → este rAF propio.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let detenido = false;
    let cayoARaf = false;
    let vigia: number | null = null;
    let core: CameraFrameLoop | null = null;
    let framesRecibidos = 0;
    let ultimoFrameCoreMs = 0;
    const arranqueCoreMs = performance.now();

    // Camino legacy (flag OFF y red de seguridad del flag ON).
    const iniciarRafPropio = () => {
      if (detenido) return;
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
    };

    const caerARafPropio = (motivo: string) => {
      if (cayoARaf || detenido) return;
      cayoARaf = true;
      if (vigia !== null) {
        window.clearInterval(vigia);
        vigia = null;
      }
      core?.stop();
      core = null;
      loopRef.current = null;
      delete (window as unknown as { __frameLoop?: unknown }).__frameLoop;
      logger.warn('frame-loop del core caído → rAF propio de 250 ms', { motivo });
      iniciarRafPropio();
    };

    if (leerFlags().frameLoop) {
      void (async () => {
        try {
          const { CameraFrameLoop: CamaraFrameLoop } = await import(
            '@/lib/e14/core/frame-loop'
          );
          if (detenido) return; // el desmonte ganó la carrera del import
          const bucle = new CamaraFrameLoop();
          core = bucle;
          bucle.start(video, {
            onFrame: (t) => {
              try {
                framesRecibidos += 1;
                ultimoFrameCoreMs = performance.now();
                // El anillo tiene su propio throttle (200 ms) — mismo
                // contrato de cadencia que con el rAF propio.
                alimentarAnillo();
                // live.corners cableado: el quad del overlay y el chip
                // DOCUMENTO DETECTADO ya lo consumen en ScanView (mapearPunto).
                setLive({ corners: t.corners, score: t.score ? t.score.total : null });
                // HUD de QA (paridad con el upstream): cadencia del bucle,
                // precisión del worker y quad vivo sin cable.
                (window as unknown as { __frameLoop?: unknown }).__frameLoop = {
                  fps: t.fps,
                  dropped: t.dropped,
                  processed: t.processed,
                  precision: t.precision,
                  corners: t.corners,
                  score: t.score ? t.score.total : null,
                };
              } catch (e) {
                caerARafPropio(`onFrame: ${(e as Error).message}`);
              }
            },
            onTrigger: () => {
              try {
                // Mismos candados del auto-disparo legacy (el k-de-n del core
                // ya garantiza el score alto y su propio cooldown; el
                // cooldownRef externo lo puso capturarInteligente).
                if (!config.autoRef.current || procesandoRef.current) return;
                // Fuente en SIMULACIÓN/ARCHIVO → el <video> está desmontado:
                // sin visor vivo no hay disparo automático.
                if (!videoRef.current) return;
                if (cooldownRef.current > Date.now()) return;
                setAutoArmado(false);
                void capturarRef.current?.();
              } catch (e) {
                caerARafPropio(`onTrigger: ${(e as Error).message}`);
              }
            },
            onNoDetectTimeout: () => {
              try {
                // Escape a manual del core (tope MAX_NO_DETECT_NOTICES=2 del
                // propio bucle) — franja del visor, mismo canal de avisos.
                mostrarAviso('NO DETECTO EL ACTA — ACÉRCALA AL ENCUADRE.', 'warn', 4000);
              } catch (e) {
                caerARafPropio(`onNoDetectTimeout: ${(e as Error).message}`);
              }
            },
          });
          // Paridad con capturarInteligente (ScanView llama notifyCaptured
          // tras cada captura → rearme del k-de-n).
          loopRef.current = bucle;
          // Watchdog defensivo: el bucle nuevo se detiene SOLO si el worker
          // de OpenCV no queda ready (waitReady=false → stop) y puede quedar
          // estancado si el worker se cuelga. En ambos casos el rAF propio
          // retoma el anillo + score + auto-disparo sin perder un golpe.
          vigia = window.setInterval(() => {
            if (detenido) return;
            if (!core || !core.isRunning) {
              caerARafPropio('bucle del core detenido (worker de OpenCV sin ready)');
              return;
            }
            // La cámara aún no produce frames: el rAF propio tampoco podría
            // alimentar nada — no castiga al bucle nuevo por eso.
            if (video.readyState < 2 || !video.videoWidth) return;
            if (framesRecibidos === 0) {
              // Arranque en frío: margen mayor al timeout de arranque del
              // worker (25 s, READY_TIMEOUT_MS) — pasado ese límite el bucle
              // se detiene solo y el caso de arriba hace la caída.
              if (performance.now() - arranqueCoreMs > 26_000) {
                caerARafPropio('sin frames del core tras 26 s con cámara viva');
              }
              return;
            }
            // Bucle caliente estancado (worker colgado, frames que dejan de
            // fluir): el peor caso del throttle del core es ~300 ms entre
            // frames — 3 s es red para sobra.
            if (performance.now() - ultimoFrameCoreMs > 3_000) {
              caerARafPropio('bucle del core estancado sin frames (>3 s)');
            }
          }, 1000);
        } catch (e) {
          caerARafPropio(`arranque: ${(e as Error).message}`);
        }
      })();
    } else {
      iniciarRafPropio();
    }

    return () => {
      detenido = true;
      if (vigia !== null) window.clearInterval(vigia);
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      core?.stop();
      loopRef.current = null;
    };
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
