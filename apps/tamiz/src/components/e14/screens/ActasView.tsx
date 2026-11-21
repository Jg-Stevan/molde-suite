"use client";

/**
 * HISTORIAL DE ESCANEOS (mock del mantenedor, 2026-11-16) — reconstrucción
 * de la vista ACTAS según el mock:
 *
 *  · Cabecera: título + toggle SIM + lupa (buscador colapsable).
 *  · Filtros: TODOS / ÓPTIMAS / ADVERTENCIA / RECHAZADAS con conteos reales.
 *  · Grupos por fecha (HOY · fecha — AYER · fecha) con tarjetas de documento:
 *    chip de TIPO + título + badge de score/estado (verde sólido · ámbar
 *    outline · rojo sólido), línea de metadata mono, fila de MÉTRICAS en 3
 *    columnas, franja de aviso (✓ procesado / ⚠ recorte + hora / ✗ error +
 *    hora) y acciones [Repetir captura] + [Ver detalle] (desplegable).
 *
 * DATOS HONESTOS (doctrina del repo):
 *  · REAL: tarjetas derivadas de `historial` (envíos de la sesión) — sin
 *    score/métricas inventadas: badge por estado y aviso por desenlace.
 *  · SIM (modoSimulacion): dataset DEMO bandera del mock (RECIBO PÚBLICO ·
 *    FACTURA POS · ACTA DE ENTREGA) — mismo contrato que PUESTO_SIMULADO:
 *    overlay de vista, jamás escribe en el store real.
 */

import { useEffect, useMemo, useState } from "react";
import { useE14Store } from "@/lib/e14/store";
import type { HistorialRow } from "@/lib/e14/fachada";
import {
  ChevronDownIcon,
  DocLineIcon,
  SearchIcon,
  StitchClockIcon,
} from "../icons";

/** Tono visual de una tarjeta de historial (mock: verde/ámbar/rojo). */
type Tono = "ok" | "warn" | "crit";

/** UN documento del historial — plano, render-only. */
interface DocHistorial {
  id: string;
  tipoChip: string;
  titulo: string;
  /** null → badge por ESTADO (sin score inventado). */
  score: number | null;
  tono: Tono;
  meta: string | null;
  metricas: { etiqueta: string; valor: string; tono?: Tono }[];
  aviso: { texto: string; tono: Tono; hora?: string } | null;
  /** Con acción de repetir (mock: advertencia/rechazada la llevan). */
  repetir: boolean;
  grupo: "HOY" | "AYER";
  sim?: boolean;
}

/** Paleta por tono (barra izquierda, chip de tipo, badge, aviso). */
const TONO = {
  ok: {
    barra: "border-l-[#10b981]",
    chip: "bg-[#10b981]/15 border-[#10b981]/40 text-[#10b981]",
    badge: "bg-[#10b981] text-[#052012] shadow-[0_2px_10px_rgba(16,185,129,0.35)]",
    aviso: "text-[#10b981]",
  },
  warn: {
    barra: "border-l-amber-400",
    chip: "bg-amber-400/15 border-amber-400/40 text-amber-400",
    badge: "bg-transparent border border-amber-400 text-amber-400",
    aviso: "text-amber-400",
  },
  crit: {
    barra: "border-l-[#E52222]",
    chip: "bg-[#E52222]/15 border-[#E52222]/40 text-[#E52222]",
    badge: "bg-[#E52222] text-white shadow-[0_2px_10px_rgba(229,34,34,0.35)]",
    aviso: "text-[#E52222]",
  },
} as const;

const GLIFO_TONO: Record<Tono, string> = { ok: "✓", warn: "●", crit: "✗" };

/** Tarjeta de documento (mock §HISTORIAL). */
function TarjetaDoc({
  doc,
  detalleAbierto,
  onToggleDetalle,
  onRepetir,
}: {
  doc: DocHistorial;
  detalleAbierto: boolean;
  onToggleDetalle: () => void;
  onRepetir: () => void;
}) {
  const t = TONO[doc.tono];
  return (
    <article
      className={`bg-[#10161f] border ${t.barra} border-slate-800 rounded-xl p-3.5 flex flex-col gap-2.5 shadow-sm`}
    >
      {/* Fila 1: chip de tipo — badge de score/estado a la derecha. */}
      <div className="flex items-center justify-between gap-2">
        <span
          className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md border font-mono text-[9px] font-bold uppercase tracking-wider ${t.chip}`}
        >
          <DocLineIcon className="w-3 h-3" />
          {doc.tipoChip}
        </span>
        <span
          className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md font-mono text-[11px] font-bold ${t.badge}`}
        >
          <span aria-hidden>{GLIFO_TONO[doc.tono]}</span>
          {doc.score != null ? `${doc.score.toFixed(1)}/10` : doc.tono === "ok" ? "OK" : doc.tono === "warn" ? "PARCIAL" : "ERROR"}
        </span>
      </div>

      {/* Fila 2: título COMPLETO en su propia línea (mock). */}
      <h3 className="text-[13px] font-bold text-white uppercase tracking-wide leading-snug">
        {doc.titulo}
      </h3>

      {/* Fila 2: metadata mono. */}
      {doc.meta && (
        <p className="font-mono text-[10px] text-slate-400 uppercase tracking-wide truncate">
          {doc.meta}
        </p>
      )}

      {/* Fila 3: métricas en 3 columnas (mock: panel interno). */}
      {doc.metricas.length > 0 && (
        <div className="grid grid-cols-3 gap-2 rounded-lg bg-[#090d12]/70 border border-slate-800/80 px-3 py-2.5">
          {doc.metricas.map((m) => (
            <div key={m.etiqueta} className="flex flex-col gap-0.5 min-w-0">
              <span className="font-mono text-[8.5px] font-bold uppercase tracking-wider text-slate-500 truncate">
                {m.etiqueta}
              </span>
              <span
                className={`font-mono text-[10.5px] font-bold uppercase truncate ${
                  m.tono === "ok"
                    ? "text-[#10b981]"
                    : m.tono === "warn"
                      ? "text-amber-400"
                      : m.tono === "crit"
                        ? "text-[#E52222]"
                        : "text-slate-200"
                }`}
              >
                {m.valor}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Fila 4: franja de aviso + hora (mock: ✓ / ⚠ RECORTE / ✗ ERROR). */}
      {doc.aviso && (
        <div className="flex items-center justify-between gap-2 border-t border-slate-800/80 pt-2">
          <span className={`flex items-center gap-1.5 min-w-0 font-mono text-[10.5px] font-bold ${TONO[doc.aviso.tono].aviso}`}>
            <span aria-hidden className="shrink-0">
              {doc.aviso.tono === "ok" ? "✓" : doc.aviso.tono === "warn" ? "▲" : "✗"}
            </span>
            <span className="uppercase tracking-wide truncate">{doc.aviso.texto}</span>
          </span>
          {doc.aviso.hora && (
            <span className="shrink-0 font-mono text-[10px] text-slate-500">{doc.aviso.hora}</span>
          )}
        </div>
      )}

      {/* Detalle desplegable (Ver detalle). */}
      {detalleAbierto && (
        <div className="rounded-lg bg-[#090d12]/70 border border-slate-800/80 px-3 py-2 flex flex-col gap-1">
          <div className="flex justify-between gap-2 font-mono text-[10px]">
            <span className="text-slate-500 uppercase tracking-wider">ID:</span>
            <span className="text-slate-300 truncate">{doc.id}</span>
          </div>
          <div className="flex justify-between gap-2 font-mono text-[10px]">
            <span className="text-slate-500 uppercase tracking-wider">ESTADO:</span>
            <span className={TONO[doc.tono].aviso}>
              {doc.tono === "ok" ? "PROCESADO Y GUARDADO" : doc.tono === "warn" ? "ADVERTENCIA" : "RECHAZADO"}
            </span>
          </div>
          {doc.sim && (
            <div className="flex justify-between gap-2 font-mono text-[10px]">
              <span className="text-slate-500 uppercase tracking-wider">ORIGEN:</span>
              <span className="text-amber-400">SIMULACIÓN · DATOS DE PRUEBA</span>
            </div>
          )}
        </div>
      )}

      {/* Fila 5: acciones (mock: Ver detalle + Repetir captura). */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onToggleDetalle}
          aria-expanded={detalleAbierto}
          className="flex items-center gap-1 font-mono text-[10.5px] font-bold text-slate-400 hover:text-white uppercase tracking-wider transition-colors cursor-pointer min-h-[32px] px-1"
        >
          Ver detalle
          <ChevronDownIcon className={`w-3 h-3 transition-transform duration-200 ${detalleAbierto ? "rotate-180" : ""}`} />
        </button>
        {doc.repetir && (
          <button
            type="button"
            onClick={onRepetir}
            className="px-3 py-1.5 rounded-lg border border-slate-700 bg-[#090d12] font-mono text-[10.5px] font-bold text-slate-200 hover:border-[#10b981]/50 hover:text-[#10b981] uppercase tracking-wider transition-colors cursor-pointer min-h-[32px]"
          >
            Repetir captura
          </button>
        )}
      </div>
    </article>
  );
}

/** Tarjeta REAL derivada de una fila de envíos (sin datos inventados). */
function docDeFila(fila: HistorialRow, indice: number): DocHistorial {
  const tono: Tono =
    fila.estado === "ENVIADO" ? "ok" : fila.estado === "REVISION_HUMANA" ? "warn" : "crit";
  const aviso =
    fila.estado === "ENVIADO"
      ? { texto: "Documento procesado y guardado", tono: "ok" as const }
      : fila.estado === "REVISION_HUMANA"
        ? { texto: "Enviado a revisión humana", tono: "warn" as const }
        : { texto: "Requiere nueva toma", tono: "crit" as const };
  return {
    id: fila.id,
    tipoChip: "DOCUMENTO",
    titulo: fila.titulo,
    score: null,
    tono,
    meta: fila.hora ? `HORA: ${fila.hora}` : null,
    metricas: [],
    aviso: { ...aviso, hora: fila.hora ?? undefined },
    repetir: fila.estado !== "ENVIADO",
    grupo: "HOY",
    // índice de estabilidad para las claves (los ids del core son únicos).
    ...(indice === -1 ? {} : {}),
  };
}

/** Dataset DEMO del SIM — las tarjetas EXACTAS del mock (bandera: sim). */
const DEMO_SIM: DocHistorial[] = [
  {
    id: "sim-doc-1",
    tipoChip: "RECIBO PÚBLICO",
    titulo: "ACUEDUCTO CENTRAL - FACTURA",
    score: 9.1,
    tono: "ok",
    meta: "CUENTA: 9492011-2 · REF PAGO: #99321",
    metricas: [
      { etiqueta: "VALOR LIQUIDADO", valor: "$142.500 COP" },
      { etiqueta: "VENCIMIENTO", valor: "28/NOV/2026" },
      { etiqueta: "CUFE / BARRAS", valor: "10/10 OK", tono: "ok" },
    ],
    aviso: { texto: "Documento procesado y guardado", tono: "ok" },
    repetir: false,
    grupo: "HOY",
    sim: true,
  },
  {
    id: "sim-doc-2",
    tipoChip: "FACTURA POS",
    titulo: "FACTURA POS - ÉXITO CALI",
    score: 7.9,
    tono: "warn",
    meta: "POS #8492 · NIT: 900.123.456-7",
    metricas: [
      { etiqueta: "TOTAL VENTA", valor: "$148.500 COP" },
      { etiqueta: "TERMINAL / CAJA", valor: "CAJA 04 · OP 12" },
      { etiqueta: "DIAN / RESOLUCIÓN", valor: "PARCIAL RECORTE", tono: "warn" },
    ],
    aviso: { texto: "RECORTE: Pie de factura / Resolución DIAN cortada", tono: "warn", hora: "11:36:31" },
    repetir: true,
    grupo: "HOY",
    sim: true,
  },
  {
    id: "sim-doc-3",
    tipoChip: "ACTA DE ENTREGA",
    titulo: "ACTA DE ENTREGA - LOGÍSTICA BOGOTÁ",
    score: 4.9,
    tono: "crit",
    meta: "ACTA #00281 · PÁG 1 DE 3 · BODEGA 02",
    metricas: [
      { etiqueta: "FIRMA / SELLO", valor: "NO DETECTADO", tono: "crit" },
      { etiqueta: "LEGIBILIDAD", valor: "62% PARCIAL", tono: "warn" },
      { etiqueta: "ESTADO OCR", valor: "BLOQUEADO", tono: "crit" },
    ],
    aviso: { texto: "ERROR: Falta firma de recibido o sello no detectado", tono: "crit", hora: "11:49:33" },
    repetir: true,
    grupo: "HOY",
    sim: true,
  },
  {
    id: "sim-doc-4",
    tipoChip: "ACTA DE ENTREGA",
    titulo: "ACTA DE ENTREGA - SURAMERICANA",
    score: 9.4,
    tono: "ok",
    meta: "GUÍA #77120 · PÁG 1 DE 1 · SEDE 05",
    metricas: [
      { etiqueta: "FIRMA / SELLO", valor: "COMPLETAS", tono: "ok" },
      { etiqueta: "LEGIBILIDAD", valor: "98% ÓPTIMA", tono: "ok" },
      { etiqueta: "ESTADO OCR", valor: "OK", tono: "ok" },
    ],
    aviso: { texto: "Documento procesado y guardado", tono: "ok", hora: "09:14:02" },
    repetir: false,
    grupo: "AYER",
    sim: true,
  },
];

type Filtro = "todos" | "ok" | "warn" | "crit";

const FILTROS: { id: Filtro; label: string; dot: string }[] = [
  { id: "todos", label: "TODOS", dot: "" },
  { id: "ok", label: "ÓPTIMAS", dot: "bg-[#10b981]" },
  { id: "warn", label: "ADVERTENCIA", dot: "bg-amber-400" },
  { id: "crit", label: "RECHAZADAS", dot: "bg-[#E52222]" },
];

/** Fecha LARGA es-CO en mayúsculas («16 NOVIEMBRE 2026»). */
function fechaLarga(offsetDias = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - offsetDias);
  return d
    .toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" })
    .toUpperCase();
}

export function ActasView() {
  const historial = useE14Store((s) => s.historial);
  const modoSimulacion = useE14Store((s) => s.modoSimulacion);
  const alternarModoSimulacion = useE14Store((s) => s.alternarModoSimulacion);
  const navegar = useE14Store((s) => s.navegar);

  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [buscadorAbierto, setBuscadorAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [detalleAbierto, setDetalleAbierto] = useState<string | null>(null);

  // Documentos: REAL (envíos de la sesión) + DEMO del SIM (encima, bandera).
  const docs = useMemo<DocHistorial[]>(() => {
    const reales = historial.map((f, i) => docDeFila(f, i));
    return modoSimulacion ? [...DEMO_SIM, ...reales] : reales;
  }, [historial, modoSimulacion]);

  // Conteos de los filtros (mock: TODOS (14) · ÓPTIMAS (10) · …).
  const conteos = useMemo(
    () => ({
      todos: docs.length,
      ok: docs.filter((d) => d.tono === "ok").length,
      warn: docs.filter((d) => d.tono === "warn").length,
      crit: docs.filter((d) => d.tono === "crit").length,
    }),
    [docs],
  );

  // Filtro + búsqueda por título.
  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return docs.filter((d) => {
      const pasaFiltro = filtro === "todos" || d.tono === filtro;
      const pasaBusqueda = !q || d.titulo.toLowerCase().includes(q);
      return pasaFiltro && pasaBusqueda;
    });
  }, [docs, filtro, busqueda]);

  // Grupos por fecha (mock: HOY · fecha — AYER · fecha). Las filas reales
  // son de la SESIÓN actual → HOY.
  const grupos = useMemo(() => {
    const hoy = filtrados.filter((d) => d.grupo === "HOY");
    const ayer = filtrados.filter((d) => d.grupo === "AYER");
    return [
      { etiqueta: `HOY · ${fechaLarga(0)}`, docs: hoy },
      { etiqueta: `AYER · ${fechaLarga(1)}`, docs: ayer },
    ].filter((g) => g.docs.length > 0);
  }, [filtrados]);

  // El buscador abierto con Escape se cierra (patrón del visor).
  useEffect(() => {
    if (!buscadorAbierto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setBuscadorAbierto(false);
        setBusqueda("");
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [buscadorAbierto]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto thin-scroll bg-[#090d12] flex flex-col">
      {/* Cabecera — título + SIM + lupa (mock: «HISTORIAL DE ESCANEOS» + 🔍). */}
      <header className="sticky top-0 z-40 w-full bg-[#090d12]/92 backdrop-blur-xl border-b border-slate-800/80 px-4 pt-3 pb-2.5 shrink-0 shadow-xs">
        <div className="max-w-md lg:max-w-2xl xl:max-w-3xl mx-auto w-full flex items-center justify-between gap-2">
          <h1 className="font-mono text-[15px] font-bold tracking-[0.12em] text-white uppercase">
            Historial de Escaneos
          </h1>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={alternarModoSimulacion}
              aria-pressed={modoSimulacion}
              title="Modo simulación: llena el historial con documentos demo"
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg border font-mono text-[10px] font-bold uppercase tracking-wider transition min-h-[32px] ${
                modoSimulacion
                  ? "bg-amber-400/20 border-amber-400 text-amber-400 shadow-xs shadow-amber-400/10"
                  : "bg-[#10161f] border-slate-700 text-slate-400 hover:text-white"
              }`}
            >
              <StitchClockIcon className="w-3 h-3" />
              SIM
            </button>
            <button
              type="button"
              onClick={() => {
                setBuscadorAbierto((v) => !v);
                if (buscadorAbierto) setBusqueda("");
              }}
              aria-pressed={buscadorAbierto}
              aria-label={buscadorAbierto ? "Cerrar buscador" : "Buscar documentos"}
              className={`flex items-center justify-center w-9 h-9 rounded-lg border transition min-h-[36px] ${
                buscadorAbierto
                  ? "border-[#10b981]/50 bg-[#10b981]/10 text-[#10b981]"
                  : "border-slate-700 bg-[#10161f] text-slate-400 hover:text-white"
              }`}
            >
              <SearchIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
        {/* Buscador colapsable. */}
        {buscadorAbierto && (
          <div className="max-w-md lg:max-w-2xl xl:max-w-3xl mx-auto w-full mt-2.5 relative">
            <input
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por título…"
              aria-label="Buscar documentos por título"
              autoFocus
              className="w-full h-10 px-3 bg-[#10161f] border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 font-mono focus:outline-none focus:border-[#10b981]/60 focus:ring-1 focus:ring-[#10b981]/30 transition"
            />
            {busqueda && (
              <button
                type="button"
                onClick={() => setBusqueda("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1.5 text-xs"
                aria-label="Limpiar búsqueda"
              >
                ✕
              </button>
            )}
          </div>
        )}
      </header>

      <div className="flex-grow flex flex-col gap-3 px-4 pt-3 pb-8 max-w-md lg:max-w-2xl xl:max-w-3xl mx-auto w-full">
        {/* Filtros con conteos (mock: chips horizontales). */}
        <div className="flex gap-1 overflow-x-auto no-scrollbar -mx-1 px-1 py-1" role="group" aria-label="Filtrar por estado">
          {FILTROS.map((f) => {
            const activo = filtro === f.id;
            const n = conteos[f.id];
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFiltro(f.id)}
                aria-pressed={activo}
                className={`shrink-0 inline-flex items-center gap-1 px-1.5 py-1 rounded-md border font-mono text-[9px] font-bold uppercase transition min-h-[32px] cursor-pointer ${
                  activo
                    ? "bg-[#10b981] border-[#10b981] text-[#052012] shadow-[0_2px_12px_rgba(16,185,129,0.3)]"
                    : "bg-[#10161f] border-slate-700 text-slate-300 hover:border-slate-500"
                }`}
              >
                {f.dot && (
                  <span className={`w-1 h-1 rounded-full ${f.dot}`} aria-hidden />
                )}
                {f.label} ({n})
              </button>
            );
          })}
        </div>

        {/* Estado vacío honesto. */}
        {filtrados.length === 0 && (
          <div className="p-8 text-center rounded-2xl bg-[#10161f]/50 border border-slate-800/60 mt-2">
            <p className="font-mono text-xs uppercase tracking-wider text-slate-400 leading-relaxed">
              {busqueda
                ? `SIN RESULTADOS PARA "${busqueda}"`
                : modoSimulacion
                  ? "SIN DOCUMENTOS EN ESTE FILTRO"
                  : "AÚN NO HAY DOCUMENTOS ESCANEADOS"}
            </p>
            {!modoSimulacion && !busqueda && historial.length === 0 && (
              <p className="font-mono text-[10px] text-slate-500 mt-2">
                Active SIM para ver el historial demo o escanee un documento.
              </p>
            )}
          </div>
        )}

        {/* Grupos por fecha + tarjetas. */}
        {grupos.map((grupo) => (
          <section key={grupo.etiqueta} className="flex flex-col gap-2.5" aria-label={grupo.etiqueta}>
            <h2 className="font-mono text-[10.5px] font-bold tracking-[0.14em] text-slate-400 uppercase pt-1">
              {grupo.etiqueta}
            </h2>
            {grupo.docs.map((doc) => (
              <TarjetaDoc
                key={doc.id}
                doc={doc}
                detalleAbierto={detalleAbierto === doc.id}
                onToggleDetalle={() =>
                  setDetalleAbierto(detalleAbierto === doc.id ? null : doc.id)
                }
                onRepetir={() => navegar("escanear")}
              />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
