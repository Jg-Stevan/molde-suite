'use client';

/* ============================================================
   FitScale — P5 del plan PLAN-AJUSTES-VISUALES (adaptado a E-14)
   Escala su contenido con transform:scale para que quepa COMPLETO
   dentro de su contenedor (fit-contain), sin recortes ni scroll.
   En REVISIÓN es lo que hace que la FOTO DEL DOCUMENTO sea el
   único elemento que cambia de tamaño según el dispositivo: las
   secciones fijas no se mueven y la foto se re-escala sola.
   ============================================================ */

import { useEffect, useRef, useState, type ReactNode } from 'react';

export function FitScale({
  children,
  className,
  maxScale = 1,
}: {
  children: ReactNode;
  className?: string;
  maxScale?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const wrap = wrapRef.current;
    const inner = innerRef.current;
    if (!wrap || !inner) return;
    let raf = 0;
    const compute = () => {
      const iw = inner.offsetWidth;
      const ih = inner.offsetHeight;
      if (!iw || !ih) return;
      const k = Math.min(wrap.clientWidth / iw, wrap.clientHeight / ih, maxScale);
      setScale(k > 0 && Number.isFinite(k) ? k : 1);
    };
    compute();
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(compute);
    });
    ro.observe(wrap);
    ro.observe(inner);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [maxScale]);

  return (
    <div ref={wrapRef} className={`w-full h-full flex items-center justify-center overflow-hidden ${className ?? ''}`}>
      <div
        ref={innerRef}
        className="w-fit shrink-0 origin-center"
        style={{ transform: `scale(${scale})` }}
      >
        {children}
      </div>
    </div>
  );
}
