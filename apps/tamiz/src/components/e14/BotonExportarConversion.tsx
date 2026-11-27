/**
 * Botón EXPORTAR CONVERSIÓN (cierre del Benchmark OCR V3 — chandra-convert
 * OFICIAL por decisión del dueño, 2026-11-27).
 *
 * Convierte el acta actual (1..N páginas del documento en curso) al esquema
 * datalab-convert (Chandra) con `chandra-bridge.ts` y descarga:
 *   · JSON principal — el exacto que `importar-chandra.ts` de Molde Studio
 *     consume (loop: escanear en el celular → recalibrar molde sin Datalab).
 *   · .md / .html opcionales (lectura estructurada con `data-bbox`).
 *
 * HONESTIDAD: muestra el resultado del autochequeo de esquema y los avisos;
 * el OCR re-corrre al exportar (~1-3 s por página, mismo proveedor de la
 * evaluación). Si el autochequeo falla, el JSON se descarga igual pero la UI
 * lo señala (nada silencioso).
 */

"use client";

import { useMemo, useState } from "react";
import { useE14Store } from "@/lib/e14/store";
import { downloadBlob } from "@/lib/e14/core/pdf-export";
import { convertirActaAChandra } from "@/lib/e14/conversion/chandra-bridge";
import { ScanTextIcon } from "../e14/icons";

type Estado = "idle" | "convirtiendo" | "listo" | "error";

export function BotonExportarConversion() {
  const acta = useE14Store((s) => s.actaActual);
  const enCurso = useE14Store((s) => s.documentoEnCurso);

  const [estado, setEstado] = useState<Estado>("idle");
  const [resultado, setResultado] = useState<Awaited<ReturnType<typeof convertirActaAChandra>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Páginas a convertir: el documento en curso (1..N) o el acta de la página. */
  const fotos = useMemo(() => {
    if (enCurso && enCurso.paginas.length > 0) {
      return enCurso.paginas.map((p) => p.fotoProcesada).filter((f): f is string => Boolean(f));
    }
    return acta?.fotoProcesada ? [acta.fotoProcesada] : [];
  }, [enCurso, acta]);

  const resumen = acta?.evaluacionMolde ?? null;

  if (fotos.length === 0) return null;

  const nombreBase = `conversion-chandra-${acta?.id ?? "acta"}`;

  async function convertirYDescargarJson() {
    setEstado("convirtiendo");
    setError(null);
    try {
      const r = await convertirActaAChandra(fotos, resumen);
      setResultado(r);
      downloadBlob(new Blob([r.jsonTexto], { type: "application/json" }), `${nombreBase}.json`);
      setEstado("listo");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setEstado("error");
    }
  }

  function descargarExtra(tipo: "md" | "html") {
    if (!resultado) return;
    const contenido = tipo === "md" ? resultado.md : resultado.html;
    const mime = tipo === "md" ? "text/markdown" : "text/html";
    downloadBlob(new Blob([contenido], { type: mime }), `${nombreBase}.${tipo}`);
  }

  const ocupado = estado === "convirtiendo";

  return (
    <div className="mt-2 rounded-xl border border-slate-800 bg-[#10161f] p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
          Conversión datalab (Chandra) · {fotos.length} pág.
        </div>
        <button
          type="button"
          onClick={() => void convertirYDescargarJson()}
          disabled={ocupado}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#10b981] text-[#052012] font-mono text-[11px] font-bold uppercase tracking-wide disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-[#10b981]/60 min-h-[44px]"
        >
          <ScanTextIcon className="w-4 h-4" aria-hidden />
          {ocupado ? "Convirtiendo… (OCR)" : "Exportar conversión (.json)"}
        </button>
      </div>

      {resultado && (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span
            className={`font-mono text-[10px] uppercase tracking-wide ${
              resultado.ok ? "text-[#10b981]" : "text-amber-400"
            }`}
            role="status"
          >
            {resultado.ok ? "✓ esquema datalab verificado" : "⚠ autochequeo con avisos"}
            {resultado.avisos.length > 0 && ` · ${resultado.avisos.length} aviso(s)`}
          </span>
          <span className="inline-flex gap-2">
            <button
              type="button"
              onClick={() => descargarExtra("md")}
              className="px-2.5 py-1.5 rounded-lg border border-slate-700 text-slate-300 font-mono text-[10px] uppercase hover:border-slate-500 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 min-h-[36px]"
            >
              .md
            </button>
            <button
              type="button"
              onClick={() => descargarExtra("html")}
              className="px-2.5 py-1.5 rounded-lg border border-slate-700 text-slate-300 font-mono text-[10px] uppercase hover:border-slate-500 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 min-h-[36px]"
            >
              .html
            </button>
          </span>
        </div>
      )}

      {resultado && resultado.avisos.length > 0 && (
        <ul className="font-mono text-[10px] text-slate-500 leading-relaxed list-disc pl-4 max-h-24 overflow-y-auto">
          {resultado.avisos.slice(0, 8).map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      )}

      {estado === "error" && error && (
        <p className="font-mono text-[10px] text-[#E52222]" role="alert">
          ✗ {error}
        </p>
      )}

      <p className="font-mono text-[9px] text-slate-600 leading-relaxed">
        El JSON pasa el autochequeo del esquema datalab-convert y es consumible
        por Molde Studio (IMPORTAR CHANDRA) para recalibrar el molde sin Datalab.
      </p>
    </div>
  );
}
