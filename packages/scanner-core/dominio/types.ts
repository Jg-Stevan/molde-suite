// Tipos de dominio del documento (D8 opción B: contrato mínimo del paquete
// scanner-core). Estos son los tipos que consume la capa UI de Tamiz; la
// implementación del análisis vive en apps/tamiz (bridge) y delega al motor
// universal v3 de Molde Studio.

import type { Quad } from '../core/types';

export type { Quad };

export type ActaStatus =
  | "OPTIMA"
  | "ADVERTENCIA"
  | "RECHAZADA"
  | "EN_REVISION_HUMANA"
  | "ENVIADA"
  | "DUPLICADA";

export type FuenteCaptura = "CAMARA" | "ARCHIVO" | "SIMULACION";

/** Tipo de página del documento (el E-14 tiene PRINCIPAL y ANEXO). */
export type TipoPagina = "TRANSMISIÓN" | "DELEGADOS";

export interface UbicacionActa {
  departamento: string;
  municipio: string;
  zona: string;
  puesto: string;
  mesa: string;
}

export interface ActaFirma {
  nombre: string;
  jurado: string;
  estado: "OK" | "TENUE" | "NO_DETECTADO";
}

export interface RechazoActa {
  tipo: "ILEGIBLE" | "INCOMPLETA" | "SIN_VOTOS" | "BAJO" | "TIMEOUT" | (string & {});
  detalle: string | null;
}

export interface MetricasActa {
  sharpness: number;
  brightness: number;
  contrast: number;
}

/** Diagnóstico forense del gate (qué señal condicionó el desenlace). */
export interface DiagnosticoActa {
  gate: {
    completa: boolean;
    ladoEsquina: string | null;
    fondo: boolean;
    votos: { skipPag2: boolean; ok: boolean; densidadPct?: number | null };
  };
  metricas: { sharpnessHi: number; sharpness: number; brightness: number; contrasteEfectivo: number };
  tiempos: Record<string, number>;
  envioRedTipo?: string | null;
  envioDownlinkMbps?: number | null;
}

export interface PaginaActa {
  index: number;
  total: number;
}

/**
 * FASE 0 (blueprint DLA): resumen de la evaluación del MOLDE activo sobre el
 * acta — Tamiz ejecuta `evaluarDocumentoUniversal` tras el gate cuando hay un
 * molde registrado. Resumen LIGERO (sin crops ni previews: la memoria del
 * móvil manda); el detalle por campo queda en el store de la sesión.
 */
export interface ResumenMoldeActa {
  moldeNombre: string;
  total: number;
  ok: number;
  /** Score 0-100 del motor (campos ok / total). */
  score: number;
  requiereRevision: boolean;
  obligatoriosFaltantes: string[];
  /** Banderas agregadas del motor (sin duplicar): forma_discrepa, umbral_al_borde, … */
  banderas: string[];
  tiempos: { render_ms: number; ocr_ms: number; motor_ms: number };
  /**
   * ETAPA B (enrutamiento universal): filas por campo para la VERIFICACIÓN
   * DOCUMENTAL — opcional y aditivo (hosts viejos no lo consumen).
   */
  campos?: ResumenMoldeCampo[];
  /**
   * ETAPA B — true cuando este resultado MOLDE es el veredicto del acta
   * (documento NO identificado como E-14 que la biblioteca reconoció): el
   * score/estado/banner del acta derivan de aquí. false/ausente = evaluación
   * ADITIVA de siempre (el E-14 manda).
   */
  enrutado?: boolean;
}

/** Fila de un campo del molde para el checklist universal (Etapa B). */
export interface ResumenMoldeCampo {
  id: string;
  etiqueta: string;
  tipo: "texto" | "presencia" | "firma" | "checkbox";
  estado: "ok" | "no_encontrado" | "requiere_revision";
  /** Texto leído (texto) o booleano de diligenciamiento (presencia/firma/checkbox). */
  valor: string | boolean | null;
  /** Confianza 0-1 (null = el OCR no reportó confianza). */
  conf: number | null;
  /** Rectángulo normalizado resuelto (para el overlay). */
  rect?: { x: number; y: number; w: number; h: number } | null;
  /**
   * Overlay: dónde el OCR encontró el texto del ANCLA (normalizado). null si
   * no hubo hit real (zona_fija / referencia / arnés). Aditivo.
   */
  ancla_rect?: { x: number; y: number; w: number; h: number } | null;
  /** Procedencia del rect resuelto — el overlay la usa para el color del ancla. */
  fuente?: "ancla" | "respaldo" | "referencia" | "fija" | "arnes" | null;
  /**
   * El molde declara el campo como MANUSCRITO (`htr: true` en la definición).
   * Aditivo (v1.4.2): la UI lo necesita porque un manuscrito jamás puede
   * quedar `ok` — el color del overlay decide «hay trazo / no hay trazo»,
   * no «leyó bien / leyó mal».
   */
  htr?: boolean;
  /**
   * TINTA medida en la zona (ratio de píxeles oscuros del motor sobre la
   * canónica; el mismo que alimenta `firma_ausente`/`zona_vacia`). Aditivo
   * (v1.5.1): el overlay de manuscritos pinta por ESTO, no por la lectura —
   * una rúbrica con trazo y sin texto legible es «hay trazo» (verde), y un
   * campo en blanco es «no hay trazo» (rojo). `undefined` = zona sin resolver.
   */
  tinta?: boolean;
  /** Banderas del motor para este campo (forense / tooltip del overlay). */
  banderas?: string[];
  /** Presentación (G-7): el valor se resalta en la lista. */
  destacado?: boolean;
  obligatorio?: boolean;
  /**
   * FASE 4 (v3.2.0 — interfaz táctica): grupo de lectura + índice de orden
   * del campo en el documento (derivados del importador Chandra). Opcionales
   * y retrocompatibles: sin ellos el checklist se presenta como siempre.
   */
  grupo?: string;
  orden?: number;
  /**
   * Página del documento a la que pertenece el campo (1-indexada; viene de
   * `campo.pagina` de la definición). Aditivo (fase 3 multipágina): la UI
   * filtra la verificación a la página capturada. `undefined` = molde de
   * una sola página / campo sin declaración.
   */
  pagina?: number;
}

/**
 * PLAN-AGENTE-LAYOUT F4: resultado del gate estructural (etapa LAYOUT entre
 * CALIDAD y OCR). Tamiz ejecuta `evaluarEstructura` (@jg-stevan/layout-core)
 * sobre las regiones de PP-DocLayout cuando el molde activo declara `layout`;
 * el veredicto viaja ADITIVO en `acta.estructura` (el rechazo temprano usa su
 * contenido: regla obligatoria faltante → RECHAZADA/INCOMPLETA antes del OCR).
 */
export interface EstructuraActa {
  modelo: "s" | "plusL";
  ms: number;
  ok: boolean;
  requiere_revision: boolean;
  obligatorias_faltantes: string[];
  /** Resumen por regla para el overlay y el diagnóstico. */
  reglas: {
    reglaId: string;
    etiqueta: string;
    estado: "ok" | "faltante" | "sobrante" | "baja_confianza";
    motivo?: string;
    /** Cajas normalizadas 0-1 de la página para el overlay. */
    cajas: { x: number; y: number; w: number; h: number }[];
  }[];
}

/** El documento escaneado: foto + calidad + OCR + clasificación + desenlace. */
export interface Acta {
  id: string;
  titulo: string;
  ubicacion: UbicacionActa;
  tipo: string;
  pagina: PaginaActa | null;
  candidatos: unknown[];
  firmas: ActaFirma[];
  score: number;
  scoreVisual?: number;
  status: ActaStatus;
  rechazo: RechazoActa | null;
  intento: number;
  maxIntentos: number;
  fuente: FuenteCaptura;
  fotoOriginal?: string;
  fotoProcesada?: string;
  procesadaVacia?: boolean;
  recortada?: boolean;
  recorteLado?: string | null;
  recorteManualSinTinta?: boolean;
  ocrTexto?: string;
  metricas?: MetricasActa;
  motor?: "worker" | "canvas";
  quadDetectado?: Quad;
  rotation?: number | null;
  filtro?: string;
  clasificacion?: import("./clasificador").ClasificacionE14 | null;
  diagnostico?: DiagnosticoActa | null;
  /** FASE 0 (blueprint DLA): evaluación por molde tras el gate (opcional). */
  evaluacionMolde?: ResumenMoldeActa | null;
  /** PLAN-AGENTE-LAYOUT F4: veredicto del gate estructural (opcional —
   *  null/ausente = molde sin layout o modelo no configurado, etapa saltada). */
  estructura?: EstructuraActa | null;
  hashSha256?: string;
  qrPayload?: string | null;
  qrEstado?: "leido" | "sin-payload";
  enviadoAutomaticamente?: string | null;
  /**
   * GUARDADO_CRUDO (fase 2): la foto ORIGINAL del acta quedó archivada cruda
   * (IDB «crudas», sin OCR/verificación — «NO VERIFICADA»). Aditivo: hosts
   * viejos lo ignoran; `undefined` = acta normal.
   */
  guardadaCruda?: boolean;
}

/** Fila del historial de envíos. */
export interface HistorialRow {
  id: string;
  titulo: string;
  /**
   * GUARDADO_CRUDO (fase 2 — guardar cruda): la foto ORIGINAL quedó archivada
   * SIN verificación (auto-recorte mal / rechazo persistente) — NO cuenta como
   * envío verificado; la UI la marca «CRUDA · NO VERIFICADA».
   */
  estado: "ENVIADO" | "REVISION_HUMANA" | "RESCANEO_REQUERIDO" | "GUARDADO_CRUDO" | (string & {});
  hora: string | null;
  nota?: string | null;
}

export interface MesaPagina {
  tipo: TipoPagina;
  pagina: 1 | 2;
  estado: "PENDIENTE" | "OK" | "RESCANEO";
}

export interface Mesa {
  id: string;
  estado: "PENDIENTE" | "COMPLETADA" | "EN_PROCESO";
  progresoPct: number;
  paginas: MesaPagina[];
}

/** PLAN-AGENTE-LAYOUT F4: etapa LAYOUT (gate estructural) entre CALIDAD y OCR. */
export type EtapaAnalisis =
  | "DETECTANDO"
  | "RECORTANDO"
  | "REALZANDO"
  | "CALIDAD"
  | "LAYOUT"
  | "OCR";

export interface ProgresoAnalisis {
  etapa: EtapaAnalisis;
  /** 0..1 */
  progreso: number;
}

/**
 * Status por score (escala del mantenedor 0..10): ≥ UMBRAL_ADMISIBLE → OPTIMA,
 * ≥ UMBRAL_RECHAZO_SCORE → ADVERTENCIA, si no RECHAZADA.
 */
export const UMBRAL_ADMISIBLE_SCORE = 8.5;

export function statusDeScore(score: number): ActaStatus {
  if (score >= UMBRAL_ADMISIBLE_SCORE) return "OPTIMA";
  return "ADVERTENCIA";
}
