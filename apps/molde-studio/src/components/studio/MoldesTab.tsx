'use client';

// Biblioteca Universal de Plantillas & Esquemas — diseño Stitch:
// breadcrumb + hero con acciones, búsqueda con filtros rápidos y tarjetas de
// molde con precisión, badges, stats segmentadas y menú contextual.

import { useMemo, useRef, useState } from 'react';
import {
  ChevronRight,
  CircleCheck,
  Copy,
  Download,
  FileJson,
  FlaskConical,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  ReceiptText,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { importarMoldeE14, pareceMoldeE14 } from '@/lib/molde/importar-e14';
import {
  MOLDE_UNIVERSAL_VERSION,
  esMoldeUniversal,
  nuevoIdCampo,
  type MoldeUniversal,
} from '@/lib/molde/universal-types';
import { repo } from '@/lib/repo';
import { useStudio, type MoldeDB } from '@/lib/studio-store';

type Filtro = 'todos' | 'activo' | 'preciso' | 'calibrando';

interface StatsMolde {
  precision: number | null;
  docs: number;
  estado: 'Activo' | 'Validando' | 'En Calibración' | null;
  porTipo: { presencia: number; firma: number; texto: number; checkbox: number };
  total: number;
  validacion?: string;
  unidadDocs?: string;
  etiquetaCampos?: string;
  etiquetas?: Partial<Record<'presencia' | 'firma' | 'texto' | 'checkbox', string>>;
  orden?: number;
}

function slugMolde(nombre: string): string {
  const base = nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 34);
  return base || 'molde';
}

function formatFechaRelativa(iso: string): string {
  const d = new Date(iso);
  const hoy = new Date();
  const mismoDia = d.toDateString() === hoy.toDateString();
  const ayer = new Date(hoy);
  ayer.setDate(hoy.getDate() - 1);
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (mismoDia) return `Hoy, ${hhmm}`;
  if (d.toDateString() === ayer.toDateString()) return `Ayer, ${hhmm}`;
  const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  return `${d.getDate()} ${meses[d.getMonth()]}, ${hhmm}`;
}

function statsDe(m: MoldeDB): StatsMolde {
  let molde: MoldeUniversal | null = null;
  try {
    molde = JSON.parse(m.json) as MoldeUniversal;
  } catch {
    molde = null;
  }
  // Meta de presentación (diseño Stitch) sobresale sobre los stats reales.
  const meta = molde?.meta;
  const precisionCalculada = m.pruebas?.[0]?.score ?? null;
  const precision = meta?.precision ?? precisionCalculada;
  const docs = meta?.docs ?? m._count?.pruebas ?? 0;
  const estadoCalculado: StatsMolde['estado'] =
    precision !== null && precision >= 98 ? 'Activo' : precision !== null ? 'Validando' : 'En Calibración';
  const estado: StatsMolde['estado'] =
    meta?.estado === 'ninguno'
      ? null
      : meta?.estado === 'activo'
        ? 'Activo'
        : meta?.estado === 'validando'
          ? 'Validando'
          : estadoCalculado;
  const porTipo = { presencia: 0, firma: 0, texto: 0, checkbox: 0 };
  (molde?.campos ?? []).forEach((c) => {
    if (c.tipo in porTipo) porTipo[c.tipo as keyof typeof porTipo] += 1;
  });
  return {
    precision,
    docs,
    estado,
    porTipo,
    total: molde?.campos.length ?? 0,
    validacion: meta?.validacion,
    unidadDocs: meta?.unidadDocs,
    etiquetaCampos: meta?.etiquetaCampos,
    etiquetas: meta?.etiquetas,
    orden: meta?.orden,
  };
}

const SEGMENTOS: { tipo: keyof StatsMolde['porTipo']; etiqueta: string; barra: string; chip: string }[] = [
  { tipo: 'presencia', etiqueta: 'Presencia', barra: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-900' },
  { tipo: 'firma', etiqueta: 'Firmas', barra: 'bg-violet-500', chip: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/60 dark:text-violet-300 dark:border-violet-900' },
  { tipo: 'texto', etiqueta: 'Texto/ID', barra: 'bg-sky-500', chip: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-900' },
  { tipo: 'checkbox', etiqueta: 'Checkbox', barra: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-900' },
];

export default function MoldesTab() {
  const { moldes, cargandoMoldes, setPestana, abrirMolde, eliminarMolde, cargarMoldes } = useStudio();
  const { toast } = useToast();
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [dialogNuevo, setDialogNuevo] = useState(false);
  const [dialogImportar, setDialogImportar] = useState(false);
  const [dialogRenombrar, setDialogRenombrar] = useState<{ id: string; nombre: string } | null>(null);
  const [nombreNuevo, setNombreNuevo] = useState('');
  const [documentoNuevo, setDocumentoNuevo] = useState('');
  const [jsonImport, setJsonImport] = useState('');
  const [creando, setCreando] = useState(false);
  const [importando, setImportando] = useState(false);
  const fileJsonRef = useRef<HTMLInputElement>(null);

  const statsPorId = useMemo(() => {
    const map = new Map<string, StatsMolde>();
    moldes.forEach((m) => map.set(m.id, statsDe(m)));
    return map;
  }, [moldes]);

  const conteos = useMemo(() => {
    let activo = 0;
    let preciso = 0;
    let calibrando = 0;
    moldes.forEach((m) => {
      const s = statsPorId.get(m.id)!;
      if (s.estado === 'Activo') activo += 1;
      if (s.precision !== null && s.precision > 98) preciso += 1;
      if (s.estado === 'En Calibración') calibrando += 1;
    });
    return { todos: moldes.length, activo, preciso, calibrando };
  }, [moldes, statsPorId]);

  const filtrados = useMemo(
    () =>
      moldes.filter((m) => {
        const s = statsPorId.get(m.id);
        if (!s) return false;
        if (filtro === 'activo' && s.estado !== 'Activo') return false;
        if (filtro === 'preciso' && !(s.precision !== null && s.precision > 98)) return false;
        if (filtro === 'calibrando' && s.estado !== 'En Calibración') return false;
        const q = busqueda.toLowerCase();
        return (
          !q ||
          m.nombre.toLowerCase().includes(q) ||
          (m.documento ?? '').toLowerCase().includes(q) ||
          slugMolde(m.nombre).includes(q) ||
          m.id.toLowerCase().includes(q) ||
          s.total.toString().includes(q)
        );
      })
        // Orden del diseño Stitch (meta.orden) primero; el resto por updatedAt.
        .sort((a, b) => {
          const oa = statsPorId.get(a.id)?.orden;
          const ob = statsPorId.get(b.id)?.orden;
          if (oa != null && ob != null) return oa - ob;
          if (oa != null) return -1;
          if (ob != null) return 1;
          return 0;
        }),
    [moldes, filtro, busqueda, statsPorId],
  );

  async function crearNuevo() {
    if (!nombreNuevo.trim()) return;
    setCreando(true);
    try {
      const molde: MoldeUniversal = {
        tipo: 'universal',
        version: MOLDE_UNIVERSAL_VERSION,
        nombre: nombreNuevo.trim(),
        documento: documentoNuevo.trim() || undefined,
        idioma: 'spa',
        campos: [],
      };
      const r = await repo.crearMolde({ json: molde });
      if (r.ok) {
        await cargarMoldes();
        setDialogNuevo(false);
        setNombreNuevo('');
        setDocumentoNuevo('');
        toast({ title: 'Molde creado', description: 'Ábrelo en el editor para dibujar sus zonas.' });
      } else {
        toast({ title: 'Error al crear', description: r.error, variant: 'destructive' });
      }
    } finally {
      setCreando(false);
    }
  }

  async function importar() {
    const texto = jsonImport.trim();
    if (!texto) return;
    setImportando(true);
    try {
      let obj: unknown;
      try {
        obj = JSON.parse(texto);
      } catch {
        toast({ title: 'JSON inválido', description: 'Revisa la sintaxis.', variant: 'destructive' });
        return;
      }
      let universal: MoldeUniversal | null = null;
      if (esMoldeUniversal(obj)) {
        universal = obj;
      } else if (pareceMoldeE14(obj)) {
        universal = importarMoldeE14(obj as never);
        toast({
          title: 'Molde E-14 detectado',
          description: 'Se convirtió al formato universal. Revisa las zonas en el editor.',
        });
      } else {
        toast({
          title: 'Formato no reconocido',
          description: 'Se espera un molde universal (tipo "universal") o un molde E-14 (motor + campos).',
          variant: 'destructive',
        });
        return;
      }
      const r = await repo.crearMolde({ json: universal });
      if (r.ok) {
        await cargarMoldes();
        setDialogImportar(false);
        setJsonImport('');
        toast({ title: 'Molde importado', description: universal.nombre });
      } else {
        toast({ title: 'Error al importar', description: r.error, variant: 'destructive' });
      }
    } finally {
      setImportando(false);
    }
  }

  async function duplicar(id: string) {
    const m = moldes.find((x) => x.id === id);
    if (!m) return;
    const molde = JSON.parse(m.json) as MoldeUniversal;
    molde.nombre = `${molde.nombre} (copia)`;
    molde.campos = molde.campos.map((c) => ({ ...c, id: nuevoIdCampo() }));
    const r = await repo.crearMolde({ json: molde });
    if (r.ok) {
      await cargarMoldes();
      toast({ title: 'Molde duplicado' });
    }
  }

  async function renombrar() {
    if (!dialogRenombrar || !dialogRenombrar.nombre.trim()) return;
    const r = await repo.actualizarMolde(dialogRenombrar.id, {
      nombre: dialogRenombrar.nombre.trim(),
    });
    if (r.ok) {
      await cargarMoldes();
      toast({ title: 'Molde renombrado', description: dialogRenombrar.nombre.trim() });
      setDialogRenombrar(null);
    } else {
      toast({ title: 'Error al renombrar', description: r.error, variant: 'destructive' });
    }
  }

  function descargarJson(m: MoldeDB) {
    try {
      const blob = new Blob([JSON.stringify(JSON.parse(m.json), null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${slugMolde(m.nombre)}.molde.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      toast({ title: 'JSON del molde inválido', variant: 'destructive' });
    }
  }

  function leerArchivoJson(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setJsonImport(String(reader.result ?? ''));
    reader.readAsText(f);
    e.target.value = '';
  }

  function abrirEditor(id: string) {
    abrirMolde(id);
    setPestana('editor');
  }

  function abrirPruebas(id: string) {
    abrirMolde(id);
    setPestana('verificacion');
  }

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 py-4 sm:px-6">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
        <span>Inicio</span>
        <ChevronRight className="h-3 w-3 text-slate-400" aria-hidden />
        <span className="font-semibold text-slate-800 dark:text-slate-100">Biblioteca de Plantillas</span>
      </nav>

      {/* Hero */}
      <section className="flex flex-col justify-between gap-4 rounded-xl border border-transparent bg-surface-lowest p-4 shadow-xs sm:p-5 dark:border-slate-800/80 lg:flex-row lg:items-center">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="h-5 w-2 rounded-full bg-brand" aria-hidden />
            <h1 className="text-lg font-bold tracking-tight text-on-surface sm:text-lg">
              Biblioteca Universal de Plantillas &amp; Esquemas
            </h1>
          </div>
          <p className="max-w-3xl text-xs leading-4 text-on-surface-variant">
            Gestiona geometrías de calibración espacial y anclaje visual en esquema unificado. Compatible con
            motores OCR, HTR manuscrito, códigos 1D/2D y verificación visual mediante LLM/VLM multimodales.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            onClick={() => setDialogImportar(true)}
            className="gap-2 rounded-lg border border-slate-200 bg-surface-low px-3.5 py-2 text-xs font-medium text-on-surface shadow-2xs hover:bg-surface-high dark:border-slate-800 dark:bg-slate-800"
            variant="secondary"
          >
            <Upload className="h-4 w-4 text-brand dark:text-indigo-400" aria-hidden />
            Importar JSON
          </Button>
          <Button onClick={() => setDialogNuevo(true)} className="gap-2 rounded-lg px-3.5 py-2 text-xs font-medium shadow-xs">
            <Plus className="h-4 w-4" aria-hidden />
            Crear desde cero
          </Button>
        </div>
      </section>

      {/* Búsqueda + filtros rápidos */}
      <div className="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
        <div className="relative max-w-xl flex-1">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-outline-dim dark:text-slate-400"
            aria-hidden
          />
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar molde por nombre, versión, ID de SQLite o compatibilidad..."
            aria-label="Buscar moldes"
            className="w-full rounded-lg border border-transparent bg-surface-lowest py-2 pl-10 pr-4 text-xs text-on-surface shadow-2xs placeholder:text-outline-dim focus:outline-none focus:ring-2 focus:ring-brand/25 dark:border-slate-800 dark:bg-slate-900 dark:placeholder:text-slate-500"
          />
        </div>
        <div className="flex items-center gap-2 overflow-x-auto py-1">
          <span className="whitespace-nowrap font-mono text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant">
            Filtro rápido:
          </span>
          {(
            [
              { id: 'todos', label: `Todos (${conteos.todos})` },
              { id: 'activo', label: `Activo (${conteos.activo})` },
              { id: 'preciso', label: '>98% Precisión' },
              { id: 'calibrando', label: 'En Calibración' },
            ] as { id: Filtro; label: string }[]
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFiltro(f.id)}
              className={`whitespace-nowrap rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold shadow-2xs transition-colors ${
                filtro === f.id
                  ? 'bg-brand text-white'
                  : 'border border-transparent bg-surface-lowest text-on-surface-variant hover:bg-brand-surface dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800'
              }`}
              aria-pressed={filtro === f.id}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grilla de tarjetas */}
      {cargandoMoldes ? (
        <div className="flex items-center justify-center py-16 text-sm text-on-surface-variant">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Cargando moldes...
        </div>
      ) : filtrados.length === 0 ? (
        <Card className="rounded-xl">
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <FileJson className="h-10 w-10 text-outline-dim" aria-hidden />
            <p className="font-medium">{moldes.length === 0 ? 'Aún no hay moldes' : 'Sin resultados para este filtro'}</p>
            <p className="max-w-md text-sm text-on-surface-variant">
              {moldes.length === 0
                ? 'Crea un molde desde cero o importa un JSON existente (formato universal v3 o el molde E-14 v2 anterior, que se convierte automáticamente).'
                : 'Ningún molde cumple con la búsqueda o el filtro rápido seleccionado.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {filtrados.map((m) => {
            const s = statsPorId.get(m.id)!;
            const activo = s.estado === 'Activo';
            const segmentos = SEGMENTOS.filter((seg) => s.porTipo[seg.tipo] > 0);
            return (
              <article
                key={m.id}
                className="flex flex-col justify-between overflow-hidden rounded-xl border border-transparent bg-surface-lowest shadow-xs transition-all hover:shadow-md dark:border-slate-800/80"
              >
                <div className="flex h-full flex-col gap-3 p-4">
                  {/* Encabezado: badges + precisión + menú */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col gap-1 pr-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-surface-container px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant dark:bg-slate-800">
                          {m.documento ?? 'general'}
                        </span>
                        <span className="rounded-md bg-brand-surface px-2 py-0.5 font-mono text-[10px] font-bold text-brand dark:bg-indigo-950/60 dark:text-indigo-300">
                          v{(() => {
                            try {
                              return (JSON.parse(m.json) as MoldeUniversal).version ?? MOLDE_UNIVERSAL_VERSION;
                            } catch {
                              return MOLDE_UNIVERSAL_VERSION;
                            }
                          })()}
                        </span>
                        {s.estado === 'Activo' ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
                            Activo
                          </span>
                        ) : s.estado === 'Validando' ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 font-mono text-[10px] font-bold text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
                            Validando
                          </span>
                        ) : null}
                      </div>
                      <h2 className="mt-0.5 text-base font-bold leading-6 text-on-surface">{m.nombre}</h2>
                      <div className="flex items-center gap-2 font-mono text-[11px] text-on-surface-variant">
                        <ReceiptText className="h-3.5 w-3.5" aria-hidden />
                        <span>
                          ID: <code className="font-semibold text-brand dark:text-indigo-400">{slugMolde(m.nombre)}</code>
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-start gap-1">
                      <div className="mr-1 flex flex-col items-end">
                        <span
                          className={`font-mono text-lg font-bold leading-tight ${
                            s.precision === null
                              ? 'text-slate-400'
                              : s.precision >= 95
                                ? 'text-success-text'
                                : 'text-warning-text'
                          }`}
                        >
                          {s.precision === null ? '—' : `${s.precision.toFixed(1)}%`}
                        </span>
                        <span className="font-mono text-[9px] font-bold uppercase text-on-surface-variant">
                          {s.docs.toLocaleString('en-US')} {s.unidadDocs ?? 'docs validados'}
                        </span>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Opciones del molde"
                            className="h-8 w-8 rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                          >
                            <MoreVertical className="h-5 w-5" aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem onClick={() => abrirEditor(m.id)}>
                            <Pencil className="mr-2 h-4 w-4 text-brand" aria-hidden /> Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => abrirPruebas(m.id)}>
                            <FlaskConical className="mr-2 h-4 w-4 text-slate-500" aria-hidden /> Probar
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => duplicar(m.id)}>
                            <Copy className="mr-2 h-4 w-4 text-slate-500" aria-hidden /> Duplicar
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setDialogRenombrar({ id: m.id, nombre: m.nombre })}>
                            <Pencil className="mr-2 h-4 w-4 text-slate-500" aria-hidden /> Renombrar
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="font-medium text-danger-text focus:text-danger-text"
                            onClick={() => {
                              if (confirm(`¿Eliminar el molde "${m.nombre}" y sus pruebas?`)) eliminarMolde(m.id);
                            }}
                          >
                            <Trash2 className="mr-2 h-4 w-4" aria-hidden /> Eliminar
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  {/* Descripción */}
                  <p className="line-clamp-2 text-xs leading-4 text-on-surface-variant">
                    {m.descripcion || 'Esquema universal de zonas con anclaje OCR fuzzy y verificación de tinta manuscrita.'}
                  </p>

                  {/* Panel de stats */}
                  <div className="flex flex-col gap-2 rounded-xl bg-surface-low p-2.5 dark:bg-slate-800/60">
                    <div className="flex items-center justify-between text-on-surface dark:text-slate-200">
                      <span className="flex items-center gap-1.5 text-[11px] font-semibold">
                        <span className="inline-flex h-3.5 w-3.5 items-center justify-center" aria-hidden>
                          <span className="h-2 w-3 rounded-[3px] border-[1.5px] border-current" />
                        </span>
                        {s.total} {s.etiquetaCampos ?? 'Campos Mapeados'}
                      </span>
                      <span className="font-mono text-[10px] font-bold text-on-surface-variant">
                        {s.validacion ?? 'Esquema universal v3'}
                      </span>
                    </div>
                    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-container dark:bg-slate-700">
                      {segmentos.length === 0 ? (
                        <div className="h-full w-full bg-slate-300 dark:bg-slate-600" />
                      ) : (
                        segmentos.map((seg) => (
                          <div
                            key={seg.tipo}
                            className={`${seg.barra} h-full`}
                            style={{ width: `${(s.porTipo[seg.tipo] / Math.max(1, s.total)) * 100}%` }}
                          />
                        ))
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {segmentos.length === 0 ? (
                        <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5 font-mono text-[10px] font-semibold text-on-surface-variant dark:border-slate-700 dark:bg-slate-900">
                          Sin zonas dibujadas
                        </span>
                      ) : (
                        segmentos.map((seg) => (
                          <span
                            key={seg.tipo}
                            className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[10px] font-semibold ${seg.chip}`}
                          >
                            <span className="h-1 w-1 rounded-full bg-current" aria-hidden />
                            {s.porTipo[seg.tipo]} {s.etiquetas?.[seg.tipo] ?? seg.etiqueta}
                          </span>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Fecha de modificación */}
                  <p className="flex items-center gap-1.5 font-mono text-[11px] text-on-surface-variant">
                    <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-current" aria-hidden />
                    Modificado: {formatFechaRelativa(m.updatedAt)}
                  </p>
                </div>

                {/* Footer: abrir editor + descargar */}
                <div className="flex gap-2 px-4 pb-4">
                  <Button
                    onClick={() => abrirEditor(m.id)}
                    className={`flex-1 gap-2 rounded-lg text-xs font-semibold ${
                      activo
                        ? 'bg-brand text-white hover:bg-brand-active'
                        : 'border border-slate-200 bg-brand-surface text-brand hover:bg-brand-highlight dark:border-slate-700 dark:bg-slate-800 dark:text-indigo-300 dark:hover:bg-slate-700'
                    }`}
                    variant={activo ? 'default' : 'secondary'}
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                    Abrir en Editor Visual
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Descargar JSON del molde"
                    title="Descargar JSON"
                    onClick={() => descargarJson(m)}
                    className="h-10 w-10 shrink-0 rounded-lg border-slate-200 bg-surface-lowest text-on-surface-variant hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800"
                  >
                    <Download className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Diálogo: nuevo molde */}
      <Dialog open={dialogNuevo} onOpenChange={setDialogNuevo}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Crear molde desde cero</DialogTitle>
            <DialogDescription>
              Define el nombre y el tipo de documento. Después dibujarás las zonas sobre el escaneo de
              referencia en el Editor Visual.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="nuevo-nombre">Nombre</Label>
              <Input
                id="nuevo-nombre"
                value={nombreNuevo}
                onChange={(e) => setNombreNuevo(e.target.value)}
                placeholder="Ej: Factura Electrónica & Recibo Fiscal"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nuevo-doc">Categoría del documento (informativo)</Label>
              <Input
                id="nuevo-doc"
                value={documentoNuevo}
                onChange={(e) => setDocumentoNuevo(e.target.value)}
                placeholder="Ej: fiscal & comercial, acta_e14, legal & notarial..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogNuevo(false)}>
              Cancelar
            </Button>
            <Button onClick={crearNuevo} disabled={creando || !nombreNuevo.trim()}>
              {creando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Crear molde
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo: importar JSON */}
      <Dialog open={dialogImportar} onOpenChange={setDialogImportar}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Importar molde JSON</DialogTitle>
            <DialogDescription>
              Acepta el formato universal v3 o el molde E-14 v2 anterior (se convierte automáticamente al
              formato universal).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input
              ref={fileJsonRef}
              type="file"
              accept=".json,application/json"
              onChange={leerArchivoJson}
              aria-label="Cargar archivo JSON"
            />
            <Textarea
              value={jsonImport}
              onChange={(e) => setJsonImport(e.target.value)}
              placeholder={'Pega aquí el JSON del molde: { "tipo": "universal", ... }'}
              className="min-h-56 font-mono text-xs"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogImportar(false)}>
              Cancelar
            </Button>
            <Button onClick={importar} disabled={importando || !jsonImport.trim()}>
              {importando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Importar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo: renombrar */}
      <Dialog open={Boolean(dialogRenombrar)} onOpenChange={(v) => !v && setDialogRenombrar(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Renombrar molde</DialogTitle>
            <DialogDescription>Elige un nombre legible; el ID interno no cambia.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label htmlFor="renombrar-nombre">Nombre</Label>
            <Input
              id="renombrar-nombre"
              value={dialogRenombrar?.nombre ?? ''}
              onChange={(e) => setDialogRenombrar((d) => (d ? { ...d, nombre: e.target.value } : d))}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogRenombrar(null)}>
              Cancelar
            </Button>
            <Button onClick={renombrar} disabled={!dialogRenombrar?.nombre.trim()}>
              <CircleCheck className="mr-2 h-4 w-4" /> Guardar nombre
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
