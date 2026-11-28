// ETAPA B (plan "interfaz única E-14") — ENRUTAMIENTO UNIVERSAL de moldes.
//
// El flujo E-14 clasifica SU documento (cabecera electoral); todo lo demás
// hoy moría en «DOCUMENTO SIN IDENTIFICAR». Este módulo cierra el puente
// Studio→Tamiz para CUALQUIER plantilla:
//
//   1. OCR de página completa UNA sola vez (proveedor Tesseract compartido).
//   2. PREFILTRO por molde: cada ancla declarada se busca con la MISMA
//      función del motor (`buscarAncla`) sobre esas líneas — barato, sin
//      segundo OCR. El molde con mejor ratio de anclas encontradas es el
//      candidato.
//   3. La evaluación COMPLETA corre una sola vez (motor universal compartido
//      `evaluarDocumentoUniversal`, modo ligero).
//   4. Si el molde ganador NO es el del acta E-14 (o el documento no fue
//      reconocido como electoral) y el candidato LEYÓ algo (ok_count > 0), el
//      resultado del MOLDE se convierte en el veredicto del acta (`enrutado:
//      true`): score/estado/banner salen del molde. Identificar NO es aprobar:
//      el molde puede mandar y dictar RECHAZADA por campos faltantes. Solo un
//      acta E-14 reconocida contra su propio molde deja el resultado ADITIVO
//      (doctrina intacta — el gate electoral manda).
//
// Molde demo: si la biblioteca está vacía se siembra UNA vez «RECIBO DE LUZ»
// calibrado contra el fixture SIM «recibo» (simulacion-imagenes.ts) para que
// el puente sea demostrable de punta a punta sin importar nada a mano.

import type { MoldeUniversal } from '@molde-suite/scanner-core/molde/universal-types';
import { buscarAncla } from '@molde-suite/scanner-core/molde/universal-engine';
import type { LineaOcr } from '@molde-suite/scanner-core/molde/ocr-tipos';
import type { ActaStatus, RechazoActa, ResumenMoldeActa } from '@molde-suite/scanner-core/dominio/types';
import { guardarMolde, listarMoldes } from './almacen';
import { moldeActivo } from './registry';

/** Umbral de CALIDAD del veredicto (0-100 del motor universal): desde el AUTO
 *  de 2026-11-27 ya NO es una puerta de enrutado — bajo este score el molde
 *  identifica el documento y dicta RECHAZADA (`veredictoDeResumen`). */
export const UMBRAL_RUTA_SCORE = 65;
/** Ratio de anclas encontradas (prefiltro) para elegir un candidato. */
export const UMBRAL_RUTA_ANCLAS = 0.5;
/** Score mínimo de un hit de ancla individual (mismo criterio del motor). */
export const UMBRAL_HIT_ANCLA = 0.6;

/** Contexto que el pipeline entrega al router: ¿el clasificador E-14
 *  reconoció el documento? (tipo TRANSMISION/DELEGADOS). */
export interface ContextoE14Acta {
  esE14: boolean;
}

/** ¿Este molde describe el acta electoral E-14? Se decide por lo que el molde
 *  DECLARA (`documento`), no por lo que el OCR del documento parezca decir:
 *  solo ahí el gate electoral le cede el veredicto al molde. */
export function moldeElectoral(molde: MoldeUniversal): boolean {
  return molde.documento === 'acta_e14';
}

/** ¿El veredicto del MOLDE sustituye al del gate? El criterio es qué molde
 *  ganó, no si el clasificador electoral leyó algo: `esE14` se enciende con
 *  cualquier cabecera/MESA/tipo del OCR, así que un recibo que mencione
 *  «MESA» o «DELEGADOS» quedaba aditivo y nunca se enrutaba. El gate solo
 *  conserva la autoridad sobre un acta E-14 reconocida evaluada contra su
 *  propio molde; el resto de la biblioteca manda sobre cualquier documento.
 *
 *  AUTO (2026-11-27) — IDENTIFICAR ≠ APROBAR: el umbral de score deja de
 *  condicionar la ruta. Exigir `score >= UMBRAL_RUTA_SCORE` para escuchar al
 *  molde significaba que un recibo reconocido al 42 % de anclas se quedaba con
 *  el veredicto electoral y el operador NO veía los datos que la plantilla
 *  pide. Basta con que el molde HAYA LEÍDO algo (`okCount > 0`) para que su
 *  veredicto —que puede ser RECHAZADA por faltantes— sea el del acta. El score
 *  sigue siendo el insumo de `veredictoDeResumen` (semáforo) y del umbral de
 *  calidad, no una puerta de display. */
export function debeEnrutar(
  molde: MoldeUniversal,
  contexto: ContextoE14Acta | undefined,
  score: number,
  okCount: number,
): boolean {
  if (moldeElectoral(molde) && contexto?.esE14) return false;
  return okCount > 0;
}

// ────────────────────────────────────────────────────────────────────────────
// Molde demo «RECIBO DE LUZ» — calibrado 1:1 con el fixture SIM «recibo»
// (página 850×1100, papel 110..740 × 120..980). Anclas con rect esperado
// (penalización de posición suave del motor) y zonas como DELTAS desde el
// rect del ancla (semántica `ancla_relativa` del motor universal v3).
// ────────────────────────────────────────────────────────────────────────────
export const MOLDE_DEMO_RECIBO: MoldeUniversal = {
  tipo: 'universal',
  version: '3.1.0',
  nombre: 'RECIBO DE LUZ',
  descripcion: 'Recibo de servicio de energía eléctrica (documento no electoral).',
  documento: 'recibo_servicio',
  idioma: 'spa',
  campos: [
    {
      id: 'suscriptor',
      etiqueta: 'NÚMERO DE SUSCRIPTOR',
      pagina: 1,
      tipo: 'texto',
      estrategia: 'ancla_relativa',
      zona: { x: 0.19, y: -0.002, w: 0.105, h: 0.03 },
      ancla: { texto: 'SUSCRIPTOR No', rect: { x: 0.17, y: 0.23, w: 0.19, h: 0.03 } },
      patron: '\\d{5,8}',
      limpiar_valor: '(\\d{5,8})',
      realce: true,
      umbral: 0.1,
      obligatorio: true,
      nota: 'Identidad del cliente en el recibo.',
    },
    {
      id: 'periodo',
      etiqueta: 'PERIODO FACTURADO',
      pagina: 1,
      tipo: 'texto',
      estrategia: 'ancla_relativa',
      zona: { x: 0.12, y: -0.002, w: 0.115, h: 0.03 },
      ancla: { texto: 'PERIODO', rect: { x: 0.17, y: 0.262, w: 0.1, h: 0.03 } },
      patron: '\\d{4}-\\d{2}',
      realce: true,
      umbral: 0.1,
      obligatorio: true,
      nota: 'Mes facturado (AAAA-MM).',
    },
    {
      id: 'consumo',
      etiqueta: 'CONSUMO (kWh)',
      pagina: 1,
      tipo: 'texto',
      estrategia: 'ancla_relativa',
      zona: { x: 0.175, y: -0.002, w: 0.12, h: 0.03 },
      ancla: { texto: 'CONSUMO kWh', rect: { x: 0.17, y: 0.293, w: 0.14, h: 0.03 } },
      patron: '\\d{2,5}',
      umbral: 0.1,
      obligatorio: false,
      nota: 'Consumo del periodo.',
    },
    {
      id: 'valor',
      etiqueta: 'VALOR A PAGAR',
      pagina: 1,
      tipo: 'texto',
      estrategia: 'ancla_relativa',
      zona: { x: 0.25, y: -0.003, w: 0.16, h: 0.033 },
      ancla: { texto: 'VALOR A PAGAR', rect: { x: 0.17, y: 0.353, w: 0.24, h: 0.038 } },
      patron: '\\d{4,8}',
      limpiar_valor: '(\\d{4,8})',
      realce: true,
      umbral: 0.1,
      obligatorio: true,
      destacado: true,
      nota: 'Total a pagar del recibo.',
    },
  ],
  meta: {
    orden: 1,
    estado: 'activo',
    etiquetaCampos: 'Campos mapeados',
  },
};

const CLAVE_SEMILLA = 'tamiz.demoMolde.v1';

/** Siembra el molde demo en la biblioteca (UNA sola vez por dispositivo y
 *  solo si la biblioteca está vacía — si el operador lo borra, no vuelve). */
export async function sembrarMoldeDemo(): Promise<void> {
  try {
    if (typeof window === 'undefined') return;
    if (window.localStorage.getItem(CLAVE_SEMILLA) === '1') return;
    const filas = await listarMoldes();
    if (filas.length === 0) {
      await guardarMolde(MOLDE_DEMO_RECIBO);
    }
    window.localStorage.setItem(CLAVE_SEMILLA, '1');
  } catch {
    /* la siembra es best-effort: sin biblioteca el router no-op */
  }
}

// ────────────────────────────────────────────────────────────────────────────
// PREFILTRO por anclas — una sola pasada de OCR compartida entre candidatos.
// ────────────────────────────────────────────────────────────────────────────

/** Anclas únicas declaradas por el molde (página 1: el escaneo es 1 página).
 *  v3.2.0: incluye el modo relacional — esto es IDENTIFICACIÓN del documento
 *  (¿qué molde aplica?), no resolución de zonas: la doctrina del faro gobierna
 *  la resolución de campos (universal-engine), aquí solo reconocemos el papel. */
function anclasDeMolde(molde: MoldeUniversal): { texto: string; rect?: { x: number; y: number; w: number; h: number } }[] {
  const mapa = new Map<string, { texto: string; rect?: { x: number; y: number; w: number; h: number } }>();
  for (const c of molde.campos) {
    if (c.pagina !== 1) continue;
    if ((c.estrategia === 'ancla_relativa' || c.estrategia === 'ancla_relacional') && c.ancla?.texto) {
      const previo = mapa.get(c.ancla.texto);
      if (!previo || (!previo.rect && c.ancla.rect)) {
        mapa.set(c.ancla.texto, { texto: c.ancla.texto, rect: c.ancla.rect });
      }
    }
  }
  return [...mapa.values()];
}

/** Ratio de anclas del molde presentes en las líneas OCR (0-1). Un molde sin
 *  anclas no es enrutable por prefilter (null) — honesto: sin señal, sin ruta.
 *
 *  v1.5.0 (fotos reales 2026-11-25): el rect DECLARADO viaja como referencia
 *  posicional a `buscarAncla` (penalización suave 1/(1+3d) del motor). Es lo
 *  que separa variantes del MISMO papel que comparten rótulos pero no
 *  geometría (p. ej. la línea Fecha del recibo B vive a x≈0.37 y la de A/C a
 *  x≈0.67): sin referencia, las tres variantes empatan y el router elige a
 *  ciegas la primera de la biblioteca. */
export function ratioAnclasDe(
  molde: MoldeUniversal,
  lineas: LineaOcr[],
  canvasW: number,
  canvasH: number,
): number | null {
  const anclas = anclasDeMolde(molde);
  if (anclas.length === 0) return null;
  let hits = 0;
  for (const a of anclas) {
    const hit = buscarAncla(a.texto, lineas, canvasW, canvasH, a.rect);
    if (hit && hit.score >= UMBRAL_HIT_ANCLA) hits += 1;
  }
  return hits / anclas.length;
}

export interface CandidatoMolde {
  molde: MoldeUniversal;
  ratioAnclas: number;
}

/** Elige el mejor candidato de la biblioteca contra el OCR ya calculado. */
export function elegirCandidato(
  moldes: MoldeUniversal[],
  lineas: LineaOcr[],
  canvasW: number,
  canvasH: number,
): CandidatoMolde | null {
  let mejor: CandidatoMolde | null = null;
  for (const molde of moldes) {
    const ratio = ratioAnclasDe(molde, lineas, canvasW, canvasH);
    if (ratio === null || ratio < UMBRAL_RUTA_ANCLAS) continue;
    if (!mejor || ratio > mejor.ratioAnclas) mejor = { molde, ratioAnclas: ratio };
  }
  return mejor;
}

// ────────────────────────────────────────────────────────────────────────────
// VEREDICTO UNIVERSAL — el resultado del molde mapea al semáforo del acta
// (B.3: score y colores para cualquier plantilla, con la MISMA escala).
// ────────────────────────────────────────────────────────────────────────────

export interface VeredictoMolde {
  status: ActaStatus;
  /** Score 0-10 del acta (misma escala del gate E-14). */
  score: number;
  rechazo: RechazoActa | null;
}

/** Convierte el resumen del motor universal en veredicto del acta.
 *  · Obligatorios faltantes o score bajo el umbral → RECHAZADA (detalle con
 *    el nombre del molde y los campos exactos).
 *  · Lectura dudosa (requiere_revision) → ADVERTENCIA.
 *  · Resto → OPTIMA. Jamás inventa: usa SOLO lo medido. */
export function veredictoDeResumen(r: ResumenMoldeActa): VeredictoMolde {
  const scoreActa = Math.round((r.score / 10) * 10) / 10;
  const faltanObligatorios = r.obligatoriosFaltantes.length > 0;
  if (faltanObligatorios || r.score < UMBRAL_RUTA_SCORE) {
    const motivo = faltanObligatorios
      ? `CAMPOS OBLIGATORIOS FALTANTES: ${r.obligatoriosFaltantes.join(', ')}`
      : `SCORE ${r.score}% BAJO EL UMBRAL DE CONFIANZA`;
    return {
      status: 'RECHAZADA',
      score: scoreActa,
      rechazo: {
        tipo: 'MOLDE',
        detalle: `MOLDE ${r.moldeNombre.toUpperCase()} — ${motivo}`,
      },
    };
  }
  if (r.requiereRevision) {
    return { status: 'ADVERTENCIA', score: scoreActa, rechazo: null };
  }
  return { status: 'OPTIMA', score: scoreActa, rechazo: null };
}

// ────────────────────────────────────────────────────────────────────────────
// Candidatos de la sesión: molde ACTIVO primero (elección explícita del
// operador), biblioteca completa después (sin duplicar el activo).
// ────────────────────────────────────────────────────────────────────────────

export async function candidatosDeSesion(): Promise<MoldeUniversal[]> {
  const activo = moldeActivo();
  const enBiblioteca = (await listarMoldes()).map((f) => f.json);
  if (!activo) return enBiblioteca;
  return [activo, ...enBiblioteca.filter((m) => m.nombre !== activo.nombre)];
}
