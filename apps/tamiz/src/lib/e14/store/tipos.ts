/**
 * R-27 (H-17, auditoría 2026-11-16) — CONTRATO compartido de la tienda e14.
 * La ex tienda-dios `src/lib/e14/store.ts` quedó partida en slices de dominio
 * (`src/lib/e14/store/*.ts`); ESTE módulo es la única fuente de la forma del
 * estado: la interfaz completa (campos + acciones, con su documentación) y
 * los tipos que cruzan slices (Vista, ActaArchivada, PuestoActual) o que la
 * fachada re-exporta a los consumidores.
 * Toda la data nace del bridge (D1) — las vistas nunca tocan el bridge
 * directamente. STITCH REDESIGN (SPEC-e14-redesign-stitch §4/D2): el sistema
 * de notificaciones flotantes queda ELIMINADO (estado + acción + call-sites).
 * El feedback vive en la UI persistente de estado (píldoras, nube, bloque
 * ENVIADO, franja del visor, feedback en botón).
 */
import type { StoreApi } from "zustand";
import type { PaginaObjetivo } from "@molde-suite/scanner-core/dominio/bridge";
import type { Acta, FuenteCaptura, HistorialRow, Mesa, ProgresoAnalisis, TipoPagina } from "@molde-suite/scanner-core/dominio/types";
import type { PageFilter, Quad } from "@molde-suite/scanner-core/core/types";
import type { ClasificacionE14 } from "@molde-suite/scanner-core/dominio/clasificador";
import type { AvisoOperador, MotivoOperador } from "../errores";
import type { ImagenSimuladaId } from "../simulacion-imagenes";

// NOTA (eliminación del módulo masiva): la vista "masiva" salió de la unión
// junto con la cola/bandeja (src/lib/e14/masiva/ y MasivaView retirados).
export type Vista = "escanear" | "analizando" | "revision" | "actas" | "resumen";

/** KIT e14-simulacion-imagenes-v1: opciones de simulación por imagen.
 *  SOLO store↔dispararEscaneo; el bridge resuelve el File por
 *  `imagenSimulada`. NO lleva score ni atajos: el pipeline es el MISMO de
 *  IMPORTAR. */
// knip C3: de-export — uso SOLO interno (dispararEscaneo/simularImagen).
interface OpcionesSimEscaneo {
  imagenSimulada: ImagenSimuladaId;
}

export interface E14Store {
  vista: Vista;
  /** MOCK 2026-11-16 (escaneo libre y limpio): última vista APP visitada
   *  antes de la actual — destino del botón VOLVER del visor (el escáner
   *  es una pantalla inmersiva sin nav inferior; «Volver» regresa a
   *  HISTORIAL o PLANTILLAS, jamás a analizando/revision). `null` = sin
   *  historial todavía (arranque fresco) → el botón cae a «actas». */
  vistaPrevia: Vista | null;
  /** Destello blanco de captura (~320 ms). Vive en el SHELL, no en ScanView:
   *  así sobrevive al cambio de vista y ANALIZANDO puede entrar en el mismo
   *  instante de la vibración (antes eran 260 ms de preview congelado). */
  destelloKey: number;
  online: boolean;
  actaActual: Acta | null;
  /** Página de mesa apuntada por el escaneo en curso (D7). */
  paginaObjetivo: PaginaObjetivo | null;
  /** Fuente de captura del próximo escaneo (D35: SIMULACIÓN = pipeline real). */
  fuente: FuenteCaptura;
  /** Archivo elegido para la fuente ARCHIVO (L2 lo consume). */
  archivoPendiente: File | null;
  /** KIT e14-remediacion-movil-v1 (D4 — P2 #24): bandera SÍNCRONA del
   *  IMPORTAR — nace en el `onChange` del input file (el procesamiento del
   *  archivo es async ~1-2 s antes de setArchivoPendiente) y BLOQUEA el
   *  disparo automático de la cámara mientras vuela. Si el disparo automático
   *  ya ocurrió, el operador ve el aviso explícito (cero descartes
   *  silenciosos — el archivo importado se perdía sin avisar). */
  importPendiente: boolean;
  /** Video vivo de la fuente CÁMARA (L3: grab del frame si el disparo no trae foto). */
  framePendiente: HTMLVideoElement | null;
  /** Último evento de progreso del pipeline (alimenta ANALIZANDO, §7.2). */
  progresoAnalisis: ProgresoAnalisis | null;
  /** true cuando el pipeline resolvió (piso escénico D16 de ANALIZANDO). */
  analisisResuelto: boolean;
  /** L5 §7.5: true mientras el bridge re-corre el pipeline del RECORTE. */
  recortando: boolean;
  /** KIT e14-recorte-manual-v1 (T2): aviso visible cuando el pipeline del
   *  recorte FALLA (error duro — el catch silencioso se acabó). El catch
   *  sólo avisa: no cambia el gate ni el score. `null` = sin error; se
   *  limpia al iniciar un recorte y a los ~6 s (píldora en REVISIÓN). */
  errorRecorte: string | null;
  /** F2 §F2.2: true mientras el bridge re-procesa la foto con un filtro. */
  revelando: boolean;
  actasSesion: number;
  /** Bloque 2.6 — libro de SESIÓN para la exportación PDF (JPEG 1280 por
   *  documento, tope FIFO 30 — memoria acotada; NUNCA dataURLs de 12 MP). */
  pdfLibro: PdfLibroEntry[];
  mesas: Mesa[];
  /** Fase B (§6): archivado «dónde va» — clasificaciones guardadas por
   *  clave de mesa real; la vista ACTAS las añade al seed (modo demo). */
  archivadas: Record<string, ActaArchivada>;
  /** Regla del mantenedor «solo un puesto debe de aparecer»: el puesto de la
   *  ÚLTIMA clasificación archivada. ACTAS y RESUMEN renderizan SOLO este
   *  puesto; al escanear otro puesto se reemplaza completo. */
  puestoActual: PuestoActual | null;
  /** MODO SIMULACIÓN: toggle que llena la vista con el puesto demo (seed
   *  §6.4) cuando NO hay puesto real — overlay de VISTA, jamás escribe en
   *  `archivadas`/`puestoActual` (cero contaminación de datos reales). */
  modoSimulacion: boolean;
  /** KIT actas-vivas-paginas-v1 (FASE A): true cuando el guion del SIM quedó
   *  completo (todas las páginas OK) — detiene el tick de 5 s en ACTAS. */
  simCompleta: boolean;
  /** KIT actas-vivas-paginas-v1 (FASE A): último acta «subida» por el tick,
   *  p. ej. «MESA 02 · TRANSMISIÓN P1 ✓» (feedback bajo MESAS SIMULADAS). */
  simUltima: string | null;
  completadas: number;
  asignadasHoy: number;
  colaOffline: number;
  solicitudesRescaneo: number;
  historial: HistorialRow[];
  /** KIT e14-optimizacion-v1 (T5): contador en memoria de sesión «por qué
   *  no se envió» — espejo PASIVO de desenlaces YA ocurridos. Sin
   *  persistencia (igual que historial): se resetea al recargar. Claves:
   *  advertencia:<techo> · revision:clasif-<nivel> · rechazo:<tipo>. */
  motivosNoEnvio: Record<string, number>;

  navegar: (vista: Vista) => void;
  /** MODO SIMULACIÓN (regla del mantenedor): alterna el toggle «SIM» de ACTAS.
   *  KIT actas-vivas-paginas-v1 (FASE A): ENCENDER entrega guion FRESCO
   *  (seed nuevo + SIM reiniciado); APAGAR solo apaga. */
  alternarModoSimulacion: () => void;
  /** KIT actas-vivas-paginas-v1 (FASE A): un tick del SIM VIVO — «sube» un
   *  acta al guion demo (marca la próxima página como OK cada 5 s). Overlay
   *  de VISTA (D6 INTOCABLE): SOLO escribe mesas/simUltima/simCompleta,
   *  JAMÁS archivadas/puestoActual/historial/completadas/actasSesion. */
  avanzarSimulacion: () => void;
  setFuente: (fuente: FuenteCaptura) => void;
  setArchivoPendiente: (archivo: File | null) => void;
  /** KIT e14-remediacion-movil-v1 (D4): setea/limpia la bandera síncrona del
   *  IMPORTAR (llamar SIEMPRE en el onChange, antes de cualquier await). */
  setImportPendiente: (v: boolean) => void;
  /** Registra el <video> vivo de la cámara (null al detener el stream). */
  setFramePendiente: (frame: HTMLVideoElement | null) => void;
  alternarConexion: () => void;
  /** §7 (SPEC-rediseno-revision): sin `intento` explícito, una captura
   *  CONTINÚA el ciclo de repetición si el acta previa sigue sin resolver
   *  (RECHAZADA o EN_REVISION_HUMANA «repetir-primero») — el contador cuenta
   *  CAPTURAS; ciclo nuevo (ENVIADA/OPTIMA/ADVERTENCIA/agotada) → 1.
   *  KIT e14-simulacion-imagenes-v1: `sim` presente SOLO cuando el disparo
   *  viene de la galería (simularImagen) — enruta el MISMO camino con fuente
   *  SIMULACION + imagen elegida; los guards de ARCHIVO/CAMARA no aplican y
   *  no consume archivoPendiente/framePendiente. */
  dispararEscaneo: (intento?: number, sim?: OpcionesSimEscaneo) => Promise<void>;
  /** Destello de captura del shell (key nueva = animación desde cero). */
  destellar: () => void;
  /** KIT e14-simulacion-imagenes-v1: dispara el MISMO camino de
   *  dispararEscaneo (REVISIÓN, banner, toast y ACTAS idénticos) con la
   *  fuente SIMULACION y la imagen elegida en la galería (catálogo en
   *  ./simulacion-imagenes). El pipeline corre EXACTAMENTE como «Importar»
   *  (orientación, completitud, esquinas, OCR y gate reales); el desenlace lo
   *  decide `evaluarGate` con el score medido, nunca inyectado. */
  simularImagen: (id: ImagenSimuladaId) => void;
  analisisCompletado: () => Promise<void>;
  /** e67-watchdog-rescate-v1 (cambio B): rescate post-timeout del flujo
   *  INDIVIDUAL — el pipeline siguió vivo tras vencer el watchdog y terminó
   *  con un desenlace REAL (el bridge lo entrega vía onRescateTardio). Si
   *  es válido (OPTIMA/ADVERTENCIA — el gate ya decidió dentro del
   *  pipeline) y la vista sigue en EL MISMO acta rechazada (guarda de
   *  identidad por referencia — espejo mejorarFotoActa), revierte el
   *  rechazo: actaActual ← rescatada, deshace el RESCANEO_REQUERIDO que
   *  analisisCompletado estampó y corre el desenlace POR LA MISMA RUTA del
   *  flujo normal (analisisCompletado — D4 auto-envío incluido). Casos
   *  inválidos/tardíos quedan RECHAZADA (correcto — kit §criterios C). */
  rescatarActaPostTimeout: (vencida: Acta, real: Acta, tiempoRealMs: number) => void;
  enviarActa: () => Promise<void>;
  repetirFoto: () => void;
  /** D6-bis (SPEC-rediseno-chrome-3-estados Rev. 3): escalación MANUAL a
   *  revisión humana — el botón «REVISIÓN HUMANA» (solo ADVERTENCIA/RECHAZADA,
   *  habilitado tras rechazos repetidos) entrega el acta al sabor contingencia
   *  EXACTO del camino automático (§7.5): status EN_REVISION_HUMANA +
   *  intento = maxIntentos (cede el ciclo) + fila de historial + toast.
   *  Sin re-escaneo: NO pasa por el gate ni por el pipeline. */
  escalarRevisionHumana: () => void;
  /**
   * Panel de corrección (SPEC-cabecera-clasificacion §5): persiste la
   * ubicación corregida por el operador como nivel AUTO-manual, archiva su
   * hueco (Fase B §6, con aviso §G.4.1 si duplicado) y pasa al flujo normal
   * de envío (ADVERTENCIA-equivalente).
   */
  guardarUbicacion: (clasificacion: ClasificacionE14) => void;
  /**
   * L5 §7.5 (rescate D20): aplica el recorte manual del QuadEditor —
   * bridge.recortar re-ejecuta el pipeline con el quad manual (F5-MANUAL) y
   * NO consume intento. F4/D37: `rotacionNueva` hornea la rotación LOCAL
   * del editor (undefined = conserva acta.rotation). Toast según resultado.
   * KIT e14-recorte-manual-v1 (T2): devuelve `true` si el recorte RESOLVIÓ
   * (éxito o timeout-controlado — el acta se actualizó) y `false` en error
   * duro (el editor NO se cierra — REVISIÓN pinta `errorRecorte`).
   */
  aplicarRecorte: (quad: Quad, rotacionNueva?: number) => Promise<boolean>;
  /**
   * F2 (§F2.2, D36): cambia el filtro del acta — bridge.revelar re-procesa
   * la foto (SOLO processImage, sin re-OCR/re-calidad — igual que
   * setFilterOnPage del core) y el toast copia el texto del lab (L1214-1218).
   */
  cambiarFiltro: (filtro: PageFilter) => Promise<void>;
  /**
   * F-OCR del lab (EditorView.tsx L1360-1395, D39): re-reconoce el texto del
   * acta sobre la PROCESADA y lo guarda. Toaster = copia de los toasts del lab
   * (títulos en mayúsculas = estilo de toasts e14, descripciones verbatim).
   */
  reconocerTextoActa: () => Promise<void>;
  /** Contador «por qué no se envió» (extraído de analisisCompletado —
   *  kit e14-optimizacion-v1 T5 A2): MISMAS claves, mismo Set anti-dup por
   *  id, mismo incremento. Lo llama el flujo normal (analisisCompletado). */
  contarMotivoNoEnvioActa: (acta: Acta) => void;
  /** KIT errores-operador-v1 (plan 3.1 — U1/C5): aviso PERSISTENTE del visor.
   *  Lo setean el catch de dispararEscaneo, la cuota IDB (6.10-parte) y la
   *  reanudación de cámara fallida (3.3). Los de tipo "error" NO se
   *  autodestruyen (bloque 4.3.1): salen por Reintentar o descartar. */
  avisoVisor: AvisoOperador | null;
  /** Monta el aviso del visor (ts lo estampa el store). */
  mostrarAvisoVisor: (aviso: {
    tipo: AvisoOperador["tipo"];
    motivo: MotivoOperador;
    accion: AvisoOperador["accion"];
  }) => void;
  /** Descarta el aviso del visor (botón × de la franja). */
  descartarAvisoVisor: () => void;
  /** KIT e14-remediacion-movil-v1 (A4 + H3): la auto-captura quedó
   *  DESARMADA tras un fallo de sesión OCR (fin del bucle condenado de
   *  ~6 s). Persiste al remontar ScanView y NO la deshace el re-arme D9 al
   *  reabrir la cámara — era justo lo que reconstruía el bucle condenado
   *  tras un bad_alloc. Muere con la página o cuando el operador la
   *  reactiva a mano. */
  autoCapturaDesarmada: boolean;
  /** Reactiva/desarma la auto-captura (toggle del operador o desarme A4). */
  setAutoCapturaDesarmada: (v: boolean) => void;
  /** true mientras el pipeline del bridge sigue vivo, aunque la vista ya
   *  haya vuelto a "escanear" (interrupción). La auto-captura no dispara
   *  mientras esté vivo: el disparo NUEVO quedaría compitiendo por el wasm
   *  con el viejo (H2 de la auditoría de A3). */
  analisisEnVuelo: boolean;
  /** Ola 3.2 (U4 — plan 3.2): salida del ANALIZANDO estancado. Marca el
   *  desenlace como RECHAZADA/CANCELADA (fila de historial RESCANEO_REQUERIDO
   *  con la nota «— CANCELADA POR EL OPERADOR» + contador de motivos), limpia
   *  el slot de análisis y vuelve a "escanear" SIN recargar ni perder la
   *  jornada. El desenlace tardío del pipeline en vuelo se descarta (la
   *  cancelación dirigida a su generación) — sin acta fantasma ni rescate
   *  del watchdog. */
  cancelarAnalisis: () => void;
  /** KIT e14-remediacion-movil-v1 (A3 — P0 #4): el análisis fue INTERRUMPIDO
   *  por el ocultamiento de la app (visibilitychange → hidden con
   *  vista === "analizando" — lo llama AnalyzingView). Desenlace EXPLÍCITO:
   *  fila de historial «— INTERRUMPIDA» + aviso del visor + bandera de
   *  cancelación con motivo "interrumpida" (un desenlace tardío VÁLIDO se
   *  adopta — el rescate e67 manda). Jamás RECHAZADA 0.0 silenciosa. */
  interrumpirAnalisis: () => void;
  /**
   * KIT camara-visor-v1 (G3 — upgrade silencioso del lab L1789-1842):
   * re-procesa el acta con la foto FULL-RES del sensor que aterrizó en
   * segundo plano tras el disparo rápido por escalera (bridge.mejorarResolucion
   *  — re-proceso sin consumir intento, quad re-detectado, gate completo).
   * Guardas de identidad del lab: `objetivo` es la referencia EXACTA del acta
   * que creó este disparo (capturada por ScanView al resolver dispararEscaneo)
   * — si el usuario re-disparó o editó (actaActual ≠ objetivo) el upgrade se
   * descarta en silencio; nunca toca un acta ya ENVIADA ni corre junto a un
   * recorte en vuelo (el rescate del editor manda). Si el re-proceso da
   * OPTIMA se auto-envía con el MISMO camino de aplicarRecorte (gate-v2 G4).
   */
  mejorarFotoActa: (fotoNueva: string, objetivo: Acta) => Promise<void>;
  /**
   * L5 §7 ReviewView: gira fotoProcesada 90° (rotateProcessedDataUrl del lab,
   * canvas puro) y hornea rotation para el PDF §6. Gate: foto (D35 — la
   * SIMULACIÓN también rota real).
   */
  rotarFoto: () => Promise<void>;
  /** KIT L6: restaura la jornada persistida al arrancar (llamado UNA vez
   *  desde el shell) — estado liviano + mesas reales derivadas + acta en
   *  revisión si quedó una a medias. Idempotente; sin registro → arranque
   *  fresco (seed demo, como hoy). */
  arrancarJornada: () => Promise<void>;
  /** KIT L6: REINICIAR JORNADA — borra TODO el turno (mesas archivadas,
   *  historial, contadores, motivos) + la cola MASIVA + el acta en
   *  revisión, y deja la app como recién instalada (nuevo día de
   *  votación). La confirmación de 2 toques vive en la UI (RESUMEN). */
  reiniciarJornada: () => Promise<void>;
}

/** Hueco archivado de una mesa real (§6: cuerpo DELEGADOS|TRANSMISIÓN × pág 1/2).
 *  KIT actas-vivas-paginas-v1 (FASE C): `estado` — OK (acta limpia) o
 *  RESCANEO (la captura archivada llegó ADVERTENCIA: ⚠ en ACTAS, cuenta
 *  como no-OK y deja la mesa EN PROCESO invitando al re-escaneo; el
 *  re-archivo del mismo hueco lo sube a OK — la más reciente manda). */
// knip C3: de-export — uso SOLO interno al particionado del store
// (tipos.ActaArchivada.huecos / envio.archivarHueco); la fachada NO lo
// re-exporta.
export interface HuecoArchivado {
  tipo: TipoPagina;
  pagina: 1 | 2;
  estado: "OK" | "RESCANEO";
}
/** Entrada Fase B (§6): clasificación guardada + huecos ocupados de la mesa. */
/** Bloque 2.6 — entrada del libro de PDF de la sesión. */
export interface PdfLibroEntry {
  id: string;
  titulo: string;
  estado: string;
  score: number | null;
  hora: string | null;
  foto: string | null;
  qr?: string | null;
}

export interface ActaArchivada {
  clasificacion: ClasificacionE14;
  huecos: HuecoArchivado[];
}

/** PUESTO ACTUAL (regla del mantenedor: «solo un puesto debe de aparecer»): el
 *  puesto de la ÚLTIMA clasificación archivada. ACTAS y RESUMEN renderizan
 *  SOLO este puesto; al escanear otro puesto se reemplaza completo. */
export interface PuestoActual {
  /** Prefijo de clave «dep-mun-zon-std» (claveDePuesto). */
  clave: string;
  /** Título del puesto en MAYÚSCULAS — convención de tituloYUbicacionDe. */
  titulo: string;
  /** Línea de ruta: país/municipio por NOMBRE, zona y puesto por CÓDIGO. */
  departamento: string;
  municipio: string;
  zona: string;
  puesto: string;
}

// ─── R-27: forma de los SET/GET que zustand entrega a cada slice ───
// Cada slice de `store/` recibe el set/get de la MISMA tienda (patrón de
// composición de la fachada `store.ts`): escribir cualquier campo y leer el
// estado COMPLETO (E14Store) sin importar la fachada (cero ciclos).

/** set de la tienda e14 (mismo tipo que pasa `create<E14Store>`). */
export type E14Set = StoreApi<E14Store>["setState"];
/** get de la tienda e14 — siempre devuelve el estado completo. */
export type E14Get = StoreApi<E14Store>["getState"];
/** API vanilla completa (getState/setState/subscribe) — la usa el persister. */
export type E14StoreApi = StoreApi<E14Store>;
