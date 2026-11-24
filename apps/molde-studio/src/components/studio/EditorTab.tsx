'use client';

// Editor Visual WYSIWYG — diseño Stitch tri-panel oscuro:
// izquierda: árbol de campos agrupados por tipo; centro: lienzo con zoom,
// toggles de anclas/etiquetas/grid y barra de estado; derecha: propiedades
// con recorte 300 DPI + JSON en vivo. La lógica del motor universal intacta.

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  startTransition,
  useState,
} from 'react';
// Fase 3 (migración scanner-core): protocolo del sobre con checksum
// compartido con Tamiz (D5) — el SHA-256 vive en el contrato.
import { crearSobreMolde } from '@molde-suite/scanner-core/contract/sobre';
import {
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  Copy,
  Crosshair,
  Download,
  Eye,
  EyeOff,
  FileDown,
  FileUp,
  GripVertical,
  Link2,
  Loader2,
  Magnet,
  Maximize2,
  Minus,
  MoreVertical,
  MousePointer2,
  Pencil,
  Play,
  Plus,
  RotateCw,
  Save,
  ScanLine,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
  SquareDashedMousePointer,
  Table,
  Trash2,
  Wand2,
} from 'lucide-react';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import LayoutAssistant from '@/components/studio/LayoutAssistant';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  alinearAnclas,
  editDistancePonderada,
  lineasEnFaro,
  normTxt,
  rectEditor,
  resolverRectRelacional,
  sugerirUmbralClustering,
} from '@/lib/molde/universal-engine';
import type { LineaOcr } from '@/lib/molde/types';
import { detectarTablaCompleta, type TablaDetectada } from '@/lib/molde/tabla-detect';
import { auditarCamposPagina, type InformePagina } from '@/lib/molde/auditoria';
import { ocrLines, setOcrProgress } from '@/lib/ocr/ocr-client';
import { escalarCanvas, renderDocumento } from '@/lib/ocr/pdf-client';
import {
  MOLDE_UNIVERSAL_VERSION,
  erroresMolde,
  esMoldeUniversal,
  hexTipo,
  nuevoIdCampo,
  type CampoUniversal,
  type EstrategiaCampo,
  type MoldeUniversal,
  type RectNorm,
  type RelacionAncla,
  type ResultadoUniversal,
  type TipoCampo,
} from '@/lib/molde/universal-types';
import { repo, useUrlResuelta } from '@/lib/repo';
import { useStudio } from '@/lib/studio-store';

const CLAMP = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));

/** Set compartido «sin cajas eliminadas»: identidad estable para memo/deps. */
const SIN_ELIMINADAS: ReadonlySet<number> = new Set();

/** Rect normalizado (0–1) de la caja de una línea OCR sobre la página. */
function rectDeLineaOcr(l: LineaOcr, dims: { w: number; h: number }): RectNorm {
  const [x0, y0, x1, y1] = l.bbox;
  return {
    x: x0 / dims.w,
    y: y0 / dims.h,
    w: (x1 - x0) / dims.w,
    h: (y1 - y0) / dims.h,
  };
}

/** Longitud máxima de la etiqueta de un campo creado desde una caja OCR. */
const ETIQUETA_OCR_MAX = 48;

const TIPOS: { id: TipoCampo; nombre: string; dot: string; grupo: string }[] = [
  { id: 'presencia', nombre: 'Cifras', dot: 'bg-emerald-500', grupo: 'Dato Variable (Presencia)' },
  { id: 'texto', nombre: 'Texto', dot: 'bg-sky-500', grupo: 'Manuscrito (Texto OCR)' },
  { id: 'firma', nombre: 'Firma', dot: 'bg-violet-500', grupo: 'Firma (Firmas y sellos)' },
  { id: 'checkbox', nombre: 'OMR', dot: 'bg-amber-500', grupo: 'Checkbox (OMR)' },
];

const NOMBRE_TIPO: Record<TipoCampo, string> = {
  presencia: 'Cifras / Presencia',
  texto: 'Manuscrito / Texto',
  firma: 'Firma / Sello',
  checkbox: 'Checkbox OMR',
};

// P2 (diagnóstico 2026-11-21 §3): las zonas del lienzo son componentes
// MEMOIZADOS con props primitivas — seleccionar/mover un campo ya NO
// re-renderiza todo el árbol de overlays (pointerdown de 640 ms medido en la
// sesión trazada). Solo la zona cuyo rect o estado `activo` cambia se
// re-renderiza; el resto compara props y descarta.
interface ZonaCampoProps {
  campoId: string;
  etiqueta: string;
  color: string;
  activo: boolean;
  verEtiquetas: boolean;
  /** En modo Detectar tabla las zonas NO capturan puntero: el arrastre
      sobre el lienzo es para delimitar la tabla, no para mover zonas. */
  inerte: boolean;
  rx: number;
  ry: number;
  rw: number;
  rh: number;
  onArrastreZona: (e: React.PointerEvent, campoId: string, modo: 'mover' | 'redimensionar') => void;
  onSeleccion: (id: string | null) => void;
}

const ZonaCampo = memo(function ZonaCampo({
  campoId,
  etiqueta,
  color,
  activo,
  verEtiquetas,
  inerte,
  rx,
  ry,
  rw,
  rh,
  onArrastreZona,
  onSeleccion,
}: ZonaCampoProps) {
  return (
    <div
      role="button"
      tabIndex={inerte ? -1 : 0}
      aria-label={`Zona ${etiqueta}`}
      className={`absolute border-2 transition-shadow ${inerte ? 'pointer-events-none' : 'cursor-move'} ${activo ? 'z-10 shadow-[0_0_0_2px_rgba(255,255,255,0.85),0_0_18px_rgba(99,102,241,0.65)]' : 'opacity-85'}`}
      style={{
        left: `${rx * 100}%`,
        top: `${ry * 100}%`,
        width: `${rw * 100}%`,
        height: `${rh * 100}%`,
        color,
        borderColor: color,
        backgroundColor: `${color}26`,
        borderWidth: activo ? 3 : 1.6,
      }}
      onPointerDown={(e) => onArrastreZona(e, campoId, 'mover')}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSeleccion(campoId);
      }}
    >
      {verEtiquetas ? (
        <span
          className="absolute -top-5 left-0 max-w-full truncate rounded px-1.5 py-0.5 font-mono text-[9px] font-bold text-white"
          style={{ backgroundColor: color }}
        >
          {etiqueta}
        </span>
      ) : null}
      {activo ? (
        <span
          role="button"
          aria-label="Redimensionar zona"
          className="absolute -bottom-2 -right-2 h-4 w-4 cursor-se-resize rounded-full border-2 border-white shadow"
          style={{ backgroundColor: color }}
          onPointerDown={(e) => onArrastreZona(e, campoId, 'redimensionar')}
          onClick={(e) => e.stopPropagation()}
        />
      ) : null}
    </div>
  );
});

async function imagenACanvas(url: string): Promise<HTMLCanvasElement> {
  const img = new Image();
  // En modo estático la URL puede ser una clave IndexedDB: se resuelve a object URL.
  img.src = await repo.resolverUrl(url);
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext('2d')!.drawImage(img, 0, 0);
  // Matiz 2 (Fase 2.6): el editor calibra y alinea sobre el MISMO render de
  // 1000 px que usa el motor en la verificación (antes usaba la resolución
  // natural de la foto y los rects capturados quedaban en otra escala).
  return escalarCanvas(c, 1000);
}

// FIX (rendimiento): caché de canvases decodificados por URL. Antes, el recorte
// del panel derecho re-decodificaba la imagen de referencia COMPLETA en cada
// render (al arrastrar una zona se disparaban decenas de decodificaciones de
// ~1000x3028 px -> tirones visibles). Las URLs de /uploads son UUID únicos e
// inmutables, así que cachear por URL es seguro.
const canvasCache = new Map<string, Promise<HTMLCanvasElement>>();
function canvasDe(url: string): Promise<HTMLCanvasElement> {
  let p = canvasCache.get(url);
  if (!p) {
    p = imagenACanvas(url);
    canvasCache.set(url, p);
    p.catch(() => canvasCache.delete(url));
  }
  return p;
}

export default function EditorTab() {
  const {
    moldes,
    moldeId,
    molde,
    setPestana,
    setMoldeActual,
    guardarMoldeActual,
    cargarPruebas,
    setPruebaId,
    campoSeleccionadoId,
    setCampoSeleccionado,
    solicitarReejecucion,
  } = useStudio();
  const { toast } = useToast();
  const [busqueda, setBusqueda] = useState('');
  const [filtroTipo, setFiltroTipo] = useState<'todos' | TipoCampo>('todos');
  const [pagina, setPagina] = useState(1);
  const [alineando, setAlineando] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [probando, setProbando] = useState(false);
  const [jsonAplicar, setJsonAplicar] = useState('');
  const [zoom, setZoom] = useState(78);
  const [verAnclas, setVerAnclas] = useState(true);
  const [verEtiquetas, setVerEtiquetas] = useState(true);
  const [verGrid, setVerGrid] = useState(false);
  // ---- Capa OCR (visualización del reconocimiento sobre el escaneo) ----
  // El toggle activa la ejecución de OCR de página completa (ocrLines, el MISMO
  // pipeline que usa "Alinear anclas") y resalta cada línea reconocida sobre
  // el lienzo (velo de color, SIN cajas): feedback visual de QUÉ ve el OCR y
  // DÓNDE — imprescindible para calibrar anclas y decidir estrategias.
  const [verOcr, setVerOcr] = useState(false);
  const [ocrCapa, setOcrCapa] = useState<{
    key: string;
    lines: LineaOcr[];
    dims: { w: number; h: number };
    conf: number | null;
    ms: number;
  } | null>(null);
  const [ocrEstado, setOcrEstado] = useState<'inactivo' | 'cargando' | 'listo' | 'error'>('inactivo');
  const [ocrProgreso, setOcrProgreso] = useState(0);
  const [ocrError, setOcrError] = useState<string | null>(null);
  // ---- Capa OCR EDITABLE (mapear estructura): modo mapeo con resaltados clicables,
  // menú contextual por línea, lista buscable y sugerencias de ancla. ----
  const [mapearOcr, setMapearOcr] = useState(false);
  const [ocrMenu, setOcrMenu] = useState<{ idx: number; leftPct: number; topPct: number } | null>(null);
  const [ocrDestacada, setOcrDestacada] = useState<number | null>(null);
  const [busquedaOcr, setBusquedaOcr] = useState('');
  // Líneas eliminadas de la capa OCR (ruido: mal ubicadas o sin texto), por clave
  // imagen@página: cambiar de página/referencia arranca con la capa limpia y
  // re-ejecutar OCR resetea (los índices apuntaban al resultado anterior).
  const [ocrExcluidas, setOcrExcluidas] = useState<{ key: string; set: Set<number> } | null>(null);
  // ---- Detectar tabla (generador de campos desde la capa OCR) ----
  // modoTabla: el usuario arrastra un rect sobre el lienzo; detectarTabla()
  // agrupa líneas en renglones e infiere columnas; el diálogo muestra la
  // grilla con textos EDITABLES (por si el OCR se equivocó) y genera un
  // campo por celda — campos normales, 100% editables después.
  const [modoTabla, setModoTabla] = useState(false);
  const [arrastreTabla, setArrastreTabla] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [tablaDetectada, setTablaDetectada] = useState<TablaDetectada | null>(null);
  const [tablaDialog, setTablaDialog] = useState<{ textos: string[][]; filasOn: boolean[]; colsOn: boolean[] } | null>(null);
  const [tablaOpts, setTablaOpts] = useState<{
    encabezado: boolean;
    anclar: boolean;
    tipoCelda: TipoCampo;
    digitos: boolean;
    prefijo: string;
  }>({ encabezado: true, anclar: true, tipoCelda: 'texto', digitos: true, prefijo: 'Tabla' });
  const [pestanaDerecha, setPestanaDerecha] = useState<'propiedades' | 'diag' | 'ocr' | 'layout' | 'json'>('propiedades');
  const [ocultos, setOcultos] = useState<Set<string>>(new Set());
  const [coordenadas, setCoordenadas] = useState<{ x: number; y: number } | null>(null);
  const [cropPreview, setCropPreview] = useState<string | null>(null);
  const [cropDims, setCropDims] = useState<{ w: number; h: number } | null>(null);
  // ---- FASE 2 (v3.2.0 — faro): previsualización en vivo del rect relacional ----
  // Corre resolverRectRelacional (LA MISMA función del motor) contra la capa
  // OCR de la página de referencia y pinta el rect resuelto en el lienzo.
  const [pruebaRelacional, setPruebaRelacional] = useState<{
    rect: RectNorm;
    fuente: string;
    banderas: string[];
    score?: number;
  } | null>(null);
  const contenedorRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ campoId: string; modo: 'mover' | 'redimensionar'; x0: number; y0: number; zona0: RectNorm } | null>(null);
  const inputImagenRef = useRef<HTMLInputElement>(null);

  const moldeDB = moldes.find((m) => m.id === moldeId);
  const sucio = useMemo(
    () => Boolean(molde && moldeDB && JSON.stringify(molde) !== moldeDB.json),
    [molde, moldeDB],
  );

  /** Páginas navegables del molde: donde hay campos, donde hay escaneo de
      referencia (aunque aún no tenga campos) y la página actual. */
  const paginas = useMemo(() => {
    if (!molde) return [1];
    const set = new Set(molde.campos.map((c) => c.pagina));
    for (const p of molde.paginasRef ?? []) set.add(p.pagina);
    set.add(pagina);
    return [...set].sort((a, b) => a - b);
  }, [molde, pagina]);

  const imagenRef = molde?.paginasRef?.find((p) => p.pagina === pagina)?.imagen ?? null;
  // URL lista para <img> (resuelve claves idb: a object URLs en modo estático).
  const imagenRefVisual = useUrlResuelta(imagenRef);
  const campoSel = molde?.campos.find((c) => c.id === campoSeleccionadoId) ?? null;

  const camposPagina = useMemo(() => {
    if (!molde) return [];
    return molde.campos
      .filter((c) => c.pagina === pagina)
      .filter((c) => filtroTipo === 'todos' || c.tipo === filtroTipo)
      .filter(
        (c) =>
          !busqueda.trim() ||
          c.etiqueta.toLowerCase().includes(busqueda.toLowerCase()) ||
          (c.ancla?.texto ?? '').toLowerCase().includes(busqueda.toLowerCase()) ||
          c.id.toLowerCase().includes(busqueda.toLowerCase()),
      );
  }, [molde, pagina, busqueda, filtroTipo]);

  const grupos = useMemo(() => {
    return TIPOS.map((t) => ({
      ...t,
      items: camposPagina.filter((c) => c.tipo === t.id),
    })).filter((g) => g.items.length > 0);
  }, [camposPagina]);

  // ---- Recorte 300 DPI del campo activo ----
  // FIX: para campos `ancla_relativa`, zona.x/y es un OFFSET desde el ancla (no
  // coordenada absoluta de página). Hay que resolver el rect final igual que lo
  // hace el lienzo (rectEditor): ancla.rect + offset (o x_absoluto). Antes se
  // usaba `zona` en crudo, por lo que el recorte del panel derecho salía
  // desplazado (apuntaba a otra región de la página) para TODOS los campos con
  // ancla — el bug reportado de "el recorte no muestra el recorte correctamente".
  // FIX 2: el campo activo puede pertenecer a OTRA página (se seleccionó en la
  // pág. 1 y se cambió a la 2). Recortar la imagen visible con coordenadas de
  // otra página producía un recorte sin sentido (área vacía equivocada). Ahora
  // solo se recorta si campoSel.pagina === pagina; si no, se limpia y la UI
  // avisa en lugar de mostrar un recorte engañoso.
  const recortarPreview = useCallback(async () => {
    // F5.3: primera espera para que ningún setState corra síncronamente dentro
    // del efecto que invoca esta función (react-hooks/set-state-in-effect).
    await Promise.resolve();
    if (!campoSel || !imagenRef || !campoSel.zona || campoSel.pagina !== pagina) {
      setCropPreview(null);
      setCropDims(null);
      return;
    }
    const rect = rectEditor(campoSel);
    if (!rect) {
      setCropPreview(null);
      setCropDims(null);
      return;
    }
    try {
      const base = await canvasDe(imagenRef);
      // Recorte acotado a los límites del canvas de referencia.
      const x0 = Math.max(0, Math.min(rect.x, 1)) * base.width;
      const y0 = Math.max(0, Math.min(rect.y, 1)) * base.height;
      const x1 = Math.max(0, Math.min(rect.x + rect.w, 1)) * base.width;
      const y1 = Math.max(0, Math.min(rect.y + rect.h, 1)) * base.height;
      const sx = x0;
      const sy = y0;
      const sw = Math.max(2, x1 - x0);
      const sh = Math.max(2, y1 - y0);
      if (sw < 2 || sh < 2) {
        setCropPreview(null);
        setCropDims(null);
        return;
      }
      const escala = Math.min(3, Math.max(1, 300 / (base.width / 8.5))); // aprox 300 DPI de referencia
      const c = document.createElement('canvas');
      c.width = Math.round(sw * escala);
      c.height = Math.round(sh * escala);
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(base, sx, sy, sw, sh, 0, 0, c.width, c.height);
      setCropPreview(c.toDataURL('image/png'));
      // FIX: dimensiones REALES del recorte generado (antes se mostraba un
      // cálculo fijo sobre 2480x3508 que no coincidía con el recorte real).
      setCropDims({ w: c.width, h: c.height });
    } catch {
      setCropPreview(null);
      setCropDims(null);
    }
  }, [campoSel, imagenRef, pagina]);

  useEffect(() => {
    // F5.3: el recorte se calcula en callback (patrón .then aceptado por
    // react-hooks/set-state-in-effect).
    void Promise.resolve().then(recortarPreview);
  }, [recortarPreview]);

  // FASE 2 (v3.2.0 — faro): la previsualización del rect relacional caduca al
  // cambiar de campo (el rect de OTRO campo pintado en el lienzo sería un
  // engaño). Antes del early return: reglas de hooks (orden fijo).
  useEffect(() => {
    void Promise.resolve().then(() => setPruebaRelacional(null));
  }, [campoSeleccionadoId]);

  // FIX: el pointerup puede ocurrir FUERA del viewport (soltar el mouse sobre
  // otro panel, dedo que sale del área táctil, pointercancel del sistema) y
  // entonces el drag queda "pegado": el siguiente movimiento del mouse seguía
  // arrastrando la zona sin querer. Un listener global limpia el estado del
  // arrastre en cuanto el pointer termina o se cancela. (Antes del early
  // return de "sin molde": los hooks deben correr en todo render.)
  useEffect(() => {
    const limpiar = () => {
      dragState.current = null;
    };
    window.addEventListener('pointerup', limpiar);
    window.addEventListener('pointercancel', limpiar);
    window.addEventListener('blur', limpiar);
    return () => {
      window.removeEventListener('pointerup', limpiar);
      window.removeEventListener('pointercancel', limpiar);
      window.removeEventListener('blur', limpiar);
    };
  }, []);

  // ---- P2: handlers estables + actualizaciones no urgentes ----
  // El componente suscribe el store completo; con estos handlers estables las
  // zonas memoizadas solo se re-renderizan cuando CAMBIA su parte.
  const moldeRef = useRef(molde);
  // Sincronización en commit (no en render: react-hooks/refs). Los handlers
  // de drag solo leen la ref tras el commit → siempre ven el molde vigente.
  useEffect(() => {
    moldeRef.current = molde;
  });

  // P2: la selección es una actualización NO urgente — el pointerdown no debe
  // bloquearse re-renderizando el árbol completo (INP de 640 ms medido).
  const seleccionarCampo = useCallback(
    (id: string | null) => {
      startTransition(() => setCampoSeleccionado(id));
    },
    [setCampoSeleccionado],
  );

  // P2: handler de arrastre estable (identidad fija para las zonas memoizadas).
  // El campo se resuelve vía ref para no depender de la identidad de `molde`.
  const onArrastreZona = useCallback(
    (e: React.PointerEvent, campoId: string, modo: 'mover' | 'redimensionar') => {
      e.stopPropagation();
      const campo = moldeRef.current?.campos.find((c) => c.id === campoId);
      if (!campo) return;
      dragState.current = { campoId, modo, x0: e.clientX, y0: e.clientY, zona0: { ...campo.zona } };
      seleccionarCampo(campoId);
      // FIX: setPointerCapture lanza NotFoundError si el pointer ya no está
      // activo (eventos sintéticos, dedo levantado en táctil antes del capture,
      // o el nodo re-renderizado entre el down y el capture). Sin captura el
      // arrastre igual funciona dentro del viewport, así que solo se ignora.
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* sin captura: el drag continúa vía los handlers del viewport */
      }
    },
    [seleccionarCampo],
  );

  // P2: rects resueltos UNA vez por render (antes rectEditor se llamaba 2-3
  // veces por campo por render y creaba objetos nuevos que impedían memoizar).
  const rectsPorId = useMemo(() => {
    const map = new Map<string, RectNorm>();
    if (!molde) return map;
    for (const c of molde.campos) {
      if (c.pagina !== pagina) continue;
      const r = rectEditor(c);
      if (r) map.set(c.id, r);
    }
    return map;
  }, [molde, pagina]);

  // P2: el zoom dispara re-layout del lienzo — transición no urgente.
  const cambiarZoom = useCallback((v: number | ((z: number) => number)) => {
    startTransition(() => setZoom(v));
  }, []);

  // P2: mousemove alimentaba la barra de estado con un setState por evento
  // (re-render completo por cada píxel). Ahora: 1 actualización por frame
  // (rAF) y como transición no urgente.
  const coordsRafRef = useRef<number | null>(null);
  const onPointerMoveCoords = useCallback((e: React.MouseEvent) => {
    const clientX = e.clientX;
    const clientY = e.clientY;
    if (coordsRafRef.current !== null) return;
    coordsRafRef.current = requestAnimationFrame(() => {
      coordsRafRef.current = null;
      const cont = contenedorRef.current;
      if (!cont) return;
      const r = cont.getBoundingClientRect();
      const x = CLAMP((clientX - r.left) / r.width);
      const y = CLAMP((clientY - r.top) / r.height);
      startTransition(() => setCoordenadas({ x, y }));
    });
  }, []);

  useEffect(() => {
    return () => {
      if (coordsRafRef.current !== null) cancelAnimationFrame(coordsRafRef.current);
    };
  }, []);

  // ---- Capa OCR: OCR de página completa + overlay de líneas/palabras ----
  // Misma fuente de verdad que el motor: ocrLines sobre el canvas de 1000 px
  // (canvasDe ya aplica escalarCanvas), así que el resaltado del overlay coincide
  // EXACTAMENTE con lo que verá la verificación. Cacheada por clave
  // imagen@página: alternar el toggle o cambiar de página no re-ejecuta OCR
  // salvo que la referencia de esa página cambie (las URLs /uploads son UUID
  // únicos e inmutables — misma garantía que canvasCache).
  const ocrCapaKey = imagenRef ? `${imagenRef}@p${pagina}` : null;
  const ejecutarOcrCapa = useCallback(async () => {
    if (!imagenRef || !moldeId) return;
    setOcrEstado('cargando');
    setOcrProgreso(0);
    setOcrError(null);
    setOcrProgress((m) => {
      if (m.status === 'recognizing text') setOcrProgreso(Math.min(99, Math.round(m.progress * 100)));
    });
    const t0 = performance.now();
    try {
      const canvas = await canvasDe(imagenRef);
      const { lines, conf } = await ocrLines(canvas);
      setOcrCapa({
        key: `${imagenRef}@p${pagina}`,
        lines,
        dims: { w: canvas.width, h: canvas.height },
        conf,
        ms: Math.round(performance.now() - t0),
      });
      // Nueva lectura → índices nuevos: las líneas eliminadas se resetean.
      setOcrExcluidas(null);
      setOcrEstado('listo');
      setOcrProgreso(100);
      toast({
        title: `Capa OCR: ${lines.length} línea${lines.length === 1 ? '' : 's'} reconocidas`,
        description:
          conf !== null
            ? `Confianza media ${(conf * 100).toFixed(0)}% · ${Math.round(performance.now() - t0)} ms. El resaltado es lo que el OCR ve en esta página. Clic en modo Mapear para elegir qué hacer.`
            : `Confianza no reportada por el core · ${Math.round(performance.now() - t0)} ms.`,
      });
    } catch (e) {
      setOcrEstado('error');
      setOcrError((e as Error).message);
      toast({
        title: 'La capa OCR falló',
        description: (e as Error).message,
        variant: 'destructive',
      });
    } finally {
      setOcrProgress(null);
    }
  }, [imagenRef, pagina, moldeId, toast]);

  // Guarda de re-ejecución vía ref: solo corre el OCR cuando la clave
  // imagen@página NO tiene resultado cacheado (activar toggle, cambiar de
  // página o reemplazar la referencia dispara una clave nueva). El sync de la
  // ref va en SU propio efecto para que corra antes del trigger en cada commit.
  const ocrCapaKeyHecha = useRef<string | null>(null);
  useEffect(() => {
    ocrCapaKeyHecha.current = ocrCapa?.key ?? null;
  });

  // Al activar el toggle (o cambiar página/referencia con la capa activa) se
  // ejecuta el OCR si no hay resultado cacheado para esa clave. Patrón .then
  // (F5.3): nunca setState síncrono dentro del efecto.
  useEffect(() => {
    if (!verOcr || !ocrCapaKey) return;
    if (ocrCapaKeyHecha.current === ocrCapaKey) return;
    void Promise.resolve().then(ejecutarOcrCapa);
  }, [verOcr, ocrCapaKey, ejecutarOcrCapa]);

  // Capa OCR vigente para la página/referencia actual. NO depende del toggle
  // del overlay: el tab «OCR» y las sugerencias de ancla usan el caché aunque
  // las líneas estén ocultas en el lienzo.
  const ocrCapaVigente = ocrCapa && ocrCapa.key === ocrCapaKey ? ocrCapa : null;

  // Índices eliminados de la capa VIGENTE (sobre ocrCapa.lines). Si la clave no
  // coincide (otra página/referencia), la capa arranca sin eliminadas.
  const ocrExcluidasVigentes: ReadonlySet<number> =
    ocrExcluidas && ocrCapaKey !== null && ocrExcluidas.key === ocrCapaKey ? ocrExcluidas.set : SIN_ELIMINADAS;
  // Líneas sin texto reconocido aún NO eliminadas — alimenta la acción «Quitar vacías».
  const nVaciasPendientes = useMemo(() => {
    if (!ocrCapaVigente) return 0;
    return ocrCapaVigente.lines.reduce(
      (n, l, i) => (l.texto.trim() === '' && !ocrExcluidasVigentes.has(i) ? n + 1 : n),
      0,
    );
  }, [ocrCapaVigente, ocrExcluidasVigentes]);

  // Escape cierra el menú contextual de mapeo y cancela el modo tabla.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOcrMenu(null);
      if (modoTabla) {
        setModoTabla(false);
        setArrastreTabla(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modoTabla]);

  // Líneas OCR filtradas para el tab «OCR» (búsqueda normalizada, incluye palabras).
  const lineasOcrFiltradas = useMemo(() => {
    if (!ocrCapaVigente) return [];
    const q = normTxt(busquedaOcr);
    const todas = ocrCapaVigente.lines
      .map((l, i) => ({ l, i }))
      // Líneas eliminadas por el usuario: fuera del listado (recuperables).
      .filter(({ i }) => !ocrExcluidasVigentes.has(i));
    if (!q) return todas;
    return todas.filter(
      ({ l }) => normTxt(l.texto).includes(q) || l.palabras.some((w) => normTxt(w.texto).includes(q)),
    );
  }, [ocrCapaVigente, busquedaOcr, ocrExcluidasVigentes]);

  // Sugerencias de ancla para el campo activo (ancla_relativa / ancla_relacional):
  // top-3 líneas por similitud difusa con el texto del ancla — o por cercanía
  // espacial al rect esperado cuando el texto está vacío. Un clic fija texto + rect.
  // FASE 2: en relacional las sugerencias SOLO salen del FARO (lineasEnFaro,
  // la misma regla que corre el motor) — sugerir un ancla fuera del faro sería
  // sugerir una zona que el motor jamás buscará.
  const sugerenciasAncla = useMemo(() => {
    if (
      !campoSel ||
      (campoSel.estrategia !== 'ancla_relativa' && campoSel.estrategia !== 'ancla_relacional') ||
      !ocrCapaVigente
    ) {
      return [];
    }
    const dims = ocrCapaVigente.dims;
    const objetivo = normTxt(campoSel.ancla?.texto ?? '');
    const objetivoOrden = normTxt(
      objetivo.split(' ').sort((a, b) => a.localeCompare(b)).join(' '),
    );
    const base = campoSel.ancla?.rect ?? rectEditor(campoSel);
    const centro = base ? { x: base.x + base.w / 2, y: base.y + base.h / 2 } : null;
    // Las líneas eliminadas (ruido) nunca se sugieren como ancla.
    const todas = ocrCapaVigente.lines
      .map((l, i) => ({ l, i }))
      .filter(({ i }) => !ocrExcluidasVigentes.has(i));
    // FASE 2: el faro acota las sugerencias al contexto declarado.
    const candidatas =
      campoSel.estrategia === 'ancla_relacional' && campoSel.zona_busqueda
        ? (() => {
            const enFaro = new Set(
              lineasEnFaro(todas.map(({ l }) => l), dims.w, dims.h, campoSel.zona_busqueda!),
            );
            return todas.filter(({ l }) => enFaro.has(l));
          })()
        : todas;
    const puntuadas = candidatas.map(({ l, i }) => {
      const t = normTxt(l.texto);
      let score: number;
      if (objetivo && t) {
        const d1 = editDistancePonderada(objetivo, t);
        const tOrden = normTxt(t.split(' ').sort((a, b) => a.localeCompare(b)).join(' '));
        const d2 = editDistancePonderada(objetivoOrden, tOrden);
        score = 1 - Math.min(d1, d2) / Math.max(objetivo.length, t.length, 1);
      } else if (centro) {
        const cx = (l.bbox[0] + l.bbox[2]) / 2 / dims.w;
        const cy = (l.bbox[1] + l.bbox[3]) / 2 / dims.h;
        score = Math.max(0, 1 - Math.hypot(cx - centro.x, cy - centro.y));
      } else {
        score = 0;
      }
      return { l, i, score };
    });
    const corte = objetivo ? 0.3 : 0.55;
    return puntuadas.filter((s) => s.score >= corte).sort((a, b) => b.score - a.score).slice(0, 3);
  }, [campoSel, ocrCapaVigente, ocrExcluidasVigentes]);

  // ---- Diagnóstico de robustez (auditoría contra el OCR de la página) ----
  // Corre la MISMA lógica del motor (buscarAncla/resolverRectCampo) y SIMULA
  // fallos de campo: ¿qué fuente usa cada campo si mañana el OCR NO lee la
  // ancla? ¿Y si tampoco lee el respaldo? La capa auditada es la vigente SIN
  // las líneas eliminadas (mismo criterio del tab OCR y del motor en corridas
  // con exclusión). Memoizada por capa/página/campos: no recomputa en cada render.
  const informeDiagnostico = useMemo<InformePagina | null>(() => {
    if (!molde || !ocrCapaVigente) return null;
    const camposPagina = molde.campos.filter((c) => c.pagina === pagina);
    if (camposPagina.length === 0) return null;
    const { lines, dims } = ocrCapaVigente;
    const vivas = lines.filter((_, i) => !ocrExcluidasVigentes.has(i));
    return auditarCamposPagina(camposPagina, vivas, dims.w, dims.h, pagina);
  }, [molde, ocrCapaVigente, ocrExcluidasVigentes, pagina]);

  if (!molde || !moldeId) {
    return (
      <div className="mx-auto w-full max-w-[1600px] px-4 py-4 sm:px-6">
        <Card className="rounded-xl">
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <SquareDashedMousePointer className="h-10 w-10 text-outline-dim" aria-hidden />
            <p className="font-medium">Sin molde abierto</p>
            <p className="max-w-md text-sm text-on-surface-variant">
              Ve a la Biblioteca y abre un molde en el Editor (botón &quot;Abrir en Editor Visual&quot; en la
              tarjeta).
            </p>
            <Button onClick={() => setPestana('moldes')} variant="outline" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" /> Volver a Biblioteca
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  function actualizarCampo(id: string, cambios: Partial<CampoUniversal>) {
    if (!molde) return;
    setMoldeActual({
      ...molde,
      campos: molde.campos.map((c) => (c.id === id ? { ...c, ...cambios } : c)),
    });
  }

  // Diagnóstico: fija la ancla de respaldo sugerida en UN campo.
  function fortalecerCampo(id: string, respaldo: string) {
    actualizarCampo(id, { ancla_respaldo: respaldo });
    toast({
      title: 'Ancla de respaldo agregada',
      description: `Respaldado con "${respaldo}". Si mañana el OCR no lee la ancla principal, el motor cae a esta línea en vez de degradar. Guarda el molde para persistir.`,
    });
  }

  // Diagnóstico: aplica TODAS las sugerencias de respaldo en una sola edición.
  function fortalecerTodo() {
    if (!molde || !informeDiagnostico) return;
    const sugeridas = informeDiagnostico.campos.filter((i) => i.respaldoSugerido && !i.tieneRespaldo);
    if (sugeridas.length === 0) return;
    const porId = new Map(
      sugeridas.map((i) => [i.id, i.respaldoSugerido ? i.respaldoSugerido.texto : ''] as const),
    );
    setMoldeActual({
      ...molde,
      campos: molde.campos.map((c) => {
        const t = porId.get(c.id);
        return t ? { ...c, ancla_respaldo: t } : c;
      }),
    });
    toast({
      title: `${sugeridas.length} campo${sugeridas.length === 1 ? '' : 's'} fortalecido${sugeridas.length === 1 ? '' : 's'}`,
      description:
        'Anclas de respaldo agregadas con la línea única y de alta confianza más cercana sobre cada ancla. Guarda el molde para persistir.',
    });
  }

  /** FASE 2 (v3.2.0): faro por defecto generoso alrededor de una posición —
   *  el FARO es la zona aproximada (el mapa), la finura va en `zona`. */
  function faroDesdeRect(r: RectNorm): RectNorm {
    const x = Math.max(0, Math.min(0.98, r.x - 0.06));
    const y = Math.max(0, Math.min(0.95, r.y - 0.05));
    return {
      x,
      y,
      w: Math.min(1 - x, Math.max(0.2, r.w + 0.12)),
      h: Math.min(1 - y, Math.max(0.08, r.h + 0.1)),
    };
  }

  function nuevoCampo(estrategia: EstrategiaCampo) {
    if (!molde) return;
    const c: CampoUniversal = {
      id: nuevoIdCampo(),
      etiqueta: `Nuevo campo ${molde.campos.length + 1}`,
      pagina,
      tipo: 'presencia',
      estrategia,
      zona:
        estrategia === 'zona_fija'
          ? { x: 0.35, y: 0.4, w: 0.25, h: 0.04 }
          : estrategia === 'ancla_relacional'
            ? { x: 0, y: -0.045, w: 0.2, h: 0.045 } // finura: banda ARRIBA de la etiqueta (caso firma)
            : { x: 0.1, y: 0.02, w: 0.2, h: 0.04 },
      ancla:
        estrategia === 'zona_fija'
          ? undefined
          : { texto: '' },
      // FASE 2: el relacional nace CON faro (sin faro el validador rechaza el
      // molde — no hay búsqueda global) y con relación de banda adyacente.
      ...(estrategia === 'ancla_relacional'
        ? {
            zona_busqueda: { x: 0.08, y: 0.72, w: 0.55, h: 0.14 },
            relacion: { direccion: 'arriba', que: 'zona', orden: 'mas_cercano' } as RelacionAncla,
          }
        : {}),
      umbral: 0.03,
      obligatorio: false,
    };
    setMoldeActual({ ...molde, campos: [...molde.campos, c] });
    setCampoSeleccionado(c.id);
  }

  function eliminarCampo(id: string) {
    if (!molde) return;
    setMoldeActual({ ...molde, campos: molde.campos.filter((c) => c.id !== id) });
    if (campoSeleccionadoId === id) setCampoSeleccionado(null);
  }

  // ---- FASE 2 (v3.2.0 — faro): previsualización en vivo del rect relacional ----
  // Corre resolverRectRelacional (LA MISMA función que ejecuta la corrida)
  // contra la capa OCR vigente de la página de referencia. Honestidad: muestra
  // fuente, score y banderas — un fallback o una ambigüedad se ven, no se ocultan.
  async function probarFaroRelacional() {
    if (!campoSel || campoSel.estrategia !== 'ancla_relacional') return;
    if (!ocrCapaVigente || !imagenRef) {
      toast({
        title: 'Falta la capa OCR de la página de referencia',
        description: 'Activa «Ver OCR» en la toolbar del lienzo y espera a que corra sobre el escaneo de referencia.',
        variant: 'destructive',
      });
      return;
    }
    try {
      const base = await canvasDe(imagenRef);
      const vivas = ocrCapaVigente.lines.filter((_, i) => !ocrExcluidasVigentes.has(i));
      const r = resolverRectRelacional(campoSel, vivas, base.width, base.height, base);
      if (!r) {
        setPruebaRelacional(null);
        toast({
          title: 'El faro no resolvió rect',
          description: 'Falta ancla.rect de referencia o zona_busqueda — sin faro no hay resolución.',
          variant: 'destructive',
        });
        return;
      }
      setPruebaRelacional({
        rect: r.rect,
        fuente: r.fuente,
        score: r.score,
        banderas: [...(r.banderasRelacionales ?? []), ...(r.ambiguo ? ['relacion_ambigua'] : [])],
      });
      const detalles = r.banderasRelacionales?.length ? ` · ${r.banderasRelacionales.join(', ')}` : '';
      toast({
        title: `Faro resuelto (fuente: ${r.fuente}${r.score !== undefined ? `, score ${Math.round(r.score * 100)}%` : ''})${detalles}`,
        description: `Rect final: x ${r.rect.x.toFixed(3)}, y ${r.rect.y.toFixed(3)}, w ${r.rect.w.toFixed(3)}, h ${r.rect.h.toFixed(3)}`,
      });
    } catch (e) {
      toast({ title: 'Error probando el faro', description: (e as Error).message, variant: 'destructive' });
    }
  }

  function duplicarCampo(id: string) {
    if (!molde) return;
    const c = molde.campos.find((x) => x.id === id);
    if (!c) return;
    const copia: CampoUniversal = { ...c, id: nuevoIdCampo(), etiqueta: `${c.etiqueta} (copia)` };
    setMoldeActual({ ...molde, campos: [...molde.campos, copia] });
    setCampoSeleccionado(copia.id);
  }

  // ---- Capa OCR editable (mapear estructura desde lo reconocido) ----
  function cerrarMenuOcr() {
    setOcrMenu(null);
  }

  /** Abre el menú de mapeo sobre el resaltado OCR idx (posición en % de la página). */
  function abrirMenuOcr(idx: number) {
    const capa = ocrCapaVigente;
    const l = capa?.lines[idx];
    if (!capa || !l) return;
    setOcrDestacada(idx);
    setOcrMenu({
      idx,
      leftPct: (l.bbox[0] / capa.dims.w) * 100,
      topPct: (l.bbox[1] / capa.dims.h) * 100,
    });
  }

  /** Crea un campo desde una caja OCR: zona fija (rect de la caja) o anclada (ancla = la línea). */
  function crearCampoDesdeOcr(l: LineaOcr, modo: 'fija' | 'anclada') {
    if (!molde || !ocrCapaVigente) return;
    const rect = rectDeLineaOcr(l, ocrCapaVigente.dims);
    const etiqueta = l.texto.trim().slice(0, ETIQUETA_OCR_MAX) || `Campo OCR ${molde.campos.length + 1}`;
    const c: CampoUniversal = {
      id: nuevoIdCampo(),
      etiqueta,
      pagina,
      tipo: 'presencia',
      estrategia: modo === 'fija' ? 'zona_fija' : 'ancla_relativa',
      zona: modo === 'fija' ? rect : { x: 0.008, y: rect.h + 0.004, w: rect.w, h: rect.h },
      ancla: modo === 'anclada' ? { texto: l.texto, rect } : undefined,
      umbral: 0.03,
      obligatorio: false,
      nota: 'Creado desde la capa OCR — ajusta tipo, tamaño y estrategia.',
    };
    setMoldeActual({ ...molde, campos: [...molde.campos, c] });
    setCampoSeleccionado(c.id);
    setPestanaDerecha('propiedades');
    cerrarMenuOcr();
    toast({
      title: modo === 'fija' ? 'Campo creado sobre la línea OCR' : 'Campo anclado a la línea OCR',
      description:
        modo === 'fija'
          ? 'Zona fija = rect de la línea reconocida. Ajusta tipo y tamaño en Propiedades.'
          : `Ancla «${l.texto.slice(0, 32)}» + offset bajo la línea. Revisa el enlace ancla→zona.`,
    });
  }

  /** Usa la línea OCR como ancla del campo activo (lo convierte si era zona_fija). */
  function usarLineaComoAncla(l: LineaOcr) {
    if (!molde || !ocrCapaVigente) return;
    if (!campoSel) {
      toast({
        title: 'Sin campo activo',
        description: 'Selecciona primero el campo al que quieres asignar esta ancla.',
        variant: 'destructive',
      });
      return;
    }
    if (campoSel.pagina !== pagina) {
      toast({
        title: 'El campo activo es de otra página',
        description: `La ancla pertenece a la página ${pagina}; el campo ${campoSel.etiqueta} a la ${campoSel.pagina}.`,
        variant: 'destructive',
      });
      return;
    }
    const rect = rectDeLineaOcr(l, ocrCapaVigente.dims);
    if (campoSel.estrategia === 'zona_fija') {
      // Conversión preservando la posición visual: offset = zona actual − rect del ancla.
      actualizarCampo(campoSel.id, {
        estrategia: 'ancla_relativa',
        ancla: { texto: l.texto, rect },
        zona: {
          x: campoSel.zona.x - rect.x,
          y: campoSel.zona.y - rect.y,
          w: campoSel.zona.w,
          h: campoSel.zona.h,
        },
      });
    } else {
      actualizarCampo(campoSel.id, { ancla: { texto: l.texto, rect } });
    }
    setPestanaDerecha('propiedades');
    cerrarMenuOcr();
    toast({
      title: 'Ancla aplicada desde la capa OCR',
      description: `«${l.texto.slice(0, 40)}» es ahora el ancla de ${campoSel.etiqueta}.`,
    });
  }

  /** Ajusta (snap) la zona del campo activo al rect de la línea OCR. */
  function ajustarZonaActivaAOcr(l: LineaOcr) {
    if (!molde || !ocrCapaVigente) return;
    if (!campoSel) {
      toast({
        title: 'Sin campo activo',
        description: 'Selecciona el campo cuya zona quieres ajustar a esta línea.',
        variant: 'destructive',
      });
      return;
    }
    if (campoSel.pagina !== pagina) {
      toast({
        title: 'El campo activo es de otra página',
        description: `Cambia a la página ${campoSel.pagina} para ajustar su zona.`,
        variant: 'destructive',
      });
      return;
    }
    const rect = rectDeLineaOcr(l, ocrCapaVigente.dims);
    if (campoSel.estrategia === 'zona_fija') {
      actualizarCampo(campoSel.id, { zona: rect });
    } else {
      const ax = campoSel.ancla?.rect?.x ?? 0;
      const ay = campoSel.ancla?.rect?.y ?? 0;
      actualizarCampo(campoSel.id, {
        zona: {
          x: campoSel.x_absoluto ? rect.x : rect.x - ax,
          y: rect.y - ay,
          w: rect.w,
          h: rect.h,
        },
      });
    }
    cerrarMenuOcr();
    toast({
      title: 'Zona ajustada a la línea OCR',
      description: `La zona de ${campoSel.etiqueta} coincide ahora con el rect reconocido.`,
    });
  }

  /** Aplica una sugerencia difusa como ancla del campo activo (texto + rect). */
  function aplicarSugerenciaAncla(s: { l: LineaOcr }) {
    if (!campoSel || !ocrCapaVigente) return;
    const rect = rectDeLineaOcr(s.l, ocrCapaVigente.dims);
    actualizarCampo(campoSel.id, { ancla: { texto: s.l.texto, rect } });
    toast({
      title: 'Ancla corregida desde la capa OCR',
      description: `«${s.l.texto.slice(0, 40)}» con el rect de la línea reconocida.`,
    });
  }

  // ---- Eliminar líneas de la capa OCR (ruido: mal ubicadas o sin texto) ----
  /** Quita una línea de la capa OCR vigente; recuperable desde el tab OCR. */
  function eliminarLineaOcr(idx: number) {
    if (!ocrCapaKey) return;
    setOcrExcluidas((prev) => {
      const base = prev && prev.key === ocrCapaKey ? prev.set : new Set<number>();
      const next = new Set(base);
      next.add(idx);
      return { key: ocrCapaKey, set: next };
    });
    if (ocrMenu?.idx === idx) setOcrMenu(null);
    if (ocrDestacada === idx) setOcrDestacada(null);
    toast({
      title: 'Línea OCR eliminada de la capa',
      description: 'Ya no se resalta ni entra en las sugerencias de ancla. Restáurala con el botón «Restaurar» del tab OCR.',
    });
  }

  /** Restaura TODAS las líneas eliminadas de la capa vigente. */
  function restaurarLineasOcr() {
    setOcrExcluidas(null);
    toast({ title: 'Capa OCR restaurada', description: 'Las líneas eliminadas vuelven a resaltarse en el lienzo.' });
  }

  /** Elimina en bloque las líneas de la capa vigente sin texto reconocido. */
  function eliminarVaciasOcr() {
    if (!ocrCapaVigente || !ocrCapaKey) return;
    const next = new Set<number>(ocrExcluidasVigentes);
    ocrCapaVigente.lines.forEach((l, i) => {
      if (l.texto.trim() === '') next.add(i);
    });
    const n = next.size - ocrExcluidasVigentes.size;
    if (n === 0) {
      toast({ title: 'No quedan líneas vacías por eliminar' });
      return;
    }
    setOcrExcluidas({ key: ocrCapaKey, set: next });
    toast({
      title: `${n} línea${n === 1 ? '' : 's'} vacía${n === 1 ? '' : 's'} eliminada${n === 1 ? '' : 's'}`,
      description: 'Las líneas sin texto reconocido salieron de la capa. Recuperables con «Restaurar».',
    });
  }

  // ---- Detectar tabla: generador de campos por celda desde la capa OCR ----
  /** Activa/desactiva el modo arrastre de zona para detectar una tabla. */
  function alternarModoTabla() {
    setModoTabla((v) => !v);
    setArrastreTabla(null);
    setOcrMenu(null);
    setOcrDestacada(null);
  }

  /** Coordenada normalizada (0–1) del puntero respecto a la página en el lienzo. */
  function coordTabla(e: React.PointerEvent): { x: number; y: number } | null {
    const cont = contenedorRef.current;
    if (!cont) return null;
    const r = cont.getBoundingClientRect();
    return { x: CLAMP((e.clientX - r.left) / r.width), y: CLAMP((e.clientY - r.top) / r.height) };
  }

  function onPointerDownTabla(e: React.PointerEvent) {
    if (!modoTabla || !ocrCapaVigente) return;
    const p = coordTabla(e);
    if (!p) return;
    e.preventDefault();
    try {
      contenedorRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* el capture es best-effort; el arrastre funciona igual dentro del lienzo */
    }
    setArrastreTabla({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  }

  function onPointerMoveTabla(e: React.PointerEvent) {
    if (!arrastreTabla) return;
    const p = coordTabla(e);
    if (!p) return;
    setArrastreTabla((a) => (a ? { ...a, x1: p.x, y1: p.y } : a));
  }

  async function onPointerUpTabla() {
    if (!arrastreTabla || !ocrCapaVigente) return;
    const { x0, y0, x1, y1 } = arrastreTabla;
    setArrastreTabla(null);
    const zona = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
    if (zona.w < 0.02 || zona.h < 0.02) return;
    // FASE A1 (blueprint DLA): vía IMAGEN primero (port SPARTAN — retícula
    // desde reglas impresas con las aperturas H/V del motor); las columnas
    // OMR vacías ahora se detectan. Sin señal de bordes, cae a la vía por
    // palabras OCR (columnasPorOcupacion/Voto), intacta. El canvas llega del
    // caché de referencias (mismo canvas de 1000 px que usa la capa OCR).
    const canvasZona = imagenRef ? await canvasDe(imagenRef).catch(() => undefined) : undefined;
    const t = detectarTablaCompleta(
      ocrCapaVigente.lines,
      zona,
      ocrCapaVigente.dims,
      canvasZona,
    );
    if (!t || t.filas.length < 1) {
      toast({
        title: 'No se detectó una tabla',
        description: 'Arrastra una zona que contenga al menos 2 renglones de texto reconocido (Capa OCR activa).',
        variant: 'destructive',
      });
      return;
    }
    const primera = t.filas[0].filter((c) => c.texto.trim() !== '').length;
    setTablaDetectada(t);
    setTablaOpts((o) => ({ ...o, encabezado: primera >= 2 }));
    setTablaDialog({
      textos: t.filas.map((f) => f.map((c) => c.texto)),
      filasOn: t.filas.map(() => true),
      colsOn: t.filas[0].map(() => true),
    });
  }

  /** Genera un campo por celda activa de la tabla detectada (anclados a su
      etiqueta de fila cuando es posible). Campos normales y editables. */
  function generarCamposTabla() {
    if (!tablaDetectada || !tablaDialog || !molde) return;
    const { textos, filasOn, colsOn } = tablaDialog;
    const { filas } = tablaDetectada;
    const headerTexts = tablaOpts.encabezado ? (textos[0] ?? []) : [];
    const nuevos: CampoUniversal[] = [];
    for (let f = 0; f < filas.length; f++) {
      if (!filasOn[f]) continue;
      if (tablaOpts.encabezado && f === 0) continue; // fila de encabezado: solo etiquetas
      const fila = filas[f];
      // Celdas activas del renglón (texto vacío no genera campo de tipo texto).
      const activas: number[] = [];
      for (let c = 0; c < fila.length; c++) {
        if (!colsOn[c]) continue;
        if (tablaOpts.tipoCelda === 'texto' && (textos[f][c] ?? '').trim() === '') continue;
        activas.push(c);
      }
      if (activas.length === 0) continue;
      // Ancla de la fila: primera celda activa con texto (preferencia columna 0).
      let cAncla = -1;
      for (const c of activas) {
        if ((textos[f][c] ?? '').trim() !== '') {
          cAncla = c;
          break;
        }
      }
      // El ancla solo tiene sentido si quedan MÁS celdas además de ella; si la
      // fila tiene una única celda activa (lista de renglones), se genera como
      // zona fija y el ancla no aplica.
      const usarAncla = tablaOpts.anclar && cAncla >= 0 && activas.length > 1;
      const anclaTexto = usarAncla && cAncla >= 0 ? textos[f][cAncla].trim() : '';
      const anclaRect = usarAncla && cAncla >= 0 ? fila[cAncla].rect : undefined;
      const etiquetaFila = anclaTexto || `fila ${f + 1}`;
      for (const c of activas) {
        if (usarAncla && c === cAncla) continue; // la celda del ancla es la etiqueta, no genera campo
        const cel = fila[c];
        const texto = (textos[f][c] ?? '').trim();
        const esTexto = tablaOpts.tipoCelda === 'texto';
        const anclada = usarAncla && Boolean(anclaTexto && anclaRect);
        const header = (headerTexts[c] ?? '').trim().slice(0, 18);
        const etiqueta = [header, etiquetaFila].filter(Boolean).join(' · ') || `${tablaOpts.prefijo} ${f + 1}-${c + 1}`;
        nuevos.push({
          id: nuevoIdCampo(),
          etiqueta: etiqueta.slice(0, ETIQUETA_OCR_MAX),
          pagina,
          tipo: tablaOpts.tipoCelda,
          estrategia: anclada ? 'ancla_relativa' : 'zona_fija',
          zona: anclada
            ? { x: cel.rect.x, y: cel.rect.y - anclaRect!.y, w: cel.rect.w, h: cel.rect.h }
            : cel.rect,
          ...(anclada ? { ancla: { texto: anclaTexto, rect: anclaRect! }, x_absoluto: true } : {}),
          umbral: 0.03,
          obligatorio: false,
          ...(esTexto && tablaOpts.digitos ? { whitelist: '0123456789', patron: '\\d+', realce: true } : {}),
          nota: 'Celda generada por «Detectar tabla» — ajusta tipo, tamaño o ancla si hace falta.',
        });
      }
    }
    if (nuevos.length === 0) {
      toast({ title: 'Nada por generar', description: 'Todas las celdas activas están vacías o excluidas.', variant: 'destructive' });
      return;
    }
    setMoldeActual({ ...molde, campos: [...molde.campos, ...nuevos] });
    setTablaDialog(null);
    setTablaDetectada(null);
    setModoTabla(false);
    toast({
      title: `${nuevos.length} campos de tabla generados`,
      description: 'Son campos normales: se leen en Verificación igual que el resto, y puedes moverlos, redimensionarlos o eliminarlos.',
    });
  }

  function alternarOculto(id: string) {
    setOcultos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ---- arrastre de zonas (movimiento: se mantiene urgente para feedback
  // visual inmediato; el inicio del drag y la selección viven arriba como
  // handlers estables para las zonas memoizadas) ----
  function onPointerMoveZona(e: React.PointerEvent) {
    const d = dragState.current;
    const cont = contenedorRef.current;
    if (!d || !cont || !molde) return;
    const r = cont.getBoundingClientRect();
    const dxN = (e.clientX - d.x0) / r.width;
    const dyN = (e.clientY - d.y0) / r.height;
    const campos = molde.campos.map((c) => {
      if (c.id !== d.campoId) return c;
      if (d.modo === 'mover') {
        return {
          ...c,
          zona: { ...c.zona, x: CLAMP(d.zona0.x + dxN, -0.2, 0.98), y: CLAMP(d.zona0.y + dyN, -0.2, 0.98) },
        };
      }
      return {
        ...c,
        zona: { ...c.zona, w: Math.max(0.008, d.zona0.w + dxN), h: Math.max(0.004, d.zona0.h + dyN) },
      };
    });
    setMoldeActual({ ...molde, campos });
  }

  function onPointerUpZona() {
    dragState.current = null;
  }

  // ---- referencia de imagen ----
  /** Sube el escaneo de referencia de la página actual. Si el archivo es un
      PDF multipágina, importa TODAS sus páginas de una sola vez: la página 1
      del PDF cae en la página actual del molde y las siguientes se encadenan
      a continuación (cada una con su escaneo listo para su capa OCR). */
  async function subirImagen(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f || !molde) return;
    // Fase 3.2 (G-12): aceptar también PDF como referencia — se rasteriza a
    // PNG antes de subirla, así el editor siempre trabaja con imagen.
    setSubiendo(true);
    try {
      if (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')) {
        const doc = await renderDocumento(f);
        if (doc.canvases.length === 0) throw new Error('El PDF no tiene páginas');
        const base = f.name.replace(/\.pdf$/i, '');
        const entradas: { pagina: number; imagen: string }[] = [];
        for (let i = 0; i < doc.canvases.length; i++) {
          const blob = await new Promise<Blob | null>((res) => doc.canvases[i].toBlob(res, 'image/png'));
          if (!blob) throw new Error(`No se pudo rasterizar la página ${i + 1} del PDF`);
          const archivo = new File([blob], `${base}-p${pagina + i}.png`, { type: 'image/png' });
          const subida = await repo.subirArchivo(archivo, archivo.name);
          if (!subida.ok) throw new Error(subida.error);
          entradas.push({ pagina: pagina + i, imagen: subida.data.url });
        }
        const desde = pagina;
        const hasta = pagina + doc.canvases.length - 1;
        const otras = (molde.paginasRef ?? []).filter((p) => p.pagina < desde || p.pagina > hasta);
        setMoldeActual({
          ...molde,
          paginasRef: [...otras, ...entradas].sort((a, b) => a.pagina - b.pagina),
        });
        toast({
          title:
            entradas.length > 1
              ? `PDF importado: ${entradas.length} páginas → molde ${desde}–${hasta}`
              : `Escaneo de referencia cargado (página ${pagina})`,
          description:
            entradas.length > 1
              ? 'Cada página del molde recibió su escaneo. Activa la Capa OCR página por página para mapearlas.'
              : undefined,
        });
      } else {
        if (f.type && !/^image\/(png|jpe?g|webp|heic|heif)$/.test(f.type)) {
          // Fase 3.2 (N-13): rechazo explícito, nunca silencioso.
          toast({ title: 'Formato no soportado', description: `${f.name} (${f.type}) — usa PNG, JPEG, WebP, HEIC o PDF.`, variant: 'destructive' });
          return;
        }
        const subida = await repo.subirArchivo(f, f.name);
        if (!subida.ok) {
          toast({ title: 'Error al subir imagen', description: subida.error, variant: 'destructive' });
          return;
        }
        const url = subida.data.url;
        const otras = (molde.paginasRef ?? []).filter((p) => p.pagina !== pagina);
        setMoldeActual({
          ...molde,
          paginasRef: [...otras, { pagina, imagen: url }].sort((a, b) => a.pagina - b.pagina),
        });
        toast({ title: `Escaneo de referencia cargado (página ${pagina})` });
      }
    } catch (err) {
      toast({ title: 'Error al procesar el archivo', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setSubiendo(false);
      if (inputImagenRef.current) inputImagenRef.current.value = '';
    }
  }

  // ---- alineación de anclas con OCR ----
  async function alinearOCR() {
    if (!molde || !imagenRef) {
      toast({ title: 'Falta la imagen de referencia', description: 'Sube el escaneo de esta página.', variant: 'destructive' });
      return;
    }
    setAlineando(true);
    try {
      const canvas = await canvasDe(imagenRef);
      const res = await alinearAnclas(molde, canvas, pagina);
      setMoldeActual(res.molde);
      const faltantes = Object.entries(res.detalles).filter(([, v]) => v === 'no').length;
      toast({
        title: `Anclas alineadas: ${res.encontradas}/${res.total}`,
        description: faltantes ? `${faltantes} ancla(s) no se encontraron por OCR — revisa su texto.` : 'Todas las anclas de la página fueron localizadas.',
      });
    } catch (e) {
      toast({ title: 'Error al alinear', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setAlineando(false);
    }
  }

  // ---- Fase 2.1 + Fase 8: sugerir umbral a partir de TODAS las corridas ----
  // Fase 8 (variante 4.2, solución de fondo del matiz residual de F4): reúne
  // los ratios del campo en TODAS las corridas del molde y separa ruido/tinta
  // por clustering (k-means k=2 en log10) en vez del corte fijo 0.002. Con
  // < 3 corridas el motor conserva el comportamiento anterior (primera
  // corrida que sugiere, mismas guardas F4/F4-1).
  // F4-1 (informe de verificación §6.1, mitigación c): cuando la guarda NO
  // sugiere, el toast explica POR QUÉ — nunca el mensaje genérico.
  async function sugerirUmbralClick() {
    if (!campoSel || !moldeId) return;
    const estado = useStudio.getState();
    const candidatas = estado.pruebas.filter((p) => p.moldeId === moldeId);
    if (!candidatas.length) {
      toast({
        title: 'Sin corridas para calibrar',
        description: 'Corre al menos una verificación con este molde y vuelve a intentarlo.',
        variant: 'destructive',
      });
      return;
    }
    const resultadosCorridas: ResultadoUniversal[] = [];
    for (const p of candidatas) {
      const r = await repo.obtenerPrueba(p.id);
      if (!r.ok || !r.data.resultados) continue;
      resultadosCorridas.push(r.data.resultados as ResultadoUniversal);
    }
    const s = sugerirUmbralClustering(resultadosCorridas, campoSel.id);
    if (s.sugerido !== null) {
      actualizarCampo(campoSel.id, { umbral: s.sugerido });
      const trazos = `trazo más fino: ${((s.minConTinta as number) * 100).toFixed(2)}%`;
      const ruido = s.maxSinTinta !== null ? ` · ruido máximo: ${((s.maxSinTinta as number) * 100).toFixed(2)}%` : '';
      toast({
        title: `Umbral sugerido: ${(s.sugerido * 100).toFixed(2)}%`,
        description:
          s.metodo === 'clustering'
            ? `${trazos}${ruido} · clasificación por clustering (k=2) sobre ${s.corridasConMediciones} corridas · criterio: trazo × 0.7.`
            : `${trazos}${ruido} · criterio: trazo × 0.7 · corridas con mediciones: ${s.corridasConMediciones} (con ${3 - s.corridasConMediciones} más se calibra por clustering).`,
      });
      return;
    }
    const medicion = (v: number | null | undefined) =>
      v === null || v === undefined ? '—' : `${(v * 100).toFixed(2)}%`;
    if (s.motivo === 'sin_celdas_vacias') {
      toast({
        title: 'No se puede verificar la separación contra el ruido',
        description: `El campo SÍ tiene mediciones con tinta (trazo más fino ${medicion(s.minConTinta)}) pero ninguna celda VACÍA medida en ${s.corridasConMediciones} corridas: sin el ruido real no se puede garantizar que el umbral quede por encima de él (guarda F4-1). Corre una verificación con la casilla vacía y vuelve a calibrar.`,
        variant: 'destructive',
      });
      return;
    }
    if (s.motivo === 'clases_entrelazadas') {
      toast({
        title: 'Ruido y tinta entrelazados: no se sugiere umbral',
        description: `La celda vacía más «sucia» (${medicion(s.maxSinTinta)}) NO queda por debajo de la mitad del trazo más fino (${medicion(s.minConTinta)}): un umbral aquí marcaría casillas vacías como firmadas (guarda F4).`,
        variant: 'destructive',
      });
      return;
    }
    if (s.motivo === 'sin_tinta') {
      toast({
        title: 'Ningún nivel de tinta demostrado en este campo',
        description:
          s.minConTinta !== null
            ? `Las ${s.corridasConMediciones} corridas con mediciones NO demuestran tinta real: el nivel más alto medido (${medicion(s.minConTinta)}) no supera el techo de ruido del corpus (2%). Calibra manualmente o con un corpus con trazos más marcados.`
            : `Las ${s.corridasConMediciones} corridas con mediciones midieron la zona a nivel de ruido (máximo ${medicion(s.maxSinTinta)}). Corre una verificación con la casilla diligenciada.`,
        variant: 'destructive',
      });
      return;
    }
    toast({
      title: 'Este campo no tiene mediciones',
      description: 'Ninguna corrida guardada midió tinta en esta zona. Corre una verificación primero.',
      variant: 'destructive',
    });
  }

  async function guardar() {
    // G-10: no se puede guardar un molde que el motor no pueda ejecutar
    // (ancla_relativa con ancla vacía o zonas inválidas).
    if (molde) {
      const problemas = erroresMolde(molde);
      if (problemas.length) {
        toast({
          title: 'El molde tiene problemas',
          description: problemas.slice(0, 3).join(' · ') + (problemas.length > 3 ? ` … (+${problemas.length - 3})` : ''),
          variant: 'destructive',
        });
        return;
      }
    }
    setGuardando(true);
    try {
      await guardarMoldeActual();
    } finally {
      setGuardando(false);
    }
  }

  function aplicarJson() {
    // G-9: validador REAL — antes un JSON sin `zona` pasaba el chequeo de
    // forma y reventaba el editor al renderizar (campoSel.zona[k], .umbral.toFixed).
    let obj: unknown;
    try {
      obj = JSON.parse(jsonAplicar);
    } catch (e) {
      toast({ title: 'JSON inválido', description: (e as Error).message, variant: 'destructive' });
      return;
    }
    if (!esMoldeUniversal(obj)) {
      const problemas = erroresMolde(obj).slice(0, 3).join(' · ');
      toast({
        title: 'Estructura de molde inválida',
        description: problemas || 'Se espera { tipo: "universal", nombre, campos[] }',
        variant: 'destructive',
      });
      return;
    }
    setMoldeActual(obj);
    setJsonAplicar('');
    toast({ title: 'JSON aplicado al editor', description: 'Recuerda guardar.' });
  }

  function descargarJson() {
    if (!molde) return;
    const blob = new Blob([JSON.stringify(molde, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${molde.nombre.replace(/\s+/g, '_')}.molde.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // F6 (PLAN-AGENTE-LAYOUT): exporte con SOBRE + checksum. Retrocompatible:
  // el botón de arriba sigue exportando el MOLDE PLANO; este produce
  // { tipo, version, nombre, checksum: <sha256 hex del cuerpo>, molde } —
  // Tamiz recalcula el SHA-256 del cuerpo al importar (importarMoldeDesdeTexto)
  // y rechaza si no coincide ("archivo corrompido o alterado").
  async function descargarJsonConChecksum() {
    if (!molde) return;
    try {
      // Fase 3 (migración): el sobre { tipo, version, nombre, checksum, molde }
      // se construye con el protocolo compartido (scanner-core/contract/sobre).
      const sobre = await crearSobreMolde(molde);
      if (!sobre) throw new Error('contexto sin crypto.subtle');
      const blob = new Blob([JSON.stringify(sobre, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${molde.nombre.replace(/\s+/g, '_')}.molde.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast({
        title: 'Descargado con checksum',
        description: 'Tamiz verificará el SHA-256 del molde al importarlo.',
      });
    } catch {
      toast({ title: 'No se pudo calcular el checksum', variant: 'destructive' });
    }
  }

  const jsonVivo = JSON.stringify(molde, null, 2);
  const campoSelOtraPagina = Boolean(campoSel && campoSel.pagina !== pagina);
  const dimsPx =
    campoSel && imagenRef && !campoSelOtraPagina
      ? cropDims
        ? `${cropDims.w} × ${cropDims.h} px · 300 DPI`
        : 'Sube un escaneo para ver el recorte'
      : 'Sube un escaneo para ver el recorte';

  return (
    <div className="flex flex-col bg-slate-950 text-slate-100">
      {/* ============ Sub-header del editor ============ */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-900 px-4 py-2 sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setPestana('moldes')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-300 transition hover:bg-slate-800"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Volver a Biblioteca
          </button>
          <span className="h-4 w-px bg-slate-700" aria-hidden />
          <div className="flex items-center gap-2">
            <span className="max-w-[420px] truncate text-sm font-bold text-white">{molde.nombre}</span>
            <span
              title={sucio ? 'Cambios sin guardar' : 'Todo guardado'}
              className={`h-2 w-2 rounded-full ${sucio ? 'animate-pulse bg-amber-500' : 'bg-emerald-500'}`}
              aria-hidden
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5 px-1 font-mono text-xs text-slate-400">
            <span
              className={`h-1.5 w-1.5 rounded-full ${sucio ? 'animate-pulse bg-amber-500' : 'bg-emerald-500'}`}
              aria-hidden
            />
            <span>{sucio ? 'Sin guardar' : 'Guardado'}</span>
          </div>
          <Button
            type="button"
            disabled={probando}
            onClick={async () => {
              // "Probar Plantilla" ahora RE-EJECUTA automáticamente: si hay
              // cambios sin guardar los guarda AHORA, toma la corrida más
              // reciente con archivo fuente persistido y le dispara una
              // re-ejecución en Verificación contra esta versión del molde —
              // sin pedir volver a subir ninguna foto/PDF.
              setProbando(true);
              try {
                // N2 (conversación de mejora): si el guardado implícito FALLA
                // (ahora valida con erroresMolde), no se prueba nada — correr
                // contra la versión vieja del molde sería engañoso.
                if (sucio) {
                  const guardado = await guardarMoldeActual();
                  if (!guardado) return;
                }
                await cargarPruebas();
                // D1: una corrida multi-página es re-ejecutable con el set
                // completo de páginas (fuente_urls), no solo con fuenteUrl.
                const reejecutable = useStudio
                  .getState()
                  .pruebas.find((p) => Boolean(p.fuenteUrl) || Boolean(p.fuente_urls && p.fuente_urls.length >= 2));
                setPruebaId(reejecutable?.id ?? null);
                setPestana('verificacion');
                if (reejecutable) {
                  solicitarReejecucion();
                } else {
                  // N1 (conversación de mejora): antes este caso era un no-op
                  // SILENTE — se navegaba a Verificación mostrando resultados
                  // viejos y el usuario creía haber probado sus cambios. Ahora
                  // se le dice exactamente qué falta para poder re-ejecutar.
                  toast({
                    title: 'No hay ninguna corrida con archivo fuente guardado',
                    description:
                      'Sube un documento en Verificación (botón +) al menos una vez: desde entonces "Probar Plantilla" re-ejecutará automáticamente esa corrida con los cambios del molde.',
                    variant: 'destructive',
                  });
                }
              } finally {
                setProbando(false);
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 shadow-2xs hover:bg-slate-700/80"
            variant="outline"
          >
            {probando ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Play className="h-4 w-4 text-indigo-400" aria-hidden />
            )}
            Probar Plantilla
          </Button>
          <Button
            type="button"
            onClick={guardar}
            disabled={guardando}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-medium text-white shadow-xs hover:bg-indigo-700"
          >
            {guardando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
            Guardar Plantilla
          </Button>
        </div>
      </div>

      {/* ============ Leyenda de colores ============ */}
      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 border-b border-slate-800 bg-slate-900/80 px-4 py-1.5 font-mono text-[11px] text-slate-300">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
          <span className="font-medium">Dato Variable</span>
          <span className="text-slate-500">(Presencia / Totales)</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-sky-500" aria-hidden />
          <span className="font-medium">Manuscrito</span>
          <span className="text-slate-500">(Texto OCR)</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-violet-500" aria-hidden />
          <span className="font-medium">Firma</span>
          <span className="text-slate-500">(Firmas y sellos)</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
          <span className="font-medium">Checkbox OMR</span>
        </span>
        <span className="hidden items-center gap-1.5 border-l border-slate-700 pl-4 text-amber-400 md:flex">
          <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500 ring-2 ring-amber-400/40" aria-hidden />
          <span>Punto Ancla OCR</span>
        </span>
        <span className="hidden items-center gap-1.5 text-amber-400/80 md:flex">
          <span className="h-0 w-4 shrink-0 border-t border-dashed border-amber-500/70" aria-hidden />
          <span>Enlace ancla → zona</span>
        </span>
      </div>

      {/* ============ Tri-panel ============ */}
      <div className="grid grid-cols-1 items-start gap-3 px-3 py-3 sm:px-4 lg:grid-cols-12">
        {/* -------- Izquierda: campos del molde -------- */}
        <aside className="flex max-h-[780px] flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900 lg:col-span-3">
          <div className="flex flex-col gap-2 border-b border-slate-800 bg-slate-900 p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <SquareDashedMousePointer className="h-4 w-4 text-indigo-400" aria-hidden />
                <span className="font-mono text-[11px] font-bold uppercase tracking-widest text-slate-200">
                  Campos del molde
                </span>
              </div>
              <Badge variant="secondary" className="rounded-md bg-slate-800 font-mono text-[10px] text-slate-300">
                {camposPagina.length}
              </Badge>
            </div>
            <div className="relative">
              <SearchIcon />
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Filtrar campo o ancla..."
                aria-label="Filtrar campos"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 py-1.5 pl-8 pr-3 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              />
            </div>
            <div className="flex items-center gap-1 rounded-lg bg-slate-950 p-1">
              {(
                [
                  { id: 'todos', nombre: 'Todos', dot: null },
                  ...TIPOS.map((t) => ({ id: t.id, nombre: t.nombre, dot: t.dot })),
                ] as { id: 'todos' | TipoCampo; nombre: string; dot: string | null }[]
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFiltroTipo(f.id)}
                  aria-pressed={filtroTipo === f.id}
                  className={`flex flex-1 items-center justify-center gap-1 rounded-md px-1.5 py-1 font-mono text-[10px] font-semibold transition ${
                    filtroTipo === f.id
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                  }`}
                >
                  {f.dot ? <span className={`h-1.5 w-1.5 rounded-full ${f.dot}`} aria-hidden /> : null}
                  {f.nombre}
                </button>
              ))}
            </div>
          </div>

          <div className="scroll-fino flex-1 space-y-1 overflow-y-auto p-2">
            {grupos.length === 0 ? (
              <p className="px-2 py-8 text-center text-xs text-slate-500">
                Sin campos en esta página. Crea zonas con &quot;+ Añadir campo&quot;.
              </p>
            ) : (
              grupos.map((g) => (
                <div key={g.id} className="rounded-lg border border-slate-800 bg-slate-950/60">
                  <div className="flex items-center justify-between px-2.5 py-1.5">
                    <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      {g.grupo}
                    </span>
                    <span className="inline-flex items-center gap-1 font-mono text-[10px] text-slate-500">
                      {g.items.length}
                      <ChevronRight className="h-3 w-3 rotate-90" aria-hidden />
                    </span>
                  </div>
                  <div className="space-y-0.5 px-1 pb-1">
                    {g.items.map((c) => {
                      const activo = c.id === campoSeleccionadoId;
                      const oculto = ocultos.has(c.id);
                      const sinAncla = c.estrategia === 'ancla_relativa' && !rectEditor(c);
                      return (
                        <div
                          key={c.id}
                          className={`group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors ${
                            activo ? 'bg-indigo-600/20 ring-1 ring-indigo-500/60' : 'hover:bg-slate-800/70'
                          }`}
                        >
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            onClick={() => setCampoSeleccionado(c.id)}
                          >
                            <span className={`h-2 w-2 shrink-0 rounded-full ${g.dot}`} aria-hidden />
                            <span className="flex min-w-0 flex-col">
                              <span className="truncate text-xs font-medium text-slate-100">{c.etiqueta}</span>
                              <span className="truncate font-mono text-[9px] text-slate-500">{c.id}</span>
                            </span>
                            {sinAncla ? (
                              <span className="shrink-0 rounded border border-amber-600/60 px-1 font-mono text-[8px] text-amber-400">
                                sin ancla
                              </span>
                            ) : null}
                            {c.obligatorio ? <span className="text-[10px] text-rose-400">*</span> : null}
                          </button>
                          <button
                            type="button"
                            aria-label={oculto ? 'Mostrar zona' : 'Ocultar zona'}
                            title={oculto ? 'Mostrar zona' : 'Ocultar zona'}
                            className="rounded p-1 text-slate-500 opacity-0 transition hover:bg-slate-700 hover:text-slate-200 group-hover:opacity-100"
                            onClick={() => alternarOculto(c.id)}
                          >
                            {oculto ? <EyeOff className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
                          </button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                aria-label="Opciones del campo"
                                className="rounded p-1 text-slate-500 opacity-0 transition hover:bg-slate-700 hover:text-slate-200 group-hover:opacity-100"
                              >
                                <MoreVertical className="h-3.5 w-3.5" aria-hidden />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-40">
                              <DropdownMenuItem onClick={() => setCampoSeleccionado(c.id)}>
                                <Pencil className="mr-2 h-3.5 w-3.5 text-indigo-400" /> Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => duplicarCampo(c.id)}>
                                <Copy className="mr-2 h-3.5 w-3.5 text-slate-400" /> Duplicar
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-rose-400 focus:text-rose-300" onClick={() => eliminarCampo(c.id)}>
                                <Trash2 className="mr-2 h-3.5 w-3.5" /> Eliminar
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="border-t border-slate-800 p-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-700 py-2.5 text-xs font-medium text-slate-300 transition hover:border-indigo-500 hover:bg-slate-800/60 hover:text-indigo-300"
                >
                  <Plus className="h-4 w-4" aria-hidden /> Añadir campo
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                <DropdownMenuItem onClick={() => nuevoCampo('zona_fija')}>
                  <Plus className="mr-2 h-3.5 w-3.5 text-slate-400" /> Zona fija
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => nuevoCampo('ancla_relativa')}>
                  <Crosshair className="mr-2 h-3.5 w-3.5 text-amber-400" /> Con ancla OCR
                </DropdownMenuItem>
                {/* FASE 2 (v3.2.0): ancla relacional — el molde es el faro. */}
                <DropdownMenuItem onClick={() => nuevoCampo('ancla_relacional')}>
                  <ScanSearch className="mr-2 h-3.5 w-3.5 text-cyan-400" /> Relacional (faro)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </aside>

        {/* -------- Centro: lienzo -------- */}
        <section className="flex flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900 lg:col-span-6">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
            <div className="flex items-center gap-1">
              <span className="mr-1 flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white" title="Seleccionar / mover">
                <MousePointer2 className="h-4 w-4" aria-hidden />
              </span>
              <button
                type="button"
                title="Ajustar al 100%"
                aria-label="Ajustar zoom al 100%"
                onClick={() => cambiarZoom(100)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
              >
                <Maximize2 className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                title="Alinear anclas con OCR"
                aria-label="Alinear anclas con OCR"
                disabled={alineando || !imagenRef}
                onClick={alinearOCR}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-amber-400 transition hover:bg-slate-800 disabled:opacity-40"
              >
                {alineando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Crosshair className="h-4 w-4" aria-hidden />}
              </button>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Alejar"
                onClick={() => cambiarZoom((z) => Math.max(30, z - 10))}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-700 text-slate-300 transition hover:bg-slate-800"
              >
                <Minus className="h-3.5 w-3.5" aria-hidden />
              </button>
              <span className="w-12 text-center font-mono text-xs text-slate-300">{zoom}%</span>
              <button
                type="button"
                aria-label="Acercar"
                onClick={() => cambiarZoom((z) => Math.min(220, z + 10))}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-700 text-slate-300 transition hover:bg-slate-800"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5 font-mono text-[11px] text-slate-300">
                <Checkbox checked={verAnclas} onCheckedChange={(v) => setVerAnclas(Boolean(v))} aria-label="Ver anclas" className="border-slate-600" />
                Anclas
              </label>
              <label className="flex items-center gap-1.5 font-mono text-[11px] text-slate-300">
                <Checkbox checked={verEtiquetas} onCheckedChange={(v) => setVerEtiquetas(Boolean(v))} aria-label="Ver etiquetas" className="border-slate-600" />
                Etiquetas
              </label>
              <label className="flex items-center gap-1.5 font-mono text-[11px] text-slate-300">
                <Checkbox checked={verGrid} onCheckedChange={(v) => setVerGrid(Boolean(v))} aria-label="Ver grid" className="border-slate-600" />
                Grid
              </label>
              <label
                className={`flex items-center gap-1.5 font-mono text-[11px] transition ${verOcr ? 'text-teal-300' : 'text-slate-300'}`}
                title="Resalta sobre el escaneo el texto que el OCR reconoce (color según confianza), sin cajas ni etiquetas"
              >
                <Checkbox
                  checked={verOcr}
                  onCheckedChange={(v) => setVerOcr(Boolean(v))}
                  aria-label="Ver capa OCR"
                  className="border-slate-600 data-[state=checked]:bg-teal-600 data-[state=checked]:border-teal-500"
                />
                Capa OCR
              </label>
              <label
                className={`flex items-center gap-1.5 font-mono text-[11px] transition ${
                  mapearOcr && ocrCapaVigente ? 'text-teal-200' : ocrCapaVigente ? 'text-slate-300' : 'text-slate-600'
                }`}
                title={
                  ocrCapaVigente
                    ? 'Modo mapeo: clic sobre un resaltado OCR para crear campos, fijar el ancla del campo activo o ajustar su zona'
                    : 'Activa la Capa OCR para habilitar el modo mapeo'
                }
              >
                <Checkbox
                  checked={mapearOcr}
                  disabled={!ocrCapaVigente}
                  onCheckedChange={(v) => {
                    setMapearOcr(Boolean(v));
                    if (!v) {
                      setOcrMenu(null);
                      setOcrDestacada(null);
                    }
                  }}
                  aria-label="Modo mapeo de la capa OCR"
                  className="border-slate-600 data-[state=checked]:bg-teal-500 data-[state=checked]:border-teal-400"
                />
                Mapear
              </label>
              {/* Detectar tabla: modo de arrastre sobre la capa OCR que genera
                  un campo por celda (revisable y editable antes de crear). */}
              {verOcr ? (
                <button
                  type="button"
                  title="Detectar tabla: arrastra un rectángulo sobre la tabla en el lienzo; se agrupan renglones y columnas y se generan campos por celda (revisables antes de crear)"
                  aria-pressed={modoTabla}
                  disabled={!ocrCapaVigente || ocrEstado === 'cargando'}
                  onClick={alternarModoTabla}
                  className={`inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium transition disabled:opacity-40 ${
                    modoTabla ? 'bg-teal-600 text-white' : 'text-teal-300 hover:bg-slate-800'
                  }`}
                >
                  <Table className="h-3.5 w-3.5" aria-hidden /> Tabla
                </button>
              ) : null}
              {verOcr ? (
                <button
                  type="button"
                  title="Recalcular capa OCR para esta página"
                  aria-label="Recalcular capa OCR"
                  disabled={ocrEstado === 'cargando' || !imagenRef}
                  onClick={ejecutarOcrCapa}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-teal-400 transition hover:bg-slate-800 disabled:opacity-40"
                >
                  {ocrEstado === 'cargando' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <RotateCw className="h-3.5 w-3.5" aria-hidden />
                  )}
                </button>
              ) : null}
              <Select
                value={String(pagina)}
                onValueChange={(v) => {
                  setPagina(Number(v));
                  setOcrMenu(null);
                  setOcrDestacada(null);
                }}
              >
                <SelectTrigger className="h-8 w-28 border-slate-700 bg-slate-950 text-xs text-slate-200" aria-label="Página del molde">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {paginas.map((p) => (
                    <SelectItem key={p} value={String(p)}>
                      Página {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* Agregar página: navega a la primera página sin uso para
                  subirle su escaneo de referencia (y luego mapearla). */}
              <button
                type="button"
                title={`Agregar página ${paginas[paginas.length - 1] + 1}`}
                aria-label={`Agregar página ${paginas[paginas.length - 1] + 1}`}
                disabled={subiendo}
                onClick={() => {
                  setPagina(paginas[paginas.length - 1] + 1);
                  setOcrMenu(null);
                  setOcrDestacada(null);
                }}
                className="flex h-8 w-7 items-center justify-center rounded-md border border-slate-700 bg-slate-950 text-slate-400 transition hover:border-slate-500 hover:text-slate-200 disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          </div>

          {/* Viewport */}
          <div
            className="dot-grid scroll-fino relative flex justify-center overflow-auto bg-slate-950 p-6"
            style={{ minHeight: 560, maxHeight: 720 }}
            onPointerMove={onPointerMoveZona}
            onPointerUp={onPointerUpZona}
            onMouseMove={onPointerMoveCoords}
            onMouseLeave={() => setCoordenadas(null)}
            onClick={() => {
              seleccionarCampo(null);
              setOcrMenu(null);
              setOcrDestacada(null);
            }}
          >
            <div
              ref={contenedorRef}
              className={`relative select-none self-start shadow-[0_8px_30px_rgba(0,0,0,0.5)] ${
                modoTabla ? 'cursor-crosshair' : ''
              }`}
              style={{ width: `${zoom}%`, maxWidth: 680 }}
              onPointerDown={onPointerDownTabla}
              onPointerMove={onPointerMoveTabla}
              onPointerUp={onPointerUpTabla}
            >
              {imagenRef && imagenRefVisual ? (
                <img
                  src={imagenRefVisual}
                  alt={`Escaneo de referencia página ${pagina}`}
                  className="block w-full bg-white"
                  draggable={false}
                />
              ) : (
                <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-slate-700 bg-slate-900 py-20 text-center">
                  <FileUp className="h-10 w-10 text-slate-500" aria-hidden />
                  <p className="text-sm text-slate-400">Sube el escaneo de referencia de la página {pagina}</p>
                  <Button
                    size="sm"
                    onClick={() => inputImagenRef.current?.click()}
                    disabled={subiendo}
                    className="bg-indigo-600 hover:bg-indigo-700"
                  >
                    {subiendo ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileUp className="mr-2 h-4 w-4" />}
                    Subir escaneo
                  </Button>
                </div>
              )}

              {/* Grid de calibración */}
              {verGrid && imagenRef ? (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0"
                  style={{
                    backgroundImage:
                      'linear-gradient(to right, rgba(99,102,241,0.18) 1px, transparent 1px), linear-gradient(to bottom, rgba(99,102,241,0.18) 1px, transparent 1px)',
                    backgroundSize: '10% 10%',
                  }}
                />
              ) : null}

              {/* Rect de arrastre del modo Detectar tabla */}
              {arrastreTabla ? (
                <div
                  aria-hidden
                  className="pointer-events-none absolute z-[30] border-2 border-dashed border-teal-400 bg-teal-400/10"
                  style={{
                    left: `${Math.min(arrastreTabla.x0, arrastreTabla.x1) * 100}%`,
                    top: `${Math.min(arrastreTabla.y0, arrastreTabla.y1) * 100}%`,
                    width: `${Math.abs(arrastreTabla.x1 - arrastreTabla.x0) * 100}%`,
                    height: `${Math.abs(arrastreTabla.y1 - arrastreTabla.y0) * 100}%`,
                  }}
                />
              ) : null}

              {/* Capa OCR — resaltado suave de lo que el OCR reconoció en ESTA
                  página. SIN cajas ni etiquetas flotantes: solo un velo de color
                  redondeado sobre el texto reconocido (tipo marcador). Colores
                  por confianza: ≥85% teal · 60–85% ámbar · <60% rosa. En modo
                  Mapear, el hover muestra el texto reconocido vía tooltip y el
                  clic abre el menú para que el usuario ELIJA qué hacer con esa
                  línea. Solo se pinta cuando el resultado cacheado corresponde
                  a la página/referencia actual. */}
              {verOcr && imagenRef && ocrEstado === 'listo' && ocrCapa && ocrCapa.key === ocrCapaKey
                ? ocrCapa.lines.map((l, i) => {
                    // Línea eliminada por el usuario (ruido): no se resalta.
                    if (ocrExcluidasVigentes.has(i)) return null;
                    const [lx0, ly0, lx1, ly1] = l.bbox;
                    const confMedia =
                      l.palabras.length > 0
                        ? l.palabras.reduce((acc, w) => acc + (w.conf >= 0 ? w.conf : 0), 0) / l.palabras.length
                        : null;
                    const colorL = confMedia === null ? '#2dd4bf' : confMedia >= 0.85 ? '#2dd4bf' : confMedia >= 0.6 ? '#fbbf24' : '#fb7185';
                    const destacada = ocrDestacada === i;
                    return (
                      <div
                        key={`ocr-l-${i}`}
                        aria-hidden={!mapearOcr}
                        className={`absolute z-[2] rounded-[3px] transition ${
                          mapearOcr
                            ? 'cursor-pointer hover:z-[8] hover:brightness-110 hover:ring-2 hover:ring-white/70'
                            : 'pointer-events-none'
                        } ${destacada ? 'z-[8] ring-2 ring-white shadow-[0_0_14px_rgba(255,255,255,0.45)]' : ''}`}
                        style={{
                          left: `${(lx0 / ocrCapa.dims.w) * 100}%`,
                          top: `${(ly0 / ocrCapa.dims.h) * 100}%`,
                          width: `${((lx1 - lx0) / ocrCapa.dims.w) * 100}%`,
                          height: `${((ly1 - ly0) / ocrCapa.dims.h) * 100}%`,
                          backgroundColor: `${colorL}${destacada ? '59' : '24'}`,
                        }}
                        title={
                          mapearOcr
                            ? `${l.texto.trim() || '(sin texto)'}${confMedia !== null ? ` · ${Math.round(confMedia * 100)}%` : ''}`
                            : undefined
                        }
                        onClick={(e) => {
                          if (!mapearOcr) return;
                          e.stopPropagation();
                          abrirMenuOcr(i);
                        }}
                        role={mapearOcr ? 'button' : undefined}
                        aria-label={mapearOcr ? `Línea OCR ${i + 1}: ${l.texto.slice(0, 60)} — acciones de mapeo` : undefined}
                      />
                    );
                  })
                : null}

              {/* Menú contextual de mapeo sobre un resaltado OCR — acciones para
                  convertir lo reconocido en estructura del molde. */}
              {ocrMenu && mapearOcr && ocrCapaVigente && ocrCapaVigente.lines[ocrMenu.idx]
                ? (() => {
                    const l = ocrCapaVigente.lines[ocrMenu.idx];
                    const abajo = ocrMenu.topPct > 50;
                    return (
                      <div
                        className="absolute z-[40] w-56 rounded-lg border border-teal-500/60 bg-slate-950/95 p-1.5 shadow-2xl backdrop-blur"
                        style={{
                          left: `${Math.min(ocrMenu.leftPct, 60)}%`,
                          top: `${ocrMenu.topPct}%`,
                          transform: abajo ? 'translateY(calc(-100% - 10px))' : 'translateY(10px)',
                        }}
                        onClick={(e) => e.stopPropagation()}
                        role="menu"
                        aria-label="Acciones de mapeo para la línea OCR"
                      >
                        <p className="truncate rounded bg-slate-900 px-1.5 py-1 font-mono text-[9px] text-teal-300">
                          «{l.texto.slice(0, 44)}»
                        </p>
                        <div className="mt-1 space-y-0.5">
                          <button
                            type="button"
                            role="menuitem"
                            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] text-slate-200 transition hover:bg-slate-800"
                            onClick={() => crearCampoDesdeOcr(l, 'fija')}
                          >
                            <Plus className="h-3.5 w-3.5 text-emerald-400" aria-hidden /> Crear campo (zona fija)
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] text-slate-200 transition hover:bg-slate-800"
                            onClick={() => crearCampoDesdeOcr(l, 'anclada')}
                          >
                            <Link2 className="h-3.5 w-3.5 text-sky-400" aria-hidden /> Crear campo anclado aquí
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] text-slate-200 transition hover:bg-slate-800"
                            onClick={() => usarLineaComoAncla(l)}
                          >
                            <Crosshair className="h-3.5 w-3.5 text-amber-400" aria-hidden /> Ancla del campo activo
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] text-slate-200 transition hover:bg-slate-800"
                            onClick={() => ajustarZonaActivaAOcr(l)}
                          >
                            <Magnet className="h-3.5 w-3.5 text-violet-400" aria-hidden /> Ajustar zona del activo
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] text-slate-200 transition hover:bg-slate-800"
                            onClick={() => {
                              navigator.clipboard.writeText(l.texto).then(() => toast({ title: 'Texto OCR copiado' }));
                              cerrarMenuOcr();
                            }}
                          >
                            <Copy className="h-3.5 w-3.5 text-slate-400" aria-hidden /> Copiar texto
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] text-rose-300 transition hover:bg-rose-950/60"
                            onClick={() => eliminarLineaOcr(ocrMenu.idx)}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden /> Eliminar línea OCR
                          </button>
                        </div>
                        <p className="px-1.5 pt-1 font-mono text-[8px] text-slate-500">Esc o clic fuera para cerrar</p>
                      </div>
                    );
                  })()
                : null}

              {verOcr && ocrEstado === 'cargando' && imagenRef ? (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 z-[2] flex items-start justify-center"
                >
                  <span className="mt-3 inline-flex items-center gap-2 rounded-full bg-slate-950/90 px-3 py-1 font-mono text-[10px] text-teal-300 ring-1 ring-teal-500/40">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Reconociendo texto… {ocrProgreso}%
                  </span>
                </div>
              ) : null}

              {verOcr && ocrEstado === 'error' && ocrError ? (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 z-[2] flex items-start justify-center"
                >
                  <span className="mt-3 inline-flex max-w-[90%] items-center gap-2 rounded-full bg-slate-950/90 px-3 py-1 font-mono text-[10px] text-rose-300 ring-1 ring-rose-500/40">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    OCR falló: {ocrError.slice(0, 80)}
                  </span>
                </div>
              ) : null}

              {/* Puntos ancla OCR — el del campo activo se agranda para revelar
                  cuál es su ancla y de dónde nace el enlace. */}
              {verAnclas &&
                imagenRef &&
                camposPagina.map((c) =>
                  c.ancla?.rect ? (
                    <span
                      key={`ancla-${c.id}`}
                      className={`pointer-events-none absolute z-[5] flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-amber-500 ring-2 ring-amber-400/50 ${
                        c.id === campoSeleccionadoId ? 'h-3.5 w-3.5 ring-4 ring-amber-300/70' : 'h-2.5 w-2.5'
                      }`}
                      style={{ left: `${c.ancla.rect.x * 100}%`, top: `${c.ancla.rect.y * 100}%` }}
                      title={`Ancla: ${c.ancla.texto || c.id}`}
                    />
                  ) : null,
                )}

              {/* Enlace diminuto ancla → zona: línea punteada que revela cómo se
                  enlazan el punto ancla (origen) y la esquina de su zona (offset).
                  Activa = ámbar brillante + icono de eslabón en el punto medio. */}
              {verAnclas && imagenRef ? (
                <svg
                  aria-hidden
                  className="pointer-events-none absolute inset-0 z-[4] h-full w-full"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                >
                  {camposPagina.map((c) => {
                    const ar = c.ancla?.rect;
                    if (!ar || ocultos.has(c.id)) return null;
                    const rect = rectsPorId.get(c.id);
                    if (!rect) return null;
                    const activo = c.id === campoSeleccionadoId;
                    return (
                      <line
                        key={`enlace-${c.id}`}
                        x1={ar.x * 100}
                        y1={ar.y * 100}
                        x2={rect.x * 100}
                        y2={rect.y * 100}
                        stroke={activo ? '#fbbf24' : 'rgba(245,158,11,0.9)'}
                        strokeWidth={activo ? 2.2 : 1.5}
                        strokeDasharray="4 3"
                        strokeLinecap="round"
                        vectorEffect="non-scaling-stroke"
                      />
                    );
                  })}
                </svg>
              ) : null}

              {/* Icono de eslabón en el punto medio del enlace ACTIVO */}
              {verAnclas && imagenRef && campoSel && campoSel.ancla?.rect ? (
                (() => {
                  const ar = campoSel.ancla?.rect;
                  const rect = rectEditor(campoSel);
                  if (!ar || !rect || ocultos.has(campoSel.id)) return null;
                  return (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute z-[6] flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-amber-500 text-slate-950 shadow"
                      style={{
                        left: `${(ar.x + (rect.x - ar.x) / 2) * 100}%`,
                        top: `${(ar.y + (rect.y - ar.y) / 2) * 100}%`,
                      }}
                    >
                      <Link2 className="h-2.5 w-2.5" />
                    </span>
                  );
                })()
              ) : null}

              {/* FASE 2 (v3.2.0 — faro): zona de búsqueda del campo relacional ACTIVO.
                  Cian punteado = «aquí SOLO busca el motor» (el mapa del humano). */}
              {verAnclas && campoSel && campoSel.estrategia === 'ancla_relacional' && campoSel.zona_busqueda ? (
                <div
                  aria-hidden
                  className="pointer-events-none absolute z-[5] border-2 border-dashed border-cyan-400/90"
                  style={{
                    left: `${CLAMP(campoSel.zona_busqueda.x) * 100}%`,
                    top: `${CLAMP(campoSel.zona_busqueda.y) * 100}%`,
                    width: `${campoSel.zona_busqueda.w * 100}%`,
                    height: `${campoSel.zona_busqueda.h * 100}%`,
                  }}
                >
                  <span className="absolute -top-5 left-0 max-w-full truncate rounded bg-cyan-600 px-1.5 py-0.5 font-mono text-[9px] font-bold text-white">
                    FARO · zona_busqueda
                  </span>
                </div>
              ) : null}

              {/* FASE 2: rect RESUELTO por la previsualización del faro (resolverRectRelacional
                  contra la capa OCR de referencia) — dashed sólido cian con fuente/banderas. */}
              {pruebaRelacional && campoSel && campoSel.estrategia === 'ancla_relacional' ? (
                <div
                  aria-hidden
                  className="pointer-events-none absolute z-[7] border-2 border-cyan-300 bg-cyan-400/10"
                  style={{
                    left: `${CLAMP(pruebaRelacional.rect.x) * 100}%`,
                    top: `${CLAMP(pruebaRelacional.rect.y) * 100}%`,
                    width: `${pruebaRelacional.rect.w * 100}%`,
                    height: `${pruebaRelacional.rect.h * 100}%`,
                  }}
                >
                  <span className="absolute -bottom-5 left-0 max-w-full truncate rounded bg-cyan-500 px-1.5 py-0.5 font-mono text-[9px] font-bold text-white">
                    RESUELTO · {pruebaRelacional.fuente}
                    {pruebaRelacional.banderas.length ? ` · ${pruebaRelacional.banderas.join(',')}` : ''}
                  </span>
                </div>
              ) : null}

              {/* Zonas del molde — memoizadas (P2): solo re-renderiza la zona
                  cuyo rect o estado activo cambió */}
              {imagenRef &&
                camposPagina.map((c) => {
                  if (ocultos.has(c.id)) return null;
                  const rect = rectsPorId.get(c.id);
                  // G-10: ancla_relativa sin rect resoluble (ancla vacía o sin
                  // capturar) se pinta como NO EVALUABLE con hatch rojo — nunca
                  // como una zona válida donde el motor nunca medirá.
                  if (!rect) {
                    if (c.estrategia !== 'ancla_relativa') return null;
                    return (
                      <div
                        key={c.id}
                        className="pointer-events-none absolute border-2 border-dashed border-rose-500/80"
                        style={{
                          left: `${CLAMP(c.zona.x, -0.2, 0.98) * 100}%`,
                          top: `${CLAMP(c.zona.y, -0.2, 0.98) * 100}%`,
                          width: `${c.zona.w * 100}%`,
                          height: `${c.zona.h * 100}%`,
                          backgroundImage:
                            'repeating-linear-gradient(45deg, rgba(244,63,94,0.25) 0 6px, transparent 6px 12px)',
                        }}
                      >
                        {verEtiquetas ? (
                          <span className="absolute -top-5 left-0 max-w-full truncate rounded bg-rose-600 px-1.5 py-0.5 font-mono text-[9px] font-bold text-white">
                            NO EVALUABLE · falta ancla
                          </span>
                        ) : null}
                      </div>
                    );
                  }
                  return (
                    <ZonaCampo
                      key={c.id}
                      campoId={c.id}
                      etiqueta={c.etiqueta}
                      color={hexTipo(c.tipo)}
                      activo={c.id === campoSeleccionadoId}
                      verEtiquetas={verEtiquetas}
                      inerte={modoTabla}
                      rx={rect.x}
                      ry={rect.y}
                      rw={rect.w}
                      rh={rect.h}
                      onArrastreZona={onArrastreZona}
                      onSeleccion={seleccionarCampo}
                    />
                  );
                })}
            </div>
          </div>

          {/* Barra de estado */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 bg-slate-900 px-3 py-1.5 font-mono text-[11px] text-slate-400">
            <div className="flex items-center gap-4">
              <span>
                X: {(coordenadas?.x ?? 0).toFixed(3)} Y: {(coordenadas?.y ?? 0).toFixed(3)}
              </span>
              <span>Zoom: {zoom}%</span>
              {verOcr ? (
                ocrEstado === 'cargando' ? (
                  <span className="inline-flex items-center gap-1.5 text-teal-300">
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> OCR: {ocrProgreso}%
                  </span>
                ) : ocrEstado === 'listo' && ocrCapa && ocrCapa.key === ocrCapaKey ? (
                  <span className="inline-flex items-center gap-1.5 text-teal-300" title="Resultado de la capa OCR para esta página">
                    <ScanLine className="h-3 w-3" aria-hidden />
                    OCR: {ocrCapa.lines.length} líneas
                    {ocrExcluidasVigentes.size > 0 ? ` · ${ocrExcluidasVigentes.size} eliminadas` : ''}
                    {ocrCapa.conf !== null ? ` · conf ${(ocrCapa.conf * 100).toFixed(0)}%` : ''}
                    {` · ${ocrCapa.ms} ms`}
                  </span>
                ) : ocrEstado === 'error' ? (
                  <span className="inline-flex items-center gap-1.5 text-rose-400">
                    <AlertTriangle className="h-3 w-3" aria-hidden /> OCR: error
                  </span>
                ) : null
              ) : null}
              {mapearOcr && ocrCapaVigente ? (
                <span
                  className="inline-flex items-center gap-1 rounded bg-teal-950 px-1.5 py-0.5 font-mono text-[10px] text-teal-300 ring-1 ring-teal-600/50"
                  title="Modo mapeo: clic sobre los resaltados OCR del lienzo para mapear la estructura"
                >
                  MAPEO
                </span>
              ) : null}
              {campoSel ? (
                <span>
                  Campo: <span className="text-indigo-400">{campoSel.id}</span>
                </span>
              ) : (
                <span className="text-slate-600">Sin campo activo</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {imagenRef ? (
                <button
                  type="button"
                  onClick={() => inputImagenRef.current?.click()}
                  disabled={subiendo}
                  className="inline-flex items-center gap-1 text-slate-400 transition hover:text-slate-200"
                >
                  {subiendo ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileUp className="h-3 w-3" />}
                  Reemplazar escaneo
                </button>
              ) : null}
              {sucio ? (
                <span className="inline-flex items-center gap-1.5 text-amber-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden /> Cambios sin guardar
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden /> Sincronizado
                </span>
              )}
            </div>
          </div>
          <input ref={inputImagenRef} type="file" accept="image/png,image/jpeg,image/webp,image/heic,image/heif,application/pdf" className="hidden" onChange={subirImagen} aria-hidden />
        </section>

        {/* -------- Derecha: propiedades / JSON -------- */}
        <aside className="flex max-h-[780px] flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900 lg:col-span-3">
          <Tabs
            value={pestanaDerecha}
            onValueChange={(v) => setPestanaDerecha(v as 'propiedades' | 'diag' | 'ocr' | 'layout' | 'json')}
            className="flex min-h-0 flex-1 flex-col gap-0"
          >
            <div className="border-b border-slate-800 p-2">
              <TabsList className="grid w-full grid-cols-5 bg-slate-950">
                <TabsTrigger value="propiedades" className="font-mono text-[11px] data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
                  Propiedades
                </TabsTrigger>
                <TabsTrigger value="diag" className="font-mono text-[11px] data-[state=active]:bg-emerald-700 data-[state=active]:text-white">
                  Diagnóstico
                </TabsTrigger>
                <TabsTrigger value="ocr" className="font-mono text-[11px] data-[state=active]:bg-teal-700 data-[state=active]:text-white">
                  OCR
                </TabsTrigger>
                <TabsTrigger value="layout" className="font-mono text-[11px] data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
                  Layout
                </TabsTrigger>
                <TabsTrigger value="json" className="font-mono text-[11px] data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
                  JSON
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="propiedades" className="mt-0 min-h-0 flex-1 overflow-y-auto scroll-fino">
              {campoSel ? (
                <div className="space-y-3 p-3">
                  {/* Recorte 300 DPI */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-slate-400">
                        Recorte 300 DPI
                      </span>
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[9px] text-slate-300">{dimsPx}</span>
                    </div>
                    <div className="flex h-28 items-center justify-center overflow-hidden rounded-lg border border-slate-700 bg-canvas-paper p-1.5 dark:bg-[#1a1712]">
                      {campoSelOtraPagina ? (
                        <span className="max-w-full px-2 text-center font-mono text-[10px] leading-4 text-slate-500">
                          Campo de la página {campoSel.pagina} — cambia a esa página para ver su recorte.
                        </span>
                      ) : cropPreview ? (
                        <img src={cropPreview} alt={`Recorte de ${campoSel.etiqueta}`} className="max-h-full max-w-full object-contain" />
                      ) : (
                        <span className="font-mono text-[10px] text-slate-500">sin recorte disponible</span>
                      )}
                    </div>
                  </div>

                  {/* Campo activo */}
                  <div className="space-y-1.5">
                    <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-slate-400">Campo activo</span>
                    <div className="flex items-center justify-between gap-1 rounded-lg bg-slate-950 px-2.5 py-2">
                      <span className="truncate font-mono text-xs font-semibold text-indigo-400">{campoSel.id}</span>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <button
                          type="button"
                          aria-label="Copiar ID"
                          title="Copiar ID"
                          className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                          onClick={() => navigator.clipboard.writeText(campoSel.id).then(() => toast({ title: 'ID copiado' }))}
                        >
                          <Copy className="h-3.5 w-3.5" aria-hidden />
                        </button>
                        <button
                          type="button"
                          aria-label="Eliminar campo"
                          title="Eliminar campo"
                          className="rounded p-1 text-rose-400 hover:bg-rose-950/60"
                          onClick={() => eliminarCampo(campoSel.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </div>
                    </div>
                    <p className="truncate text-[11px] text-slate-400">{campoSel.etiqueta}</p>
                  </div>

                  {/* 'anclas' abierto por defecto: el flujo de mapeo con la capa
                      OCR edita anclas constantemente y las sugerencias deben ser
                      visibles sin un clic extra. */}
                  <Accordion type="multiple" defaultValue={['general', 'anclas']} className="space-y-2">
                    {/* General & Tipo */}
                    <AccordionItem value="general" className="rounded-lg border border-slate-800 bg-slate-950/60 px-3">
                      <AccordionTrigger className="py-2.5 font-mono text-[11px] font-bold uppercase tracking-wider text-slate-200 hover:no-underline">
                        General &amp; Tipo
                      </AccordionTrigger>
                      <AccordionContent className="space-y-3 pb-3">
                        <div className="space-y-1">
                          <Label htmlFor="insp-etiqueta" className="text-[11px] text-slate-400">Etiqueta legible</Label>
                          <Input
                            id="insp-etiqueta"
                            value={campoSel.etiqueta}
                            onChange={(e) => actualizarCampo(campoSel.id, { etiqueta: e.target.value })}
                            className="h-8 border-slate-700 bg-slate-900 text-xs text-slate-100"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <Label className="text-[11px] text-slate-400">Tipo</Label>
                            <Select value={campoSel.tipo} onValueChange={(v) => actualizarCampo(campoSel.id, { tipo: v as TipoCampo })}>
                              <SelectTrigger className="h-8 border-slate-700 bg-slate-900 text-xs text-slate-100">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {TIPOS.map((t) => (
                                  <SelectItem key={t.id} value={t.id}>
                                    <span className="inline-flex items-center gap-2">
                                      <span className={`h-2 w-2 rounded-full ${t.dot}`} aria-hidden />
                                      {NOMBRE_TIPO[t.id]}
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[11px] text-slate-400">Estrategia</Label>
                            <Select
                              value={campoSel.estrategia}
                              onValueChange={(v) => {
                                const nueva = v as EstrategiaCampo;
                                // FASE 2 (v3.2.0): al pasar a relacional el campo nace CON faro
                                // (sin faro el validador rechaza — no hay búsqueda global) y con
                                // relación de banda adyacente. Faro por defecto: generoso alrededor
                                // del ancla de referencia si existe (el mapa del humano se respeta).
                                if (nueva === 'ancla_relacional' && campoSel.estrategia !== 'ancla_relacional') {
                                  actualizarCampo(campoSel.id, {
                                    estrategia: nueva,
                                    ancla: campoSel.ancla ?? { texto: '' },
                                    zona_busqueda:
                                      campoSel.zona_busqueda ??
                                      (campoSel.ancla?.rect
                                        ? faroDesdeRect(campoSel.ancla.rect)
                                        : { x: 0.08, y: 0.72, w: 0.55, h: 0.14 }),
                                    relacion: campoSel.relacion ?? { direccion: 'arriba', que: 'zona', orden: 'mas_cercano' },
                                  });
                                  return;
                                }
                                actualizarCampo(campoSel.id, {
                                  estrategia: nueva,
                                  ancla: nueva === 'zona_fija' ? campoSel.ancla : campoSel.ancla ?? { texto: '' },
                                });
                              }}
                            >
                              <SelectTrigger className="h-8 border-slate-700 bg-slate-900 font-mono text-xs text-slate-100">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="zona_fija">zona_fija</SelectItem>
                                <SelectItem value="ancla_relativa">ancla_relativa</SelectItem>
                                <SelectItem value="ancla_relacional">ancla_relacional</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <Label htmlFor="insp-pagina" className="text-[11px] text-slate-400">Página</Label>
                            <Input
                              id="insp-pagina"
                              type="number"
                              min={1}
                              value={campoSel.pagina}
                              onChange={(e) => actualizarCampo(campoSel.id, { pagina: Math.max(1, Number(e.target.value) || 1) })}
                              className="h-8 border-slate-700 bg-slate-900 font-mono text-xs text-slate-100"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor="insp-obligatorio" className="text-[11px] text-slate-400">Obligatorio</Label>
                            <div className="flex h-8 items-center justify-between rounded-lg border border-slate-700 bg-slate-900 px-2.5">
                              <span className="font-mono text-[10px] text-slate-400">{campoSel.obligatorio ? 'SÍ' : 'NO'}</span>
                              <Switch
                                id="insp-obligatorio"
                                checked={campoSel.obligatorio}
                                onCheckedChange={(v) => actualizarCampo(campoSel.id, { obligatorio: v })}
                              />
                            </div>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="insp-nota" className="text-[11px] text-slate-400">Nota</Label>
                          <Textarea
                            id="insp-nota"
                            className="min-h-14 border-slate-700 bg-slate-900 text-xs text-slate-100"
                            value={campoSel.nota ?? ''}
                            onChange={(e) => actualizarCampo(campoSel.id, { nota: e.target.value || undefined })}
                          />
                        </div>
                      </AccordionContent>
                    </AccordionItem>

                    {/* Anclas OCR */}
                    {campoSel.estrategia === 'ancla_relativa' || campoSel.estrategia === 'ancla_relacional' ? (
                      <AccordionItem value="anclas" className="rounded-lg border border-amber-600/50 bg-amber-950/10 px-3">
                        <AccordionTrigger className="py-2.5 font-mono text-[11px] font-bold uppercase tracking-wider text-amber-300 hover:no-underline">
                          <span className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full bg-amber-500 ring-2 ring-amber-400/40" aria-hidden />
                            Anclas OCR ({campoSel.estrategia === 'ancla_relacional' ? 'Relacional' : 'Relativa'})
                          </span>
                        </AccordionTrigger>
                        <AccordionContent className="space-y-2 pb-3">
                          <Input
                            placeholder="Texto del ancla (ej: MESA)"
                            value={campoSel.ancla?.texto ?? ''}
                            onChange={(e) =>
                              actualizarCampo(campoSel.id, {
                                ancla: { texto: e.target.value, rect: campoSel.ancla?.rect },
                              })
                            }
                            className="h-8 border-slate-700 bg-slate-900 text-xs text-slate-100"
                            aria-label="Texto del ancla"
                          />
                          {sugerenciasAncla.length > 0 ? (
                            <div className="space-y-1 rounded-md border border-teal-700/50 bg-teal-950/20 p-2">
                              <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-teal-300">
                                Sugerencias capa OCR
                              </span>
                              <div className="space-y-1">
                                {sugerenciasAncla.map((s) => (
                                  <button
                                    key={`sug-ancla-${s.i}`}
                                    type="button"
                                    className="flex w-full items-center justify-between gap-2 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-left transition hover:border-teal-500 hover:bg-slate-800"
                                    onClick={() => aplicarSugerenciaAncla(s)}
                                    title="Aplicar este texto como ancla (fija texto + rect de la línea reconocida)"
                                  >
                                    <span className="truncate text-[11px] text-slate-200">{s.l.texto}</span>
                                    <span className="shrink-0 font-mono text-[9px] text-teal-400">
                                      {Math.round(s.score * 100)}%
                                    </span>
                                  </button>
                                ))}
                              </div>
                              <p className="font-mono text-[8px] leading-3 text-slate-500">
                                Similitud difusa con el texto del ancla (o cercanía al rect esperado). Un clic fija texto + rect.
                              </p>
                            </div>
                          ) : null}
                          <Input
                            placeholder="Ancla de respaldo (opcional)"
                            value={campoSel.ancla_respaldo ?? ''}
                            onChange={(e) => actualizarCampo(campoSel.id, { ancla_respaldo: e.target.value || undefined })}
                            className="h-8 border-slate-700 bg-slate-900 text-xs text-slate-100"
                            aria-label="Ancla de respaldo"
                          />
                          <p className="font-mono text-[10px] text-slate-400">
                            Rect de referencia{' '}
                            {campoSel.ancla?.rect
                              ? `(x ${campoSel.ancla.rect.x.toFixed(3)}, y ${campoSel.ancla.rect.y.toFixed(3)})`
                              : '(sin capturar)'}
                          </p>
                          {campoSel.ancla?.rect ? (
                            <div className="grid grid-cols-4 gap-1.5">
                              {(['x', 'y', 'w', 'h'] as const).map((k) => (
                                <Input
                                  key={k}
                                  type="number"
                                  step={0.005}
                                  aria-label={`Ancla ${k}`}
                                  value={campoSel.ancla!.rect![k]}
                                  onChange={(e) =>
                                    actualizarCampo(campoSel.id, {
                                      ancla: {
                                        ...campoSel.ancla!,
                                        rect: { ...campoSel.ancla!.rect!, [k]: parseFloat(e.target.value) || 0 },
                                      },
                                    })
                                  }
                                  className="h-7 border-slate-700 bg-slate-900 px-1 font-mono text-[11px] text-slate-100"
                                />
                              ))}
                            </div>
                          ) : null}
                          <p className="flex items-start gap-1.5 text-[10px] leading-4 text-slate-500">
                            <GripVertical className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                            Usa &quot;Alinear anclas (OCR)&quot; en la barra del lienzo para capturar posiciones
                            automáticamente.
                          </p>
                        </AccordionContent>
                      </AccordionItem>
                    ) : null}

                    {/* FASE 2 (v3.2.0 — «EL MOLDE ES EL MAPA»): FARO + RELACIÓN */}
                    {campoSel.estrategia === 'ancla_relacional' ? (
                      <AccordionItem value="faro" className="rounded-lg border border-cyan-600/50 bg-cyan-950/10 px-3">
                        <AccordionTrigger className="py-2.5 font-mono text-[11px] font-bold uppercase tracking-wider text-cyan-300 hover:no-underline">
                          <span className="flex items-center gap-2">
                            <ScanSearch className="h-3.5 w-3.5" aria-hidden />
                            Faro y relación
                          </span>
                        </AccordionTrigger>
                        <AccordionContent className="space-y-3 pb-3">
                          <p className="text-[10px] leading-4 text-slate-400">
                            EL FARO es la zona aproximada donde vive el ancla: el motor busca SOLO dentro
                            (nunca global — el «El abajo firmante acepta…» del párrafo legal jamás compite)
                            y resuelve la caja relativa en ese contexto pequeño.
                          </p>

                          {/* zona_busqueda (EL FARO) */}
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <Label className="font-mono text-[10px] font-bold uppercase tracking-wider text-cyan-300">
                                zona_busqueda (faro)
                              </Label>
                              <button
                                type="button"
                                onClick={() => {
                                  if (!campoSel.ancla?.rect) {
                                    toast({
                                      title: 'Sin ancla de referencia',
                                      description: 'Captura primero el ancla (clic sobre la capa OCR o Alinear anclas) para expandir el faro desde ella.',
                                      variant: 'destructive',
                                    });
                                    return;
                                  }
                                  actualizarCampo(campoSel.id, { zona_busqueda: faroDesdeRect(campoSel.ancla.rect) });
                                }}
                                className="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-[9px] font-bold text-cyan-300 transition hover:bg-slate-800"
                                title="Expande un faro generoso alrededor del ancla de referencia (el faro es generoso, la caja relativa es fina)"
                              >
                                Faro desde el ancla
                              </button>
                            </div>
                            {campoSel.zona_busqueda ? (
                              <div className="grid grid-cols-4 gap-1.5">
                                {(['x', 'y', 'w', 'h'] as const).map((k) => (
                                  <div key={k} className="space-y-0.5">
                                    <span className="font-mono text-[9px] uppercase text-slate-500">{k}</span>
                                    <Input
                                      type="number"
                                      step={0.005}
                                      aria-label={`Faro ${k}`}
                                      value={campoSel.zona_busqueda![k]}
                                      onChange={(e) =>
                                        actualizarCampo(campoSel.id, {
                                          zona_busqueda: {
                                            ...campoSel.zona_busqueda!,
                                            [k]: parseFloat(e.target.value) || 0,
                                          },
                                        })
                                      }
                                      className="h-7 border-slate-700 bg-slate-900 px-1 font-mono text-[11px] text-slate-100"
                                    />
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="rounded border border-rose-600/50 bg-rose-950/20 px-2 py-1 font-mono text-[10px] text-rose-300">
                                SIN FARO: el validador rechaza el molde (sin faro NO hay búsqueda).
                              </p>
                            )}
                          </div>

                          {/* relacion */}
                          <div className="space-y-1">
                            <Label className="font-mono text-[10px] font-bold uppercase tracking-wider text-cyan-300">
                              relacion (caja relativa)
                            </Label>
                            <div className="grid grid-cols-3 gap-1.5">
                              <div className="space-y-0.5">
                                <span className="font-mono text-[9px] uppercase text-slate-500">direccion</span>
                                <Select
                                  value={campoSel.relacion?.direccion ?? 'arriba'}
                                  onValueChange={(v) =>
                                    actualizarCampo(campoSel.id, {
                                      relacion: {
                                        ...(campoSel.relacion ?? { que: 'zona', orden: 'mas_cercano' }),
                                        direccion: v as RelacionAncla['direccion'],
                                      },
                                    })
                                  }
                                >
                                  <SelectTrigger className="h-7 border-slate-700 bg-slate-900 px-1 font-mono text-[10px] text-slate-100">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="arriba">arriba</SelectItem>
                                    <SelectItem value="abajo">abajo</SelectItem>
                                    <SelectItem value="izquierda">izquierda</SelectItem>
                                    <SelectItem value="derecha">derecha</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-0.5">
                                <span className="font-mono text-[9px] uppercase text-slate-500">que</span>
                                <Select
                                  value={campoSel.relacion?.que ?? 'zona'}
                                  onValueChange={(v) =>
                                    actualizarCampo(campoSel.id, {
                                      relacion: {
                                        ...(campoSel.relacion ?? { direccion: 'arriba', orden: 'mas_cercano' }),
                                        que: v as RelacionAncla['que'],
                                      },
                                    })
                                  }
                                >
                                  <SelectTrigger className="h-7 border-slate-700 bg-slate-900 px-1 font-mono text-[10px] text-slate-100">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="zona">zona (banda)</SelectItem>
                                    <SelectItem value="linea">linea OCR</SelectItem>
                                    <SelectItem value="caja">caja impresa</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-0.5">
                                <span className="font-mono text-[9px] uppercase text-slate-500">orden</span>
                                <Select
                                  value={campoSel.relacion?.orden ?? 'mas_cercano'}
                                  onValueChange={(v) =>
                                    actualizarCampo(campoSel.id, {
                                      relacion: {
                                        ...(campoSel.relacion ?? { direccion: 'arriba', que: 'zona' }),
                                        orden: v as RelacionAncla['orden'],
                                      },
                                    })
                                  }
                                >
                                  <SelectTrigger className="h-7 border-slate-700 bg-slate-900 px-1 font-mono text-[10px] text-slate-100">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="mas_cercano">mas_cercano</SelectItem>
                                    <SelectItem value="indice">indice</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                            {campoSel.relacion?.orden === 'indice' ? (
                              <div className="space-y-0.5">
                                <span className="font-mono text-[9px] uppercase text-slate-500">indice (1 = más cercano)</span>
                                <Input
                                  type="number"
                                  min={1}
                                  step={1}
                                  aria-label="Índice del candidato"
                                  value={campoSel.relacion.indice ?? 1}
                                  onChange={(e) =>
                                    actualizarCampo(campoSel.id, {
                                      relacion: {
                                        ...campoSel.relacion!,
                                        indice: Math.max(1, Math.round(parseFloat(e.target.value) || 1)),
                                      },
                                    })
                                  }
                                  className="h-7 border-slate-700 bg-slate-900 px-1 font-mono text-[11px] text-slate-100"
                                />
                              </div>
                            ) : null}
                            <p className="font-mono text-[9px] leading-3 text-slate-500">
                              zona (banda) = del borde del ancla al borde del faro · linea = línea vecina del OCR del faro ·
                              caja = recuadro impreso hueco del faro. La finura fina va en «zona» de Coordenadas
                              (w/h en 0 = heredar del candidato). Empate ambiguo = revisión, jamás pick silencioso.
                            </p>
                          </div>

                          {/* Previsualización en vivo contra la capa OCR */}
                          <div className="space-y-1.5">
                            <button
                              type="button"
                              onClick={() => void probarFaroRelacional()}
                              disabled={ocrEstado !== 'listo' || !ocrCapaVigente}
                              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-cyan-600/60 bg-cyan-950/40 py-1.5 font-mono text-[10px] font-bold text-cyan-200 transition hover:bg-cyan-900/40 disabled:cursor-not-allowed disabled:opacity-40"
                              title="Corre resolverRectRelacional (LA MISMA función del motor) contra la capa OCR de la página de referencia y pinta el rect resuelto"
                            >
                              <ScanSearch className="h-3.5 w-3.5" aria-hidden /> Probar faro (OCR de referencia)
                            </button>
                            {ocrEstado !== 'listo' ? (
                              <p className="font-mono text-[9px] text-slate-500">
                                Activa «Ver OCR» en la toolbar del lienzo para habilitar la prueba.
                              </p>
                            ) : null}
                            {pruebaRelacional ? (
                              <div className="rounded-md border border-cyan-700/50 bg-cyan-950/20 p-2">
                                <p className="font-mono text-[10px] font-bold text-cyan-300">
                                  {pruebaRelacional.fuente}
                                  {pruebaRelacional.score !== undefined
                                    ? ` · score ${Math.round(pruebaRelacional.score * 100)}%`
                                    : ''}
                                </p>
                                <p className="font-mono text-[9px] leading-3 text-slate-400">
                                  x {pruebaRelacional.rect.x.toFixed(3)} · y {pruebaRelacional.rect.y.toFixed(3)} · w{' '}
                                  {pruebaRelacional.rect.w.toFixed(3)} · h {pruebaRelacional.rect.h.toFixed(3)}
                                </p>
                                {pruebaRelacional.banderas.length ? (
                                  <p className="font-mono text-[9px] leading-3 text-amber-300">
                                    {pruebaRelacional.banderas.join(' · ')}
                                  </p>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    ) : null}

                    {/* Coordenadas */}
                    <AccordionItem value="coords" className="rounded-lg border border-slate-800 bg-slate-950/60 px-3">
                      <AccordionTrigger className="py-2.5 font-mono text-[11px] font-bold uppercase tracking-wider text-slate-200 hover:no-underline">
                        Coordenadas Normalizadas
                      </AccordionTrigger>
                      <AccordionContent className="space-y-2 pb-3">
                        <p className="text-[10px] text-slate-500">
                          {campoSel.estrategia === 'ancla_relacional'
                            ? 'Finura sobre el candidato: x/y = offset · w/h = tamaño final (0 = heredar del candidato)'
                            : campoSel.estrategia === 'ancla_relativa'
                              ? 'x/y = offset desde el ancla · w/h = tamaño de la zona'
                              : 'Rectángulo absoluto sobre la página (0–1)'}
                        </p>
                        <div className="grid grid-cols-4 gap-1.5">
                          {(['x', 'y', 'w', 'h'] as const).map((k) => (
                            <div key={k} className="space-y-0.5">
                              <span className="font-mono text-[9px] uppercase text-slate-500">{k}</span>
                              <Input
                                type="number"
                                step={0.005}
                                aria-label={`Zona ${k}`}
                                value={campoSel.zona[k]}
                                onChange={(e) =>
                                  actualizarCampo(campoSel.id, {
                                    zona: { ...campoSel.zona, [k]: parseFloat(e.target.value) || 0 },
                                  })
                                }
                                className="h-7 border-slate-700 bg-slate-900 px-1 font-mono text-[11px] text-slate-100"
                              />
                            </div>
                          ))}
                        </div>
                      </AccordionContent>
                    </AccordionItem>

                    {/* Umbral & Reglas CV */}
                    <AccordionItem value="cv" className="rounded-lg border border-slate-800 bg-slate-950/60 px-3">
                      <AccordionTrigger className="py-2.5 font-mono text-[11px] font-bold uppercase tracking-wider text-slate-200 hover:no-underline">
                        Umbral &amp; Reglas CV
                      </AccordionTrigger>
                      <AccordionContent className="space-y-3 pb-3">
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <Label htmlFor="insp-umbral" className="text-[11px] text-slate-400">
                              Umbral tinta: <span className="font-mono text-indigo-400">{campoSel.umbral.toFixed(3)}</span>
                            </Label>
                            <button
                              type="button"
                              onClick={sugerirUmbralClick}
                              className="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-[9px] font-bold text-amber-300 transition hover:bg-slate-800"
                              title="Calcula el umbral a partir de los ratios de tinta medidos en las corridas guardadas (trazo más fino × 0.7)"
                            >
                              ✨ Sugerir umbral
                            </button>
                          </div>
                          <Slider
                            id="insp-umbral"
                            value={[campoSel.umbral]}
                            min={0.001}
                            max={0.4}
                            step={0.001}
                            onValueChange={(v) => actualizarCampo(campoSel.id, { umbral: v[0] })}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="insp-patron" className="text-[11px] text-slate-400">
                            Regex de validación (tipo texto)
                          </Label>
                          <Input
                            id="insp-patron"
                            className="h-8 border-slate-700 bg-slate-900 font-mono text-xs text-slate-100"
                            placeholder={'Ej: \\d{3}'}
                            value={campoSel.patron ?? ''}
                            onChange={(e) => actualizarCampo(campoSel.id, { patron: e.target.value || undefined })}
                          />
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </div>
              ) : (
                <div className="m-3 rounded-lg border border-dashed border-slate-700 p-6 text-center text-xs text-slate-500">
                  Selecciona una zona en el lienzo o en la lista para editar sus propiedades y ver el recorte
                  forense.
                </div>
              )}
            </TabsContent>

            <TabsContent value="diag" className="mt-0 min-h-0 flex-1 overflow-y-auto scroll-fino p-3">
              {!ocrCapaVigente ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 py-8 text-center">
                  <ShieldCheck className="h-8 w-8 text-emerald-400" aria-hidden />
                  <p className="max-w-[250px] text-xs leading-5 text-slate-400">
                    Ejecuta la capa OCR de la página {pagina} para auditar la robustez del molde: qué pasa si mañana el
                    OCR de campo no lee una ancla.
                  </p>
                  <Button
                    size="sm"
                    disabled={!imagenRef || ocrEstado === 'cargando'}
                    onClick={() => {
                      setVerOcr(true);
                      void Promise.resolve().then(ejecutarOcrCapa);
                    }}
                  >
                    {ocrEstado === 'cargando' ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <ShieldCheck className="mr-2 h-4 w-4" aria-hidden />
                    )}
                    {ocrEstado === 'cargando' ? `Analizando… ${ocrProgreso}%` : 'Analizar página'}
                  </Button>
                </div>
              ) : informeDiagnostico ? (
                <div className="space-y-3">
                  {/* Resumen de robustez de la página */}
                  <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-slate-400">
                        Robustez página {pagina}
                      </span>
                      <Badge
                        className={
                          informeDiagnostico.conteo.alto > 0
                            ? 'bg-rose-950 text-rose-300 hover:bg-rose-950'
                            : informeDiagnostico.conteo.medio > 0
                              ? 'bg-amber-950 text-amber-300 hover:bg-amber-950'
                              : 'bg-emerald-950 text-emerald-300 hover:bg-emerald-950'
                        }
                      >
                        {informeDiagnostico.score}/100
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-1.5 font-mono text-[10px]">
                      <span className="rounded bg-emerald-950/80 px-1.5 py-0.5 text-emerald-300">
                        {informeDiagnostico.conteo.ok} sólidos
                      </span>
                      <span className="rounded bg-amber-950/80 px-1.5 py-0.5 text-amber-300">
                        {informeDiagnostico.conteo.medio} medios
                      </span>
                      <span className="rounded bg-rose-950/80 px-1.5 py-0.5 text-rose-300">
                        {informeDiagnostico.conteo.alto} frágiles
                      </span>
                    </div>
                    <p className="text-[11px] leading-4 text-slate-400">
                      La auditoría corre el MISMO motor y simula fallos de campo. Escalera de degradación:{' '}
                      <span className="text-slate-200">ancla → respaldo → referencia guardada</span>. Caer un peldaño NO
                      descuadra el formato; solo <span className="text-rose-300">colapso</span> (sin nada que resolver)
                      lo rompe.
                    </p>
                    {(() => {
                      const sugerencias = informeDiagnostico.campos.filter(
                        (i) => i.respaldoSugerido && !i.tieneRespaldo,
                      );
                      if (sugerencias.length === 0) return null;
                      return (
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full border-emerald-700 text-emerald-300 hover:bg-emerald-950/60"
                          onClick={fortalecerTodo}
                        >
                          <Wand2 className="mr-2 h-4 w-4" aria-hidden />
                          Fortalecer {sugerencias.length} campo{sugerencias.length === 1 ? '' : 's'} sin respaldo
                        </Button>
                      );
                    })()}
                  </div>

                  {/* Informe por campo */}
                  <div className="max-h-[460px] space-y-2 overflow-y-auto scroll-fino pr-1">
                    {informeDiagnostico.campos.map((inf) => (
                      <div
                        key={inf.id}
                        className={`space-y-1.5 rounded-lg border p-2.5 ${
                          inf.nivel === 'alto'
                            ? 'border-rose-800 bg-rose-950/20'
                            : inf.nivel === 'medio'
                              ? 'border-amber-800 bg-amber-950/15'
                              : 'border-slate-800 bg-slate-950/50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-semibold text-slate-100">{inf.etiqueta}</span>
                          {inf.nivel === 'alto' ? (
                            <Badge className="shrink-0 bg-rose-900 text-rose-100 hover:bg-rose-900">
                              <ShieldAlert className="mr-1 h-3 w-3" aria-hidden />
                              frágil
                            </Badge>
                          ) : inf.nivel === 'medio' ? (
                            <Badge className="shrink-0 bg-amber-900 text-amber-100 hover:bg-amber-900">medio</Badge>
                          ) : (
                            <Badge className="shrink-0 bg-emerald-900 text-emerald-100 hover:bg-emerald-900">
                              <ShieldCheck className="mr-1 h-3 w-3" aria-hidden />
                              sólido
                            </Badge>
                          )}
                        </div>

                        {inf.estrategia === 'ancla_relativa' ? (
                          <>
                            {/* Escalera de degradación: ancla / respaldo / referencia */}
                            <div className="flex flex-wrap items-center gap-1 font-mono text-[10px]">
                              <span
                                className={`rounded px-1.5 py-0.5 ${
                                  inf.anclaEncontrada
                                    ? 'bg-emerald-950 text-emerald-300'
                                    : 'bg-rose-950 text-rose-300'
                                }`}
                              >
                                ancla {inf.anclaEncontrada ? 'ok' : 'ausente'}
                                {inf.anclaConf !== null ? ` · ${(inf.anclaConf * 100).toFixed(0)}%` : ''}
                                {inf.ocurrencias >= 2 ? ` · ×${inf.ocurrencias}` : ''}
                              </span>
                              <ChevronRight className="h-3 w-3 shrink-0 text-slate-600" aria-hidden />
                              <span
                                className={`rounded px-1.5 py-0.5 ${
                                  inf.simSinAncla === 'respaldo'
                                    ? 'bg-emerald-950 text-emerald-300'
                                    : inf.tieneRespaldo
                                      ? 'bg-amber-950 text-amber-300'
                                      : 'bg-slate-900 text-slate-400'
                                }`}
                              >
                                {inf.tieneRespaldo
                                  ? inf.simSinAncla === 'respaldo'
                                    ? 'respaldo actúa'
                                    : 'respaldo no actúa'
                                  : 'sin respaldo'}
                              </span>
                              <ChevronRight className="h-3 w-3 shrink-0 text-slate-600" aria-hidden />
                              <span
                                className={`rounded px-1.5 py-0.5 ${
                                  inf.simSinAnclaYRespaldo === 'referencia'
                                    ? 'bg-emerald-950 text-emerald-300'
                                    : 'bg-rose-950 text-rose-300'
                                }`}
                              >
                                {inf.simSinAnclaYRespaldo === 'referencia'
                                  ? 'referencia salvaguarda'
                                  : inf.simSinAnclaYRespaldo === 'fija'
                                    ? 'zona fija'
                                    : 'colapso'}
                              </span>
                            </div>

                            {inf.problemas.map((p) => (
                              <p key={p} className="text-[10px] leading-4 text-amber-300/90">
                                <AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden />
                                {p}
                              </p>
                            ))}

                            {inf.respaldoSugerido &&
                              !inf.tieneRespaldo &&
                              (() => {
                                const sug = inf.respaldoSugerido;
                                return (
                                  <div className="flex items-center justify-between gap-2 rounded bg-slate-900 px-2 py-1.5">
                                    <div className="min-w-0">
                                      <span className="font-mono text-[9px] uppercase tracking-widest text-slate-500">
                                        respaldo sugerido
                                      </span>
                                      <p className="truncate font-mono text-[11px] text-emerald-300">
                                        {sug.texto}{' '}
                                        <span className="text-slate-500">({(sug.conf * 100).toFixed(0)}%)</span>
                                      </p>
                                    </div>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 shrink-0 border-emerald-700 text-emerald-300 hover:bg-emerald-950/60"
                                      onClick={() => fortalecerCampo(inf.id, sug.texto)}
                                    >
                                      Usar
                                    </Button>
                                  </div>
                                );
                              })()}
                          </>
                        ) : (
                          <p className="text-[10px] text-slate-400">
                            Zona fija: no depende de OCR, se resuelve siempre con el rect del molde.
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-700 p-6 text-center text-xs text-slate-500">
                  Esta página no tiene campos que auditar. Mapea campos o cambia a una página con zonas.
                </div>
              )}
            </TabsContent>

            <TabsContent value="ocr" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden">
              {!ocrCapaVigente ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center">
                  <ScanLine className="h-8 w-8 text-teal-400" aria-hidden />
                  <p className="max-w-[240px] text-xs leading-5 text-slate-400">
                    Ejecuta la capa OCR sobre la página {pagina} para ver, buscar y mapear la estructura reconocida
                    del documento.
                  </p>
                  <Button
                    size="sm"
                    disabled={!imagenRef || ocrEstado === 'cargando'}
                    onClick={() => {
                      setVerOcr(true);
                      setMapearOcr(true);
                      void Promise.resolve().then(ejecutarOcrCapa);
                    }}
                  >
                    {ocrEstado === 'cargando' ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <ScanLine className="mr-2 h-4 w-4" aria-hidden />
                    )}
                    {ocrEstado === 'cargando' ? `Analizando… ${ocrProgreso}%` : 'Analizar página'}
                  </Button>
                  {ocrEstado === 'error' && ocrError ? (
                    <p className="max-w-[260px] font-mono text-[10px] leading-4 text-rose-400">{ocrError.slice(0, 120)}</p>
                  ) : null}
                </div>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="border-b border-slate-800 p-2">
                    <div className="relative">
                      <SearchIcon />
                      <Input
                        value={busquedaOcr}
                        onChange={(e) => setBusquedaOcr(e.target.value)}
                        placeholder="Filtrar líneas reconocidas…"
                        aria-label="Filtrar líneas OCR"
                        className="h-8 border-slate-700 bg-slate-900 pl-8 text-xs text-slate-100"
                      />
                    </div>
                    <p className="mt-1.5 px-0.5 font-mono text-[9px] text-slate-500">
                      {lineasOcrFiltradas.length === ocrCapaVigente.lines.length
                        ? `${ocrCapaVigente.lines.length} líneas`
                        : `${lineasOcrFiltradas.length} de ${ocrCapaVigente.lines.length} líneas`}
                      {ocrCapaVigente.conf !== null ? ` · conf ${(ocrCapaVigente.conf * 100).toFixed(0)}%` : ''}
                    </p>
                    {ocrExcluidasVigentes.size > 0 || nVaciasPendientes > 0 ? (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 px-0.5">
                        {ocrExcluidasVigentes.size > 0 ? (
                          <button
                            type="button"
                            onClick={restaurarLineasOcr}
                            title="Devuelve todas las líneas eliminadas a la capa OCR"
                            className="inline-flex items-center gap-1 rounded border border-teal-700/60 bg-teal-950/60 px-1.5 py-0.5 font-mono text-[9px] text-teal-300 transition hover:bg-teal-900/60"
                          >
                            <RotateCw className="h-3 w-3" aria-hidden /> Restaurar ({ocrExcluidasVigentes.size})
                          </button>
                        ) : null}
                        {nVaciasPendientes > 0 ? (
                          <button
                            type="button"
                            onClick={eliminarVaciasOcr}
                            title="Elimina de la capa todas las líneas sin texto reconocido"
                            className="inline-flex items-center gap-1 rounded border border-rose-800/60 bg-rose-950/50 px-1.5 py-0.5 font-mono text-[9px] text-rose-300 transition hover:bg-rose-900/50"
                          >
                            <Trash2 className="h-3 w-3" aria-hidden /> Quitar vacías ({nVaciasPendientes})
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="scroll-fino min-h-0 flex-1 overflow-y-auto p-1.5">
                    {lineasOcrFiltradas.length === 0 ? (
                      <p className="p-3 text-center text-xs text-slate-500">Ninguna línea coincide con la búsqueda.</p>
                    ) : (
                      <div className="space-y-1">
                        {lineasOcrFiltradas.map(({ l, i }) => {
                          const confMediaFila =
                            l.palabras.length > 0
                              ? l.palabras.reduce((acc, w) => acc + (w.conf >= 0 ? w.conf : 0), 0) / l.palabras.length
                              : null;
                          const activa = ocrDestacada === i;
                          return (
                            <div
                              key={`ocr-fila-${i}`}
                              className={`group rounded-md border px-2 py-1.5 transition ${
                                activa
                                  ? 'border-teal-500/70 bg-teal-950/40'
                                  : 'border-transparent hover:border-slate-700 hover:bg-slate-800/60'
                              }`}
                            >
                              <button
                                type="button"
                                className="block w-full text-left"
                                onClick={() => {
                                  setOcrDestacada(i);
                                  setVerOcr(true);
                                }}
                                aria-label={`Destacar la línea ${i + 1} en el lienzo`}
                              >
                                <span className="line-clamp-2 text-[11px] leading-4 text-slate-200">{l.texto}</span>
                                <span className="mt-0.5 flex items-center gap-2 font-mono text-[9px] text-slate-500">
                                  <span>#{i + 1}</span>
                                  {confMediaFila !== null ? (
                                    <span
                                      className={
                                        confMediaFila >= 0.85
                                          ? 'text-teal-400'
                                          : confMediaFila >= 0.6
                                            ? 'text-amber-400'
                                            : 'text-rose-400'
                                      }
                                    >
                                      {Math.round(confMediaFila * 100)}%
                                    </span>
                                  ) : null}
                                </span>
                              </button>
                              <div className="mt-1 flex items-center gap-0.5 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
                                <button
                                  type="button"
                                  title="Crear campo (zona fija) con el rect de esta caja"
                                  aria-label="Crear campo zona fija aquí"
                                  className="rounded p-1 text-slate-400 transition hover:bg-slate-700 hover:text-emerald-300"
                                  onClick={() => crearCampoDesdeOcr(l, 'fija')}
                                >
                                  <Plus className="h-3.5 w-3.5" aria-hidden />
                                </button>
                                <button
                                  type="button"
                                  title="Crear campo anclado a esta línea (ancla_relativa)"
                                  aria-label="Crear campo anclado aquí"
                                  className="rounded p-1 text-slate-400 transition hover:bg-slate-700 hover:text-sky-300"
                                  onClick={() => crearCampoDesdeOcr(l, 'anclada')}
                                >
                                  <Link2 className="h-3.5 w-3.5" aria-hidden />
                                </button>
                                <button
                                  type="button"
                                  title="Usar esta línea como ancla del campo activo"
                                  aria-label="Usar como ancla del campo activo"
                                  className="rounded p-1 text-slate-400 transition hover:bg-slate-700 hover:text-amber-300"
                                  onClick={() => usarLineaComoAncla(l)}
                                >
                                  <Crosshair className="h-3.5 w-3.5" aria-hidden />
                                </button>
                                <button
                                  type="button"
                                  title="Ajustar la zona del campo activo al rect de esta caja"
                                  aria-label="Ajustar zona del campo activo a esta caja"
                                  className="rounded p-1 text-slate-400 transition hover:bg-slate-700 hover:text-violet-300"
                                  onClick={() => ajustarZonaActivaAOcr(l)}
                                >
                                  <Magnet className="h-3.5 w-3.5" aria-hidden />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="border-t border-slate-800 p-2">
                    <p className="font-mono text-[9px] leading-4 text-slate-500">
                      Activa «Mapear» en la barra del lienzo para cliquear los resaltados OCR directamente. Las acciones
                      sobre el campo activo exigen que sea de esta página.
                    </p>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="layout" className="mt-0 min-h-0 flex-1 overflow-y-auto scroll-fino">
              {molde ? (
                <LayoutAssistant
                  /* Re-sincronización del borrador POR CLAVE: la key es la firma
                     del layout persistido — si el layout cambia afuera (guardar,
                     quitar, aplicar JSON) el asistente se remonta y adopta el
                     nuevo estado; un push de campos nuevos NO cambia la key y NO
                     borra el borrador en curso (prohibido setState en efectos). */
                  key={molde.layout ? JSON.stringify(molde.layout) : 'sin-layout'}
                  molde={molde}
                  imagenUrl={imagenRefVisual}
                  pagina={pagina}
                  onGuardarLayout={(layout) => {
                    // getState(): componer con el molde MÁS reciente — el asistente
                    // puede llamar onCamposNuevos + onGuardarLayout en el mismo
                    // evento y el closure `molde` quedaría desactualizado.
                    const actual = useStudio.getState().molde;
                    if (!actual) return;
                    setMoldeActual({ ...actual, layout });
                    toast({
                      title: 'Layout guardado en el molde',
                      description: `${layout.reglas.length} reglas estructurales (versión ${layout.version}). Recuerda guardar la plantilla.`,
                    });
                  }}
                  onQuitarLayout={() => {
                    const actual = useStudio.getState().molde;
                    if (!actual) return;
                    const resto = { ...actual };
                    delete resto.layout;
                    setMoldeActual(resto);
                    toast({ title: 'Layout eliminado del molde' });
                  }}
                  onCamposNuevos={(nuevos) => {
                    const actual = useStudio.getState().molde;
                    if (!actual) return;
                    setMoldeActual({ ...actual, campos: [...actual.campos, ...nuevos] });
                  }}
                />
              ) : (
                <p className="p-3 text-xs text-slate-400">Abre o crea un molde para configurar su layout estructural.</p>
              )}
            </TabsContent>

            <TabsContent value="json" className="mt-0 min-h-0 flex-1 space-y-2 overflow-y-auto scroll-fino p-3">
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 border-slate-700 bg-slate-950 text-xs text-slate-200 hover:bg-slate-800"
                  onClick={() => navigator.clipboard.writeText(jsonVivo).then(() => toast({ title: 'JSON copiado' }))}
                >
                  <Copy className="mr-1.5 h-3.5 w-3.5" /> Copiar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 border-slate-700 bg-slate-950 text-xs text-slate-200 hover:bg-slate-800"
                  onClick={descargarJson}
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" /> Descargar
                </Button>
                {/* F6: exporte con sobre + SHA-256 (Tamiz verifica al importar). */}
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full border-slate-700 bg-slate-950 text-xs text-slate-200 hover:bg-slate-800"
                  onClick={descargarJsonConChecksum}
                  disabled={!molde}
                >
                  <FileDown className="mr-1.5 h-3.5 w-3.5" /> Descargar .molde.json (con checksum)
                </Button>
              </div>
              <pre className="scroll-fino max-h-72 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-[10px] leading-relaxed text-slate-300">
                {jsonVivo}
              </pre>
              <div className="space-y-1">
                <Label htmlFor="json-aplicar" className="text-[11px] text-slate-400">Reemplazar por JSON</Label>
                <Textarea
                  id="json-aplicar"
                  className="min-h-24 border-slate-700 bg-slate-950 font-mono text-[10px] text-slate-100"
                  placeholder='{ "tipo": "universal", ... }'
                  value={jsonAplicar}
                  onChange={(e) => setJsonAplicar(e.target.value)}
                />
                <Button
                  size="sm"
                  className="w-full bg-indigo-600 text-xs hover:bg-indigo-700"
                  onClick={aplicarJson}
                  disabled={!jsonAplicar.trim()}
                >
                  <ScanLine className="mr-1.5 h-3.5 w-3.5" /> Aplicar al editor
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </aside>
      </div>

      {/* Diálogo: revisión de la tabla detectada antes de generar campos.
          Textos editables (anclas/etiquetas), renglones y columnas
          excluibles con checkbox; opciones de generación arriba. */}
      <Dialog
        open={tablaDialog !== null}
        onOpenChange={(v) => {
          if (!v) {
            setTablaDialog(null);
            setTablaDetectada(null);
          }
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Tabla detectada — revisa antes de generar</DialogTitle>
            <DialogDescription>
              {tablaDetectada
                ? `${tablaDetectada.filas.length} renglón(es) × ${tablaDetectada.filas[0]?.length ?? 0} columna(s) · ${tablaDetectada.nLineas} líneas OCR${tablaDetectada.truncada ? ' · RENGLONES RECORTADOS (límite 40)' : ''}. `
                : ''}
              Los textos son editables: corrige lo que el OCR haya leído mal — se usan para anclas y etiquetas.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 py-1 text-xs">
            <div className="flex items-center gap-2">
              <Switch
                id="tabla-encabezado"
                checked={tablaOpts.encabezado}
                onCheckedChange={(v) => setTablaOpts((o) => ({ ...o, encabezado: Boolean(v) }))}
              />
              <Label htmlFor="tabla-encabezado" className="text-[11px] text-slate-300">
                Fila 1 = encabezado
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="tabla-anclar"
                checked={tablaOpts.anclar}
                onCheckedChange={(v) => setTablaOpts((o) => ({ ...o, anclar: Boolean(v) }))}
              />
              <Label htmlFor="tabla-anclar" className="text-[11px] text-slate-300">
                Anclar cada fila a su etiqueta
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="tabla-digitos"
                checked={tablaOpts.digitos}
                disabled={tablaOpts.tipoCelda !== 'texto'}
                onCheckedChange={(v) => setTablaOpts((o) => ({ ...o, digitos: Boolean(v) }))}
              />
              <Label htmlFor="tabla-digitos" className="text-[11px] text-slate-300">
                Solo dígitos
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-400">Tipo de celda:</span>
              <Select
                value={tablaOpts.tipoCelda}
                onValueChange={(v) => setTablaOpts((o) => ({ ...o, tipoCelda: v as TipoCampo }))}
              >
                <SelectTrigger
                  className="h-7 w-32 border-slate-700 bg-slate-950 text-[11px] text-slate-200"
                  aria-label="Tipo de celda de la tabla"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="texto">Texto / dígitos</SelectItem>
                  <SelectItem value="checkbox">Checkbox OMR</SelectItem>
                  <SelectItem value="presencia">Presencia / sello</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="tabla-prefijo" className="text-[11px] text-slate-400">
                Prefijo:
              </Label>
              <Input
                id="tabla-prefijo"
                value={tablaOpts.prefijo}
                onChange={(e) => setTablaOpts((o) => ({ ...o, prefijo: e.target.value }))}
                className="h-7 w-24 border-slate-700 bg-slate-950 text-[11px] text-slate-200"
              />
            </div>
          </div>
          <div className="scroll-fino max-h-72 overflow-auto rounded-lg border border-slate-800">
            {tablaDialog && tablaDetectada ? (
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="sticky top-0 z-10 bg-slate-900">
                    <th className="w-8 border-b border-slate-800 px-1 py-1">
                      <span className="sr-only">Incluir renglón</span>
                    </th>
                    {tablaDialog.colsOn.map((on, c) => (
                      <th key={`tc-${c}`} className="border-b border-slate-800 px-1 py-1 text-left">
                        <label className="flex items-center gap-1 font-mono text-[9px] font-semibold text-slate-400">
                          <Checkbox
                            checked={on}
                            onCheckedChange={(v) =>
                              setTablaDialog((d) =>
                                d ? { ...d, colsOn: d.colsOn.map((x, i) => (i === c ? Boolean(v) : x)) } : d,
                              )
                            }
                            aria-label={`Incluir columna ${c + 1}`}
                            className="h-3 w-3"
                          />
                          C{c + 1}
                        </label>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tablaDetectada.filas.map((_, f) => {
                    const esHeader = tablaOpts.encabezado && f === 0;
                    return (
                      <tr key={`tf-${f}`} className={esHeader ? 'bg-amber-950/30' : 'odd:bg-slate-950/60'}>
                        <td className="border-b border-slate-900 px-1 py-0.5 align-middle">
                          <Checkbox
                            checked={tablaDialog.filasOn[f]}
                            disabled={esHeader}
                            onCheckedChange={(v) =>
                              setTablaDialog((d) =>
                                d ? { ...d, filasOn: d.filasOn.map((x, i) => (i === f ? Boolean(v) : x)) } : d,
                              )
                            }
                            aria-label={`Incluir renglón ${f + 1}`}
                            className="h-3 w-3"
                          />
                        </td>
                        {tablaDialog.textos[f].map((tx, c) => (
                          <td key={`tf-${f}c-${c}`} className="border-b border-slate-900 px-0.5 py-0.5">
                            <Input
                              value={tx}
                              onChange={(e) =>
                                setTablaDialog((d) =>
                                  d
                                    ? {
                                        ...d,
                                        textos: d.textos.map((rf, i) =>
                                          i === f ? rf.map((xc, j) => (j === c ? e.target.value : xc)) : rf,
                                        ),
                                      }
                                    : d,
                                )
                              }
                              aria-label={`Celda renglón ${f + 1} columna ${c + 1}`}
                              className={`h-6 border-slate-800 bg-slate-950 px-1.5 font-mono text-[10px] text-slate-200 ${
                                esHeader ? 'font-semibold text-amber-300' : ''
                              }`}
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setTablaDialog(null);
                setTablaDetectada(null);
              }}
            >
              Cancelar
            </Button>
            <Button onClick={generarCamposTabla} disabled={!tablaDetectada} className="bg-teal-600 text-white hover:bg-teal-500">
              <Table className="mr-1.5 h-4 w-4" aria-hidden /> Generar campos de tabla
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}
