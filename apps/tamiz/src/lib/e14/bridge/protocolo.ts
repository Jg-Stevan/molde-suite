/**
 * R-28 (H-18, auditoría 2026-11-16) — partición de scanner-core-bridge.ts:
 * PROTOCOLO — los CONTRATOS de mensajes del bridge: opciones de escaneo con
 * watchdog, resultado del gate §4.2, acumulador parcial del pipeline, campos
 * del acta §3.1, el copy canónico de los rechazos (DETALLE_*) y las piezas
 * puras del mensaje de auditoría (fmtClasif §4.6, senalDeContenido §D1) +
 * las sub-interfaces de pasos inyectables (FASE F / 7.8 ISP).
 * Move-only: byte a byte con el original (solo cambian las rutas de import).
 */
import type {
  Acta,
  ActaStatus,
  EstructuraActa,
  ProgresoAnalisis,
} from "@molde-suite/scanner-core/dominio/types";
import type { OpcionesEscaneo } from "@molde-suite/scanner-core/dominio/bridge";
import type {
  PageFilter,
  PageQuality,
  Quad,
} from "@molde-suite/scanner-core/core/types";
import {
  PATRON_CABECERA,
  type ClasificacionE14,
} from "@molde-suite/scanner-core/dominio/clasificador";
import type { ImagenSimuladaId } from "../simulacion-imagenes";
// 7.1 (plan de remediación, cierra C3) — umbrales con nombre, ÚNICA fuente
// de verdad de los números del producto (./politica/umbrales.ts).
import { TECHO_SIN_SENAL, TECHO_ESCUDO_FONDO } from "../politica/umbrales";
// Pasos inyectables (FASE F): los typeof provienen de los módulos hermanos
// — imports SOLO de tipo para el compilador (se eliden en runtime).
import { decodeArchivoMemo, esperarWorkerCaliente } from "./captura";
import { conRampa } from "./progreso";
import { calidadDeActa, contrasteEfectivoDe, scoreDeCalidad } from "./calidad";
import {
  ocrBanda,
  ocrBandaInferior,
  reconocerRapidOcrCascada,
  reconocerRapidOcrEscalonado,
} from "./ocr";

/** Techos/labels del mapeo §4 y el gate §4.2. */
export const DETALLE_ILEGIBLE = "CÓDIGO DE BARRAS Y CABECERA NO DETECTADOS";
export const DETALLE_TIMEOUT = "TIEMPO DE PROCESADO EXCEDIDO";
export const DETALLE_GENERICO = "SCORE INSUFICIENTE PARA ENVIAR";
// §F-5 (SPEC-camara-funcional): detalle del rechazo por acta INCOMPLETA —
// la captura corta el papel aunque la cabecera sea legible.
export const DETALLE_INCOMPLETA = "EL DOCUMENTO ESTÁ CORTADO EN EL ENCUADRE — ALÉJATE UN POCO Y CAPTURA EL DOCUMENTO COMPLETO";
// KIT e63d-escaneo-ya-recortado-v1 (F3.4): copy de la rama escaneo RETIRADO
// junto con el módulo masiva (el origen del archivo era señal exclusiva del
// runner MASIVA — sin cola no hay flujos «escaneo»).
// KIT e14-gate-v2 (FASE G2): detalle del rechazo por el MARCADOR
// OBLIGATORIO de votos fallido — copy CORTO y descriptivo (decisión del
// mantenedor: SIN guía de cámara). El rechazo directo regresa el flujo a
// captura (comportamiento existente de RECHAZADA).
export const DETALLE_SIN_VOTOS = "DOCUMENTO SIN DATOS VISIBLES";
// §D1/KIT: los NÚMEROS de la política (TECHO_SIN_SENAL, TECHO_ESCUDO_FONDO,
// techos del score, umbral de rechazo) viven en politica/umbrales.ts desde
// 7.1 (C3 — única fuente de verdad); el copy BAJO queda aquí.
export const DETALLE_BAJO = "NO SE RECONOCE INFORMACIÓN DEL DOCUMENTO — REPITA LA FOTO";
// PLAN-AGENTE-LAYOUT F4: rechazo temprano por el gate estructural (etapa
// LAYOUT entre CALIDAD y OCR). El detalle lleva la regla exacta y su motivo.
export const DETALLE_ESTRUCTURA = "EL DOCUMENTO NO CORRESPONDE A LA PLANTILLA DEL MOLDE ACTIVO";

/**
 * §D1 (SPEC-e14-score-ocr): SEÑAL DE CONTENIDO del acta — se calcula DESPUÉS
 * del OCR + clasificación. El score del mantenedor mide el RECONOCIMIENTO («el
 * score se basa en el reconocimiento del acta por ocr y que el acta esté
 * completa»), no solo las métricas fotográficas. Señales: cabecera E-14 o
 * alguna lectura cruda del clasificador (MESA/tipo). `ocrTextIsValid` NO es
 * señal (la bolsa de papas lo pasa con texto ficticio del empaque).
 */
export function senalDeContenido(texto: string, clasificacion: ClasificacionE14): boolean {
  const p = clasificacion.parciales;
  return (
    PATRON_CABECERA.test(texto) ||
    p?.cabecera === true ||
    (p?.mesa != null && Number.isFinite(p.mesa)) ||
    p?.tipo != null
  );
}

// GUARD-BORDE Rev. 2 (D1/D3): la función esActaCompleta del guard del PR #33
// (geometría: esquina al filo ≤0.001/≥0.999 o área <30% → INCOMPLETA) VIVIÓ
// aquí y hoy vive en ./completitud (verificarCompletitud) — la geometría
// pasó de CONDENAR a SER SOSPECHA: la condena exige tinta impresa cortada al
// filo del recorte (tabla de decisión §2 del spec). Historia completa del
// guard y su calibración: comentario del helper + CHANGES 0-decimoquinto.
// PATRON_CABECERA vive ahora en ./clasificador (§4.5: se mantiene como
// constante para traza/log — ya NO decide sola el estado del gate).

/** KIT e14-masiva-ux-v1 (T4) — RETIRADA DEL MÓDULO MASIVA: el runner que
 *  pasaba 120_000 ya no existe; el presupuesto opcional y el rescate
 *  post-timeout (e67) siguen disponibles para el flujo individual. */
export type OpcionesEscaneoConTimeout = OpcionesEscaneo & {
  /** Presupuesto total del pipeline para ESTA llamada (ms). Ausente =
   *  presupuestoEscaneoEfectivo() (plan por tier — KIT e14-ocr-tessbest-v1:
   *  ALTO 120_000 desde e67 — 15_000 antes — · MEDIO 240_000 · BAJO 480_000). */
  timeoutMs?: number;
  /** e67-watchdog-rescate-v1 (cambio B — RESCATE post-timeout): el pipeline
   *  NO se cancela al vencer el presupuesto — sigue vivo y su desenlace
   *  llega DESPUÉS del acta RECHAZADA de timeout. Antes ese resultado
   *  válido se DESCARTABA en silencio (`if (vencido) return`). Ahora viaja
   *  por ESTE callback (SOLO se dispara tras un vencimiento — idempotente:
   *  si el pipeline gana la carrera jamás se llama). El receptor decide:
   *  el store individual rescata actas válidas (OPTIMA/ADVERTENCIA) y
   *  revierte el rechazo. Firmas intactas.
   *  `tiempoRealMs` = ms reales del pipeline completo (dato, jamás inventado). */
  onRescateTardio?: (acta: Acta, tiempoRealMs: number) => void;
  /** KIT e14-simulacion-imagenes-v1: imagen del catálogo elegida en la
   *  galería del visor (fuente SIMULACION). Ausente sin elección = primera
   *  imagen del catálogo. No altera el pipeline: se procesa como IMPORTAR. */
  imagenSimulada?: ImagenSimuladaId;
};

/** Resultado del gate §4 (evaluarGate) — status + rechazo + clasificación. */
export interface ResultadoGate {
  status: ActaStatus;
  rechazo: Acta["rechazo"];
  clasificacion: ClasificacionE14 | null;
}

/** Traza §4.6: clasif={dep:88,mun:335,zon:05,std:02,mesa:001,tipo:T,nivel:AUTO}. */
export function fmtClasif(c: ClasificacionE14 | null): string {
  if (!c) return "sin-clasificar";
  const tipo = c.tipo === "TRANSMISION" ? "T" : c.tipo === "DELEGADOS" ? "D" : "-";
  // KIT actas-vivas-paginas-v1 (FASE B): página en la traza de auditoría —
  // «pag:2/2» leída · «pag:?» DESCONOCIDA (el hueco irá al primer libre).
  const pag = c.pagina ? `${c.pagina.index}/${c.pagina.total}` : "?";
  // KIT identificacion-codigo-v1 (Task 120): consenso del código + avisos de
  // los cruces en la traza de auditoría (cod:crudo · av:A+B+C).
  const cod = c.codigoUnico ? `,cod:${c.codigoUnico.crudo}` : "";
  const av = c.avisos?.length ? `,av:${c.avisos.join("+")}` : "";
  return (
    `dep:${c.departamento?.codigo ?? "?"},mun:${c.municipio?.codigo ?? "?"},` +
    `zon:${c.zona?.codigo ?? "?"},std:${c.puesto?.codigo ?? "?"},` +
    `mesa:${c.mesa !== null ? String(c.mesa).padStart(3, "0") : "?"},` +
    `pag:${pag},tipo:${tipo},nivel:${c.nivel}${cod}${av}`
  );
}

/** e64-qr T-2.1 — acumulador del pipeline: lo conocido al vencer el timeout
 *  + la señal de la CAPA 0 QR de cámara (ADITIVA — el QR jamás afecta
 *  score/status/gate/OCR; llave OPACA, red line 10). qrCam:
 *  undefined = el decodificador no terminó (timeout — los campos viajan
 *  AUSENTES, jamás inventar) · null = corrió y terminó en null
 *  ("sin-payload") · {payload} = leído ("leido"). */
export interface ParcialPipeline {
  fotoOriginal?: string;
  qrCam?: { payload: string } | null;
  /** D57 T2 — ms del probe de orientación (aditivo, diagnóstico). */
  probeMsOrientacion?: number | null;
  /** KIT e14-remediacion-movil-v1 (B1 — P0 #3): parciales de TIEMPO ya
   *  medidos al vencer el watchdog — el acta de timeout deja de emitir una
   *  muestra sin cuerpo. El pipeline (pipeline.ts) sincroniza este objeto en
   *  cada frontera de fase (decode/detect/proceso/calidad/orient/ocr);
   *  el watchdog lo lee tal cual (nada re-evaluado — §9.10). Ausente =
   *  venció antes de la primera frontera (decode). */
  msParciales?: Record<string, number>;
  /** H4 (auditoría de B1): clave del ESCANEO — watchdog y desenlace tardío
   *  construyen actas con id propio (el contador de `construirActa` avanza),
   *  así que el id de acta NO sirve para deduplicar la muestra de perf. Esta
   *  clave nace una vez por `escanearActa` y viaja por los dos caminos. */
  escaneoId?: string;
}

/** Campos reales §3.1 que recibe `construirActa` (FASE F: tipo extraído de la
 *  firma para poder inyectar el método en `PasosPipelineL2` — mismo contrato). */
export type CamposActa = {
  fotoProcesada?: string;
  /** §D4 (SPEC-e14-score-ocr): la procesada salió sin tinta. */
  procesadaVacia?: boolean;
  /** KIT actas-vivas-paginas-v1 (FASE C): OCR de secciones detectó el
   *  recorte del papel (faltaSeccionInferior). */
  recortada?: boolean;
  /** KIT identificacion-codigo-v1 (FASE F): LADO de la esquina fiducial
   *  faltante (píldora «ACTA RECORTADA · SUP-IZQ») — null cuando el
   *  recorte vino SOLO del OCR de secciones o 4/4 presentes. */
  recorteLado?: string | null;
  quadDetectado?: Quad;
  calidad?: PageQuality;
  ocrTexto?: string;
  motor?: "worker" | "canvas";
  /** §D8.3 (SPEC-e14-score-ocr Rev. 3): filtro del acta al nacer —
   *  "original" cuando el asset sim corrió as-is, "bw" (default del
   *  producto) en el pipeline normal. */
  filtro?: PageFilter;
  score: number;
  /** Score visual = bruto de scoreDeCalidad ANTES de los caps del sitio. */
  scoreVisual?: number;
  status: ActaStatus;
  rechazo: Acta["rechazo"];
  /** Clasificación de cabecera (SPEC-cabecera-clasificacion §4/§6). */
  clasificacion?: ClasificacionE14 | null;
  /** FASE 0 (blueprint DLA): evaluación del molde activo tras el gate. */
  evaluacionMolde?: import("@molde-suite/scanner-core/dominio/types").ResumenMoldeActa | null;
  /** PLAN-AGENTE-LAYOUT F4: veredicto del gate estructural (etapa LAYOUT).
   *  null = molde sin layout o modelo no configurado (etapa saltada). */
  estructura?: EstructuraActa | null;
};

/**
 * FASE F (plan post-v2.3) — PASOS INYECTABLES de §5: el cuerpo del pipeline
 * vive en `pipeline.ts` (move-only) y este repo le entrega los helpers que
 * §5 comparte con el pipeline de RECORTE (§7.5) + los DOS métodos de la
 * clase que el cuerpo usa. Sin cambios de decisión.
 *
 * 7.8 (plan de remediación, A5) — la god-interface de 21 miembros se agrupa
 * en SUB-INTERFACES por etapa (ISP — el contrato de cada extracción del
 * troceado 7.3 es UNA sub-interfaz, no las 21 piezas). `PasosPipelineL2`
 * sigue siendo la INTERSECCIÓN exacta de las cuatro: los consumidores actuales
 * no se rompen; los pasos nuevos del plan (docs/PLAN-TROCEADO-PIPELINE.md)
 * ya declaran la porción mínima que necesitan.
 */
/** Etapa CAPTURA: entrada → dataUrl + quad (decode, detección, warm-up). */
export type PasosCaptura = {
  conRampa: typeof conRampa;
  decodeArchivoMemo: typeof decodeArchivoMemo;
  quadIdentidad: Quad;
  esperarWorkerCaliente: typeof esperarWorkerCaliente;
  /** FASE A3 (blueprint DLA): deskew residual activado por flag del operador. */
  deskewHabilitado: boolean;
};
/** Etapa CALIDAD: warp/crop → métricas → score bruto (§4.1). */
export type PasosCalidad = {
  calidadDeActa: typeof calidadDeActa;
  scoreDeCalidad: typeof scoreDeCalidad;
  contrasteEfectivoDe: typeof contrasteEfectivoDe;
};
/** Etapa OCR: escalonado + cascada + banda del sello (§4, PROD-1/PROD-2). */
export type PasosOcr = {
  reconocerRapidOcrEscalonado: typeof reconocerRapidOcrEscalonado;
  reconocerRapidOcrCascada: typeof reconocerRapidOcrCascada;
  ocrBanda: typeof ocrBanda;
  ocrBandaInferior: typeof ocrBandaInferior;
  /**
   * FASE B3 (blueprint DLA): banda OCR DINÁMICA desde regiones de layout
   * (PP-DocLayout ONNX). Opcional: null/ausente = bandas fijas 16%/20% de
   * siempre (Nivel 1). Devuelve el texto de la banda o null sin señal.
   */
  ocrBandaDinamica?: (
    fotoProcesada: string,
    parte: "sup" | "inf",
  ) => Promise<string | null>;
};
/** Etapa GATE: señales, clasificación y desenlace (§4.2 — la política vive
 *  además en politica/gate.ts desde 7.2; estas piezas llegan inyectadas). */
export type PasosGate = {
  senalDeContenido: typeof senalDeContenido;
  esquinasDeActa: typeof import("./calidad").esquinasDeActa;
  fmtClasif: typeof fmtClasif;
  construirActa: (
    opciones: OpcionesEscaneo,
    parcial: ParcialPipeline,
    campos: CamposActa,
  ) => Acta;
  evaluarGate: (
    score: number,
    ocrTexto: string,
    clasificacion: ClasificacionE14,
    intento: number,
    maxIntentos: number,
  ) => ResultadoGate;
  DETALLE_ILEGIBLE: typeof DETALLE_ILEGIBLE;
  DETALLE_INCOMPLETA: typeof DETALLE_INCOMPLETA;
  DETALLE_SIN_VOTOS: typeof DETALLE_SIN_VOTOS;
  DETALLE_BAJO: typeof DETALLE_BAJO;
  TECHO_SIN_SENAL: typeof TECHO_SIN_SENAL;
  TECHO_ESCUDO_FONDO: typeof TECHO_ESCUDO_FONDO;
};

/**
 * ETAPA B (plan "interfaz única E-14"): etapa MOLDE — evaluación universal
 * tras el gate. El paso recibe el CONTEXTO del acta (¿el clasificador E-14
 * reconoció el tipo?) y devuelve el resumen del motor universal; cuando el
 * documento no es un E-14 y la biblioteca lo identifica, el resumen viene
 * marcado `enrutado: true` y su veredicto SUSTITUYE al del gate E-14
 * (score/estado/banner del molde). En el resto de casos el resultado viaja
 * ADITIVO en `acta.evaluacionMolde` sin tocar score/status.
 */
export type PasosMolde = {
  evaluarMolde: (
    fotoProcesada: string,
    contexto?: { esE14: boolean },
    /** Plan primera ola (Fase 4): misma geometría sin binarizar (`fotoOcr`)
     *  para el A/B medido cuando la binarizada no produce lecturas. */
    opciones?: { fotoOriginal?: string },
  ) => Promise<import("@molde-suite/scanner-core/dominio/types").ResumenMoldeActa | null>;
};

/**
 * PLAN-AGENTE-LAYOUT F4: etapa LAYOUT — gate estructural ANTES del OCR.
 * null/ausente = molde sin layout o modelo no configurado (la etapa se salta).
 */
export type PasosEstructura = {
  evaluarEstructuraActa?: (fotoProcesada: string) => Promise<EstructuraActa | null>;
};

export type PasosPipelineL2 =
  PasosCaptura &
  PasosCalidad &
  PasosOcr &
  PasosGate &
  PasosMolde &
  PasosEstructura;

// PLAN-AGENTE-LAYOUT F4: la forma de `EstructuraActa` vive en scanner-core
// (ÚNICA fuente de verdad — `Acta.estructura` y este contrato la comparten);
// se re-exporta aquí para que los consumidores del protocolo la resuelvan
// desde el mismo módulo que `CamposActa`/`PasosEstructura`.
export type { EstructuraActa };
