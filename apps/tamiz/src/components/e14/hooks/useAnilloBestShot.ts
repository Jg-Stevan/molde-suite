'use client';

// Anillo best-shot: buffer circular de frames con su varianza laplaciana
// (nitidez). El disparo elige el mejor frame reciente (ZSL) en vez del frame
// del instante (evita la foto movida del pulso).

import { useCallback, useRef } from 'react';
import type { RefObject } from 'react';

interface Frame {
  canvas: HTMLCanvasElement;
  lapVar: number;
}

const CAPACIDAD = 8;
const ALIMENTAR_CADA_MS = 200;

/** Libera un canvas (best-effort; el GC hace el resto). */
export function liberarCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

export function useAnilloBestShot({ videoRef }: { videoRef: RefObject<HTMLVideoElement | null> }): {
  alimentarAnillo: () => void;
  liberarAnillo: () => void;
  instantanea: () => { canvas: HTMLCanvasElement; lapVar: number } | null;
  tomarZsl: () => { canvas: HTMLCanvasElement; lapVar: number } | null;
} {
  const anillo = useRef<Frame[]>([]);
  const ultimaAlimentacion = useRef(0);

  const medirLap = useCallback((canvas: HTMLCanvasElement): number => {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 0;
    const W = 120;
    const H = Math.max(1, Math.round((canvas.height / canvas.width) * W));
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
    return suma2 / n - media * media;
  }, []);

  const capturar = useCallback((): Frame | null => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) return null;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d', { willReadFrequently: true })!.drawImage(video, 0, 0);
    return { canvas, lapVar: medirLap(canvas) };
  }, [medirLap, videoRef]);

  const alimentarAnillo = useCallback(() => {
    const ahora = performance.now();
    if (ahora - ultimaAlimentacion.current < ALIMENTAR_CADA_MS) return;
    ultimaAlimentacion.current = ahora;
    const frame = capturar();
    if (!frame) return;
    anillo.current.push(frame);
    if (anillo.current.length > CAPACIDAD) {
      const [viejo] = anillo.current.splice(0, 1);
      liberarCanvas(viejo.canvas);
    }
  }, [capturar]);

  const liberarAnillo = useCallback(() => {
    for (const f of anillo.current) liberarCanvas(f.canvas);
    anillo.current = [];
  }, []);

  const mejor = useCallback((): Frame | null => {
    if (!anillo.current.length) return null;
    return anillo.current.reduce((mejor, f) => (f.lapVar > mejor.lapVar ? f : mejor), anillo.current[0]);
  }, []);

  const instantanea = useCallback(() => capturar(), [capturar]);

  const tomarZsl = useCallback(() => mejor(), [mejor]);

  return { alimentarAnillo, liberarAnillo, instantanea, tomarZsl };
}
