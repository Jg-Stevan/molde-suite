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
//   4. Si el documento NO fue reconocido como E-14 y el candidato responde
//      (score ≥ UMBRAL_RUTA_SCORE), el resultado del MOLDE se convierte en
//      el veredicto del acta (`enrutado: true`): score/estado/banner salen
//      del molde. Si el documento ES un E-14, el resultado queda ADITIVO
//      (doctrina intacta — el gate electoral manda).
//
// Molde demo: si la biblioteca está vacía se siembra UNA vez «RECIBO DE LUZ»
// calibrado contra el fixture SIM «recibo» (simulacion-imagenes.ts) para que
// el puente sea demostrable de punta a punta sin importar nada a mano.

import type { MoldeUniversal } from '@jg-stevan/scanner-core/molde/universal-types';
import { buscarAncla } from '@jg-stevan/scanner-core/molde/universal-engine';
import type { LineaOcr } from '@jg-stevan/scanner-core/molde/ocr-tipos';
import type { ActaStatus, RechazoActa, ResumenMoldeActa } from '@jg-stevan/scanner-core/dominio/types';
import { guardarMolde, listarMoldes } from './almacen';
import { moldeActivo } from './registry';

/** Score mínimo (0-100 del motor universal) para ENRUTAR un acta al molde. */
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

/** Anclas únicas declaradas por el molde (página 1: el escaneo es 1 página). */
function anclasDeMolde(molde: MoldeUniversal): string[] {
  const set = new Set<string>();
  for (const c of molde.campos) {
    if (c.pagina !== 1) continue;
    if (c.estrategia === 'ancla_relativa' && c.ancla?.texto) set.add(c.ancla.texto);
  }
  return [...set];
}

/** Ratio de anclas del molde presentes en las líneas OCR (0-1). Un molde sin
 *  anclas no es enrutable por prefilter (null) — honesto: sin señal, sin ruta. */
export function ratioAnclasDe(
  molde: MoldeUniversal,
  lineas: LineaOcr[],
  canvasW: number,
  canvasH: number,
): number | null {
  const anclas = anclasDeMolde(molde);
  if (anclas.length === 0) return null;
  let hits = 0;
  for (const texto of anclas) {
    const hit = buscarAncla(texto, lineas, canvasW, canvasH);
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
