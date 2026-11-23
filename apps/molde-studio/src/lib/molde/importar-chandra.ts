// FASE 4 (plan v2 — corrección del dueño #3 «CANCELAR EL BOTÓN Y USAR
// CHANDRA OCR»): IMPORTADOR datalab-convert (salida Chandra) → MoldeUniversal
// v3.2.0.
//
// FILOSOFÍA (regla del dueño): EL HUMANO DEFINE EL MAPA, LA MÁQUINA LO
// EJECUTA. Este módulo NO genera zonas con IA ni auto-calibra: TRANSLADA el
// mapa que el humano entregó vía Chandra (bloques + bboxes) al contrato del
// motor, con:
//   - `zona_busqueda` (EL FARO) = bbox del bloque/celda medido por Chandra,
//     ampliado un margen generoso — el faro es generoso, la caja relativa fina.
//   - `relacion` = la semántica declarada del plan v2 §5.3: banda ARRIBA de la
//     etiqueta para firmas/fechas de línea («_____» + etiqueta), banda ABAJO
//     para celdas de formulario (etiqueta <b> arriba, valor <br/> abajo), banda
//     DERECHA para «Etiqueta: valor» en la misma línea.
//   - `grupo`/`orden` derivados de los bloques y sus secciones → interfaz
//     táctica (Encabezado → Identificación → Cuerpo → Cierre).
//   - Obligatorios PRECARGADOS con las matrices que el dueño ya produjo
//     (§5.4) — el humano los confirma/ajusta en la tabla de revisión.
//   - HONESTIDAD: `failed_pages`/`inference_failed` se reportan; bloques no
//     reconocidos se listan como «no mapeado» (nunca se descartan en silencio);
//     los rects ESTIMADOS (retícula uniforme de celdas) se marcan como tales.
//
// Funciones PURAS (sin DOM): el parser se prueba en scripts/ sin navegador.
// Cancelado definitivamente (regla 3): botón «Generar borrador», `borrador.ts`,
// `sidecar-client.ts` y el loop de auto-calibración — este archivo los
// sustituye con un flujo dirigido por el humano.

import { MOLDE_UNIVERSAL_VERSION, type CampoUniversal, type MoldeUniversal, type RelacionAncla, type RectNorm } from './universal-types';

// ---- Formato datalab-convert (verificado con los anexos reales del dueño) ----

export interface BloqueChandra {
  id?: string;
  block_type: string;
  html?: string | null;
  page?: number;
  bbox?: number[]; // [x0, y0, x1, y1] en px de la página
  polygon?: number[][][];
  section_hierarchy?: Record<string, string>;
  inference_failed?: boolean;
  markdown?: string | null;
  children?: BloqueChandra[];
}

export interface ChandraConvert {
  children?: BloqueChandra[]; // páginas (block_type 'Page')
  metadata?: { page_stats?: unknown[]; failed_pages?: number[] } | null;
}

// ---- Salida del importador ----

export interface CampoImportadoChandra {
  campo: CampoUniversal;
  /** true = algún rect es ESTIMADO (retícula uniforme) y NO medido por
   *  Chandra — la tabla de revisión lo señala para ajuste fino en el editor. */
  estimado: boolean;
  /** Nivel sugerido por la matriz del dueño (§5.4): Crítico/Obligatorio/
   *  Operativo/Condicional/Opcional — informativo para la revisión. */
  nivel: string;
  /** Bloque Chandra de origen (trazabilidad del mapa). */
  origen: string;
}

export interface AvisoChandra {
  nivel: 'info' | 'warn';
  mensaje: string;
}

export interface ResultadoImportacionChandra {
  molde: MoldeUniversal;
  campos: CampoImportadoChandra[];
  /** Bloques reconocidos pero no mapeados a campos (pie de variante). */
  ignorados: { blockType: string; resumen: string }[];
  /** Bloques NO reconocidos por el parser — honesto, nunca silencioso (§8). */
  noMapeados: { blockType: string; resumen: string }[];
  paginasFallidas: number[];
  avisos: AvisoChandra[];
  /** Título detectado (SectionHeader) para prellenar el nombre del molde. */
  titulo: string | null;
}

// ---- Utilidades geométricas (px → RectNorm 0-1) ----

function clamp01(v: number, max = 1): number {
  return Math.min(Math.max(v, 0), max);
}

/** Normaliza un bbox px contra el denominador de la página (plan §5.3). */
export function rectDesdeBbox(bbox: number[], pageW: number, pageH: number): RectNorm | null {
  if (!Array.isArray(bbox) || bbox.length < 4) return null;
  const [x0, y0, x1, y1] = bbox;
  if (![x0, y0, x1, y1].every((n) => Number.isFinite(n)) || pageW <= 0 || pageH <= 0) return null;
  const x = clamp01(Math.min(x0, x1) / pageW, 0.999);
  const y = clamp01(Math.min(y0, y1) / pageH, 0.999);
  return {
    x,
    y,
    w: Math.max(0.002, Math.min((Math.max(x0, x1) - Math.min(x0, x1)) / pageW, 1 - x)),
    h: Math.max(0.002, Math.min((Math.max(y0, y1) - Math.min(y0, y1)) / pageH, 1 - y)),
  };
}

/** Amplía un rect (fracciones de página) recortado al 0-1 — EL FARO ES
 *  GENEROSO: tolera el desplazamiento de la etiqueta entre variantes. */
export function expandirRect(r: RectNorm, dx: number, dy: number): RectNorm {
  const x = clamp01(r.x - dx, 0.999);
  const y = clamp01(r.y - dy, 0.999);
  return {
    x,
    y,
    w: Math.min(r.w + 2 * dx, 1 - x),
    h: Math.min(r.h + 2 * dy, 1 - y),
  };
}

// ---- Mini-parser HTML tolerante (Chandra emite HTML plano y consistente) ----

/** Elimina etiquetas y entidades de un fragmento → texto plano legible. */
export function textoPlano(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export interface CeldaHtml {
  /** true si la celda es un encabezado de sección (th) — alimenta `grupo`. */
  esHeader: boolean;
  /** Texto en NEGRILLA <b> (la etiqueta del campo) o null si no tiene. */
  negrilla: string | null;
  /** Texto restante de la celda (el valor impreso en VAR A) — informativo. */
  resto: string;
  /** Texto plano completo de la celda. */
  texto: string;
  colspan: number;
}

export interface FilaHtml {
  esHeader: boolean;
  celdas: CeldaHtml[];
}

/** Parser de <table> → filas/celdas SIN DOM (regex tolerante — el HTML de
 *  Chandra es generado por máquina; si cambia de forma, el bloque cae a
 *  «no mapeado», nunca se inventa estructura). */
export function parsearTablaHtml(html: string): FilaHtml[] | null {
  const tabla = html.match(/<table[\s\S]*?>([\s\S]*?)<\/table>/i);
  if (!tabla) return null;
  const filas: FilaHtml[] = [];
  const reTr = /<tr[\s\S]*?>([\s\S]*?)<\/tr>/gi;
  let mTr: RegExpExecArray | null;
  while ((mTr = reTr.exec(tabla[1])) !== null) {
    const cuerpoFila = mTr[1];
    const celdas: CeldaHtml[] = [];
    const reTd = /<(td|th)([^>]*)>([\s\S]*?)<\/\1>/gi;
    let mTd: RegExpExecArray | null;
    while ((mTd = reTd.exec(cuerpoFila)) !== null) {
      const attrs = mTd[2] ?? '';
      const contenido = mTd[3] ?? '';
      const colspanMatch = attrs.match(/colspan\s*=\s*["']?(\d+)/i);
      const colspan = colspanMatch ? Math.max(1, parseInt(colspanMatch[1], 10)) : 1;
      const bMatch = contenido.match(/<b>([\s\S]*?)<\/b>/i);
      const negrilla = bMatch ? textoPlano(bMatch[1]) : null;
      const resto = bMatch
        ? textoPlano(contenido.replace(/<b>[\s\S]*?<\/b>/i, ''))
        : textoPlano(contenido);
      celdas.push({
        esHeader: mTd[1].toLowerCase() === 'th',
        negrilla,
        resto,
        texto: textoPlano(contenido),
        colspan,
      });
    }
    if (celdas.length) {
      filas.push({ esHeader: celdas.every((c) => c.esHeader), celdas });
    }
  }
  return filas.length ? filas : null;
}

/** Normaliza una etiqueta para el ancla: sin «:» final, sin espacios dobles. */
function limpiarEtiqueta(s: string): string {
  return s.replace(/[:：]\s*$/, '').replace(/\s+/g, ' ').trim();
}

// ---- Matrices de OBLIGATORIOS precargadas (§5.4 — decisión del humano) ----

export type TipoDocChandra = 'comprobante' | 'recibo' | null;

/** Detecta el tipo de documento por el título (para precargar la matriz). */
export function detectarTipoDoc(titulo: string | null): TipoDocChandra {
  if (!titulo) return null;
  const t = titulo.toLowerCase();
  if (t.includes('comprobante')) return 'comprobante';
  if (t.includes('recibo')) return 'recibo';
  return null;
}

const sinAcentos = (s: string): string => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * Sugerencia de obligatoriedad PRECARGADA con las matrices del dueño (§5.4):
 *  - Comprobante (críticos): N.º Operación, Número de Documento, Firma del
 *    comprador, Fecha de entrega; obligatorios: Nombre y apellido, CALLE,
 *    NRO., Artículo; opcionales: Teléfono, PISO, DPTO., Descripción.
 *  - Recibo (críticos): Fecha, nombre+DNI de receptor y pagador, La suma de,
 *    ambas Firmas; operativos: N.º Recibo, En concepto de, Forma de pago,
 *    Fecha de pago; condicionales B2B: cargo/empresa/CIF de cada parte.
 * El orden de las reglas importa (los patrones más largos primero).
 */
export function sugerirObligatorio(
  tipoDoc: TipoDocChandra,
  etiqueta: string,
): { obligatorio: boolean; nivel: string } {
  const e = sinAcentos(etiqueta);
  if (tipoDoc === 'comprobante') {
    if (/(operacion|numero de documento|nro\.? documento|documento\b)/.test(e)) return { obligatorio: true, nivel: 'Crítico' };
    if (/firma/.test(e)) return { obligatorio: true, nivel: 'Crítico' };
    if (/fecha de entrega/.test(e)) return { obligatorio: true, nivel: 'Crítico' };
    if (/(nombre|calle|nro\b|articulo)/.test(e)) return { obligatorio: true, nivel: 'Obligatorio' };
    if (/(telefono|piso|dpto|descripcion)/.test(e)) return { obligatorio: false, nivel: 'Opcional' };
    return { obligatorio: false, nivel: 'Opcional' };
  }
  if (tipoDoc === 'recibo') {
    if (/firma/.test(e)) return { obligatorio: true, nivel: 'Crítico' };
    if (/fecha de pago/.test(e)) return { obligatorio: true, nivel: 'Operativo' };
    if (/(^|\b)fecha\b/.test(e)) return { obligatorio: true, nivel: 'Crítico' };
    if (/(nombre|dni|suma)/.test(e)) return { obligatorio: true, nivel: 'Crítico' };
    if (/(recibo|concepto|forma de pago)/.test(e)) return { obligatorio: true, nivel: 'Operativo' };
    if (/(cargo|empresa|cif)/.test(e)) return { obligatorio: false, nivel: 'Condicional (B2B)' };
    return { obligatorio: false, nivel: 'Opcional' };
  }
  return { obligatorio: false, nivel: 'Opcional' };
}

// ---- Nombres semánticos para los párrafos multi-valor (Recibo) ----

/** Últimas 1-3 palabras significativas de un prefijo → ancla del segmento. */
function anclaDesdePrefijo(prefijo: string): string {
  const palabras = limpiarEtiqueta(prefijo)
    .replace(/[,.]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 || /^[DdNn]\.$/.test(w));
  const significativas = palabras.filter((w) => !['de', 'del', 'la', 'el', 'con', 'en', 'y', 'por'].includes(w.toLowerCase()));
  const base = significativas.length ? significativas : palabras;
  return base.slice(-3).join(' ').trim();
}

/** Nombre semántico del campo a partir del prefijo (matriz del dueño §5.4). */
function nombreCampoDesdePrefijo(prefijo: string, esPrimero: boolean): string {
  const p = sinAcentos(prefijo);
  if (esPrimero && /recibi de/.test(p)) return 'Pagador · Nombre';
  if (esPrimero && /(^|\s)d\.?\s*$/.test(p.trim())) return 'Receptor · Nombre';
  if (/dni/.test(p)) return `${/recibi/.test(p) ? 'Pagador' : 'Receptor'} · DNI`;
  if (/calidad/.test(p)) return `${/recibi/.test(p) ? 'Pagador' : 'Receptor'} · Cargo`;
  if (/empresa/.test(p)) return `${/recibi/.test(p) ? 'Pagador' : 'Receptor'} · Empresa`;
  if (/cif/.test(p)) return `${/recibi/.test(p) ? 'Pagador' : 'Receptor'} · CIF`;
  if (/suma/.test(p)) return 'La suma de';
  if (/concepto/.test(p)) return 'En concepto de';
  const ancla = anclaDesdePrefijo(prefijo);
  return ancla || 'Campo de línea';
}

// ---- Mapeo bloque → campo (§5.3) ----

const REL_ZONA_ABAJO: RelacionAncla = { direccion: 'abajo', que: 'zona', orden: 'mas_cercano' };
const REL_ZONA_ARRIBA: RelacionAncla = { direccion: 'arriba', que: 'zona', orden: 'mas_cercano' };
const REL_ZONA_DERECHA: RelacionAncla = { direccion: 'derecha', que: 'zona', orden: 'mas_cercano' };

function campoBase(parcial: Partial<CampoUniversal> & Pick<CampoUniversal, 'id' | 'etiqueta' | 'pagina' | 'tipo' | 'estrategia' | 'zona' | 'umbral'>): CampoUniversal {
  return {
    obligatorio: false,
    ...parcial,
  };
}

/** Rects ESTIMADOS de las celdas de una tabla: retícula uniforme por filas y
 *  colspan (el plan §5.3 lo sanciona cuando Chandra no da bbox por celda).
 *  Se marca `estimado: true` — el humano ajusta en el editor si hace falta. */
function rectDeCelda(
  bloque: RectNorm,
  filas: FilaHtml[],
  iFila: number,
  iCelda: number,
): RectNorm {
  const nFilas = Math.max(1, filas.length);
  const fila = filas[iFila];
  const totalColspan = fila.celdas.reduce((a, c) => a + c.colspan, 0) || 1;
  const antes = fila.celdas.slice(0, iCelda).reduce((a, c) => a + c.colspan, 0);
  const y0 = bloque.y + (bloque.h * iFila) / nFilas;
  const y1 = bloque.y + (bloque.h * (iFila + 1)) / nFilas;
  const x0 = bloque.x + (bloque.w * antes) / totalColspan;
  const x1 = bloque.x + (bloque.w * (antes + fila.celdas[iCelda].colspan)) / totalColspan;
  return {
    x: clamp01(x0, 0.999),
    y: clamp01(y0, 0.999),
    w: Math.max(0.002, x1 - x0),
    h: Math.max(0.002, y1 - y0),
  };
}

let contadorCampos = 0;
function nuevoIdChandra(): string {
  contadorCampos += 1;
  return `chandra_${Date.now().toString(36)}_${contadorCampos}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Reinicia el contador de ids (para pruebas deterministas). */
export function reiniciarIdsChandra(): void {
  contadorCampos = 0;
}

/** Crea el campo texto «Etiqueta: valor» (misma línea — banda DERECHA). */
function campoTextoLinea(
  opts: { etiqueta: string; anclaTexto: string; bloque: RectNorm; faro: RectNorm; grupo: string; orden: number; tipoDoc: TipoDocChandra; finuraW?: number; pagina: number; origen: string; estimado?: boolean },
): CampoImportadoChandra {
  const sug = sugerirObligatorio(opts.tipoDoc, opts.etiqueta);
  const campo = campoBase({
    id: nuevoIdChandra(),
    etiqueta: opts.etiqueta,
    pagina: opts.pagina,
    tipo: 'texto',
    estrategia: 'ancla_relacional',
    zona: { x: opts.finuraW ? 0.006 : 0.008, y: -0.004, w: opts.finuraW ?? 0, h: 0 },
    ancla: { texto: opts.anclaTexto, rect: opts.bloque },
    zona_busqueda: opts.faro,
    relacion: REL_ZONA_DERECHA,
    umbral: 0.03,
    realce: true,
    grupo: opts.grupo,
    orden: opts.orden,
    obligatorio: sug.obligatorio,
    nota: `Importado de Chandra (${opts.origen})${opts.estimado ? ' · anchura de lectura ESTIMADA — ajustar en el editor con «Probar faro»' : ''}`,
  });
  return { campo, estimado: opts.estimado === true, nivel: sug.nivel, origen: opts.origen };
}

/** Párrafo multi-valor del Recibo («D. <b>Nombre</b>, con DNI <b>DNI</b>…») →
 *  un campo por valor <b>, ancla = prefijo anterior, banda derecha acotada. */
function camposDeParrafoMultiValor(
  opts: { html: string; bloque: RectNorm; faro: RectNorm; grupo: string; ordenBase: number; tipoDoc: TipoDocChandra; pagina: number; origen: string },
): CampoImportadoChandra[] {
  const salida: CampoImportadoChandra[] = [];
  // Segmentos alternados: [prefijo, <b>val1</b>, medio1, <b>val2</b>, medio2…]
  const partes = opts.html.split(/<b>[\s\S]*?<\/b>/i);
  const negrillas = [...opts.html.matchAll(/<b>([\s\S]*?)<\/b>/gi)].map((m) => textoPlano(m[1]));
  let orden = opts.ordenBase;
  for (let i = 0; i < negrillas.length; i++) {
    const prefijo = textoPlano(partes[i] ?? '');
    if (!prefijo) continue;
    const esPrimero = i === 0;
    const etiqueta = nombreCampoDesdePrefijo(prefijo, esPrimero);
    const anclaTexto = anclaDesdePrefijo(prefijo) || limpiarEtiqueta(prefijo);
    if (!anclaTexto) continue;
    const sug = sugerirObligatorio(opts.tipoDoc, etiqueta);
    salida.push({
      campo: campoBase({
        id: nuevoIdChandra(),
        etiqueta,
        pagina: opts.pagina,
        tipo: 'texto',
        estrategia: 'ancla_relacional',
        // Anchura de lectura ESTIMADA (el valor vive en la misma línea del
        // ancla, pero la banda derecha del faro incluye el texto siguiente).
        zona: { x: 0.006, y: -0.004, w: 0.14, h: 0 },
        ancla: { texto: anclaTexto, rect: opts.bloque },
        zona_busqueda: opts.faro,
        relacion: REL_ZONA_DERECHA,
        umbral: 0.03,
        realce: true,
        grupo: opts.grupo,
        orden,
        obligatorio: sug.obligatorio,
        nota: `Importado de Chandra (${opts.origen}) · anchura de lectura ESTIMADA — ajustar en el editor con «Probar faro»`,
      }),
      estimado: true,
      nivel: sug.nivel,
      origen: opts.origen,
    });
    orden += 1;
  }
  return salida;
}

/** Bloque «_____<br/><b>Etiqueta</b>» (Comprobante): firma/fecha ARRIBA de la
 *  etiqueta — exactamente la calibración v1.3.0 del dueño (§5.3). */
function campoSobreEtiqueta(
  opts: { etiqueta: string; bloque: RectNorm; faro: RectNorm; grupo: string; orden: number; tipoDoc: TipoDocChandra; pagina: number; origen: string },
): CampoImportadoChandra {
  const esFirma = /firma/i.test(opts.etiqueta);
  const sug = sugerirObligatorio(opts.tipoDoc, opts.etiqueta);
  const campo = campoBase({
    id: nuevoIdChandra(),
    etiqueta: opts.etiqueta,
    pagina: opts.pagina,
    tipo: esFirma ? 'firma' : 'texto',
    estrategia: 'ancla_relacional',
    zona: { x: 0, y: 0, w: 0, h: 0 },
    ancla: { texto: opts.etiqueta, rect: opts.bloque },
    zona_busqueda: opts.faro,
    relacion: REL_ZONA_ARRIBA,
    umbral: 0.03,
    ...(esFirma ? { firma_esperada: true, min_trazos: 1 } : { realce: true }),
    grupo: opts.grupo,
    orden: opts.orden,
    obligatorio: sug.obligatorio,
    nota: `Importado de Chandra (${opts.origen}) · ${esFirma ? 'firma = banda ARRIBA de la etiqueta (densidad de tinta, sin OCR)' : 'lectura de la banda ARRIBA de la etiqueta'}`,
  });
  return { campo, estimado: false, nivel: sug.nivel, origen: opts.origen };
}

// ---- Importador principal ----

export interface OpcionesChandra {
  /** Índice 0-based de la PÁGINA (variante) de referencia a importar. */
  pagina?: number;
  /** Nombre del molde (default: el título detectado). */
  nombre?: string;
}

export function pareceChandra(obj: unknown): obj is ChandraConvert {
  if (typeof obj !== 'object' || obj === null) return false;
  const q = obj as Record<string, unknown>;
  if (!Array.isArray(q.children) || q.children.length === 0) return false;
  const primera = q.children[0] as Record<string, unknown> | undefined;
  return (
    typeof primera === 'object' &&
    primera !== null &&
    (primera.block_type === 'Page' || Array.isArray(primera.children))
  );
}

/**
 * IMPORTADOR: salida Chandra (datalab-convert) → borrador de MoldeUniversal
 * v3.2.0. El humano entrega el JSON + su clasificación de obligatorios; este
 * módulo traduce el mapa a zonas ejecutables y presenta todo para revisión.
 */
export function importarChandra(obj: unknown, opciones: OpcionesChandra = {}): ResultadoImportacionChandra {
  reiniciarIdsChandra();
  const avisos: AvisoChandra[] = [];
  const ignorados: ResultadoImportacionChandra['ignorados'] = [];
  const noMapeados: ResultadoImportacionChandra['noMapeados'] = [];
  const campos: CampoImportadoChandra[] = [];

  const data = obj as ChandraConvert;
  const paginas = (data.children ?? []).filter((p) => p && p.block_type === 'Page');
  if (!paginas.length) {
    throw new Error('El JSON no contiene páginas de Chandra (children con block_type "Page").');
  }
  const idx = Math.min(Math.max(0, opciones.pagina ?? 0), paginas.length - 1);
  if (opciones.pagina !== undefined && opciones.pagina !== idx) {
    avisos.push({ nivel: 'warn', mensaje: `Página ${opciones.pagina + 1} inexistente — se importó la página ${idx + 1}.` });
  }
  const pagina = paginas[idx];
  const pageBbox = pagina.bbox ?? [0, 0, 0, 0];
  const pageW = pageBbox[2] - pageBbox[0] || 1;
  const pageH = pageBbox[3] - pageBbox[1] || 1;
  const numeroPagina = (pagina.page ?? idx) + 1;

  // Honestidad del import: fallos de inferencia se REPORTAN (§8) — no se
  // inventan zonas sobre páginas que Chandra no pudo leer.
  const fallidas = (data.metadata?.failed_pages ?? []).map((n) => Number(n));
  if (fallidas.length) {
    avisos.push({
      nivel: 'warn',
      mensaje: `Chandra reportó fallos de inferencia en las páginas: ${fallidas.map((n) => n + 1).join(', ')} — revisa esas variantes antes de validar.`,
    });
  }
  if (pagina.inference_failed) {
    avisos.push({ nivel: 'warn', mensaje: `La página ${idx + 1} tiene inference_failed — las zonas importadas pueden estar desplazadas.` });
  }

  let titulo: string | null = null;
  let grupo = 'Encabezado';
  let orden = 1;
  const bloques = pagina.children ?? [];

  for (const b of bloques) {
    const rectBloque = rectDesdeBbox(b.bbox ?? [], pageW, pageH);
    const origen = b.id ?? b.block_type;
    if (!rectBloque) {
      noMapeados.push({ blockType: b.block_type, resumen: 'sin bbox legible' });
      continue;
    }

    switch (b.block_type) {
      case 'SectionHeader': {
        const texto = textoPlano(b.html ?? '');
        titulo = texto || null;
        if (!texto) {
          noMapeados.push({ blockType: b.block_type, resumen: 'título vacío' });
          break;
        }
        const campo = campoBase({
          id: nuevoIdChandra(),
          etiqueta: texto,
          pagina: numeroPagina,
          tipo: 'texto',
          // La cabecera es RÍGIDA entre variantes (drift medido <1%): zona_fija
          // honesta. Su texto también sirve de ancla de identificación vía los
          // demás campos (enrutamiento usa los ancla.texto de los etiquetados).
          estrategia: 'zona_fija',
          zona: expandirRect(rectBloque, 0.01, 0.006),
          umbral: 0.03,
          grupo: 'Encabezado',
          orden,
          obligatorio: false,
          nota: `Importado de Chandra (SectionHeader — título del documento)`,
        });
        campos.push({ campo, estimado: false, nivel: 'Opcional', origen });
        orden += 1;
        break;
      }

      case 'Form': {
        const filas = parsearTablaHtml(b.html ?? '');
        if (!filas) {
          noMapeados.push({ blockType: b.block_type, resumen: (b.html ?? '').slice(0, 80) });
          break;
        }
        const bloque = rectBloque;
        const faro = expandirRect(bloque, 0.015, 0.01);
        let seccionForm = grupo;
        filas.forEach((fila, iF) => {
          // Fila th (o celdas sin <b> y sin valor) = título de sección del
          // formulario → alimenta `grupo` (interfaz táctica, §5.5).
          const soloTitulo = fila.esHeader || fila.celdas.every((c) => !c.negrilla && !c.resto);
          if (soloTitulo) {
            const t = textoPlano(fila.celdas.map((c) => c.texto).join(' '));
            if (t) seccionForm = t;
            return;
          }
          fila.celdas.forEach((celda, iC) => {
            // Subtítulo dentro de la tabla (con o sin <b>, SIN valor — ej.
            // «Dirección de entrega»): alimenta el subgrupo; no genera campo.
            if (!celda.resto) {
              const t = celda.negrilla ?? celda.texto;
              if (t) seccionForm = t;
              return;
            }
            if (!celda.negrilla) return;
            const etiqueta = limpiarEtiqueta(celda.negrilla);
            if (!etiqueta) return;
            const rectCelda = rectDeCelda(bloque, filas, iF, iC);
            const hayValor = Boolean(celda.resto);
            // Etiqueta ARRIBA del valor dentro de la celda (<br/>): banda
            // ABAJO de la etiqueta = la línea del valor (§5.3 Form).
            const campo = campoBase({
              id: nuevoIdChandra(),
              etiqueta,
              pagina: numeroPagina,
              tipo: 'texto',
              estrategia: 'ancla_relacional',
              zona: { x: 0, y: 0, w: 0, h: 0 },
              ancla: { texto: etiqueta, rect: rectCelda },
              zona_busqueda: expandirRect(rectCelda, 0.012, 0.008),
              relacion: hayValor ? REL_ZONA_ABAJO : REL_ZONA_DERECHA,
              umbral: 0.03,
              realce: true,
              grupo: seccionForm || grupo,
              orden,
              ...(sugerirObligatorio(detectarTipoDoc(titulo), etiqueta) as { obligatorio: boolean }),
              nota: `Importado de Chandra (Form/celda) · rect de celda ESTIMADO por retícula uniforme — ajustar en el editor con «Probar faro»`,
            });
            campos.push({ campo, estimado: true, nivel: sugerirObligatorio(detectarTipoDoc(titulo), etiqueta).nivel, origen });
            orden += 1;
          });
        });
        grupo = seccionForm || grupo;
        break;
      }

      case 'Text': {
        const html = b.html ?? '';
        const texto = textoPlano(html);
        if (!texto) {
          noMapeados.push({ blockType: b.block_type, resumen: 'texto vacío' });
          break;
        }
        const negrillas = [...html.matchAll(/<b>([\s\S]*?)<\/b>/gi)].map((m) => textoPlano(m[1]));
        const faro = expandirRect(rectBloque, 0.02, 0.012);

        // Caso 1 — banda de firma/fecha «_____<br/><b>Etiqueta</b>»: el valor
        // vive ARRIBA de la etiqueta (calibración v1.3.0 del dueño).
        const etiquetaUnica = negrillas.length === 1 ? negrillas[0] : null;
        const soloRayaYEtiq = /^\s*_+\s*/.test(texto) || /_\s*<br\s*\/?>/i.test(html);
        if (etiquetaUnica && soloRayaYEtiq) {
          campos.push(
            campoSobreEtiqueta({
              etiqueta: limpiarEtiqueta(etiquetaUnica),
              bloque: rectBloque,
              faro,
              grupo: 'Cierre / Conformidad',
              orden,
              tipoDoc: detectarTipoDoc(titulo),
              pagina: numeroPagina,
              origen,
            }),
          );
          orden += 1;
          break;
        }

        // Caso 2 — párrafo multi-valor («D. <b>Nombre</b>, con DNI <b>…</b>…»).
        if (negrillas.length >= 2) {
          const camposParrafo = camposDeParrafoMultiValor({
            html,
            bloque: rectBloque,
            faro,
            grupo: grupo === 'Encabezado' ? 'Identificación' : grupo,
            ordenBase: orden,
            tipoDoc: detectarTipoDoc(titulo),
            pagina: numeroPagina,
            origen,
          });
          if (camposParrafo.length) {
            campos.push(...camposParrafo);
            orden += camposParrafo.length;
            break;
          }
        }

        // Caso 3 — «Etiqueta: <b>valor</b>» en la MISMA línea: ancla = el
        // prefijo antes del primer <b>; sin prefijo («<b>Forma de pago:</b>
        // Transferencia») la propia negrilla ES la etiqueta — banda DERECHA.
        const partes = html.split(/<b>[\s\S]*?<\/b>/i);
        const prefijo = textoPlano(partes[0] ?? '');
        if (negrillas.length === 1) {
          const etiqueta = limpiarEtiqueta(prefijo) || limpiarEtiqueta(negrillas[0]);
          const anclaTexto = limpiarEtiqueta(prefijo) || limpiarEtiqueta(etiquetaUnica ?? '');
          if (etiqueta && anclaTexto) {
            campos.push(
              campoTextoLinea({
                etiqueta,
                anclaTexto,
                bloque: rectBloque,
                faro,
                grupo: /forma de pago|fecha de pago/i.test(texto) ? 'Cierre operativo' : grupo === 'Encabezado' ? 'Identificación' : grupo,
                orden,
                tipoDoc: detectarTipoDoc(titulo),
                pagina: numeroPagina,
                origen,
              }),
            );
            orden += 1;
            break;
          }
        }

        // Texto sin estructura reconocible → honesto: no mapeado.
        noMapeados.push({ blockType: b.block_type, resumen: texto.slice(0, 80) });
        break;
      }

      case 'Table': {
        const filas = parsearTablaHtml(b.html ?? '');
        if (!filas) {
          noMapeados.push({ blockType: b.block_type, resumen: (b.html ?? '').slice(0, 80) });
          break;
        }
        const bloque = rectBloque;
        // §5.3 (Recibo): una celda = un campo firma con FARO PROPIO — dos
        // celdas «Firma» = dos campos con faros separados (izq/der), sin
        // ambigüedad (el faro desambigua por posición).
        let nFirma = 0;
        filas.forEach((fila, iF) => {
          fila.celdas.forEach((celda, iC) => {
            const etiquetaCelda = limpiarEtiqueta(celda.negrilla ?? celda.texto);
            if (!etiquetaCelda) return;
            const rectCelda = rectDeCelda(bloque, filas, iF, iC);
            nFirma += 1;
            const lado = fila.celdas.length > 1 ? (iC === 0 ? 'izquierda' : 'derecha') : `celda ${iC + 1}`;
            const esFirma = /firma/i.test(etiquetaCelda);
            const sug = sugerirObligatorio(detectarTipoDoc(titulo), etiquetaCelda);
            const campo = campoBase({
              id: nuevoIdChandra(),
              etiqueta: `${etiquetaCelda} (${lado})`,
              pagina: numeroPagina,
              tipo: esFirma ? 'firma' : 'presencia',
              estrategia: 'ancla_relacional',
              zona: { x: 0, y: 0, w: 0, h: 0 },
              ancla: { texto: etiquetaCelda, rect: rectCelda },
              zona_busqueda: expandirRect(rectCelda, 0.008, 0.006),
              relacion: REL_ZONA_ARRIBA,
              ...(esFirma ? { firma_esperada: true, min_trazos: 1 } : {}),
              umbral: 0.03,
              grupo: 'Cierre / Firmas',
              orden,
              obligatorio: sug.obligatorio,
              nota: `Importado de Chandra (Table/celda ${nFirma}) · firma = banda ARRIBA de la etiqueta dentro de la celda · rect ESTIMADO por retícula uniforme`,
            });
            campos.push({ campo, estimado: true, nivel: sug.nivel, origen });
            orden += 1;
          });
        });
        if (!nFirma) {
          noMapeados.push({ blockType: b.block_type, resumen: 'tabla sin celdas legibles' });
        }
        break;
      }

      case 'PageFooter':
      case 'Header':
      case 'Picture':
      case 'Image': {
        // Metadato de variante / decoración: reconocido, NO genera campo — se
        // lista (nunca se descarta en silencio, §8).
        ignorados.push({ blockType: b.block_type, resumen: textoPlano(b.html ?? '').slice(0, 80) || 'sin texto' });
        break;
      }

      default:
        noMapeados.push({ blockType: b.block_type, resumen: textoPlano(b.html ?? '').slice(0, 80) || 'bloque no reconocido' });
        break;
    }
  }

  if (!campos.length) {
    throw new Error('Ningún bloque de la página se pudo mapear a campos — revisa el JSON de Chandra.');
  }

  const nombre =
    opciones.nombre?.trim() ||
    titulo?.trim() ||
    `Molde Chandra (página ${idx + 1})`;
  const tipoDoc = detectarTipoDoc(titulo);

  const molde: MoldeUniversal = {
    tipo: 'universal',
    version: MOLDE_UNIVERSAL_VERSION,
    nombre,
    descripcion: `Importado de la salida Chandra (datalab-convert), página ${idx + 1} de ${paginas.length}. El humano define el mapa; el motor lo ejecuta.`,
    documento: tipoDoc ?? 'documento_importado',
    idioma: 'es',
    campos: campos.map((c) => c.campo),
  };

  if (paginas.length > 1) {
    avisos.push({
      nivel: 'info',
      mensaje: `El archivo contiene ${paginas.length} variantes (páginas). Se importó la página ${idx + 1} como referencia — valida el molde contra TODAS las variantes (Verificación).`,
    });
  }
  if (noMapeados.length) {
    avisos.push({ nivel: 'warn', mensaje: `${noMapeados.length} bloque(s) no mapeado(s) — revisa la lista antes de crear el molde.` });
  }

  return { molde, campos, ignorados, noMapeados, paginasFallidas: fallidas, avisos, titulo };
}
