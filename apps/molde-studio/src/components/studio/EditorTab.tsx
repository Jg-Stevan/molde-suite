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
import {
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  Copy,
  Crosshair,
  Download,
  Eye,
  EyeOff,
  FileUp,
  GripVertical,
  Link2,
  Loader2,
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
  SquareDashedMousePointer,
  Trash2,
} from 'lucide-react';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { alinearAnclas, rectEditor, sugerirUmbralClustering } from '@/lib/molde/universal-engine';
import type { LineaOcr } from '@/lib/molde/types';
import { ocrLines, setOcrProgress } from '@/lib/ocr/ocr-client';
import { escalarCanvas, renderDocumento } from '@/lib/ocr/pdf-client';
import {
  MOLDE_UNIVERSAL_VERSION,
  erroresMolde,
  esMoldeUniversal,
  hexTipo,
  nuevoIdCampo,
  type CampoUniversal,
  type MoldeUniversal,
  type RectNorm,
  type ResultadoUniversal,
  type TipoCampo,
} from '@/lib/molde/universal-types';
import { repo, useUrlResuelta } from '@/lib/repo';
import { useStudio } from '@/lib/studio-store';

const CLAMP = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));

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
      tabIndex={0}
      aria-label={`Zona ${etiqueta}`}
      className={`absolute cursor-move border-2 transition-shadow ${activo ? 'z-10 shadow-[0_0_0_2px_rgba(255,255,255,0.85),0_0_18px_rgba(99,102,241,0.65)]' : 'opacity-85'}`}
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
  // pipeline que usa "Alinear anclas") y pinta cada línea/palabra reconocida
  // como caja con su texto sobre el lienzo: feedback visual de QUÉ ve el OCR y
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
  const [ocultos, setOcultos] = useState<Set<string>>(new Set());
  const [coordenadas, setCoordenadas] = useState<{ x: number; y: number } | null>(null);
  const [cropPreview, setCropPreview] = useState<string | null>(null);
  const [cropDims, setCropDims] = useState<{ w: number; h: number } | null>(null);
  const contenedorRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ campoId: string; modo: 'mover' | 'redimensionar'; x0: number; y0: number; zona0: RectNorm } | null>(null);
  const inputImagenRef = useRef<HTMLInputElement>(null);

  const moldeDB = moldes.find((m) => m.id === moldeId);
  const sucio = useMemo(
    () => Boolean(molde && moldeDB && JSON.stringify(molde) !== moldeDB.json),
    [molde, moldeDB],
  );

  const paginas = useMemo(() => {
    if (!molde) return [1];
    const set = new Set(molde.campos.map((c) => c.pagina));
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
    // react-hooks/set-state-in-effect: nunca setState síncrono en el efecto).
    void Promise.resolve().then(recortarPreview);
  }, [recortarPreview]);

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
  // (canvasDe ya aplica escalarCanvas), así que las cajas del overlay coinciden
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
      setOcrEstado('listo');
      setOcrProgreso(100);
      toast({
        title: `Capa OCR: ${lines.length} línea${lines.length === 1 ? '' : 's'} reconocidas`,
        description:
          conf !== null
            ? `Confianza media ${(conf * 100).toFixed(0)}% · ${Math.round(performance.now() - t0)} ms. Las cajas son lo que el OCR ve en esta página.`
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

  function nuevoCampo(estrategia: 'zona_fija' | 'ancla_relativa') {
    if (!molde) return;
    const c: CampoUniversal = {
      id: nuevoIdCampo(),
      etiqueta: `Nuevo campo ${molde.campos.length + 1}`,
      pagina,
      tipo: 'presencia',
      estrategia,
      zona: estrategia === 'zona_fija' ? { x: 0.35, y: 0.4, w: 0.25, h: 0.04 } : { x: 0.1, y: 0.02, w: 0.2, h: 0.04 },
      ancla: estrategia === 'ancla_relativa' ? { texto: '' } : undefined,
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

  function duplicarCampo(id: string) {
    if (!molde) return;
    const c = molde.campos.find((x) => x.id === id);
    if (!c) return;
    const copia: CampoUniversal = { ...c, id: nuevoIdCampo(), etiqueta: `${c.etiqueta} (copia)` };
    setMoldeActual({ ...molde, campos: [...molde.campos, copia] });
    setCampoSeleccionado(copia.id);
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
  async function subirImagen(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f || !molde) return;
    // Fase 3.2 (G-12): aceptar también PDF como referencia — se rasteriza la
    // página actual a PNG antes de subirla, así el editor siempre trabaja con imagen.
    let archivo: File = f;
    if (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')) {
      setSubiendo(true);
      try {
        const doc = await renderDocumento(f);
        const paginaIdx = Math.min(pagina - 1, doc.canvases.length - 1);
        const canvas = doc.canvases[paginaIdx];
        const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
        if (!blob) throw new Error('No se pudo rasterizar el PDF');
        archivo = new File([blob], `${f.name.replace(/\.pdf$/i, '')}-p${paginaIdx + 1}.png`, { type: 'image/png' });
      } catch (err) {
        toast({ title: 'Error al procesar el PDF', description: (err as Error).message, variant: 'destructive' });
        return;
      } finally {
        setSubiendo(false);
      }
    } else if (f.type && !/^image\/(png|jpe?g|webp|heic|heif)$/.test(f.type)) {
      // Fase 3.2 (N-13): rechazo explícito, nunca silencioso.
      toast({ title: 'Formato no soportado', description: `${f.name} (${f.type}) — usa PNG, JPEG, WebP, HEIC o PDF.`, variant: 'destructive' });
      return;
    }
    setSubiendo(true);
    try {
      const subida = await repo.subirArchivo(archivo, archivo.name);
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
              <DropdownMenuContent align="start" className="w-44">
                <DropdownMenuItem onClick={() => nuevoCampo('zona_fija')}>
                  <Plus className="mr-2 h-3.5 w-3.5 text-slate-400" /> Zona fija
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => nuevoCampo('ancla_relativa')}>
                  <Crosshair className="mr-2 h-3.5 w-3.5 text-amber-400" /> Con ancla OCR
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
                title="Superpone sobre el escaneo lo que el OCR reconoce: cajas por línea/palabra con su texto y confianza"
              >
                <Checkbox
                  checked={verOcr}
                  onCheckedChange={(v) => setVerOcr(Boolean(v))}
                  aria-label="Ver capa OCR"
                  className="border-slate-600 data-[state=checked]:bg-teal-600 data-[state=checked]:border-teal-500"
                />
                Capa OCR
              </label>
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
              <Select value={String(pagina)} onValueChange={(v) => setPagina(Number(v))}>
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
            onClick={() => seleccionarCampo(null)}
          >
            <div
              ref={contenedorRef}
              className="relative select-none self-start shadow-[0_8px_30px_rgba(0,0,0,0.5)]"
              style={{ width: `${zoom}%`, maxWidth: 680 }}
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

              {/* Capa OCR — overlay con lo que el OCR reconoció en ESTA página.
                  Cajas de línea (borde teal + etiqueta con texto y confianza)
                  y sub-cajas por palabra (relleno tenue). Colores por confianza:
                  ≥85% teal · 60–85% ámbar · <60% rosa. Solo se pinta cuando el
                  resultado cacheado corresponde a la página/referencia actual. */}
              {verOcr && imagenRef && ocrEstado === 'listo' && ocrCapa && ocrCapa.key === ocrCapaKey
                ? ocrCapa.lines.map((l, i) => {
                    const [lx0, ly0, lx1, ly1] = l.bbox;
                    const confMedia =
                      l.palabras.length > 0
                        ? l.palabras.reduce((acc, w) => acc + (w.conf >= 0 ? w.conf : 0), 0) / l.palabras.length
                        : null;
                    const colorL = confMedia === null ? '#2dd4bf' : confMedia >= 0.85 ? '#2dd4bf' : confMedia >= 0.6 ? '#fbbf24' : '#fb7185';
                    return (
                      <div
                        key={`ocr-l-${i}`}
                        aria-hidden
                        className="pointer-events-none absolute z-[2]"
                        style={{
                          left: `${(lx0 / ocrCapa.dims.w) * 100}%`,
                          top: `${(ly0 / ocrCapa.dims.h) * 100}%`,
                          width: `${((lx1 - lx0) / ocrCapa.dims.w) * 100}%`,
                          height: `${((ly1 - ly0) / ocrCapa.dims.h) * 100}%`,
                          border: '1px solid',
                          borderColor: colorL,
                          backgroundColor: `${colorL}1a`,
                        }}
                      >
                        {verOcr && ocrCapa.lines.length <= 60 ? (
                          <span
                            className="absolute -top-[11px] left-0 flex max-w-full items-center gap-1 whitespace-nowrap rounded-sm px-1 font-mono text-[8px] font-semibold leading-[11px] text-slate-950"
                            style={{ backgroundColor: colorL }}
                          >
                            <span className="max-w-[280px] truncate">{l.texto}</span>
                            {confMedia !== null ? <span className="opacity-70">{Math.round(confMedia * 100)}%</span> : null}
                          </span>
                        ) : null}
                        {l.palabras.map((w, j) => {
                          const [wx0, wy0, wx1, wy1] = w.bbox;
                          const colorW = w.conf >= 0 && w.conf < 0.6 ? '#fb7185' : colorL;
                          return (
                            <span
                              key={`ocr-w-${i}-${j}`}
                              className="absolute"
                              style={{
                                left: `${((wx0 - lx0) / (lx1 - lx0 || 1)) * 100}%`,
                                top: `${((wy0 - ly0) / (ly1 - ly0 || 1)) * 100}%`,
                                width: `${((wx1 - wx0) / (lx1 - lx0 || 1)) * 100}%`,
                                height: `${((wy1 - wy0) / (ly1 - ly0 || 1)) * 100}%`,
                                backgroundColor: `${colorW}30`,
                                boxShadow: `inset 0 0 0 1px ${colorW}55`,
                              }}
                            />
                          );
                        })}
                      </div>
                    );
                  })
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
                    {ocrCapa.conf !== null ? ` · conf ${(ocrCapa.conf * 100).toFixed(0)}%` : ''}
                    {` · ${ocrCapa.ms} ms`}
                  </span>
                ) : ocrEstado === 'error' ? (
                  <span className="inline-flex items-center gap-1.5 text-rose-400">
                    <AlertTriangle className="h-3 w-3" aria-hidden /> OCR: error
                  </span>
                ) : null
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
          <Tabs defaultValue="propiedades" className="flex min-h-0 flex-1 flex-col gap-0">
            <div className="border-b border-slate-800 p-2">
              <TabsList className="grid w-full grid-cols-2 bg-slate-950">
                <TabsTrigger value="propiedades" className="font-mono text-[11px] data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
                  Propiedades
                </TabsTrigger>
                <TabsTrigger value="json" className="font-mono text-[11px] data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
                  JSON en vivo
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

                  <Accordion type="multiple" defaultValue={['general']} className="space-y-2">
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
                              onValueChange={(v) =>
                                actualizarCampo(campoSel.id, {
                                  estrategia: v as 'zona_fija' | 'ancla_relativa',
                                  ancla: v === 'ancla_relativa' ? campoSel.ancla ?? { texto: '' } : campoSel.ancla,
                                })
                              }
                            >
                              <SelectTrigger className="h-8 border-slate-700 bg-slate-900 font-mono text-xs text-slate-100">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="zona_fija">zona_fija</SelectItem>
                                <SelectItem value="ancla_relativa">ancla_relativa</SelectItem>
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
                    {campoSel.estrategia === 'ancla_relativa' ? (
                      <AccordionItem value="anclas" className="rounded-lg border border-amber-600/50 bg-amber-950/10 px-3">
                        <AccordionTrigger className="py-2.5 font-mono text-[11px] font-bold uppercase tracking-wider text-amber-300 hover:no-underline">
                          <span className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full bg-amber-500 ring-2 ring-amber-400/40" aria-hidden />
                            Anclas OCR (Relativa)
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

                    {/* Coordenadas */}
                    <AccordionItem value="coords" className="rounded-lg border border-slate-800 bg-slate-950/60 px-3">
                      <AccordionTrigger className="py-2.5 font-mono text-[11px] font-bold uppercase tracking-wider text-slate-200 hover:no-underline">
                        Coordenadas Normalizadas
                      </AccordionTrigger>
                      <AccordionContent className="space-y-2 pb-3">
                        <p className="text-[10px] text-slate-500">
                          {campoSel.estrategia === 'ancla_relativa'
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
