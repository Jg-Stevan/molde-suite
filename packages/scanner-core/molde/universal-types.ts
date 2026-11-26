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
// - Estrategia "ancla_relacional" (v3.2.0 — corrección del dueño #2, «EL MOLDE
//   ES EL MAPA»): el molde declara `zona_busqueda` (EL FARO, OBLIGATORIA) y el
//   motor busca el ancla SOLO dentro de esa zona; la caja final se resuelve
//   RELATIVAMENTE al contexto local (banda adyacente, línea OCR o caja impresa
//   del faro) por direccion + orden + distancia. Cero búsquedas globales: lo
//   que queda fuera del faro NO existe para el campo (el «El abajo firmante
//   acepta…» de un párrafo legal jamás compite).
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
/** v3.2.0 agrega `ancla_relacional` (ADITIVO: zona_fija y ancla_relativa
 *  conservan su semántica exacta — retrocompatibilidad de los moldes v3.0/3.1). */
export type EstrategiaCampo = 'zona_fija' | 'ancla_relativa' | 'ancla_relacional';

/**
 * FASE 2 (v3.2.0 — corrección del dueño #2): relación que resuelve la caja
 * final a partir del CONTEXTO LOCAL del ancla, siempre DENTRO de
 * `zona_busqueda`. Nunca sobre la página completa.
 */
export interface RelacionAncla {
  /** Dirección del candidato respecto al ancla encontrada (o de referencia). */
  direccion: 'arriba' | 'abajo' | 'izquierda' | 'derecha';
  /**
   * Qué candidato se resuelve dentro del faro:
   *  - 'zona': la banda adyacente al ancla en la dirección pedida (del borde
   *    del ancla hasta el borde del faro) — el caso calibrado de firmas
   *    («la línea de firma es la banda ARRIBA de la etiqueta») y de valores
   *    «al lado» de la etiqueta. Default recomendado.
   *  - 'linea': una línea OCR del faro en la dirección pedida (valores en la
   *    línea vecina, no en la misma línea del ancla).
   *  - 'caja': un recuadro impreso hueco detectado dentro del faro (cuyo
   *    centro cae en la dirección pedida). Para cajas que CONTIENEN al ancla
   *    usa 'zona' con faro = la caja.
   */
  que: 'linea' | 'caja' | 'zona';
  /** 'mas_cercano' (default) o 'indice' (el N-ésimo más cercano). */
  orden: 'mas_cercano' | 'indice';
  /** Índice 1-indexado del candidato cuando `orden` = 'indice'. Si excede los
   *  candidatos encontrados NO se toma el último: cae a referencia con
   *  bandera `relacion_sin_candidato` (honesto, no se inventa). */
  indice?: number;
}

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
  /**
   * FASE 3 del plan (v3.3.0 — voto): desambiguadores PROPIOS de esta ancla
   * cuando el campo declara `anclas[]` (voto). Cada ancla vota SOLO si SU
   * contexto aparece cerca del hit; sin contexto declarado, la ancla vota
   * por texto + posición esperada. Si la ancla no declara los suyos aplica
   * `campo.desambiguadores` (compartidos). Opcional y retrocompatible.
   */
  desambiguadores?: string[];
  /**
   * FASE 3 del plan (v3.3.0 — voto): offset {x,y} + {w,h} DE ESTA ancla hacia
   * la zona del campo. Las anclas[] pueden vivir en BANDAS DISTINTAS de la
   * página (cabecera + pie): cada una necesita SU geometry para llegar al
   * MISMO rect final (eso es lo que hace que el consenso funcione). Si falta,
   * la ancla usa `campo.zona` (misma geometría que la ancla principal).
   */
  zona?: RectNorm;
}

/** FASE 3 del plan (v3.3.0 — múltiples anclas con voto): umbral de consenso.
 *  Dos votos "coinciden" si sus rects resueltos tienen centros a distancia
 *  normalizada ≤ VOTO_CONSENSO_DIST (o IoU ≥ 0.5). El valor tolera el jitter
 *  del OCR en la línea de la etiqueta (±2% de la página) sin aceptar etiquetas
 *  de otra banda del documento. */
export const VOTO_CONSENSO_DIST = 0.02;
/** FASE 3: límite sanitario de anclas por campo (el editor y el validador
 *  rechazan listas más largas — un campo con más de 6 anclas es un error de
 *  modelado, no una robustez). */
export const MAX_ANCLAS_VOTO = 6;

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
   * FASE 3 del plan (v3.3.0 — múltiples anclas con voto, opción 1.1 de la
   * conversación de mejora): anclas ADICIONALES que votan por consenso. El
   * motor resuelve CADA una (texto → fuzzy + desambiguadores propios o
   * compartidos) y acepta el campo solo cuando ≥2 votos coinciden en posición
   * (centros a ≤ VOTO_CONSENSO_DIST o IoU ≥ 0.5); la caja final es la media de
   * los rects del grupo ganador (bandera `ancla_consensuada`). Si TODOS los
   * votos presentes discrepan entre sí, el campo cae a la referencia con
   * bandera `anclas_discrepantes` (requiere_revision — jamás se escoge un
   * lado en silencio). Un único voto se comporta EXACTAMENTE como la ancla
   * única de siempre (retrocompatible). `ancla` sigue siendo la principal:
   * el editor la dibuja y el respaldo global (`ancla_respaldo`) solo se
   * consulta cuando NO hubo NINGÚN voto.
   */
  anclas?: AnclaUniversal[];
  /**
   * Solo para ancla_relativa: si es true, zona.x es ABSOLUTO (0-1 de la página)
   * y solo y se offsetea desde el ancla. Útil para bandas horizontales que
   * ocupan columnas fijas del documento (semántica del E-14 fila/banda).
   */
  x_absoluto?: boolean;
  /**
   * Umbral de densidad de tinta para presencia/firma/checkbox (0-1).
   * FASE 9 (v3.3.0, §7 — herencia): OPCIONAL — si falta, hereda de
   * `molde.herencia[tipo].umbral`; si tampoco hay herencia, el validador
   * exige declararlo (un campo de tinta sin umbral ni herencia es un molde
   * incompleto — jamás un default silencioso en tinta).
   */
  umbral?: number;
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
  /**
   * FASE 2 (v3.2.0 — corrección del dueño #2, «EL MOLDE ES EL MAPA»): SOLO
   * para `ancla_relacional`. EL FARO (obligatoria en esa estrategia): zona
   * aproximada 0-1 donde vive el ancla. El motor busca el ancla SOLO dentro
   * del faro (+ margen de tolerancia ~1%) y resuelve la caja relativa dentro
   * de ese contexto pequeño. Sin faro NO hay estrategia: el validador rechaza
   * el molde (no existen búsquedas globales de anclas, por diseño).
   */
  zona_busqueda?: RectNorm;
  /** FASE 2: relación con el contexto local que produce el rect final
   *  (ver RelacionAncla). Requerida en `ancla_relacional` (validada). */
  relacion?: RelacionAncla;
  /**
   * FASE 3 (v3.2.0 — endurecimiento de firmas): mínimo de TRAZOS (componentes
   * conexos de tinta, medidos con `metricasFirma` — la misma factorización que
   * ya usaba `clasificarMarcaSobreCrop`) esperados en un campo de tinta
   * (firma/presencia). Si el medidor encuentra MENOS, bandera
   * `trazos_insuficientes` + requiere_revision (jamás un ok silencioso).
   * Opcional; sin él el motor no añade exigencia nueva.
   */
  min_trazos?: number;
  /**
   * FASE 3: el campo declara esperar FIRMA (trazo humano). Con `obligatorio`
   * y cero trazos medidos el motor añade la bandera diagnóstica
   * `firma_ausente` (la zona se resolvió pero no hay rúbrica). Opcional: con
   * `tipo: 'firma'` el motor ya la aplica por defecto.
   */
  firma_esperada?: boolean;
  /**
   * FASE 4 (importador Chandra — interfaz táctica): grupo de lectura del
   * campo (Encabezado → Identificación → Cuerpo económico → Cierre/firmas).
   * Opcional y retrocompatible: moldes sin `grupo` se presentan igual que
   * siempre (lista plana). Solo presentación — cero lógica de negocio.
   */
  grupo?: string;
  /** FASE 4: índice de lectura (1-based) del campo dentro del documento,
   * derivado del orden de bloques de la salida Chandra. Opcional. */
  orden?: number;
  obligatorio: boolean;
  nota?: string;
}

/** Validación de cierre entre campos (Fase 2.2 igualdad; FASE 3 del plan
 * extracción relacional añade `rango`, ADITIVO). */
export interface ValidacionMolde {
  id: string;
  /**
   * igualdad: sumas entre IDs y números ("a == b + c + 5").
   * rango (FASE 3 — plan extracción relacional): comparación de FECHAS entre
   * dos campos de texto ("fecha_pago >= fecha_emision"). Los valores se
   * parsean en los formatos del contrato español (dd/mm/aaaa, dd-mm-aaaa,
   * «12 de noviembre de 2026», ISO aaaa-mm-dd); un operando sin fecha legible
   * deja la validación "no evaluable" (ok: null) — nunca inventa.
   */
  regla: 'igualdad' | 'rango';
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

// ---- FASE 4 del plan (v3.3.0): grupos de campos con restricciones espaciales ----
// §7 de la conversación de mejora: hace IMPOSIBLE por construcción que dos
// campos de una misma columna vertical resuelvan el mismo rect (J1/J3 de la
// auditoría de Frankfurt). Un grupo declara TIPO (semántica de default) y
// restricciones explícitas (override). El motor evalúa los grupos DESPUÉS de
// resolver los campos de cada página: una restricción violada NUNCA se
// calla — los campos implicados que estén 'ok' caen a `requiere_revision` con
// bandera `grupo_*` (explicable, evidencia geométrica).

/** Restricciones espaciales declaradas del grupo. */
export interface RestriccionesGrupo {
  /** Eje que los miembros COMPARTEN: 'y' (fila: centros a la misma altura) o
   *  'x' (columna: centros en la misma vertical). */
  alineacion?: 'x' | 'y';
  /** Orden requerido a lo largo del eje del grupo (columna → eje y;
   *  fila → eje x): los miembros EN EL ORDEN DECLARADO deben ser crecientes
   *  ('asc') o decrecientes ('desc') por centro. */
  orden?: 'asc' | 'desc';
  /** 'uniforme': los huecos entre centros consecutivos a lo largo del eje
   *  difieren a lo sumo `tolerancia`. 'libre' (default): sin exigencia. */
  espaciado?: 'uniforme' | 'libre';
  /** Tolerancia (fracción de la página) para alineación y espaciado. Default 0.02. */
  tolerancia?: number;
}

export interface GrupoMolde {
  id: string;
  /**
   * Semántica del default (restricciones explícitas SIEMPRE ganan):
   *  - 'fila': alineación 'y', espaciado libre.
   *  - 'columna': alineación 'x', espaciado libre.
   *  - 'repetidor' (FASE 9 §7 — tablas/facturas): alineación 'x' +
   *    espaciado 'uniforme' (los miembros son la MISMA celda repetida N
   *    veces; un hueco irregular delata una fila perdida o duplicada).
   *  - 'seccion': SIN restricciones espaciales (solo agrupa para
   *    presentación y auditoría — `campo.grupo` ya cubría presentación).
   */
  tipo: 'fila' | 'columna' | 'repetidor' | 'seccion';
  /** IDs de campo miembros (≥2 para evaluar geometría; con <2 el grupo es
   *  declarativo y el motor no opina). Todos los miembros DEBEN vivir en la
   *  MISMA página (validado en `erroresMolde`). */
  miembros: string[];
  /** Override de las restricciones del default del tipo. */
  restricciones?: RestriccionesGrupo;
  nota?: string;
}

/** Tolerancia default de los grupos (fracción de página — misma escala que
 *  las zonas; ±2% absorbe el jitter del OCR sin aceptar otras bandas). */
export const TOLERANCIA_GRUPO_DEFAULT = 0.02;

// ---- FASE 6 del plan (v3.3.0): "Cartero en cascada" — huella del documento ----
// Identificación BARATA del tipo de documento ANTES del análisis completo
// (1-2 s vs 10-40 s): frases clave siempre presentes en la cabecera + nº de
// páginas esperado. La cascada completa (QR → frases → esqueleto → duda)
// orquesta por app; el motor comparte la MÉTRICA (ver `identificarDocumento`).

export interface HuellaMolde {
  /** 3-5 frases SIEMPRE presentes en la cabecera de la página 1 ("RECIBO DE
   *  PAGO", "N.º Recibo"...). Se normalizan igual que las anclas. */
  frasesClave: string[];
  /** Nº de páginas esperado del documento (opcional). */
  paginas?: number;
  /** Franja de la página 1 donde viven las frases (0-1). Default: banda
   *  superior {x:0, y:0, w:1, h:0.2} — la cabecera vive arriba. */
  franja?: RectNorm;
  /** Frases mínimas para aceptar la identificación (default 2). */
  minFrases?: number;
}

// ---- FASE 9 del plan (v3.3.0): extras del modelo §7 ----

/** Herencia por TIPO de campo (§7): umbral/patrón por defecto que los campos
 *  de ese tipo heredan cuando no los declaran. ADDITIVO: `campo.umbral` pasa
 *  a ser OPCIONAL en el contrato (los moldes existentes lo declaran y ganan
 *  siempre sobre la herencia). `patron` ya era opcional. */
export type HerenciaMolde = Partial<
  Record<TipoCampo, { umbral?: number; patron?: string }>
>;

/** Fase 9 (§7): versión del ESQUEMA del contrato (independiente de la
 *  `version` de calibración del molde). 1 = el esquema vigente. Un número
 *  mayor al actual NO se carga (futuro-proofing honesto — el validador lo
 *  rechaza con mensaje claro en vez de adivinar). */
export const SCHEMA_VERSION_MOLDE = 1;

/** Fase 9 (§7): fixture embebido de "verdad de terreno" para «Probar
 *  Plantilla»: el molde declara lo que DEBE salir de un caso de prueba
 *  conocido y el Studio lo confronta contra la última corrida real. La
 *  imagen es OPCIONAL y por URL/ruta relativa (NUNCA dataURL embebido: peso
 *  del .json — misma regla que `paginasRef`). */
export interface FixtureMolde {
  id: string;
  /** Nombre del caso (p. ej. 'limpia', 'sin-firmas', 'campos-faltantes'). */
  nombre: string;
  /** Imagen de prueba (ruta relativa al repo/host del Studio; opcional). */
  imagen?: string;
  /** Valor esperado por campoId ('texto' exacto sin espacios extremos;
   *  boolean para tinta; number acepta el parseo numérico del motor). */
  esperado: Record<string, string | boolean | number>;
  /** Estado esperado por campoId (opcional — p. ej. 'no_encontrado' en un
   *  caso negativo donde el campo NO debe salir). */
  estadosEsperados?: Record<string, string>;
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
  /** FASE 4 del plan (v3.3.0): grupos de campos con restricciones espaciales
   *  (opcional y retrocompatible — sin grupos el motor no cambia nada). */
  grupos?: GrupoMolde[];
  /** FASE 6 del plan (v3.3.0): huella para la identificación en cascada del
   *  documento (frases clave de cabecera + nº de páginas). Opcional. */
  huella?: HuellaMolde;
  /** FASE 9 del plan (v3.3.0, §7): herencia por TIPO de campo (umbral/patrón
   *  default que los campos heredan si no los declaran). Opcional. */
  herencia?: HerenciaMolde;
  /** FASE 9 del plan (v3.3.0): fixtures de verdad de terreno para «Probar
   *  Plantilla». Opcional. */
  fixtures?: FixtureMolde[];
  /** FASE 9 del plan (v3.3.0): versión del ESQUEMA del contrato. Opcional
   *  (ausente = 1, el esquema vigente). Un número mayor NO carga. */
  schemaVersion?: number;
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

/** v3.3.0 (PLAN-DESARROLLO Fases 3/4/6/9): anclas[] con voto, grupos con
 *  restricciones espaciales, huella de cascada, herencia por tipo, fixtures
 *  de verdad de terreno y schemaVersion — TODO aditivo sobre 3.2.0; los
 *  moldes v3.0/3.1/3.2 quedan intactos. */
export const MOLDE_UNIVERSAL_VERSION = '3.3.0';

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
  /**
   * Overlay (azul): dónde el OCR encontró el texto del ANCLA (normalizado).
   * null cuando no hubo hit real (zona_fija, referencia, arnés). Aditivo.
   */
  ancla_rect?: RectNorm | null;
  /** Captura JPEG (dataURL) de la zona resuelta. */
  crop?: string | null;
  /** Dimensiones reales en px del crop generado (G-6: nunca hardcodear DPI). */
  crop_dims?: [number, number] | null;
  fuente?: 'ancla' | 'respaldo' | 'referencia' | 'fija' | 'arnes' | null;
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
  /**
   * FASE 3 (v3.2.0): métricas de firma (factorización `metricasFirma` de
   * marca.ts — densidad de tinta, Nº de trazos/componentes conexos y
   * extensión relativa del trazo). Presente SOLO en campos de tinta con
   * firma esperada (`tipo: 'firma'` o `firma_esperada: true`). Para la
   * verificación forense y el diagnóstico `firma_ausente`.
   */
  firma?: {
    trazos: number;
    densidad: number;
    extension: number;
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

/** Validación de `relacion` (v3.2.0 — solo estrategia ancla_relacional). */
function esRelacionValida(r: unknown): boolean {
  if (typeof r !== 'object' || r === null) return false;
  const q = r as Record<string, unknown>;
  if (
    q.direccion !== 'arriba' && q.direccion !== 'abajo' &&
    q.direccion !== 'izquierda' && q.direccion !== 'derecha'
  ) {
    return false;
  }
  if (q.que !== 'linea' && q.que !== 'caja' && q.que !== 'zona') return false;
  if (q.orden !== 'mas_cercano' && q.orden !== 'indice') return false;
  if (
    q.orden === 'indice' &&
    (typeof q.indice !== 'number' || !Number.isFinite(q.indice) || q.indice < 1)
  ) {
    return false;
  }
  return true;
}

/** Rect finito y dentro de la página (0-1) — el faro no puede vivir fuera. */
function esRectEnPagina(z: unknown): z is RectNorm {
  if (!esRectValido(z)) return false;
  const r = z as RectNorm;
  return (
    r.w > 0 && r.h > 0 &&
    r.x >= 0 && r.y >= 0 &&
    r.x + r.w <= 1 + 1e-9 && r.y + r.h <= 1 + 1e-9
  );
}

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
  // FASE 9: schemaVersion (opcional) — presente y mayor al esquema vigente NO
  // se carga (futuro-proofing honesto).
  if (m.schemaVersion !== undefined) {
    if (typeof m.schemaVersion !== 'number' || !Number.isInteger(m.schemaVersion) || m.schemaVersion < 1) return false;
    if (m.schemaVersion > SCHEMA_VERSION_MOLDE) return false;
  }
  if (m.grupos !== undefined && erroresGrupos(m.grupos, m.campos).length > 0) return false;
  if (m.herencia !== undefined && erroresHerencia(m.herencia).length > 0) return false;
  if (m.huella !== undefined && erroresHuella(m.huella).length > 0) return false;
  if (m.fixtures !== undefined && erroresFixtures(m.fixtures, idsCamposDe(m.campos)).length > 0) return false;
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
    // FASE 9 (herencia): umbral opcional — presente debe ser finito en [0,1];
    // ausente solo es válido si la herencia del tipo lo cubre (validado aquí
    // contra m.herencia; sin herencia, esMoldeUniversal lo rechaza).
    if (f.umbral !== undefined) {
      if (typeof f.umbral !== 'number' || !Number.isFinite(f.umbral) || f.umbral < 0 || f.umbral > 1) return false;
    } else {
      const h = m.herencia as Record<string, Record<string, unknown>> | undefined;
      const hu = h?.[f.tipo as string]?.umbral;
      if (typeof hu !== 'number' || !Number.isFinite(hu) || hu < 0 || hu > 1) return false;
    }
    if (
      f.desambiguadores !== undefined &&
      (!Array.isArray(f.desambiguadores) || !f.desambiguadores.every((d) => typeof d === 'string' && d.trim()))
    ) {
      return false;
    }
    // FASE 3 (voto): anclas[] opcional — cada entrada exige texto y rect
    // opcional válido; desambiguadores y zona propios válidos.
    if (f.anclas !== undefined) {
      if (!Array.isArray(f.anclas) || f.anclas.length < 2 || f.anclas.length > MAX_ANCLAS_VOTO) return false;
      const todasValidas = f.anclas.every((a) => {
        const an = a as Record<string, unknown>;
        if (!an || typeof an.texto !== 'string' || !an.texto.trim()) return false;
        if (an.rect !== undefined && !esRectValido(an.rect)) return false;
        if (an.zona !== undefined && !esRectValido(an.zona)) return false;
        if (
          an.desambiguadores !== undefined &&
          (!Array.isArray(an.desambiguadores) || !an.desambiguadores.every((d) => typeof d === 'string' && d.trim()))
        ) {
          return false;
        }
        return true;
      });
      if (!todasValidas) return false;
    }
    if (f.estrategia === 'ancla_relativa') {
      const ancla = f.ancla as Record<string, unknown> | undefined;
      if (!ancla || typeof ancla.texto !== 'string' || !ancla.texto.trim()) return false;
      if (ancla.rect !== undefined && !esRectValido(ancla.rect)) return false;
    }
    // v3.2.0 (regla del dueño #2): ancla_relacional SIN faro = molde inválido.
    if (f.estrategia === 'ancla_relacional') {
      const ancla = f.ancla as Record<string, unknown> | undefined;
      if (!ancla || typeof ancla.texto !== 'string' || !ancla.texto.trim()) return false;
      if (ancla.rect !== undefined && !esRectValido(ancla.rect)) return false;
      if (!esRectEnPagina(f.zona_busqueda)) return false;
      if (f.relacion !== undefined && !esRelacionValida(f.relacion)) return false;
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
  // FASE 9: schemaVersion — solo entero >= 1 y <= el esquema que este motor
  // entiende (un molde DEL FUTURO se rechaza con motivo, no se adivina).
  if (m.schemaVersion !== undefined) {
    if (typeof m.schemaVersion !== 'number' || !Number.isInteger(m.schemaVersion) || m.schemaVersion < 1) {
      errores.push('schemaVersion debe ser un entero >= 1');
    } else if (m.schemaVersion > SCHEMA_VERSION_MOLDE) {
      errores.push(
        `schemaVersion ${m.schemaVersion} no soportada (este motor entiende hasta la ${SCHEMA_VERSION_MOLDE}) — actualiza el motor`,
      );
    }
  }
  const ids = idsCamposDe(m.campos);
  if (m.grupos !== undefined) errores.push(...erroresGrupos(m.grupos, m.campos));
  if (m.herencia !== undefined) errores.push(...erroresHerencia(m.herencia));
  if (m.huella !== undefined) errores.push(...erroresHuella(m.huella));
  if (m.fixtures !== undefined) errores.push(...erroresFixtures(m.fixtures, ids));
  if (m.layout !== undefined) errores.push(...erroresLayout(m.layout, ids));
  m.campos.forEach((c, i) => {
    const f = c as Record<string, unknown>;
    const donde = `campo #${i + 1}${typeof f.id === 'string' ? ` (${f.id})` : ''}`;
    if (!esRectValido(f.zona)) errores.push(`${donde}: zona inválida (x/y/w/h finitos)`);
    // FASE 9 (herencia): umbral presente ∈ [0,1]; ausente exige herencia del
    // tipo (mensaje accionable, sin default silencioso en tinta).
    if (f.umbral !== undefined) {
      if (typeof f.umbral !== 'number' || !Number.isFinite(f.umbral) || f.umbral < 0 || f.umbral > 1) {
        errores.push(`${donde}: umbral debe ser un número en [0,1]`);
      }
    } else {
      const h = m.herencia as Record<string, Record<string, unknown>> | undefined;
      const hu = h?.[f.tipo as string]?.umbral;
      if (typeof hu !== 'number' || !Number.isFinite(hu) || hu < 0 || hu > 1) {
        errores.push(
          `${donde}: umbral ausente y sin herencia para el tipo "${String(f.tipo)}" — declara el umbral del campo o herencia.${f.tipo} con umbral (jamás un default silencioso en tinta)`,
        );
      }
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
    // FASE 3 (voto): anclas[] válida — array con 2..MAX_ANCLAS_VOTO entradas,
    // cada una con texto y (opcional) rect/desambiguadores propios.
    if (f.anclas !== undefined) {
      if (!Array.isArray(f.anclas)) {
        errores.push(`${donde}: anclas debe ser un arreglo`);
      } else if (f.anclas.length < 2) {
        errores.push(
          `${donde}: anclas debe tener al menos 2 anclas para votar (una sola usa "ancla"; el voto necesita consenso)`,
        );
      } else if (f.anclas.length > MAX_ANCLAS_VOTO) {
        errores.push(`${donde}: anclas supera el máximo de ${MAX_ANCLAS_VOTO} (un campo con más anclas es un error de modelado)`);
      } else {
        f.anclas.forEach((a, j) => {
          const an = a as Record<string, unknown>;
          const cual = `${donde}.anclas[${j + 1}]`;
          if (!an || typeof an.texto !== 'string' || !an.texto.trim()) {
            errores.push(`${cual}: texto de ancla no vacío`);
          }
          if (an?.rect !== undefined && !esRectValido(an.rect)) {
            errores.push(`${cual}: rect inválido (x/y/w/h finitos)`);
          }
          if (an?.zona !== undefined && !esRectValido(an.zona)) {
            errores.push(`${cual}: zona (offset de la ancla) inválida (x/y/w/h finitos)`);
          }
          if (
            an?.desambiguadores !== undefined &&
            (!Array.isArray(an.desambiguadores) || !an.desambiguadores.every((d) => typeof d === 'string' && d.trim()))
          ) {
            errores.push(`${cual}: desambiguadores debe ser un arreglo de textos no vacíos`);
          }
        });
      }
    }
    if (f.estrategia === 'ancla_relativa') {
      const ancla = f.ancla as Record<string, unknown> | undefined;
      if (!ancla || typeof ancla.texto !== 'string' || !ancla.texto.trim()) {
        errores.push(`${donde}: estrategia ancla_relativa exige ancla.texto no vacío`);
      }
    }
    if (f.estrategia === 'ancla_relacional') {
      const ancla = f.ancla as Record<string, unknown> | undefined;
      if (!ancla || typeof ancla.texto !== 'string' || !ancla.texto.trim()) {
        errores.push(`${donde}: estrategia ancla_relacional exige ancla.texto no vacío`);
      }
      // Regla del dueño #2 («EL MOLDE ES EL MAPA»): sin faro no hay búsqueda.
      if (!esRectEnPagina(f.zona_busqueda)) {
        errores.push(
          `${donde}: estrategia ancla_relacional exige zona_busqueda (el faro) válida y dentro de la página — sin faro NO hay búsqueda (nunca global)`,
        );
      }
      if (f.relacion !== undefined && !esRelacionValida(f.relacion)) {
        errores.push(
          `${donde}: relacion inválida (direccion arriba|abajo|izquierda|derecha · que linea|caja|zona · orden mas_cercano|indice · indice >= 1)`,
        );
      }
    }
  });
  return errores;
}

// ---- Validación de las extensiones v3.3.0 (Fases 3/4/6/9) ----

const TIPOS_GRUPO_VALIDOS = new Set(['fila', 'columna', 'repetidor', 'seccion']);

/** FASE 4: grupos con miembros existentes, únicos, misma página y
 *  restricciones coherentes. Un grupo malformado NO invalida silenciosamente:
 se reporta con motivo accionable (los grupos son una exigencia NUEVA del
 *  motor — mejor rechazar en el editor que degradar la corrida). */
function erroresGrupos(grupos: unknown, campos: unknown): string[] {
  const errores: string[] = [];
  if (!Array.isArray(grupos)) {
    errores.push('grupos debe ser un arreglo');
    return errores;
  }
  const paginasPorId = new Map<string, number>();
  for (const c of Array.isArray(campos) ? campos : []) {
    const f = c as Record<string, unknown>;
    if (typeof f?.id === 'string' && typeof f?.pagina === 'number') paginasPorId.set(f.id, f.pagina);
  }
  const idsVistosGrupo = new Set<string>();
  grupos.forEach((g, i) => {
    const donde = `grupos #${i + 1}${(g as Record<string, unknown>)?.id ? ` (${(g as Record<string, unknown>).id})` : ''}`;
    const r = g as Record<string, unknown>;
    if (typeof r !== 'object' || r === null) {
      errores.push(`${donde}: debe ser un objeto`);
      return;
    }
    if (typeof r.id !== 'string' || !r.id) errores.push(`${donde}: falta id`);
    else if (idsVistosGrupo.has(r.id)) errores.push(`${donde}: id de grupo duplicado`);
    else idsVistosGrupo.add(r.id);
    if (typeof r.tipo !== 'string' || !TIPOS_GRUPO_VALIDOS.has(r.tipo)) {
      errores.push(`${donde}: tipo debe ser fila|columna|repetidor|seccion`);
    }
    if (!Array.isArray(r.miembros) || r.miembros.length === 0) {
      errores.push(`${donde}: miembros debe ser un arreglo con al menos 1 campo`);
    } else {
      const vistos = new Set<string>();
      let paginaRef: number | null = null;
      r.miembros.forEach((mi, j) => {
        if (typeof mi !== 'string' || !mi) {
          errores.push(`${donde}: miembros[${j + 1}] debe ser un id de campo`);
          return;
        }
        if (!paginasPorId.has(mi)) errores.push(`${donde}: miembro "${mi}" no existe en molde.campos`);
        if (vistos.has(mi)) errores.push(`${donde}: miembro "${mi}" repetido dentro del grupo`);
        vistos.add(mi);
        const pg = paginasPorId.get(mi);
        if (pg !== undefined) {
          if (paginaRef === null) paginaRef = pg;
          else if (pg !== paginaRef) {
            errores.push(`${donde}: el miembro "${mi}" (pág. ${pg}) vive en otra página que el resto del grupo (pág. ${paginaRef}) — las restricciones espaciales son por página`);
          }
        }
      });
    }
    if (r.restricciones !== undefined) {
      const res = r.restricciones as Record<string, unknown>;
      if (typeof res !== 'object' || res === null) {
        errores.push(`${donde}: restricciones debe ser un objeto`);
      } else {
        if (
          res.alineacion !== undefined &&
          res.alineacion !== 'x' && res.alineacion !== 'y'
        ) {
          errores.push(`${donde}: restricciones.alineacion debe ser 'x' o 'y'`);
        }
        if (res.orden !== undefined && res.orden !== 'asc' && res.orden !== 'desc') {
          errores.push(`${donde}: restricciones.orden debe ser 'asc' o 'desc'`);
        }
        if (
          res.espaciado !== undefined &&
          res.espaciado !== 'uniforme' && res.espaciado !== 'libre'
        ) {
          errores.push(`${donde}: restricciones.espaciado debe ser 'uniforme' o 'libre'`);
        }
        if (
          res.tolerancia !== undefined &&
          (typeof res.tolerancia !== 'number' || !Number.isFinite(res.tolerancia) || res.tolerancia <= 0)
        ) {
          errores.push(`${donde}: restricciones.tolerancia debe ser un número > 0`);
        }
      }
    }
  });
  return errores;
}

/** FASE 9: herencia por tipo — solo tipos válidos con umbral/patrón finitos. */
function erroresHerencia(herencia: unknown): string[] {
  const errores: string[] = [];
  if (typeof herencia !== 'object' || herencia === null || Array.isArray(herencia)) {
    errores.push('herencia debe ser un objeto { tipo: { umbral?, patron? } }');
    return errores;
  }
  const TIPOS = new Set(['texto', 'presencia', 'firma', 'checkbox']);
  for (const [tipo, v] of Object.entries(herencia as Record<string, unknown>)) {
    if (!TIPOS.has(tipo)) {
      errores.push(`herencia: tipo "${tipo}" no es válido (texto|presencia|firma|checkbox)`);
      continue;
    }
    if (typeof v !== 'object' || v === null) {
      errores.push(`herencia.${tipo}: debe ser un objeto`);
      continue;
    }
    const h = v as Record<string, unknown>;
    if (
      h.umbral !== undefined &&
      (typeof h.umbral !== 'number' || !Number.isFinite(h.umbral) || h.umbral < 0 || h.umbral > 1)
    ) {
      errores.push(`herencia.${tipo}.umbral debe ser un número en [0,1]`);
    }
    if (h.patron !== undefined && (typeof h.patron !== 'string' || !h.patron)) {
      errores.push(`herencia.${tipo}.patron debe ser una regex no vacía`);
    }
  }
  return errores;
}

/** FASE 6: huella — 3-5 frases clave no vacías, minFrases ≥ 1 y franja válida. */
function erroresHuella(huella: unknown): string[] {
  const errores: string[] = [];
  if (typeof huella !== 'object' || huella === null || Array.isArray(huella)) {
    errores.push('huella debe ser un objeto');
    return errores;
  }
  const h = huella as Record<string, unknown>;
  if (!Array.isArray(h.frasesClave) || h.frasesClave.length < 3 || h.frasesClave.length > 5) {
    errores.push('huella.frasesClave debe tener entre 3 y 5 frases (menos de 3 no identifica; más de 5 frágil)');
  } else if (!h.frasesClave.every((f) => typeof f === 'string' && f.trim())) {
    errores.push('huella.frasesClave: todas las frases deben ser texto no vacío');
  }
  if (h.paginas !== undefined && (typeof h.paginas !== 'number' || !Number.isInteger(h.paginas) || h.paginas < 1)) {
    errores.push('huella.paginas debe ser un entero >= 1');
  }
  if (h.franja !== undefined && !esRectValido(h.franja)) {
    errores.push('huella.franja inválida (x/y/w/h finitos)');
  }
  if (h.minFrases !== undefined && (typeof h.minFrases !== 'number' || !Number.isInteger(h.minFrases) || h.minFrases < 1)) {
    errores.push('huella.minFrases debe ser un entero >= 1');
  }
  return errores;
}

/** FASE 9: fixtures de verdad de terreno — esperado con ids de campo reales. */
function erroresFixtures(fixtures: unknown, idsCampos: Set<string>): string[] {
  const errores: string[] = [];
  if (!Array.isArray(fixtures)) {
    errores.push('fixtures debe ser un arreglo');
    return errores;
  }
  const idsVistos = new Set<string>();
  fixtures.forEach((fx, i) => {
    const donde = `fixtures #${i + 1}`;
    const r = fx as Record<string, unknown>;
    if (typeof r !== 'object' || r === null) {
      errores.push(`${donde}: debe ser un objeto`);
      return;
    }
    if (typeof r.id !== 'string' || !r.id) errores.push(`${donde}: falta id`);
    else if (idsVistos.has(r.id)) errores.push(`${donde}: id duplicado`);
    else idsVistos.add(r.id);
    if (typeof r.nombre !== 'string' || !r.nombre) errores.push(`${donde}: falta nombre`);
    if (
      typeof r.esperado !== 'object' ||
      r.esperado === null ||
      Array.isArray(r.esperado) ||
      Object.keys(r.esperado as Record<string, unknown>).length === 0
    ) {
      errores.push(`${donde}: esperado debe ser un objeto con al menos un campoId → valor (verdad de terreno vacía no verifica nada)`);
    } else {
      for (const cid of Object.keys(r.esperado as Record<string, unknown>)) {
        if (!idsCampos.has(cid)) errores.push(`${donde}: esperado."${cid}" no existe en molde.campos`);
      }
    }
    if (r.estadosEsperados !== undefined) {
      if (typeof r.estadosEsperados !== 'object' || r.estadosEsperados === null || Array.isArray(r.estadosEsperados)) {
        errores.push(`${donde}: estadosEsperados debe ser un objeto`);
      } else {
        for (const cid of Object.keys(r.estadosEsperados as Record<string, unknown>)) {
          if (!idsCampos.has(cid)) errores.push(`${donde}: estadosEsperados."${cid}" no existe en molde.campos`);
        }
      }
    }
    if (r.imagen !== undefined && (typeof r.imagen !== 'string' || !r.imagen)) {
      errores.push(`${donde}: imagen debe ser una ruta/URL no vacía`);
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
