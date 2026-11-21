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
  hashSha256?: string;
  qrPayload?: string | null;
  qrEstado?: "leido" | "sin-payload";
  enviadoAutomaticamente?: string | null;
}

/** Fila del historial de envíos. */
export interface HistorialRow {
  id: string;
  titulo: string;
  estado: "ENVIADO" | "REVISION_HUMANA" | "RESCANEO_REQUERIDO" | (string & {});
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

export type EtapaAnalisis = "DETECTANDO" | "RECORTANDO" | "REALZANDO" | "CALIDAD" | "OCR";

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
