"use client";

/**
 * PLANTILLAS (mock del mantenedor, 2026-11-16) — reconstrucción de la vista
 * RESUMEN según el mock:
 *
 *  · Cabecera: «PLANTILLAS» + chip MODO LOCAL (+ tuerca de diagnóstico).
 *  · Tarjeta CARGAR MOLDE .JSON (borde punteado): input de archivo REAL con
 *    drag & drop — el molde personalizado se registra en localStorage del
 *    dispositivo (nombre, tamaño, fecha) y pasa a ser el «molde vinculado».
 *  · MOLDE VINCULADO AL DISPOSITIVO: la plantilla ACTIVA (molde personalizado
 *    si el operador cargó uno; si no, la base integrada) con chips de estado,
 *    tamaño en caché, PREVIEW (N obligatorios / M opcionales — derivado de la
 *    definición de la plantilla) y tipos de campo presentes. Acciones:
 *    REEMPLAZAR .JSON · ELIMINAR · PROBAR.
 *  · AJUSTES DE SISTEMA (colapsado al pie): puente a supervisión + reiniciar
 *    jornada — la operativa del mantenedor sale del flujo visual del mock
 *    pero NO se pierde.
 *
 * DATOS HONESTOS: los conteos del preview salen de construirChecklist() con
 * un acta mínima (SOLO para LISTAR los campos que la plantilla define — los
 * estados por documento viven en REVISIÓN). Nada de cifras decorativas.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Acta } from "@/lib/e14/fachada";
import { useE14Store } from "@/lib/e14/store";
import { construirChecklist } from "@/lib/e14/checklist";
// KIT e14-puente-supervision-v1 (§7): tarjeta del puente al panel de
// supervisión — estado del singleton + sincronización manual inline.
import type { EstadoPuente } from "@/lib/e14/puente/tipos";
import {
  estadoPuente,
  sincronizarAhora,
  hubEnUso,
  esOrigenLocal,
  fijarHubLocal,
} from "@/lib/e14/puente/envio";
import { contarPendientes } from "@/lib/e14/puente/cola";
// KIT e14-observabilidad-v1 (agente 2 · C1): puerta del modo desarrollador.
import { TuercaResumen } from "../dev/TuercaResumen";
// KIT e14-observabilidad-v1 (agente 2 · C4): panel completo del modo dev.
import { PanelDev } from "../dev/PanelDev";
import { DocLineIcon, StitchDocIcon } from "../icons";

/** Registro LOCAL del molde personalizado (localStorage del dispositivo). */
interface MoldeLocal {
  nombre: string;
  tamanoKb: number;
  fecha: string;
}

const CLAVE_MOLDE = "e14-molde-local";

function leerMoldeLocal(): MoldeLocal | null {
  try {
    const crudo = window.localStorage.getItem(CLAVE_MOLDE);
    if (!crudo) return null;
    const parseado = JSON.parse(crudo) as MoldeLocal;
    if (typeof parseado?.nombre !== "string") return null;
    return parseado;
  } catch {
    return null;
  }
}

export function ResumenView() {
  const navegar = useE14Store((s) => s.navegar);
  const reiniciarJornada = useE14Store((s) => s.reiniciarJornada);
  const [reiniciarArmado, setReiniciarArmado] = useState(false);

  // Molde personalizado registrado en el dispositivo (REAL: localStorage).
  const [moldeLocal, setMoldeLocal] = useState<MoldeLocal | null>(null);
  const [feedbackMolde, setFeedbackMolde] = useState<string | null>(null);
  const inputArchivo = useRef<HTMLInputElement>(null);

  // KIT e14-observabilidad-v1 (agente 2 · C4): el panel SOLO se abre desde
  // la tuerca (sin ruta ni query param).
  const [panelAbierto, setPanelAbierto] = useState(false);
  // AJUSTES DE SISTEMA (colapsado al pie del mock).
  const [ajustesAbiertos, setAjustesAbiertos] = useState(false);

  // KIT e14-puente-supervision-v1 (§7): estado del puente leído del
  // singleton (snapshot COPIA) + cola pendiente real + feedback inline del
  // botón (sin modales ni toasts — D2 del redesign).
  const [puenteEstado, setPuenteEstado] = useState<EstadoPuente | null>(null);
  const [puentePendientes, setPuentePendientes] = useState(0);
  const [puenteSincronizando, setPuenteSincronizando] = useState(false);
  const [puenteFeedback, setPuenteFeedback] = useState<string | null>(null);
  // E2E LOCAL — el flujo celular → computador del mismo equipo. Solo aparece
  // en red local, nunca en la demo pública.
  const [enRedLocal, setEnRedLocal] = useState(false);
  const [hubUsado, setHubUsado] = useState<string | null>(null);

  useEffect(() => {
    try {
      setMoldeLocal(leerMoldeLocal());
      setEnRedLocal(esOrigenLocal());
      setHubUsado(hubEnUso());
      setPuenteEstado(estadoPuente());
      void contarPendientes().then((n) => setPuentePendientes(n));
    } catch {
      /* silencioso — la vista jamás rompe por almacenamiento bloqueado */
    }
  }, []);

  const apuntarHubLocal = () => {
    const origen = window.location.origin;
    const nuevo = fijarHubLocal(hubUsado !== origen);
    setHubUsado(nuevo ?? origen);
    setPuenteFeedback(
      nuevo === null
        ? "El navegador bloqueó el almacenamiento: el hub no se pudo cambiar."
        : nuevo === origen
          ? "Puente apuntando a este equipo. Los documentos llegan al panel en /supervision."
          : "Puente devuelto al hub de producción."
    );
  };

  const sincronizarPuente = async (): Promise<void> => {
    if (puenteSincronizando) return; // un ciclo a la vez (debounce del kit)
    setPuenteSincronizando(true);
    setPuenteFeedback("Sincronizando…");
    try {
      const resumen = await sincronizarAhora();
      setPuenteFeedback(resumen.detalle);
      setPuenteEstado(estadoPuente());
      setPuentePendientes(await contarPendientes());
    } catch {
      // el fallo ya sube a la tarjeta del puente como feedback visible
      setPuenteFeedback("Error: no se pudo sincronizar");
    } finally {
      setPuenteSincronizando(false);
    }
  };

  useEffect(() => {
    if (!reiniciarArmado) return;
    const t = window.setTimeout(() => setReiniciarArmado(false), 4000);
    return () => window.clearTimeout(t);
  }, [reiniciarArmado]);

  const origenEquipo = typeof window === "undefined" ? "" : window.location.origin;
  const hubEsLocal = hubUsado === origenEquipo;

  // ── PREVIEW de la plantilla ACTIVA (REAL): construirChecklist con un acta
  // mínima SOLO para listar los campos que la definición verifica. El
  // resultado son los GRUPOS de la plantilla con su cantidad de verificaciones
  // (los estados por documento viven en REVISIÓN, aquí NO se muestran).
  const previewPlantilla = useMemo(() => {
    const pl = construirChecklist({} as Acta);
    return pl.grupos.map((g) => ({ titulo: g.titulo, total: g.items.length }));
  }, []);
  const totalVerificaciones = previewPlantilla.reduce((n, g) => n + g.total, 0);
  const obligatorios = previewPlantilla
    .filter((g) => g.titulo === "Huellas / Firmas" || g.titulo === "Campos Obligatorios")
    .reduce((n, g) => n + g.total, 0);
  const opcionales = totalVerificaciones - obligatorios;

  // ── Registro del molde personalizado (REAL: file → JSON → localStorage).
  const registrarArchivo = async (file: File): Promise<void> => {
    if (!file.name.toLowerCase().endsWith(".json")) {
      setFeedbackMolde("Archivo inválido: se espera un .json de definición.");
      return;
    }
    try {
      const texto = await file.text();
      JSON.parse(texto); // validación mínima: debe ser JSON parseable
      const registro: MoldeLocal = {
        nombre: file.name,
        tamanoKb: Math.max(0.1, Math.round((file.size / 1024) * 10) / 10),
        fecha: new Date().toLocaleString("es-CO"),
      };
      window.localStorage.setItem(CLAVE_MOLDE, JSON.stringify(registro));
      setMoldeLocal(registro);
      setFeedbackMolde(`Molde registrado: ${file.name} (${registro.tamanoKb} KB).`);
    } catch {
      setFeedbackMolde("El archivo no es un JSON válido — molde no registrado.");
    }
  };

  const eliminarMolde = (): void => {
    try {
      window.localStorage.removeItem(CLAVE_MOLDE);
    } catch {
      /* sin almacenamiento no hay molde que quitar */
    }
    setMoldeLocal(null);
    setFeedbackMolde("Molde personalizado eliminado. Activo: plantilla base integrada.");
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto thin-scroll bg-[#090d12] flex flex-col">
      <header className="sticky top-0 z-40 w-full bg-[#090d12]/92 backdrop-blur-xl border-b border-slate-800/80 px-4 h-14 shrink-0 shadow-xs">
        {/* KIT e14-observabilidad-v1 (agente 2 · C1): tuerca SIEMPRE visible
            arriba-izquierda del header; el contenido se corre a la derecha. */}
        <div className="absolute left-2 top-1/2 -translate-y-1/2 z-50">
          <TuercaResumen onAbrirPanel={() => setPanelAbierto(true)} />
        </div>
        <div className="max-w-md lg:max-w-2xl mx-auto w-full h-full flex items-center justify-between pl-[56px]">
          <div className="flex items-center gap-2 min-w-0">
            <StitchDocIcon className="w-4 h-4 text-[#10b981] shrink-0" />
            <h1 className="font-mono text-sm font-bold tracking-widest text-[#10b981] uppercase truncate">
              PLANTILLAS
            </h1>
          </div>
          <span className="font-mono text-[10px] font-bold text-slate-300 bg-slate-800/60 px-2 py-1 rounded-md border border-slate-700/60 uppercase tracking-wider whitespace-nowrap shrink-0">
            MODO LOCAL
          </span>
        </div>
      </header>

      <div className="flex-grow flex flex-col gap-4 px-4 pt-4 pb-8 max-w-md lg:max-w-2xl mx-auto w-full">
        {/* Entrada al modo genérico (flujo guiado multipágina, 2026-11-23):
            enlace ADITIVO — no toca el flujo E-14. */}
        <Link
          href="/generico/"
          className="flex items-center gap-3 rounded-xl border border-sky-800/60 bg-sky-500/10 px-4 py-3 hover:border-sky-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
        >
          <span aria-hidden className="font-mono text-sm font-black text-sky-300">
            G
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-bold text-white">
              Modo genérico — flujo guiado
            </span>
            <span className="block font-mono text-[10px] uppercase tracking-wider text-sky-300/80">
              Plantillas incluidas · multipágina con score
            </span>
          </span>
        </Link>

        {/* ── CARGAR MOLDE .JSON (mock: borde punteado + botón verde). */}
        <section
          className="rounded-2xl border-2 border-dashed border-slate-700 bg-[#10161f]/60 p-5 flex flex-col items-center gap-3 text-center"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files?.[0];
            if (file) void registrarArchivo(file);
          }}
        >
          <span className="w-14 h-14 rounded-xl bg-[#10b981]/15 border border-[#10b981]/40 text-[#10b981] flex items-center justify-center">
            <StitchDocIcon className="w-6 h-6" />
          </span>
          <h2 className="font-mono text-sm font-bold tracking-wider text-white uppercase">
            Cargar Molde .JSON
          </h2>
          <p className="text-[11px] font-mono text-slate-400 leading-relaxed">
            Arrastra o selecciona el archivo de definición (.json)
          </p>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-700 bg-[#090d12] font-mono text-[9.5px] font-bold text-slate-400 uppercase tracking-wider">
            <DocLineIcon className="w-3 h-3" />
            Almacenamiento local en dispositivo
          </span>
          <button
            type="button"
            onClick={() => inputArchivo.current?.click()}
            className="mt-1 px-5 py-2.5 rounded-lg bg-[#10b981] text-[#052012] font-mono text-[11px] font-bold uppercase tracking-wider shadow-[0_2px_14px_rgba(16,185,129,0.35)] hover:brightness-110 active:scale-[0.98] transition cursor-pointer min-h-[44px]"
          >
            Seleccionar archivo local
          </button>
          <input
            ref={inputArchivo}
            type="file"
            accept=".json,application/json"
            className="hidden"
            aria-label="Seleccionar archivo de molde .json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void registrarArchivo(file);
              e.target.value = ""; // permite re-cargar el mismo archivo
            }}
          />
          {feedbackMolde && (
            <p
              role="status"
              className={`font-mono text-[10px] leading-relaxed ${
                feedbackMolde.startsWith("Archivo inválido") || feedbackMolde.startsWith("El archivo")
                  ? "text-amber-400"
                  : "text-[#10b981]"
              }`}
            >
              {feedbackMolde}
            </p>
          )}
        </section>

        {/* ── MOLDE VINCULADO AL DISPOSITIVO (mock: sección + 1 ACTIVO). */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
            Molde vinculado al dispositivo
          </span>
          <span className="shrink-0 inline-flex items-center gap-1 font-mono text-[10px] font-bold text-[#10b981] uppercase tracking-wider">
            <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" aria-hidden />
            1 ACTIVO
          </span>
        </div>

        <section className="bg-[#10161f] border border-[#10b981]/30 rounded-2xl p-4 lg:p-5 flex flex-col gap-3 shadow-sm">
          {/* Chips de estado (mock: ACTIVO EN DISPOSITIVO · SCHEMA · COMPATIBLE). */}
          <div className="flex flex-wrap gap-1.5">
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[#10b981]/40 bg-[#10b981]/10 font-mono text-[9px] font-bold text-[#10b981] uppercase tracking-wider">
              <span className="w-1 h-1 rounded-full bg-[#10b981]" aria-hidden />
              {moldeLocal ? "Molde personalizado" : "Activo en dispositivo"}
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-700 bg-[#090d12] font-mono text-[9px] font-bold text-slate-300 uppercase tracking-wider">
              Esquema base v1
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-700 bg-[#090d12] font-mono text-[9px] font-bold text-slate-300 uppercase tracking-wider">
              ✓ Compatible motor OCR
            </span>
          </div>

          {/* Título + archivo. */}
          <div>
            <h2 className="text-base lg:text-lg font-bold text-[#10b981] leading-snug">
              {moldeLocal ? moldeLocal.nombre.replace(/\.json$/i, "") : "Documento · Plantilla base integrada"}
            </h2>
            <p className="font-mono text-[10px] text-slate-500 mt-0.5">
              {moldeLocal ? moldeLocal.nombre : "plantilla base · integrada en la app"}
            </p>
          </div>

          {/* Tamaño en caché (mock: fila interna). */}
          <div className="flex items-center justify-between rounded-lg bg-[#090d12]/70 border border-slate-800/80 px-3 py-2.5">
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Tamaño en caché:
            </span>
            <span className="font-mono text-[11px] font-bold text-white">
              {moldeLocal ? `${moldeLocal.tamanoKb} KB` : "INTEGRADA"}
            </span>
          </div>
          {moldeLocal?.fecha && (
            <p className="font-mono text-[9.5px] text-slate-500 -mt-1.5">
              Registrado: {moldeLocal.fecha}
            </p>
          )}

          {/* Preview del molde (REAL: campos definidos por la plantilla). */}
          <div className="flex items-center gap-2 border-t border-slate-800/80 pt-3">
            <span className="w-4 h-4 rounded border border-[#10b981]/40 bg-[#10b981]/10 text-[#10b981] flex items-center justify-center font-mono text-[9px] font-black shrink-0">
              ⚙
            </span>
            <span className="font-mono text-[10.5px] font-bold text-white uppercase tracking-wide">
              Preview del molde
            </span>
            <span className="font-mono text-[10px] font-bold text-[#10b981] ml-auto whitespace-nowrap">
              {obligatorios} OBLIGATORIOS / {opcionales} OPCIONALES
            </span>
          </div>
          <p className="font-mono text-[9.5px] font-bold uppercase tracking-wider text-slate-500">
            Campos que verifica la plantilla:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {previewPlantilla.map((g) => (
              <span
                key={g.titulo}
                className="px-2 py-1 rounded-md border border-slate-700 bg-[#090d12] font-mono text-[9.5px] font-bold text-slate-200 uppercase tracking-wide"
              >
                {g.titulo} ({g.total})
              </span>
            ))}
          </div>

          {/* Acciones (mock: REEMPLAZAR · ELIMINAR · PROBAR). */}
          <div className="grid grid-cols-3 gap-2 border-t border-slate-800/80 pt-3">
            <button
              type="button"
              onClick={() => inputArchivo.current?.click()}
              className="px-2 py-2.5 rounded-lg border border-slate-700 bg-[#090d12] font-mono text-[10px] font-bold text-slate-200 hover:border-[#10b981]/50 hover:text-[#10b981] uppercase tracking-wider transition cursor-pointer min-h-[40px]"
            >
              Reemplazar .JSON
            </button>
            <button
              type="button"
              onClick={eliminarMolde}
              disabled={!moldeLocal}
              aria-disabled={!moldeLocal}
              className="px-2 py-2.5 rounded-lg border border-red-500/40 bg-[#090d12] font-mono text-[10px] font-bold text-[#E52222] hover:border-red-500 hover:bg-red-500/10 uppercase tracking-wider transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed min-h-[40px]"
            >
              Eliminar
            </button>
            <button
              type="button"
              onClick={() => navegar("escanear")}
              className="px-2 py-2.5 rounded-lg bg-[#10b981] text-[#052012] font-mono text-[10px] font-bold uppercase tracking-wider shadow-[0_2px_12px_rgba(16,185,129,0.3)] hover:brightness-110 active:scale-[0.98] transition cursor-pointer min-h-[40px]"
            >
              Probar
            </button>
          </div>
        </section>

        {/* ── AJUSTES DE SISTEMA (colapsado al pie — operativa del
            mantenedor: puente a supervisión + reiniciar jornada). */}
        <section className="rounded-2xl border border-slate-800 bg-[#10161f]/60 overflow-hidden">
          <button
            type="button"
            onClick={() => setAjustesAbiertos((v) => !v)}
            aria-expanded={ajustesAbiertos}
            className="w-full min-h-[44px] px-4 py-2.5 flex items-center justify-between gap-2 cursor-pointer select-none text-left hover:bg-[#17222f] transition-colors"
          >
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
              Ajustes de sistema
            </span>
            <span className="flex items-center gap-2">
              <span
                className={`font-mono text-[9px] font-bold uppercase ${
                  puenteEstado && !puenteEstado.activo ? "text-red-400" : "text-[#10b981]"
                }`}
              >
                {puenteEstado ? (puenteEstado.activo ? "PUENTE ACTIVO" : "PUENTE DETENIDO") : "—"}
              </span>
              <span
                className={`font-mono text-[10px] text-slate-400 transition-transform duration-200 ${
                  ajustesAbiertos ? "rotate-180" : ""
                }`}
                aria-hidden
              >
                ▼
              </span>
            </span>
          </button>

          {ajustesAbiertos && (
            <div className="px-4 pb-4 flex flex-col gap-3 border-t border-slate-800/80 pt-3">
              {/* Puente a supervisión. */}
              <div className="flex flex-col gap-2.5">
                <p className="text-xs text-slate-400 font-mono">
                  Envía los documentos ENVIADOS al panel de supervisión en vivo.
                </p>
                {hubUsado && (
                  <p className="text-[11px] font-mono text-slate-400 break-all">
                    hub: {hubUsado}
                  </p>
                )}
                <div className="text-[11px] font-mono text-slate-400 flex flex-col gap-1">
                  <span>
                    {puentePendientes} pendientes · {puenteEstado?.enviadasOk ?? 0} enviadas
                    {puenteEstado?.ultimaSyncTs
                      ? ` · última ${new Date(puenteEstado.ultimaSyncTs).toLocaleTimeString()}`
                      : ""}
                  </span>
                  {puenteEstado?.ultimoError && (
                    <span className="text-amber-400 break-words">
                      Último error: {puenteEstado.ultimoError}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void sincronizarPuente();
                  }}
                  disabled={puenteSincronizando}
                  aria-label="Sincronizar ahora con el panel de supervisión"
                  className="w-full min-h-[44px] px-4 rounded-xl border font-mono text-[11px] font-bold uppercase tracking-wider transition-all duration-150 cursor-pointer disabled:opacity-60 disabled:cursor-wait border-emerald-500/40 bg-[#10161f] text-[#10b981] hover:border-emerald-400 hover:bg-emerald-500/10"
                >
                  {puenteSincronizando ? "SINCRONIZANDO…" : "SINCRONIZAR AHORA"}
                </button>
                {enRedLocal && (
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={apuntarHubLocal}
                      aria-pressed={hubEsLocal}
                      aria-label="Apuntar el puente al hub local de este equipo"
                      className="w-full min-h-[44px] px-4 rounded-xl border font-mono text-[11px] font-bold uppercase tracking-wider transition-all duration-150 cursor-pointer border-sky-500/40 bg-[#10161f] text-sky-300 hover:border-sky-400 hover:bg-sky-500/10"
                    >
                      {hubEsLocal
                        ? "HUB LOCAL: ESTE EQUIPO · tocar para producción"
                        : "USAR HUB LOCAL (ESTE EQUIPO)"}
                    </button>
                    <a
                      href="/supervision/"
                      className="w-full min-h-[44px] px-4 py-3 rounded-xl border border-slate-700 text-center font-mono text-[11px] font-bold uppercase tracking-wider text-slate-300 no-underline hover:border-slate-500"
                    >
                      abrir panel de supervisión
                    </a>
                  </div>
                )}
                {puenteFeedback && (
                  <span className="text-[11px] font-mono text-slate-300">
                    {puenteFeedback}
                  </span>
                )}
              </div>

              {/* Reiniciar jornada. */}
              <button
                type="button"
                onClick={() => {
                  if (!reiniciarArmado) {
                    setReiniciarArmado(true);
                    return;
                  }
                  setReiniciarArmado(false);
                  void reiniciarJornada();
                }}
                aria-label={
                  reiniciarArmado
                    ? "Confirmar reiniciar la jornada completa"
                    : "Reiniciar la jornada completa"
                }
                className={`w-full min-h-[44px] px-4 rounded-xl border font-mono text-[11px] font-bold uppercase tracking-wider transition-all duration-150 cursor-pointer ${
                  reiniciarArmado
                    ? "border-red-500 text-red-400 bg-red-500/15 shadow-sm shadow-red-500/20"
                    : "border-slate-800 bg-[#10161f] text-slate-400 hover:border-red-500/50 hover:text-red-400"
                }`}
              >
                {reiniciarArmado
                  ? "¿SEGURO? TOQUE DE NUEVO PARA REINICIAR JORNADA"
                  : "REINICIAR JORNADA"}
              </button>
            </div>
          )}
        </section>
      </div>

      {/* KIT e14-observabilidad-v1 (agente 2 · C4): panel de diagnóstico —
          overlay fijo (z-[70]) montado desde la tuerca. */}
      {panelAbierto && <PanelDev onClose={() => setPanelAbierto(false)} />}
    </div>
  );
}
