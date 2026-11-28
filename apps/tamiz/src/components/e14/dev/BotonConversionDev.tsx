"use client";

/**
 * TEMPORAL-DEV-CONVERSION — chip de la píldora del score que abre el visor dev
 * de la conversión datalab-convert en una pestaña nueva (HTML renderizado +
 * .md/.json en texto plano). Sustituye a `BotonExportarConversion`, retirado
 * porque su razón de ser era la descarga.
 *
 * Dueño 2026-11-27: en capturas RECHAZADAS el chip se muestra AUN SIN modo dev
 * (label «VER LO LEÍDO») — es la respuesta directa a «¿qué leyó el OCR aquí?»
 * cuando el documento se cayó por faltantes; en el resto de estados sigue
 * siendo una herramienta de desarrollador y requiere `tamiz.dev`.
 *
 * Geometría espejo del badge DEV (`TopBar.tsx`): el badge vive en `-top-2
 * -right-2`, este chip en `-bottom-2 -right-2` — mismo tipografía y borde, cero
 * cambios de layout y cero solapamiento. Es deliberadamente un HERMANO del
 * badge, no el badge mismo: la insignia es un indicador pasivo de la KIT
 * e14-observabilidad-v1 y fundirla con una acción async cambiaría su
 * significado.
 *
 * `window.open` va DESPUÉS del await de conversión (no se pre-abre la pestaña):
 * en Android, pasar la app a segundo plano congela el pipeline de OCR
 * (medido 2026-11-26, scripts/entrega/a56-comun.mjs:133-137). El costo es que
 * la pestaña tarda 1-3 s/página en aparecer; se cubre con el estado `ocupado` y
 * con que un segundo toque —gesto fresco— nunca queda bloqueado.
 */

import { useEffect, useRef, useState } from "react";
import { useE14Store } from "@/lib/e14/store";
import { logger } from "@/lib/logger";
import { claveRevisionVisor } from "@/lib/e14/hash";
import {
  abrirUrlVisor,
  fotosAConvertir,
  prepararVisorConversionDev,
} from "@/lib/e14/conversion/visor-conversion";

type Estado = "idle" | "ocupado" | "bloqueado" | "error";

/** Colores del kit dev (verde #10b981 · ámbar #f59e0b · rojo #E52222). */
const TONO: Record<Estado | "sin-foto", string> = {
  idle: "border-[#10b981]/60 bg-[#090d12] text-[#10b981]",
  ocupado: "border-amber-500 bg-amber-950/60 text-amber-400",
  bloqueado: "border-amber-500 bg-amber-950/60 text-amber-400",
  error: "border-[#E52222]/60 bg-[#090d12] text-[#E52222]",
  "sin-foto": "border-slate-700 bg-[#090d12] text-slate-600",
};

const ETIQUETA: Record<Estado | "sin-foto", string> = {
  idle: "VER LO LEÍDO",
  ocupado: "…",
  bloqueado: "ABRIR",
  error: "¡",
  "sin-foto": "SIN FOTO",
};

export function BotonConversionDev() {
  const acta = useE14Store((s) => s.actaActual);
  const enCurso = useE14Store((s) => s.documentoEnCurso);

  const [estado, setEstado] = useState<Estado>("idle");
  const [error, setError] = useState<string | null>(null);
  // URL ya construida de ESTA acta: N pulsaciones = 1 blob y 0 re-OCR (lo caro
  // del visor es el OCR, no la apertura). Sin revoke deliberado: la pestaña
  // necesita la URL viva para recargarse, y revocar no libera nada mientras el
  // documento está abierto — el blob muere con la pestaña de Tamiz.
  const urlRef = useRef<string | null>(null);
  const claveRef = useRef<string>("");
  // `convertirActaAChandra` no cancela: si el dev cambia de vista a mitad del
  // await no hay que setear estado sobre un componente desmontado.
  const montadoRef = useRef(true);
  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
    };
  }, []);

  const fotos = fotosAConvertir(acta, enCurso);
  const sinFoto = fotos.length === 0;
  const ocupado = estado === "ocupado";

  async function pulsar() {
    if (!acta) return;
    setError(null);
    // La clave se calcula AL PULSAR sobre las fotos vigentes (SHA-256):
    // la caché queda atada a la revisión real de la imagen, no al id.
    const clave = await claveRevisionVisor(acta.id, fotos);

    if (urlRef.current && claveRef.current === clave) {
      setEstado(abrirUrlVisor(urlRef.current) ? "idle" : "bloqueado");
      return;
    }

    setEstado("ocupado");
    try {
      const listo = await prepararVisorConversionDev(acta, enCurso);
      urlRef.current = listo.url;
      claveRef.current = clave;
      logger.info("conversion:visor", {
        paginas: listo.paginas,
        ok: listo.ok,
        kb: Math.round(listo.bytes / 1024),
      });
      if (montadoRef.current) {
        setEstado(abrirUrlVisor(listo.url) ? "idle" : "bloqueado");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error("conversion:visor:falla", { error: msg });
      if (montadoRef.current) {
        setError(msg);
        setEstado("error");
      }
    }
  }

  const tono = sinFoto && !ocupado && estado === "idle" ? "sin-foto" : estado;
  const aria = sinFoto
    ? "Sin foto procesada que convertir"
    : estado === "bloqueado"
      ? "El navegador bloqueó la pestaña — tocar para abrirla"
      : ocupado
        ? "Convirtiendo (OCR 1-3 s por página)…"
        : estado === "error"
          ? `La conversión falló: ${error ?? "error"}`
          : "Ver lo que se leyó del documento (HTML, MD y JSON)";

  return (
    <button
      type="button"
      data-testid="conversion-dev"
      onClick={() => void pulsar()}
      disabled={sinFoto || ocupado}
      aria-busy={ocupado}
      aria-label={aria}
      title={aria}
      // `before:-inset-2` agranda EL ÁREA HÁBIL sin tocar lo visual: un chip de
      // text-[8px] mide ~16 px frente al mínimo táctil del repo (44 px).
      className={`absolute -bottom-2 -right-2 font-mono text-[8px] font-black tracking-widest px-1.5 py-px rounded-md border shadow-sm before:absolute before:-inset-2 before:content-[''] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#10b981]/60 ${TONO[tono]} ${
        sinFoto ? "opacity-40 cursor-not-allowed" : ""
      }`}
    >
      {ETIQUETA[tono]}
    </button>
  );
}
