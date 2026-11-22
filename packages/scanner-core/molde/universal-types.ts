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
  /**
   * Opción 1.2 (conversación de mejora — desambiguadores de ancla): textos que
   * deben aparecer por OCR DENTRO de un radio normalizado (~0.3) del ancla
   * encontrada para que el hit sea aceptado. Ejemplo: el ancla "FIRMA JURADO 4"
   * puede declarar ["JURADO 3"] — si el match difuso alto fue en realidad la
   * etiqueta del jurado 2 en otra banda de la página, el contexto exigido no
   * aparece cerca y el hit se rechaza (cae a respaldo/referencia, con bandera
   * `desambiguacion_fallida`). Opcional y backward-compatible.
   */
  desambiguadores?: string[];
  /**
   * Fase A2 (blueprint DLA — diferencial SÍ/NO de la v2 B3 recuperado en v3):
   * ventanas IGUALES sobre el rect resuelto del campo (rects normalizados
   * RELATIVOS al crop). La tinta de la ventana SÍ menos la de la NO decide el
   * lado; las etiquetas impresas ("SÍ"/"NO") aparecen en ambas ventanas y se
   * cancelan entre sí. Opcional y backward-compatible: sin `si_no`, el campo
   * checkbox se comporta exactamente como siempre (ratio >= umbral).
   */
  si_no?: {
    ventana_si: RectNorm;
    ventana_no: RectNorm;
  };
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

// ---- Layout estructural (PLAN-AGENTE-LAYOUT §4.1 — extensión retrocompatible) ----
// Reglas DECLARATIVAS sobre la estructura conocida del documento: zonas donde
// el detector de layout (PP-DocLayout) debe encontrar N bloques de ciertas
// clases. Un molde SIN `layout` se comporta exactamente como siempre (Tamiz
// se salta la etapa); un molde CON `layout` agrega un gate estructural ANTES
// del OCR ("un documento equivocado no debe gastar un OCR completo").
// ADR-0001 (docs/adr/0001-reglas-layout-aditivas.md): `pagina` y las
// restricciones de tamaño (minW/maxW/minH/maxH) son campos ADITIVOS sobre el
// contrato del plan — necesarios para expresar las reglas E-14 validadas.

/** Clases canónicas del detector de layout (semántica compartida S/plus-L).
 *  Los alias de otros exportes (p. ej. "Picture", "Table") se NORMALIZAN a
 *  estas clases antes de evaluar reglas — jamás se comparan índices numéricos
 *  (los índices cambian entre exportaciones del ONNX). */
export type ClaseLayout =
  | 'text'
  | 'image'
  | 'table'
  | 'doc_title'
  | 'paragraph_title'
  | 'figure_title'
  | 'number'
  | 'header'
  | 'footer'
  | 'seal'
  | 'formula';

/** Una regla estructural: zona de la página + qué debe haber dentro. */
export interface ReglaLayout {
  id: string;
  etiqueta: string;
  /** Página 1-indexada a la que aplica la regla (default 1). */
  pagina?: number;
  /** Rectángulo normalizado 0-1 sobre la página. */
  zona: RectNorm;
  /** Margen de pertenencia (fracción de W/H que se agranda la zona). Default 0.02. */
  tolerancia?: number;
  /** Clases canónicas aceptadas dentro de la zona. */
  clases: ClaseLayout[];
  /** Score mínimo del pool de detecciones. Default 0.2. */
  minScore?: number;
  /** Restricciones de tamaño de la caja (fracciones 0-1 de la página). */
  minW?: number;
  maxW?: number;
  minH?: number;
  maxH?: number;
  /** Conteo esperado de bloques (defaults: 1 y 1). */
  minimo?: number;
  maximo?: number;
  /** Modo ESTRICTO: con candidatos fuertes sobrantes en la zona (tras NMS
   *  interno, no duplicados) el estado pasa a 'sobrante'. Default false — el
   *  prototipo validado (19/19) IGNORA los sobrantes y toma el top-N por
   *  score (las zonas con títulos contienen ruido extra que no es fallo). */
  estricto?: boolean;
  /** Regla obligatoria: si falta, el gate estructural RECHAZA temprano. */
  obligatorio: boolean;
  /** Enlace opcional con CampoUniversal para el OCR de la zona. */
  campoId?: string;
  /** Parte un contenedor fusionado (títulos en una sola caja, tablas juntas)
   *  por cortes relativos DENTRO del contenedor (fracciones 0-1 del eje y).
   *  N cortes → N+1 partes. */
  dividir?: {
    eje: 'y';
    cortes: number[];
    /** Una etiqueta por parte (opcional). */
    etiquetas?: string[];
    /** Un campo por parte (opcional). */
    campoIds?: string[];
  };
  nota?: string;
}

/** Extensión opcional del molde con reglas estructurales (v3.1.0). */
export interface LayoutMolde {
  version: 1;
  /** Modelo preferido para evaluar el gate ('s' rápido / 'plusL' fino).
   *  La decisión S vs plus-L quedó en la Fase 0 del plan (spike con métricas). */
  modeloPreferido: 's' | 'plusL';
  reglas: ReglaLayout[];
  /** Huella opcional para identificación rápida (clases mínimas esperadas). */
  firma?: { clases: ClaseLayout[]; minCoincidencias: number };
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
  /** Reglas estructurales opcionales (v3.1.0 — retrocompatible: sin layout,
   *  el motor y Tamiz se comportan exactamente como en v3.0.0). */
  layout?: LayoutMolde;
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

export const MOLDE_UNIVERSAL_VERSION = '3.1.0';

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
  /**
   * Fase A2 (blueprint DLA — port checkbox-extractor): clasificación de la
   * marca por forma/topología (caja impresa hueca + componente interior).
   * SEÑAL, no veredicto: si la forma discrepa del ratio de tinta, el motor
   * marca `forma_discrepa` + requiere_revision. Ausente en campos de texto.
   */
  marca?: {
    estado: 'vacia' | 'marcada' | 'borrosa';
    fillInterior: number | null;
    nInterior: number;
    cajaEncontrada: boolean;
  } | null;
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

const CLASES_LAYOUT_VALIDAS = new Set<string>([
  'text', 'image', 'table', 'doc_title', 'paragraph_title', 'figure_title',
  'number', 'header', 'footer', 'seal', 'formula',
]);

/** Validación de la extensión opcional `layout` (v3.1.0 — PLAN-AGENTE-LAYOUT
 *  §4.1): zonas finitas en 0-1, cortes crecientes en (0,1), minimo <= maximo,
 *  clases canónicas y `campoId` que exista en molde.campos. Un layout
 *  malformado NO invalida el molde completo: se reporta en `erroresMolde`. */
function erroresLayout(l: unknown, idsCampos: Set<string>): string[] {
  const errores: string[] = [];
  if (typeof l !== 'object' || l === null) {
    errores.push('layout debe ser un objeto');
    return errores;
  }
  const ly = l as Record<string, unknown>;
  if (ly.version !== 1) errores.push('layout.version debe ser 1');
  if (ly.modeloPreferido !== 's' && ly.modeloPreferido !== 'plusL') {
    errores.push('layout.modeloPreferido debe ser "s" o "plusL"');
  }
  if (!Array.isArray(ly.reglas)) {
    errores.push('layout.reglas debe ser un arreglo');
    return errores;
  }
  ly.reglas.forEach((r, i) => {
    const donde = `layout.reglas #${i + 1}${typeof (r as Record<string, unknown>).id === 'string' ? ` (${(r as Record<string, unknown>).id})` : ''}`;
    if (typeof r !== 'object' || r === null) {
      errores.push(`${donde}: debe ser un objeto`);
      return;
    }
    const g = r as Record<string, unknown>;
    if (typeof g.id !== 'string' || !g.id.trim()) errores.push(`${donde}: id requerido`);
    if (typeof g.etiqueta !== 'string' || !g.etiqueta.trim()) errores.push(`${donde}: etiqueta requerida`);
    if (g.pagina !== undefined && (typeof g.pagina !== 'number' || !Number.isInteger(g.pagina) || g.pagina < 1)) {
      errores.push(`${donde}: pagina debe ser entero >= 1`);
    }
    if (!esRectValido(g.zona)) {
      errores.push(`${donde}: zona inválida (x/y/w/h finitos)`);
    } else {
      const z = g.zona as RectNorm;
      const fuera =
        z.x < 0 || z.y < 0 || z.w <= 0 || z.h <= 0 ||
        z.x + z.w > 1 + 1e-9 || z.y + z.h > 1 + 1e-9;
      if (fuera) errores.push(`${donde}: zona fuera de la página (0-1)`);
    }
    if (
      !Array.isArray(g.clases) || g.clases.length === 0 ||
      !g.clases.every((c) => typeof c === 'string' && CLASES_LAYOUT_VALIDAS.has(c))
    ) {
      errores.push(`${donde}: clases debe incluir clases canónicas válidas`);
    }
    if (
      g.minScore !== undefined &&
      (typeof g.minScore !== 'number' || !Number.isFinite(g.minScore) || g.minScore < 0 || g.minScore > 1)
    ) {
      errores.push(`${donde}: minScore debe ser número en [0,1]`);
    }
    for (const k of ['minW', 'maxW', 'minH', 'maxH'] as const) {
      const v = g[k];
      if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1)) {
        errores.push(`${donde}: ${k} debe ser número en [0,1]`);
      }
    }
    const minimo = typeof g.minimo === 'number' ? g.minimo : 1;
    const maximo = typeof g.maximo === 'number' ? g.maximo : 1;
    if (minimo < 0 || maximo < 0 || minimo > maximo) {
      errores.push(`${donde}: minimo <= maximo requerido (${minimo} vs ${maximo})`);
    }
    if (g.obligatorio !== undefined && typeof g.obligatorio !== 'boolean') {
      errores.push(`${donde}: obligatorio debe ser booleano`);
    }
    if (g.estricto !== undefined && typeof g.estricto !== 'boolean') {
      errores.push(`${donde}: estricto debe ser booleano`);
    }
    if (g.campoId !== undefined && (typeof g.campoId !== 'string' || !idsCampos.has(g.campoId))) {
      errores.push(`${donde}: campoId "${String(g.campoId)}" no existe en molde.campos`);
    }
    if (g.dividir !== undefined) {
      const d = g.dividir as Record<string, unknown>;
      if (typeof d !== 'object' || d === null || d.eje !== 'y') {
        errores.push(`${donde}: dividir.eje debe ser "y"`);
      } else {
        const cortes = d.cortes;
        if (
          !Array.isArray(cortes) || cortes.length === 0 ||
          !cortes.every((c) => typeof c === 'number' && Number.isFinite(c) && c > 0 && c < 1)
        ) {
          errores.push(`${donde}: dividir.cortes debe ser cortes finitos en (0,1)`);
        } else {
          for (let k = 1; k < cortes.length; k++) {
            if (cortes[k] <= cortes[k - 1]) {
              errores.push(`${donde}: dividir.cortes debe ser creciente`);
              break;
            }
          }
          const partes = cortes.length + 1;
          for (const k of ['etiquetas', 'campoIds'] as const) {
            const v = d[k];
            if (v !== undefined && (!Array.isArray(v) || v.length !== partes)) {
              errores.push(`${donde}: dividir.${k} debe tener ${partes} elementos (una por parte)`);
            }
          }
          if (Array.isArray(d.campoIds)) {
            for (const cid of d.campoIds) {
              if (typeof cid === 'string' && cid && !idsCampos.has(cid)) {
                errores.push(`${donde}: dividir.campoIds "${cid}" no existe en molde.campos`);
              }
            }
          }
        }
      }
    }
  });
  const firma = ly.firma;
  if (firma !== undefined) {
    const f = firma as Record<string, unknown>;
    if (
      typeof f !== 'object' || f === null ||
      !Array.isArray(f.clases) || !f.clases.every((c) => typeof c === 'string' && CLASES_LAYOUT_VALIDAS.has(c)) ||
      typeof f.minCoincidencias !== 'number' || !Number.isFinite(f.minCoincidencias) || f.minCoincidencias < 1
    ) {
      errores.push('layout.firma inválida (clases canónicas + minCoincidencias >= 1)');
    }
  }
  return errores;
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
  if (m.layout !== undefined && erroresLayout(m.layout, idsCamposDe(m.campos)).length > 0) return false;
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
    if (
      f.desambiguadores !== undefined &&
      (!Array.isArray(f.desambiguadores) || !f.desambiguadores.every((d) => typeof d === 'string' && d.trim()))
    ) {
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
  if (m.layout !== undefined) errores.push(...erroresLayout(m.layout, idsCamposDe(m.campos)));
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
    if (
      f.desambiguadores !== undefined &&
      (!Array.isArray(f.desambiguadores) || !f.desambiguadores.every((d) => typeof d === 'string' && d.trim()))
    ) {
      errores.push(`${donde}: desambiguadores debe ser un arreglo de textos no vacíos`);
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

/** IDs de campos del molde (para validar campoId/campoIds de las reglas). */
function idsCamposDe(campos: unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const c of campos) {
    const id = (c as Record<string, unknown> | null)?.id;
    if (typeof id === 'string') ids.add(id);
  }
  return ids;
}

/** ID corto y legible para nuevos campos: 'campo_ab12cd'. */
export function nuevoIdCampo(): string {
  return `campo_${Math.random().toString(36).slice(2, 8)}`;
}

/** Umbral único de score "Preciso/Aprobado" (N-6: antes 80 / ≥98 / >98 según la vista). */
export const UMBRAL_APROBADO = 98;
