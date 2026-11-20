'use client';

// Verificación — Universal Document Inspector (diseño Stitch v3 "mejor así"):
// izquierda: overlay forense por corrida/página con estados GT/Tenue/Ausente
// y botón "Volver al Editor";
// derecha: barra de filtros de sección + panel fijo "Métricas de Medición y
// Precisión General" (campos obligatorios + regla crítica), listas planas de
// datos variables y anclas OCR, recortes forenses con chip de veredicto
// global + modal de reporte JSON para el agente de código.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Braces,
  ChartColumn,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  ClipboardCopy,
  Crosshair,
  FileJson,
  ListChecks,
  Loader2,
  Pencil,
  PenOff,
  Plus,
  ShieldAlert,
  Shuffle,
  Terminal,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { setOcrProgress } from '@/lib/ocr/ocr-client';
import { renderDocumento } from '@/lib/ocr/pdf-client';
import { evaluarDocumentoUniversal } from '@/lib/molde/universal-engine';
import {
  type CampoUniversal,
  type ResultadoCampoUniversal,
  type ResultadoUniversal,
} from '@/lib/molde/universal-types';
import { useStudio } from '@/lib/studio-store';

interface PruebaDetalle {
  id: string;
  moldeId: string;
  archivo: string;
  score: number | null;
  requiere_revision: boolean;
  createdAt: string;
  resultados: ResultadoUniversal | null;
}

type Veredicto = 'ok' | 'tenue' | 'ausente';
type SeccionVista = 'todos' | 'crops' | 'variables' | 'anclas';

const COLOR_VEREDICTO: Record<Veredicto, string> = {
  ok: '#10b981',
  tenue: '#f59e0b',
  ausente: '#e11d48',
};

function veredictoDe(c: ResultadoCampoUniversal): Veredicto {
  if (c.estado !== 'ok') return 'ausente';
  if (c.banderas.includes('umbral_al_borde') || c.banderas.includes('zona_vacia')) return 'tenue';
  return 'ok';
}

/** Tarjeta de campo obligatorio: subtítulo + insignia según tipo/estado (diseño Stitch). */
function detalleObligatorio(o: { def: CampoUniversal; res: ResultadoCampoUniversal | null }) {
  const res = o.res;
  const tipo = o.def.tipo;
  const estado = res?.estado ?? 'no_encontrado';
  const v: Veredicto = res ? veredictoDe(res) : 'ausente';
  const umbralPct = Math.round(o.def.umbral * 1000) / 10;
  const ratioPct = typeof res?.ratio === 'number' ? res.ratio * 100 : null;
  const confPct = Math.round((res?.conf ?? 0) * 100);

  if (estado !== 'ok') {
    return {
      Icono: XCircle,
      iconoCls: 'text-danger',
      sub: 'Obligatorio · Sin Lectura Válida',
      badge: 'AUSENTE',
      badgeCls: 'bg-danger/15 text-danger-text',
    };
  }
  if (v === 'tenue') {
    return {
      Icono: AlertTriangle,
      iconoCls: 'text-warning',
      sub:
        tipo === 'texto'
          ? `Obligatorio · Confianza al borde (${confPct}%)`
          : `Obligatorio · Densidad ${ratioPct !== null ? ratioPct.toFixed(1) : '—'}% ≈ Umbral ${umbralPct.toFixed(1)}%`,
      badge: 'AL BORDE',
      badgeCls: 'bg-warning/15 text-warning-text',
    };
  }
  switch (tipo) {
    case 'texto':
      return {
        Icono: CheckCircle2,
        iconoCls: 'text-success',
        sub: `Obligatorio · GT Coincidente ${confPct}%`,
        badge: 'MATCH EXACTO',
        badgeCls: 'bg-success-surface text-success-text',
      };
    case 'firma':
      return {
        Icono: CheckCircle2,
        iconoCls: 'text-success',
        sub: `Obligatorio · Densidad > ${umbralPct.toFixed(1)}% (Real: ${ratioPct !== null ? ratioPct.toFixed(1) : '—'}%)`,
        badge: 'TRAZO VÁLIDO',
        badgeCls: 'bg-success-surface text-success-text',
      };
    case 'checkbox':
      return {
        Icono: CheckCircle2,
        iconoCls: 'text-success',
        sub: `Obligatorio · Casilla Marcada (${confPct}%)`,
        badge: 'OMR OK',
        badgeCls: 'bg-success-surface text-success-text',
      };
    default:
      return {
        Icono: CheckCircle2,
        iconoCls: 'text-success',
        sub: `Obligatorio · Presencia Confirmada (${confPct}%)`,
        badge: 'PRESENTE',
        badgeCls: 'bg-success-surface text-success-text',
      };
  }
}

export default function VerificacionTab() {
  const { moldeId, molde, pruebas, pruebaId, setPruebaId, setPestana, cargarPruebas } = useStudio();
  const { toast } = useToast();
  const [detalle, setDetalle] = useState<PruebaDetalle | null>(null);
  const [cargando, setCargando] = useState(false);
  const [paginaIdx, setPaginaIdx] = useState(0);
  const [vista, setVista] = useState<SeccionVista>('todos');
  const [modalReporte, setModalReporte] = useState(false);
  const [procesando, setProcesando] = useState(false);
  const [progresoMsg, setProgresoMsg] = useState<string | null>(null);
  const inputArchivoRef = useRef<HTMLInputElement>(null);

  const cargar = useCallback(async (id: string) => {
    setCargando(true);
    try {
      const res = await fetch(`/api/pruebas/${id}`);
      if (res.ok) setDetalle(await res.json());
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    if (pruebaId) cargar(pruebaId);
    else setDetalle(null);
  }, [pruebaId, cargar]);

  useEffect(() => {
    if (!pruebaId && pruebas.length > 0) setPruebaId(pruebas[0].id);
  }, [pruebaId, pruebas, setPruebaId]);

  useEffect(() => {
    setPaginaIdx(0);
  }, [pruebaId]);

  // Cierra el modal de reporte con Escape
  useEffect(() => {
    if (!modalReporte) return;
    const cerrar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModalReporte(false);
    };
    window.addEventListener('keydown', cerrar);
    return () => window.removeEventListener('keydown', cerrar);
  }, [modalReporte]);

  const res = detalle?.resultados ?? null;
  const paginasVisibles = useMemo(
    () => (res ? res.paginas.filter((p) => p.pagina > 0 && p.preview) : []),
    [res],
  );

  const campos = useMemo(() => (res ? res.paginas.flatMap((p) => p.campos) : []), [res]);
  const okCount = campos.filter((c) => veredictoDe(c) === 'ok').length;
  const tenueCount = campos.filter((c) => veredictoDe(c) === 'tenue').length;
  const ausenteCount = campos.filter((c) => veredictoDe(c) === 'ausente').length;
  const datosVariables = campos.filter((c) => c.tipo === 'texto' && typeof c.valor === 'string' && c.valor.trim());
  const anclas = campos.filter((c) => c.rect && c.fuente);
  const recortes = campos.filter((c) => c.crop);

  // Umbrales por campo (definidos en el molde) para las tarjetas forenses
  const umbrales = useMemo(() => {
    const map = new Map<string, number>();
    (molde?.campos ?? []).forEach((c) => map.set(c.id, c.umbral));
    return map;
  }, [molde]);

  // Campos obligatorios del molde + su resultado en esta corrida
  const mapaResultados = useMemo(() => new Map(campos.map((c) => [c.id, c])), [campos]);
  const obligatorios = useMemo(
    () =>
      (molde?.campos ?? [])
        .filter((def) => def.obligatorio)
        .map((def) => ({ def, res: mapaResultados.get(def.id) ?? null })),
    [molde, mapaResultados],
  );
  const obligTotal = obligatorios.length;
  const obligCumplidos = obligatorios.filter((o) => o.res && o.res.estado === 'ok').length;
  const pctCritico = obligTotal > 0 ? Math.round((obligCumplidos / obligTotal) * 100) : 0;
  const reglaSatisfecha = obligTotal > 0 && obligCumplidos === obligTotal;

  const scoreVal = detalle?.score ?? 0;
  const veredictoGlobal = useMemo(() => {
    if (scoreVal >= 80) {
      return { icono: CheckCircle2, texto: 'Aprobado · Listo Producción', cls: 'bg-success-surface text-success-text' };
    }
    if (scoreVal >= 50) {
      return { icono: AlertTriangle, texto: 'Revisión · Ajustes Menores', cls: 'bg-warning-surface text-warning-text' };
    }
    return { icono: XCircle, texto: 'Rechazado · Requiere Calibración', cls: 'bg-danger-surface text-danger-text' };
  }, [scoreVal]);

  // Chip de veredicto global: mixto para el panel de métricas, mayúsculas para las tarjetas
  const IconoVeredicto = veredictoGlobal.icono;
  const chipVeredicto = (mayus: boolean) => (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-mono font-bold ${
        mayus ? 'text-[9px] uppercase' : 'text-[10px]'
      } ${veredictoGlobal.cls}`}
    >
      <IconoVeredicto className="h-3 w-3" aria-hidden />
      {okCount}/{campos.length} · {veredictoGlobal.texto}
    </span>
  );

  const reporteJson = useMemo(() => {
    if (!detalle) return '';
    const reporte = {
      molde: detalle.moldeId,
      archivo: detalle.archivo,
      score: detalle.score,
      requiere_revision: detalle.requiere_revision,
      fecha: detalle.createdAt,
      campos: campos.map((c) => ({
        id: c.id,
        etiqueta: c.etiqueta,
        tipo: c.tipo,
        pagina: c.pagina,
        estado: c.estado,
        valor: c.valor,
        ratio: c.ratio ?? null,
        conf: Math.round(c.conf * 100) / 100,
        rect: c.rect,
        fuente: c.fuente ?? null,
        banderas: c.banderas,
      })),
    };
    return JSON.stringify(reporte, null, 2);
  }, [detalle, campos]);

  const copiarReporte = () => {
    navigator.clipboard
      .writeText(reporteJson)
      .then(() => toast({ title: 'Reporte JSON copiado', description: 'Listo para el agente de código.' }));
  };

  const anadirFoto = () => {
    if (procesando) return;
    inputArchivoRef.current?.click();
  };

  // Pipeline directo desde Verificación: render → OCR → motor → guardar corrida.
  const correrArchivos = async (files: FileList | File[]) => {
    const archivos = Array.from(files);
    if (!archivos.length || !molde || !moldeId) return;
    setProcesando(true);
    let ultimoId: string | undefined;
    setOcrProgress((m) => {
      if (m.status.includes('recognizing')) setProgresoMsg(`OCR ${Math.round(m.progress * 100)}%`);
    });
    try {
      for (const f of archivos) {
        setProgresoMsg(`Renderizando ${f.name}...`);
        try {
          const doc = await renderDocumento(f);
          const res = await evaluarDocumentoUniversal(doc.canvases, molde, f.name, (msg) => setProgresoMsg(msg));
          const guardar = await fetch('/api/pruebas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              moldeId,
              archivo: f.name,
              resultados: res,
              score: res.score,
              requiereRevision: res.requiere_revision,
            }),
          });
          if (guardar.ok) ultimoId = ((await guardar.json()) as { id?: string }).id;
          toast({
            title: `Corrida completada: ${f.name}`,
            description: `Score ${res.score}% · ${res.ok_count}/${res.total} campos OK`,
          });
        } catch (e) {
          toast({ title: `Error procesando ${f.name}`, description: (e as Error).message, variant: 'destructive' });
        }
      }
    } finally {
      setOcrProgress(null);
      setProcesando(false);
      setProgresoMsg(null);
      await cargarPruebas(moldeId);
      if (ultimoId) setPruebaId(ultimoId);
    }
  };

  const onArchivosInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) void correrArchivos(e.target.files);
    e.target.value = '';
  };

  async function eliminarCorrida(id: string) {
    const del = await fetch(`/api/pruebas/${id}`, { method: 'DELETE' });
    if (!del.ok) {
      toast({ title: 'No se pudo eliminar la corrida', variant: 'destructive' });
      return;
    }
    await cargarPruebas(moldeId ?? undefined);
    if (pruebaId === id) {
      const restantes = pruebas.filter((p) => p.id !== id);
      setPruebaId(restantes.length ? restantes[0].id : null);
    }
    toast({ title: 'Corrida de comparación eliminada' });
  }

  if (!moldeId) {
    return (
      <div className="mx-auto w-full max-w-[1600px] px-4 py-4 sm:px-6">
        <Card className="rounded-xl">
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <FileJson className="h-10 w-10 text-outline-dim" aria-hidden />
            <p className="font-medium">Sin molde abierto</p>
            <p className="max-w-md text-sm text-on-surface-variant">
              Abre un molde desde la Biblioteca y corre pruebas para ver la verificación visual forense.
            </p>
            <Button size="sm" variant="outline" onClick={() => setPestana('moldes')}>
              Ir a la Biblioteca
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const pagina = paginasVisibles[Math.min(paginaIdx, Math.max(0, paginasVisibles.length - 1))];
  const nombreVista = (molde?.nombre ?? 'Molde').split('(')[0].trim() || 'Molde';
  const mostrarVariables = vista === 'todos' || vista === 'variables';
  const mostrarAnclas = vista === 'todos' || vista === 'anclas';
  const mostrarCrops = vista === 'todos' || vista === 'crops';
  const ambasListas = mostrarVariables && mostrarAnclas;

  const filtroCls = (activo: boolean) =>
    `inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-all ${
      activo
        ? 'bg-surface-lowest font-semibold text-brand shadow-2xs dark:bg-slate-900'
        : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface dark:hover:bg-slate-800'
    }`;

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-4 sm:px-6">
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
        {/* ================= Inspección forense (izquierda) ================= */}
        <section className="flex flex-col overflow-hidden rounded-xl bg-surface-lowest shadow-sm lg:col-span-5">
          {/* Encabezado: volver al editor + molde + telemetría GT */}
          <div className="flex flex-wrap items-center justify-between gap-2 bg-surface-container-low px-4 py-2.5 dark:bg-slate-800/60">
            <div className="flex min-w-0 items-center gap-2.5">
              <button
                type="button"
                onClick={() => setPestana('editor')}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-surface-lowest px-3 text-xs font-medium text-on-surface shadow-2xs transition-all hover:bg-surface-low hover:text-brand dark:border-slate-700 dark:bg-slate-900 dark:hover:text-indigo-300"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                Volver al Editor
              </button>
              <span className="truncate text-sm font-bold text-on-surface">{nombreVista}</span>
            </div>
            <div className="flex items-center gap-2 font-mono text-[9px] font-bold">
              <span className="inline-flex items-center gap-1 text-success-text">
                <span className="h-2 w-2 rounded-full bg-success" aria-hidden /> {okCount} GT OK
              </span>
              <span className="inline-flex items-center gap-1 text-warning-text">
                <span className="h-2 w-2 rounded-full bg-warning" aria-hidden /> {tenueCount} Tenue
              </span>
              <span className="inline-flex items-center gap-1 text-danger-text">
                <span className="h-2 w-2 rounded-full bg-danger" aria-hidden /> {ausenteCount} Ausente
              </span>
            </div>
          </div>

          {/* Barra Comparar Molde: corridas + paginación */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-highest bg-surface-container px-4 py-1.5 dark:border-slate-800 dark:bg-slate-800/40">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant">
                Comparar Molde
              </span>
              <div className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-surface-lowest p-0.5 dark:bg-slate-900">
                <button
                  type="button"
                  title="Añadir foto de comparación (foto o PDF)"
                  aria-label="Añadir foto de comparación"
                  disabled={procesando}
                  onClick={anadirFoto}
                  className="flex h-7 items-center justify-center rounded-md border border-dashed border-outline-variant px-1.5 text-on-surface-variant transition-all hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {procesando ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Plus className="h-3.5 w-3.5" aria-hidden />}
                </button>
                {pruebas.map((p, i) => {
                  const activo = pruebaId ? p.id === pruebaId : i === 0;
                  return (
                    <span
                      key={p.id}
                      className={`inline-flex items-center overflow-hidden rounded-md ${
                        activo
                          ? 'bg-brand text-white shadow-2xs'
                          : 'bg-transparent text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      <button
                        type="button"
                        title={`${p.archivo} · ${p.score ?? '—'}%`}
                        aria-pressed={activo}
                        aria-label={`Corrida ${i + 1}: ${p.archivo}`}
                        onClick={() => setPruebaId(p.id)}
                        className="h-7 px-2 font-mono text-[11px] font-bold transition-all"
                      >
                        {i + 1}
                      </button>
                      <button
                        type="button"
                        title={`Eliminar corrida ${i + 1} (${p.archivo})`}
                        aria-label={`Eliminar corrida ${i + 1}: ${p.archivo}`}
                        disabled={procesando}
                        onClick={() => eliminarCorrida(p.id)}
                        className="flex h-7 w-5 items-center justify-center opacity-55 transition hover:opacity-100 disabled:opacity-25"
                      >
                        <X className="h-3 w-3" aria-hidden />
                      </button>
                    </span>
                  );
                })}
              </div>
            </div>
            {paginasVisibles.length > 0 ? (
              <div className="flex items-center gap-1 rounded-lg border border-surface-container bg-surface-lowest px-1.5 py-0.5 dark:border-slate-800 dark:bg-slate-900">
                <button
                  type="button"
                  aria-label="Página anterior"
                  disabled={paginaIdx === 0}
                  onClick={() => setPaginaIdx((i) => Math.max(0, i - 1))}
                  className="flex h-6 w-6 items-center justify-center rounded text-on-surface-variant transition hover:bg-surface-high hover:text-on-surface disabled:opacity-30 dark:hover:bg-slate-800"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                </button>
                <span className="px-1 font-mono text-[11px] font-bold text-on-surface">
                  Pág. {paginaIdx + 1} de {paginasVisibles.length}
                </span>
                <button
                  type="button"
                  aria-label="Página siguiente"
                  disabled={paginaIdx >= paginasVisibles.length - 1}
                  onClick={() => setPaginaIdx((i) => Math.min(paginasVisibles.length - 1, i + 1))}
                  className="flex h-6 w-6 items-center justify-center rounded text-on-surface-variant transition hover:bg-surface-high hover:text-on-surface disabled:opacity-30 dark:hover:bg-slate-800"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </button>
              </div>
            ) : null}
          </div>

          {/* Viewport forense */}
          <div className="relative flex items-center justify-center overflow-hidden bg-surface-highest/60 p-3 dark:bg-slate-950">
            {procesando ? (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-surface-highest/85 backdrop-blur-sm dark:bg-slate-950/85">
                <Loader2 className="h-6 w-6 animate-spin text-brand" aria-hidden />
                <p className="px-6 text-center font-mono text-xs font-semibold text-on-surface">
                  {progresoMsg ?? 'Procesando...'}
                </p>
              </div>
            ) : null}
            {cargando || !detalle ? (
              <div className="flex items-center justify-center py-20 text-sm text-on-surface-variant">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Cargando corrida...
              </div>
            ) : !pagina ? (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <Circle className="h-10 w-10 text-outline-dim" aria-hidden />
                <p className="font-medium">Sin vista previa disponible</p>
                <p className="max-w-sm text-sm text-on-surface-variant">
                  Sube una foto o PDF real para generar el overlay forense de comparación.
                </p>
                <Button size="sm" variant="outline" onClick={anadirFoto} disabled={procesando}>
                  <Upload className="mr-2 h-4 w-4" aria-hidden /> Añadir foto de comparación
                </Button>
              </div>
            ) : (
              <div className="relative w-full max-w-[460px] overflow-hidden rounded-lg bg-canvas-paper shadow-md dark:bg-[#1a1712]">
                <img src={pagina.preview} alt={`Página ${pagina.pagina} procesada`} className="block w-full" />
                {pagina.campos.map((c) =>
                  c.rect ? (
                    <div
                      key={c.id}
                      className="absolute"
                      style={{
                        left: `${c.rect.x * 100}%`,
                        top: `${c.rect.y * 100}%`,
                        width: `${c.rect.w * 100}%`,
                        height: `${c.rect.h * 100}%`,
                        border: '1.6px solid ' + COLOR_VEREDICTO[veredictoDe(c)],
                        backgroundColor: COLOR_VEREDICTO[veredictoDe(c)] + '24',
                        borderRadius: 2,
                      }}
                    >
                      <span
                        className="absolute -top-4 left-0 max-w-full truncate rounded-sm px-1 font-mono text-[8px] font-bold text-white"
                        style={{ backgroundColor: COLOR_VEREDICTO[veredictoDe(c)] }}
                      >
                        {c.etiqueta}
                      </span>
                    </div>
                  ) : null,
                )}
                {/* Leyenda forense (overlay inferior del viewport) */}
                <div className="absolute bottom-2 left-2 right-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg bg-surface-lowest/90 px-2 py-1.5 font-mono text-[10px] font-semibold text-on-surface shadow-2xs backdrop-blur-sm dark:bg-slate-900/90">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-[2px] bg-success" aria-hidden /> GT Match Exacto
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-[2px] bg-warning" aria-hidden /> Sello Tenue / Offset
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-[2px] bg-danger" aria-hidden /> Campo Ausente
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Franja inferior (aviso de revisión obligatoria) */}
          <div className="flex min-h-[34px] items-center justify-center bg-surface-container px-4 py-2 text-center dark:bg-slate-800/40">
            {detalle?.requiere_revision ? (
              <span className="inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold text-danger-text">
                <ShieldAlert className="h-3.5 w-3.5" aria-hidden /> Obligatorios faltantes — revisión manual obligatoria
              </span>
            ) : null}
          </div>
        </section>

        {/* ================= Panel analítico (derecha) ================= */}
        <section className="flex flex-col gap-4 lg:col-span-7">
          {/* Barra de filtros de sección */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-lowest p-2 shadow-sm">
            <div className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-surface-container p-1 dark:bg-slate-800/60">
              <button type="button" onClick={() => setVista('todos')} aria-pressed={vista === 'todos'} className={filtroCls(vista === 'todos')}>
                Vista Completa
              </button>
              <button type="button" onClick={() => setVista('crops')} aria-pressed={vista === 'crops'} className={filtroCls(vista === 'crops')}>
                <Pencil className="h-3.5 w-3.5" aria-hidden />
                Recortes: Firmas y Manuscritos ({recortes.length})
              </button>
              <button type="button" onClick={() => setVista('variables')} aria-pressed={vista === 'variables'} className={filtroCls(vista === 'variables')}>
                <Braces className="h-3.5 w-3.5" aria-hidden />
                Datos Variables (Lista)
              </button>
              <button type="button" onClick={() => setVista('anclas')} aria-pressed={vista === 'anclas'} className={filtroCls(vista === 'anclas')}>
                <Crosshair className="h-3.5 w-3.5" aria-hidden />
                Anclas OCR (Lista)
              </button>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 gap-1.5 rounded-lg px-2 font-mono text-[11px] font-semibold text-on-surface-variant hover:text-brand"
              onClick={() => setModalReporte(true)}
            >
              <Terminal className="h-3.5 w-3.5" aria-hidden /> Reporte JSON
            </Button>
          </div>

          {/* Panel fijo: Métricas de Medición y Precisión General */}
          <div className="flex flex-col gap-2.5 rounded-xl border border-surface-container bg-surface-lowest p-3 shadow-xs dark:border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-container px-0.5 pb-1.5 dark:border-slate-800">
              <div className="flex items-center gap-1.5">
                <ChartColumn className="h-[17px] w-[17px] text-brand" aria-hidden />
                <h3 className="text-sm font-bold text-on-surface">Métricas de Medición y Precisión General</h3>
              </div>
              {res ? chipVeredicto(false) : null}
            </div>

            {res ? (
              <>
                {/* Campos obligatorios de validación */}
                <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
                  <div className="flex items-center gap-1.5">
                    <ListChecks className="h-3.5 w-3.5 text-success-text" aria-hidden />
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-on-surface">
                      Campos Obligatorios de Validación ({obligCumplidos}/{obligTotal} Requeridos Cumplidos)
                    </span>
                  </div>
                  <span
                    className={`rounded px-2 py-0.5 font-mono text-[10px] font-bold ${
                      obligTotal === 0
                        ? 'bg-surface-container text-on-surface-variant'
                        : pctCritico === 100
                          ? 'bg-success-surface text-success-text'
                          : pctCritico >= 50
                            ? 'bg-warning-surface text-warning-text'
                            : 'bg-danger-surface text-danger-text'
                    }`}
                  >
                    {obligTotal > 0 ? `${pctCritico}% CUMPLIMIENTO CRÍTICO` : 'SIN CAMPOS OBLIGATORIOS'}
                  </span>
                </div>

                {obligTotal === 0 ? (
                  <p className="py-2 text-center font-mono text-[10px] text-on-surface-variant">
                    Este molde no define campos obligatorios — verificación informativa.
                  </p>
                ) : (
                  <div className="scroll-fino grid max-h-[300px] grid-cols-1 gap-2 overflow-y-auto pr-1 md:grid-cols-2">
                    {obligatorios.map((o) => {
                      const d = detalleObligatorio(o);
                      const v: Veredicto = o.res ? veredictoDe(o.res) : 'ausente';
                      const { Icono } = d;
                      return (
                        <div
                          key={o.def.id}
                          className={`flex items-center justify-between gap-2 rounded-lg border p-2 ${
                            v === 'ausente'
                              ? 'border-danger/30 bg-danger-surface/60 dark:border-danger/40 dark:bg-danger-surface/20'
                              : 'border-surface-container bg-surface-container-low dark:border-slate-800 dark:bg-slate-800/40'
                          }`}
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <Icono className={`h-4 w-4 shrink-0 ${d.iconoCls}`} aria-hidden />
                            <div className="min-w-0">
                              <p className="truncate text-xs font-bold text-on-surface">{o.def.etiqueta}</p>
                              <p className="truncate font-mono text-[9px] text-on-surface-variant">{d.sub}</p>
                            </div>
                          </div>
                          <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] font-bold ${d.badgeCls}`}>
                            {d.badge}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Esquema forense crítico (regla de pase a producción) */}
                <div
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 ${
                    reglaSatisfecha ? 'bg-brand-surface dark:bg-slate-800/60' : 'bg-danger-surface dark:bg-danger-surface/20'
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Shuffle
                      className={`h-3.5 w-3.5 shrink-0 ${reglaSatisfecha ? 'text-brand' : 'text-danger'}`}
                      aria-hidden
                    />
                    <p className="truncate text-xs text-on-surface">
                      <span className="font-semibold">Esquema Forense Crítico:</span>{' '}
                      {reglaSatisfecha
                        ? 'Todos los campos obligatorios satisfechos para pase a producción.'
                        : 'Campos obligatorios pendientes — revisión manual obligatoria.'}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 font-mono text-[10px] font-bold uppercase ${
                      reglaSatisfecha ? 'text-brand dark:text-indigo-300' : 'text-danger-text'
                    }`}
                  >
                    Regla {obligCumplidos}/{obligTotal} {reglaSatisfecha ? 'Satisfecha' : 'Pendiente'}
                  </span>
                </div>
              </>
            ) : (
              <p className="py-3 text-center text-xs text-on-surface-variant">
                {cargando ? 'Calculando métricas de verificación...' : 'Corre una prueba para calcular las métricas.'}
              </p>
            )}
          </div>

          {/* Área de trabajo con scroll: listas + recortes */}
          {pruebas.length === 0 ? (
            <Card className="rounded-xl">
              <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
                <Circle className="h-10 w-10 text-outline-dim" aria-hidden />
                <p className="font-medium">Sin corridas todavía</p>
                <p className="max-w-md text-sm text-on-surface-variant">
                  Usa el botón + de la barra “Comparar Molde” para subir fotos o PDFs reales y verificar el molde contra el ground truth.
                </p>
                <Button size="sm" variant="outline" onClick={anadirFoto} disabled={procesando}>
                  <Upload className="mr-2 h-4 w-4" aria-hidden /> Subir foto o PDF
                </Button>
              </CardContent>
            </Card>
          ) : cargando || !detalle || !res ? (
            <Card className="rounded-xl">
              <CardContent className="flex items-center justify-center py-20 text-sm text-on-surface-variant">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Cargando verificación...
              </CardContent>
            </Card>
          ) : (
            <div className="scroll-fino flex max-h-[720px] flex-col gap-4 overflow-y-auto pr-1">
              {/* Datos variables + Anclas OCR (listas planas, diseño v3) */}
              {mostrarVariables || mostrarAnclas ? (
                <div className={`grid grid-cols-1 gap-4 ${ambasListas ? 'md:grid-cols-2' : ''}`}>
                  {mostrarVariables ? (
                    <div className="flex flex-col" aria-label="Datos variables extraídos">
                      <h3 className="sr-only">Datos Variables Extraídos</h3>
                      <div className="divide-y divide-surface-container dark:divide-slate-800">
                        {datosVariables.length === 0 ? (
                          <p className="px-2 py-6 text-center text-xs text-on-surface-variant">
                            Sin lecturas de texto en esta corrida.
                          </p>
                        ) : (
                          datosVariables.map((c) => {
                            const destacado = /total|pagar|valor|iva|precio/i.test(c.etiqueta);
                            return (
                              <div
                                key={`${c.pagina}-${c.id}`}
                                className="flex items-center justify-between gap-2 rounded px-2 py-1.5 transition-colors hover:bg-surface-container-low dark:hover:bg-slate-800/60"
                              >
                                <span className="text-xs font-medium text-on-surface-variant">{c.etiqueta}:</span>
                                <span
                                  className={`truncate text-right font-mono text-xs font-bold ${
                                    destacado ? 'text-brand dark:text-indigo-300' : 'text-on-surface'
                                  }`}
                                >
                                  {c.valor}
                                </span>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  ) : null}

                  {mostrarAnclas ? (
                    <div className="flex flex-col" aria-label="Anclas OCR y posicionadores">
                      <h3 className="sr-only">Anclas OCR &amp; Posicionadores</h3>
                      <div className="divide-y divide-surface-container dark:divide-slate-800">
                        {anclas.length === 0 ? (
                          <p className="px-2 py-6 text-center text-xs text-on-surface-variant">
                            Sin anclas resueltas — alinea el molde en el Editor.
                          </p>
                        ) : (
                          anclas.map((c) => (
                            <div
                              key={`${c.pagina}-${c.id}`}
                              className="flex items-center justify-between gap-2 rounded px-2 py-1.5 transition-colors hover:bg-surface-container-low dark:hover:bg-slate-800/60"
                            >
                              <span className="truncate text-xs font-medium text-on-surface-variant">{c.etiqueta}</span>
                              <span className="shrink-0 font-mono text-[11px] text-brand dark:text-indigo-300">
                                [x: {(c.rect?.x ?? 0).toFixed(2)}, y: {(c.rect?.y ?? 0).toFixed(2)}, w:{' '}
                                {(c.rect?.w ?? 0).toFixed(2)}, h: {(c.rect?.h ?? 0).toFixed(2)}]
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* Recortes forenses */}
              {mostrarCrops ? (
                <section className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-container pb-1 dark:border-slate-800">
                    <div className="flex flex-wrap items-center gap-2">
                      <Pencil className="h-[18px] w-[18px] text-signature" aria-hidden />
                      <h3 className="text-sm font-bold text-on-surface">
                        Recortes Forenses: Firmas, Manuscritos &amp; Biometría
                      </h3>
                      <span className="rounded-full bg-warning/10 px-2 py-0.5 font-mono text-[10px] font-bold text-warning-text">
                        Exclusivo con Recorte (Crops)
                      </span>
                    </div>
                    <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-on-surface-variant">
                      Inspección de Píxeles &amp; Trazos Continuos
                    </span>
                  </div>
                  {recortes.length === 0 ? (
                    <p className="py-8 text-center text-xs text-on-surface-variant">
                      Esta corrida no generó recortes (crops). Ejecuta la prueba desde el navegador para capturarlos.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                      {recortes.map((c) => (
                        <TarjetaRecorte
                          key={`${c.pagina}-${c.id}`}
                          campo={c}
                          umbral={umbrales.get(c.id) ?? 0.12}
                          chipVeredicto={chipVeredicto(true)}
                        />
                      ))}
                    </div>
                  )}
                </section>
              ) : null}
            </div>
          )}
        </section>
      </div>

      {/* ============ Modal: reporte forense para agente de código ============ */}
      {modalReporte ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
          onClick={() => setModalReporte(false)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Reporte forense para agente de código"
            className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-surface-lowest shadow-2xl dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 bg-surface-low px-4 py-2.5 dark:bg-slate-800">
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-white shadow-2xs">
                  <Terminal className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-on-surface">
                    Reporte Forense para Agente de Código
                  </h3>
                  <p className="truncate font-mono text-[9px] font-bold text-on-surface-variant">
                    GET /api/pruebas/{detalle?.id ?? ''}
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Cerrar reporte"
                onClick={() => setModalReporte(false)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-container text-on-surface transition hover:bg-surface-high dark:bg-slate-700"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto bg-surface-dark p-4">
              <pre className="select-all whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-indigo-100">
                {reporteJson}
              </pre>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 bg-surface-container px-4 py-2.5 dark:bg-slate-800">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant">
                Compatible con e14.schema.v2.json
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  className="h-8 gap-1.5 rounded-lg border border-slate-200 bg-surface-lowest px-3 font-medium text-brand shadow-2xs hover:bg-brand-highlight dark:border-slate-700 dark:bg-slate-900"
                  onClick={copiarReporte}
                >
                  <ClipboardCopy className="h-3.5 w-3.5" aria-hidden /> Copiar al Portapapeles
                </Button>
                <Button
                  size="sm"
                  className="h-8 rounded-lg bg-brand px-3.5 font-medium text-white hover:bg-brand-active"
                  onClick={() => setModalReporte(false)}
                >
                  Cerrar
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Input oculto: el + de Comparar Molde abre el selector de archivos aquí mismo */}
      <input
        ref={inputArchivoRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,application/pdf"
        className="hidden"
        onChange={onArchivosInput}
        aria-hidden
        tabIndex={-1}
      />
    </div>
  );
}

function TarjetaRecorte({
  campo,
  umbral,
  chipVeredicto,
}: {
  campo: ResultadoCampoUniversal;
  umbral: number;
  chipVeredicto: ReactNode;
}) {
  const v = veredictoDe(campo);
  const ok = v === 'ok';
  const ausente = v === 'ausente';
  const esTexto = campo.tipo === 'texto';
  const esFirma = campo.tipo === 'firma';
  const ratioPct = typeof campo.ratio === 'number' ? campo.ratio * 100 : null;
  const confPct = Math.round(campo.conf * 100);
  const umbralPct = Math.round(umbral * 1000) / 10;
  const trazo =
    esTexto && typeof campo.valor === 'string'
      ? `${campo.valor.length} Caracteres`
      : `${campo.banderas.length} Componentes`;

  const chip = ausente && esFirma
    ? { texto: 'Firma Manuscrita', cls: 'bg-danger/20 text-danger-text' }
    : esFirma
      ? { texto: 'Firma', cls: 'bg-signature/10 text-signature' }
      : esTexto
        ? { texto: 'Manuscrito', cls: 'bg-ink-pen/10 text-ink-pen' }
        : campo.tipo === 'checkbox'
          ? { texto: 'Casilla', cls: 'bg-warning/10 text-warning-text' }
          : { texto: 'Presencia', cls: 'bg-success/10 text-success-text' };

  return (
    <article
      className={`flex flex-col justify-between gap-2 rounded-xl border p-4 shadow-sm ${
        ausente
          ? 'border-danger/30 bg-danger-surface/60 dark:border-danger/40 dark:bg-danger-surface/20'
          : 'border-surface-container bg-surface-lowest dark:border-slate-800'
      }`}
    >
      {/* Encabezado: tipo + veredicto */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span
            className={`mb-1 inline-block rounded px-1.5 py-px font-mono text-[9px] font-bold uppercase tracking-wide ${chip.cls}`}
          >
            {chip.texto}
          </span>
          <h4 className="block truncate text-sm font-bold text-on-surface">{campo.etiqueta}</h4>
        </div>
        {ausente ? (
          <span className="inline-flex shrink-0 items-center rounded-full bg-danger px-2 py-0.5 font-mono text-[9px] font-bold uppercase text-white">
            No Encontrado
          </span>
        ) : (
          chipVeredicto
        )}
      </div>

      {/* Recorte forense */}
      <div
        className={`relative flex h-24 items-center justify-center overflow-hidden rounded-lg border p-2 shadow-2xs ${
          ausente
            ? 'border-danger/30 bg-surface-lowest dark:bg-slate-900'
            : esTexto
              ? 'border-outline-variant bg-canvas-paper dark:bg-[#1a1712]'
              : 'border-outline-variant bg-surface-lowest dark:bg-slate-900'
        }`}
      >
        {ausente ? (
          <div className="flex h-full w-full flex-col items-center justify-center rounded bg-canvas-slate/80 px-2 text-center dark:bg-slate-800/60">
            <PenOff className="mb-0.5 h-6 w-6 shrink-0 text-danger" aria-hidden />
            <span className="font-mono text-[11px] font-semibold italic text-danger-text">
              Casilla física vacía (0 trazos continuos)
            </span>
            <span className="font-mono text-[9px] font-bold text-danger-text/80">Sin presión ni pigmento detectado</span>
          </div>
        ) : (
          <img
            src={campo.crop ?? ''}
            alt={`Recorte forense de ${campo.etiqueta}`}
            className="max-h-full max-w-full object-contain"
          />
        )}
        <span className="absolute bottom-1 right-1.5 rounded bg-slate-900/85 px-1.5 py-0.5 font-mono text-[9px] font-bold text-slate-200">
          {Math.round((campo.rect?.w ?? 0) * 2480)}×{Math.round((campo.rect?.h ?? 0) * 3508)}px @{' '}
          {esTexto ? '300 DPI' : 'Crop Forense'}
        </span>
      </div>

      {/* Métricas de tinta */}
      <div
        className={`grid grid-cols-2 gap-2 rounded-lg border p-2 font-mono text-[11px] ${
          ausente
            ? 'border-danger/20 bg-danger/10 dark:border-danger/30'
            : 'border-surface-container bg-surface-container-low dark:border-slate-800 dark:bg-slate-800/40'
        }`}
      >
        <div>
          <span className={ausente ? 'text-danger-text' : 'text-outline-dim'}>Densidad Tinta: </span>
          <strong className={ausente ? 'text-danger-text' : 'text-success-text'}>
            {ratioPct !== null ? `${ratioPct.toFixed(1)}%` : '—'}
          </strong>{' '}
          <span className="text-on-surface-variant">({ausente ? 'Requerido' : 'Umbral'} {umbralPct.toFixed(1)}%)</span>
        </div>
        <div>
          <span className={ausente ? 'text-danger-text' : 'text-outline-dim'}>Trazo Continuo: </span>
          <strong className={ausente ? 'text-danger-text' : esTexto ? 'text-on-surface' : 'text-success-text'}>
            {trazo}
          </strong>
        </div>
      </div>

      {/* Lectura + barra de presencia con umbral */}
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
          {ausente ? (
            <>
              <span className="font-bold text-danger-text">
                {esFirma ? 'Firma Ausente' : 'Campo Ausente'} (Alerta Forense)
              </span>
              <span className="text-on-surface-variant">Revisión Manual Obligatoria</span>
            </>
          ) : esTexto ? (
            <>
              <span className="font-bold text-success-text">
                Lectura HTR: &apos;{typeof campo.valor === 'string' ? campo.valor : '—'}&apos; ({confPct}%)
              </span>
              <span className="text-on-surface-variant">Consistencia: OK</span>
            </>
          ) : (
            <>
              <span className="font-bold text-success-text">Presencia de Trazo: {confPct}%</span>
              {v !== 'ok' ? <span className="text-warning-text">Umbral al borde</span> : null}
            </>
          )}
        </div>
        <div className="relative h-2 w-full overflow-hidden rounded-full bg-surface-highest dark:bg-slate-700">
          <div
            className={`h-full rounded-full ${ausente ? 'bg-danger' : v === 'tenue' ? 'bg-warning' : 'bg-success'}`}
            style={{
              width: `${ausente ? Math.max(2, Math.round((campo.ratio ?? 0) * 100)) : Math.max(confPct, 4)}%`,
            }}
          />
          <div
            className="absolute inset-y-0 w-0.5 bg-slate-900 dark:bg-slate-200"
            style={{ left: `${umbralPct}%` }}
            title={`Umbral mínimo ${umbralPct.toFixed(1)}%`}
          />
        </div>
      </div>
    </article>
  );
}
