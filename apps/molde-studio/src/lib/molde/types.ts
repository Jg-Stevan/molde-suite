// Tipos del molde e14.schema.v2.json y de los resultados del motor.
// Port del motor de referencia verify-e14/simular_molde_v2.py a TypeScript (navegador).

export interface AnclaLinea {
  patron: string;
  filas_abajo?: number;
}

export interface ZonaFila {
  tipo: 'fila';
  columna_x0: number;
  columna_x1: number;
  y0_rel: number;
  y1_rel: number;
}

export interface ZonaBanda {
  tipo: 'banda';
  x0: number;
  x1: number;
  y0_rel: number;
  y1_rel: number;
}

export interface ZonaCasillaFirma {
  tipo: 'casilla_firma';
  col_izq: [number, number];
  col_der: [number, number];
  desde: 'etiqueta_y0' | 'etiqueta_y1';
  dy0: number;
  dy1: number;
}

export type Zona = ZonaFila | ZonaBanda | ZonaCasillaFirma | { tipo: string; [k: string]: unknown };

export interface ZonaFija {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface CampoMolde {
  nombre: string;
  etiqueta: string;
  pagina: number;
  tipo: 'texto' | 'presencia' | 'firma';
  estrategia: 'regex' | 'ancla_zona' | 'recuento_si_no';
  patron?: string;
  grupo?: number;
  anclas?: AnclaLinea[];
  ancla_nivel?: 'palabra';
  ancla_palabra?: string;
  jurado_num?: number;
  zona?: Zona;
  zona_fija?: ZonaFija;
  umbral_tinta?: number;
  medida?: 'componentes';
  lado?: 'SI' | 'NO';
  obligatorio: boolean;
  nota?: string;
}

export interface MotorConfig {
  binarizacion?: string;
  kernel_linea_frac?: number;
  paso_fila?: number;
  paso_rejilla_firmas?: number;
  umbral_tinta_default?: number;
  filtro_linea_zona?: { fraccion_ancho: number; grosor_max: number };
  medida_componentes?: { area_min: number; min_comps: number; dens_alta: number };
  [k: string]: unknown;
}

export interface Molde {
  tipo: string;
  version: string;
  descripcion: string;
  motor: MotorConfig;
  clasificacion: { anclas: string[]; min_anclas: number; regex: string };
  paginas: {
    requeridas: number;
    marcador: string;
    marcador_obligatorio: boolean;
    inferencia: { pagina_1: string[]; pagina_2: string[] };
  };
  identificacion: {
    patron: string;
    fallback: string;
    raiz: { inicio: number; fin: number };
    digito_pagina: number;
    relectura?: { factor_escala?: number; psm?: number };
    consenso: { tolerancia_edicion: number };
  };
  campos: CampoMolde[];
  validaciones: { regla: string; param?: unknown; descripcion: string }[];
  limitaciones?: string[];
}

// ---- OCR ----

export interface PalabraOcr {
  texto: string;
  conf: number;
  bbox: [number, number, number, number]; // x0, y0, x1, y1 (px)
}

export interface LineaOcr {
  texto: string;
  bbox: [number, number, number, number];
  palabras: PalabraOcr[];
}

// ---- Resultados ----

export interface ResultadoCampo {
  nombre: string;
  tipo: string;
  estado: 'ok' | 'no_encontrado';
  valor: boolean | string | null;
  ratio?: number | null;
  n_componentes?: number;
  umbral?: number | null;
  zona?: [number, number, number, number] | null;
  origen?: string | null;
  confianza: number;
  banderas: string[];
}

export interface CandidatoId {
  valor: string;
  fuente: string;
  conf: number;
}

export interface ResultadoPagina {
  pagina: number | null;
  fuente_numero: string | null;
  es_e14: boolean;
  id_candidatos: CandidatoId[];
  id_estimado: string | null;
  ocr_texto: string;
  ocr_confianza: number;
  campos: Record<string, ResultadoCampo>;
  tiempos: { render_ms: number; ocr_ms: number; motor_ms: number; id_ms: number };
}

export interface Validacion {
  regla: string;
  ok: boolean;
  detalle: string;
  tolerada?: boolean;
}

export interface ComparacionGt {
  acta: string;
  coincidencia: number;
  total: number;
  errores: { campo: string; tag: string }[];
}

export interface ResultadoActa {
  documento_id: string | null;
  id_politica: string;
  raiz: string | null;
  id_pagina_1: string | null;
  paginas: ResultadoPagina[];
  campos: Record<string, ResultadoCampo>;
  validaciones: Validacion[];
  requiere_revision: boolean;
  confianza_global: number;
  gt: ComparacionGt | null;
}

// Campo tal como lo devuelve la IA (VLM) para la comparación
export interface CamposIa {
  consulado_codigo?: string | null;
  pais_codigo?: string | null;
  pais_nombre?: string | null;
  zona_codigo?: string | null;
  puesto_codigo?: string | null;
  mesa_codigo?: string | null;
  lugar?: string | null;
  documento_id_15?: string | null;
  total_votantes_e11?: boolean | null;
  total_votos_urna?: boolean | null;
  total_votos_incinerados?: boolean | null;
  votos_candidato_1?: boolean | null;
  votos_candidato_2?: boolean | null;
  votos_en_blanco?: boolean | null;
  votos_nulos?: boolean | null;
  votos_no_marcados?: boolean | null;
  suma_total?: boolean | null;
  constancias_presente?: boolean | null;
  recuento_si?: boolean | null;
  recuento_no?: boolean | null;
  firmas_jurados?: number | null;
  observaciones?: string | null;
}
