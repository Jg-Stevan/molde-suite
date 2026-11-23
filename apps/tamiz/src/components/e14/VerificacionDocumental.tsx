'use client';

/**
 * VERIFICACIÓN DOCUMENTAL (mock del mantenedor, 2026-11-16) — P4 del plan
 * PLAN-AJUSTES-VISUALES (adaptación E-14 del parche del zip táctico):
 *
 *  · OVERLAY sobre la foto del documento en REVISIÓN (P5): la fila-resumen
 *    (icono del gate + título + badge % + chevron) siempre visible y clicable;
 *    el panel desplegado flota SOBRE la imagen con fondo oscuro semitransparente
 *    (backdrop-blur) — no empuja el contenido, no crea scroll.
 *  · Comportamiento por estado (P4):
 *      - OPTIMA/ENVIADA (todo OK): COLAPSADA por defecto; al abrirla muestra
 *        el detalle completo (todos los items).
 *      - ADVERTENCIA / RECHAZADA / EN_REVISION_HUMANA: DESPLEGADA por defecto
 *        mostrando SOLO los campos faltantes (los OK no se listan). El badge
 *        [pasados/total] conserva el conteo COMPLETO del checklist.
 *      - RECHAZADA sin clasificación (sin plantilla conocida): mensaje
 *        «DOCUMENTO NO IDENTIFICADO — SIN PLANTILLA CONOCIDA» (el 5.º estado
 *        del ciclo del zip).
 *
 * Los datos siguen siendo los MISMOS data-driven de lib/e14/checklist.ts
 * (cero lógica nueva en el motor, solo la piel del mock + reglas P4).
 */

import { useEffect, useMemo, useState } from 'react';
import type { Acta } from '@/lib/e14/fachada';
import {
  construirChecklist,
  tonoDeStatus,
  type EstadoChecklist,
  type ItemChecklist,
  type TonoChecklist,
} from '@/lib/e14/checklist';

/** Texto del badge de porcentaje del header, por tono del gate. */
const PALABRA_TONO: Record<TonoChecklist, string> = {
  ok: 'OK',
  warn: 'ALERTA',
  crit: 'RECHAZADO',
};

/** Paleta de la fila-resumen por tono del gate. */
const TONO_TARJETA: Record<TonoChecklist, { borde: string; texto: string; icono: string }> = {
  ok: {
    borde: 'border-[#10b981]/40',
    texto: 'text-[#10b981] border-[#10b981]/40 bg-[#10b981]/10',
    icono: 'bg-[#10b981]/15 text-[#10b981] border-[#10b981]/40',
  },
  warn: {
    borde: 'border-amber-500/60',
    texto: 'text-amber-400 border-amber-500/50 bg-amber-500/10',
    icono: 'bg-amber-500/15 text-amber-400 border-amber-500/40',
  },
  crit: {
    borde: 'border-red-500/60',
    texto: 'text-[#E52222] border-red-500/50 bg-red-500/10',
    icono: 'bg-red-500/15 text-[#E52222] border-red-500/40',
  },
};

/** Colores del VALOR de cada fila según el estado del item. */
const VALOR_ESTADO: Record<EstadoChecklist, string> = {
  ok: 'text-[#10b981]',
  alerta: 'text-amber-400',
  fallo: 'text-[#E52222]',
};

const GLIFO: Record<EstadoChecklist, string> = { ok: '✓', alerta: '•', fallo: '✗' };
const GLIFO_COLOR: Record<EstadoChecklist, string> = {
  ok: 'text-[#10b981]',
  alerta: 'text-amber-400',
  fallo: 'text-[#E52222]',
};

/** Icono circular del header por tono (mock: ✓ / ⚠ / ✗ dentro de un chip). */
function IconoGate({ tono }: { tono: TonoChecklist }) {
  const glifo = tono === 'ok' ? '✓' : tono === 'warn' ? '!' : '✗';
  return (
    <span
      aria-hidden
      className={`shrink-0 w-6 h-6 rounded-full border flex items-center justify-center font-mono text-xs font-black ${TONO_TARJETA[tono].icono}`}
    >
      {glifo}
    </span>
  );
}

/** Una sección del panel (mock: título bold + badge [N/M] + filas).
 *  P4: cuando `soloFaltantes` está activo, la LISTA muestra únicamente los
 *  items con problema (los OK no se listan); el badge conserva el conteo
 *  completo [pasados/total] para no perder la perspectiva del progreso. */
function SeccionVerificacion({
  titulo,
  items,
  soloFaltantes,
  desplegable,
  abierta,
  onToggle,
}: {
  titulo: string;
  items: ItemChecklist[];
  soloFaltantes: boolean;
  desplegable?: boolean;
  abierta?: boolean;
  onToggle?: () => void;
}) {
  const total = items.length;
  const pasados = items.filter((it) => it.estado === 'ok').length;
  const completo = pasados === total;
  const tonoSeccion: TonoChecklist = items.some((it) => it.estado === 'fallo')
    ? 'crit'
    : items.some((it) => it.estado === 'alerta')
      ? 'warn'
      : 'ok';

  // P4 — solo faltantes cuando el gate no está OK (defensivo: si el filtro
  // vaciara la sección, se muestra la lista completa para no perder info).
  const visibles = soloFaltantes
    ? items.filter((it) => it.estado !== 'ok')
    : items;
  const lista = visibles.length > 0 ? visibles : items;

  // Encabezado de la sección: cuando es desplegable, el encabezado ES el
  // toggle (evita duplicar la fila «Campos Opcionales»). Título dinámico
  // del mock: colapsado añade «(desplegables)».
  const tituloMostrado =
    desplegable && !abierta ? `${titulo} (desplegables)` : titulo;

  return (
    <section aria-label={tituloMostrado} className="flex flex-col">
      {desplegable && onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={abierta}
          className="w-full flex items-center justify-between gap-2 min-h-[34px] cursor-pointer select-none text-left"
        >
          <EncabezadoContenido titulo={tituloMostrado} tonoSeccion={tonoSeccion} />
          <span className="flex items-center gap-1.5 shrink-0">
            <BadgeConteo completo={completo} tonoSeccion={tonoSeccion} pasados={pasados} total={total} soloFaltantes={soloFaltantes} />
            <span aria-hidden className="font-mono text-[10px] text-slate-400">
              {abierta ? '▲' : '▼'}
            </span>
          </span>
        </button>
      ) : (
        <div className="w-full flex items-center justify-between gap-2 min-h-[34px]">
          <EncabezadoContenido titulo={tituloMostrado} tonoSeccion={tonoSeccion} />
          <BadgeConteo completo={completo} tonoSeccion={tonoSeccion} pasados={pasados} total={total} soloFaltantes={soloFaltantes} />
        </div>
      )}

      {/* La lista se oculta SOLO en las secciones desplegables colapsadas
          (las secciones fijas — Campos Obligatorios — siempre la muestran). */}
      {(!desplegable || abierta) && (
        <ul className="mt-1 space-y-0.5">
        {lista.map((item) => (
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

/** Contenido del encabezado de sección (dot + título bold). */
function EncabezadoContenido({ titulo, tonoSeccion }: { titulo: string; tonoSeccion: TonoChecklist }) {
  return (
    <span className="flex items-center gap-2 min-w-0">
      <span
        aria-hidden
        className={`shrink-0 w-1.5 h-1.5 rounded-full ${
          tonoSeccion === 'ok' ? 'bg-[#10b981]' : tonoSeccion === 'warn' ? 'bg-amber-400' : 'bg-[#E52222]'
        }`}
      />
      <span className="text-[12px] font-bold text-white truncate">{titulo}</span>
    </span>
  );
}

/** Badge [pasados/total] de la sección (conteo COMPLETO, P4). */
function BadgeConteo({
  completo,
  tonoSeccion,
  pasados,
  total,
  soloFaltantes,
}: {
  completo: boolean;
  tonoSeccion: TonoChecklist;
  pasados: number;
  total: number;
  soloFaltantes: boolean;
}) {
  return (
    <span
      className={`font-mono text-[10px] font-bold px-2 py-0.5 rounded-md border shrink-0 ${
        completo
          ? 'text-[#10b981] border-[#10b981]/40 bg-[#10b981]/10'
          : tonoSeccion === 'crit'
            ? 'text-[#E52222] border-red-500/40 bg-red-500/10'
            : 'text-amber-400 border-amber-500/40 bg-amber-500/10'
      }`}
    >
      {pasados}/{total}
      {completo ? ' ✓' : soloFaltantes ? ` · FALTAN ${total - pasados}` : ''}
    </span>
  );
}

/** Utilidad: fusiona los items de una lista de grupos en UNA lista. */
function fusionarGrupos(
  grupos: ReturnType<typeof construirChecklist>['grupos'],
  ids: string[],
): ItemChecklist[] {
  return grupos.filter((g) => ids.includes(g.id)).flatMap((g) => g.items);
}

/** Tarjeta VERIFICACIÓN DOCUMENTAL.
 *  · overlay (default true): fila-resumen flotante sobre la foto — colapsada
 *    ocupa solo la barra (la foto queda tocable); desplegada, el panel llena
 *    el área disponible (flex-1) y scrollea por dentro.
 *  · overlay=false: tarjeta EN FLUJO con fondo propio (fallback sin foto). */
export function VerificacionDocumental({
  acta,
  overlay = true,
}: {
  acta: Acta;
  overlay?: boolean;
}) {
  const checklist = useMemo(() => construirChecklist(acta), [acta]);
  const tono = tonoDeStatus(acta.status);
  const piel = TONO_TARJETA[tono];

  // ── P4 — SIN PLANTILLA: rechazada sin clasificación NI texto útil
  // (ILEGIBLE: ni código de barras ni cabecera detectados → nada que
  // verificar). Las RECHAZADAS con OCR válido (GENERICO — documento
  // E-14 de mala calidad) SÍ muestran el checklist con solo faltantes.
  const sinPlantilla =
    acta.status === 'RECHAZADA' &&
    acta.clasificacion == null &&
    (acta.rechazo == null || acta.rechazo.tipo === 'ILEGIBLE');

  // Dos listas del mock: bloqueantes (huellas + obligatorios) e informativos
  // (integridad + variables). Los grupos ausentes no aportan items.
  const obligatorios = useMemo(
    () => fusionarGrupos(checklist.grupos, ['huellas', 'obligatorios']),
    [checklist],
  );
  const opcionales = useMemo(
    () => fusionarGrupos(checklist.grupos, ['integridad', 'variables']),
    [checklist],
  );

  // Desplegable de OPCIONALES: null = automático por tono (colapsado cuando
  // todo está OK, desplegado en advertencia/rechazo). El toque del operador
  // fija el override; se resetea al cambiar el acta.
  const [overrideOpcionales, setOverrideOpcionales] = useState<boolean | null>(null);
  // P4 — tarjeta completa: colapsada por defecto cuando el gate está OK;
  // desplegada en advertencia/rechazo (y siempre en sin plantilla). El toque
  // del header fija el override. Reset al cambiar el acta.
  const hayZonasFaltantes = (acta.estructura?.reglas ?? []).some(
    (r) => r.estado === 'faltante',
  );
  const abiertaPorDefecto = sinPlantilla || tono !== 'ok' || hayZonasFaltantes;
  const [overrideAbierta, setOverrideAbierta] = useState<boolean | null>(null);
  const actaId = acta.id ?? null;
  useEffect(() => {
    setOverrideOpcionales(null);
    setOverrideAbierta(null);
  }, [actaId]);
  const abierta = overrideAbierta ?? abiertaPorDefecto;
  const opcionalesAbiertos = overrideOpcionales ?? tono !== 'ok';

  // P4 — contenido: óptima muestra TODO; el resto SOLO lo faltante.
  const soloFaltantes = tono !== 'ok';

  // Porcentaje global del gate (mock: badge del header).
  const totalItems = obligatorios.length + opcionales.length;
  const pasadosItems =
    obligatorios.filter((it) => it.estado === 'ok').length +
    opcionales.filter((it) => it.estado === 'ok').length;
  const pct = totalItems > 0 ? Math.round((pasadosItems / totalItems) * 100) : 0;

  return (
    <div
      aria-label="Verificación documental"
      data-testid="verificacion-documental"
      className={
        overlay
          ? abierta
            ? 'flex flex-col gap-1.5 flex-1 min-h-0'
            : 'flex flex-col gap-1.5'
          : 'bg-[#10161f] rounded-2xl border border-slate-800 shadow-sm p-3.5 flex flex-col gap-2.5'
      }
    >
      {/* Fila-resumen: SIEMPRE visible y clicable (overlay flotante sobre la
          foto, estilo táctico del zip: barra oscura semitransparente). */}
      <button
        type="button"
        onClick={() => setOverrideAbierta(!abierta)}
        aria-expanded={abierta}
        aria-controls="verificacion-detalle"
        data-testid="verificacion-toggle"
        className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[#0d131a]/90 backdrop-blur border ${piel.borde} w-full text-left cursor-pointer select-none transition-colors hover:border-slate-600`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <IconoGate tono={tono} />
          <h2 className="text-[11px] font-bold text-white uppercase tracking-wider truncate">
            Verificación Documental
          </h2>
        </div>
        <span className="flex items-center gap-1.5 shrink-0">
          <span
            data-testid="checklist-counter"
            aria-label={
              sinPlantilla
                ? 'Documento no identificado — sin plantilla'
                : `${pct} por ciento · ${PALABRA_TONO[tono]}`
            }
            className={`font-mono text-[9px] font-bold px-2 py-0.5 rounded-md border ${piel.texto}`}
          >
            {sinPlantilla ? 'SIN PLANTILLA' : `${pct}% ${PALABRA_TONO[tono]}`}
          </span>
          <span
            aria-hidden
            className={`font-mono text-[10px] text-slate-400 transition-transform duration-150 ${abierta ? 'rotate-180' : ''}`}
          >
            ▼
          </span>
        </span>
      </button>

      {/* Panel desplegado — flota SOBRE la imagen (blur oscuro semitransparente).
          En overlay llena el área disponible (flex-1) y scrollea por dentro;
          en flujo usa un tope de altura propio. */}
      {abierta && (
        <div
          id="verificacion-detalle"
          role="region"
          aria-label="Detalle de verificación documental"
          data-testid="verificacion-detalle"
          className={
            overlay
              ? 'rounded-lg bg-[#0d131a]/85 backdrop-blur-md border border-slate-800/80 p-2.5 flex flex-col gap-2.5 flex-1 min-h-0 overflow-y-auto thin-scroll'
              : 'rounded-lg bg-[#0d131a]/85 border border-slate-800/80 p-2.5 flex flex-col gap-2.5 max-h-[60vh] overflow-y-auto thin-scroll'
          }
        >
          {sinPlantilla ? (
            <div className="min-h-[110px] flex flex-col items-center justify-center gap-1.5 text-center py-3">
              <span
                aria-hidden
                className="shrink-0 w-9 h-9 rounded-full border border-red-500/40 bg-red-500/15 text-[#E52222] flex items-center justify-center font-mono text-base font-black"
              >
                ⚠
              </span>
              <p className="text-[11px] font-extrabold tracking-widest text-[#E52222] uppercase">
                Documento no identificado
              </p>
              <p className="text-[9.5px] text-slate-400 font-mono tracking-tight">
                SIN PLANTILLA CONOCIDA — NO VERIFICADO
              </p>
            </div>
          ) : (
            <>
              {/* Sección 1 — Campos Obligatorios (P4: solo faltantes si el
                  gate no está OK; badge con conteo completo). */}
              {obligatorios.length > 0 && (
                <SeccionVerificacion
                  titulo="Campos Obligatorios"
                  items={obligatorios}
                  soloFaltantes={soloFaltantes}
                />
              )}

              {/* Sección 2 — Campos Opcionales (desplegable, regla del mock):
                  el encabezado de la sección ES el toggle (una sola fila). */}
              {opcionales.length > 0 && (
                <SeccionVerificacion
                  titulo="Campos Opcionales"
                  items={opcionales}
                  soloFaltantes={soloFaltantes}
                  desplegable
                  abierta={opcionalesAbiertos}
                  onToggle={() => setOverrideOpcionales(!opcionalesAbiertos)}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
