'use client';

// Visor con zoom (pinza 1×–6×, pan con clamps, doble toque 2.5×, rueda) en
// dos modos: tarjeta (abre el fullscreen) y fullscreen (cierra con tap fuera).

import { useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';

interface PropsCard {
  mode: 'card';
  src: string;
  alt: string;
  onOpenFullscreen: () => void;
}

interface PropsFull {
  mode?: undefined;
  src: string;
  alt: string;
  compareSrc?: string;
  onClose: () => void;
}

export function ZoomableVisor(props: PropsCard | PropsFull) {
  const [escala, setEscala] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [comparando, setComparando] = useState(false);
  const gestos = useRef<{ d0: number; esc0: number; x0: number; y0: number; ox0: number; oy0: number; activo: boolean }>({
    d0: 0,
    esc0: 1,
    x0: 0,
    y0: 0,
    ox0: 0,
    oy0: 0,
    activo: false,
  });

  const clamp = (v: number) => Math.min(1, Math.max(-1, v));

  const onTouchStart = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') {
      if (gestos.current.activo) return; // ya hay un dedo: espera el segundo
      gestos.current = { ...gestos.current, x0: e.clientX, y0: e.clientY, ox0: offset.x, oy0: offset.y, activo: true };
      return;
    }
    gestos.current = { ...gestos.current, x0: e.clientX, y0: e.clientY, ox0: offset.x, oy0: offset.y, activo: true };
  };

  const onTouchMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!gestos.current.activo) return;
    const dx = (e.clientX - gestos.current.x0) / Math.max(1, e.currentTarget.clientWidth);
    const dy = (e.clientY - gestos.current.y0) / Math.max(1, e.currentTarget.clientHeight);
    setOffset({ x: clamp(gestos.current.ox0 + dx * escala), y: clamp(gestos.current.oy0 + dy * escala) });
  };

  const onTouchEnd = () => {
    gestos.current.activo = false;
  };

  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setEscala((s) => Math.min(6, Math.max(1, s * factor)));
  };

  const dobleToque = () => setEscala((s) => (s > 1 ? 1 : 2.5));

  if (props.mode === 'card') {
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={`Ampliar ${props.alt}`}
        className="relative overflow-hidden rounded-lg border border-brand-border bg-black/40"
        onClick={props.onOpenFullscreen}
        onKeyDown={(e) => {
          if (e.key === 'Enter') props.onOpenFullscreen();
        }}
      >
        <img src={props.src} alt={props.alt} className="block max-h-full w-full object-contain" draggable={false} />
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex touch-none items-center justify-center bg-black/90"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
      onWheel={onWheel}
    >
      <div
        className="relative max-h-[90vh] max-w-[94vw] overflow-hidden"
        onPointerDown={onTouchStart}
        onPointerMove={onTouchMove}
        onPointerUp={onTouchEnd}
        onPointerCancel={onTouchEnd}
        onDoubleClick={dobleToque}
      >
        <img
          src={comparando && props.compareSrc ? props.compareSrc : props.src}
          alt={props.alt}
          className="block max-h-[86vh] max-w-[94vw] select-none object-contain"
          style={{
            transform: `scale(${escala}) translate(${offset.x * 100}%, ${offset.y * 100}%)`,
            transition: 'transform 120ms ease-out',
          }}
          draggable={false}
        />
        {props.compareSrc ? (
          <button
            type="button"
            aria-pressed={comparando}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setComparando((v) => !v);
            }}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-white/15 px-3 py-1 font-mono text-[10px] font-bold text-white backdrop-blur"
          >
            {comparando ? 'ORIGINAL' : 'PROCESADA'} · F-COMPARE
          </button>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Cerrar visor"
        onClick={props.onClose}
        className="absolute right-4 top-4 rounded-full bg-white/15 px-3 py-1.5 font-mono text-xs font-bold text-white"
      >
        ESC
      </button>
    </div>
  );
}
