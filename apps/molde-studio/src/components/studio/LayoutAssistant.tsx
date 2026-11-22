'use client';

// Fase F3 (PLAN-AGENTE-LAYOUT, tarea 4-a): asistente de REGLAS ESTRUCTURALES
// de layout. Autoría declarativa de zonas ("debe haber una tabla aquí", "3
// títulos en esta franja") sobre la imagen de referencia de la página actual,
// con propuestas desde el detector PP-DocLayout (@jg-stevan/dla-onnx) y
// evaluación local con el motor puro (@jg-stevan/layout-core).
//
// Principios:
// · El borrador vive SOLO en este componente: nada toca el molde hasta
//   «Guardar en el molde» (onGuardarLayout) — el padre persiste y muestra el
//   toast de confirmación.
// · Degradación honesta: sin modelo configurado (NEXT_PUBLIC_DLA_MODELO_LAYOUT)
//   la detección queda APAGADA y la autoría manual / desde campos sigue al 100%.
// · Pureza: la prueba corre con evaluarEstructura() de layout-core, la MISMA
//   función que usará Tamiz en el gate (cero divergencia de lógica).
// · Re-sincronización del borrador: solo cuando el `molde.layout` REAL cambia
//   (guardar / quitar / aplicar JSON externo). Un push de campos nuevos del
//   padre NO debe borrar el borrador en curso.

import { memo, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Loader2,
  Merge,
  Play,
  Plus,
  Save,
  ScanSearch,
  Scissors,
  Trash2,
  Wand2,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  conModelo,
  esCanonica,
  evaluarEstructura,
  normalizarClase,
  type CajaLayout,
  type ClaseLayout,
  type ResultadoEstructura,
} from '@jg-stevan/layout-core';
import { configuracionLista, configurarModelo, crearDetectorLayout, type Deteccion } from '@jg-stevan/dla-onnx';
import {
  nuevoIdCampo,
  type CampoUniversal,
  type LayoutMolde,
  type MoldeUniversal,
  type RectNorm,
  type ReglaLayout,
} from '@/lib/molde/universal-types';
import { repo } from '@/lib/repo';
import { cn } from '@/lib/utils';

configurarModelo('layout', process.env.NEXT_PUBLIC_DLA_MODELO_LAYOUT);

// ---- Contrato del componente ------------------------------------------------

interface LayoutAssistantProps {
  molde: MoldeUniversal;
  /** URL de la imagen de referencia de la página actual (ya resuelta a <img>). */
  imagenUrl: string | null;
  /** Página actual (1-indexada): las reglas nuevas se crean para ella. */
  pagina: number;
  /** ÚNICO punto de escritura del layout: solo en confirmación explícita. */
  onGuardarLayout: (layout: LayoutMolde) => void;
  /** Quita `molde.layout` (el padre hace `delete` sobre una copia). */
  onQuitarLayout: () => void;
  /** Entrega los campos creados dentro del asistente («+ nuevo campo…»). */
  onCamposNuevos: (campos: CampoUniversal[]) => void;
}

// ---- Constantes de presentación ---------------------------------------------

// Color por clase canónica (hex base; relleno con alpha vía sufijo). Inline
// styles a propósito: las clases dinámicas de Tailwind NO compilan.
const COLOR_CLASE: Record<string, string> = {
  text: '#38bdf8', // sky
  image: '#34d399', // emerald
  table: '#fbbf24', // amber
  doc_title: '#a78bfa', // violet
  paragraph_title: '#a78bfa', // violet
  figure_title: '#fb923c', // orange
  number: '#2dd4bf', // teal
  header: '#94a3b8', // slate
  footer: '#94a3b8', // slate
  seal: '#fb7185', // rose
  formula: '#e879f9', // fuchsia
};
const COLOR_OTRO = '#94a3b8';

const NOMBRE_CLASE: Record<string, string> = {
  text: 'Texto',
  image: 'Imagen',
  table: 'Tabla',
  doc_title: 'Título doc.',
  paragraph_title: 'Título sección',
  figure_title: 'Título figura',
  number: 'Número',
  header: 'Cabecera',
  footer: 'Pie',
  seal: 'Sello',
  formula: 'Fórmula',
};

const CHIP_ESTADO: Record<ResultadoEstructura['reglas'][number]['estado'], string> = {
  ok: 'border-emerald-700 bg-emerald-950/70 text-emerald-300',
  faltante: 'border-rose-800 bg-rose-950/70 text-rose-300',
  sobrante: 'border-orange-700 bg-orange-950/70 text-orange-300',
  baja_confianza: 'border-amber-700 bg-amber-950/70 text-amber-300',
};

const SIN_CAMPO = '__sin__';
const NUEVO_CAMPO = '__nuevo__';

// ---- Ayudantes puros ---------------------------------------------------------

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

// PP-DocLayout no es estable entre corridas en cabeceras/pies: el mismo bloque
// sale como `header` hoy y `paragraph_title`/`text` mañana (deriva de escala).
// Una regla de cabecera/pie acepta la familia de texto afín — la zona sigue
// siendo el filtro fuerte.
const CLASES_TEXTO_AFIN: ClaseLayout[] = ['header', 'footer', 'text', 'paragraph_title', 'doc_title', 'number'];
const CLASES_TEXTO_DEDUPE = new Set(['text', 'paragraph_title', 'doc_title', 'number']);

type ZonaNorm = { x: number; y: number; w: number; h: number };

function interseccionZona(a: ZonaNorm, b: ZonaNorm): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return ix * iy;
}
function iouZona(a: ZonaNorm, b: ZonaNorm): number {
  const inter = interseccionZona(a, b);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}
function contencionZona(pequena: ZonaNorm, grande: ZonaNorm): number {
  const area = pequena.w * pequena.h;
  return area > 0 ? interseccionZona(pequena, grande) / area : 0;
}
const f3 = (v: number) => (Number.isFinite(v) ? v.toFixed(3) : '—');

function clonarLayout(l: LayoutMolde | undefined): LayoutMolde {
  return l
    ? (JSON.parse(JSON.stringify(l)) as LayoutMolde)
    : { version: 1, modeloPreferido: 's', reglas: [] };
}

function nuevoIdRegla(): string {
  return `layout_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
}

/** Union de dos rects normalizados (rect envolvente). */
function unionRect(a: RectNorm, b: RectNorm): RectNorm {
  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.w, b.x + b.w);
  const y2 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** "0.384, 0.61" → [0.384, 0.61] (acepta , o ; como separador). */
function parseDecimales(txt: string): number[] {
  return txt
    .split(/[;,]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

/** Contrato de erroresMolde: cortes finitos, en (0,1), ESTRICTAMENTE crecientes. */
function cortesValidos(c: number[]): boolean {
  return (
    c.length > 0 &&
    c.every((x) => x > 0 && x < 1) &&
    c.every((x, i) => i === 0 || x > c[i - 1])
  );
}

/** Carga la referencia en un canvas (resuelve claves idb en modo estático). */
async function urlACanvas(url: string): Promise<HTMLCanvasElement> {
  const resuelta = (await repo.resolverUrl(url)) ?? url;
  const img = new Image();
  img.src = resuelta;
  await img.decode();
  // Límite defensivo: el worker reescala a la entrada del modelo (800 px);
  // un canvas gigante solo gastaría memoria en el bitmap intermedio.
  const MAX_LADO = 2000;
  const escala = Math.min(1, MAX_LADO / Math.max(img.naturalWidth, img.naturalHeight, 1));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * escala));
  c.height = Math.max(1, Math.round(img.naturalHeight * escala));
  const ctx = c.getContext('2d');
  if (ctx) ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

// ---- Overlay visual (memoizado) ----------------------------------------------

interface BloqueViz {
  key: string;
  etiqueta: string;
  sub: string | null;
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** regla = zona del borrador (clicable, borde sólido); det = detección cruda (borde punteado). */
  tipo: 'regla' | 'det';
  activa: boolean;
  onClick?: () => void;
}

const BloqueOverlay = memo(function BloqueOverlay({ b }: { b: BloqueViz }) {
  return (
    <div
      role={b.onClick ? 'button' : undefined}
      tabIndex={b.onClick ? 0 : undefined}
      aria-label={`Zona ${b.etiqueta}`}
      onClick={b.onClick}
      onKeyDown={(e) => {
        if (b.onClick && (e.key === 'Enter' || e.key === ' ')) b.onClick();
      }}
      className={cn('absolute', b.onClick ? 'cursor-pointer' : 'pointer-events-none')}
      style={{
        left: `${b.x * 100}%`,
        top: `${b.y * 100}%`,
        width: `${b.w * 100}%`,
        height: `${b.h * 100}%`,
        border: `2px ${b.tipo === 'det' ? 'dashed' : 'solid'} ${b.color}`,
        backgroundColor: `${b.color}26`,
        boxShadow: b.activa ? `0 0 0 2px ${b.color}` : undefined,
        zIndex: b.activa ? 10 : b.tipo === 'regla' ? 5 : 1,
      }}
    >
      <span
        className="absolute -top-4 left-0 max-w-full truncate rounded px-1 py-px font-mono text-[8px] leading-3 text-white"
        style={{ backgroundColor: b.color }}
      >
        {b.etiqueta}
        {b.sub ? ` · ${b.sub}` : ''}
      </span>
    </div>
  );
});

// ---- Botón-icono compacto de las filas ----------------------------------------

function BotonIcono({
  title,
  onClick,
  activo,
  peligro,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  activo?: boolean;
  peligro?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded p-1 transition-colors disabled:opacity-40',
        peligro
          ? 'text-rose-400 hover:bg-rose-950/60'
          : activo
            ? 'bg-indigo-600 text-white'
            : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200',
      )}
    >
      {children}
    </button>
  );
}

// ---- Estado interno de la detección -------------------------------------------

/** Detección cruda ya convertida a PIXELS de la página (contrato layout-core). */
interface DetEstado {
  W: number;
  H: number;
  ms: number;
  crudo: number;
  descartadas: number;
  cajas: CajaLayout[];
}

type DetectorLayout = {
  detectar: (canvas: HTMLCanvasElement, confMin?: number) => Promise<Deteccion[]>;
};

// ---- Componente principal ------------------------------------------------------

export default function LayoutAssistant({
  molde,
  imagenUrl,
  pagina,
  onGuardarLayout,
  onQuitarLayout,
  onCamposNuevos,
}: LayoutAssistantProps) {
  const { toast } = useToast();

  // Borrador: la única fuente de edición. Arranca del layout del molde. El
  // PADRE lo re-sincroniza POR CLAVE (key = firma del layout): cuando el
  // layout del molde cambia afuera (guardar / quitar / aplicar JSON) el
  // componente se remonta y el borrador se re-inicializa; un push de campos
  // nuevos NO cambia la clave y NO borra el borrador en curso.
  const [borrador, setBorrador] = useState<LayoutMolde>(() => clonarLayout(molde.layout));

  const [detectando, setDetectando] = useState(false);
  // det/resultado/abierto guardan la página de ORIGEN: cambiar de página los
  // deja fuera de uso por comparación (estados por página, sin efectos).
  const [det, setDet] = useState<(DetEstado & { pag: number }) | null>(null);
  const [resultado, setResultado] = useState<{ pag: number; res: ResultadoEstructura } | null>(null);
  const [abierto, setAbierto] = useState<{ pag: number; id: string; dividir: boolean } | null>(null);
  const [fusionFuente, setFusionFuente] = useState<string | null>(null);
  const [nuevoCampoPara, setNuevoCampoPara] = useState<string | null>(null);
  const [nuevoCampoEtiqueta, setNuevoCampoEtiqueta] = useState('');
  const [camposNuevos, setCamposNuevos] = useState<CampoUniversal[]>([]);
  // Error de carga de la imagen POR URL: otra referencia distinta deja de
  // «estar en error» por comparación (sin efecto de reset).
  const [imgErrorPara, setImgErrorPara] = useState<string | null>(null);
  // Mini-editor de «Partir»: textos locales que se comprometen SOLO si son válidos.
  const [divCortes, setDivCortes] = useState('');
  const [divEtiquetas, setDivEtiquetas] = useState('');

  // ids de propuestas creadas por DETECCIÓN (las re-detecciones de la página
  // las reemplazan; las reglas manuales/desde-campos nunca se tocan).
  const propiasRef = useRef<Set<string>>(new Set());
  const detectorRef = useRef<DetectorLayout | null>(null);

  const modeloConfigurado = configuracionLista('layout');
  const reglasPagina = useMemo(
    () => borrador.reglas.filter((r) => (r.pagina ?? 1) === pagina),
    [borrador.reglas, pagina],
  );
  const otrasPaginas = borrador.reglas.length - reglasPagina.length;
  const detActual = det && det.pag === pagina ? det : null;
  const abiertoActual = abierto && abierto.pag === pagina ? abierto : null;
  const resultadoActual = resultado && resultado.pag === pagina ? resultado.res : null;
  const fuente = borrador.reglas.find((r) => r.id === fusionFuente);
  const fusionActiva = fuente && (fuente.pagina ?? 1) === pagina ? fuente : null;

  // Apertura de reglas: precarga los textos del mini-editor «Partir» en el
  // MISMO evento (sin efectos: el lint prohíbe setState síncrono en efectos).
  const abrirRegla = (id: string, dividir: boolean) => {
    const r = borrador.reglas.find((x) => x.id === id);
    setDivCortes(r?.dividir ? r.dividir.cortes.join(', ') : '');
    setDivEtiquetas(r?.dividir?.etiquetas ? r.dividir.etiquetas.join(', ') : '');
    setAbierto({ pag: pagina, id, dividir });
  };

  const toggleAbrir = (id: string) => {
    if (abiertoActual?.id === id && !abiertoActual.dividir) setAbierto(null);
    else abrirRegla(id, false);
  };

  const toggleDividir = (id: string) => {
    if (abiertoActual?.id === id && abiertoActual.dividir) setAbierto(null);
    else abrirRegla(id, true);
  };

  // ---- Mutaciones del borrador -------------------------------------------------

  const mutarRegla = (id: string, cambios: Partial<ReglaLayout>) => {
    setBorrador((b) => ({
      ...b,
      reglas: b.reglas.map((r) => (r.id === id ? { ...r, ...cambios } : r)),
    }));
  };

  const descartar = (id: string) => {
    setBorrador((b) => ({ ...b, reglas: b.reglas.filter((r) => r.id !== id) }));
    if (abiertoActual?.id === id) setAbierto(null);
    if (fusionFuente === id) setFusionFuente(null);
  };

  const anadirReglaManual = () => {
    const r: ReglaLayout = {
      id: nuevoIdRegla(),
      etiqueta: `Regla ${borrador.reglas.length + 1}`,
      pagina,
      zona: { x: 0.1, y: 0.1, w: 0.8, h: 0.2 },
      clases: ['text'],
      obligatorio: false,
    };
    setBorrador((b) => ({ ...b, reglas: [...b.reglas, r] }));
    abrirRegla(r.id, false);
  };

  /** Reglas desde los campos de la página (idempotente por id layout_<campo>). */
  const crearDesdeCampos = () => {
    const eligibles = molde.campos.filter((c) => c.pagina === pagina);
    if (eligibles.length === 0) {
      toast({
        title: 'Sin campos en esta página',
        description: `La página ${pagina} no tiene campos para convertir en reglas.`,
      });
      return;
    }
    const ids = new Set(eligibles.map((c) => `layout_${c.id}`));
    setBorrador((b) => {
      const previas = b.reglas.filter((r) => !ids.has(r.id));
      const nuevas: ReglaLayout[] = eligibles.map((c) => ({
        id: `layout_${c.id}`,
        etiqueta: c.etiqueta,
        pagina,
        // ancla_relativa: la posición esperada vive en ancla.rect (si existe);
        // zona_fija (o ancla sin rect): la zona del campo tal cual.
        zona:
          c.estrategia === 'ancla_relativa' && c.ancla?.rect ? c.ancla.rect : c.zona,
        clases: ['text'],
        obligatorio: c.obligatorio,
        campoId: c.id,
      }));
      return { ...b, reglas: [...previas, ...nuevas] };
    });
    toast({
      title: `${eligibles.length} regla(s) desde campos`,
      description: 'Zonas tomadas de los campos de la página (ancla.rect cuando existe).',
    });
  };

  // ---- Detección (dla-onnx) + evaluación (layout-core) --------------------------

  async function correrDeteccion(): Promise<DetEstado | null> {
    if (!imagenUrl) return null;
    try {
      if (!detectorRef.current) {
        const d = await crearDetectorLayout();
        if (!d) return null; // sin URL configurada (env ausente)
        detectorRef.current = d;
      }
      const canvas = await urlACanvas(imagenUrl);
      const W = canvas.width;
      const H = canvas.height;
      if (!W || !H) return null;
      const t0 = performance.now();
      const lista = await detectorRef.current.detectar(canvas);
      const ms = Math.round((performance.now() - t0) * 100) / 100;
      let descartadas = 0;
      const cajas: CajaLayout[] = [];
      for (const d0 of lista) {
        const clase = normalizarClase(d0.clase);
        if (!esCanonica(clase)) {
          descartadas++;
          continue;
        }
        // Detección normalizada 0-1 (dla-onnx) → px de la página (layout-core).
        const x1 = clamp01(d0.caja.x) * W;
        const y1 = clamp01(d0.caja.y) * H;
        const x2 = clamp01(d0.caja.x + d0.caja.w) * W;
        const y2 = clamp01(d0.caja.y + d0.caja.h) * H;
        if (x2 - x1 < 2 || y2 - y1 < 2) {
          descartadas++;
          continue;
        }
        cajas.push({ clase, score: d0.conf, x1, y1, x2, y2 });
      }
      return { W, H, ms, crudo: lista.length, descartadas, cajas };
    } catch (e) {
      toast({
        title: 'No se pudo detectar el layout',
        description: e instanceof Error ? e.message : 'error desconocido del detector',
        variant: 'destructive',
      });
      return null;
    }
  }

  const detectarEstructura = async () => {
    if (detectando || !imagenUrl) return;
    setDetectando(true);
    try {
      const d = await correrDeteccion();
      if (!d) return;
      setDet({ ...d, pag: pagina });
      // Propuestas: una regla por detección canónica; las de ESTA página
      // reemplazan a las propuestas de la corrida anterior (las manuales no).
      const contadores = new Map<string, number>();
      const propuestas: ReglaLayout[] = [];
      const zonasTexto: ZonaNorm[] = [];
      for (const c of d.cajas) {
        // Re-normalización defensiva: al leer el pool la clase es ClaseLayout|string.
        const clase = normalizarClase(String(c.clase));
        if (!esCanonica(clase)) continue;
        const zx = clamp01(c.x1 / d.W);
        const zy = clamp01(c.y1 / d.H);
        const zw = Math.max(0.005, clamp01(c.x2 / d.W) - zx);
        const zh = Math.max(0.005, clamp01(c.y2 / d.H) - zy);
        const zona = { x: zx, y: zy, w: zw, h: zh };
        // El exporte deja bloques de texto anidados (bloque grande + sus
        // líneas). Una regla por bloque canónico evita que reglas duplicadas
        // se roben la misma caja en la asignación codiciosa del evaluador.
        if (
          CLASES_TEXTO_DEDUPE.has(clase) &&
          zonasTexto.some((z) => iouZona(z, zona) >= 0.5 || contencionZona(zona, z) >= 0.8)
        ) {
          continue;
        }
        if (CLASES_TEXTO_DEDUPE.has(clase)) zonasTexto.push(zona);
        const n = (contadores.get(clase) ?? 0) + 1;
        contadores.set(clase, n);
        propuestas.push({
          id: nuevoIdRegla(),
          etiqueta: `${NOMBRE_CLASE[clase] ?? clase} ${n}`,
          pagina,
          zona,
          clases:
            clase === 'header' || clase === 'footer' ? CLASES_TEXTO_AFIN : [clase],
          // Las propuestas son hipótesis: OPCIONALES hasta que el usuario decida.
          obligatorio: false,
        });
      }
      propiasRef.current = new Set(propuestas.map((p) => p.id).concat([...propiasRef.current]));
      setBorrador((b) => ({
        ...b,
        reglas: [
          ...b.reglas.filter(
            (r) => !(propiasRef.current.has(r.id) && (r.pagina ?? 1) === pagina),
          ),
          ...propuestas,
        ],
      }));
    } finally {
      setDetectando(false);
    }
  };

  const probarMolde = async () => {
    if (borrador.reglas.length === 0) {
      toast({ title: 'Borrador vacío', description: 'Agrega reglas antes de probar la estructura.' });
      return;
    }
    let base: DetEstado | null = detActual;
    if (!base || base.cajas.length === 0) {
      // Sin detecciones previas: si hay modelo, se intenta detectar al vuelo.
      setDetectando(true);
      try {
        base = await correrDeteccion();
      } finally {
        setDetectando(false);
      }
      if (!base || base.cajas.length === 0) {
        toast({
          title: 'Sin detecciones',
          description:
            'Ejecuta «Detectar estructura» con el modelo configurado (NEXT_PUBLIC_DLA_MODELO_LAYOUT) antes de probar.',
          variant: 'destructive',
        });
        return;
      }
      setDet({ ...base, pag: pagina });
    }
    // Motor puro compartido Studio↔Tamiz (misma firma que usará el gate).
    const res = evaluarEstructura(base.cajas, borrador.reglas, base.W, base.H, { pagina });
    // El evaluador reporta 's' por contrato: aquí solo se ROTULA con el modelo
    // seleccionado (las detecciones vinieron del detector configurado).
    setResultado({ pag: pagina, res: conModelo(res, borrador.modeloPreferido) });
  };

  // ---- Partir / fusionar / campos ------------------------------------------------

  const aplicarDividir = (id: string, cortesTxt: string, etqTxt: string) => {
    const cortes = parseDecimales(cortesTxt);
    if (cortesTxt.trim() === '') {
      mutarRegla(id, { dividir: undefined }); // vacío = quitar la división
      return;
    }
    if (!cortesValidos(cortes)) return; // nada inválido se persiste (hint rojo visible)
    const etqs = etqTxt
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    mutarRegla(id, {
      dividir: {
        eje: 'y',
        cortes,
        ...(etqs.length === cortes.length + 1 ? { etiquetas: etqs } : {}),
      },
    });
  };

  const fusionar = (idA: string, idB: string) => {
    if (idA === idB) return;
    setBorrador((b) => {
      const a = b.reglas.find((r) => r.id === idA);
      const c = b.reglas.find((r) => r.id === idB);
      if (!a || !c) return b;
      const fusion: ReglaLayout = {
        id: nuevoIdRegla(),
        etiqueta: `${a.etiqueta} + ${c.etiqueta}`,
        pagina: a.pagina,
        zona: unionRect(a.zona, c.zona),
        clases: [...new Set([...a.clases, ...c.clases])],
        // Capacidad: la unión debe poder contener lo que contenían ambas.
        minimo: Math.min(a.minimo ?? 1, c.minimo ?? 1),
        maximo: (a.maximo ?? 1) + (c.maximo ?? 1),
        obligatorio: a.obligatorio || c.obligatorio,
        // Si ambas apuntan a campos distintos se conserva el primero: la zona
        // fusionada ya no mapea limpio a dos campos OCR.
        campoId: a.campoId ?? c.campoId,
      };
      const idx = Math.min(
        b.reglas.findIndex((r) => r.id === idA),
        b.reglas.findIndex((r) => r.id === idB),
      );
      const resto = b.reglas.filter((r) => r.id !== idA && r.id !== idB);
      const reglas = [...resto];
      reglas.splice(Math.max(0, Math.min(idx, reglas.length)), 0, fusion);
      return { ...b, reglas };
    });
    setFusionFuente(null);
    setAbierto(null);
  };

  const confirmarNuevoCampo = () => {
    if (!nuevoCampoPara || !nuevoCampoEtiqueta.trim()) return;
    const r = borrador.reglas.find((x) => x.id === nuevoCampoPara);
    if (!r) return;
    const c: CampoUniversal = {
      id: nuevoIdCampo(),
      etiqueta: nuevoCampoEtiqueta.trim(),
      pagina: r.pagina ?? 1,
      tipo: 'texto',
      estrategia: 'zona_fija',
      zona: r.zona,
      umbral: 0.03,
      obligatorio: r.obligatorio,
    };
    setCamposNuevos((prev) => [...prev, c]);
    mutarRegla(r.id, { campoId: c.id });
    setNuevoCampoPara(null);
    setNuevoCampoEtiqueta('');
  };

  const onCampoChange = (reglaId: string, v: string) => {
    if (v === SIN_CAMPO) {
      mutarRegla(reglaId, { campoId: undefined });
      return;
    }
    if (v === NUEVO_CAMPO) {
      setNuevoCampoPara(reglaId);
      return;
    }
    setNuevoCampoPara(null);
    mutarRegla(reglaId, { campoId: v });
  };

  // ---- Guardar -------------------------------------------------------------------

  const guardar = () => {
    if (borrador.reglas.length === 0) return;
    // Orden indiferente: el padre compone con el estado MÁS reciente del store.
    if (camposNuevos.length > 0) onCamposNuevos(camposNuevos);
    onGuardarLayout(borrador);
    setCamposNuevos([]);
  };

  // ---- Overlay: detecciones (abajo) + zonas del borrador (arriba) ------------------

  const bloquesViz = useMemo<BloqueViz[]>(() => {
    const lista: BloqueViz[] = [];
    if (detActual) {
      detActual.cajas.forEach((c, i) => {
        const clase = normalizarClase(String(c.clase));
        lista.push({
          key: `det-${i}`,
          etiqueta: NOMBRE_CLASE[clase] ?? clase,
          sub: c.score.toFixed(2),
          color: COLOR_CLASE[clase] ?? COLOR_OTRO,
          x: c.x1 / detActual.W,
          y: c.y1 / detActual.H,
          w: (c.x2 - c.x1) / detActual.W,
          h: (c.y2 - c.y1) / detActual.H,
          tipo: 'det',
          activa: false,
        });
      });
    }
    for (const r of reglasPagina) {
      lista.push({
        key: `regla-${r.id}`,
        etiqueta: r.etiqueta,
        sub: null,
        color: COLOR_CLASE[r.clases[0] ?? ''] ?? COLOR_OTRO,
        x: r.zona.x,
        y: r.zona.y,
        w: r.zona.w,
        h: r.zona.h,
        tipo: 'regla',
        activa: abiertoActual?.id === r.id,
        onClick: () => toggleAbrir(r.id),
      });
    }
    return lista;
  }, [detActual, reglasPagina, abiertoActual]);

  // ---- Render ----------------------------------------------------------------------

  const estadoChip = (e: ResultadoEstructura['reglas'][number]['estado']) => (
    <Badge variant="outline" className={cn('px-1 py-0 text-[9px]', CHIP_ESTADO[e])}>
      {e === 'baja_confianza' ? 'baja confianza' : e}
    </Badge>
  );

  return (
    <div className="space-y-3 p-3">
      {/* 1 · Estado del molde */}
      <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-2">
        <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-slate-400">
          Estado del molde
        </span>
        {molde.layout ? (
          <p className="mt-0.5 text-[11px] text-slate-200">
            layout v{molde.layout.version} · modelo{' '}
            {molde.layout.modeloPreferido === 's' ? 'S' : 'plus-L'} · {molde.layout.reglas.length}{' '}
            regla(s) · edita el borrador libremente
          </p>
        ) : (
          <p className="mt-0.5 text-[11px] text-slate-400">
            Sin layout estructural — el borrador solo toca el molde al guardar.
          </p>
        )}
      </div>

      {!imagenUrl && (
        <p className="rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-2 text-[11px] text-slate-400">
          Sin imagen de referencia para la página {pagina}: la detección y el overlay necesitan
          imagen. Puedes definir reglas igual (manual o desde campos).
        </p>
      )}

      {/* 2 · Selector de modelo */}
      <div className="space-y-1.5">
        <Label className="font-mono text-[10px] uppercase tracking-widest text-slate-400">
          Modelo de detección
        </Label>
        <div className="grid grid-cols-2 gap-1.5">
          {(
            [
              { id: 's' as const, titulo: 'S (4,9 MB)', sub: 'rápido · gate por defecto' },
              { id: 'plusL' as const, titulo: 'plusL (129,7 MB)', sub: 'preciso · descarga opcional' },
            ]
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={borrador.modeloPreferido === m.id}
              onClick={() => setBorrador((b) => ({ ...b, modeloPreferido: m.id }))}
              className={cn(
                'rounded-lg border px-2 py-1.5 text-left transition-colors',
                borrador.modeloPreferido === m.id
                  ? 'border-indigo-600 bg-indigo-950/50'
                  : 'border-slate-800 bg-slate-950/60 hover:border-slate-700',
              )}
            >
              <span className="block font-mono text-[11px] font-semibold text-slate-100">{m.titulo}</span>
              <span className="block text-[9px] text-slate-400">{m.sub}</span>
            </button>
          ))}
        </div>
        <p className="flex items-start gap-1 text-[10px] text-amber-400/90">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          plusL requiere descarga opcional de 129,7 MB en el celular.
        </p>
      </div>

      {/* 3 · Acciones de autoría */}
      <div className="space-y-1.5">
        <div className="grid grid-cols-2 gap-1.5">
          <Button
            size="sm"
            className="h-8 bg-indigo-600 text-xs hover:bg-indigo-700"
            disabled={!imagenUrl || !modeloConfigurado || detectando}
            onClick={detectarEstructura}
          >
            {detectando ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <ScanSearch className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            )}
            {detectando ? 'Detectando…' : 'Detectar estructura'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 border-slate-700 bg-slate-950 text-xs text-slate-200 hover:bg-slate-800"
            disabled={detectando}
            onClick={probarMolde}
          >
            <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Probar molde
          </Button>
        </div>

        {!modeloConfigurado && (
          <div className="space-y-1.5 rounded-lg border border-amber-700/60 bg-amber-950/40 px-2.5 py-2">
            <p className="text-[11px] leading-relaxed text-amber-200">
              Modelo de layout no configurado (NEXT_PUBLIC_DLA_MODELO_LAYOUT). El editor sigue
              funcionando: define las reglas manualmente o desde los campos.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="h-7 border-amber-700/60 bg-transparent text-[11px] text-amber-200 hover:bg-amber-900/40"
              onClick={crearDesdeCampos}
            >
              <Wand2 className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Crear reglas desde campos
            </Button>
          </div>
        )}

        {modeloConfigurado && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 w-full border-slate-700 bg-slate-950 text-[11px] text-slate-200 hover:bg-slate-800"
            onClick={crearDesdeCampos}
          >
            <Wand2 className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Crear reglas desde campos
          </Button>
        )}

        {detActual && (
          <p className="font-mono text-[9px] text-slate-500">
            detección: {detActual.cajas.length} bloque(s) canónico(s) en {detActual.ms} ms ·{' '}
            {detActual.descartadas} propuesta(s) descartada(s) (clase no canónica o caja degenerada)
          </p>
        )}
      </div>

      {/* 4 · Overlay visual */}
      {imagenUrl && imgErrorPara !== imagenUrl && (
        <div className="relative select-none rounded-lg border border-slate-800 bg-slate-950">
          <img
            src={imagenUrl}
            alt={`Referencia de la página ${pagina}`}
            className="block w-full"
            onError={() => setImgErrorPara(imagenUrl)}
          />
          <div className="absolute inset-0">
            {bloquesViz.map((b) => (
              <BloqueOverlay key={b.key} b={b} />
            ))}
          </div>
          <p className="pointer-events-none absolute bottom-1 right-1 rounded bg-slate-950/80 px-1.5 py-0.5 font-mono text-[8px] text-slate-400">
            punteado = detección · sólido = regla del borrador (clic para editar)
          </p>
        </div>
      )}
      {imagenUrl && imgErrorPara === imagenUrl && (
        <p className="rounded-lg border border-rose-900/60 bg-rose-950/40 px-2.5 py-2 text-[11px] text-rose-300">
          La imagen de referencia no se pudo cargar: el overlay queda desactivado, las reglas siguen
          editables.
        </p>
      )}

      {/* 7 · Resultado de la prueba (evaluarEstructura) */}
      {resultadoActual && (
        <div className="space-y-1.5 rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
          <p className="font-mono text-[10px] text-slate-300">
            Modelo {resultadoActual.modelo === 's' ? 'S' : 'plus-L'} · {resultadoActual.ms} ms ·{' '}
            {resultadoActual.reglas.filter((r) => r.estado === 'ok').length} ok /{' '}
            {resultadoActual.reglas.filter((r) => r.estado !== 'ok').length} con problemas
          </p>
          {resultadoActual.obligatorias_faltantes.length > 0 && (
            <p className="flex items-start gap-1 text-[10px] text-rose-300">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              {resultadoActual.obligatorias_faltantes.length} regla(s) OBLIGATORIA(S) faltante(s) — el
              gate rechazaría la página: {resultadoActual.obligatorias_faltantes.join(', ')}
            </p>
          )}
          {resultadoActual.ok && !resultadoActual.requiere_revision && (
            <p className="text-[10px] text-emerald-300">Estructura correcta: la página pasaría a OCR.</p>
          )}
          {resultadoActual.requiere_revision && (
            <p className="text-[10px] text-amber-300">
              Solo opcionales con problemas: continúa a OCR con advertencia (requiere revisión).
            </p>
          )}
          <div className="scroll-fino max-h-56 overflow-y-auto rounded-md border border-slate-800">
            <table className="w-full font-mono text-[10px]">
              <thead className="sticky top-0 bg-slate-900 text-slate-400">
                <tr>
                  <th className="px-1.5 py-1 text-left font-medium">Regla</th>
                  <th className="px-1.5 py-1 text-left font-medium">Estado</th>
                  <th className="px-1.5 py-1 text-right font-medium">Score</th>
                  <th className="px-1.5 py-1 text-left font-medium">Motivo</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {resultadoActual.reglas.map((r) => (
                  <tr key={r.reglaId} className="border-t border-slate-800/70">
                    <td className="max-w-28 truncate px-1.5 py-1 text-slate-200">{r.etiqueta}</td>
                    <td className="px-1.5 py-1">{estadoChip(r.estado)}</td>
                    <td className="px-1.5 py-1 text-right">{r.score === null ? '—' : r.score.toFixed(2)}</td>
                    <td className="px-1.5 py-1 text-slate-500">{r.motivo ?? ''}</td>
                  </tr>
                ))}
                {resultadoActual.reglas.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-1.5 py-2 text-center text-slate-500">
                      Sin reglas para la página {pagina}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 5 · Lista de reglas del borrador */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Reglas del borrador ({borrador.reglas.length})
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 border-slate-700 bg-slate-950 px-2 text-[10px] text-slate-200 hover:bg-slate-800"
            onClick={anadirReglaManual}
          >
            <Plus className="mr-1 h-3 w-3" aria-hidden /> Añadir regla
          </Button>
        </div>
        {otrasPaginas > 0 && (
          <p className="text-[10px] text-slate-500">
            +{otrasPaginas} regla(s) en otras páginas (se guardan igual; el overlay muestra la página{' '}
            {pagina}).
          </p>
        )}

        {fusionActiva && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-700/60 bg-amber-950/40 px-2 py-1.5">
            <p className="text-[10px] text-amber-200">
              Elige la regla destino para fusionar con «{fusionActiva.etiqueta}» (misma página).
            </p>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 shrink-0 px-2 text-[10px] text-amber-200 hover:bg-amber-900/50"
              onClick={() => setFusionFuente(null)}
            >
              Cancelar
            </Button>
          </div>
        )}

        <div className="scroll-fino max-h-96 space-y-1.5 overflow-y-auto pr-1">
          {reglasPagina.length === 0 && (
            <p className="rounded-lg border border-dashed border-slate-800 px-2.5 py-3 text-center text-[11px] text-slate-500">
              Sin reglas en la página {pagina}. Detecta la estructura, crea desde los campos o añade
              una regla manual.
            </p>
          )}

          {reglasPagina.map((r) => {
            const abiertoEste = abiertoActual?.id === r.id;
            const cortesParseados = parseDecimales(divCortes);
            const cortesInvalidos = divCortes.trim() !== '' && !cortesValidos(cortesParseados);
            const etqsParseadas = divEtiquetas
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean);
            const etqMismatch =
              cortesValidos(cortesParseados) &&
              divEtiquetas.trim() !== '' &&
              etqsParseadas.length !== cortesParseados.length + 1;
            const pagRegla = r.pagina ?? 1;
            const opcionCampos: CampoUniversal[] = [
              ...molde.campos.filter((c) => c.pagina === pagRegla),
              ...camposNuevos.filter((c) => c.pagina === pagRegla),
            ];

            return (
              <div
                key={r.id}
                className={cn(
                  'rounded-lg border bg-slate-950/60',
                  abiertoEste ? 'border-indigo-700/70' : 'border-slate-800',
                )}
              >
                {/* Fila: etiqueta + toggle obligatoria + acciones */}
                <div className="flex items-center gap-1 px-2 py-1.5">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    aria-expanded={abiertoEste && !abiertoActual?.dividir}
                    onClick={() => toggleAbrir(r.id)}
                  >
                    <span className="truncate font-mono text-[11px] text-slate-100">{r.etiqueta}</span>
                    {r.dividir && (
                      <span className="shrink-0 rounded bg-teal-950/80 px-1 py-px font-mono text-[8px] text-teal-300">
                        dividida ×{r.dividir.cortes.length + 1}
                      </span>
                    )}
                  </button>
                  {/* Toggle inline Obligatorio/Opcional: si falta una OBLIGATORIA el
                      gate estructural rechaza la página (rechazo temprano a OCR). */}
                  <button
                    type="button"
                    aria-pressed={r.obligatorio}
                    title="Alternar obligatoria/opcional"
                    className={cn(
                      'shrink-0 rounded px-1 py-px font-mono text-[8px] font-bold transition-colors',
                      r.obligatorio
                        ? 'bg-rose-950/80 text-rose-300 hover:bg-rose-900/70'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700',
                    )}
                    onClick={() => mutarRegla(r.id, { obligatorio: !r.obligatorio })}
                  >
                    {r.obligatorio ? 'OBLIGATORIA' : 'OPCIONAL'}
                  </button>

                  {fusionActiva && fusionActiva.id !== r.id && (
                    <BotonIcono
                      title="Fusionar con esta regla"
                      activo
                      onClick={() => fusionar(fusionActiva.id, r.id)}
                    >
                      <Merge className="h-3.5 w-3.5" aria-hidden />
                    </BotonIcono>
                  )}
                  <BotonIcono
                    title="Partir en cortes"
                    activo={abiertoEste && Boolean(abiertoActual?.dividir)}
                    onClick={() => toggleDividir(r.id)}
                  >
                    <Scissors className="h-3.5 w-3.5" aria-hidden />
                  </BotonIcono>
                  <BotonIcono
                    title="Fusionar con otra regla"
                    activo={fusionActiva?.id === r.id}
                    onClick={() => setFusionFuente((f) => (f === r.id ? null : r.id))}
                  >
                    <Merge className="h-3.5 w-3.5" aria-hidden />
                  </BotonIcono>
                  <BotonIcono title="Descartar regla" peligro onClick={() => descartar(r.id)}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </BotonIcono>
                </div>

                {/* Coordenadas + clases + campo */}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-2 pb-1.5 font-mono text-[9px] text-slate-500">
                  <span>
                    x {f3(r.zona.x)} · y {f3(r.zona.y)} · w {f3(r.zona.w)} · h {f3(r.zona.h)}
                  </span>
                  {r.clases.map((c) => (
                    <span key={c} className="rounded bg-slate-800 px-1" style={{ color: COLOR_CLASE[c] ?? COLOR_OTRO }}>
                      {c}
                    </span>
                  ))}
                  {r.campoId && <span className="text-indigo-300">campo: {r.campoId}</span>}
                </div>

                {/* Expandido: editor de la regla */}
                {abiertoEste && !abiertoActual?.dividir && (
                  <div className="space-y-2 border-t border-slate-800 px-2 py-2">
                    <div className="space-y-1">
                      <Label htmlFor={`etq-${r.id}`} className="text-[10px] text-slate-400">
                        Etiqueta
                      </Label>
                      <Input
                        id={`etq-${r.id}`}
                        value={r.etiqueta}
                        onChange={(e) => mutarRegla(r.id, { etiqueta: e.target.value })}
                        className="h-7 border-slate-700 bg-slate-950 font-mono text-[11px] text-slate-100"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label htmlFor={`min-${r.id}`} className="text-[10px] text-slate-400">
                          Mín. bloques
                        </Label>
                        <Input
                          id={`min-${r.id}`}
                          type="number"
                          min={0}
                          step={1}
                          value={r.minimo ?? 1}
                          onChange={(e) => {
                            const v = Math.max(0, Math.floor(Number(e.target.value) || 0));
                            mutarRegla(r.id, {
                              minimo: v,
                              ...(v > (r.maximo ?? 1) ? { maximo: v } : {}),
                            });
                          }}
                          className="h-7 border-slate-700 bg-slate-950 font-mono text-[11px] text-slate-100"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`max-${r.id}`} className="text-[10px] text-slate-400">
                          Máx. bloques
                        </Label>
                        <Input
                          id={`max-${r.id}`}
                          type="number"
                          min={0}
                          step={1}
                          value={r.maximo ?? 1}
                          onChange={(e) => {
                            const v = Math.max(0, Math.floor(Number(e.target.value) || 0));
                            mutarRegla(r.id, { maximo: Math.max(v, r.minimo ?? 1) });
                          }}
                          className="h-7 border-slate-700 bg-slate-950 font-mono text-[11px] text-slate-100"
                        />
                      </div>
                    </div>
                    <p className="text-[9px] leading-snug text-slate-500">
                      «OBLIGATORIA» en la fila alterna la exigencia: si falta una obligatoria, el gate
                      estructural rechaza la página.
                    </p>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-slate-400">Campo OCR enlazado</Label>
                      <Select
                        value={r.campoId ?? SIN_CAMPO}
                        onValueChange={(v) => onCampoChange(r.id, v)}
                      >
                        <SelectTrigger
                          className="h-7 w-full border-slate-700 bg-slate-950 text-[11px] text-slate-200"
                          aria-label="Campo OCR enlazado a la regla"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="border-slate-700 bg-slate-950 text-slate-200">
                          <SelectItem value={SIN_CAMPO}>— sin campo —</SelectItem>
                          {opcionCampos.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.etiqueta}
                              {camposNuevos.some((n) => n.id === c.id) ? ' (nuevo)' : ''}
                            </SelectItem>
                          ))}
                          <SelectItem value={NUEVO_CAMPO}>+ nuevo campo…</SelectItem>
                        </SelectContent>
                      </Select>
                      {nuevoCampoPara === r.id && (
                        <div className="flex gap-1.5">
                          <Input
                            value={nuevoCampoEtiqueta}
                            placeholder="Etiqueta del nuevo campo"
                            onChange={(e) => setNuevoCampoEtiqueta(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') confirmarNuevoCampo();
                            }}
                            className="h-7 border-slate-700 bg-slate-950 text-[11px] text-slate-100"
                          />
                          <Button
                            size="sm"
                            className="h-7 bg-indigo-600 px-2 text-[10px] hover:bg-indigo-700"
                            disabled={!nuevoCampoEtiqueta.trim()}
                            onClick={confirmarNuevoCampo}
                          >
                            Crear
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-[10px] text-slate-400"
                            onClick={() => setNuevoCampoPara(null)}
                          >
                            Cancelar
                          </Button>
                        </div>
                      )}
                      <p className="text-[9px] leading-snug text-slate-500">
                        El campo se crea junto al layout al guardar (tipo texto, zona = la de la
                        regla).
                      </p>
                    </div>
                  </div>
                )}

                {/* Expandido (tijeras): mini-editor de división */}
                {abiertoEste && Boolean(abiertoActual?.dividir) && (
                  <div className="space-y-2 border-t border-slate-800 px-2 py-2">
                    <p className="font-mono text-[10px] text-slate-400">
                      Partir contenedor por cortes en y (relativos al contenedor) · zona y:{' '}
                      {f3(r.zona.y)} → {f3(r.zona.y + r.zona.h)}
                    </p>
                    <div className="space-y-1">
                      <Label htmlFor={`cortes-${r.id}`} className="text-[10px] text-slate-400">
                        Cortes 0-1 separados por comas (vacío = quitar)
                      </Label>
                      <Input
                        id={`cortes-${r.id}`}
                        value={divCortes}
                        placeholder="0.384, 0.61"
                        onChange={(e) => {
                          setDivCortes(e.target.value);
                          aplicarDividir(r.id, e.target.value, divEtiquetas);
                        }}
                        className="h-7 border-slate-700 bg-slate-950 font-mono text-[11px] text-slate-100"
                      />
                      {cortesInvalidos && (
                        <p className="text-[10px] text-rose-400">
                          Cortes inválidos: decimales en (0,1), estrictamente crecientes.
                        </p>
                      )}
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`etqs-${r.id}`} className="text-[10px] text-slate-400">
                        Etiquetas por parte (opcional)
                      </Label>
                      <Input
                        id={`etqs-${r.id}`}
                        value={divEtiquetas}
                        placeholder={
                          cortesValidos(cortesParseados)
                            ? `Parte 1, Parte 2, … (${cortesParseados.length + 1} partes)`
                            : 'Parte 1, Parte 2, …'
                        }
                        onChange={(e) => {
                          setDivEtiquetas(e.target.value);
                          aplicarDividir(r.id, divCortes, e.target.value);
                        }}
                        className="h-7 border-slate-700 bg-slate-950 font-mono text-[11px] text-slate-100"
                      />
                      {etqMismatch && (
                        <p className="text-[10px] text-amber-400">
                          Deja una etiqueta por parte ({cortesParseados.length + 1} en total) o vacía
                          el campo.
                        </p>
                      )}
                    </div>
                    <p className="font-mono text-[9px] text-slate-500">
                      {r.dividir
                        ? `activo: ${r.dividir.cortes.length} corte(s) → ${r.dividir.cortes.length + 1} parte(s)${
                            r.dividir.etiquetas ? ` · ${r.dividir.etiquetas.join(' | ')}` : ''
                          }`
                        : 'N cortes → N+1 partes (el contenedor de mayor área se reparte).'}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 8/9 · Guardar / quitar */}
      <div className="space-y-1.5 border-t border-slate-800 pt-2">
        {molde.layout && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 w-full border-rose-900/70 bg-transparent text-xs text-rose-300 hover:bg-rose-950/60"
            onClick={onQuitarLayout}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Quitar layout del molde
          </Button>
        )}
        <Button
          size="sm"
          className="h-8 w-full bg-indigo-600 text-xs hover:bg-indigo-700"
          disabled={borrador.reglas.length === 0}
          onClick={guardar}
        >
          <Save className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Guardar en el molde
        </Button>
        <p className="text-[10px] leading-snug text-slate-500">
          {borrador.reglas.length} regla(s) en el borrador
          {camposNuevos.length > 0 ? ` · ${camposNuevos.length} campo(s) nuevo(s) se crearán junto al layout` : ''}
          . Recuerda «Guardar Plantilla» para persistir el molde.
        </p>
      </div>
    </div>
  );
}
