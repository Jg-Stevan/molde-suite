import type {
  ResultadoUniversal,
  TipoCampo,
} from '@jg-stevan/scanner-core/molde/universal-types';

export type Veredicto = 'OPTIMA' | 'ADVERTENCIA' | 'RECHAZADA';

/** Papel del campo en el veredicto. Los opcionales nunca bloquean. */
export type RolCampo = 'ok' | 'faltante' | 'revision' | 'informativo';

export interface CampoVeredicto {
  id: string;
  etiqueta: string;
  pagina: number;
  tipo: TipoCampo;
  obligatorio: boolean;
  estado: 'ok' | 'no_encontrado' | 'requiere_revision';
  valor: string | boolean | null;
  ratio: number | null;
  conf: number | null;
  banderas: string[];
  /** Fuente de resolución del rect (ancla/respaldo/referencia/fija) para diagnóstico. */
  fuente?: string | null;
  /** Rect resuelto final (diagnóstico de calibración en el reporte JSON). */
  rect?: { x: number; y: number; w: number; h: number } | null;
  rol: RolCampo;
}

export interface ResultadoGenerico {
  molde: { nombre: string; documento: string; version: string };
  veredicto: Veredicto;
  paginasEsperadas: number;
  paginasRecibidas: number;
  paginasFaltantes: number[];
  campos: CampoVeredicto[];
  faltantesDuros: CampoVeredicto[];
  porRevisar: CampoVeredicto[];
  motivos: string[];
  banderas: string[];
  /** Resultado crudo del motor, para el reporte JSON y diagnóstico. */
  universal: ResultadoUniversal;
}
