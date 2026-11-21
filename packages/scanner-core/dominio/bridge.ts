// Contrato del bridge de análisis (D8 opción B): lo que la UI de Tamiz puede
// pedirle al núcleo de escaneo. La implementación real vive en
// apps/tamiz/src/lib/e14/bridge/real-core-bridge.ts.

import type {
  Acta,
  ActaFirma,
  ActaStatus,
  FuenteCaptura,
  ProgresoAnalisis,
} from './types';
import type { PageFilter, Quad } from '../core/types';

/** Página que el operador debe escanear (guion de la jornada). */
export interface PaginaObjetivo {
  /** Identificador de mesa, p. ej. "DOC 01". */
  mesaId: string;
  tipo: import('./types').TipoPagina;
  pagina: 1 | 2;
}

/** Opciones de una pasada de escaneo. */
export interface OpcionesEscaneo {
  archivo?: File;
  fuente: FuenteCaptura;
  frameActual?: HTMLVideoElement;
  onProgreso?: (p: ProgresoAnalisis) => void;
  intento?: number;
  maxIntentos?: number;
  objetivo?: PaginaObjetivo | null;
}

/** Opciones extendidas con el watchdog y el rescate post-timeout (e67). */
export type OpcionesEscaneoExtendidas = OpcionesEscaneo & {
  timeoutMs?: number;
  onRescateTardio?: (acta: Acta, tiempoRealMs: number) => void;
  imagenSimulada?: string;
};

/** API pública del núcleo de escaneo. */
export interface E14Bridge {
  escanearActa(opciones: OpcionesEscaneoExtendidas): Promise<Acta>;
  recortar(
    acta: Acta,
    quad: Quad,
    onProgreso?: (p: ProgresoAnalisis) => void,
    rotacionOverride?: number,
    quadOrigen?: unknown,
    manual?: boolean,
  ): Promise<Acta>;
  mejorarResolucion(acta: Acta, fotoNueva: string, onProgreso?: (p: ProgresoAnalisis) => void): Promise<Acta>;
  revelar(acta: Acta, filtro: PageFilter): Promise<Acta>;
  reconocerTexto(acta: Acta): Promise<string>;
  horaEnvio(): string;
  horaHistorial(): string;
}
