/**
 * Esquema de salida (compatible con datalab-convert / Chandra) e interfaces de
 * entrada del pipeline Tamiz. Ver README.md para el mapeo completo.
 *
 * Convenciones del esquema obtenidas de la ingeniería inversa de los JSON de
 * datalab-convert (ver demo/comparar.ts, que valida la paridad contra esos GT):
 *  - ids: `/page/{p}/{BlockType}/{n}` con n = contador por página en orden de
 *    lectura (el bloque Page usa su propio contador, siempre /page/{p}/Page/0).
 *  - polygon: [[x0,y0],[x1,y0],[x1,y1],[x0,y1]] con enteros (bbox axial).
 *  - block.html usa `<br/>` (los exports .html/.md normalizan a `<br>`).
 *  - images: { '{md5}_img.jpg': '<base64 JPEG sin prefijo data:>' }.
 *  - section_hierarchy: mapa nivel->id de las secciones abiertas
 *    (h1->'1', h4->'4', ...). Los SectionHeader llevan el mapa ANTES de abrirse.
 *  - page.html = concatenación de los hijos EXCLUYENDO PageHeader/PageFooter.
 *  - metadata: { page_stats: [{page_id, num_blocks}], failed_pages: [] }.
 */

export type Punto = [number, number];
export type BBox = [number, number, number, number]; // x0, y0, x1, y1

/** Bloque hoja en el esquema datalab. El orden de las claves ES parte del contrato. */
export interface BloqueChandra {
  id: string;
  block_type: string;
  html: string;
  page: number;
  polygon: Punto[];
  bbox: BBox;
  section_hierarchy: Record<string, string>;
  images: Record<string, string>;
  markdown: null;
  inference_failed: boolean;
  metadata: null | Record<string, unknown>;
}

/** Bloque Page (contenedor de los bloques hoja de una página). */
export interface PaginaChandra {
  html: string;
  bbox: BBox;
  polygon: Punto[];
  id: string;
  block_type: 'Page';
  children: BloqueChandra[];
  section_hierarchy: Record<string, string>;
  page: number;
}

/** Documento convertido completo (mismo esquema que consume importar-chandra.ts). */
export interface ConversionChandra {
  children: PaginaChandra[];
  metadata: {
    page_stats: { page_id: number; num_blocks: number }[];
    failed_pages: number[];
  };
}

// ===========================================================================
// Entrada: lo que el pipeline Tamiz ya produce hoy (regiones layout post-reglas
// estructurales + líneas RapidOCR + salidas SPARTAN de retícula).
// ===========================================================================

/** Línea OCR de RapidOCR (det+rec) con caja por línea en coords de página. */
export interface LineaOcr {
  bbox: BBox;
  texto: string;
  conf: number;
  /** Negrita detectada para toda la línea (opcional). */
  negrita?: boolean;
}

/** Retícula detectada por SPARTAN (tabla-detect.ts) para una región tabla/form. */
export interface Retricula {
  /** x de las líneas verticales (coords de página, bordes incluidos). */
  separadoresX: number[];
  /** y de las líneas horizontales (coords de página, bordes incluidos). */
  separadoresY: number[];
  /**
   * Segmentos verticales reales (líneas que NO cruzan toda la tabla). Si se
   * entregan, el colspan por banda de fila se deduce de aquí; si no, se asume
   * retícula completa (colspan 1 en todas las celdas).
   */
  segmentosV?: SegmentoV[];
}

export interface SegmentoV {
  x: number;
  y0: number;
  y1: number;
}

/** Recorte (firma / sello / imagen) dentro de una región, con su sub-bbox. */
export interface RecorteImagen {
  /** BBox del recorte DENTRO de la página (el que va al data-bbox). */
  bbox: BBox;
  /** Texto alternativo para el img (p.ej. 'Handwritten signature of the buyer'). */
  alt?: string;
  /**
   * JPEG base64 (sin prefijo data:). Se llena ANTES de serializar con
   * recortarConOffscreen/recortarConCanvas (donde vive el bitmap); si viene
   * vacío, el serializador intenta pag.cropper(bbox).
   */
  jpegB64?: string;
}

/** Región de layout final (post dla-onnx + reglas estructurales del molde). */
export interface RegionLayout {
  /** Clase PP-DocLayout o regla del molde (ver MAPEO_CLASES en serializar.ts). */
  clase: string;
  bbox: BBox;
  conf?: number;
  /** Nivel de encabezado 1..6 (doc_title=1, subtítulos de molde=4...). */
  nivel?: number;
  /** Orden explícito del molde; si alguna región lo trae, manda sobre la geometría. */
  orden?: number;
  /** Bandera de presencia de manuscrito (D-FINE). */
  manuscrito?: boolean;
  /** Retícula SPARTAN si la región es table/form. */
  tabla?: Retricula;
  /** 'Table' (retícula de datos) o 'Form' (retícula etiqueta:valor). Default 'Table'. */
  tipoTabla?: 'Table' | 'Form';
  /** Molde declara que la primera fila es encabezado (th). */
  thPrimeraFila?: boolean;
  /** Índices de fila con negrita (regla de molde, p.ej. la fila TOTAL). */
  filasNegrita?: number[];
  /** Etiqueta hasta ':' en negrita dentro de un párrafo (regla de molde). */
  negritaEtiqueta?: boolean;
  /** Recortes firma/sello/imagen dentro de la región (zonas del molde + D-FINE). */
  recortes?: RecorteImagen[];
  /** Líneas ya asignadas a la región (si el pipeline las lleva agrupadas). */
  lineas?: LineaOcr[];
}

/** Una página procesada por el pipeline. */
export interface PaginaPipeline {
  ancho: number;
  alto: number;
  /** Regiones finales en coords de página. */
  regiones: RegionLayout[];
  /** Líneas RapidOCR de toda la página (el serializador las asigna a regiones). */
  lineasRapid: LineaOcr[];
  /** Página fallida (no se pudo inferir) -> failed_pages + inference_failed. */
  fallida?: boolean;
  /**
   * Función de recorte inyectada: dado un bbox de página devuelve JPEG base64
   * (sin prefijo data:) o null si no hay imagen disponible. En el navegador
   * usar crearCropperBrowser() de recortes.ts sobre la imagen ya decodificada.
   */
  cropper?: (bbox: BBox) => string | null;
}

export interface SalidaPipeline {
  paginas: PaginaPipeline[];
}

// ===========================================================================
// Opciones del serializador
// ===========================================================================

export interface OpcionesConversion {
  /**
   * Si true, las banderas de Tamiz (manuscrito, origen de la región, conf) se
   * escriben en block.metadata (el esquema datalab lo deja null; opt-in para
   * no ensuciar la compatibilidad con importar-chandra).
   */
  incluirBanderas?: boolean;
  /** Callback de avisos (líneas OCR no asignadas a ninguna región, etc.). */
  onAviso?: (aviso: string) => void;
}
