// PUESTO EN SERVICIO (cierre del Benchmark OCR V3 — decisión del dueño
// 2026-11-27: chandra-convert es OFICIAL): puente Tamiz → serializador
// datalab-like (`@molde-suite/scanner-core/conversion`).
//
// Qué hace: toma las fotos procesadas del acta (1..N páginas), corre la MISMA
// pasada de OCR de página que la evaluación (`ocrLines`, proveedor Tamiz) y
// sintetiza las REGIONES de layout que el serializador necesita. El serializador
// (paridad 100 % char-a-char contra el GT datalab-convert, verificada en el
// cierre) produce el esquema exacto que `importar-chandra.ts` de Molde Studio
// consume: el loop «escanear en el celular → recalibrar molde» queda operativo
// sin tocar Datalab nunca más.
//
// HONESTIDAD (doctrina del repo):
//  · SIN molde: regiones sintetizadas por BANDAS de líneas OCR (clustering
//    vertical simple, sin multi-columna — hallazgo del informe E2 §10) y una
//    heurística de título documentada. Es la vía M2-estructural del benchmark
//    (fidelidad: texto y orden conservados; granularidad gruesa).
//  · CON molde (`acta.evaluacionMolde`): cada campo con rect resuelto se vuelve
//    una región anclada a la geometría REAL medida por el motor; el resto de
//    las líneas OCR no cubiertas se agrupa en bandas. Las firmas salen como
//    recortes JPEG inline (`data-bbox` + caption) — el mismo patrón del GT.
//  · Nada inventa texto: el html/md SIEMPRE proviene de las líneas OCR (o del
//    caption del recorte); los campos solo aportan la geometría del bloque.
//  · El OCR de export re-corrre (~1-3 s por página): el pipeline no persiste
//    líneas (jornada persiste filas livianas, KIT L6) — re-correr es el mismo
//    comportamiento que la evaluación, sin estado nuevo ni contrato tocado.

import type { ResumenMoldeActa } from '@molde-suite/scanner-core/dominio/types';
import { canvasDesdeDataUrl } from '@molde-suite/scanner-core/core/canvas-imagen';
import {
  convertirTodo,
  recortarTodos,
  type BBox,
  type LineaOcr as LineaConversion,
  type PaginaPipeline,
  type RecorteImagen,
  type RegionLayout,
} from '@molde-suite/scanner-core/conversion';
import { ocrLines } from '../molde/ocr-proveedor';

/** Línea OCR tal como la entrega el proveedor Tamiz (ocr-tipos). */
interface LineaTamiz {
  texto: string;
  bbox: [number, number, number, number];
  palabras?: Array<{ texto: string; conf: number; bbox: [number, number, number, number] }>;
}

/** Resultado completo de la conversión de un acta. */
export interface ResultadoConversionChandra {
  jsonTexto: string;
  md: string;
  html: string;
  /** true = la conversión pasó el autochequeo de esquema (`pareceChandraPropio`). */
  ok: boolean;
  /** Problemas no fatales reportados por el serializador / el puente. */
  avisos: string[];
  /** Número de páginas convertidas. */
  paginas: number;
}

/** Umbral de agrupación: brecha vertical máxima (px) entre líneas de un mismo párrafo. */
const FACTOR_BRECHA_PARRAFO = 1.3;

/**
 * Mapa una línea del proveedor Tamiz al formato del serializador.
 * La confianza de línea = media de las palabras (el proveedor no reporta conf
 * de línea); sin palabras → 0 (no bloquea nada: md/html no la consumen).
 */
export function mapLineasAConversion(lineas: LineaTamiz[]): LineaConversion[] {
  return lineas.map((l) => {
    const conf =
      l.palabras && l.palabras.length > 0
        ? l.palabras.reduce((s, p) => s + Math.min(1, Math.max(0, p.conf)), 0) / l.palabras.length
        : 0;
    return { bbox: l.bbox, texto: l.texto, conf };
  });
}

/** ¿La línea A y la B pertenecen a la misma banda de párrafo? */
function mismaBanda(y1A: number, y0B: number, altoLinea: number): boolean {
  const brecha = y0B - y1A;
  return brecha <= Math.max(12, altoLinea * FACTOR_BRECHA_PARRAFO);
}

/**
 * Clustering vertical de líneas en bandas (regiones Text). Sin detección de
 * columnas (documentado en el informe E2 §10: la fila multi-columna requiere
 * layout semántico — PP-DocLayout S — queda para el convertidor v2).
 * Las líneas de una banda se ordenan por x (lectura izquierda→derecha).
 */
export function agruparEnBandas(lineas: LineaConversion[]): RegionLayout[] {
  if (lineas.length === 0) return [];
  const ordenadas = [...lineas].sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
  const alturas = ordenadas.map((l) => l.bbox[3] - l.bbox[1]).sort((a, b) => a - b);
  const mediana = alturas[Math.floor(alturas.length / 2)] || 12;

  const bandas: LineaConversion[][] = [];
  let actual: LineaConversion[] = [ordenadas[0]!];
  for (let i = 1; i < ordenadas.length; i++) {
    const prev = actual[actual.length - 1]!;
    const cur = ordenadas[i]!;
    if (mismaBanda(prev.bbox[3], cur.bbox[1], mediana)) {
      actual.push(cur);
    } else {
      bandas.push(actual);
      actual = [cur];
    }
  }
  bandas.push(actual);

  return bandas.map((banda): RegionLayout => {
    const orden = [...banda].sort((a, b) => a.bbox[0] - b.bbox[0]);
    const x0 = Math.min(...orden.map((l) => l.bbox[0]));
    const y0 = Math.min(...orden.map((l) => l.bbox[1]));
    const x1 = Math.max(...orden.map((l) => l.bbox[2]));
    const y1 = Math.max(...orden.map((l) => l.bbox[3]));
    return { clase: 'text', bbox: [x0, y0, x1, y1], lineas: orden };
  });
}

/** Heurística de título (documentada): banda superior, corta y dominada por
 *  mayúsculas o con prefijo conocido de documento. Nivel 1. */
export function esTituloDeDocumento(banda: RegionLayout, altoPagina: number): boolean {
  const y0 = banda.bbox[1];
  if (y0 > altoPagina * 0.18) return false;
  const texto = banda.lineas?.map((l) => l.texto).join(' ').trim() ?? '';
  if (texto.length === 0 || texto.length > 70) return false;
  const letras = texto.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '');
  if (letras.length === 0) return false;
  const mayus = letras.replace(/[^A-ZÁÉÍÓÚÜÑ]/g, '').length / letras.length;
  if (mayus >= 0.7) return true;
  return /^(ACTA|RECIBO|COMPROBANTE|CERTIFICADO|FORMATO|INFORME|RESOLUCIÓN|RESOLUCION)\b/i.test(texto);
}

/** ¿La línea vive mayormente DENTRO del rect (px)? Contención del 60 % de su área. */
function lineaEnRect(l: LineaConversion, r: BBox): boolean {
  const ix = Math.max(0, Math.min(l.bbox[2], r[2]) - Math.max(l.bbox[0], r[0]));
  const iy = Math.max(0, Math.min(l.bbox[3], r[3]) - Math.max(l.bbox[1], r[1]));
  const areaLinea = Math.max(1, (l.bbox[2] - l.bbox[0]) * (l.bbox[3] - l.bbox[1]));
  return (ix * iy) / areaLinea >= 0.6;
}

/** Campo del resumen del molde (forma del contrato scanner-core, recortada). */
interface CampoMolde {
  id: string;
  etiqueta: string;
  tipo: 'texto' | 'presencia' | 'firma' | 'checkbox' | (string & {});
  estado: 'ok' | 'no_encontrado' | 'requiere_revision' | (string & {});
  valor: string | boolean | null;
  rect?: { x: number; y: number; w: number; h: number } | null;
}

/** Rect normalizado → BBox en px del canvas (enteros: convención datalab). */
function rectAPx(
  r: { x: number; y: number; w: number; h: number },
  ancho: number,
  alto: number,
): BBox {
  return [
    Math.round(r.x * ancho),
    Math.round(r.y * alto),
    Math.round((r.x + r.w) * ancho),
    Math.round((r.y + r.h) * alto),
  ];
}

/**
 * Regiones desde el resumen del MOLDE (geometría real medida por el motor):
 *  · firma → bloque Text con recorte inline (patrón del GT: img + caption).
 *  · texto/checkbox/presencia con rect → bloque Text.
 *  · sin rect → fuera (el campo no aportó geometría medible).
 */
export function regionesDesdeCampos(campos: CampoMolde[], ancho: number, alto: number): RegionLayout[] {
  const regiones: RegionLayout[] = [];
  for (const c of campos) {
    if (!c.rect) continue;
    const bbox = rectAPx(c.rect, ancho, alto);
    if (c.tipo === 'firma') {
      const recorte: RecorteImagen = {
        bbox,
        alt: `Handwritten signature (${c.etiqueta})`,
      };
      regiones.push({ clase: 'text', bbox, recortes: [recorte] });
    } else {
      regiones.push({ clase: 'text', bbox });
    }
  }
  return regiones;
}

/** Banda más superior de una lista (por y0). */
function bandaSuperior(regiones: RegionLayout[]): RegionLayout | null {
  return regiones.reduce<RegionLayout | null>(
    (acc, b) => (!acc || b.bbox[1] < acc.bbox[1] ? b : acc),
    null,
  );
}

/** Convierte UNA foto procesada (dataURL) en PaginaPipeline con regiones
 *  sintetizadas. Con `resumen` usa la geometría del molde; sin él, solo bandas. */
async function paginaDesdeFoto(
  foto: string,
  resumen: ResumenMoldeActa | null,
  avisos: string[],
): Promise<PaginaPipeline> {
  const canvas = await canvasDesdeDataUrl(foto);
  const ancho = canvas.width;
  const alto = canvas.height;

  const { lines } = await ocrLines(canvas);
  const lineas = mapLineasAConversion(lines as LineaTamiz[]);

  let regiones: RegionLayout[];
  const campos = (resumen?.campos ?? []) as CampoMolde[];
  if (campos.length > 0) {
    const deMolde = regionesDesdeCampos(campos, ancho, alto);
    const restantes = lineas.filter((l) => !deMolde.some((r) => lineaEnRect(l, r.bbox)));
    const bandas = agruparEnBandas(restantes);
    const primera = bandaSuperior(bandas);
    if (primera && esTituloDeDocumento(primera, alto)) {
      primera.clase = 'section_header';
      primera.nivel = 1;
    }
    regiones = [...deMolde, ...bandas];
  } else {
    regiones = agruparEnBandas(lineas);
    const primera = bandaSuperior(regiones);
    if (primera && esTituloDeDocumento(primera, alto)) {
      primera.clase = 'section_header';
      primera.nivel = 1;
    }
  }

  if (lineas.length === 0) {
    avisos.push('Página sin líneas OCR: se convierte como página sin bloques');
  }

  const pag: PaginaPipeline = {
    ancho,
    alto,
    regiones,
    lineasRapid: lineas,
  };
  // Recortes de firma: JPEG base64 desde el MISMO canvas del OCR (coords
  // consistentes). Faltantes quedan como aviso (el serializador los emite
  // vacíos en vez de mentir).
  const faltantes = await recortarTodos(canvas, pag.regiones);
  if (faltantes > 0) {
    avisos.push(`${faltantes} recorte(s) de firma no se pudieron extraer`);
  }
  return pag;
}

/** Punto de entrada del botón «Exportar conversión»: fotos del acta (1..N) +
 *  resumen del molde → JSON/MD/HTML datalab-convert. */
export async function convertirActaAChandra(
  fotos: string[],
  resumen: ResumenMoldeActa | null,
): Promise<ResultadoConversionChandra> {
  const avisos: string[] = [];
  const paginas: PaginaPipeline[] = [];
  for (const foto of fotos) {
    paginas.push(await paginaDesdeFoto(foto, resumen, avisos));
  }
  const { json, jsonTexto, md, html, chequeo } = convertirTodo(
    { paginas },
    { onAviso: (a) => avisos.push(a) },
  );
  if (!chequeo.ok) {
    avisos.push(`Autochequeo de esquema con problemas: ${chequeo.errores.join(' · ')}`);
  }
  return {
    jsonTexto,
    md,
    html,
    ok: chequeo.ok && json.children.length === fotos.length,
    avisos,
    paginas: paginas.length,
  };
}
