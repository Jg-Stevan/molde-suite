"use client";

/**
 * BottomNav — REDISEÑO «nav inferior» (mock del mantenedor 2026-02,
 * «dejemos la parte de abajo como la imagen»): barra casi negra
 * `bg-[#050708]` con grid-cols-3 items-center y tres piezas:
 *  · Izquierda: HISTORIAL (reloj, trazo gris, etiqueta mono) → vista `actas`
 *    (el control de documentos ES el historial de lo escaneado).
 *  · Centro: círculo verde #00E676 (60px, doble glow) con glifo de
 *    escaneo negro (4 esquinas + barra central) → vista `escanear`.
 *    La REVISIÓN sigue contando como ESCANEAR activo (el flujo de
 *    revisión ES el flujo del escáner) — solo presentación, `navegar`
 *    intacto. NOTA (eliminación del módulo masiva): el ítem MASIVA y la
 *    regla de origen (`masivaOrigen`) se retiraron con el módulo.
 *  · Derecha: PLANTILLAS (cuadrícula sólida 2×2, etiqueta mono) → vista
 *    `resumen`.
 * Etiquetas UPPERCASE (mock del mantenedor 2026-11-16: «HISTORIAL» /
 * «PLANTILLAS»), mono 11px con tracking. Activo lateral = esmeralda-300;
 * inactivo = gris (icono 400 / etiqueta 300). SIN indicador home (el mock
 * no lo trae) — `pb-safe` conserva la zona segura iOS. El badge de conteo
 * de la sesión sobrevive sobre HISTORIAL (data-driven, solo si actasSesion > 0).
 * El slot `children` (CTAs de ReviewCtas en REVISIÓN) se conserva sobre
 * la barra, igual que antes.
 */
import type { ReactNode } from "react";
import { useE14Store, type Vista } from "@/lib/e14/store";
import {
  StitchClockIcon,
  StitchGridSolidIcon,
  StitchScanGlyphIcon,
} from "./icons";

type ItemLateral = { vista: Vista; label: string; Icon: typeof StitchClockIcon };

const LATERALES: [ItemLateral, ItemLateral] = [
  { vista: "actas", label: "HISTORIAL", Icon: StitchClockIcon },
  { vista: "resumen", label: "PLANTILLAS", Icon: StitchGridSolidIcon },
];

export function BottomNav({
  mode = "dark",
  children,
}: {
  mode?: "dark" | "app";
  children?: ReactNode;
}) {
  const vista = useE14Store((s) => s.vista);
  const navegar = useE14Store((s) => s.navegar);
  const actasSesion = useE14Store((s) => s.actasSesion);

  const itemLateral = ({ vista: v, label, Icon }: ItemLateral) => {
    const activo = vista === v;
    return (
      <button
        type="button"
        onClick={() => navegar(v)}
        aria-current={activo ? "page" : undefined}
        className={`group flex min-h-[48px] flex-col items-center justify-center gap-4 rounded-2xl px-2 py-1.5 select-none transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/60 ${
          activo ? "text-emerald-300" : "text-gray-400 hover:text-gray-200"
        }`}
      >
        <span className="relative">
          <Icon className="h-4 w-4" />
          {v === "actas" && actasSesion > 0 && (
            <span className="absolute -right-2.5 -top-1.5 rounded-full bg-emerald-500 px-1.5 py-px font-mono text-[9px] font-bold text-black shadow-sm tabular-nums">
              {actasSesion}
            </span>
          )}
        </span>
        <span
          className={`font-mono text-[11px] leading-none tracking-[0.08em] transition-colors ${
            activo
              ? "text-emerald-300"
              : "text-gray-300 group-hover:text-gray-100"
          }`}
        >
          {label}
        </span>
      </button>
    );
  };

  const escaneoActivo = vista === "escanear" || vista === "revision";

  return (
    <footer className="relative z-30 shrink-0 pb-safe">
      {/* Slot de CTAs (REVISIÓN): sobre la barra, como siempre */}
      {children && <div className="max-w-lg mx-auto px-4 pt-1 pb-2">{children}</div>}
      <nav
        className="border-t border-white/[0.06] bg-[#050708]/95 backdrop-blur-xl shadow-[0_-10px_36px_rgba(0,0,0,0.6)]"
        aria-label="Navegación principal"
        data-mode={mode}
      >
        <div className="mx-auto grid max-w-md grid-cols-3 items-center px-4 py-3">
          {itemLateral(LATERALES[0])}

          {/* Botón central: círculo verde con glifo de escaneo */}
          <button
            type="button"
            onClick={() => navegar("escanear")}
            aria-current={escaneoActivo ? "page" : undefined}
            aria-label="Escanear documento"
            title="Escanear documento"
            className="justify-self-center flex h-[56px] w-[56px] items-center justify-center rounded-full bg-[#00E676] text-black shadow-[0_0_24px_rgba(0,230,118,0.45),0_0_72px_rgba(0,230,118,0.16)] transition-all duration-150 hover:scale-[1.04] active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050708]"
          >
            <StitchScanGlyphIcon className="h-8 w-8" />
          </button>

          {itemLateral(LATERALES[1])}
        </div>
      </nav>
    </footer>
  );
}
