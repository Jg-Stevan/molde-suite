// Formato universal de molde (v3): sirve para CUALQUIER documento con zonas
// de interés sobre una referencia escaneada. No está acoplado al E-14.
//
// Conceptos:
// - Coordenadas normalizadas 0-1 (independientes de la resolución de la foto).
// - Estrategia "zona_fija": el rectángulo es absoluto sobre la página.
// - Estrategia "ancla_relativa": se busca el texto del ancla por OCR (fuzzy) y
//   la zona se posiciona como offset (dx, dy) desde la esquina superior
//   izquierda del ancla encontrado. `ancla.rect` guarda la posición esperada
//   en el escaneo de referencia (para dibujar y para el fallback).

export interface RectNorm {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type TipoCampo = 'texto' | 'presencia' | 'firma' | 'checkbox';
export type EstrategiaCampo = 'zona_fija' | 'ancla_relativa';

export interface AnclaUniversal {
  /** Texto a buscar por OCR (se normaliza: mayúsculas, sin acentos ni signos). */
  texto: string;
  /** Posición esperada del ancla en el escaneo de referencia (opcional pero recomendada). */
  rect?: RectNorm;
}

export interface CampoUniversal {
  id: string;
  etiqueta: string;
  /** Página 1-indexada. */
  pagina: number;
  tipo: TipoCampo;
  estrategia: EstrategiaCampo;
  /**
   * zona_fija: rectángulo absoluto {x,y,w,h}.
   * ancla_relativa: {x,y} = offset desde el ancla; {w,h} = tamaño de la zona.
   */
  zona: RectNorm;
  ancla?: AnclaUniversal;
  /** Texto de ancla alternativo si la principal no aparece por OCR. */
  ancla_respaldo?: string;
  /**
   * Solo para ancla_relativa: si es true, zona.x es ABSOLUTO (0-1 de la página)
   * y solo y se offsetea desde el ancla. Útil para bandas horizontales que
   * ocupan columnas fijas del documento (semántica del E-14 fila/banda).
   */
  x_absoluto?: boolean;
  /** Umbral de densidad de tinta para presencia/firma/checkbox (0-1). */
  umbral: number;
  /** Regex opcional que debe cumplir el texto leído. */
  patron?: string;
  /** Whitelist de caracteres para el OCR del recorte (solo tipo texto). Ej: '0123456789'. */
  whitelist?: string;
  /**
   * Solo tipo texto: si la primera lectura falla (vacía o patron_no_cumple),
   * reintenta con realce (escala de grises + estiramiento de contraste + ampliación 3x).
   * Recomendado en manuscritos y fotos de baja calidad.
   */
  realce?: boolean;
  obligatorio: boolean;
  nota?: string;
}

export interface MoldeUniversal {
  tipo: 'universal';
  version: string;
  nombre: string;
  descripcion?: string;
  /** Tipo de documento libre (informativo): 'acta_e14', 'solicitud', 'contrato'... */
  documento?: string;
  idioma?: string;
  /** Imagen de referencia por página (escaneo limpio sobre el que se dibuja el molde). */
  paginasRef?: { pagina: number; imagen: string }[];
  campos: CampoUniversal[];
  /**
   * Metadatos de presentación de la tarjeta en la Biblioteca (diseño Stitch).
   * Si existen, sobresalen sobre los stats calculados de las pruebas reales.
   */
  meta?: {
    precision?: number;
    docs?: number;
    unidadDocs?: string;
    estado?: 'activo' | 'validando' | 'ninguno';
    validacion?: string;
    etiquetas?: Partial<Record<TipoCampo, string>>;
    /** Etiqueta del conteo de campos: 'Campos Mapeados', 'Zonas Auditables'... */
    etiquetaCampos?: string;
    /** Orden de aparición en la Biblioteca (menor = primero; diseño Stitch). */
    orden?: number;
  };
}

export const MOLDE_UNIVERSAL_VERSION = '3.0.0';

/** Colores por tipo de campo (Tailwind) — ontología de visión del diseño Stitch. */
export const COLOR_TIPO: Record<TipoCampo, string> = {
  texto: 'sky',
  presencia: 'emerald',
  firma: 'violet',
  checkbox: 'amber',
};

export function hexTipo(tipo: string): string {
  switch (tipo) {
    case 'texto':
      return '#0ea5e9'; // Manuscrito / texto OCR (detection-text)
    case 'firma':
      return '#8b5cf6'; // Firma y sellos (detection-signature)
    case 'checkbox':
      return '#f59e0b'; // OMR / checkbox
    default:
      return '#10b981'; // Dato variable / presencia
  }
}

// ---- Resultados ----

export interface ResultadoCampoUniversal {
  id: string;
  etiqueta: string;
  tipo: TipoCampo;
  pagina: number;
  estado: 'ok' | 'no_encontrado';
  /** Texto leído (tipo texto) o booleano de diligenciamiento (presencia/firma/checkbox). */
  valor: string | boolean | null;
  /** Densidad de tinta medida en la zona. */
  ratio?: number | null;
  /** Confianza 0-1. */
  conf: number;
  /** Rectángulo resuelto final (normalizado) — para el overlay. */
  rect: RectNorm | null;
  /** Captura JPEG (dataURL) de la zona resuelta. */
  crop?: string | null;
  fuente?: 'ancla' | 'respaldo' | 'referencia' | 'fija' | null;
  banderas: string[];
}

export interface ResultadoPaginaUniversal {
  pagina: number;
  ocr_conf: number;
  /** Vista previa JPEG (dataURL) de la página para el overlay de verificación. */
  preview?: string;
  campos: ResultadoCampoUniversal[];
}

export interface ResultadoUniversal {
  archivo: string;
  paginas: ResultadoPaginaUniversal[];
  total: number;
  ok_count: number;
  /** Score global 0-100. */
  score: number;
  obligatorios_faltantes: string[];
  requiere_revision: boolean;
  tiempos: { render_ms: number; ocr_ms: number; motor_ms: number };
}

// ---- Validación mínima de estructura ----

export function esMoldeUniversal(obj: unknown): obj is MoldeUniversal {
  if (typeof obj !== 'object' || obj === null) return false;
  const m = obj as Record<string, unknown>;
  if (m.tipo !== 'universal') return false;
  if (typeof m.nombre !== 'string' || !Array.isArray(m.campos)) return false;
  return m.campos.every((c) => {
    const f = c as Record<string, unknown>;
    return (
      typeof f.id === 'string' &&
      typeof f.etiqueta === 'string' &&
      typeof f.pagina === 'number' &&
      typeof f.tipo === 'string' &&
      typeof f.estrategia === 'string' &&
      typeof f.zona === 'object' &&
      f.zona !== null
    );
  });
}

/** ID corto y legible para nuevos campos: 'campo_ab12cd'. */
export function nuevoIdCampo(): string {
  return `campo_${Math.random().toString(36).slice(2, 8)}`;
}
