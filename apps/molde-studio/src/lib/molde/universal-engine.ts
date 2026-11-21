'use client';

// Motor universal v3: evalúa un molde (zona_fija / ancla_relativa) sobre
// páginas renderizadas (foto o PDF). Todo en el navegador con Tesseract.js.
//
// Pipeline por página:
//   1. OCR completo (líneas con palabras y bbox) — una sola pasada.
//   2. Para cada campo de esa página:
//      - Resolver el rect final (fijo, ancla fuzzy, respaldo o fallback).
//      - Recortar y binarizar sin líneas impresas -> densidad de tinta.
//      - tipo presencia/firma/checkbox: diligenciado si ratio >= umbral, con
//        banda de indeterminación (0.6x–1.4x del umbral) en requiere_revision.
//      - tipo texto: OCR del recorte (psm 7) + regex anclado + limpieza.
//      - Generar la captura JPEG de la zona (crop) para la verificación.
//   3. Validaciones aritméticas de cierre entre campos (Fase 2.2).
//
// Principio rector (Fase 2 del plan): los datos que importan se leen o se
// rechazan con razón — NUNCA se inventan. Ningún campo termina "ok" con
// confianza inexistente; los manuscritos (HTR) siempre pasan por revisión.

import {
  binarizeNoLines,
  canvasGrayscale,
  canvasOtsu,
  canvasRealce,
  inkRatio,
} from '@/lib/molde/imageproc';
import { ocrLines, ocrTextoUnico } from '@/lib/ocr/ocr-client';
import { canvasToJpeg } from '@/lib/ocr/pdf-client';
import type { LineaOcr } from '@/lib/molde/types';
import {
  hexTipo,
  type CampoUniversal,
  type MoldeUniversal,
  type RectNorm,
  type ResultadoCampoUniversal,
  type ResultadoPaginaUniversal,
  type ResultadoUniversal,
  type ResultadoValidacion,
} from './universal-types';

// ---- utilidades ----

export function normTxt(s: string): string {
  return s
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array<number>(n + 1);
  let cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/**
 * F1 (variante 1.3 — conversación de mejora): los DÍGITOS pesan más que las
 * letras en la distancia de edición. Las etiquetas vecinas de un formulario
 * suelen diferir SOLO en un dígito ("FIRMA JURADO 2" ↔ "FIRMA JURADO 4"):
 * con costo unitario el matcher difuso las acepta como casi idénticas
 * (score 0.92) y desplaza la zona en silencio — el falso positivo electoral
 * de la auditoría. Con la ponderación, ese mismo match puntúa por debajo del
 * corte ANCLA_SCORE_MIN cuando además está lejos del rect esperado, y el campo
 * cae al rect de referencia (la zona correcta).
 *
 * Costos: sustituir dígito→dígito distinto = 3; insertar/borrar un dígito = 2
 * (si no, el camino insert+borrar (1+1=2) evadiría la penalización de la
 * sustitución y el efecto se diluiría); letras conservan costo 1 en toda
 * operación — un error de OCR en una letra sigue tolerado igual que antes.
 */
const COSTE_SUBSTITUCION_DIGITO = 3;
const COSTE_INDEL_DIGITO = 2;

function esDigito(c: string): boolean {
  return c >= '0' && c <= '9';
}

function costeSubstitucion(a: string, b: string): number {
  if (a === b) return 0;
  // Dígitos distintos = identidad casi segura de OTRA etiqueta vecina.
  if (esDigito(a) && esDigito(b)) return COSTE_SUBSTITUCION_DIGITO;
  return 1;
}

function costeIndel(c: string): number {
  return esDigito(c) ? COSTE_INDEL_DIGITO : 1;
}

/**
 * Levenshtein con costo asimétrico (opción 1.3 de la conversación): misma
 * programación dinámica que `editDistance`, pero las operaciones sobre
 * DÍGITOS pesan más (sustitución 3, insert/delete 2). `editDistance` se
 * mantiene exportada sin cambios (los scripts de calibración/benchmark la usan).
 */
export function editDistancePonderada(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return b.split('').reduce((acc, ch) => acc + costeIndel(ch), 0);
  if (!n) return a.split('').reduce((acc, ch) => acc + costeIndel(ch), 0);
  let prev = new Array<number>(n + 1);
  let cur = new Array<number>(n + 1);
  // Fila/columna base: insertar/borrar b[0..j] / a[0..i] con su costo ponderado.
  prev[0] = 0;
  for (let j = 1; j <= n; j++) prev[j] = prev[j - 1] + costeIndel(b[j - 1]);
  for (let i = 1; i <= m; i++) {
    cur[0] = prev[0] + costeIndel(a[i - 1]);
    for (let j = 1; j <= n; j++) {
      const cost = costeSubstitucion(a[i - 1], b[j - 1]);
      // Insertar b[j] / borrar a[i] también pondera dígitos — si no, la ruta
      // insert+delete eludiría la penalización de sustitución de dígitos.
      cur[j] = Math.min(
        prev[j] + costeIndel(a[i - 1]),
        cur[j - 1] + costeIndel(b[j - 1]),
        prev[j - 1] + cost,
      );
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

export interface HitAncla {
  rect: RectNorm;
  score: number;
}

/**
 * Busca un texto (fuzzy) en las líneas OCR. Prioriza cercanía a rect esperado.
 *
 * Robustez para FOTOS rotadas (celulares): en fotos con leve inclinación el OCR
 * agrupa las palabras de una misma línea en orden invertido o revuelto
 * ("NULOS VOTOS", "ESPRIELLA DE LA ABELARDO"). Además del match en orden
 * estricto, se intenta un fallback anagrama-invariante (palabras ordenadas
 * alfabéticamente) con una pequeña penalización de score, de modo que la ancla
 * se encuentra igualmente y el rect sigue siendo correcto (el bbox cubre
 * exactamente las mismas palabras).
 */
export function buscarAncla(
  texto: string,
  lineas: LineaOcr[],
  canvasW: number,
  canvasH: number,
  rectEsperado?: RectNorm,
): HitAncla | null {
  const objetivo = normTxt(texto);
  if (!objetivo) return null;
  const objetivoPals = objetivo.split(' ');
  const tol = Math.max(1, Math.floor(objetivo.length * 0.35));
  // Objetivo orden-invariante: mismas palabras sin importar el orden (para fotos rotadas).
  const objetivoOrdenado = normTxt([...objetivoPals].sort((a, b) => a.localeCompare(b)).join(' '));
  let mejor: HitAncla | null = null;
  for (const l of lineas) {
    const palabras = l.palabras;
    const n = palabras.length;
    for (let i = 0; i < n; i++) {
      for (let j = i; j < Math.min(n, i + objetivoPals.length + 1); j++) {
        const ventana = palabras.slice(i, j + 1);
        const frase = normTxt(ventana.map((p) => p.texto).join(' '));
        const fraseOrdenada = normTxt(ventana.map((p) => p.texto).sort((a, b) => a.localeCompare(b)).join(' '));
        if (!frase) continue;
        let score = -1;
        // F1 (variante 1.2): distancia PONDERADA — la sustitución de un dígito
        // por otro cuesta 3x, así las etiquetas vecinas que difieren en un
        // dígito dejan de puntuar como casi idénticas.
        const d = editDistancePonderada(objetivo, frase);
        if (d <= tol) score = 1 - d / objetivo.length;
        if (fraseOrdenada && score < 0.95) {
          const dOrd = editDistancePonderada(objetivoOrdenado, fraseOrdenada);
          if (dOrd <= tol) {
            // Penalización leve: el match en orden correcto siempre gana si existe.
            score = Math.max(score, (1 - dOrd / objetivo.length) * 0.95);
          }
        }
        if (score < 0) continue;
        if (rectEsperado) {
          const cx = (palabras[i].bbox[0] + palabras[j].bbox[2]) / 2 / canvasW;
          const cy = (palabras[i].bbox[1] + palabras[j].bbox[3]) / 2 / canvasH;
          const dx = Math.abs(cx - (rectEsperado.x + rectEsperado.w / 2));
          const dy = Math.abs(cy - (rectEsperado.y + rectEsperado.h / 2));
          // Matiz 1 (Fase 2.6): penalización de posición SUAVIZADA. Antes
          // `score *= max(0.1, 1 - (dx+dy)*4)` hacía caer un match textual
          // PERFECTO (1.000) a 0.692 con un desplazamiento de solo 0.077
          // (caso recuento_marca de Transmisión pág. 2) — por debajo del corte
          // 0.72 y caía al fallback. La curva 1/(1+3d) mantiene 0.812 con
          // d=0.077 y sigue separando etiquetas lejanas (d=0.25 → 0.57).
          score *= 1 / (1 + 3 * (dx + dy));
        }
        if (!mejor || score > mejor.score) {
          mejor = {
            rect: {
              x: palabras[i].bbox[0] / canvasW,
              y: palabras[i].bbox[1] / canvasH,
              w: (palabras[j].bbox[2] - palabras[i].bbox[0]) / canvasW,
              h: (palabras[j].bbox[3] - palabras[i].bbox[1]) / canvasH,
            },
            score,
          };
        }
      }
    }
  }
  return mejor;
}

export interface RectResuelto {
  rect: RectNorm;
  fuente: 'ancla' | 'respaldo' | 'referencia' | 'fija';
  ancla_encontrada: boolean;
  score?: number;
  /**
   * Opción 1.2 (conversación): hubo match textual aceptable pero el CONTEXTO
   * exigido por `desambiguadores` no apareció cerca — el hit se rechazó y se
   * cayó a respaldo/referencia. Bandera para la verificación forense.
   */
  desambiguacion_fallida?: boolean;
}

/**
 * Score mínimo para aceptar un hit de ancla. Por debajo, el match casi seguro
 * corresponde a OTRA etiqueta del documento (p.ej. "FIRMA JURADO 4" difusa contra
 * la etiqueta impresa del jurado 2) y conviene caer al rect de referencia del
 * molde, que siempre apunta a la zona correcta.
 */
const ANCLA_SCORE_MIN = 0.72;

/** Radio normalizado (0-1) en el que debe aparecer cada texto de un
 * `desambiguador` respecto al centro del ancla encontrada (opción 1.2).
 * Exportado para que las pruebas de geometría del molde usen el MISMO valor. */
export const RADIO_DESAMBIGUACION = 0.3;

/**
 * Opción 1.2 (conversación de mejora): un hit de ancla SOLO es válido si cada
 * texto declarado en `campo.desambiguadores` aparece por OCR dentro de un radio
 * normalizado alrededor del hit. Ejemplo: el ancla "FIRMA JURADO 4" puede exigir
 * "JURADO 3" en un radio de 0.3 — si el match de texto alto fue en realidad la
 * etiqueta del jurado 2 al otro lado de la página, el contexto no aparece y el
 * hit se rechaza aunque el score textual sea alto.
 */
function desambiguado(
  campo: CampoUniversal,
  hit: HitAncla,
  lineas: LineaOcr[],
  canvasW: number,
  canvasH: number,
): boolean {
  const textos = campo.desambiguadores ?? [];
  if (!textos.length) return true;
  const cx = hit.rect.x + hit.rect.w / 2;
  const cy = hit.rect.y + hit.rect.h / 2;
  for (const t of textos) {
    const h2 = buscarAncla(t, lineas, canvasW, canvasH);
    if (!h2) return false;
    const dx = Math.abs(h2.rect.x + h2.rect.w / 2 - cx);
    const dy = Math.abs(h2.rect.y + h2.rect.h / 2 - cy);
    if (Math.hypot(dx, dy) > RADIO_DESAMBIGUACION) return false;
  }
  return true;
}

/** Resuelve el rectángulo final de un campo sobre una página OCR-izada. */
export function resolverRectCampo(
  campo: CampoUniversal,
  lineas: LineaOcr[],
  canvasW: number,
  canvasH: number,
): RectResuelto | null {
  if (campo.estrategia === 'zona_fija') {
    return { rect: { ...campo.zona }, fuente: 'fija', ancla_encontrada: true };
  }
  const ancla = campo.ancla;
  if (!ancla?.texto) return null;

  const aplicarOffset = (base: RectNorm): RectNorm => ({
    x: campo.x_absoluto ? campo.zona.x : base.x + campo.zona.x,
    y: base.y + campo.zona.y,
    w: campo.zona.w,
    h: campo.zona.h,
  });

  let desambiguacionFallida = false;
  const hit = buscarAncla(ancla.texto, lineas, canvasW, canvasH, ancla.rect);
  if (hit && hit.score >= ANCLA_SCORE_MIN) {
    if (desambiguado(campo, hit, lineas, canvasW, canvasH)) {
      return { rect: aplicarOffset(hit.rect), fuente: 'ancla', ancla_encontrada: true, score: hit.score };
    }
    desambiguacionFallida = true;
  }
  if (campo.ancla_respaldo) {
    const hit2 = buscarAncla(campo.ancla_respaldo, lineas, canvasW, canvasH, ancla.rect);
    if (hit2 && hit2.score >= ANCLA_SCORE_MIN) {
      if (desambiguado(campo, hit2, lineas, canvasW, canvasH)) {
        return { rect: aplicarOffset(hit2.rect), fuente: 'respaldo', ancla_encontrada: true, score: hit2.score };
      }
      desambiguacionFallida = true;
    }
  }
  // Fallback: usar la posición de referencia guardada en el molde.
  if (ancla.rect) {
    return {
      rect: aplicarOffset(ancla.rect),
      fuente: 'referencia',
      ancla_encontrada: false,
      desambiguacion_fallida: desambiguacionFallida || undefined,
    };
  }
  return null;
}

/** Rect resuelto SIN OCR (para dibujar en el editor): usa la referencia guardada. */
export function rectEditor(campo: CampoUniversal): RectNorm | null {
  if (campo.estrategia === 'zona_fija') return { ...campo.zona };
  if (!campo.ancla?.rect) return campo.ancla?.texto ? null : { ...campo.zona };
  return {
    x: campo.x_absoluto ? campo.zona.x : campo.ancla.rect.x + campo.zona.x,
    y: campo.ancla.rect.y + campo.zona.y,
    w: campo.zona.w,
    h: campo.zona.h,
  };
}

/**
 * Rect normalizado → píxeles. N-4: si el rect trae componentes no finitos o
 * degenerados (molde malformado), devuelve null en vez de NaN/IndexSizeError —
 * la corrida sobrevive con bandera `zona_invalida`.
 */
function rectAPx(
  rect: RectNorm,
  w: number,
  h: number,
  margen = 0.004,
): [number, number, number, number] | null {
  if (
    !Number.isFinite(rect.x) || !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.w) || !Number.isFinite(rect.h) ||
    rect.w <= 0 || rect.h <= 0
  ) {
    return null;
  }
  const mx = rect.w * margen + 0.002;
  const my = rect.h * margen + 0.002;
  const x0 = Math.max(0, Math.floor((rect.x - mx) * w));
  const y0 = Math.max(0, Math.floor((rect.y - my) * h));
  const x1 = Math.min(w, Math.ceil((rect.x + rect.w + mx) * w));
  const y1 = Math.min(h, Math.ceil((rect.y + rect.h + my) * h));
  const cw = x1 - x0;
  const ch = y1 - y0;
  if (cw <= 2 || ch <= 2) return null;
  return [x0, y0, cw, ch];
}

function recortar(
  canvas: HTMLCanvasElement,
  rect: RectNorm,
): { crop: HTMLCanvasElement; dims: [number, number] } | null {
  const px = rectAPx(rect, canvas.width, canvas.height);
  if (!px) return null;
  const [x, y, cw, ch] = px;
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(canvas, x, y, cw, ch, 0, 0, cw, ch);
  return { crop: c, dims: [cw, ch] };
}

function cropDataUrl(
  canvas: HTMLCanvasElement,
  rect: RectNorm,
  maxPx = 420,
  q = 0.72,
): { crop: string; dims: [number, number] } | null {
  const r = recortar(canvas, rect);
  if (!r) return null;
  const { crop } = r;
  let src = crop;
  if (crop.width > maxPx) {
    src = document.createElement('canvas');
    src.width = maxPx;
    src.height = Math.max(1, Math.round((crop.height * maxPx) / crop.width));
    const ctx = src.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(crop, 0, 0, src.width, src.height);
  }
  return { crop: src.toDataURL('image/jpeg', q), dims: [crop.width, crop.height] };
}

function medirTinta(crop: HTMLCanvasElement): number {
  const gray = canvasGrayscale(crop);
  const ctx = gray.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, gray.width, gray.height);
  const g = new Uint8Array(gray.width * gray.height);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = img.data[p];
  const bin = binarizeNoLines(g, gray.width, gray.height, 0.083);
  return inkRatio(bin, [0, 0, gray.width, gray.height], { fraccion_ancho: 0.5, grosor_max: 6 });
}

function confPresencia(ratio: number, umbral: number): number {
  const margen = Math.abs(ratio - umbral) / Math.max(umbral, 0.02);
  return Math.min(0.97, 0.55 + 0.42 * Math.min(1, margen));
}

/** Compila el patrón del campo ANCLADO a la cadena completa (G-8). */
function compilarPatron(campo: CampoUniversal, banderas: string[]): RegExp | null {
  if (!campo.patron) return null;
  const yaAnclado = campo.patron.startsWith('^') && campo.patron.endsWith('$');
  const fuente = yaAnclado ? campo.patron : `^(?:${campo.patron})$`;
  try {
    return new RegExp(fuente, 'i');
  } catch {
    banderas.push('patron_invalido');
    return null;
  }
}

/**
 * `limpiar_valor` (G-8): extrae el primer grupo de captura cuando el OCR
 * devuelve basura con etiqueta pegada ("ZONA: 05" con limpiar_valor "(\d{2})").
 */
function limpiarValor(valor: string, campo: CampoUniversal, banderas: string[]): string {
  if (!campo.limpiar_valor) return valor;
  try {
    const m = new RegExp(campo.limpiar_valor, 'i').exec(valor);
    if (!m) return valor;
    const extraido = m[1] ?? m[0];
    if (extraido !== valor) banderas.push('valor_limpiado');
    return extraido;
  } catch {
    banderas.push('limpiar_invalido');
    return valor;
  }
}

// ---- evaluación de un campo ----

async function evaluarCampo(
  campo: CampoUniversal,
  canvas: HTMLCanvasElement,
  lineas: LineaOcr[],
): Promise<ResultadoCampoUniversal> {
  const base: ResultadoCampoUniversal = {
    id: campo.id,
    etiqueta: campo.etiqueta,
    tipo: campo.tipo,
    pagina: campo.pagina,
    estado: 'no_encontrado',
    valor: null,
    conf: null,
    rect: null,
    crop: null,
    crop_dims: null,
    fuente: null,
    banderas: [],
  };
  const resuelto = resolverRectCampo(campo, lineas, canvas.width, canvas.height);
  if (!resuelto) {
    base.banderas.push('sin_rect');
    if (campo.estrategia === 'ancla_relativa') base.banderas.push('ancla_no_encontrada');
    return base;
  }
  base.rect = resuelto.rect;
  base.fuente = resuelto.fuente;
  if (!resuelto.ancla_encontrada) base.banderas.push('ancla_no_encontrada');
  if (resuelto.fuente === 'respaldo') base.banderas.push('ancla_respaldo');
  // Opción 1.2: el match textual existió pero el contexto exigido no apareció.
  if (resuelto.desambiguacion_fallida) base.banderas.push('desambiguacion_fallida');

  const rec = recortar(canvas, resuelto.rect);
  if (!rec) {
    // N-4: zona degenerada/NaN — la corrida sobrevive, el campo queda marcado.
    base.banderas.push('zona_invalida');
    return base;
  }

  const ratio = medirTinta(rec.crop);
  base.ratio = ratio;

  if (campo.tipo === 'presencia' || campo.tipo === 'firma' || campo.tipo === 'checkbox') {
    // Fase 2.1 — banda de indeterminación: un binario frío en el borde del
    // umbral (0.6x–1.4x) miente por cualquiera de los dos lados. Dentro de la
    // banda se reporta la lectura provisional + `requiere_revision`.
    const diligenciado = ratio >= campo.umbral;
    base.valor = diligenciado;
    base.conf = confPresencia(ratio, campo.umbral);
    const captura = cropDataUrl(canvas, resuelto.rect);
    base.crop = captura?.crop ?? null;
    base.crop_dims = captura?.dims ?? null;
    const enBandaAlta = diligenciado && ratio <= campo.umbral * 1.4;
    const enBandaBaja = !diligenciado && ratio >= campo.umbral * 0.6;
    if (enBandaAlta || enBandaBaja) {
      base.banderas.push('umbral_al_borde');
      base.estado = 'requiere_revision';
    } else {
      base.estado = diligenciado ? 'ok' : 'no_encontrado';
    }
    return base;
  }

  // tipo texto: OCR de la línea del recorte
  const { texto, conf: confOcr } = await ocrTextoUnico(rec.crop, { whitelist: campo.whitelist });
  const limpio = texto.replace(/\s+/g, ' ').trim();
  const captura = cropDataUrl(canvas, resuelto.rect);
  base.crop = captura?.crop ?? null;
  base.crop_dims = captura?.dims ?? null;
  // N-9/G-3: el OCR puede no reportar confianza (null). Ese caso es "sin
  // señal", NO un 50-60% inventado: se registra como conf_baja.
  const confNum = confOcr; // number | null
  base.conf = confNum;
  const sinConf = confNum === null;
  if (sinConf) base.banderas.push('sin_confianza_ocr');
  if (!limpio) {
    base.banderas.push('ocr_vacio');
    if (ratio < campo.umbral * 0.6) base.banderas.push('zona_vacia');
    if (!campo.realce) return base;
  }
  const patronRe = compilarPatron(campo, base.banderas);
  const cumplePatron = (v: string): boolean => {
    if (!patronRe) return true;
    return patronRe.test(v);
  };
  let valorFinal = limpio;
  let confFinal = confNum;
  if (
    campo.realce &&
    (!valorFinal || !cumplePatron(valorFinal) || confFinal === null || confFinal < 0.5)
  ) {
    // Reintento con realce (grises + contraste percentil + ampliación 4x) y,
    // si sigue fallando, con binarización Otsu y psm 8/13 — misma ruta que la
    // relectura del ID del acta. También se reintenta cuando la primera lectura
    // tiene confianza muy baja (fotos borrosas: acepta basura que cumpla el
    // patrón). El primer intento es gris plano amplificado (sin estiramiento:
    // el estiramiento puede sobre-amplificar la textura del papel y romper el
    // OCR). Se acepta la primera lectura que cumpla con más confianza.
    const grayBase = canvasGrayscale(rec.crop);
    const gray4 = document.createElement('canvas');
    gray4.width = Math.min(4000, grayBase.width * 4);
    gray4.height = Math.min(4000, Math.max(1, Math.round((grayBase.height * gray4.width) / grayBase.width)));
    const g4ctx = gray4.getContext('2d', { willReadFrequently: true })!;
    g4ctx.imageSmoothingEnabled = true;
    g4ctx.imageSmoothingQuality = 'high';
    g4ctx.drawImage(grayBase, 0, 0, gray4.width, gray4.height);
    const realzado = canvasRealce(rec.crop, 4);
    const variantes: Array<{ c: HTMLCanvasElement; psm: '6' | '7' | '8' | '13' }> = [
      { c: gray4, psm: '7' },
      { c: realzado, psm: '7' },
      { c: canvasOtsu(realzado), psm: '7' },
      { c: realzado, psm: '8' },
      { c: realzado, psm: '13' },
      { c: canvasOtsu(realzado), psm: '13' },
    ];
    for (const v of variantes) {
      const re = await ocrTextoUnico(v.c, { whitelist: campo.whitelist, psm: v.psm });
      const limpioRe = re.texto.replace(/\s+/g, ' ').trim();
      if (!limpioRe) continue;
      if (cumplePatron(limpioRe) && (!valorFinal || (re.conf !== null && (confFinal === null || re.conf > confFinal)))) {
        valorFinal = limpioRe;
        confFinal = re.conf;
        base.banderas.push('realce_retry');
        break;
      }
      if (!valorFinal && !cumplePatron(limpioRe)) {
        // Sin primera lectura: se guarda la lectura dudosa para que el humano
        // la vea, pero el estado NUNCA es ok (no se inventa un valor).
        valorFinal = limpioRe;
        confFinal = re.conf;
        base.banderas.push('realce_retry', 'patron_no_cumple');
        break;
      }
    }
  }
  if (!valorFinal) return base;
  // G-8: extraer subvalor y validar el patrón ANCLADO.
  valorFinal = limpiarValor(valorFinal, campo, base.banderas);
  base.valor = valorFinal;
  base.conf = confFinal;
  const confBaja = confFinal === null || confFinal < 0.5;
  if (confBaja) base.banderas.push('conf_baja');
  if (!cumplePatron(valorFinal)) {
    base.banderas.push('patron_no_cumple');
    // G-3: un valor que ni siquiera cumple el patrón no puede ser ok; si el
    // campo es obligatorio exige revisión explícita.
    if (campo.obligatorio) base.estado = 'requiere_revision';
    return base;
  }
  // Fase 2.5 (opción C): los manuscritos SIEMPRE pasan por el humano.
  if (campo.htr) base.banderas.push('htr_manual');
  if (confBaja && campo.obligatorio) {
    // G-3: confianza baja (o ausente) en obligatorio → revisión, no "ok".
    base.estado = 'requiere_revision';
    return base;
  }
  if (campo.htr && campo.obligatorio) {
    // HTR obligatorio: lectura disponible pero jamás definitiva.
    base.estado = 'requiere_revision';
    return base;
  }
  base.estado = 'ok';
  return base;
}


// ---- validaciones aritméticas de cierre (Fase 2.2) ----

/**
 * Convierte el valor de un campo a número. Normaliza espacios y separadores
 * de miles ("17 000", "1.234" → miles). Presencia/firma/checkbox: true → 1,
 * false → 0. Devuelve null si no hay lectura numérico-compatible.
 */
export function valorNumerico(r: ResultadoCampoUniversal): number | null {
  if (typeof r.valor === 'boolean') return r.valor ? 1 : 0;
  if (typeof r.valor !== 'string' || !r.valor.trim()) return null;
  const s = r.valor.trim();
  // Formato de miles con espacios o puntos: "17 000", "1.234", "1 234 567".
  if (/^\d{1,3}([ .]\d{3})+$/.test(s)) {
    const n = Number(s.replace(/[ .]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  if (/^-?\d+([.,]\d+)?$/.test(s)) {
    const n = Number(s.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Parser seguro de igualdades de sumas: `id1 == id2 + id3 + 5`.
 * Tokeniza IDs ([a-z_][a-z0-9_]*) y números; NO evalúa JS genérico.
 * Devuelve [ladoIzq, [operandosDer]] o null si la expresión es inválida.
 */
export function parsearIgualdad(
  expresion: string,
): { izq: string; der: Array<{ tipo: 'id' | 'num'; valor: string }> } | null {
  const sinEspacios = expresion.replace(/\s+/g, ' ').trim();
  const m = /^([a-z_][a-z0-9_]*)\s*==\s*(.+)$/i.exec(sinEspacios);
  if (!m) return null;
  const izq = m[1];
  const partes = m[2].split('+').map((p) => p.trim()).filter(Boolean);
  if (!partes.length) return null;
  const der: Array<{ tipo: 'id' | 'num'; valor: string }> = [];
  for (const p of partes) {
    if (/^[a-z_][a-z0-9_]*$/i.test(p)) der.push({ tipo: 'id', valor: p });
    else if (/^-?\d+(\.\d+)?$/.test(p)) der.push({ tipo: 'num', valor: p });
    else return null; // token inválido: expresión completa rechazada
  }
  return { izq, der };
}

function evaluarValidaciones(
  molde: MoldeUniversal,
  porId: Map<string, ResultadoCampoUniversal>,
): ResultadoValidacion[] {
  const salidas: ResultadoValidacion[] = [];
  for (const v of molde.validaciones ?? []) {
    const parseado = parsearIgualdad(v.expresion);
    const implicados = new Set<string>();
    if (!parseado) {
      salidas.push({
        id: v.id,
        expresion: v.expresion,
        ok: null,
        detalle: 'Expresión inválida (se espera: id == id + id + … + números)',
        campos: [],
      });
      continue;
    }
    implicados.add(parseado.izq);
    const operandos: Array<{ id?: string; num?: number }> = [];
    let faltantes: string[] = [];
    for (const t of parseado.der) {
      if (t.tipo === 'num') {
        operandos.push({ num: Number(t.valor) });
        continue;
      }
      implicados.add(t.valor);
      const r = porId.get(t.valor);
      const n = r ? valorNumerico(r) : null;
      if (n === null) faltantes.push(t.valor);
      operandos.push({ id: t.valor, num: n ?? undefined });
    }
    const rIzq = porId.get(parseado.izq);
    const nIzq = rIzq ? valorNumerico(rIzq) : null;
    if (nIzq === null) faltantes = [parseado.izq, ...faltantes];
    const tolerancia = typeof v.tolerancia === 'number' && Number.isFinite(v.tolerancia) ? v.tolerancia : 0;
    if (faltantes.length) {
      salidas.push({
        id: v.id,
        expresion: v.expresion,
        ok: null,
        detalle: `No evaluable: sin lectura de ${[...new Set(faltantes)].join(', ')}`,
        campos: [...implicados],
      });
      continue;
    }
    const sumaDer = operandos.reduce((acc, o) => acc + (o.num ?? 0), 0);
    const cumple = Math.abs((nIzq as number) - sumaDer) <= tolerancia;
    salidas.push({
      id: v.id,
      expresion: v.expresion,
      ok: cumple,
      detalle: cumple
        ? `${nIzq} == ${sumaDer}${tolerancia ? ` (tol ±${tolerancia})` : ''}`
        : `${nIzq} ≠ ${sumaDer} — la lectura de cierre no cuadra con los componentes`,
      campos: [...implicados],
    });
  }
  return salidas;
}

// ---- evaluación de un documento completo ----

/** Voltea un canvas 180° (detección de rotación barata, Fase 3.3). */
function voltear180(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = canvas.width;
  c.height = canvas.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.translate(canvas.width, canvas.height);
  ctx.scale(-1, -1);
  ctx.drawImage(canvas, 0, 0);
  return c;
}

/** Intersección-sobre-unión de dos rects normalizados. */
function iou(a: RectNorm, b: RectNorm): number {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/** Umbral de solapamiento a partir del cual dos campos distintos que resuelven
 * el MISMO rect denotan confusión de anclas (F1 — Frankfurt J1≡J3 midieron
 * el mismo pedazo de papel pixel a pixel; IoU = 1). */
const IOU_COLISION = 0.8;

/**
 * F1 (variante 1.1 — la más barata de la conversación de mejora): dedupe de
 * rects EN RUNTIME. Tras resolver todos los campos de una página, dos campos
 * distintos con rects idénticos o IoU > 0.8 es casi seguro que dos anclas
 * matchearon la MISMA etiqueta impresa (o cayeron al mismo fallback). Se marcan
 * ambos con `ancla_colision` y NUNCA permanecen en estado 'ok' — el veredicto
 * va a `requiere_revision` para que un humano decida. No corrige la posición:
 * la IA del engaño desaparece (el falso positivo electoral ya no se reporta
 * como firma válida).
 */
function marcarColisiones(resultados: ResultadoCampoUniversal[]): void {
  const conRect = resultados.filter((r) => r.rect);
  for (let i = 0; i < conRect.length; i++) {
    for (let j = i + 1; j < conRect.length; j++) {
      if (iou(conRect[i].rect!, conRect[j].rect!) <= IOU_COLISION) continue;
      for (const r of [conRect[i], conRect[j]]) {
        if (!r.banderas.includes('ancla_colision')) r.banderas.push('ancla_colision');
        if (r.estado === 'ok') r.estado = 'requiere_revision';
      }
    }
  }
}

export async function evaluarDocumentoUniversal(
  canvases: HTMLCanvasElement[],
  molde: MoldeUniversal,
  nombreArchivo: string,
  onProgreso?: (msg: string) => void,
  /**
   * F3 (telemetría honesta): total de ms de render medidos por el llamador
   * (`renderDocumento()` ya produce `renderMsPorPagina` — antes se descartaban
   * y `tiempos.render_ms` venía hardcodeado en 0). Opcional y backward-compatible.
   */
  renderMs?: number,
): Promise<ResultadoUniversal> {
  const t0 = performance.now();
  const paginas: ResultadoPaginaUniversal[] = [];
  let ocrMs = 0;
  const motorT0 = performance.now();
  const rotaciones: number[] = [];
  const paginasEquivocadas: number[] = [];

  // Primera pasada por página: OCR + campos.
  const anclasPorPagina: boolean[] = [];
  for (let p = 0; p < canvases.length; p++) {
    const canvas = canvases[p];
    onProgreso?.(`OCR página ${p + 1}/${canvases.length}...`);
    const tOcr = performance.now();
    let ocr = await ocrLines(canvas);
    ocrMs += performance.now() - tOcr;

    const camposPagina = molde.campos.filter((c) => c.pagina === p + 1);
    let pageCanvas = canvas;

    // Fase 3.3 (versión pragmática): si NINGUNA ancla de una página N>1
    // matchea pero el molde sí define anclas para ella, probamos flip 180°
    // (barato: una sola pasada extra de OCR). Si con el flip las anclas
    // aparecen, se evalúa la página volteada y se marca
    // `rotacion_180_corregida`; si no, queda candidata a
    // `posible_pagina_equivocada` (se confirma si otra página sí ancló).
    const conAnclas = camposPagina.filter((c) => c.estrategia === 'ancla_relativa' && c.ancla?.texto);
    if (conAnclas.length > 0 && p >= 1 && !probarLineas(ocr.lines, conAnclas, canvas)) {
      const flipCanvas = voltear180(canvas);
      const tFlip = performance.now();
      const flipOcr = await ocrLines(flipCanvas);
      ocrMs += performance.now() - tFlip;
      if (probarLineas(flipOcr.lines, conAnclas, canvas)) {
        pageCanvas = flipCanvas;
        ocr = flipOcr;
        rotaciones.push(p + 1);
      } else {
        paginasEquivocadas.push(p + 1);
      }
    }

    const resultados: ResultadoCampoUniversal[] = [];
    for (let i = 0; i < camposPagina.length; i++) {
      const c = camposPagina[i];
      onProgreso?.(`Página ${p + 1}: campo ${i + 1}/${camposPagina.length} — ${c.etiqueta}`);
      resultados.push(await evaluarCampo(c, pageCanvas, ocr.lines));
    }
    // F1 (variante 1.1): detección de colisión de rects — DOS campos que miran
    // el mismo pedazo de papel es la firma del falso positivo de la auditoría.
    marcarColisiones(resultados);
    anclasPorPagina.push(resultados.some((r) => r.fuente === 'ancla' || r.fuente === 'respaldo'));
    paginas.push({
      pagina: p + 1,
      ocr_conf: ocr.conf,
      preview: canvasToJpeg(pageCanvas, 900, 0.7),
      campos: resultados,
    });
  }

  // Fase 3.3: página N>1 sin ninguna ancla mientras otras páginas sí anclaron
  // → casi seguro es OTRA página del documento (o una foto de la pág. 1).
  if (anclasPorPagina.some((v) => v) && paginasEquivocadas.length) {
    for (const num of paginasEquivocadas) {
      const pg = paginas.find((x) => x.pagina === num);
      if (!pg) continue;
      for (const c of pg.campos) c.banderas.push('posible_pagina_equivocada');
    }
  } else {
    paginasEquivocadas.length = 0;
  }
  for (const num of rotaciones) {
    const pg = paginas.find((x) => x.pagina === num);
    if (pg) for (const c of pg.campos) c.banderas.push('rotacion_180_corregida');
  }

  // campos de páginas inexistentes
  const faltantes: ResultadoCampoUniversal[] = molde.campos
    .filter((c) => c.pagina > canvases.length)
    .map((c) => ({
      id: c.id,
      etiqueta: c.etiqueta,
      tipo: c.tipo,
      pagina: c.pagina,
      estado: 'no_encontrado' as const,
      valor: null,
      conf: null,
      rect: null,
      crop: null,
      crop_dims: null,
      fuente: null,
      banderas: ['pagina_faltante'],
    }));
  if (faltantes.length) {
    paginas.push({ pagina: -1, ocr_conf: 0, campos: faltantes });
  }

  // ---- validaciones aritméticas (Fase 2.2) ----
  const todos = paginas.flatMap((p) => p.campos);
  const porId = new Map(todos.map((r) => [r.id, r]));
  const validaciones = evaluarValidaciones(molde, porId);
  for (const v of validaciones) {
    if (v.ok === true) continue;
    for (const id of v.campos) {
      const r = porId.get(id);
      if (!r) continue;
      r.banderas.push('validacion_fallida');
      // La defensa principal: una lectura de cierre que no cuadra jamás
      // permanece en "ok" (las "2"≠17 y "9"≠17 de la auditoría mueren aquí).
      if (r.estado === 'ok') r.estado = 'requiere_revision';
    }
  }

  // ---- métricas (G-2: conceptos separados; G-13: telemetría honesta) ----
  const camposTinta = todos.filter((r) => r.tipo !== 'texto');
  const camposTexto = todos.filter((r) => r.tipo === 'texto');
  const ok = todos.filter((r) => r.estado === 'ok');
  const pctDiligenciado = camposTinta.length
    ? Math.round((camposTinta.filter((r) => r.valor === true).length / camposTinta.length) * 1000) / 10
    : null;
  const pctLectura = camposTexto.length
    ? Math.round((camposTexto.filter((r) => r.estado === 'ok').length / camposTexto.length) * 1000) / 10
    : null;
  const obligatoriosFaltantes = molde.campos
    .filter((c) => c.obligatorio)
    .filter((c) => {
      const r = porId.get(c.id);
      return !r || r.estado !== 'ok';
    })
    .map((c) => c.etiqueta);
  const requiereRevision =
    obligatoriosFaltantes.length > 0 ||
    validaciones.some((v) => v.ok !== true) ||
    todos.some((r) => r.estado === 'requiere_revision') ||
    paginasEquivocadas.length > 0;

  // G-13: antes `motor_ms = motorMs + (now - t0 - ocrMs - motorMs)` se
  // auto-cancelaba (los términos se restaban entre sí). El trabajo del motor
  // es el total del bucle MENOS el tiempo de OCR ya contado aparte.
  const motorMs = performance.now() - motorT0 - ocrMs;

  return {
    archivo: nombreArchivo,
    paginas,
    total: todos.length,
    ok_count: ok.length,
    score: todos.length ? Math.round((ok.length / todos.length) * 1000) / 10 : 0,
    pct_diligenciado: pctDiligenciado,
    pct_lectura: pctLectura,
    obligatorios_faltantes: obligatoriosFaltantes,
    validaciones,
    requiere_revision: requiereRevision,
    tiempos: {
      // F3: el render lo mide el llamador (renderDocumento ya produce
      // renderMsPorPagina) — antes era un 0 fijo que sub-reportaba el costo real.
      render_ms: Math.round(renderMs ?? 0),
      ocr_ms: Math.round(ocrMs),
      motor_ms: Math.round(Math.max(0, motorMs)),
    },
  };
}

function probarLineas(lines: LineaOcr[], campos: CampoUniversal[], canvas: HTMLCanvasElement): boolean {
  let hits = 0;
  for (const c of campos) {
    const hit = buscarAncla(c.ancla!.texto, lines, canvas.width, canvas.height, c.ancla!.rect);
    if (hit && hit.score >= ANCLA_SCORE_MIN) hits++;
  }
  return hits > 0;
}

/** Alinea las anclas de un molde con el OCR de la imagen de referencia de UNA página.
 * Devuelve un nuevo molde con ancla.rect actualizada donde se encontró.
 * N-2: el match del RESPALDO se guarda en `ancla.rectRespaldo` y NUNCA
 * sobrescribe `ancla.rect` del primario (antes la posición del respaldo se
 * persistía como si fuera la del ancla principal y sesgaba TODAS las corridas
 * futuras). */
export async function alinearAnclas(
  molde: MoldeUniversal,
  canvas: HTMLCanvasElement,
  pagina?: number,
): Promise<{ molde: MoldeUniversal; encontradas: number; total: number; detalles: Record<string, 'ancla' | 'respaldo' | 'no'> }> {
  const { lines } = await ocrLines(canvas);
  const detalles: Record<string, 'ancla' | 'respaldo' | 'no'> = {};
  let encontradas = 0;
  const campos = molde.campos.map((c) => {
    if (c.estrategia !== 'ancla_relativa' || !c.ancla?.texto) return c;
    if (pagina !== undefined && c.pagina !== pagina) return c;
    const hit = buscarAncla(c.ancla.texto, lines, canvas.width, canvas.height, c.ancla.rect);
    if (hit && hit.score >= ANCLA_SCORE_MIN) {
      encontradas++;
      detalles[c.id] = 'ancla';
      return { ...c, ancla: { ...c.ancla, rect: hit.rect } };
    }
    if (c.ancla_respaldo) {
      const hit2 = buscarAncla(c.ancla_respaldo, lines, canvas.width, canvas.height, c.ancla.rect);
      if (hit2 && hit2.score >= ANCLA_SCORE_MIN) {
        encontradas++;
        detalles[c.id] = 'respaldo';
        // N-2: la posición del respaldo va a su propio campo.
        return { ...c, ancla: { ...c.ancla, rectRespaldo: hit2.rect } };
      }
    }
    detalles[c.id] = 'no';
    return c;
  });
  return { molde: { ...molde, campos }, encontradas, total: Object.keys(detalles).length, detalles };
}

/**
 * Fase 2.1 (herramienta): sugiere un umbral de tinta por campo a partir de
 * los ratios MEDIDOS de una corrida (ya se guardan en los resultados).
 * Umbral sugerido = min(ratios con tinta) × 0.7 — por debajo del trazo más
 * fino visto y por encima del ruido de una celda vacía.
 *
 * Devuelve `sugerido: null` (con `motivo`) cuando NO hay evidencia suficiente
 * para calibrar — nunca un umbral por debajo del ruido.
 */
export function sugerirUmbral(
  resultados: ResultadoUniversal,
  campoId: string,
): {
  sugerido: number | null;
  minConTinta: number | null;
  maxSinTinta: number | null;
  /** F4-1: por qué NO se sugiere (solo presente cuando `sugerido` es null). */
  motivo?: 'sin_mediciones' | 'sin_tinta' | 'sin_celdas_vacias' | 'clases_entrelazadas';
} {
  const historial = resultados.paginas
    .flatMap((p) => p.campos)
    .filter((c) => c.id === campoId && typeof c.ratio === 'number')
    .map((c) => c.ratio as number);
  if (!historial.length) return { sugerido: null, minConTinta: null, maxSinTinta: null, motivo: 'sin_mediciones' };
  const conTinta = historial.filter((r) => r > 0.002);
  const sinTinta = historial.filter((r) => r <= 0.002);
  const minConTinta = conTinta.length ? Math.min(...conTinta) : null;
  const maxSinTinta = sinTinta.length ? Math.max(...sinTinta) : null;
  if (minConTinta === null) return { sugerido: null, minConTinta, maxSinTinta, motivo: 'sin_tinta' };
  // F4 (variante 4.1 — conversación de mejora): validación de separación de
  // clases. Una zona VACÍA con ruido de papel/flash midió 0.0139 en la
  // auditoría: el corte fijo 0.002 la clasifica como «trazo fino» y sugeriría
  // un umbral POR DEBAJO del ruido — esa firma vacía pasaría a «firmada» en
  // la próxima corrida. Si el ruido de las vacías no queda claramente por
  // debajo de la mitad del trazo más fino, NO se sugiere nada (null).
  if (maxSinTinta !== null && maxSinTinta >= 0.5 * minConTinta) {
    return { sugerido: null, minConTinta, maxSinTinta, motivo: 'clases_entrelazadas' };
  }
  // F4-1 (informe de verificación §6.1, severidad media — mitigación a):
  // si NINGUNA medición quedó en o bajo el corte 0.002, no hay celda vacía
  // medida: el piso de ruido real (papel/flash) es DESCONOCIDO y la separación
  // no se puede verificar. Es el caso exacto de la auditoría: ratios
  // [0.0139, 0.079, 0.138] — la vacía con flash entra como «con tinta», la
  // guarda 4.1 no dispara (maxSinTinta es null) y antes se sugería 0.0097,
  // el valor peligroso. Sin evidencia de separación no se calibra (null).
  // Matiz residual documentado: una vacía limpia pegada al corte JUNTO a una
  // vacía con flash encima del corte (p. ej. [0.002, 0.0139, 0.079]) aún pasa
  // la guarda relativa — ese caso solo lo resuelve el clustering sobre varias
  // corridas (PLAN Fase 8, variante 4.2), que es la solución de fondo.
  if (maxSinTinta === null) {
    return { sugerido: null, minConTinta, maxSinTinta, motivo: 'sin_celdas_vacias' };
  }
  const sugerido = Math.max(0.0015, Math.round(minConTinta * 0.7 * 10000) / 10000);
  return { sugerido, minConTinta, maxSinTinta };
}

export { hexTipo };
