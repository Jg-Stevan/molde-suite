// Flags de runtime (overridables por el operador desde localStorage) —
// kill-switches del mantenedor y afinado del piso escénico.

export interface Flags {
  /** Piso del progreso escénico durante el análisis (ms). */
  pisoEscenicoMs: number;
  /** Cierra la animación de análisis apenas resuelve el pipeline. */
  cierreInstantaneo: boolean;
  /** OCR en cascada (Tesseract después de Rapid) para lecturas difíciles. */
  ocrCascada: boolean;
  /** FASE 0 (blueprint DLA): ejecutar el molde activo tras el gate. */
  evaluacionMolde: boolean;
  /** FASE A3 (blueprint DLA): corrección de inclinación residual (deskew ≤10°). */
  deskew: boolean;
  /** FASE B (blueprint DLA): señales ONNX en el navegador (casillas/layout). */
  dlaOnnx: boolean;
  /** KIT velocidad-5s: dims de JPEG desde el contenedor (sin decodificar) y
   *  re-escalado fuera del hilo para imports/capturas por encima del tope. */
  importRutaCorta: boolean;
  /** Rescate F-HEIC (sin heic2any en Tamiz: hoy solo clasifica el rechazo). */
  heicTopeMp: number;
  heicLimiteMs: number;
  /** D3 — brújula QR primero; sondeo OCR de respaldo (upstream). */
  qrBrujulaOrientacion: boolean;
  /** Pases del rescate hi-res guiado por el quad (upstream: 2). */
  qrBrujulaWarpPases: number;
  probeMiniLado: number;
  /** KIT adaptación dispositivo: knobs de PERFORMANCE por tier (hilos OCR,
   *  2.ª pasada ROI-cabecera). OFF ⇒ knobs byte-idénticos al histórico. */
  adaptacionDispositivo: boolean;
  /** KIT velocidad-5s (D88): false = intento 1 de la cascada es Tesseract
   *  best (digielect) y RapidOCR 1280 queda de respaldo/rescate. */
  ocrPrimeraPasadaRapida: boolean;
  /** Knobs del tensor del rec (defaults históricos de digielect14). */
  ocrRecWmax: number;
  ocrRecAltura: number;
  ocrRecLote: number;
  ocrLeerBw: boolean;
  ocrRecSuave: boolean;
  ocrRecWfija: boolean;
  ocrRecCabecera: number;
  ocrRecPie: number;
  ocrRecBordesRescate: number;
  /** Fuerza el 2.º intento del escalonado a ROI-cabecera (franja 0-25%). */
  ocrReOcrRoi: boolean;
  /** Tope PARED (ms) del 2.º intento del escalonado (0 = sin tope propio). */
  ocrSegundaTopeMs: number;
  /** Presupuesto (ms) para PERMITIR el 2.º intento (null = manda el del
   *  pipeline). Doble whitelist en digielect: override manual del operador. */
  ocrSegundaPresupuestoMs: number | null;
  /** Rechazo temprano por geometría: con el veredicto bloqueado antes del
   *  OCR no se abre ninguna escalada (1920/ROI/motor de rescate). */
  ocrCorteIncompleta: boolean;
  /** Banda del sello con la pasada rápida (det 1280, sin cls ni rescate). */
  ocrBandaRapida: boolean;
  /** P2-D (plan agente externo, tarea D) — usar el bucle de frames del CORE
   *  (CameraFrameLoop: rVFC + detección OpenCV en worker + disparo k-de-n +
   *  compuerta de quietud MotionStabilizer) en lugar del rAF propio de 250 ms
   *  de useSesionCamara. ON por defecto (digielect14: es el funcionamiento
   *  aprobado — marcas en vivo + disparo k-de-n). El rAF propio queda como
   *  red de seguridad automática; kill-switch del operador sin redeploy:
   *  localStorage `tamiz.flags.v1` = {"frameLoop":false}. */
  frameLoop: boolean;
  /** F4 — pre-warm de RapidOCR al montar la vista de escaneo (no solo al
   *  importar). Reduce el arranque frío de la 1.ª foto. */
  ocrProwarmScanView: boolean;
  /** F4 — reciclar los workers OCR (Rapid + Tesseract) tras cada veredicto
   *  para liberar memoria nativa WASM y evitar el cuelgue del 2.º escaneo. */
  ocrReciclarPostEscaneo: boolean;
  /** F4 — fallback det1920→1280 ante bad_alloc/presión de memoria en la
   *  escalada del OCR. Evita el hang tipo A13 en gama baja. */
  ocrFallbackBadAlloc: boolean;
  /** F2 — reusar las líneas RapidOCR del cascade como ocrLines del router
   *  (elimina el 2.º Tesseract de página completa). Default-off hasta pasar
   *  el banco de 21 fotos. */
  ocrRouterReusado: boolean;
  /** F1 — warp compartido: un solo warp (original) y bw derivado.
   *  Default-off hasta pasar fixture de equivalencia pixel-a-pixel. */
  warpCompartido: boolean;
  /** F3 — skip del A/B binarizada-vs-original cuando el cascade ya leyó
   *  campos (las líneas Rapid reusadas prueban que el original tiene tinta). */
  ocrSkipABSiCascadeLee: boolean;
  /** F3 — tope de variantes de realce por campo en el motor universal
   *  (histórico: 6). Menos variantes = menos latencia en fotos difíciles. */
  ocrRescatePresupuesto: number;
  /** Dictamen HTR por confianza: umbral mínimo (0-1) para que un campo
   *  `htr && obligatorio` con patrón cumplido pueda ser ok. null = regla
   *  histórica (manuscritos siempre a revisión). */
  htrConfDictamen: number | null;
  /** §4 (REGLA DE ORO, plan cierre 2 agentes 2026-11-26): documento LEGIBLE
   *  (ÓPTIMA, o ADVERTENCIA con TODOS los obligatorios presentes/válidos y
   *  sin `relacion_ambigua`) SE GUARDA SOLO — registrarEnvio + banner ENVIADA
   *  + «SEGUIR ESCANEANDO», sin toque del operador. Excepciones (jamás
   *  auto-envían): RECHAZADA, EN_REVISION_HUMANA, `relacion_ambigua`, actas
   *  sin tinta. Kill-switch: {"autoGuardado": false} → ADVERTENCIA vuelve a
   *  decidirse a mano (la ÓPTIMA conserva su auto-envío histórico… apagada
   *  también: el flag gobierna TODA la regla — comportamiento pre-kit). */
  autoGuardado: boolean;
}

const CLAVE = 'tamiz.flags.v1';

const DEFAULTS: Flags = {
  pisoEscenicoMs: 300,
  cierreInstantaneo: true,
  ocrCascada: true,
  // FASE 0: la evaluación de molde SOLO corre si hay molde activo
  // (molde/registry.ts) — activa por defecto es segura.
  evaluacionMolde: true,
  // FASE A3: el deskew corrige ángulos pequeños medidos por proyección;
  // kill-switch disponible para el operador.
  deskew: true,
  // FASE B: OFF por defecto — requiere modelo configurado (URL) y su primera
  // validación contra el banco (lessons/). Activable desde el Panel DEV.
  dlaOnnx: false,
  importRutaCorta: true,
  heicTopeMp: 24,
  heicLimiteMs: 15_000,
  qrBrujulaOrientacion: true,
  qrBrujulaWarpPases: 2,
  probeMiniLado: 1280,
  // KIT adaptación dispositivo ON por defecto (knobs de PERFORMANCE por tier;
  // jamás reglas de negocio). Kill-switch: {"adaptacionDispositivo": false}
  // ⇒ knobs byte-idénticos al histórico.
  adaptacionDispositivo: true,
  // D88 (digielect, 2026-11): intento 1 = Tesseract best; la pasada rápida
  // de RapidOCR (det 1280) queda de respaldo y de rescate final.
  ocrPrimeraPasadaRapida: false,
  ocrRecWmax: 480,
  ocrRecAltura: 40,
  ocrRecLote: 6,
  ocrLeerBw: false,
  ocrRecSuave: false,
  ocrRecWfija: false,
  ocrRecCabecera: 14,
  ocrRecPie: 14,
  ocrRecBordesRescate: 7,
  ocrReOcrRoi: false,
  ocrSegundaTopeMs: 0,
  ocrSegundaPresupuestoMs: null,
  ocrCorteIncompleta: true,
  ocrBandaRapida: true,
  // P2-D: el lazo k-de-n del core es el funcionamiento de digielect14
  // (marcas en vivo + auto-disparo). El rAF propio retoma solo si el bucle
  // cae (watchdog en useSesionCamara).
  frameLoop: true,
  // F4: warm-up al montar ScanView, reciclado post-veredicto, fallback
  // bad_alloc. Kill-switch: {"ocrProwarmScanView":false,...} → histórico.
  ocrProwarmScanView: true,
  ocrReciclarPostEscaneo: true,
  ocrFallbackBadAlloc: true,
  // F2: reuso de líneas Rapid en el router — OFF hasta pasar banco 21.
  ocrRouterReusado: false,
  // F1: warp compartido — OFF hasta pasar fixture de equivalencia bw.
  warpCompartido: false,
  // F3: skip A/B si el cascade ya leyó + presupuesto de rescates acotado.
  ocrSkipABSiCascadeLee: true,
  ocrRescatePresupuesto: 3,
  // Dictamen HTR por confianza: OFF (null) hasta validarlo con el banco.
  htrConfDictamen: null,
  // §4 REGLA DE ORO (recalzada por el dueño 2026-11-26): default ON — el
  // plan exige que un documento legible con obligatorios completos SE
  // GUARDE SOLO y lo demuestre en navegador (§7). Kill-switch del operador
  // disponible sin redeploy: localStorage tamiz.flags.v1 = {"autoGuardado": false}.
  autoGuardado: true,
};

let cache: Flags | null = null;

/** Saneo de los knobs numéricos OCR (clamps idénticos a digielect14 — un
 *  override corrupto del operador no puede romper el motor). */
function sanearFlags(f: Flags): Flags {
  const num = (v: unknown, def: number, min: number, max: number, paso = 1): number =>
    typeof v === 'number' && Number.isFinite(v)
      ? Math.max(min, Math.min(max, Math.round(v / paso) * paso))
      : def;
  f.ocrRecWmax = num(f.ocrRecWmax, DEFAULTS.ocrRecWmax, 160, 960);
  f.ocrRecAltura = num(f.ocrRecAltura, DEFAULTS.ocrRecAltura, 24, 64, 4);
  f.ocrRecLote = num(f.ocrRecLote, DEFAULTS.ocrRecLote, 1, 12);
  f.ocrRecCabecera = num(f.ocrRecCabecera, DEFAULTS.ocrRecCabecera, 0, 60);
  f.ocrRecPie = num(f.ocrRecPie, DEFAULTS.ocrRecPie, 0, 60);
  f.ocrRecBordesRescate = num(f.ocrRecBordesRescate, DEFAULTS.ocrRecBordesRescate, 0, 10);
  f.ocrSegundaTopeMs = num(f.ocrSegundaTopeMs, DEFAULTS.ocrSegundaTopeMs, 0, 120_000);
  f.ocrRescatePresupuesto = num(f.ocrRescatePresupuesto, DEFAULTS.ocrRescatePresupuesto, 1, 6);
  // Dictamen HTR: null = OFF. Un override corrupto apaga (nunca enciende solo).
  f.htrConfDictamen =
    typeof f.htrConfDictamen === 'number' && Number.isFinite(f.htrConfDictamen)
      ? num(f.htrConfDictamen, 0.8, 0.5, 1, 0.01)
      : null;
  // §4 REGLA DE ORO: un override corrupto APAGA (conservador — jamás
  // auto-guarda por accidente de parseo).
  f.autoGuardado = f.autoGuardado === true;
  if (f.ocrSegundaPresupuestoMs !== null) {
    f.ocrSegundaPresupuestoMs = num(
      f.ocrSegundaPresupuestoMs,
      DEFAULTS.ocrSegundaPresupuestoMs ?? 5_000,
      5_000,
      120_000,
    );
  }
  return f;
}

export function refrescarFlags(): void {
  cache = null;
  if (typeof window === 'undefined') return;
  try {
    const crudo = window.localStorage.getItem(CLAVE);
    if (crudo) cache = sanearFlags({ ...DEFAULTS, ...(JSON.parse(crudo) as Partial<Flags>) });
  } catch {
    cache = null;
  }
}

export function leerFlags(): Flags {
  if (!cache) refrescarFlags();
  return cache ?? DEFAULTS;
}

/** Opciones del rescate F-HEIC para los DOS lectores de File (useDestello y
 *  la memo del bridge) — un único lector de flags (upstream flags.ts:344). */
export type OpcionesRescateHeic = { topeMpHeic?: number; limiteMsHeic?: number };
export function opcionesRescateHeic(): OpcionesRescateHeic {
  const f = leerFlags();
  return { topeMpHeic: f.heicTopeMp, limiteMsHeic: f.heicLimiteMs };
}
