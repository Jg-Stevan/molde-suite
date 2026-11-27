/**
 * Fase 1 — Serializador datalab-like.
 * Toma la salida del pipeline Tamiz (regiones layout post-reglas estructurales
 * + líneas RapidOCR + retículas SPARTAN + recortes) y emite el JSON en el
 * esquema exacto de datalab-convert, más los exports .md y .html.
 *
 * El resultado pasa `pareceChandraPropio()` (autochequeo de esquema) y es
 * consumible por importar-chandra.ts sin cambios — la conversión hecha en el
 * celular recalibra moldes en Studio sin tocar Datalab.
 */

import { ordenarRegiones } from './lectura';
import { htmlFirmaInline, htmlPie, htmlPicture, htmlSeccion, htmlTexto } from './html';
import { armarTabla } from './tablas';
import { exportarMarkdown } from './md';
import { exportarHtml } from './exportHtml';
import { base64ABytes, nombreArchivoImagen } from './md5';
import type {
  BBox,
  BloqueChandra,
  ConversionChandra,
  LineaOcr,
  PaginaChandra,
  PaginaPipeline,
  RegionLayout,
  SalidaPipeline,
  OpcionesConversion,
} from './types';

export * from './types';
export { ordenarRegiones, esFooter, esHeader } from './lectura';
export { armarTabla, htmlDeEstructura } from './tablas';
export { exportarMarkdown } from './md';
export { exportarHtml } from './exportHtml';
export { recortarConOffscreen, recortarConCanvas, recortarTodos, bitmapDesdeBytes } from './recortes';
export { md5Hex, nombreArchivoImagen, bytesABase64, base64ABytes } from './md5';
export { escapar, htmlTexto, htmlSeccion, htmlFirmaInline, htmlPicture } from './html';

/** Clases PP-DocLayout / molde -> block_type datalab. */
export const MAPEO_CLASES: Record<string, string> = {
  doc_title: 'SectionHeader',
  title: 'SectionHeader',
  section_header: 'SectionHeader',
  subtitle: 'SectionHeader',
  plain_text: 'Text',
  text: 'Text',
  paragraph: 'Text',
  abstract: 'Text',
  list: 'List-item',
  table: 'Table',
  form: 'Form',
  image: 'Picture',
  figure: 'Picture',
  picture: 'Picture',
  seal: 'Picture',
  stamp: 'Picture',
  footer: 'PageFooter',
  header: 'PageHeader',
  page_footer: 'PageFooter',
  page_header: 'PageHeader',
};

function tipoDeRegion(r: RegionLayout): string {
  const clave = r.clase.toLowerCase();
  if (MAPEO_CLASES[clave]) return MAPEO_CLASES[clave];
  // si el molde ya usa el nombre datalab directamente, respetarlo
  if (['Text', 'SectionHeader', 'Table', 'Form', 'Picture', 'PageFooter', 'PageHeader', 'List-item', 'Title'].includes(r.clase)) {
    return r.clase;
  }
  return 'Text';
}

function polygonDe(bbox: BBox): [number, number][] {
  const [x0, y0, x1, y1] = bbox.map(Math.round);
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

function centro(bbox: BBox): [number, number] {
  return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
}

/** Asigna las líneas de la página a cada región por centro (las tablas primero). */
function asignarLineas(
  regionesOrdenadas: RegionLayout[],
  pool: LineaOcr[],
  onAviso?: (a: string) => void,
): Map<RegionLayout, LineaOcr[]> {
  const asignadas = new Map<RegionLayout, LineaOcr[]>();
  const libres = new Set(pool);
  for (const r of regionesOrdenadas) {
    if (r.lineas) {
      // líneas ya agrupadas por el pipeline
      r.lineas.forEach((l) => libres.delete(l));
      asignadas.set(r, r.lineas);
      continue;
    }
    const tipo = tipoDeRegion(r);
    const esTabla = tipo === 'Table' || tipo === 'Form';
    const dentro = [...libres].filter((l) => {
      const [cx, cy] = centro(l.bbox);
      return cx >= r.bbox[0] && cx <= r.bbox[2] && cy >= r.bbox[1] && cy <= r.bbox[3];
    });
    dentro.sort((a, b) =>
      a.bbox[1] !== b.bbox[1] ? a.bbox[1] - b.bbox[1] : a.bbox[0] - b.bbox[0],
    );
    dentro.forEach((l) => libres.delete(l));
    asignadas.set(r, dentro);
  }
  if (libres.size > 0 && onAviso) {
    onAviso(`${libres.size} línea(s) OCR sin región contenedora (revisar cobertura del molde)`);
  }
  return asignadas;
}

/** Serializa UNA página del pipeline a su bloque Page + lista de bloques hoja. */
function serializarPagina(
  pag: PaginaPipeline,
  pagIdx: number,
  opciones: OpcionesConversion,
): PaginaChandra {
  const ordenadas = ordenarRegiones(pag.regiones);
  const lineasPorRegion = asignarLineas(ordenadas, pag.lineasRapid, opciones.onAviso);

  // 1) construir "protobloques" en orden, con su html/images
  interface Proto {
    tipo: string;
    bbox: BBox;
    html: string;
    images: Record<string, string>;
    region: RegionLayout;
  }
  const protos: Proto[] = [];
  for (const r of ordenadas) {
    const tipo = tipoDeRegion(r);
    const mias = lineasPorRegion.get(r) ?? [];
    const proto: Proto = { tipo, bbox: r.bbox, html: '', images: {}, region: r };

    if (tipo === 'Table' || tipo === 'Form') {
      if (!r.tabla) {
        opciones.onAviso?.(`Región ${r.clase} sin retícula SPARTAN: se emite como texto`);
        proto.html = htmlTexto(mias, { negritaEtiqueta: r.negritaEtiqueta });
      } else {
        proto.html = armarTabla(r.tabla, mias, r.bbox, {
          thPrimeraFila: r.thPrimeraFila,
          filasNegrita: r.filasNegrita,
        }).html;
      }
    } else if (tipo === 'SectionHeader') {
      proto.html = htmlSeccion(r.nivel ?? 1, mias);
    } else if (tipo === 'Picture') {
      const rec = r.recortes?.[0];
      if (rec) {
        const b64 = rec.jpegB64 ?? pag.cropper?.(rec.bbox) ?? null;
        if (b64) {
          const fn = nombreArchivoImagen(base64ABytes(b64));
          proto.images[fn] = b64;
          proto.html = htmlPicture(fn);
        } else {
          opciones.onAviso?.('Picture sin recorte disponible: se emite bloque vacío');
          proto.html = htmlPicture('sin-imagen_img.jpg');
        }
      } else {
        proto.html = htmlPicture('sin-imagen_img.jpg');
      }
    } else if ((tipo === 'Text' || tipo === 'List-item') && r.recortes && r.recortes.length > 0) {
      // firma inline dentro del texto: crop + caption impreso
      const rec = r.recortes[0];
      const b64 = rec.jpegB64 ?? pag.cropper?.(rec.bbox) ?? null;
      const caption = mias.map((l) => l.texto).join(' ');
      if (b64) {
        const fn = nombreArchivoImagen(base64ABytes(b64));
        proto.images[fn] = b64;
        proto.html = htmlFirmaInline(rec, fn, caption);
      } else {
        opciones.onAviso?.('Firma sin recorte disponible: se emite solo el caption');
        proto.html = htmlTexto(mias);
      }
    } else if (tipo === 'PageFooter' || tipo === 'PageHeader') {
      proto.html = htmlPie(mias);
    } else {
      proto.html = htmlTexto(mias, { negritaEtiqueta: r.negritaEtiqueta });
    }
    protos.push(proto);
  }

  // 2) ids (contador por página en orden de lectura) + jerarquía de secciones
  const abiertas: Record<number, string> = {};
  const bloques: BloqueChandra[] = protos.map((p, i) => {
    const id = `/page/${pagIdx}/${p.tipo}/${i}`;
    let jerarquia: Record<string, string>;
    if (p.tipo === 'SectionHeader') {
      const nivel = p.region.nivel ?? 1;
      for (const nivelKey of Object.keys(abiertas).map(Number)) {
        if (nivelKey >= nivel) delete abiertas[nivelKey];
      }
      jerarquia = { ...abiertas };
      abiertas[nivel] = id;
    } else {
      jerarquia = { ...abiertas };
    }
    jerarquia = Object.fromEntries(
      Object.entries(jerarquia).sort(([a], [b]) => Number(a) - Number(b)),
    );

    const banderas =
      opciones.incluirBanderas && (p.region.manuscrito || p.region.conf !== undefined)
        ? {
            tamiz: {
              manuscrito: p.region.manuscrito ?? false,
              conf: p.region.conf,
              clase_origen: p.region.clase,
            },
          }
        : null;

    const bloque: BloqueChandra = {
      id,
      block_type: p.tipo,
      html: p.html,
      page: pagIdx,
      polygon: polygonDe(p.bbox),
      bbox: p.bbox.map(Math.round) as BBox,
      section_hierarchy: jerarquia,
      images: p.images,
      markdown: null,
      inference_failed: !!pag.fallida,
      metadata: banderas,
    };
    return bloque;
  });

  // 3) page.html = concat de hijos sin header/footer (convención datalab)
  const htmlPagina = bloques
    .filter((b) => b.block_type !== 'PageFooter' && b.block_type !== 'PageHeader')
    .map((b) => b.html)
    .join('');

  return {
    html: htmlPagina,
    bbox: [0, 0, pag.ancho, pag.alto],
    polygon: polygonDe([0, 0, pag.ancho, pag.alto]),
    id: `/page/${pagIdx}/Page/0`,
    block_type: 'Page',
    children: bloques,
    section_hierarchy: {},
    page: pagIdx,
  };
}

/** Convierte la salida completa del pipeline al esquema datalab-convert. */
export function convertirAChandra(
  pipeline: SalidaPipeline,
  opciones: OpcionesConversion = {},
): ConversionChandra {
  const paginas: PaginaChandra[] = [];
  const pageStats: { page_id: number; num_blocks: number }[] = [];
  const fallidas: number[] = [];

  pipeline.paginas.forEach((pag, idx) => {
    const pagina = serializarPagina(pag, idx, opciones);
    paginas.push(pagina);
    pageStats.push({ page_id: idx, num_blocks: pagina.children.length });
    if (pag.fallida) fallidas.push(idx);
  });

  return {
    children: paginas,
    metadata: { page_stats: pageStats, failed_pages: fallidas },
  };
}

// ===========================================================================
// Autochequeo: la conversión debe pasar esto antes de salir del celular
// ===========================================================================

export interface ChequeoEsquema {
  ok: boolean;
  errores: string[];
}

const KEYS_HOJA = [
  'id', 'block_type', 'html', 'page', 'polygon', 'bbox', 'section_hierarchy',
  'images', 'markdown', 'inference_failed', 'metadata',
];

/** Verifica que el JSON tenga el esquema exacto que consume importar-chandra. */
export function pareceChandraPropio(conv: ConversionChandra): ChequeoEsquema {
  const errores: string[] = [];
  const patId = /^\/page\/\d+\/[A-Za-z-]+\/\d+$/;
  conv.children.forEach((pag, idx) => {
    if (pag.block_type !== 'Page') errores.push(`children[${idx}] no es Page`);
    if (!patId.test(pag.id)) errores.push(`id de página inválido: ${pag.id}`);
    const idsPagina = new Set<string>();
    for (const b of pag.children) {
      if (!patId.test(b.id)) errores.push(`id inválido: ${b.id}`);
      if (idsPagina.has(b.id)) errores.push(`id duplicado: ${b.id}`);
      idsPagina.add(b.id);
      const claves = Object.keys(b);
      if (claves.join(',') !== KEYS_HOJA.join(',')) {
        errores.push(`${b.id}: claves/orden inesperado: ${claves.join(',')}`);
      }
      if (b.polygon.length !== 4 || b.bbox.length !== 4) {
        errores.push(`${b.id}: polygon/bbox mal formados`);
      }
      if (b.markdown !== null) errores.push(`${b.id}: markdown debe ser null`);
      for (const [fn, b64] of Object.entries(b.images)) {
        if (!/^[0-9a-f]{32}_img\.jpg$/.test(fn)) errores.push(`${b.id}: nombre de imagen inválido: ${fn}`);
        const bytes = base64ABytes(b64);
        if (bytes[0] !== 0xff || bytes[1] !== 0xd8) errores.push(`${b.id}: imagen no es JPEG`);
      }
      for (const refId of Object.values(b.section_hierarchy)) {
        if (!idsPagina.has(refId)) errores.push(`${b.id}: section_hierarchy apunta a ${refId} inexistente`);
      }
    }
    const concat = pag.children
      .filter((b) => b.block_type !== 'PageFooter' && b.block_type !== 'PageHeader')
      .map((b) => b.html)
      .join('');
    if (pag.html !== concat) errores.push(`/page/${idx}: page.html no coincide con los hijos`);
    const stat = conv.metadata.page_stats.find((s) => s.page_id === idx);
    if (!stat) errores.push(`falta page_stats para la página ${idx}`);
    else if (stat.num_blocks !== pag.children.length) {
      errores.push(`page_stats[${idx}].num_blocks=${stat.num_blocks} != ${pag.children.length}`);
    }
  });
  for (const p of conv.metadata.failed_pages) {
    if (!conv.children[p]) errores.push(`failed_pages referencia la página inexistente ${p}`);
  }
  return { ok: errores.length === 0, errores };
}

/** Conveniencia: JSON + MD + HTML en una llamada. */
export function convertirTodo(
  pipeline: SalidaPipeline,
  opciones: OpcionesConversion = {},
): { json: ConversionChandra; jsonTexto: string; md: string; html: string; chequeo: ChequeoEsquema } {
  const json = convertirAChandra(pipeline, opciones);
  const chequeo = pareceChandraPropio(json);
  return {
    json,
    jsonTexto: JSON.stringify(json, null, 2),
    md: exportarMarkdown(json),
    html: exportarHtml(json),
    chequeo,
  };
}
