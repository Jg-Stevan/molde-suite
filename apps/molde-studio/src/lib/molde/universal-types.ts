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
// - `validaciones` (opcional): igualdades aritméticas de cierre entre campos
//   (p. ej. la suma total == suma de componentes). Si una validación falla,
//   los campos implicados quedan en `requiere_revision` (Fase 2.2 del plan).

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
  /**
   * Posición donde se encontró el ANCLA DE RESPALDO al alinear (N-2): se
   * guarda aparte y NUNCA sobrescribe `rect` (la referencia del primario),
   * para no sesgar las corridas futuras con la posición de un respaldo.
   */
  rectRespaldo?: RectNorm;
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
  /**
   * Regex opcional que debe cumplir el texto leído. Se evalúa ANCLADO: el
   * motor lo envuelve con ^(?:...)$ si el patrón no trae sus propios anclajes
   * (G-8: "ZONA: 05" ya no pasa contra \d{2}). Para capturar un subgrupo usa
   * `limpiar_valor`.
   */
  patron?: string;
  /**
   * Regex de extracción opcional (solo tipo texto): si el OCR devuelve basura
   * con etiqueta pegada ("ZONA: 05"), se extrae el primer grupo de captura
   * ("(\d{2})" -> "05") ANTES de validar contra `patron`.
   */
  limpiar_valor?: string;
  /** Whitelist de caracteres para el OCR del recorte (solo tipo texto). Ej: '0123456789'. */
  whitelist?: string;
  /**
   * Solo tipo texto: si la primera lectura falla (vacía o patron_no_cumple),
   * reintenta con realce (escala de grises + estiramiento de contraste + ampliación 3x).
   * Recomendado en manuscritos y fotos de baja calidad.
   */
  realce?: boolean;
  /**
   * Campo MANUSCRITO (HTR): Tesseract no es motor de escritura a mano, así que
   * la lectura nunca se considera definitiva — si el campo es obligatorio
   * SIEMPRE queda en revisión humana (opción C de la Fase 2.5: honestidad por
   * encima de invención). En opcionales solo marca la bandera `htr_manual`.
   */
  htr?: boolean;
  /**
   * Presentación (G-7): el valor de este campo se resalta en la lista de
   * Datos Variables. Sustituye a la heurística /total|pagar|valor|…/ de facturas.
   */
  destacado?: boolean;
  obligatorio: boolean;
  nota?: string;
}

/** Validación aritmética de cierre (Fase 2.2). */
export interface ValidacionMolde {
  id: string;
  regla: 'igualdad';
  /**
   * Igualdad de sumas entre IDs de campos y números, p. ej.:
   *   "suma_total == votos_candidato_1 + votos_candidato_2 + votos_blanco + 1"
   * Parser seguro (IDs + '+' + '==' + números), NO un evaluador JS genérico.
   * Un campo de tinta (presencia/firma/checkbox) cuenta como 1 si hay trazo y
   * 0 si no; un campo de texto se convierte a número (se normalizan espacios
   * y separadores de miles). Si algún operando no se pudo leer, la validación
   * queda "no evaluable" y la corrida requiere revisión.
   */
  expresion: string;
  /** Tolerancia absoluta de la igualdad (por defecto 0). */
  tolerancia?: number;
  descripcion?: string;
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
  /** Validaciones aritméticas de cierre entre campos (Fase 2.2). */
  validaciones?: ValidacionMolde[];
  /**
   * Metadatos de PRESENTACIÓN de la tarjeta en la Biblioteca (diseño Stitch).
   * G-1: `precision` fue eliminado — el score mostrado es SIEMPRE el calculado
   * de la última corrida real; `precision_declarada` es solo informativa.
   */
  meta?: {
    precision_declarada?: number;
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
  /**
   * ok: leído y dentro de reglas. no_encontrado: sin lectura válida.
   * requiere_revision: lectura dudosa (umbral al borde, confianza baja en
   * obligatorio, HTR manuscrito o validación aritmética fallida) — el valor
   * se muestra pero un humano debe confirmarlo.
   */
  estado: 'ok' | 'no_encontrado' | 'requiere_revision';
  /** Texto leído (tipo texto) o booleano de diligenciamiento (presencia/firma/checkbox). */
  valor: string | boolean | null;
  /** Densidad de tinta medida en la zona. */
  ratio?: number | null;
  /** Confianza 0-1 (null = el OCR no reportó confianza: "sin confianza reportada"). */
  conf: number | null;
  /** Rectángulo resuelto final (normalizado) — para el overlay. */
  rect: RectNorm | null;
  /** Captura JPEG (dataURL) de la zona resuelta. */
  crop?: string | null;
  /** Dimensiones reales en px del crop generado (G-6: nunca hardcodear DPI). */
  crop_dims?: [number, number] | null;
  fuente?: 'ancla' | 'respaldo' | 'referencia' | 'fija' | null;
  banderas: string[];
}

export interface ResultadoPaginaUniversal {
  pagina: number;
  /** Confianza global del OCR de la página (null = sin confianza reportada). */
  ocr_conf: number | null;
  /** Vista previa JPEG (dataURL) de la página para el overlay de verificación. */
  preview?: string;
  campos: ResultadoCampoUniversal[];
}

export interface ResultadoValidacion {
  id: string;
  expresion: string;
  /** true = igualdad satisfecha. null = no evaluable (campo sin lectura). */
  ok: boolean | null;
  detalle: string;
  /** Campos implicados en la expresión. */
  campos: string[];
}

export interface ResultadoUniversal {
  archivo: string;
  paginas: ResultadoPaginaUniversal[];
  total: number;
  ok_count: number;
  /**
   * Score global 0-100 = campos en estado 'ok' / total (G-2: 'requiere_revision'
   * NO cuenta como ok). Conceptos separados: `pct_diligenciado` (campos de
   * tinta con trazo / total de tinta) y `pct_lectura` (campos de texto con
   * valor válido / total de texto). Documentado en docs/FORMATO-MOLDE.md.
   */
  score: number;
  pct_diligenciado: number | null;
  pct_lectura: number | null;
  obligatorios_faltantes: string[];
  validaciones: ResultadoValidacion[];
  requiere_revision: boolean;
  tiempos: { render_ms: number; ocr_ms: number; motor_ms: number };
}

// ---- Validación de estructura (N-4: endurecida) ----

function esRectValido(z: unknown): z is RectNorm {
  if (typeof z !== 'object' || z === null) return false;
  const r = z as Record<string, unknown>;
  return (
    typeof r.x === 'number' && Number.isFinite(r.x) &&
    typeof r.y === 'number' && Number.isFinite(r.y) &&
    typeof r.w === 'number' && Number.isFinite(r.w) &&
    typeof r.h === 'number' && Number.isFinite(r.h)
  );
}

/**
 * Validación de estructura de un molde universal. Endurecida (N-4): además de
 * la forma, valida por campo que `zona` sea un rect finito, `umbral` un número
 * finito en [0,1], `pagina >= 1` y — en estrategia `ancla_relativa` — que
 * `ancla.texto` no esté vacío. Un molde malformado se rechaza aquí (API 400 /
 * editor) en vez de tumbar la corrida con IndexSizeError en runtime.
 */
export function esMoldeUniversal(obj: unknown): obj is MoldeUniversal {
  if (typeof obj !== 'object' || obj === null) return false;
  const m = obj as Record<string, unknown>;
  if (m.tipo !== 'universal') return false;
  if (typeof m.nombre !== 'string' || !Array.isArray(m.campos)) return false;
  return m.campos.every((c) => {
    const f = c as Record<string, unknown>;
    if (
      typeof f.id !== 'string' ||
      typeof f.etiqueta !== 'string' ||
      typeof f.pagina !== 'number' ||
      !Number.isInteger(f.pagina) ||
      f.pagina < 1 ||
      typeof f.tipo !== 'string' ||
      typeof f.estrategia !== 'string'
    ) {
      return false;
    }
    if (!esRectValido(f.zona)) return false;
    if (typeof f.umbral !== 'number' || !Number.isFinite(f.umbral) || f.umbral < 0 || f.umbral > 1) {
      return false;
    }
    if (f.estrategia === 'ancla_relativa') {
      const ancla = f.ancla as Record<string, unknown> | undefined;
      if (!ancla || typeof ancla.texto !== 'string' || !ancla.texto.trim()) return false;
      if (ancla.rect !== undefined && !esRectValido(ancla.rect)) return false;
    }
    if (f.obligatorio !== undefined && typeof f.obligatorio !== 'boolean') return false;
    return true;
  });
}

/**
 * Motivos legibles por los que un molde NO pasa `esMoldeUniversal` (para el
 * toast/400 con detalle, G-9: aplicarJson y la API los muestran al usuario).
 */
export function erroresMolde(obj: unknown): string[] {
  const errores: string[] = [];
  if (typeof obj !== 'object' || obj === null) return ['El JSON no es un objeto'];
  const m = obj as Record<string, unknown>;
  if (m.tipo !== 'universal') errores.push('tipo debe ser "universal"');
  if (typeof m.nombre !== 'string' || !m.nombre) errores.push('falta nombre');
  if (!Array.isArray(m.campos)) {
    errores.push('falta el arreglo campos');
    return errores;
  }
  m.campos.forEach((c, i) => {
    const f = c as Record<string, unknown>;
    const donde = `campo #${i + 1}${typeof f.id === 'string' ? ` (${f.id})` : ''}`;
    if (!esRectValido(f.zona)) errores.push(`${donde}: zona inválida (x/y/w/h finitos)`);
    if (typeof f.umbral !== 'number' || !Number.isFinite(f.umbral) || f.umbral < 0 || f.umbral > 1) {
      errores.push(`${donde}: umbral debe ser un número en [0,1]`);
    }
    if (typeof f.pagina !== 'number' || !Number.isInteger(f.pagina) || f.pagina < 1) {
      errores.push(`${donde}: pagina debe ser entero >= 1`);
    }
    if (f.estrategia === 'ancla_relativa') {
      const ancla = f.ancla as Record<string, unknown> | undefined;
      if (!ancla || typeof ancla.texto !== 'string' || !ancla.texto.trim()) {
        errores.push(`${donde}: estrategia ancla_relativa exige ancla.texto no vacío`);
      }
    }
  });
  return errores;
}

/** ID corto y legible para nuevos campos: 'campo_ab12cd'. */
export function nuevoIdCampo(): string {
  return `campo_${Math.random().toString(36).slice(2, 8)}`;
}

/** Umbral único de score "Preciso/Aprobado" (N-6: antes 80 / ≥98 / >98 según la vista). */
export const UMBRAL_APROBADO = 98;
