'use client';

/**
 * VERIFICACIÓN DOCUMENTAL — fila-resumen propia del layout ARRIBA de la foto
 * (mocks del mantenedor 2026-11-25; overlay del panel 2026-11-26): la
 * fila-resumen (icono del gate + título + badge % + chevron) siempre visible y
 * clicable; el panel se despliega como ACORDEÓN suave (grid-rows 0fr→1fr),
 * scrollea por dentro y FLOTA sobre la foto (portal al visor) — la imagen no
 * se re-escala al abrir ni al cerrar y la pantalla no scrollea.
 *  · Comportamiento por estado:
 *      - OPTIMA/ENVIADA (todo OK): COLAPSADA por defecto; al abrirla muestra
 *        el detalle completo (todos los items).
 *      - ADVERTENCIA / RECHAZADA / EN_REVISION_HUMANA: auto-despliegue al
 *        segundo de vida del acta mostrando SOLO los campos faltantes (los
 *        OK no se listan). El badge [pasados/total] conserva el conteo
 *        COMPLETO del checklist.
 *      - RECHAZADA sin clasificación (sin plantilla conocida): mensaje
 *        «DOCUMENTO NO IDENTIFICADO — SIN PLANTILLA CONOCIDA».
 *
 * Los datos siguen siendo los MISMOS data-driven de lib/e14/checklist.ts
 * (cero lógica nueva en el motor, solo la piel del mock).
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Acta } from '@/lib/e14/fachada';
import type { ResumenMoldeCampo } from '@molde-suite/scanner-core/dominio/types';
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

/** ETAPA B (enrutamiento universal): una fila del motor universal → item del
 *  checklist con el MISMO semáforo. Valores legibles por tipo de campo:
 *  texto → el valor leído; presencia/firma/checkbox → diligenciado o sin
 *  marca; dudoso → CONFIRMAR (revisión humana); vacío → SIN LECTURA. */
function itemDeFilaMolde(c: ResumenMoldeCampo): ItemChecklist {
  const estado: EstadoChecklist =
    c.estado === 'ok'
      ? 'ok'
      : c.estado === 'requiere_revision'
        ? 'alerta'
        : c.obligatorio
          ? 'fallo'
          : 'alerta';
  let detalle: string;
  if (c.estado === 'requiere_revision') {
    detalle = 'CONFIRMAR';
  } else if (c.estado === 'no_encontrado') {
    detalle = 'SIN LECTURA';
  } else if (typeof c.valor === 'boolean') {
    detalle = c.valor ? 'DILIGENCIADO' : 'SIN MARCA';
  } else if (typeof c.valor === 'string' && c.valor.trim()) {
    detalle = c.valor.trim();
  } else {
    detalle = 'SIN LECTURA';
  }
  return { id: c.id, etiqueta: c.etiqueta, detalle, estado };
}

/** Mueve su contenido al nodo `host` (el visor de la foto) cuando existe; sin
 *  host se queda en el flujo. El wrapper intermedio solo existe en el portal:
 *  así el panel absoluto no hereda el ancho de la columna. */
function EnVisor({
  host,
  className,
  children,
}: {
  host: HTMLElement | null;
  className: string;
  children: ReactNode;
}) {
  if (!host) return <>{children}</>;
  return createPortal(<div className={className}>{children}</div>, host);
}

/** Tarjeta VERIFICACIÓN DOCUMENTAL. `modo='overlay'`: la FILA-RESUMEN sigue
 *  siendo un elemento del layout (arriba de la foto, le cede su propia fila)
 *  pero el PANEL desplegado se portaliza DENTRO del visor, así que flota
 *  sobre la imagen sin re-escalarla nunca — abrir y cerrar no mueve la foto.
 *  `modo='flujo'`: todo en la columna (fallback sin foto), panel con tope. */
export function VerificacionDocumental({
  acta,
  modo = 'flujo',
  filtroPagina,
}: {
  acta: Acta;
  modo?: 'overlay' | 'flujo';
  /** Fase 3 (multipágina): muestra SOLO los campos de esta página (1-indexada;
   *  `c.pagina ?? 1`); el % del badge es el de la página. `null/undefined` =
   *  documento completo / molde de una página (sin filtro). */
  filtroPagina?: number | null;
}) {
  const checklist = useMemo(() => construirChecklist(acta), [acta]);
  const tono = tonoDeStatus(acta.status);
  const piel = TONO_TARJETA[tono];

  // ── ETAPA B (enrutamiento universal): acta reconocida por un MOLDE de la
  // biblioteca (`evaluacionMolde.enrutado`) → el checklist se construye de
  // las FILAS del motor universal con el semáforo de siempre (B.3). El
  // nombre del documento vive en el banner (acta.titulo) y en el caption.
  const molde = acta.evaluacionMolde?.enrutado ? acta.evaluacionMolde : null;
  // Plan primera ola (Fase 4): molde evaluado que NO sustituye el veredicto
  // del gate → pista de una línea (el % y las filas del checklist NO cambian).
  const moldeAditivo = acta.evaluacionMolde && !acta.evaluacionMolde.enrutado ? acta.evaluacionMolde : null;
  // Filas del motor universal → items del checklist (derivación barata; el
  // compilador de React memoiza automáticamente). Fase 3 (multipágina):
  // `filtroPagina` restringe la verificación a la página capturada.
  const filasMolde = useMemo(() => {
    const filas = molde?.campos ?? [];
    if (filtroPagina == null) return filas;
    return filas.filter((c) => (c.pagina ?? 1) === filtroPagina);
  }, [molde, filtroPagina]);
  const obligatoriosMolde = filasMolde
    .filter((c) => c.obligatorio)
    .map(itemDeFilaMolde);
  const opcionalesMolde = filasMolde
    .filter((c) => !c.obligatorio)
    .map(itemDeFilaMolde);

  // ── FASE 4 (v3.2.0 — interfaz táctica): cuando el molde declara `grupo`
  // (importador Chandra), el checklist se presenta AGRUPADO por sección de
  // lectura (Encabezado → Identificación → Cuerpo → Cierre) y ordenado por
  // `orden`, con los CRÍTICOS (obligatorios) arriba de cada grupo. Cero
  // lógica de negocio: solo presentación. Retrocompatible: sin grupo en el
  // molde → secciones Obligatorios/Opcionales de siempre.
  const gruposTacticos = useMemo(() => {
    if (!filasMolde.some((c) => (c.grupo ?? '').trim() !== '')) return null;
    const map = new Map<string, ResumenMoldeCampo[]>();
    for (const c of filasMolde) {
      const g = (c.grupo ?? '').trim() || 'General';
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(c);
    }
    return [...map.entries()].map(([titulo, camposGrupo]) => ({
      titulo,
      items: [...camposGrupo]
        .sort((a, b) => {
          // Críticos (obligatorios) arriba; luego por orden de lectura.
          if (Boolean(a.obligatorio) !== Boolean(b.obligatorio)) return a.obligatorio ? -1 : 1;
          const oa = a.orden ?? Number.MAX_SAFE_INTEGER;
          const ob = b.orden ?? Number.MAX_SAFE_INTEGER;
          if (oa !== ob) return oa - ob;
          return a.etiqueta.localeCompare(b.etiqueta);
        })
        .map(itemDeFilaMolde),
    }));
  }, [filasMolde]);

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
  // Auto-despliegue al segundo (mocks 2026-11-25): en no-OK la tarjeta nace
  // colapsada y se abre sola con el acordeón suave; el toque del operador
  // siempre gana (override). Reset al cambiar el acta.
  const [autoAbierta, setAutoAbierta] = useState(false);
  const actaId = acta.id ?? null;
  useEffect(() => {
    setOverrideOpcionales(null);
    setOverrideAbierta(null);
    setAutoAbierta(false);
  }, [actaId]);
  useEffect(() => {
    if (!abiertaPorDefecto) {
      setAutoAbierta(false);
      return;
    }
    const t = window.setTimeout(() => setAutoAbierta(true), 1000);
    return () => window.clearTimeout(t);
  }, [actaId, abiertaPorDefecto]);
  const abierta = overrideAbierta ?? autoAbierta;
  const opcionalesAbiertos = overrideOpcionales ?? tono !== 'ok';

  // P4 — contenido: óptima muestra TODO; el resto SOLO lo faltante.
  const soloFaltantes = tono !== 'ok';

  // Porcentaje global del gate (mock: badge del header) — para actas
  // ENRUTADAS el conteo sale de las filas del MOLDE (semáforo universal).
  const totalItems = molde
    ? obligatoriosMolde.length + opcionalesMolde.length
    : obligatorios.length + opcionales.length;
  const pasadosItems = molde
    ?
      obligatoriosMolde.filter((it) => it.estado === 'ok').length +
      opcionalesMolde.filter((it) => it.estado === 'ok').length
    :
      obligatorios.filter((it) => it.estado === 'ok').length +
      opcionales.filter((it) => it.estado === 'ok').length;
  const pct = totalItems > 0 ? Math.round((pasadosItems / totalItems) * 100) : 0;

  const esOverlay = modo === 'overlay';
  // OVERLAY (dueño 2026-11-26): el panel desplegado se monta dentro del visor
  // de la foto, no en la columna — abrir/cerrar NO re-escala la imagen. Se
  // resuelve tras el commit (el visor se renderiza después que esta barra);
  // mientras está colapsado (0fr) da igual, y el auto-open llega al segundo.
  const [visor, setVisor] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!esOverlay) {
      setVisor(null);
      return;
    }
    setVisor(document.querySelector<HTMLElement>('[data-purpose="visor-documento"]'));
  }, [esOverlay, actaId]);

  return (
    <div
      aria-label="Verificación documental"
      data-testid="verificacion-documental"
      className="flex flex-col gap-1.5 shrink-0"
    >
      {/* Fila-resumen: SIEMPRE visible y clicable, en su propia fila del
          layout (fuera de la imagen). */}
      <button
        type="button"
        onClick={() => setOverrideAbierta(!abierta)}
        aria-expanded={abierta}
        aria-controls="verificacion-detalle"
        data-testid="verificacion-toggle"
        className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[#0d131a] border ${piel.borde} w-full text-left cursor-pointer select-none transition-colors hover:border-slate-600 shrink-0`}
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

      {/* Pista ADITIVA del molde (solo si evaluó pero no enrutó): hace visible
          la identificación sin tocar el % ni las filas del checklist. */}
      {moldeAditivo && (
        <p
          data-testid="molde-pista"
          className="px-2.5 -mt-0.5 font-mono text-[10px] text-slate-400/90 truncate shrink-0"
        >
          MOLDE: {moldeAditivo.moldeNombre.toUpperCase()} · {Math.round(moldeAditivo.score)}% ·{' '}
          {moldeAditivo.ok}/{moldeAditivo.total}
        </p>
      )}

      {/* Panel desplegable — ACORDEÓN suave (grid-rows 0fr→1fr, CSS puro):
          siempre montado para animar apertura Y cierre; el contenido scrollea
          por dentro. En overlay se portaliza dentro del visor (`flex-1`, sin
          tope de altura): abierto cubre la foto entera y la pantalla NUNCA
          scrollea, porque el panel absoluto no le quita un píxel de alto. */}
      <EnVisor
        host={esOverlay ? visor : null}
        className="absolute inset-1.5 z-20 flex flex-col min-h-0 pointer-events-none"
      >
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          abierta ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        } ${esOverlay ? 'flex-1 min-h-0' : ''}`}
      >
        <div className="overflow-hidden min-h-0" inert={!abierta}>
        <div
          id="verificacion-detalle"
          role="region"
          aria-label="Detalle de verificación documental"
          data-testid="verificacion-detalle"
          className={`rounded-lg border border-slate-800/80 p-2.5 flex flex-col gap-2.5 overflow-y-auto thin-scroll ${
            esOverlay
              ? `h-full bg-[#0d131a]/95 backdrop-blur-[2px] ${abierta ? 'pointer-events-auto' : ''}`
              : 'bg-[#0d131a] max-h-[60vh]'
          }`}
        >
          {molde ? (
            <>
              {/* ETAPA B — caption del molde que identificó el documento. */}
              <p className="font-mono text-[9.5px] font-bold tracking-widest text-slate-300 uppercase shrink-0">
                Molde: {molde.moldeNombre.toUpperCase()} · {molde.ok}/{molde.total} campos ok
              </p>
              {gruposTacticos ? (
                <>
                  {/* FASE 4 (v3.2.0 — interfaz táctica): checklist AGRUPADO por
                      `grupo`/`orden` del molde (importador Chandra), críticos
                      arriba de cada grupo. */}
                  {gruposTacticos.map((g) => (
                    <SeccionVerificacion
                      key={g.titulo}
                      titulo={g.titulo}
                      items={g.items}
                      soloFaltantes={soloFaltantes}
                    />
                  ))}
                </>
              ) : (
                <>
                  {/* Campos Obligatorios del molde (P4: solo faltantes si el
                      veredicto no está OK; badge con conteo completo). */}
                  {obligatoriosMolde.length > 0 && (
                    <SeccionVerificacion
                      titulo="Campos Obligatorios"
                      items={obligatoriosMolde}
                      soloFaltantes={soloFaltantes}
                    />
                  )}
                  {/* Campos informativos del molde (desplegable, regla del mock). */}
                  {opcionalesMolde.length > 0 && (
                    <SeccionVerificacion
                      titulo="Campos Opcionales"
                      items={opcionalesMolde}
                      soloFaltantes={soloFaltantes}
                      desplegable
                      abierta={opcionalesAbiertos}
                      onToggle={() => setOverrideOpcionales(!opcionalesAbiertos)}
                    />
                  )}
                </>
              )}
            </>
          ) : sinPlantilla ? (
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
        </div>
      </div>
      </EnVisor>
    </div>
  );
}
