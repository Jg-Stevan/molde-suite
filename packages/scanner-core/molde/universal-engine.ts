// Motor universal v3: evalúa un molde (zona_fija / ancla_relativa) sobre
// páginas renderizadas (foto o PDF). Todo en el navegador con Tesseract.js.
//
// Pipeline por página:
//   1. OCR completo (líneas con palabras y bbox) — una sola pasada (el MAPA
//      OCR GLOBAL, ya pagado por el pipeline).
//   2. Para cada campo de esa página:
//      - Resolver el rect final (fijo, ancla fuzzy, respaldo o fallback).
//      - Recortar y binarizar sin líneas impresas -> densidad de tinta.
//      - tipo presencia/firma/checkbox: diligenciado si ratio >= umbral, con
//        banda de indeterminación (0.6x–1.4x del umbral) en requiere_revision.
//      - tipo texto (FASE 1 del plan extracción relacional): lectura desde el
//        MAPA OCR GLOBAL (textoEnRect); el re-OCR del recorte queda SOLO como
//        rescate puntual (realce) y rescate anti-tachón (FASE 4) para
//        obligatorios. Regex anclado + limpieza intactos.
//      - Generar la captura JPEG de la zona (crop) para la verificación.
//   3. Validaciones aritméticas de cierre entre campos (Fase 2.2).
//   4. (FASE 1b) ningún obligatorio termina 'ok' con posición no verificada:
//      fuente 'referencia' + ancla_no_encontrada → requiere_revision.
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
  type BinImage,
} from './imageproc';
import { canvasJpeg, proveedorOcr, type LineaOcr } from './ocr-tipos';
import { ocrTextIsValid } from '../core/ocr';
import { clasificarMarcaSobreCrop, diferencialSiNo, detectarCajasHuecas, metricasFirma } from './marca';
import { ajustarAfin, aplicarAfin, type Afin6 } from './homografia';
import { letrasANumero, repararNumeroAmbiguo } from './letras-numero';
import {
  hexTipo,
  VOTO_CONSENSO_DIST,
  TOLERANCIA_GRUPO_DEFAULT,
  type CampoUniversal,
  type FixtureMolde,
  type GrupoMolde,
  type HerenciaMolde,
  type HuellaMolde,
  type MoldeUniversal,
  type RectNorm,
  type RelacionAncla,
  type ResultadoCampoUniversal,
  type ResultadoPaginaUniversal,
  type ResultadoUniversal,
  type ResultadoValidacion,
  type ValidacionMolde,
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
  /**
   * CORRECCIÓN post-verificación (recibo tachado 1700×1519): el hit se aceptó
   * por MATCH TEXTUAL PERFECTO Y ÚNICO en toda la página, saltándose la
   * penalización de posición. Ocurre en documentos recortados/escala distinta
   * de la referencia: la geometría normalizada del ancla queda desplazada
   * (dy≥0.16 → penalización 1/(1+3d) < 0.72) y un match textual perfecto era
   * RECHAZADO por posición, condenando el campo al fallback de referencia
   * (el diagnóstico real: concepto/forma_pago/fecha_pago con dy 0.16-0.21).
   * El bypass SOLO dispara cuando existe EXACTAMENTE UNA ventana con score
   * textual 1.0 (match en orden estricto, d=0): ambigüedad → la posición
   * sigue mandando. La bandera hace el juicio auditable en el forense.
   */
  solo_textual?: boolean;
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
  interface Candidato {
    hit: HitAncla;
    scoreTextual: number;
    score: number;
    desplazamiento: number;
    /** Distancia horizontal al centro esperado (0 sin rectEsperado). */
    dx: number;
    /** Distancia vertical al centro esperado (0 sin rectEsperado). */
    dy: number;
  }
  const candidatos: Candidato[] = [];
  for (const l of lineas) {
    const palabras = l.palabras;
    const n = palabras.length;
    for (let i = 0; i < n; i++) {
      for (let j = i; j < Math.min(n, i + objetivoPals.length + 1); j++) {
        const ventana = palabras.slice(i, j + 1);
        const frase = normTxt(ventana.map((p) => p.texto).join(' '));
        const fraseOrdenada = normTxt(ventana.map((p) => p.texto).sort((a, b) => a.localeCompare(b)).join(' '));
        if (!frase) continue;
        let scoreTextual = -1;
        // F1 (variante 1.2): distancia PONDERADA — la sustitución de un dígito
        // por otro cuesta 3x, así las etiquetas vecinas que difieren en un
        // dígito dejan de puntuar como casi idénticas.
        const d = editDistancePonderada(objetivo, frase);
        if (d <= tol) scoreTextual = 1 - d / objetivo.length;
        if (fraseOrdenada && scoreTextual < 0.95) {
          const dOrd = editDistancePonderada(objetivoOrdenado, fraseOrdenada);
          if (dOrd <= tol) {
            // Penalización leve: el match en orden correcto siempre gana si existe.
            scoreTextual = Math.max(scoreTextual, (1 - dOrd / objetivo.length) * 0.95);
          }
        }
        if (scoreTextual < 0) continue;
        let score = scoreTextual;
        let desplazamiento = 0;
        let dxCand = 0;
        let dyCand = 0;
        if (rectEsperado) {
          const cx = (palabras[i].bbox[0] + palabras[j].bbox[2]) / 2 / canvasW;
          const cy = (palabras[i].bbox[1] + palabras[j].bbox[3]) / 2 / canvasH;
          const dx = Math.abs(cx - (rectEsperado.x + rectEsperado.w / 2));
          const dy = Math.abs(cy - (rectEsperado.y + rectEsperado.h / 2));
          dxCand = dx;
          dyCand = dy;
          // Matiz 1 (Fase 2.6): penalización de posición SUAVIZADA. Antes
          // `score *= max(0.1, 1 - (dx+dy)*4)` hacía caer un match textual
          // PERFECTO (1.000) a 0.692 con un desplazamiento de solo 0.077
          // (caso recuento_marca de Transmisión pág. 2) — por debajo del corte
          // 0.72 y caía al fallback. La curva 1/(1+3d) mantiene 0.812 con
          // d=0.077 y sigue separando etiquetas lejanas (d=0.25 → 0.57).
          score *= 1 / (1 + 3 * (dx + dy));
          desplazamiento = dx + dy;
        }
        const hit: HitAncla = {
          rect: {
            x: palabras[i].bbox[0] / canvasW,
            y: palabras[i].bbox[1] / canvasH,
            w: (palabras[j].bbox[2] - palabras[i].bbox[0]) / canvasW,
            h: (palabras[j].bbox[3] - palabras[i].bbox[1]) / canvasH,
          },
          score,
        };
        candidatos.push({ hit, scoreTextual, score, desplazamiento, dx: dxCand, dy: dyCand });
      }
    }
  }
  if (!candidatos.length) return null;
  // CORRECCIÓN post-verificación: bypass posicional para match textual PERFECTO
  // y ÚNICO (d=0 en orden estricto en EXACTAMENTE UNA ventana de la página).
  // La penalización de posición existe para DESAMBIGUAR entre candidatos; con
  // un único candidato textual perfecto no hay nada que desambiguar, y en un
  // canvas recortado (proporción ≠ referencia) la geometría esperada no aplica:
  // rechazar el match por posición condena el campo al fallback silencioso.
  if (rectEsperado) {
    // La ambigüedad se JUZGA SOBRE TODOS los perfectos: si hay dos ventanas
    // perfectas (p. ej. las etiquetas «Firma» de ambas firmas) la posición debe
    // decidir como siempre, sin conceder el bypass a la que caiga dentro de la
    // cota. Filtrar por cota ANTES de contar convertía un caso ambiguo en
    // «único» y reabriendo el falso positivo (medido: 2 firmas 'ok' otra vez).
    const perfectos = candidatos.filter((c) => c.scoreTextual >= 0.999);
    if (perfectos.length === 1 && perfectos[0].desplazamiento <= ANCLA_TEXUAL_DESPLAZAMIENTO_MAX) {
      return { ...perfectos[0].hit, score: perfectos[0].scoreTextual, solo_textual: true };
    }
    // Ambigüedad textual resuelta por COLUMNA (2026-11-25e, recorte-66 medido):
    // dos «Firma» perfectas —una por columna de firma— y el recorte vertical
    // (dy ≈ 0.27) hunde el score posicional por debajo del corte aunque cada
    // campo espere SU columna. Si la posición sola no alcanza el corte y
    // EXACTAMENTE UN perfecto cae en la columna esperada (dx ≤ 0.1), ese es el
    // hit: la x desambigua lo que el texto no puede. La unicidad se juzga por
    // dx sobre TODOS los perfectos — dos copias en la MISMA columna (p. ej.
    // «Firma» arriba y al pie) siguen siendo ambiguas y jamás ganan el bypass.
    // Queda `solo_textual` (un campo de tinta nunca pasa a 'ok' por aquí —
    // ver endurecerFallbackNoVerificado).
    if (perfectos.length >= 2) {
      const mejorPos = candidatos.reduce((a, b) => (b.score > a.score ? b : a));
      if (mejorPos.score < ANCLA_SCORE_MIN) {
        const enColumna = perfectos.filter((c) => c.dx <= ANCLA_COLUMNA_DX_MAX);
        if (enColumna.length === 1 && enColumna[0].dy <= ANCLA_TEXUAL_DESPLAZAMIENTO_MAX) {
          return { ...enColumna[0].hit, score: enColumna[0].scoreTextual, solo_textual: true };
        }
      }
    }
  }
  let mejor = candidatos[0];
  for (const c of candidatos) {
    if (c.score > mejor.score) mejor = c;
  }
  return mejor.hit;
}

export interface RectResuelto {
  rect: RectNorm;
  /**
   * Overlay (azul): rect normalizado DONDE el OCR encontró el texto del ancla
   * (no la referencia del molde). Solo presente cuando `ancla_encontrada` es
   * true; ausente en fija/referencia/arnés (no hubo hit real que señalar).
   */
  ancla_rect?: RectNorm;
  fuente: 'ancla' | 'respaldo' | 'referencia' | 'fija';
  ancla_encontrada: boolean;
  score?: number;
  /**
   * Opción 1.2 (conversación): hubo match textual aceptable pero el CONTEXTO
   * exigido por `desambiguadores` no apareció cerca — el hit se rechazó y se
   * cayó a respaldo/referencia. Bandera para la verificación forense.
   */
  desambiguacion_fallida?: boolean;
  /**
   * FASE 2 (v3.2.0 — faro): banderas del modo relacional para el forense:
   * `ancla_fuera_de_zona` (el texto existe PERO fuera del faro — el mapa está
   * mal puesto o el documento es otra variante), `relacion_sin_candidato`
   * (nada en la dirección pedida → fallback de referencia).
   */
  banderasRelacionales?: string[];
  /**
   * FASE 2: empate ambiguo entre candidatos relacionales (2 a <10% de
   * distancia) — el motor NUNCA escoge en silencio: `relacion_ambigua` y el
   * campo termina en requiere_revision.
   */
  ambiguo?: boolean;
  /**
   * CORRECCIÓN post-verificación: la ancla se aceptó por bypass posicional
   * (match textual perfecto y único — ver HitAncla.solo_textual). El campo
   * lee sobre la posición REAL encontrada; la posición esperada del molde no
   * coincidía (documento recortado o escala distinta de la referencia).
   */
  ancla_solo_textual?: boolean;
  /**
   * FASE 3 (v3.3.0 — voto): la caja salió del CONSENSO de ≥2 anclas que
   * coincidieron en posición (bandera forense `ancla_consensuada`).
   */
  ancla_consensuada?: boolean;
  /**
   * FASE 3 (v3.3.0 — voto): TODOS los votos presentes discrepan entre sí —
   * el campo cayó a referencia y el endurecedor lo baja a requiere_revision
   * (bandera forense `anclas_discrepantes`).
   */
  anclas_discrepantes?: boolean;
}

/**
 * Score mínimo para aceptar un hit de ancla. Por debajo, el match casi seguro
 * corresponde a OTRA etiqueta del documento (p.ej. "FIRMA JURADO 4" difusa contra
 * la etiqueta impresa del jurado 2) y conviene caer al rect de referencia del
 * molde, que siempre apunta a la zona correcta.
 *
 * Exportado para que la auditoría de robustez (auditoria.ts) simule fallos y
 * cuente ambigüedades con EXACTAMENTE el mismo corte que corre en producción.
 */
export const ANCLA_SCORE_MIN = 0.72;

/**
 * Desplazamiento máximo (|dx|+|dy| normalizado) que tolera el bypass textual
 * `solo_textual`. El bypass existe porque en un canvas recortado la geometría
 * esperada se desplaza (el caso medido: dy 0.16-0.21), NO porque la posición
 * deje de importar: sin cota, una etiqueta que aparezca una sola vez en otra
 * zona (membrete, pie, anverso) anclaría el campo allí y leería un vecino
 * plausible con `fuente: 'ancla'` y conf alta — datos falsos con aspecto de
 * válidos. 0.30 cubre el recorte medido y sigue rechazando la esquina opuesta
 * de la página (dx+dy ≈ 1).
 */
export const ANCLA_TEXUAL_DESPLAZAMIENTO_MAX = 0.3;

/**
 * Ventana horizontal (normalizada) para desambiguar POR COLUMNA cuando el
 * ancla es textualmente perfecta pero repetida (p. ej. las dos etiquetas
 * «Firma» del recibo). Con ≥2 perfectos, un candidato cuenta como «en su
 * columna» si |dx| ≤ 0.1 respecto del centro esperado; solo se concede el
 * bypass si es el ÚNICO en columna (el par de firmas queda a ≥ 0.3 de
 * separación). Medido: recorte-66pct dx 0.02/0.07, etiquetas a 0.38.
 */
export const ANCLA_COLUMNA_DX_MAX = 0.1;

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
  return contextoPresente(campo.desambiguadores ?? [], hit, lineas, canvasW, canvasH);
}

/**
 * FASE 3 (v3.3.0 — voto): verificación de CONTEXTO para una lista de textos
 * desambiguadores (propios de una ancla o compartidos del campo). Todo texto
 * exigido debe aparecer por OCR a ≤ RADIO_DESAMBIGUACION del centro del hit.
 * Extraída de `desambiguado` para reutilizarla en la resolución POR ANCLA del
 * voto (cada ancla puede declarar su propio contexto).
 */
function contextoPresente(
  textos: string[],
  hit: HitAncla,
  lineas: LineaOcr[],
  canvasW: number,
  canvasH: number,
): boolean {
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

// ---- FASE 3 del plan (v3.3.0) — múltiples anclas con VOTO -----------------
// Opción 1.1 de la conversación de mejora: el campo declara `anclas[]` y el
// motor resuelve POR CONSENSO (2 anclas coinciden → acepta; discrepan →
// requiere_revision). Un documento con varias etiquetas estables en bandas
// distintas (cabecera + cuerpo + pie) deja de depender de UNA sola: si una
// se pierde por el tachón/luz, la otra sostiene el anclaje; si las dos
// aparecen pero NO coinciden, el documento cambió de forma y el motor se
// niega a escoger un lado en silencio.

/** Un voto: una ancla del campo encontró su etiqueta (y pasó su contexto). */
interface VotoAncla {
  /** Rect FINAL del campo (zona offseteada desde el hit de esta ancla). */
  rect: RectNorm;
  /** Rect del HIT del ancla (overlay azul). */
  anclaRect: RectNorm;
  /** Score textual del hit (el mismo que se reporta en resolución simple). */
  score: number;
  /** Texto de la ancla que votó (forense). */
  texto: string;
  /** El hit fue por bypass solo-textual (sin confirmación geométrica). */
  solo_textual: boolean;
}

function centroDe(r: RectNorm): { cx: number; cy: number } {
  return { cx: r.x + r.w / 2, cy: r.y + r.h / 2 };
}

/** ¿Dos rects resueltos representan la MISMA etiqueta? Centros a ≤
 *  VOTO_CONSENSO_DIST (jitter del OCR) o solape fuerte (IoU ≥ 0.5). */
function votosCoinciden(a: RectNorm, b: RectNorm): boolean {
  const ca = centroDe(a);
  const cb = centroDe(b);
  const dist = Math.hypot(ca.cx - cb.cx, ca.cy - cb.cy);
  if (dist <= VOTO_CONSENSO_DIST) return true;
  return iou(a, b) >= 0.5;
}

/** Media de rects de un clúster de votos (consenso geométrico estable). */
function rectConsensuado(votos: VotoAncla[]): RectNorm {
  const n = votos.length;
  const media = votos.reduce(
    (acc, v) => ({
      x: acc.x + v.rect.x / n,
      y: acc.y + v.rect.y / n,
      w: acc.w + v.rect.w / n,
      h: acc.h + v.rect.h / n,
    }),
    { x: 0, y: 0, w: 0, h: 0 },
  );
  return media;
}

/**
 * Resolución del campo por VOTO sobre `campo.anclas[]`. Devuelve:
 *  - consenso (clúster con ≥2 votos): rect medio, bandera `ancla_consensuada`.
 *  - un solo voto: EXACTAMENTE el comportamiento de la ancla única.
 *  - votos TODOS discrepantes: referencia + bandera `anclas_discrepantes`
 *    (el endurecedor lo baja a requiere_revision — jamás un lado elegido).
 *  - cero votos: null (el caller cae a respaldo global / referencia).
 */
function resolverPorVoto(
  campo: CampoUniversal,
  lineas: LineaOcr[],
  canvasW: number,
  canvasH: number,
): RectResuelto | null {
  // FASE 3 (voto): el offset puede ser PROPIO de cada ancla (las anclas de
  // bandas distintas necesitan su propia geometría para llegar al MISMO rect
  // final) — sin zona propia, la ancla usa la del campo (comportamiento de la
  // principal).
  const aplicarOffset = (base: RectNorm, zona: RectNorm): RectNorm => ({
    x: campo.x_absoluto ? zona.x : base.x + zona.x,
    y: base.y + zona.y,
    w: zona.w,
    h: zona.h,
  });
  const votos: VotoAncla[] = [];
  let desambiguacionFallida = false;
  for (const a of campo.anclas ?? []) {
    const hit = buscarAncla(a.texto, lineas, canvasW, canvasH, a.rect);
    if (!hit || hit.score < ANCLA_SCORE_MIN) continue;
    // Contexto: el PROPIO de la ancla; sin él, el compartido del campo.
    const ctx = a.desambiguadores ?? campo.desambiguadores ?? [];
    if (!contextoPresente(ctx, hit, lineas, canvasW, canvasH)) {
      desambiguacionFallida = true;
      continue;
    }
    votos.push({
      rect: aplicarOffset(hit.rect, a.zona ?? campo.zona),
      anclaRect: hit.rect,
      score: hit.score,
      texto: a.texto,
      solo_textual: hit.solo_textual === true,
    });
  }
  if (votos.length >= 2) {
    // Clústering voraz por score descendente: el clúster del mejor voto arrastra
    // a todos los que coinciden con él (transitivamente vía el centroide NO —
    // solo pares, para que un tercer voto alejado no ensanche el consenso).
    const orden = [...votos].sort((a, b) => b.score - a.score);
    const usados = new Set<number>();
    let mejorCluster: VotoAncla[] = [];
    for (let i = 0; i < orden.length; i++) {
      if (usados.has(i)) continue;
      const cluster = [orden[i]];
      usados.add(i);
      for (let j = i + 1; j < orden.length; j++) {
        if (usados.has(j)) continue;
        if (votosCoinciden(orden[i].rect, orden[j].rect)) {
          cluster.push(orden[j]);
          usados.add(j);
        }
      }
      if (cluster.length > mejorCluster.length) mejorCluster = cluster;
    }
    if (mejorCluster.length >= 2) {
      return {
        rect: rectConsensuado(mejorCluster),
        ancla_rect: mejorCluster[0].anclaRect,
        fuente: 'ancla',
        ancla_encontrada: true,
        ancla_consensuada: true,
        // El score reportado es el del MEJOR voto del clúster (conservador:
        // la calidad del anclaje es la de su eslabón más débil NO, la del
        // mejor NO — se reporta la mejor evidencia disponible).
        score: Math.max(...mejorCluster.map((v) => v.score)),
        // Solo si TODO el clúster llegó por bypass (ninguna confirmación
        // geométrica) la caja sigue sin estar probada por posición.
        ancla_solo_textual: mejorCluster.every((v) => v.solo_textual) || undefined,
      };
    }
    // Todos los votos discrepantes (cada clúster es un singleton): el campo
    // cae a la referencia con la bandera explicable — el endurecedor baja un
    // 'ok' así a requiere_revision (jamás se escoge un lado en silencio).
    const rectRef = campo.ancla?.rect ?? campo.anclas?.[0]?.rect;
    if (rectRef) {
      return {
        rect: aplicarOffset(rectRef, campo.zona),
        fuente: 'referencia',
        ancla_encontrada: false,
        anclas_discrepantes: true,
        desambiguacion_fallida: desambiguacionFallida || undefined,
      };
    }
    return null;
  }
  if (votos.length === 1) {
    // Un único voto = ancla única de siempre (retrocompatibilidad total).
    return {
      rect: votos[0].rect,
      ancla_rect: votos[0].anclaRect,
      fuente: 'ancla',
      ancla_encontrada: true,
      score: votos[0].score,
      ancla_solo_textual: votos[0].solo_textual || undefined,
      desambiguacion_fallida: desambiguacionFallida || undefined,
    };
  }
  // Cero votos: sin decisión propia — el caller sigue con respaldo/referencia.
  return null;
}

// ---- FASE 2 (v3.2.0 — corrección del dueño #2, «EL MOLDE ES EL MAPA») ----
// Anclas RELACIONALES: el molde declara `zona_busqueda` (EL FARO) y la relación
// con el contexto local. El motor busca el ancla SOLO dentro del faro y resuelve
// la caja final DENTRO de ese contexto pequeño. Fuera del faro no hay nada —
// jamás una búsqueda global (la palabra "firmante" de un párrafo legal no puede
// robarle el hit a la etiqueta impresa "FIRMA DEL COMPRADOR").

/** Margen de tolerancia del faro (fracción de página): los centros al borde
 * (±1%) cuentan como dentro — tolera el edge del OCR y el pequeño desplazamiento
 * de la etiqueta entre variantes del mismo documento. Exportado para el editor
 * (previsualización del faro con EXACTAMENTE la misma regla que el motor). */
export const FARO_MARGEN = 0.01;

/** ¿El punto (cx, cy) cae dentro del rect (+ margen)? */
function puntoEnRect(cx: number, cy: number, r: RectNorm, margen: number): boolean {
  return (
    cx >= r.x - margen && cx <= r.x + r.w + margen &&
    cy >= r.y - margen && cy <= r.y + r.h + margen
  );
}

/**
 * EL FARO: filtra las líneas OCR al contexto declarado en el molde. Solo las
 * líneas cuyo CENTRO cae dentro de `zona_busqueda` (+ FARO_MARGEN) existen para
 * el campo. Exportado para que el editor filtre sus sugerencias de ancla con la
 * MISMA regla que corre en producción.
 */
export function lineasEnFaro(
  lineas: LineaOcr[],
  canvasW: number,
  canvasH: number,
  faro: RectNorm,
): LineaOcr[] {
  return lineas.filter((l) => {
    const cx = (l.bbox[0] + l.bbox[2]) / 2 / canvasW;
    const cy = (l.bbox[1] + l.bbox[3]) / 2 / canvasH;
    return puntoEnRect(cx, cy, faro, FARO_MARGEN);
  });
}

/** Banda adyacente al ancla dentro del faro (relacion.que = 'zona'): del borde
 * del ancla hacia el borde del faro en la dirección pedida. Geometría pura del
 * MAPA declarado — no inventa nada que el molde no haya definido. */
function bandaAdyacente(ancla: RectNorm, faro: RectNorm, direccion: RelacionAncla['direccion']): RectNorm {
  switch (direccion) {
    case 'arriba':
      return { x: faro.x, y: faro.y, w: faro.w, h: Math.max(0.004, ancla.y - faro.y) };
    case 'abajo':
      return {
        x: faro.x,
        y: Math.min(0.999, ancla.y + ancla.h),
        w: faro.w,
        h: Math.max(0.004, faro.y + faro.h - (ancla.y + ancla.h)),
      };
    case 'izquierda':
      return { x: faro.x, y: ancla.y, w: Math.max(0.004, ancla.x - faro.x), h: ancla.h };
    case 'derecha':
      return {
        x: Math.min(0.999, ancla.x + ancla.w),
        y: ancla.y,
        w: Math.max(0.004, faro.x + faro.w - (ancla.x + ancla.w)),
        h: ancla.h,
      };
  }
}

/** Distancia (gap entre caras) del candidato al ancla según la dirección, o
 * null si su centro NO cae en el lado pedido (no es candidato válido). */
function distanciaRelacional(
  cand: RectNorm,
  ancla: RectNorm,
  direccion: RelacionAncla['direccion'],
): number | null {
  const cyCand = cand.y + cand.h / 2;
  const cxCand = cand.x + cand.w / 2;
  switch (direccion) {
    case 'arriba':
      if (cyCand >= ancla.y) return null;
      return Math.max(0, ancla.y - (cand.y + cand.h));
    case 'abajo':
      if (cyCand <= ancla.y + ancla.h) return null;
      return Math.max(0, cand.y - (ancla.y + ancla.h));
    case 'izquierda':
      if (cxCand >= ancla.x) return null;
      return Math.max(0, ancla.x - (cand.x + cand.w));
    case 'derecha':
      if (cxCand <= ancla.x + ancla.w) return null;
      return Math.max(0, cand.x - (ancla.x + ancla.w));
  }
}

/** ¿Los dos rects se solapan? (para excluir la propia línea del ancla como
 * candidata relacional). */
function rectsSeSolapan(a: RectNorm, b: RectNorm): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

interface CandidatoRelacional {
  rect: RectNorm;
  distancia: number;
}

/** Umbral de empate ambiguo (10% de la distancia del elegido, con piso
 * absoluto para distancias ~0). Exportado para la auditoría. */
const UMBRAL_EMPATE_RELACIONAL = 0.1;

/**
 * Elección del candidato por `orden` + distancia. Honestidad (regla del
 * dueño): un empate ambiguo NO se resuelve en silencio — se marca y el campo
 * va a revisión. Con orden='indice' que excede los candidatos → null (honesto:
 * no se toma "el último que haya").
 */
function elegirCandidatoRelacional(
  candidatos: CandidatoRelacional[],
  relacion: RelacionAncla,
): { elegido: RectNorm; ambiguo: boolean } | null {
  if (!candidatos.length) return null;
  const ordenados = [...candidatos].sort((a, b) => a.distancia - b.distancia);
  if (relacion.orden === 'indice') {
    const idx = Math.max(1, Math.round(relacion.indice ?? 1)) - 1;
    if (idx >= ordenados.length) return null; // el N-ésimo pedido NO existe
    return { elegido: ordenados[idx].rect, ambiguo: false };
  }
  const elegido = ordenados[0];
  const piso = elegido.distancia * (1 + UMBRAL_EMPATE_RELACIONAL) + 0.001;
  const ambiguo = ordenados.length > 1 && ordenados[1].distancia <= piso;
  return { elegido: elegido.rect, ambiguo };
}

/** Ajuste fino del candidato con `zona` (finura sobre el candidato, semántica
 * del plan v2 §3.1): x/y = offset; w/h = tamaño FINAL — 0 = heredar el del
 * candidato (así el molde puede solo ensanchar una banda sin recalcular todo). */
function aplicarFinura(candidato: RectNorm, zona: RectNorm): RectNorm {
  return {
    x: candidato.x + zona.x,
    y: candidato.y + zona.y,
    w: zona.w > 0 ? zona.w : candidato.w,
    h: zona.h > 0 ? zona.h : candidato.h,
  };
}

/** Clamp del rect final a la página (defensivo — rectAPx ya tolera degenerados,
 * pero el rect del overlay no debe salir del 0-1). */
function clampRect(r: RectNorm): RectNorm {
  const x = Math.min(Math.max(r.x, 0), 0.999);
  const y = Math.min(Math.max(r.y, 0), 0.999);
  return {
    x,
    y,
    w: Math.min(Math.max(r.w, 0.002), 1 - x),
    h: Math.min(Math.max(r.h, 0.002), 1 - y),
  };
}

/**
 * Resuelve el rect de un campo `ancla_relacional` (v3.2.0). Pipeline:
 *
 *  1. FILTRAR EL MUNDO POR EL FARO: solo líneas OCR con centro dentro de
 *     `zona_busqueda` (+1%). El resto de la página NO existe para este campo.
 *  2. BUSCAR EL ANCLA SOLO EN EL FARO: `buscarAncla()` (el fuzzy existente,
 *     con penalización de dígitos y desambiguadores) sobre las líneas filtradas.
 *     Si el texto aparece dos veces en el documento, el faro desambigua por
 *     posición sin necesitar `desambiguadores`.
 *  3. RESOLVER LA CAJA RELATIVA EN EL CONTEXTO PEQUEÑO: candidatos SIEMPRE
 *     dentro del faro (linea = líneas OCR del faro; caja = recuadros huecos
 *     impresos detectados con la detección existente de marca.ts; zona = banda
 *     adyacente geométrica), elegidos por `direccion` + `orden` + distancia.
 *  4. RECT FINAL = candidato + ajuste fino de `zona`.
 *  5. HONESTIDAD: ancla no aparece DENTRO del faro → bandera
 *     `ancla_fuera_de_zona` si aparece fuera (diagnóstico: el faro está mal
 *     puesto o el documento es otra variante) → cae a `ancla.rect` de
 *     referencia (fallback, nunca inventa). Sin candidato en la dirección
 *     pedida → `relacion_sin_candidato` + fallback. Empate ambiguo →
 *     `relacion_ambigua` → requiere_revision, jamás pick silencioso.
 *
 * `canvas` (opcional) solo se necesita con relacion.que = 'caja'.
 */
export function resolverRectRelacional(
  campo: CampoUniversal,
  lineas: LineaOcr[],
  canvasW: number,
  canvasH: number,
  canvas?: HTMLCanvasElement,
): RectResuelto | null {
  const faro = campo.zona_busqueda;
  const ancla = campo.ancla;
  if (!faro || !ancla?.texto) return null; // sin faro no hay estrategia (validador lo rechaza antes)
  const relacion: RelacionAncla = campo.relacion ?? { direccion: 'arriba', que: 'zona', orden: 'mas_cercano' };
  const banderas: string[] = [];

  // 1+2. Faro primero: la búsqueda nunca ve la página completa.
  const lineasFaro = lineasEnFaro(lineas, canvasW, canvasH, faro);

  /** Fallback de referencia (la posición guardada del escaneo de referencia).
   *  Con que='zona' la banda ES computable desde la referencia (geometría del
   *  mapa); con linea/caja sin candidato, semántica ancla_relativa (offset). */
  const fallbackReferencia = (): RectResuelto | null => {
    if (!ancla.rect) return null;
    const base = relacion.que === 'zona'
      ? bandaAdyacente(ancla.rect, faro, relacion.direccion)
      : ancla.rect;
    return {
      rect: clampRect(aplicarFinura(base, campo.zona)),
      fuente: 'referencia',
      ancla_encontrada: hitUsado !== null,
      banderasRelacionales: banderas.length ? [...banderas] : undefined,
    };
  };

  let hitUsado: HitAncla | null = null;
  let fuenteAncla: 'ancla' | 'respaldo' = 'ancla';
  const hit = buscarAncla(ancla.texto, lineasFaro, canvasW, canvasH, ancla.rect);
  if (hit && hit.score >= ANCLA_SCORE_MIN && desambiguado(campo, hit, lineasFaro, canvasW, canvasH)) {
    hitUsado = hit;
  } else if (campo.ancla_respaldo) {
    const hit2 = buscarAncla(campo.ancla_respaldo, lineasFaro, canvasW, canvasH, ancla.rect);
    if (hit2 && hit2.score >= ANCLA_SCORE_MIN && desambiguado(campo, hit2, lineasFaro, canvasW, canvasH)) {
      hitUsado = hit2;
      fuenteAncla = 'respaldo';
      banderas.push('ancla_respaldo');
    }
  }

  // Diagnóstico honesto: ¿el texto del ancla existe FUERA del faro? La búsqueda
  // global NO resuelve el campo (regla del dueño), pero la bandera señala el
  // faro mal puesto (o la variante equivocada) en el forense.
  if (!hitUsado) {
    const hitFuera = buscarAncla(ancla.texto, lineas, canvasW, canvasH, ancla.rect);
    if (hitFuera && hitFuera.score >= ANCLA_SCORE_MIN) banderas.push('ancla_fuera_de_zona');
    return fallbackReferencia();
  }

  const rectAncla = hitUsado.rect;
  const score = hitUsado.score;

  // 3. Candidatos SIEMPRE dentro del faro.
  if (relacion.que === 'zona') {
    // Banda adyacente: geometría pura del mapa (ancla → borde del faro).
    const banda = bandaAdyacente(rectAncla, faro, relacion.direccion);
    return {
      rect: clampRect(aplicarFinura(banda, campo.zona)),
      ancla_rect: rectAncla,
      fuente: fuenteAncla,
      ancla_encontrada: true,
      score,
      banderasRelacionales: banderas.length ? [...banderas] : undefined,
    };
  }

  if (relacion.que === 'linea') {
    const candidatos: CandidatoRelacional[] = [];
    for (const l of lineasFaro) {
      const r: RectNorm = {
        x: l.bbox[0] / canvasW,
        y: l.bbox[1] / canvasH,
        w: (l.bbox[2] - l.bbox[0]) / canvasW,
        h: (l.bbox[3] - l.bbox[1]) / canvasH,
      };
      if (rectsSeSolapan(r, rectAncla)) continue; // la propia línea del ancla no es candidata
      const d = distanciaRelacional(r, rectAncla, relacion.direccion);
      if (d === null) continue;
      candidatos.push({ rect: r, distancia: d });
    }
    const sel = elegirCandidatoRelacional(candidatos, relacion);
    if (!sel) {
      banderas.push('relacion_sin_candidato');
      return fallbackReferencia();
    }
    return {
      rect: clampRect(aplicarFinura(sel.elegido, campo.zona)),
      ancla_rect: rectAncla,
      fuente: fuenteAncla,
      ancla_encontrada: true,
      score,
      banderasRelacionales: banderas.length ? [...banderas] : undefined,
      ambiguo: sel.ambiguo || undefined,
    };
  }

  // relacion.que === 'caja': recuadros huecos del faro (detección existente de
  // marca.ts, expuesta — cero detección nueva). Sin canvas no hay candidatos:
  // degradación honesta a referencia (jamás se inventa la caja).
  if (!canvas) {
    banderas.push('relacion_sin_candidato');
    return fallbackReferencia();
  }
  const cajas = detectarCajasHuecas(canvas, faro);
  const candidatos: CandidatoRelacional[] = [];
  for (const c of cajas) {
    if (rectsSeSolapan(c, rectAncla)) continue;
    const d = distanciaRelacional(c, rectAncla, relacion.direccion);
    if (d === null) continue;
    candidatos.push({ rect: c, distancia: d });
  }
  const selCaja = elegirCandidatoRelacional(candidatos, relacion);
  if (!selCaja) {
    banderas.push('relacion_sin_candidato');
    return fallbackReferencia();
  }
  return {
    rect: clampRect(aplicarFinura(selCaja.elegido, campo.zona)),
    ancla_rect: rectAncla,
    fuente: fuenteAncla,
    ancla_encontrada: true,
    score,
    banderasRelacionales: banderas.length ? [...banderas] : undefined,
    ambiguo: selCaja.ambiguo || undefined,
  };
}

/** Resuelve el rectángulo final de un campo sobre una página OCR-izada. */
export function resolverRectCampo(
  campo: CampoUniversal,
  lineas: LineaOcr[],
  canvasW: number,
  canvasH: number,
  /**
   * FASE 2: canvas de la página (opcional) — solo lo consume la estrategia
   * `ancla_relacional` con relacion.que = 'caja' (detección de recuadros).
   * Los caminos existentes (zona_fija / ancla_relativa) NO lo tocan.
   */
  canvas?: HTMLCanvasElement,
): RectResuelto | null {
  if (campo.estrategia === 'zona_fija') {
    return { rect: { ...campo.zona }, fuente: 'fija', ancla_encontrada: true };
  }
  if (campo.estrategia === 'ancla_relacional') {
    return resolverRectRelacional(campo, lineas, canvasW, canvasH, canvas);
  }
  const ancla = campo.ancla;
  if (!ancla?.texto) return null;

  const aplicarOffset = (base: RectNorm): RectNorm => ({
    x: campo.x_absoluto ? campo.zona.x : base.x + campo.zona.x,
    y: base.y + campo.zona.y,
    w: campo.zona.w,
    h: campo.zona.h,
  });

  // FASE 3 (v3.3.0 — voto): con `anclas[]` declaradas la resolución es POR
  // CONSENSO (nunca global). El path solo entra con ≥2 anclas válidas (el
  // validador rechaza listas de 1 — para eso está `ancla`). Un único voto
  // dentro de resolverPorVoto replica EXACTAMENTE la semántica de la ancla
  // única; cero votos cae al respaldo global / referencia de abajo.
  if (campo.anclas && campo.anclas.length >= 2) {
    const voto = resolverPorVoto(campo, lineas, canvasW, canvasH);
    if (voto) return voto;
    // Voto sin decisión (0 votos): seguir con respaldo/referencia.
  }

  let desambiguacionFallida = false;
  const hit = buscarAncla(ancla.texto, lineas, canvasW, canvasH, ancla.rect);
  if (hit && hit.score >= ANCLA_SCORE_MIN) {
    if (desambiguado(campo, hit, lineas, canvasW, canvasH)) {
      return {
        rect: aplicarOffset(hit.rect),
        ancla_rect: hit.rect,
        fuente: 'ancla',
        ancla_encontrada: true,
        score: hit.score,
        ancla_solo_textual: hit.solo_textual || undefined,
      };
    }
    desambiguacionFallida = true;
  }
  if (campo.ancla_respaldo) {
    const hit2 = buscarAncla(campo.ancla_respaldo, lineas, canvasW, canvasH, ancla.rect);
    if (hit2 && hit2.score >= ANCLA_SCORE_MIN) {
      if (desambiguado(campo, hit2, lineas, canvasW, canvasH)) {
        return {
          rect: aplicarOffset(hit2.rect),
          ancla_rect: hit2.rect,
          fuente: 'respaldo',
          ancla_encontrada: true,
          score: hit2.score,
          ancla_solo_textual: hit2.solo_textual || undefined,
        };
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
  // FASE 3 (voto): el editor dibuja la ancla PRINCIPAL; si el campo solo
  // declara `anclas[]`, la primera de la lista es la principal de dibujo.
  const anclaDibujo = campo.ancla ?? (campo.anclas?.length ? campo.anclas[0] : undefined);
  // FASE 2 (v3.2.0): el relacional dibuja la resolución DE REFERENCIA — con
  // que='zona' la banda es geometría del mapa (ancla.rect → borde del faro);
  // con linea/caja sin OCR, semántica de offset sobre ancla.rect (igual que
  // ancla_relativa). Sin ancla.rect → null (el lienzo lo marca NO EVALUABLE).
  if (campo.estrategia === 'ancla_relacional') {
    if (!anclaDibujo?.rect || !campo.zona_busqueda) return null;
    const relacion = campo.relacion ?? { direccion: 'arriba' as const, que: 'zona' as const, orden: 'mas_cercano' as const };
    const base = relacion.que === 'zona'
      ? bandaAdyacente(anclaDibujo.rect, campo.zona_busqueda, relacion.direccion)
      : anclaDibujo.rect;
    return aplicarFinura(base, campo.zona);
  }
  if (!anclaDibujo?.rect) return anclaDibujo?.texto ? null : { ...campo.zona };
  return {
    x: campo.x_absoluto ? campo.zona.x : anclaDibujo.rect.x + campo.zona.x,
    y: anclaDibujo.rect.y + campo.zona.y,
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

// ---- FASE 4 (plan extracción relacional): rescate anti-tachón ----

/**
 * Fracción del ANCHO DEL RECORT que fija el kernel de apertura del rescate
 * anti-tachón (`k = max(20, ancho × frac)`): la apertura elimina trazos
 * horizontales/verticales de extensión ≥ k. El valor es el MISMO que usa el
 * motor para medir tinta sin líneas impresas (0.083 — probado en producción):
 * en un recorte de ~500 px elimina trazos ≥ 41 px (tachones de 50-200 px) y
 * conserva trazos de letra (~2-5 px). Si una corrida real exige otro valor,
 * se calibra AQUÍ (cambio interno, sin impacto en contrato).
 */
const FRACCION_KERNEL_RESCATE_TACHON = 0.083;

/** BinImage (1 = tinta) → canvas blanco con tinta negra, listo para OCR. */
function binACanvas(bin: BinImage, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.createImageData(w, h);
  for (let i = 0, p = 0; i < bin.data.length; i++, p += 4) {
    const v = bin.data[i] ? 0 : 255;
    img.data[p] = v;
    img.data[p + 1] = v;
    img.data[p + 2] = v;
    img.data[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * Rescate anti-tachón (FASE 4): binariza el recorte SIN líneas largas
 * (`binarizeNoLines` — apertura morfológica H/V que elimina tachones y
 * reglas impresas) y re-OCRea el resultado limpio. LOCAL al campo que falló;
 * jamás sobre la página completa. Si la limpieza no produce texto usable el
 * llamador conserva el resultado original y marca `rescate_fallido`.
 */
async function rescateAntiTachon(
  crop: HTMLCanvasElement,
  whitelist?: string,
): Promise<{ texto: string; conf: number | null } | null> {
  try {
    const gray = canvasGrayscale(crop);
    const gctx = gray.getContext('2d', { willReadFrequently: true })!;
    const gimg = gctx.getImageData(0, 0, gray.width, gray.height);
    const g = new Uint8Array(gray.width * gray.height);
    for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = gimg.data[p];
    const sinLineas = binarizeNoLines(g, gray.width, gray.height, FRACCION_KERNEL_RESCATE_TACHON);
    const limpio = binACanvas(sinLineas, gray.width, gray.height);
    // Psm 7 (línea única): las zonas de texto del molde son de una línea.
    // Si no produce nada, psm 6 (bloque) para zonas de dos líneas.
    const p7 = await proveedorOcr().ocrTextoUnico(limpio, { whitelist, psm: '7' });
    if (p7.texto.trim()) return p7;
    const p6 = await proveedorOcr().ocrTextoUnico(limpio, { whitelist, psm: '6' });
    return p6;
  } catch {
    // La limpieza es un RECURSO de diagnóstico: un fallo inesperado no puede
    // tumbar la corrida — el campo conserva su resultado original.
    return null;
  }
}

/**
 * CORRECCIÓN post-verificación (P4 del diagnóstico — recibo tachado): MAPA OCR
 * DE RESCATE de la página completa. El tachón/revelado rompe la SEGMENTACIÓN
 * de líneas del OCR global (Tesseract: "Total count=0" — 110 errores reales en
 * la corrida de diagnóstico): líneas enteras dejan de existir en el mapa y
 * TODAS las anclas que dependían de ellas caen a fallback silencioso. La
 * limpieza morfológica (`binarizeNoLines`, misma primitiva del rescate local)
 * elimina los trazos largos ANTES del OCR: en la corrida real recupera el
 * título "RECIBO DE PAGO" (psm 4 no lo segmentaba con el tachón del importe).
 *
 * Es una SEGUNDA pasada OCR de página completa — POR ESO es PEREZOSA: solo se
 * construye si algún campo perdió su ancla en el mapa primario (documento
 * limpio → 1 pasada OCR, costo 0). La calidad del texto binarizado es menor
 * para VALORES (pierde puntuación fina), así que el mapa primario sigue siendo
 * la fuente de lectura preferida y este mapa es anclaje + rescate de valor.
 */
async function mapaOcrRescate(canvas: HTMLCanvasElement): Promise<LineaOcr[]> {
  const gray = canvasGrayscale(canvas);
  const gctx = gray.getContext('2d', { willReadFrequently: true })!;
  const gimg = gctx.getImageData(0, 0, gray.width, gray.height);
  const g = new Uint8Array(gray.width * gray.height);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = gimg.data[p];
  const sinLineas = binarizeNoLines(g, gray.width, gray.height, FRACCION_KERNEL_RESCATE_TACHON);
  const limpio = binACanvas(sinLineas, gray.width, gray.height);
  const resc = await proveedorOcr().ocrLines(limpio);
  return resc.lines;
}

// ---- FASE 1 (plan extracción relacional): lectura desde el mapa OCR global ----

/**
 * Extrae el texto de un campo desde el MAPA OCR GLOBAL de la página (la pasada
 * única de `ocrLines`, ya pagada) en vez de re-OCrear el recorte de cada
 * campo (12 campos = 12 pasadas extra que además leían recortes encogidos:
 * Causa B del diagnóstico — la altura de banda relativa al alto del canvas
 * adelgazaba el recorte y degradaba el OCR en un ciclo de realimentación).
 *
 * Reglas de inclusión (plan FASE 1a):
 * - Se incluyen las PALABRAS cuyo CENTRO cae dentro del rect resuelto (recorte
 *   fino: la etiqueta impresa vecina queda fuera aunque su línea cruce).
 * - Orden de lectura natural: filas arriba→abajo agrupadas por cercanía
 *   vertical, palabras izquierda→derecha dentro de cada fila.
 * - Confianza: media de las confianzas de las palabras incluidas; si ninguna
 *   palabra reporta confianza → null ("sin señal", N-9/G-3 — jamás inventado).
 *
 * El texto que no quedó en el mapa global (OCR global falló) se recupera por
 * los caminos de RESCATE del motor (realce y anti-tachón), no aquí.
 */
export function textoEnRect(
  lineas: LineaOcr[],
  rect: RectNorm,
  canvasW: number,
  canvasH: number,
): { texto: string; conf: number | null; palabras: number } {
  const x0 = rect.x * canvasW;
  const y0 = rect.y * canvasH;
  const x1 = (rect.x + rect.w) * canvasW;
  const y1 = (rect.y + rect.h) * canvasH;
  interface Pieza {
    texto: string;
    conf: number | null;
    cx: number;
    cy: number;
    alto: number;
  }
  const piezas: Pieza[] = [];
  for (const l of lineas) {
    const [lx0, ly0, lx1, ly1] = l.bbox;
    // La línea debe INTERSECTAR el rect (plan: IoU > 0 o centro dentro).
    const ix0 = Math.max(lx0, x0);
    const iy0 = Math.max(ly0, y0);
    const ix1 = Math.min(lx1, x1);
    const iy1 = Math.min(ly1, y1);
    if (ix1 - ix0 <= 0 || iy1 - iy0 <= 0) continue;
    for (const p of l.palabras) {
      const cx = (p.bbox[0] + p.bbox[2]) / 2;
      const cy = (p.bbox[1] + p.bbox[3]) / 2;
      if (cx < x0 || cx > x1 || cy < y0 || cy > y1) continue;
      const conf = Number.isFinite(p.conf) ? p.conf : null;
      piezas.push({ texto: p.texto, conf, cx, cy, alto: Math.max(1, p.bbox[3] - p.bbox[1]) });
    }
  }
  if (!piezas.length) return { texto: '', conf: null, palabras: 0 };
  // Agrupación en filas: piezas ordenadas por cy; una pieza entra a la fila
  // actual si su centro vertical está cerca del promedio de la fila (tolerancia
  // = 60% del alto de palabra, piso 6 px). Determinista y estable.
  piezas.sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  const filas: Pieza[][] = [];
  for (const p of piezas) {
    const fila = filas[filas.length - 1];
    if (fila) {
      const promCy = fila.reduce((s, q) => s + q.cy, 0) / fila.length;
      const tol = Math.max(6, fila[0].alto * 0.6);
      if (Math.abs(p.cy - promCy) <= tol) {
        fila.push(p);
        continue;
      }
    }
    filas.push([p]);
  }
  const texto = filas
    .map((f) => f.sort((a, b) => a.cx - b.cx).map((p) => p.texto).join(' '))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const conConf = piezas.filter((p) => p.conf !== null);
  const conf = conConf.length ? conConf.reduce((s, p) => s + (p.conf as number), 0) / conConf.length : null;
  return { texto, conf, palabras: piezas.length };
}

/** Compila el patrón del campo ANCLADO a la cadena completa (G-8).
 *  FASE 9 (herencia): el patrón puede venir heredado del tipo
 *  (`molde.herencia[tipo].patron`) cuando el campo no lo declara. */
function compilarPatron(patron: string | undefined, banderas: string[]): RegExp | null {
  if (!patron) return null;
  const yaAnclado = patron.startsWith('^') && patron.endsWith('$');
  const fuente = yaAnclado ? patron : `^(?:${patron})$`;
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

/**
 * FASE 9 (v3.3.0, §7 — herencia por TIPO): umbral EFECTIVO del campo.
 * Prioridad: campo.umbral → herencia[tipo].umbral → 0.02 (defensivo: el
 * validador ya rechaza un molde sin ninguna de las dos fuentes — jamás un
 * default silencioso en tinta; el 0.02 es el valor histórico del contrato).
 */
export function umbralEfectivo(campo: CampoUniversal, herencia?: HerenciaMolde): number {
  if (typeof campo.umbral === 'number') return campo.umbral;
  const h = herencia?.[campo.tipo]?.umbral;
  if (typeof h === 'number' && Number.isFinite(h)) return h;
  return 0.02;
}

/** FASE 9: patrón EFECTIVO del campo (campo.patron → herencia[tipo].patron). */
export function patronEfectivo(campo: CampoUniversal, herencia?: HerenciaMolde): string | undefined {
  return campo.patron ?? herencia?.[campo.tipo]?.patron;
}

async function evaluarCampo(
  campo: CampoUniversal,
  canvas: HTMLCanvasElement,
  lineas: LineaOcr[],
  previews: boolean,
  /**
   * CORRECCIÓN post-verificación: mapa OCR de RESCATE perezoso (2ª pasada sobre
   * el canvas con limpieza anti-tachón). Solo se invoca si el ancla del campo
   * no apareció en el mapa primario o el valor quedó vacío — documento limpio
   * nunca la paga. Ver `mapaOcrRescate`.
   */
  rescateMapa?: { obtenerLineas: () => Promise<LineaOcr[]> },
  /** FASE 9 (herencia): umbral/patrón por tipo cuando el campo no los declara. */
  herencia?: HerenciaMolde,
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
    ancla_rect: null,
    crop: null,
    crop_dims: null,
    fuente: null,
    banderas: [],
  };
  // FASE 9 (herencia): umbral y patrón EFECTIVOS (campo → herencia del tipo).
  const umbralCampo = umbralEfectivo(campo, herencia);
  const patronRe = compilarPatron(patronEfectivo(campo, herencia), base.banderas);
  let resuelto = resolverRectCampo(campo, lineas, canvas.width, canvas.height, canvas);
  let lineasRescate: LineaOcr[] | null = null;
  // CORRECCIÓN post-verificación: rescate de ANCLA sobre el mapa limpio. La
  // segmentación rota por tachones puede haber borrado del mapa primario la
  // línea del ancla (título "RECIBO DE PAGO" en el recibo tachado). El reintent
  // usa la MISMA resolución (fuzzy + bypass + desambiguado) sobre el mapa de
  // rescate; si encuentra, la bandera deja la historia auditable.
  if (rescateMapa && resuelto && !resuelto.ancla_encontrada && campo.estrategia !== 'zona_fija') {
    lineasRescate = await rescateMapa.obtenerLineas();
    const resueltoRescate = resolverRectCampo(campo, lineasRescate, canvas.width, canvas.height, canvas);
    if (resueltoRescate && resueltoRescate.ancla_encontrada) {
      resuelto = resueltoRescate;
      base.banderas.push('ancla_rescate_anti_tachon');
    }
  }
  if (!resuelto) {
    base.banderas.push('sin_rect');
    if (campo.estrategia === 'ancla_relativa' || campo.estrategia === 'ancla_relacional') {
      base.banderas.push('ancla_no_encontrada');
    }
    return base;
  }
  base.rect = resuelto.rect;
  base.ancla_rect = resuelto.ancla_rect ?? null;
  base.fuente = resuelto.fuente;
  if (!resuelto.ancla_encontrada) base.banderas.push('ancla_no_encontrada');
  if (resuelto.fuente === 'respaldo') base.banderas.push('ancla_respaldo');
  // Opción 1.2: el match textual existió pero el contexto exigido no apareció.
  if (resuelto.desambiguacion_fallida) base.banderas.push('desambiguacion_fallida');
  // CORRECCIÓN: ancla aceptada por match textual perfecto y único (bypass de
  // posición — documento recortado/escala distinta de la referencia).
  if (resuelto.ancla_solo_textual) base.banderas.push('ancla_solo_textual');
  // FASE 3 (v3.3.0 — voto): consenso alcanzado o discrepancia total.
  if (resuelto.ancla_consensuada) base.banderas.push('ancla_consensuada');
  if (resuelto.anclas_discrepantes) base.banderas.push('anclas_discrepantes');
  // FASE 2 (v3.2.0 — faro): banderas del modo relacional + empate ambiguo.
  if (resuelto.banderasRelacionales?.length) base.banderas.push(...resuelto.banderasRelacionales);
  if (resuelto.ambiguo) base.banderas.push('relacion_ambigua');

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
    //
    // Fase A2 (blueprint DLA — port checkbox-extractor): clasificación de la
    // MARCA por forma/topología de componentes (caja impresa hueca + marca
    // interior). La forma es SEÑAL, no veredicto: si la forma discrepa de la
    // tinta, el campo va a revisión en vez de inventar un lado.
    const marca = clasificarMarcaSobreCrop(rec.crop);
    // Métrica estructural para la verificación forense y la calibración
    // (sugerirUmbral / clustering): estado de forma + llenado interior.
    base.marca = {
      estado: marca.estado,
      fillInterior: marca.fillInterior,
      nInterior: marca.nInterior,
      cajaEncontrada: marca.cajaEncontrada,
    };
    if (marca.estado === 'marcada') base.banderas.push('marca_forma');
    if (marca.estado === 'borrosa') base.banderas.push('forma_borrosa');
    if (marca.cajaEncontrada === false && marca.estado === 'borrosa') {
      base.banderas.push('forma_sin_caja');
    }
    // Diferencial SÍ/NO (v2 B3 recuperado en v3): ventanas IGUALES declaradas
    // en el molde — la etiqueta impresa se cancela entre ventanas y el delta
    // de tinta decide el lado. `null` = indistinguible (no se inventa).
    let valorSiNo: boolean | null = null;
    if (campo.si_no) {
      const lado = diferencialSiNo(rec.crop, campo.si_no);
      if (lado === null) base.banderas.push('si_no_ambiguo');
      else {
        valorSiNo = lado === 'si';
        base.banderas.push(`si_no_diferencial_${lado}`);
      }
    }
    const diligenciado = valorSiNo !== null ? valorSiNo : ratio >= umbralCampo;
    base.valor = diligenciado;
    base.conf = confPresencia(ratio, umbralCampo);
    const captura = previews ? cropDataUrl(canvas, resuelto.rect) : null;
    base.crop = captura?.crop ?? null;
    base.crop_dims = captura?.dims ?? null;
    const enBandaAlta = diligenciado && ratio <= umbralCampo * 1.4;
    const enBandaBaja = !diligenciado && ratio >= umbralCampo * 0.6;
    // Discordancia tinta ↔ forma: la señal más barata contra el falso
    // positivo (umbral mal calibrado, flash, etiqueta impresa contada).
    const formaDiscrepa =
      (diligenciado && marca.estado === 'vacia') || (!diligenciado && marca.estado === 'marcada');
    if (formaDiscrepa) base.banderas.push('forma_discrepa');
    if (enBandaAlta || enBandaBaja) base.banderas.push('umbral_al_borde');

    // ---- FASE 3 (v3.2.0 — endurecimiento de firmas) ----
    // Métricas de firma = FACTORIZACIÓN de lo existente (metricasFirma en
    // marca.ts, mismo pre-proceso que clasificarMarcaSobreCrop). Solo en
    // campos con firma esperada (costo cero para presencia/checkbox). La
    // señal es DIAGNÓSTICO, no veredicto: el estado sigue decidido por tinta
    // + forma; las banderas nuevas solo endurecen (ok → revisión), jamás
    // convierten un no_encontrado en ok.
    const esFirma = campo.tipo === 'firma' || campo.firma_esperada === true;
    let trazosInsuficientes = false;
    // Corrección de la auditoría con variantes reales (v3.2.0, prueba pag-01..
    // 03 + variantes sintéticas): rúbrica PRESENTE con trazos detectados pero
    // ratio de tinta por debajo del umbral (rúbrica plana que el filtro de
    // líneas combinadas elimina, o trazo ultrafino antialiaseado). Reportar
    // eso como no_encontrado («firma ausente») MIENTE con la rúbrica a la
    // vista — el motor jamás escoge en silencio entre dos señales
    // contradictorias: bandera firma_dudosa + revisión honesta. Piso de
    // ratio ≥ 0.001 (≈20 px de tinta en la canónica): evita disparar la
    // bandera por 1-2 specks de polvo (trazos aislados sin tinta real).
    let firmaDudosa = false;
    if (esFirma) {
      const mf = metricasFirma(rec.crop);
      base.firma = { trazos: mf.trazos, densidad: mf.densidad, extension: mf.extension };
      if (mf.trazos === 0) {
        // Firma esperada sin NINGÚN trazo: la zona se resolvió pero no hay
        // rúbrica (diagnóstico forense; si es obligatoria ya cae en
        // obligatorios_faltantes por el estado).
        base.banderas.push('firma_ausente');
      }
      if (campo.min_trazos !== undefined && mf.trazos < campo.min_trazos) {
        // Exigencia declarada por el molde: menos trazos de los mínimos.
        // Jamás un ok silencioso (mismo principio del empate relacional).
        base.banderas.push('trazos_insuficientes');
        trazosInsuficientes = true;
      }
      if (mf.trazos > 0 && !diligenciado && ratio >= 0.001 && ratio < umbralCampo * 0.6) {
        base.banderas.push('firma_dudosa');
        firmaDudosa = true;
      }
    }

    if (
      enBandaAlta ||
      enBandaBaja ||
      formaDiscrepa ||
      trazosInsuficientes ||
      firmaDudosa
    ) {
      base.estado = 'requiere_revision';
    } else {
      base.estado = diligenciado ? 'ok' : 'no_encontrado';
    }
    // FASE 2 (v3.2.0): empate relacional ambiguo — la tinta se midió sobre una
    // zona que el motor NO escogió con certeza. Jamás permanece en 'ok'.
    if (base.estado === 'ok' && base.banderas.includes('relacion_ambigua')) {
      base.estado = 'requiere_revision';
    }
    return base;
  }

  // tipo texto — FASE 1 (plan extracción relacional): la lectura sale del
  // MAPA OCR GLOBAL de la página (una sola pasada de OCR por página, ya
  // pagada). El recorte dedicado queda como RESCATE puntual, no como camino
  // principal: OCRs por página 13+ → 1 (+ rescates).
  const captura = previews ? cropDataUrl(canvas, resuelto.rect) : null;
  base.crop = captura?.crop ?? null;
  base.crop_dims = captura?.dims ?? null;
  // FASE 9: patronRe ya compilado al inicio de evaluarCampo (con herencia).
  const cumplePatron = (v: string): boolean => {
    if (!patronRe) return true;
    return patronRe.test(v);
  };
  const global = textoEnRect(lineas, resuelto.rect, canvas.width, canvas.height);
  let valorFinal = global.texto;
  let confFinal = global.conf;
  // CORRECCIÓN post-verificación: rescate de VALOR desde el mapa limpio. Solo
  // cuando el mapa primario no produjo texto en el rect Y la zona tiene tinta
  // real (una zona vacía de verdad — campo opcional en blanco — no paga la
  // 2ª pasada). El texto binarizado pierde puntuación fina: por eso el
  // primario siempre gana y este es SOLO un rescate, con bandera auditable.
  if (!valorFinal && rescateMapa && ratio > 0) {
    if (!lineasRescate) lineasRescate = await rescateMapa.obtenerLineas();
    const rescateValor = textoEnRect(lineasRescate, resuelto.rect, canvas.width, canvas.height);
    if (rescateValor.texto) {
      valorFinal = rescateValor.texto;
      confFinal = rescateValor.conf;
      base.banderas.push('valor_rescate_anti_tachon');
    }
  }
  base.conf = confFinal;
  // N-9/G-3: el OCR puede no reportar confianza (null). Ese caso es "sin
  // señal", NO un 50-60% inventado: se registra como sin_confianza_ocr.
  if (valorFinal && confFinal === null) base.banderas.push('sin_confianza_ocr');
  if (!valorFinal) {
    base.banderas.push('ocr_vacio');
    if (ratio < umbralCampo * 0.6) base.banderas.push('zona_vacia');
  }
  // Rescate 1 (ruta histórica, plan FASE 1): el mapa global no produjo texto
  // utilizable (vacío, sin confianza, conf < 0.5 o patrón incumplido) y el
  // molde declara `realce` → recorte dedicado con realce/Otsu y psm 7/8/13,
  // exactamente como antes. Preserva el camino donde un recorte ampliado lee
  // lo que el OCR global perdió.
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
      const re = await proveedorOcr().ocrTextoUnico(v.c, { whitelist: campo.whitelist, psm: v.psm });
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
  // Rescate 2 — FASE 4 (plan extracción relacional, anti-tachón): limpieza
  // morfológica LOCAL del recorte (apertura 1D que elimina trazos largos
  // horizontales/verticales = tachones) + re-OCR. SOLO campos OBLIGATORIOS
  // con tinta real en la zona y lectura aún inválida tras el mapa global y
  // el realce. Nunca global: en un documento limpio las letras finas no se
  // tocan (el kernel de apertura escala con el ancho del recorte).
  if (
    campo.obligatorio &&
    ratio > 0 &&
    (!valorFinal || confFinal === null || confFinal < 0.5 || !cumplePatron(valorFinal))
  ) {
    const rescate = await rescateAntiTachon(rec.crop, campo.whitelist);
    if (rescate) {
      const limpioRescate = rescate.texto.replace(/\s+/g, ' ').trim();
      const confRescate = rescate.conf;
      if (
        limpioRescate &&
        cumplePatron(limpioRescate) &&
        confRescate !== null &&
        confRescate >= 0.5
      ) {
        valorFinal = limpioRescate;
        confFinal = confRescate;
        base.banderas.push('rescate_anti_tachon');
      } else {
        // Se mantiene el resultado original (o vacío) y se deja la bandera
        // honesta: el rescate no mejoró la lectura.
        base.banderas.push('rescate_fallido');
      }
    } else {
      base.banderas.push('rescate_fallido');
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
  // FASE 2 (v3.2.0): empate relacional ambiguo — nunca un pick silencioso.
  if (base.banderas.includes('relacion_ambigua')) {
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
 * FASE 6b: número de un operando de validación con FALLBACK a letras
 * («ciento cincuenta mil» → 150000). Solo se usa dentro de
 * `evaluarValidaciones` — `valorNumerico` (exportado, fixtures golden) no
 * cambia. Un texto que no parsea como letras devuelve null como siempre.
 */
function numeroConLetras(r: ResultadoCampoUniversal): number | null {
  const n = valorNumerico(r);
  if (n !== null) return n;
  if (typeof r.valor !== 'string') return null;
  return letrasANumero(r.valor);
}

/**
 * FASE 6b: repara dígitos ambiguos por OCR («15O.000») SOLO cuando otro
 * operando de la misma validación dice el mismo valor EN LETRAS. La
 * reparación es unívoca (cada carácter ambiguo tiene un único dígito) y
 * queda verificada por una fuente independiente: auto-reparación con
 * evidencia, bandera `auto_reparado_numero`. Sin cruce en letras no se toca
 * nada. Devuelve true si reparó algún operando.
 */
function repararCruceNumeroLetras(
  ids: string[],
  porId: Map<string, ResultadoCampoUniversal>,
  campos: CampoUniversal[],
  tolerancia: number,
): boolean {
  const letras: number[] = [];
  for (const id of ids) {
    const r = porId.get(id);
    if (!r || typeof r.valor !== 'string') continue;
    if (valorNumerico(r) !== null) continue;
    const L = letrasANumero(r.valor);
    if (L !== null) letras.push(L);
  }
  if (!letras.length) return false;
  const camposPorId = new Map(campos.map((c) => [c.id, c]));
  let reparo = false;
  for (const id of ids) {
    const r = porId.get(id);
    if (!r || typeof r.valor !== 'string') continue;
    if (numeroConLetras(r) !== null) continue; // ya parseaba (cifras o letras)
    const rep = repararNumeroAmbiguo(r.valor);
    if (!rep) continue;
    if (!letras.some((L) => Math.abs(L - rep.valor) <= tolerancia)) continue;
    r.valor = rep.texto;
    r.banderas.push('auto_reparado_numero');
    const campo = camposPorId.get(id);
    if (campo && r.conf !== null && r.conf >= 0.5) {
      const re = compilarPatron(patronEfectivo(campo), r.banderas);
      if ((!re || re.test(rep.texto)) && r.estado !== 'ok') {
        r.estado = 'ok';
        // El cruce con letras verificó la lectura: las banderas que anulan
        // la lectura por el valor viejo dejan de aplicar (se retiran las del
        // patrón/confianza, nunca `ancla_*` — la POSITION sigue sin ancla).
        for (const b of ['patron_no_cumple', 'conf_baja']) {
          const i = r.banderas.indexOf(b);
          if (i >= 0) r.banderas.splice(i, 1);
        }
      }
    }
    reparo = true;
  }
  return reparo;
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

/**
 * FASE 3 (plan extracción relacional): parser seguro de rangos de FECHAS
 * `idA >= idB` / `idA <= idB`. Tokeniza IDs y el operador; NO evalúa JS.
 * Exportado para las pruebas unitarias del parser.
 */
export function parsearRango(
  expresion: string,
): { izq: string; op: '>=' | '<='; der: string } | null {
  const sinEspacios = expresion.replace(/\s+/g, ' ').trim();
  const m = /^([a-z_][a-z0-9_]*)\s*(>=|<=)\s*([a-z_][a-z0-9_]*)$/i.exec(sinEspacios);
  if (!m) return null;
  return { izq: m[1], op: m[2] as '>=' | '<=', der: m[3] };
}

/**
 * Parseo de FECHAS en los formatos que produce el OCR de documentos en
 * español (FASE 3 — plan extracción relacional). Devuelve timestamp UTC
 * (milisegundos) o null si no hay fecha legible — NUNCA inventa una fecha.
 * Formatos soportados:
 * - ISO:        2026-11-24
 * - Numéricos:  24/11/2026 · 24-11-2026 · 24.11.2026 (también d/m/aa)
 * - Español:    «24 de noviembre de 2026» (con/sin «de», meses completos
 *               y abreviaturas «ene., feb., …»), insensible a acentos/mayús.
 * Rechaza deliberadamente combos ambiguos (11-24-2026 estilo US): dd/mm es
 * el formato del contrato (recibos y actas del dominio).
 */
export function parsearFechaTexto(valor: string): number | null {
  if (typeof valor !== 'string') return null;
  const s = valor.toLowerCase().trim();
  if (!s) return null;
  // ISO aaaa-mm-dd
  let m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return fechaUtc(Number(m[1]), Number(m[2]), Number(m[3]));
  // dd/mm/aaaa · dd-mm-aaaa · dd.mm.aaaa (incluye aa de 2 dígitos → 20aa).
  // La alternancia prueba PRIMERO 4 dígitos: con \d{2}|\d{4}, "2026" quedaba
  // capturado como "20" (→ año 2020).
  m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4}|\d{2})/.exec(s);
  if (m) {
    const anio = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    return fechaUtc(anio, Number(m[2]), Number(m[1]));
  }
  // «24 de noviembre de 2026» / «24 noviembre 2026» / «24 nov 2026»
  const MESES = [
    'ene', 'feb', 'mar', 'abr', 'may', 'jun',
    'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
  ];
  m = /(\d{1,2})\s+(?:de\s+)?([a-záéíóúñ]{3,12})\s+(?:de\s+)?(\d{4})/.exec(s);
  if (m) {
    const mesTxt = m[2].normalize('NFD').replace(/[\u0300-\u036f]/g, '').slice(0, 3);
    // Alias del dominio: «setiembre» (variante hispana de septiembre).
    const idx = mesTxt === 'set' ? 8 : MESES.indexOf(mesTxt);
    if (idx >= 0) return fechaUtc(Number(m[3]), idx + 1, Number(m[1]));
    return null;
  }
  return null;
}

/** Fecha UTC desde año/mes/día con validación de rango (sin Date locals). */
function fechaUtc(anio: number, mes: number, dia: number): number | null {
  if (!Number.isInteger(anio) || !Number.isInteger(mes) || !Number.isInteger(dia)) return null;
  if (anio < 1900 || anio > 2100 || mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  // Rechazar desbordes (31/02 → 03/03): los componentes deben coincidir.
  if (d.getUTCFullYear() !== anio || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return d.getTime();
}

/** Exportado para las pruebas de reparación número↔letras (FASE 6b). */
export function evaluarValidaciones(
  molde: MoldeUniversal,
  porId: Map<string, ResultadoCampoUniversal>,
): ResultadoValidacion[] {
  const salidas: ResultadoValidacion[] = [];
  for (const v of molde.validaciones ?? []) {
    if (v.regla === 'rango') {
      salidas.push(evaluarValidacionRango(v, porId));
      continue;
    }
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
    for (const t of parseado.der) if (t.tipo === 'id') implicados.add(t.valor);
    const tolerancia = typeof v.tolerancia === 'number' && Number.isFinite(v.tolerancia) ? v.tolerancia : 0;
    // FASE 6b (plan extracción relacional): cruce número↔letras ANTES de
    // parsear. Si un operando numérico tiene dígitos ambiguos por OCR
    // («15O.000») y otro operando es su versión en letras («ciento cincuenta
    // mil»), la lectura en letras VALIDA la reparación: el valor se corrige
    // de forma unívoca con bandera auditable. Sin cruce verificable no se
    // toca nada (prohibido inventar).
    repararCruceNumeroLetras([...implicados], porId, molde.campos, tolerancia);
    const operandos: Array<{ id?: string; num?: number }> = [];
    let faltantes: string[] = [];
    for (const t of parseado.der) {
      if (t.tipo === 'num') {
        operandos.push({ num: Number(t.valor) });
        continue;
      }
      implicados.add(t.valor);
      const r = porId.get(t.valor);
      const n = r ? numeroConLetras(r) : null;
      if (n === null) faltantes.push(t.valor);
      operandos.push({ id: t.valor, num: n ?? undefined });
    }
    const rIzq = porId.get(parseado.izq);
    const nIzq = rIzq ? numeroConLetras(rIzq) : null;
    if (nIzq === null) faltantes = [parseado.izq, ...faltantes];
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

/**
 * FASE 3 (plan extracción relacional): validación de RANGO entre dos campos
 * de fecha. Ambos valores se parsean con `parsearFechaTexto` (ISO, dd/mm/aaaa,
 * «24 de noviembre de 2026»); un operando sin fecha legible deja la validación
 * NO EVALUABLE (ok: null, como en la igualdad) — jamás un veredicto inventado.
 * `fecha_pago >= fecha_emision` exige que el pago no preceda a la emisión.
 */
function evaluarValidacionRango(
  v: ValidacionMolde,
  porId: Map<string, ResultadoCampoUniversal>,
): ResultadoValidacion {
  const parseado = parsearRango(v.expresion);
  if (!parseado) {
    return {
      id: v.id,
      expresion: v.expresion,
      ok: null,
      detalle: 'Expresión inválida (se espera: fecha_id >= fecha_id | fecha_id <= fecha_id)',
      campos: [],
    };
  }
  const rIzq = porId.get(parseado.izq);
  const rDer = porId.get(parseado.der);
  const tIzq = rIzq && typeof rIzq.valor === 'string' ? parsearFechaTexto(rIzq.valor) : null;
  const tDer = rDer && typeof rDer.valor === 'string' ? parsearFechaTexto(rDer.valor) : null;
  const campos = [parseado.izq, parseado.der];
  if (tIzq === null || tDer === null) {
    const ilegibles = [tIzq === null ? parseado.izq : null, tDer === null ? parseado.der : null]
      .filter((x): x is string => x !== null);
    return {
      id: v.id,
      expresion: v.expresion,
      ok: null,
      detalle: `No evaluable: fecha ilegible en ${ilegibles.join(', ')}`,
      campos,
    };
  }
  const cumple = parseado.op === '>=' ? tIzq >= tDer : tIzq <= tDer;
  const f1 = fechaLegible(tIzq);
  const f2 = fechaLegible(tDer);
  return {
    id: v.id,
    expresion: v.expresion,
    ok: cumple,
    detalle: cumple
      ? `${f1} ${parseado.op} ${f2} — coherentes`
      : `${f1} ${parseado.op === '>=' ? '<' : '>'} ${f2} — incoherencia de fechas (revisar el documento)`,
    campos,
  };
}

/** Formatea un timestamp para el detalle del reporte (ISO corto). */
function fechaLegible(t: number): string {
  const d = new Date(t);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
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
 * FASE 1 (plan extracción relacional — fin del falso positivo de firmas):
 * ningún campo OBLIGATORIO termina 'ok' si su POSICIÓN no fue verificada.
 * `fuente: 'referencia'` + `ancla_no_encontrada` significa que el ancla
 * textual no apareció y el motor midió/leyó sobre la banda de referencia del
 * molde — NO sobre la zona real del documento (diagnóstico real: 2 firmas
 * 'ok' conf 0.97 en el MISMO rect de referencia y=0.548, con valores leídos
 * de una banda que no contenía ninguna firma). El rect de referencia sigue
 * siendo el mejor estimado disponible y se reporta, pero el VEREDICTO ahora
 * lo dice: requiere_revision + bandera `fallback_no_verificado`.
 * Aditivo al contrato: `banderas` es un array libre.
 */
export function endurecerFallbackNoVerificado(
  campo: CampoUniversal,
  r: ResultadoCampoUniversal,
): void {
  if (r.estado !== 'ok') return;
  const desdeReferencia = r.fuente === 'referencia';
  const sinAncla = desdeReferencia && r.banderas.includes('ancla_no_encontrada');
  // Lectura degenerada: el repo ya considera 1-2 caracteres ruido de OCR
  // (`core/ocr.ts` → ocrTextIsValid). Una banda vacía o una letra suelta no
  // puede terminar 'ok' sea el campo obligatorio u opcional; sin esto el score
  // premia el ruido (medido: `importe_texto` = "o", conf 0.14, ocr_vacio +
  // zona_vacia contaba como acierto y sumaba 8.3 al score).
  const ruido =
    desdeReferencia &&
    campo.tipo === 'texto' &&
    typeof r.valor === 'string' &&
    !ocrTextIsValid(r.valor) &&
    (r.banderas.includes('ocr_vacio') ||
      r.banderas.includes('zona_vacia') ||
      (r.conf ?? 1) < 0.5);
  // Campo de TINTA (firma / presencia / checkbox): su veredicto ES geometría —
  // que haya caja y rúbrica. Un ancla obtenida por el bypass solo-textual no lo
  // prueba: es literalmente el falso positivo del diagnóstico (dos firmas 'ok'
  // conf 0.97 con `forma_sin_caja`, valor "true"), que volvería a entrar por
  // esta puerta al pasar `fuente` de 'referencia' a 'ancla'.
  const tintaSinGeometria =
    campo.tipo !== 'texto' && r.banderas.includes('ancla_solo_textual');
  if (!sinAncla && !ruido && !tintaSinGeometria) return;
  r.banderas.push(
    sinAncla ? 'fallback_no_verificado' : tintaSinGeometria ? 'ancla_sin_geometria' : 'lectura_degenerada',
  );
  // Un opcional sin posición verificada no es un error del documento: honestamente
  // no se encontró. Un obligatorio sí pasa a revisión (comportamiento FASE 1b).
  r.estado = campo.obligatorio ? 'requiere_revision' : 'no_encontrado';
}

// ---- FASE 5 (plan extracción relacional): ARNÉS GEOMÉTRICO ----------------
// El ancla textual falló (el tachón/recorte/barra rompió esa línea del OCR)
// pero el resto del documento SÍ ancló. Con ≥3 anclas encontradas se ajusta
// un afín (rotación+escala+traslación) entre la posición de REFERENCIA del
// molde y la posición REAL, y se PROYECTA la zona de los campos huérfanos.
// El valor se busca en el mapa OCR global en la posición proyectada: si hay
// lectura, la posición queda verificada por GEOMETRÍA (no por coordenadas
// estáticas) — fuente 'arnes', bandera 'ancla_inferida'. Si no hay lectura,
// el campo queda exactamente igual que antes (referencia + revisión): el
// arnés jamás inventa. Las cajas de layout (PP-DocLayout, cuando la app las
// provee) se usan solo para SEPARAR firmas: la caja `seal` más cercana a la
// posición proyectada da a cada firma su propio rect (fin del falso positivo
// de dos firmas midiendo la misma banda).

/** Caja de layout neutral (la app la produce desde ONNX; el motor NO importa
 *  dla-onnx — invariante de arquitectura). Coordenadas normales 0-1. */
export interface CajaLayout {
  clase: string;
  rect: RectNorm;
  conf?: number | null;
}

export const ARNES_ANCLAS_MIN = 3;
/** Señal «geometría» de la votación 2/3 (FASE 6a): residuo LOO por voto que
 *  sigue contando como evidencia (unidades de página normalizadas). */
export const ARNES_VOTO_TOL = 0.02;
/** Fracción mínima de votos soportados para proyectar (≥3 anclas + 0.8). */
export const ARNES_CONF_PROY_MIN = 0.8;
/** Señal «patrón+confianza»: lectura que cumple el patrón con conf ≥ este piso. */
export const ARNES_TEXTO_CONF_MIN = 0.7;

/** Distancia normalizada (unidades de página) de un centro a otro. */
function distCentros(a: RectNorm, b: RectNorm): number {
  return Math.hypot(a.x + a.w / 2 - (b.x + b.w / 2), a.y + a.h / 2 - (b.y + b.h / 2));
}

export interface ResultadoArn {
  anclas: number;
  confProyeccion: number;
  rescatados: number;
}

/**
 * Corre el arnés geométrico sobre los resultados de UNA página ya evaluada.
 * Muta in-place los campos en fallback (`referencia` + `ancla_no_encontrada`)
 * que logran reubicarse. Devuelve null si no hay suficientes anclas (<3) —
 * en ese caso NO toca nada (comportamiento idéntico a FASE 1b).
 */
export function proyectarPorArnes(
  campos: CampoUniversal[],
  resultados: ResultadoCampoUniversal[],
  lineas: LineaOcr[],
  canvasW: number,
  canvasH: number,
  opts?: {
    canvas?: HTMLCanvasElement;
    cajasLayout?: CajaLayout[];
    herencia?: HerenciaMolde;
    previews?: boolean;
  },
): ResultadoArn | null {
  const porId = new Map(campos.map((c) => [c.id, c]));
  // 1. Votos: campos anclados textualmente Y en estado 'ok' (el consenso ya
  //    filtró discrepancias; un 'requiere_revision' no es evidencia de
  //    posición). Par referencia → encontrado sobre los CENTROS del rect del
  //    valor (el offset ancla→valor es el mismo en ambos lados).
  const src: { x: number; y: number }[] = [];
  const dst: { x: number; y: number }[] = [];
  for (const r of resultados) {
    if (r.fuente !== 'ancla' && r.fuente !== 'respaldo') continue;
    if (r.estado !== 'ok' || !r.rect) continue;
    const campo = porId.get(r.id);
    if (!campo) continue;
    const ref = rectEditor(campo);
    if (!ref) continue;
    src.push({ x: ref.x + ref.w / 2, y: ref.y + ref.h / 2 });
    dst.push({ x: r.rect.x + r.rect.w / 2, y: r.rect.y + r.rect.h / 2 });
  }
  if (src.length < ARNES_ANCLAS_MIN) return null;
  // Confianza de la geometría por CONSENSO LOO (leave-one-out): cada voto se
  // predice con un modelo ajustado SIN él y cuenta como soportado si el
  // residual es ≤ ARNES_VOTO_TOL. Con 3 votos solo hay 2 puntos para ajustar
  // (la mediana de las traslaciones) — suficiente para detectar el voto
  // errático; con ≥4 el ajuste completo ya es sobre-determinado. La mediana
  // de desplazamientos sobre el conjunto completo NO sirve: un recorte con
  // escala (dy creciendo con y, medido: 0.02→0.22) es un modelo afín
  // perfectamente coherente que la mediana reportaría como incoherencia.
  const mediana = (v: number[]): number => {
    const a = [...v].sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };
  const predecirSin = (i: number): { x: number; y: number } => {
    const s2 = src.filter((_, j) => j !== i);
    const d2 = dst.filter((_, j) => j !== i);
    if (s2.length >= 3) {
      const A2 = ajustarAfin(s2, d2);
      if (A2) return aplicarAfin(A2, src[i].x, src[i].y);
    }
    const mdx = mediana(s2.map((s, j) => d2[j].x - s.x));
    const mdy = mediana(s2.map((s, j) => d2[j].y - s.y));
    return { x: src[i].x + mdx, y: src[i].y + mdy };
  };
  const soportado: boolean[] = [];
  let nSoporte = 0;
  for (let i = 0; i < src.length; i++) {
    const p = predecirSin(i);
    const ok = Math.hypot(p.x - dst[i].x, p.y - dst[i].y) <= ARNES_VOTO_TOL;
    soportado.push(ok);
    if (ok) nSoporte++;
  }
  const confProy = nSoporte / src.length;
  const geometriaSolida = confProy >= ARNES_CONF_PROY_MIN;
  // Modelo de proyección: se re-ajusta SOLO con los votos soportados (un
  // voto errático no puede deformar la proyección de los huérfanos).
  const sOk = src.filter((_, i) => soportado[i]);
  const dOk = dst.filter((_, i) => soportado[i]);
  const afin: Afin6 | null = sOk.length >= 3 ? ajustarAfin(sOk, dOk) : null;
  const mdx = mediana(sOk.map((s, i) => dOk[i].x - s.x));
  const mdy = mediana(sOk.map((s, i) => dOk[i].y - s.y));

  // 2. Huérfanos: cayeron a referencia PORQUE el ancla no apareció.
  let rescatados = 0;
  const previews = opts?.previews ?? false;
  const usedSeal = new Set<CajaLayout>();
  for (const r of resultados) {
    if (r.fuente !== 'referencia') continue;
    if (!r.banderas.includes('ancla_no_encontrada')) continue;
    const campo = porId.get(r.id);
    if (!campo || !geometriaSolida) continue;
    const ref = rectEditor(campo);
    if (!ref) continue;
    const centroRef = { x: ref.x + ref.w / 2, y: ref.y + ref.h / 2 };
    const p = afin
      ? aplicarAfin(afin, centroRef.x, centroRef.y)
      : { x: centroRef.x + mdx, y: centroRef.y + mdy };
    let proyectado = clampRect({ x: p.x - ref.w / 2, y: p.y - ref.h / 2, w: ref.w, h: ref.h });
    r.rect = proyectado;
    r.fuente = 'arnes';
    // La posición ya no es la banda estática: el flag de fallback sin
    // verificar deja de aplicar (la geometría la sustituyó). Se conserva
    // `ancla_no_encontrada` (honesto: el texto del ancla nunca apareció) y
    // se añade la señal de inferencia.
    const i = r.banderas.indexOf('fallback_no_verificado');
    if (i >= 0) r.banderas.splice(i, 1);
    r.banderas.push('ancla_inferida');
    rescatados++;

    if (campo.tipo === 'texto') {
      const t = textoEnRect(lineas, proyectado, canvasW, canvasH);
      if (!t.texto || t.conf === null || !ocrTextIsValid(t.texto)) continue; // sin lectura: revisión honesta
      const limpio = limpiarValor(t.texto, campo, r.banderas);
      r.valor = limpio;
      r.conf = t.conf;
      const patronRe = compilarPatron(patronEfectivo(campo, opts?.herencia), r.banderas);
      const cumple = !patronRe || patronRe.test(limpio);
      const senalPatron = cumple && t.conf >= ARNES_TEXTO_CONF_MIN;
      // Votación 2/3 de FASE 6a sobre un campo inferido: geometría (siempre
      // true aquí — se exige arriba) + patrón/confianza. Con una sola señal
      // jamás 'ok'.
      if (!cumple) {
        r.banderas.push('patron_no_cumple');
        r.estado = 'requiere_revision';
      } else if (senalPatron) {
        r.estado = 'ok';
      } else {
        if (!r.banderas.includes('conf_baja')) r.banderas.push('conf_baja');
        r.estado = 'requiere_revision';
      }
      if (previews && opts?.canvas) {
        const cap = cropDataUrl(opts.canvas, proyectado);
        r.crop = cap?.crop ?? null;
        r.crop_dims = cap?.dims ?? null;
      }
      continue;
    }

    // Tinta (firma/presencia/checkbox): re-medir sobre la zona proyectada.
    // Cajas `seal` del layout (si la app las pasó) dan a cada firma su rect
    // propio — fin del «dos firmas, mismo rect».
    if (campo.tipo === 'firma' && opts?.cajasLayout?.length) {
      const sellos = opts.cajasLayout
        .filter((c) => c.clase === 'seal' && !usedSeal.has(c))
        .filter((c) => distCentros(c.rect, proyectado) <= 0.35)
        .sort((a, b) => distCentros(a.rect, proyectado) - distCentros(b.rect, proyectado));
      if (sellos.length) {
        proyectado = clampRect(sellos[0].rect);
        usedSeal.add(sellos[0]);
        r.rect = proyectado;
      }
    }
    if (!opts?.canvas) continue;
    const rec = recortar(opts.canvas, proyectado);
    if (!rec) {
      r.banderas.push('zona_invalida');
      continue;
    }
    const ratio = medirTinta(rec.crop);
    r.ratio = ratio;
    const umbral = umbralEfectivo(campo, opts?.herencia);
    const diligenciado = ratio >= umbral;
    r.valor = diligenciado;
    r.conf = confPresencia(ratio, umbral);
    if (previews) {
      const cap = cropDataUrl(opts.canvas, proyectado);
      r.crop = cap?.crop ?? null;
      r.crop_dims = cap?.dims ?? null;
    }
    const enBanda = (diligenciado && ratio <= umbral * 1.4) || (!diligenciado && ratio >= umbral * 0.6);
    if (enBanda) {
      r.banderas.push('umbral_al_borde');
      r.estado = 'requiere_revision';
    } else {
      r.estado = diligenciado ? 'ok' : 'no_encontrado';
    }
  }
  return { anclas: src.length, confProyeccion: confProy, rescatados };
}

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

// ---- FASE 4 del plan (v3.3.0) — grupos de campos con restricciones espaciales ----

/**
 * Restricciones EFECTIVAS de un grupo: el default por TIPO sobreescrito por
 * lo que el molde declara explícitamente (restricciones ganan siempre).
 *  - fila:        alineación 'y' (misma altura), espaciado libre.
 *  - columna:     alineación 'x' (misma vertical), espaciado libre.
 *  - repetidor:   alineación 'x' + espaciado 'uniforme' (§7 FASE 9: la celda
 *                 se repite N veces; un hueco irregular delata fila perdida).
 *  - seccion:     sin restricciones espaciales (agrupación declarativa).
 */
function restriccionesEfectivas(g: GrupoMolde): {
  alineacion?: 'x' | 'y';
  orden?: 'asc' | 'desc';
  espaciado?: 'uniforme' | 'libre';
  tolerancia: number;
} {
  let d: { alineacion?: 'x' | 'y'; orden?: 'asc' | 'desc'; espaciado?: 'uniforme' | 'libre' };
  switch (g.tipo) {
    case 'fila':
      d = { alineacion: 'y' };
      break;
    case 'columna':
      d = { alineacion: 'x' };
      break;
    case 'repetidor':
      d = { alineacion: 'x', espaciado: 'uniforme' };
      break;
    case 'seccion':
      d = {};
      break;
  }
  const r = g.restricciones ?? {};
  return {
    alineacion: r.alineacion ?? d.alineacion,
    orden: r.orden ?? d.orden,
    espaciado: r.espaciado ?? d.espaciado,
    tolerancia: r.tolerancia ?? TOLERANCIA_GRUPO_DEFAULT,
  };
}

/** Democión honesta de un 'ok' por restricción de grupo violada: bandera +
 *  requiere_revision. Los estados ya negativos NO se tocan (no se agrava). */
function demotarPorGrupo(r: ResultadoCampoUniversal, bandera: string): void {
  if (!r.banderas.includes(bandera)) r.banderas.push(bandera);
  if (r.estado === 'ok') r.estado = 'requiere_revision';
}

/**
 * FASE 4 (v3.3.0 — la más potente del plan §7): evalúa las restricciones
 * espaciales de los grupos SOBRE los resultados ya resueltos de UNA página.
 * Hace imposible por construcción que J1 y J3 "resuelvan el mismo rect" de la
 * columna: dos centros en la misma vertical con orden violado o espaciado
 * irregular quedan señalados y los 'ok' caen a `requiere_revision`.
 * Solo opina con ≥2 miembros RESUELTOS y con rect (con menos evidencia el
 * grupo es declarativo y el motor no inventa violaciones que no vio).
 * Exportado para pruebas unitarias y para el editor (previsualización).
 */
export function evaluarGrupos(
  grupos: GrupoMolde[],
  campos: CampoUniversal[],
  resultados: ResultadoCampoUniversal[],
): void {
  const porId = new Map(resultados.map((r) => [r.id, r]));
  for (const g of grupos) {
    if (g.tipo === 'seccion') continue; // sin restricciones espaciales
    const res = restriccionesEfectivas(g);
    // Miembros RESUELTOS con rect, en el ORDEN declarado (para orden/espaciado).
    const miembros = g.miembros
      .map((id) => ({ id, campo: campos.find((c) => c.id === id), r: porId.get(id) }))
      .filter((m) => m.r && m.r.rect) as Array<{ id: string; campo?: CampoUniversal; r: ResultadoCampoUniversal }>;
    if (miembros.length < 2) continue; // evidencia insuficiente: no se opina
    const centros = miembros.map((m) => ({
      id: m.id,
      r: m.r,
      cx: m.r.rect!.x + m.r.rect!.w / 2,
      cy: m.r.rect!.y + m.r.rect!.h / 2,
    }));
    // Alineación: el eje declarado debe ser COMPARTIDO por los centros.
    if (res.alineacion) {
      const valores = centros.map((c) => (res.alineacion === 'y' ? c.cy : c.cx));
      const media = valores.reduce((s, v) => s + v, 0) / valores.length;
      const maxDesvio = Math.max(...valores.map((v) => Math.abs(v - media)));
      if (maxDesvio > res.tolerancia) {
        for (const c of centros) demotarPorGrupo(c.r, 'grupo_desalineado');
      }
    }
    // Orden: los centros EN EL ORDEN DECLARADO deben ser monótonos por el eje
    // del grupo (columna/repetidor → y; fila → x — el eje de la alineación es
    // el COMPARTIDO, así que el eje del ORDEN es el perpendicular).
    if (res.orden) {
      const ejeOrden = res.alineacion === 'y' ? 'x' : res.alineacion === 'x' ? 'y' : 'y';
      const serie = centros.map((c) => (ejeOrden === 'y' ? c.cy : c.cx));
      const violado = res.orden === 'asc'
        ? serie.some((v, i) => i > 0 && v < serie[i - 1] - 1e-9)
        : serie.some((v, i) => i > 0 && v > serie[i - 1] + 1e-9);
      if (violado) {
        for (const c of centros) demotarPorGrupo(c.r, 'grupo_orden_violado');
      }
    }
    // Espaciado uniforme: los huecos consecutivos a lo largo del eje del orden
    // difieren a lo sumo `tolerancia`. Con 2 miembros hay UN hueco: trivial.
    if (res.espaciado === 'uniforme' && centros.length >= 3) {
      const ejeOrden = res.alineacion === 'y' ? 'x' : res.alineacion === 'x' ? 'y' : 'y';
      const serie = centros.map((c) => (ejeOrden === 'y' ? c.cy : c.cx));
      const huecos: number[] = [];
      for (let i = 1; i < serie.length; i++) huecos.push(Math.abs(serie[i] - serie[i - 1]));
      const maxHueco = Math.max(...huecos);
      const minHueco = Math.min(...huecos);
      if (maxHueco - minHueco > res.tolerancia) {
        for (const c of centros) demotarPorGrupo(c.r, 'grupo_espaciado_irregular');
      }
    }
  }
}

// ---- FASE 6 del plan (v3.3.0) — "Cartero en cascada": identificación ----

/** Candidato para la identificación en cascada (el caller arma la lista). */
export interface CandidatoHuella {
  moldeId: string;
  nombre?: string;
  huella?: HuellaMolde | null;
  /**
   * CAPA 0 de la cascada — el QR YA resolvió este molde (payload del QR
   * corresponde a su identidad): decisivo, score 1, sin gastar OCR de frases.
   * El EMPAREJAMIENTO payload→molde lo hace la app (formato del payload es
   * contrato de la capa QR, no del motor).
   */
  identificadoPorQr?: boolean;
}

export interface IdentificacionCascada {
  moldeId: string;
  nombre?: string;
  /** 'qr' (capa 0, decisiva) o 'frases' (capa 1, huella de cabecera). */
  metodo: 'qr' | 'frases';
  /** 0..1 — frases encontradas / frases declaradas (QR = 1). */
  score: number;
  /** Frases de la huella que aparecieron en la franja de cabecera. */
  frasesEncontradas: string[];
  /** ¿El nº de páginas coincide con la huella? null si no declaró. */
  paginasCoinciden: boolean | null;
}

const FRANJA_CABECERA_DEFAULT: RectNorm = { x: 0, y: 0, w: 1, h: 0.2 };
const MIN_FRASES_DEFAULT = 2;

/**
 * FASE 6 (v3.3.0 — "Cartero en cascada"): identifica el documento contra las
 * huellas de los moldes ANTES de pagar el análisis completo (1-2 s vs 10-40 s).
 * Cascada por candidato:
 *  1. QR (capa 0): `identificadoPorQr` → decisivo (la app empareja payload).
 *  2. FRASES clave de la cabecera (capa 1): cada frase se busca con el MISMO
 *     matcher fuzzy de anclas (score ≥ ANCLA_SCORE_MIN) dentro de la franja.
 *  3. ESQUELETO (capa 2): nº de páginas — discrepancia PENALIZA el score
 *     (×0.8) pero NO rechaza sola (una foto de la pág. 1 de un documento de 2
 *     sigue siendo ese documento).
 * Aceptación: matches ≥ minFrases (default 2). Gana el mayor score (empate →
 * más matches → primer declarado). Sin candidato aceptado → null (duda: la
 * app pregunta al usuario con miniaturas — jamás se adivina).
 */
export function identificarDocumento(
  lineas: LineaOcr[],
  canvasW: number,
  canvasH: number,
  totalPaginas: number,
  candidatos: CandidatoHuella[],
): IdentificacionCascada | null {
  // Capa 0: el QR manda (decisivo por diseño — el payload es identidad).
  const porQr = candidatos.find((c) => c.identificadoPorQr === true);
  if (porQr) {
    return {
      moldeId: porQr.moldeId,
      nombre: porQr.nombre,
      metodo: 'qr',
      score: 1,
      frasesEncontradas: [],
      paginasCoinciden: null,
    };
  }
  let mejor: (IdentificacionCascada & { matches: number }) | null = null;
  for (const c of candidatos) {
    const h = c.huella;
    if (!h?.frasesClave?.length) continue;
    const franja = h.franja ?? FRANJA_CABECERA_DEFAULT;
    // Líneas cuyo CENTRO vive en la franja de cabecera (+ margen del faro).
    const enFranja = lineasEnFaro(lineas, canvasW, canvasH, franja);
    const encontradas: string[] = [];
    for (const frase of h.frasesClave) {
      const hit = buscarAncla(frase, enFranja, canvasW, canvasH);
      if (hit && hit.score >= ANCLA_SCORE_MIN) encontradas.push(frase);
    }
    const minFrases = h.minFrases ?? MIN_FRASES_DEFAULT;
    if (encontradas.length < minFrases) continue;
    let score = encontradas.length / Math.max(1, h.frasesClave.length);
    const paginasCoinciden =
      typeof h.paginas === 'number' ? h.paginas === totalPaginas : null;
    if (paginasCoinciden === false) score *= 0.8; // penalización del esqueleto
    const candidata = {
      moldeId: c.moldeId,
      nombre: c.nombre,
      metodo: 'frases' as const,
      score,
      frasesEncontradas: encontradas,
      paginasCoinciden,
      matches: encontradas.length,
    };
    if (
      !mejor ||
      candidata.score > mejor.score ||
      (candidata.score === mejor.score && candidata.matches > mejor.matches)
    ) {
      mejor = candidata;
    }
  }
  if (!mejor) return null;
  const { matches: _matches, ...out } = mejor;
  return out;
}

// ---- FASE 5 del plan (v3.3.0) — UX-1: auto-propuesta de anclas al dibujar ----

export interface PropuestaAncla {
  texto: string;
  rect: RectNorm;
  /** 0..1 = 0.5·cercanía + 0.3·unicidad + 0.2·confianza del OCR. */
  score: number;
  /** Apariciones EXACTAS del texto normalizado en la página (1 = único). */
  ocurrencias: number;
  /** OTRA propuesta difiere solo en dígitos (el editor la marca en rojo y
   *  pide desambiguador — el molde no debe nacer ambiguo). */
  conflictoDigito?: boolean;
}

/** Confianza de una línea OCR = media de sus palabras (la línea no la trae). */
function confLinea(l: LineaOcr): number | null {
  const con = l.palabras.filter((p) => typeof p.conf === 'number');
  if (!con.length) return null;
  return con.reduce((s, p) => s + (p.conf as number), 0) / con.length;
}

/** Distancia normalizada de un rect a la zona (0 si toca, crece al alejarse). */
function distanciaRectAZona(r: RectNorm, z: RectNorm): number {
  const dx = Math.max(z.x - (r.x + r.w), r.x - (z.x + z.w), 0);
  const dy = Math.max(z.y - (r.y + r.h), r.y - (z.y + z.h), 0);
  return Math.hypot(dx, dy);
}

/** ¿Dos textos difieren SOLO en dígitos? (el caso JURADO 4 / JURADO 2). */
function difierenSoloEnDigitos(a: string, b: string): boolean {
  if (a === b) return false;
  const sinDigitosA = a.replace(/\d/g, '');
  const sinDigitosB = b.replace(/\d/g, '');
  if (sinDigitosA !== sinDigitosB) return false;
  // Misma estructura de no-dígitos y misma longitud: las diferencias son dígitos.
  return editDistancePonderada(a, b) > 0;
}

/**
 * FASE 5 (v3.3.0 — UX-1): propone las MEJORES anclas candidatas para una zona
 * recién dibujada, sobre las líneas OCR de la página de referencia. Las anclas
 * viven FUERA de la zona (etiqueta vs valor), cerca (justo arriba/izquierda
 * puntúa más) y ÚNICAS en la página (una etiqueta que aparece 3 veces obliga a
 * desambiguador — se puntúa bajo, no se descarta, porque a veces es lo que hay).
 * Determinista: mismas líneas → mismas propuestas.
 */
export function proponerAnclas(
  lineas: LineaOcr[],
  canvasW: number,
  canvasH: number,
  zona: RectNorm,
  maximo = 3,
): PropuestaAncla[] {
  interface LineaClave { texto: string; norm: string; rect: RectNorm; conf: number | null }
  const candidatas: LineaClave[] = [];
  const conteo = new Map<string, number>();
  for (const l of lineas) {
    const texto = (l.texto ?? '').trim();
    if (!texto) continue;
    const norm = normTxt(texto);
    if (!norm) continue;
    const rect: RectNorm = {
      x: l.bbox[0] / canvasW,
      y: l.bbox[1] / canvasH,
      w: (l.bbox[2] - l.bbox[0]) / canvasW,
      h: (l.bbox[3] - l.bbox[1]) / canvasH,
    };
    // Las anclas viven FUERA de la zona de valor (la etiqueta nunca ES el dato).
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    if (cx >= zona.x && cx <= zona.x + zona.w && cy >= zona.y && cy <= zona.y + zona.h) continue;
    candidatas.push({ texto, norm, rect, conf: confLinea(l) });
    conteo.set(norm, (conteo.get(norm) ?? 0) + 1);
  }
  const propuestas: PropuestaAncla[] = candidatas.map((c) => {
    const dist = distanciaRectAZona(c.rect, zona);
    const cercania = Math.max(0, 1 - dist / 0.25);
    const ocurrencias = conteo.get(c.norm) ?? 1;
    const unicidad = ocurrencias === 1 ? 1 : ocurrencias === 2 ? 0.5 : 0.15;
    const conf = c.conf === null ? 0.5 : c.conf;
    return {
      texto: c.texto,
      rect: c.rect,
      score: 0.5 * cercania + 0.3 * unicidad + 0.2 * conf,
      ocurrencias,
    };
  });
  propuestas.sort((a, b) => b.score - a.score);
  const top = propuestas.slice(0, Math.max(1, maximo));
  // Conflicto de dígitos: dos propuestas cuya estructura no-dígito es IGUAL —
  // el molde no debe nacer ambiguo (el editor marca rojo y pide desambiguador).
  for (const p of top) {
    for (const q of top) {
      if (p !== q && difierenSoloEnDigitos(normTxt(p.texto), normTxt(q.texto))) {
        p.conflictoDigito = true;
        break;
      }
    }
  }
  return top;
}

// ---- FASE 9 del plan (v3.3.0) — fixtures de verdad de terreno ----

export interface ResultadoFixture {
  fixtureId: string;
  nombre: string;
  ok: boolean;
  fallos: Array<{
    campoId: string;
    /** 'valor' (esperado de verdad de terreno) o 'estado' (estadosEsperados). */
    tipo: 'valor' | 'estado';
    esperado: string | boolean | number;
    obtenido: string | boolean | number | null;
  }>;
}

/**
 * FASE 9 (§7 — "Probar Plantilla" con verdad de terreno): confronta el
 * resultado de UNA corrida contra lo que el molde DECLARA que debe salir para
 * el caso. Un campo ausente de `esperado` no se verifica (solo lo declarado).
 * Comparación:
 *  - string → igualdad exacta tras trim (sin normalización agresiva: la verdad
 *    de terreno se escribe como se espera leer).
 *  - boolean → igualdad estricta del booleano de tinta.
 *  - number → igualdad con `valorNumerico` (el parseo del motor: separadores
 *    de miles/decimales); null si el valor no es numérico → fallo.
 *  - estadosEsperados → igualdad del estado del campo (p. ej. exigir
 *    'no_encontrado' en un caso negativo).
 */
export function verificarFixture(
  resultado: ResultadoUniversal,
  fixture: FixtureMolde,
): ResultadoFixture {
  const fallos: ResultadoFixture['fallos'] = [];
  const porId = new Map(resultado.paginas.flatMap((p) => p.campos).map((r) => [r.id, r]));
  for (const [campoId, esperado] of Object.entries(fixture.esperado)) {
    const r = porId.get(campoId);
    if (!r) {
      fallos.push({ campoId, tipo: 'valor', esperado, obtenido: null });
      continue;
    }
    if (typeof esperado === 'boolean') {
      if (r.valor !== esperado) {
        fallos.push({ campoId, tipo: 'valor', esperado, obtenido: r.valor });
      }
    } else if (typeof esperado === 'number') {
      // El parseo del motor sobre el valor leído; si el OCR trae símbolos
      // ("3.150,00 €"), se reintenta sin el ruido no numérico (mismo parseo,
      // solo quitando moneda/espacios exteriores — jamás inventa dígitos).
      // El formato español mixto (miles con punto + decimales con coma:
      // "3.150,00") no lo cubre `valorNumerico` por diseño (usado en
      // igualdades aritméticas, donde la ambigüedad es peligrosa); aquí, con
      // la verdad de terreno declarada por el dueño del molde, se resuelve
      // con la regla española UNA vez el string quedó limpio de símbolos.
      let num = valorNumerico(r);
      if (num === null && typeof r.valor === 'string') {
        const limpio = r.valor.replace(/[^0-9.,\- ]/g, '').trim();
        if (/^\d{1,3}(\.\d{3})+,\d+$/.test(limpio)) {
          const español = limpio.replace(/\./g, '').replace(',', '.');
          num = valorNumerico({ ...r, valor: español });
        } else if (limpio) {
          num = valorNumerico({ ...r, valor: limpio });
        }
      }
      if (num === null || Math.abs(num - esperado) > 1e-9) {
        fallos.push({ campoId, tipo: 'valor', esperado, obtenido: num });
      }
    } else {
      const valor = typeof r.valor === 'string' ? r.valor.trim() : r.valor === null ? '' : String(r.valor);
      if (valor !== esperado.trim()) {
        fallos.push({ campoId, tipo: 'valor', esperado, obtenido: valor });
      }
    }
  }
  if (fixture.estadosEsperados) {
    for (const [campoId, estadoEsperado] of Object.entries(fixture.estadosEsperados)) {
      const r = porId.get(campoId);
      const estado = r?.estado ?? 'sin_resultado';
      if (estado !== estadoEsperado) {
        fallos.push({ campoId, tipo: 'estado', esperado: estadoEsperado, obtenido: estado });
      }
    }
  }
  return {
    fixtureId: fixture.id,
    nombre: fixture.nombre,
    ok: fallos.length === 0,
    fallos,
  };
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
  /**
   * FASE 0 (blueprint DLA): modo LIGERO para Tamiz (fotos de cámara en móvil)
   * — sin previews de página ni crops por campo (el resumen en el Acta no los
   * consume y la memoria del dispositivo manda). Default true: el Studio
   * sigue recibiendo TODO (verificación visual con overlay).
   */
  opts?: {
    previews?: boolean;
    /** Plan primera ola (Fase 4): líneas OCR YA calculadas por el router
     *  sobre la MISMA imagen de la página 1 — se reutilizan en vez de lanzar
     *  un segundo Tesseract de página completa (una sola pasada, menos
     *  latencia). Páginas N>1 y el flip 180° siguen haciendo su propio OCR. */
    lineas?: LineaOcr[];
    /** Confianza media del OCR reutilizado (la del proveedor del router). */
    ocrConf?: number;
    /** FASE 5 (arnés geométrico): cajas de layout detectadas por la app
     *  (ONNX opcional). Con señal apagada se omite: el arnés funciona solo
     *  con anclas textuales; `seal` se usa únicamente para separar firmas. */
    cajasLayout?: CajaLayout[];
    /** FASE 5: desactiva el arnés (comportamiento idéntico a FASE 1b). */
    arnes?: boolean;
  },
): Promise<ResultadoUniversal> {
  const previews = opts?.previews ?? true;
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
    // Fase 4 (plan primera ola): la página 1 reutiliza las líneas del router
    // (misma imagen, mismo PSM de página completa) — un solo OCR de página.
    let ocr: { lines: LineaOcr[]; conf: number | null };
    if (p === 0 && opts?.lineas && opts.lineas.length > 0) {
      ocr = { lines: opts.lineas, conf: opts.ocrConf ?? null };
    } else {
      const tOcr = performance.now();
      ocr = await proveedorOcr().ocrLines(canvas);
      ocrMs += performance.now() - tOcr;
    }

    const camposPagina = molde.campos.filter((c) => c.pagina === p + 1);
    let pageCanvas = canvas;

    // Fase 3.3 (versión pragmática): si NINGUNA ancla de una página N>1
    // matchea pero el molde sí define anclas para ella, probamos flip 180°
    // (barato: una sola pasada extra de OCR). Si con el flip las anclas
    // aparecen, se evalúa la página volteada y se marca
    // `rotacion_180_corregida`; si no, queda candidata a
    // `posible_pagina_equivocada` (se confirma si otra página sí ancló).
    const conAnclas = camposPagina.filter(
      (c) =>
        (c.estrategia === 'ancla_relativa' || c.estrategia === 'ancla_relacional') &&
        c.ancla?.texto,
    );
    if (conAnclas.length > 0 && p >= 1 && !probarLineas(ocr.lines, conAnclas, canvas)) {
      const flipCanvas = voltear180(canvas);
      const tFlip = performance.now();
      const flipOcr = await proveedorOcr().ocrLines(flipCanvas);
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
    // CORRECCIÓN post-verificación: mapa OCR de RESCATE (P4 del diagnóstico),
    // PEREZOSO y memoizado por página: solo se construye si algún campo pierde
    // su ancla (o su valor) en el mapa primario — documento limpio: costo 0,
    // se mantiene la métrica del plan «1 OCR por página».
    let promesaMapaRescate: Promise<LineaOcr[]> | null = null;
    const obtenerMapaRescate = (): Promise<LineaOcr[]> => {
      if (!promesaMapaRescate) {
        onProgreso?.(`Página ${p + 1}: rescate anti-tachón del mapa OCR (2ª pasada)...`);
        promesaMapaRescate = mapaOcrRescate(pageCanvas).catch(() => []);
      }
      return promesaMapaRescate;
    };
    for (let i = 0; i < camposPagina.length; i++) {
      const c = camposPagina[i];
      onProgreso?.(`Página ${p + 1}: campo ${i + 1}/${camposPagina.length} — ${c.etiqueta}`);
      const r = await evaluarCampo(c, pageCanvas, ocr.lines, previews, {
        obtenerLineas: obtenerMapaRescate,
      }, molde.herencia);
      // FASE 1b (plan extracción relacional): el fallback silencioso ya no
      // produce 'ok' en obligatorios (fin del falso positivo de firmas).
      endurecerFallbackNoVerificado(c, r);
      resultados.push(r);
    }
    // FASE 5 (arnés geométrico): con ≥3 anclas textuales resueltas, los
    // campos que cayeron a referencia se re-ubican por PROYECCIÓN (afín desde
    // las anclas fiables) y se releen del mapa OCR global. Revierte
    // parcialmente FASE 1b: un campo 'ok' inferido por arnés ya tiene posición
    // verificada (por geometría, no coordenadas estáticas). Sin anclas
    // suficientes no toca nada (se mantiene el endurecido de 1b).
    if ((opts?.arnes ?? true) && camposPagina.length) {
      proyectarPorArnes(camposPagina, resultados, ocr.lines, pageCanvas.width, pageCanvas.height, {
        canvas: pageCanvas,
        cajasLayout: opts?.cajasLayout,
        herencia: molde.herencia,
        previews,
      });
    }
    // F1 (variante 1.1): detección de colisión de rects — DOS campos que miran
    // el mismo pedazo de papel es la firma del falso positivo de la auditoría.
    marcarColisiones(resultados);
    // FASE 4 (v3.3.0): grupos con restricciones espaciales — los checks
    // geométricos corren DESPUÉS de resolver (y del dedupe de colisiones);
    // una restricción violada demueve los 'ok' implicados con bandera
    // `grupo_*` (explicable, evidencia geométrica).
    if (molde.grupos?.length) {
      evaluarGrupos(molde.grupos, molde.campos, resultados);
    }
    anclasPorPagina.push(resultados.some((r) => r.fuente === 'ancla' || r.fuente === 'respaldo'));
    paginas.push({
      pagina: p + 1,
      ocr_conf: ocr.conf,
      preview: previews ? canvasJpeg(pageCanvas, 900, 0.7) : undefined,
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
      // CORRECCIÓN post-verificación (recibo tachado): `ok: null` significa NO
      // EVALUABLE (contrato: "jamás un veredicto inventado") — un operando
      // ilegible NO impone un veredicto sobre el campo que SÍ se leyó bien.
      // Caso real: fecha_pago "05/12/2026" leído con conf 0.95 quedaba
      // `requiere_revision` porque fecha_emision está bajo un revelado y la
      // validación de rango no pudo evaluarse. Con ok===false (cierre que NO
      // cuadra) la democión se mantiene: esa es la defensa principal.
      if (v.ok === false) {
        r.banderas.push('validacion_fallida');
        // La defensa principal: una lectura de cierre que no cuadra jamás
        // permanece en "ok" (las "2"≠17 y "9"≠17 de la auditoría mueren aquí).
        if (r.estado === 'ok') r.estado = 'requiere_revision';
      } else {
        r.banderas.push('validacion_no_evaluable');
      }
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
  const { lines } = await proveedorOcr().ocrLines(canvas);
  const detalles: Record<string, 'ancla' | 'respaldo' | 'no'> = {};
  let encontradas = 0;
  const campos = molde.campos.map((c) => {
    const esRelacional = c.estrategia === 'ancla_relacional';
    if (c.estrategia !== 'ancla_relativa' && !esRelacional) return c;
    if (!c.ancla?.texto) return c;
    if (pagina !== undefined && c.pagina !== pagina) return c;
    // FASE 2 (v3.2.0): el relacional alinea SOLO dentro de su faro — la
    // alineación jamás viola el mapa (cero búsquedas globales, regla del dueño).
    const lineasBusqueda = esRelacional && c.zona_busqueda
      ? lineasEnFaro(lines, canvas.width, canvas.height, c.zona_busqueda)
      : lines;
    const hit = buscarAncla(c.ancla.texto, lineasBusqueda, canvas.width, canvas.height, c.ancla.rect);
    if (hit && hit.score >= ANCLA_SCORE_MIN) {
      encontradas++;
      detalles[c.id] = 'ancla';
      return { ...c, ancla: { ...c.ancla, rect: hit.rect } };
    }
    if (c.ancla_respaldo) {
      const hit2 = buscarAncla(c.ancla_respaldo, lineasBusqueda, canvas.width, canvas.height, c.ancla.rect);
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

// ---- Fase 8 (PLAN variante 4.2): umbral adaptativo por clustering ----
//
// La guarda F4/F4-1 clasifica las mediciones con el CORTE FIJO 0.002. Eso
// deja el matiz residual documentado: una vacía limpia pegada al corte JUNTO
// a una vacía con flash encima del corte (p. ej. [0.002, 0.0139, 0.079]) pasa
// la guarda relativa de una sola corrida, y el caso «todo por encima de
// 0.002» bloquea la calibración (sin_celdas_vacias) aunque el ruido real del
// papel SÍ haya sido medido en otras corridas.
//
// La solución de fondo (PLAN Fase 8, opción 4.1): acumular los ratios de
// TODAS las corridas del molde y separar las clases con clustering 1D
// (k-means k=2) en vez del corte fijo — el corte sale de los DATOS, no de la
// constante. Con < 3 corridas no hay estructura de clases fiable: se conserva
// el comportamiento anterior (primera corrida que sugiere, mismas guardas).

/**
 * Techo de ruido del corpus de la auditoría: la peor vacía con flash midió
 * 0.0139 y el trazo más fino real 0.045 (CORRECCIONES-POST-VERIFICACION §2.3).
 * 0.02 queda 1.4× por encima del ruido y 2.2× por debajo del trazo más fino:
 * sirve para validar que la clase BAJA del clustering es ruido de verdad (su
 * mínimo debe alcanzar valores de papel) y que la clase ALTA es tinta real
 * (su mínimo debe superar el techo). Exportado para que las pruebas usen el
 * MISMO valor que el motor. Si un molde futuro tuviera trazos por debajo de
 * este techo, recalibrar la constante con corpus propio y documentarlo.
 */
export const TECHO_RUIDO = 0.02;

/** Corridas mínimas para que el clustering sea fiable (PLAN Fase 8: ≥3-5). */
export const MIN_CORRIDAS_CLUSTERING = 3;

/** ε del dominio log: evita log(0) de celdas totalmente limpias (ratio 0)
 * sin distorsionar la separación a partir de 0.001. */
const LOG_EPS = 1e-4;

/**
 * k-means 1D DETERMINISTA (k=2) en espacio log10: los ratios abarcan órdenes
 * de magnitud (0.002 vs 0.138) y la distancia relativa es lo que separa las
 * clases. Inicialización en el mínimo y máximo (sin azar: misma entrada →
 * misma salida, requisito de reproducibilidad de la calibración). Devuelve
 * null cuando no hay varianza (todas las mediciones idénticas — no hay
 * estructura de clases que separar).
 */
function kmeans1D(valores: number[]): { bajos: number[]; altos: number[] } | null {
  if (valores.length < 2) return null;
  const logs = valores.map((v) => Math.log10(v + LOG_EPS));
  const min = Math.min(...logs);
  const max = Math.max(...logs);
  if (max - min < 1e-9) return null; // sin varianza: una sola "clase"
  let cBajo = min;
  let cAlto = max;
  let asignacion = new Array<number>(logs.length).fill(0);
  for (let iter = 0; iter < 50; iter++) {
    const nueva = logs.map((l) => (Math.abs(l - cBajo) <= Math.abs(l - cAlto) ? 0 : 1));
    const igual = nueva.every((v, i) => v === asignacion[i]);
    asignacion = nueva;
    const bajos = logs.filter((_, i) => asignacion[i] === 0);
    const altos = logs.filter((_, i) => asignacion[i] === 1);
    if (bajos.length) cBajo = bajos.reduce((a, b) => a + b, 0) / bajos.length;
    if (altos.length) cAlto = altos.reduce((a, b) => a + b, 0) / altos.length;
    if (igual) break;
  }
  const bajos: number[] = [];
  const altos: number[] = [];
  valores.forEach((v, i) => (asignacion[i] === 0 ? bajos : altos).push(v));
  // Sanidad: ambas clases no vacías (k-means k=2 con varianza siempre las
  // produce, pero el desempate por <= en la asignación puede colapsar si los
  // centros coinciden tras una iteración degenerada).
  if (!bajos.length || !altos.length) return null;
  return { bajos, altos };
}

/**
 * Candidato 2 de corte: separa por la BRECHA más grande en espacio log10
 * (máxima razón multiplicativa entre mediciones ordenadas consecutivas).
 * A diferencia del k-means (que minimiza varianza y puede arrastrar un flash
 * a la clase de tinta cuando hay muchas vacías limpias), la brecha máxima
 * parte SIEMPRE en el hueco de datos más ancho. Sometido a las mismas
 * guardas que el k-means: su defecto conocido (tinta bimodal sin vacías)
 * queda atrapado por el pre-gate y la guarda del techo.
 */
function brechaMaximaLog(valores: number[]): { bajos: number[]; altos: number[] } | null {
  if (valores.length < 2) return null;
  const orden = [...valores].sort((a, b) => a - b);
  let idxMejor = -1;
  let gapMejor = 0;
  for (let i = 0; i < orden.length - 1; i++) {
    const gap = Math.log10(orden[i + 1] + LOG_EPS) - Math.log10(orden[i] + LOG_EPS);
    if (gap > gapMejor) {
      gapMejor = gap;
      idxMejor = i;
    }
  }
  if (idxMejor < 0 || gapMejor <= 0) return null; // sin hueco: nada que separar
  const corte = (orden[idxMejor] + orden[idxMejor + 1]) / 2;
  const bajos = valores.filter((v) => v <= corte);
  const altos = valores.filter((v) => v > corte);
  if (!bajos.length || !altos.length) return null;
  return { bajos, altos };
}

/**
 * Fase 8: sugiere umbral acumulando los ratios del campo en TODAS las
 * corridas del molde y separando ruido/tinta por clustering 1D en vez del
 * corte fijo 0.002. Con menos de MIN_CORRIDAS_CLUSTERING corridas con
 * mediciones, conserva el comportamiento exacto de `sugerirUmbral` (primera
 * corrida que sugiere gana; mismas guardas F4/F4-1).
 *
 * Se evalúan DOS candidatos de corte y se acepta el PRIMERO que pase TODAS
 * las guardas de honestidad (si ninguno pasa, no se calibra):
 *   1. k-means k=2 (minimiza varianza intra-clase — el que prescribe el PLAN).
 *      Falla conocido: con vacías limpias + flash, la varianza arrastra el
 *      flash (0.0139) a la clase de tinta → lo detecta la guarda del techo.
 *   2. Brecha máxima en espacio log (máxima razón multiplicativa entre
 *      mediciones consecutivas). Falla conocido: con tinta bimodal sin
 *      vacías, parte entre los dos modos de tinta → lo detecta el pre-gate
 *      y la guarda del techo.
 * Los dos candidatos pasan por LAS MISMAS guardas, así que ninguna salida
 * peligrosa puede colarse: el defecto de cada candidato lo atrapa una guarda
 * distinta y el rechazo total es siempre el camino seguro.
 *
 * Guardas de honestidad (sobre las CLASES, ya no sobre el corte fijo):
 *   0. max(corridas) ≤ TECHO_RUIDO     → 'sin_tinta' (todo a nivel ruido)
 *   0. min(corridas) > TECHO_RUIDO     → 'sin_celdas_vacias' (todo a nivel trazo)
 *   1. clase alta: min(altos) > TECHO_RUIDO    → 'sin_tinta' (sin tinta demostrada)
 *   2. separación: max(bajos) < 0.5 × min(altos) → 'clases_entrelazadas' (guarda F4)
 *   3. defensiva: sugerido > max(bajos)        → 'clases_entrelazadas'
 *
 * El umbral sugerido mantiene el criterio del motor: trazo más fino × 0.7,
 * con piso absoluto 0.0015 (bajo él el OCR ya no discrimina nada fiable).
 */
export function sugerirUmbralClustering(
  corridas: ResultadoUniversal[],
  campoId: string,
): {
  sugerido: number | null;
  minConTinta: number | null;
  maxSinTinta: number | null;
  /** De dónde salió la clasificación de clases para ESTA sugerencia. */
  metodo: 'clustering' | 'corte_fijo';
  /** Cuántas corridas aportaron al menos una medición del campo. */
  corridasConMediciones: number;
  /** Por qué NO se sugiere (solo presente cuando `sugerido` es null). */
  motivo?: 'sin_mediciones' | 'sin_tinta' | 'sin_celdas_vacias' | 'clases_entrelazadas';
} {
  const medicionesPorCorrida = corridas.map((r) =>
    r.paginas
      .flatMap((p) => p.campos)
      .filter((c) => c.id === campoId && typeof c.ratio === 'number')
      .map((c) => c.ratio as number),
  );
  const corridasConMediciones = medicionesPorCorrida.filter((m) => m.length > 0).length;

  if (corridasConMediciones === 0) {
    return { sugerido: null, minConTinta: null, maxSinTinta: null, metodo: 'corte_fijo', corridasConMediciones, motivo: 'sin_mediciones' };
  }

  // Camino de compatibilidad (< 3 corridas): misma semántica que la UI tenía
  // antes de Fase 8 — iterar en el orden dado y quedarse con la PRIMERA
  // corrida que sugiere; si ninguna sugiere, el primer motivo bloqueante.
  if (corridasConMediciones < MIN_CORRIDAS_CLUSTERING) {
    let bloqueo: ReturnType<typeof sugerirUmbral> | null = null;
    for (const mediciones of medicionesPorCorrida) {
      if (!mediciones.length) continue;
      const corridaSintetica = {
        paginas: mediciones.map((r) => ({ pagina: 1, campos: [{ id: campoId, ratio: r }] })),
      } as unknown as ResultadoUniversal;
      const s = sugerirUmbral(corridaSintetica, campoId);
      if (s.sugerido !== null) {
        return { ...s, metodo: 'corte_fijo', corridasConMediciones };
      }
      if (s.motivo && s.motivo !== 'sin_mediciones' && !bloqueo) bloqueo = s;
    }
    return {
      sugerido: null,
      minConTinta: bloqueo?.minConTinta ?? null,
      maxSinTinta: bloqueo?.maxSinTinta ?? null,
      metodo: 'corte_fijo',
      corridasConMediciones,
      motivo: bloqueo?.motivo ?? 'sin_mediciones',
    };
  }

  // Camino Fase 8: pooling de TODAS las mediciones + clustering.
  const pooled = medicionesPorCorrida.flat();
  const maxPooled = Math.max(...pooled);
  const minPooled = Math.min(...pooled);

  // Pre-gates sobre el TECHO de ruido (ya NO sobre el corte fijo 0.002):
  // deciden si los datos siquiera tienen dos clases plausibles.
  if (maxPooled <= TECHO_RUIDO) {
    return { sugerido: null, minConTinta: null, maxSinTinta: maxPooled, metodo: 'clustering', corridasConMediciones, motivo: 'sin_tinta' };
  }
  if (minPooled > TECHO_RUIDO) {
    return { sugerido: null, minConTinta: minPooled, maxSinTinta: null, metodo: 'clustering', corridasConMediciones, motivo: 'sin_celdas_vacias' };
  }

  // Candidato 1 (PLAN): k-means k=2 determinista en log10.
  const clases = kmeans1D(pooled);
  // Candidato 2: brecha máxima log (máxima razón multiplicativa consecutiva).
  const brecha = brechaMaximaLog(pooled);

  const mediaLog = (arr: number[]) => arr.reduce((a, b) => a + Math.log10(b + LOG_EPS), 0) / arr.length;

  type Fallo = { minConTinta: number | null; maxSinTinta: number | null; motivo: 'sin_tinta' | 'clases_entrelazadas' };
  let primerFallo: Fallo | null = null;

  for (const candidato of [clases, brecha]) {
    if (!candidato) continue;
    // Orientación: clase baja = ruido, clase alta = tinta (por media log).
    const { bajos, altos } =
      mediaLog(candidato.bajos) <= mediaLog(candidato.altos) ? candidato : { bajos: candidato.altos, altos: candidato.bajos };
    const minConTinta = Math.min(...altos);
    const maxSinTinta = Math.max(...bajos);

    // Guarda 1: la clase alta debe superar el techo de ruido — si su mínimo
    // vive en territorio de papel/flash, no hay tinta demostrada (el defecto
    // conocido del k-means: la varianza arrastra el flash a la clase alta).
    if (minConTinta <= TECHO_RUIDO) {
      if (!primerFallo) primerFallo = { minConTinta, maxSinTinta, motivo: 'sin_tinta' };
      continue;
    }
    // Guarda 2 (F4 sobre clases reales, no sobre el corte fijo).
    if (maxSinTinta >= 0.5 * minConTinta) {
      if (!primerFallo) primerFallo = { minConTinta, maxSinTinta, motivo: 'clases_entrelazadas' };
      continue;
    }
    const sugerido = Math.max(0.0015, Math.round(minConTinta * 0.7 * 10000) / 10000);
    // Guarda 3 (defensiva): el sugerido SIEMPRE debe quedar por encima del
    // ruido máximo medido.
    if (sugerido <= maxSinTinta) {
      if (!primerFallo) primerFallo = { minConTinta, maxSinTinta, motivo: 'clases_entrelazadas' };
      continue;
    }
    return { sugerido, minConTinta, maxSinTinta, metodo: 'clustering', corridasConMediciones };
  }

  // Ningún candidato pasó las guardas: no se calibra (camino seguro).
  return {
    sugerido: null,
    minConTinta: primerFallo?.minConTinta ?? null,
    maxSinTinta: primerFallo?.maxSinTinta ?? null,
    metodo: 'clustering',
    corridasConMediciones,
    motivo: primerFallo?.motivo ?? 'clases_entrelazadas',
  };
}

export { hexTipo };
