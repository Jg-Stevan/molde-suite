"use client";

/**
 * VERIFICACIÓN DOCUMENTAL (mock del mantenedor, 2026-11-16) — tarjeta EN
 * FLUJO encima del documento en REVISIÓN. Reemplaza a la barra/panel del
 * CHECK LIST con los MISMOS datos data-driven de lib/e14/checklist.ts
 * (cero lógica nueva, solo la piel del mock):
 *
 *  · Header: icono del gate (✓/!/✗) + «VERIFICACIÓN DOCUMENTAL» + badge del
 *    PORCENTAJE global pintado con el tono del gate (100% OK · 80% ALERTA ·
 *    40% RECHAZADO).
 *  · Sección «Campos Obligatorios» = los grupos que BLOQUEAN (huellas +
 *    obligatorios: firmas, QR, cabecera, tipo, mesa, página) — siempre
 *    desplegada, badge [pasados/total] + ✓ cuando está completo.
 *  · Sección «Campos Opcionales (desplegables)» = los grupos INFORMATIVOS
 *    (integridad de imagen + campos variables) — colapsada cuando todo está
 *    OK y desplegada en advertencia/rechazo (regla del mock: ▲/▼).
 *
 * Filas: glifo semáforo + etiqueta a la izquierda · valor (detalle REAL del
 * motor) a la derecha, coloreado por estado del item. El override manual del
 * desplegable vive en estado local y se resetea al cambiar el acta.
 */

import { useEffect, useMemo, useState } from "react";
import type { Acta } from "@/lib/e14/fachada";
import {
  construirChecklist,
  conteoDeGrupo,
  tonoDeStatus,
  type EstadoChecklist,
  type GrupoChecklist,
  type ItemChecklist,
  type TonoChecklist,
} from "@/lib/e14/checklist";

/** Texto del badge de porcentaje del header, por tono del gate. */
const PALABRA_TONO: Record<TonoChecklist, string> = {
  ok: "OK",
  warn: "ALERTA",
  crit: "RECHAZADO",
};

/** Paleta de la tarjeta por tono del gate (mock: borde + glow del estado). */
const TONO_TARJETA: Record<TonoChecklist, { borde: string; glow: string; texto: string; icono: string }> = {
  ok: {
    borde: "border-[#10b981]/30",
    glow: "",
    texto: "text-[#10b981] border-[#10b981]/40 bg-[#10b981]/10",
    icono: "bg-[#10b981]/15 text-[#10b981] border-[#10b981]/40",
  },
  warn: {
    borde: "border-amber-500/60",
    glow: "shadow-[0_0_18px_rgba(245,158,11,0.12)]",
    texto: "text-amber-400 border-amber-500/50 bg-amber-500/10",
    icono: "bg-amber-500/15 text-amber-400 border-amber-500/40",
  },
  crit: {
    borde: "border-red-500/60",
    glow: "shadow-[0_0_18px_rgba(239,68,68,0.12)]",
    texto: "text-[#E52222] border-red-500/50 bg-red-500/10",
    icono: "bg-red-500/15 text-[#E52222] border-red-500/40",
  },
};

/** Colores del VALOR de cada fila según el estado del item (mock: verde/
 *  ámbar/rojo a la derecha). */
const VALOR_ESTADO: Record<EstadoChecklist, string> = {
  ok: "text-[#10b981]",
  alerta: "text-amber-400",
  fallo: "text-[#E52222]",
};

const GLIFO: Record<EstadoChecklist, string> = { ok: "✓", alerta: "•", fallo: "✗" };
const GLIFO_COLOR: Record<EstadoChecklist, string> = {
  ok: "text-[#10b981]",
  alerta: "text-amber-400",
  fallo: "text-[#E52222]",
};

/** Icono circular del header por tono (mock: ✓ / ⚠ / ✗ dentro de un chip). */
function IconoGate({ tono }: { tono: TonoChecklist }) {
  const glifo = tono === "ok" ? "✓" : tono === "warn" ? "!" : "✗";
  return (
    <span
      aria-hidden
      className={`shrink-0 w-6 h-6 rounded-full border flex items-center justify-center font-mono text-xs font-black ${TONO_TARJETA[tono].icono}`}
    >
      {glifo}
    </span>
  );
}

/** Una sección de la tarjeta (mock: título bold + badge [N/M] + filas). */
function SeccionVerificacion({
  titulo,
  desplegable,
  abierta,
  onToggle,
  items,
}: {
  titulo: string;
  desplegable?: boolean;
  abierta: boolean;
  onToggle?: () => void;
  items: ItemChecklist[];
}) {
  const total = items.length;
  const pasados = items.filter((it) => it.estado === "ok").length;
  const completo = pasados === total;
  const tonoSeccion: TonoChecklist = items.some((it) => it.estado === "fallo")
    ? "crit"
    : items.some((it) => it.estado === "alerta")
      ? "warn"
      : "ok";

  return (
    <section aria-label={titulo} className="flex flex-col">
      {/* Header de la sección — botón SOLO si es desplegable (mock: ▲/▼). */}
      {(desplegable && onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={abierta}
          className="w-full flex items-center justify-between gap-2 min-h-[36px] cursor-pointer select-none text-left"
        >
          <EncabezadoSeccion titulo={titulo} dotTono={tonoSeccion} />
          <span className="flex items-center gap-1.5 shrink-0">
            <span
              className={`font-mono text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                completo
                  ? "text-[#10b981] border-[#10b981]/40 bg-[#10b981]/10"
                  : tonoSeccion === "crit"
                    ? "text-[#E52222] border-red-500/40 bg-red-500/10"
                    : "text-amber-400 border-amber-500/40 bg-amber-500/10"
              }`}
            >
              {pasados}/{total}
              {completo ? " ✓" : abierta ? " ▲" : " ▼"}
            </span>
          </span>
        </button>
      ) : (
        <div className="w-full flex items-center justify-between gap-2 min-h-[36px]">
          <EncabezadoSeccion titulo={titulo} dotTono={tonoSeccion} />
          <span className="flex items-center gap-1.5 shrink-0">
            <span
              className={`font-mono text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                completo
                  ? "text-[#10b981] border-[#10b981]/40 bg-[#10b981]/10"
                  : tonoSeccion === "crit"
                    ? "text-[#E52222] border-red-500/40 bg-red-500/10"
                    : "text-amber-400 border-amber-500/40 bg-amber-500/10"
              }`}
            >
              {pasados}/{total}
              {completo ? " ✓" : ""}
            </span>
          </span>
        </div>
      ))}

      {abierta && (
        <ul className="mt-1 space-y-0.5">
          {items.map((item) => (
            <li
              key={item.id}
              data-testid="checklist-item"
              className="flex items-center justify-between gap-3 rounded-lg bg-[#090d12]/70 border border-slate-800/70 px-2.5 py-1 min-h-[28px]"
            >
              <span className="flex items-center gap-2 min-w-0">
                <span aria-hidden className={`shrink-0 font-mono text-[11px] font-black leading-none ${GLIFO_COLOR[item.estado]}`}>
                  {GLIFO[item.estado]}
                </span>
                <span className="font-mono text-[11px] font-semibold text-slate-200 truncate">
                  {item.etiqueta}
                </span>
              </span>
              {item.detalle && (
                <span
                  className={`shrink-0 font-mono text-[10px] font-bold uppercase tracking-wide text-right ${VALOR_ESTADO[item.estado]} max-w-[55%] truncate`}
                >
                  {item.detalle}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EncabezadoSeccion({ titulo, dotTono }: { titulo: string; dotTono: TonoChecklist }) {
  return (
    <span className="flex items-center gap-2 min-w-0">
      <span
        aria-hidden
        className={`shrink-0 w-1.5 h-1.5 rounded-full ${
          dotTono === "ok" ? "bg-[#10b981]" : dotTono === "warn" ? "bg-amber-400" : "bg-[#E52222]"
        }`}
      />
      <span className="text-[13px] font-bold text-white truncate">{titulo}</span>
    </span>
  );
}

/** Utilidad: fusiona los items de una lista de grupos en UNA sección. */
function fusionarGrupos(grupos: GrupoChecklist[], ids: string[]): ItemChecklist[] {
  return grupos
    .filter((g) => ids.includes(g.id))
    .flatMap((g) => g.items);
}

/** Tarjeta VERIFICACIÓN DOCUMENTAL (en flujo, encima del documento). */
export function VerificacionDocumental({ acta }: { acta: Acta }) {
  const checklist = useMemo(() => construirChecklist(acta), [acta]);
  const tono = tonoDeStatus(acta.status);
  const piel = TONO_TARJETA[tono];

  // Dos secciones del mock: bloqueantes (huellas + obligatorios) e
  // informativos (integridad + variables). Los grupos ausentes (p. ej.
  // firmas sin señal) simplemente no aportan items.
  const obligatorios = useMemo(
    () => fusionarGrupos(checklist.grupos, ["huellas", "obligatorios"]),
    [checklist],
  );
  const opcionales = useMemo(
    () => fusionarGrupos(checklist.grupos, ["integridad", "variables"]),
    [checklist],
  );

  // Desplegable de OPCIONALES: null = automático por tono (mock: colapsado
  // cuando todo está OK, desplegado en advertencia/rechazo). El toque del
  // operador fija el override; se resetea al cambiar el acta.
  const [overrideOpcionales, setOverrideOpcionales] = useState<boolean | null>(null);
  // Tarjeta completa colapsable (mantenedor 2026-11-22): oculta por defecto
  // cuando el acta se guarda automáticamente (todo OK). Se despliega sola en
  // rechazo/advertencia O si el gate estructural reporta zonas faltantes,
  // para mostrar lo faltante. El toque del header fija el override.
  const hayZonasFaltantes = (acta.estructura?.reglas ?? []).some(
    (r) => r.estado === "faltante",
  );
  const abiertaPorDefecto = tono !== "ok" || hayZonasFaltantes;
  const [overrideAbierta, setOverrideAbierta] = useState<boolean | null>(null);
  const actaId = acta.id ?? null;
  useEffect(() => {
    setOverrideOpcionales(null);
    setOverrideAbierta(null);
  }, [actaId]);
  const abierta = overrideAbierta ?? abiertaPorDefecto;
  const opcionalesAbiertos = overrideOpcionales ?? (tono !== "ok");

  // Porcentaje global del gate (mock: badge del header).
  const totalItems = obligatorios.length + opcionales.length;
  const pasadosItems =
    obligatorios.filter((it) => it.estado === "ok").length +
    opcionales.filter((it) => it.estado === "ok").length;
  const pct = totalItems > 0 ? Math.round((pasadosItems / totalItems) * 100) : 0;

  return (
    <section
      aria-label="Verificación documental"
      data-testid="verificacion-documental"
      className={`bg-[#10161f] rounded-2xl border ${piel.borde} ${piel.glow} p-3.5 lg:p-4 flex flex-col gap-2.5 shadow-sm`}
    >
      {/* Header: icono del gate + título + badge de porcentaje + chevron.
          Es el control de colapso de TODA la tarjeta (mock 2026-11-22). */}
      <button
        type="button"
        onClick={() => setOverrideAbierta(!abierta)}
        aria-expanded={abierta}
        aria-controls="verificacion-detalle"
        data-testid="verificacion-toggle"
        className="flex items-center justify-between gap-2 pb-1 border-b border-slate-800/80 w-full text-left cursor-pointer select-none"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <IconoGate tono={tono} />
          <h2 className="text-[12px] font-bold text-white uppercase tracking-wide truncate">
            Verificación Documental
          </h2>
        </div>
        <span className="flex items-center gap-2 shrink-0">
          <span
            data-testid="checklist-counter"
            aria-label={`${pct} por ciento · ${PALABRA_TONO[tono]}`}
            className={`font-mono text-[9px] font-bold px-2 py-1 rounded-lg border ${piel.texto}`}
          >
            {pct}% {PALABRA_TONO[tono]}
          </span>
          <span
            aria-hidden
            className={`font-mono text-[10px] text-slate-400 transition-transform duration-150 ${abierta ? "rotate-180" : ""}`}
          >
            ▼
          </span>
        </span>
      </button>

      {abierta && (
        <div
          id="verificacion-detalle"
          data-testid="verificacion-detalle"
          className="flex flex-col gap-2.5"
        >
          {/* Sección 1 — Campos Obligatorios (siempre desplegada). */}
          <SeccionVerificacion titulo="Campos Obligatorios" abierta items={obligatorios} />

          {/* Sección 2 — Campos Opcionales (desplegable, regla del mock). */}
          {opcionales.length > 0 && (
            <SeccionVerificacion
              titulo={opcionalesAbiertos ? "Campos Opcionales" : "Campos Opcionales (desplegables)"}
              desplegable
              abierta={opcionalesAbiertos}
              onToggle={() => setOverrideOpcionales(!opcionalesAbiertos)}
              items={opcionales}
            />
          )}
        </div>
      )}
    </section>
  );
}
