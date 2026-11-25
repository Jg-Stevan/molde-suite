/**
 * RealCoreBridge — el motor REAL del repo (`src/lib/e14/core/`, SPEC-fase-logica §5).
 * FASE LÓGICA L2: fuente ARCHIVO completa —
 *   fileToCaptureDataUrl → detectDocumentEdges → processImage →
 *   evaluateQuality → requestOcr → mapeo §4 → Acta.
 * FASE LÓGICA L3 (§5 CAMARA): la fuente CÁMARA reusa EL MISMO pipeline con
 *   dos entradas —
 *   · `archivo` (foto ya capturada por ZSL / captureSmart / cámara nativa
 *     iOS — la ruta del spec §7: "la foto entra al mismo pipeline (como
 *     ARCHIVO, L2)");
 *   · `frameActual` (video con stream vivo, último recurso) → grab síncrono
 *     a canvas a RESOLUCIÓN DEL STREAM → dataUrl → pipeline. El grab debe
 *     ocurrir ANTES de que React desmonte el visor (el stream se detiene al
 *     cambiar a ANALIZANDO), por eso se hace en el arranque síncrono de
 *     escanearActa.
 * Mapeo de score §4.1 (techos por level), gate de legibilidad §4.2 (el OCR
 * manda sobre el score: ILEGIBLE calca la rechazada v2) y timeout global de
 * 15 s que RESUELVE un acta RECHAZADA (nunca congela la UI ni revienta el
 * flujo de toasts del store). Etiquetas de etapa idénticas por fuente.
 * FASE LÓGICA L5 (§7.5): `recortar` — re-ejecuta §5 sobre `fotoOriginal` con
 * el QUAD MANUAL (F5-MANUAL del core: `manual: true` respeta el quad al
 * píxel, sin refine) → fotoProcesada nueva → evaluateQuality + gate OCR →
 * acta ACTUALIZADA. El rescate D20 NO consume intento (fuente/intento/
 * maxIntentos/paginación se preservan por spread del acta de entrada).
 *
 * Lo que sigue simulado (votos/firmas/ubicación) se rellena del seed exacto
 * (§0: no se presenta como extraído).
 *
 * UX-REAL F1 (SPEC-ux-real-bn-editor §F1, D35): SIMULACIÓN también pasa por
 * este pipeline — la fuente carga el acta E-14 REAL incluida (§1) y la trata
 * EXACTAMENTE como un `archivo` de IMPORTAR (mismo File → fileToCaptureDataUrl
 * → F-IMPORT: EXIF/12MP). El mock de la fase gráfica se retiró.
 *
 * R-28 (H-18, auditoría 2026-11-16): este archivo ES la clase RealCoreBridge
 * extraída de scanner-core-bridge.ts (move-only, byte a byte) — los helpers
 * viven en ./captura, ./calidad, ./ocr, ./progreso, ./protocolo y el cuerpo
 * del recorte en ./pipeline-recorte. scanner-core-bridge.ts quedó como
 * fachada delgada que re-exporta la API pública EXACTA.
 */
import {
  detectDocumentEdgesDetail,
  ErrorRescateHeic,
  processImage,
} from "@molde-suite/scanner-core/core/image-processor";
import type { OrigenQuad } from "@molde-suite/scanner-core/core/image-processor";
import { defaultQuad } from "@molde-suite/scanner-core/core/types";
import type {
  PageFilter,
  Quad,
} from "@molde-suite/scanner-core/core/types";
import { ocrTextIsValid } from "@molde-suite/scanner-core/core/ocr";
import { statusDeScore } from "@molde-suite/scanner-core/dominio/types";
import type { Acta, ProgresoAnalisis } from "@molde-suite/scanner-core/dominio/types";
import type { E14Bridge, OpcionesEscaneo } from "@molde-suite/scanner-core/dominio/bridge";
import { tituloYUbicacionDe } from "@molde-suite/scanner-core/dominio/clasificador";
import type { ClasificacionE14 } from "@molde-suite/scanner-core/dominio/clasificador";
import { IMAGENES_SIMULADAS } from "../simulacion-imagenes";
// KIT e14-ocr-tessbest-v1 (GO-B): presupuesto del ESCANEO por tier — el
// default lo resuelve `presupuestoEscaneoEfectivo()` (adaptacion/plan.ts).
import { presupuestoEscaneoEfectivo } from "../adaptacion/plan";
import { leerFlags } from "../flags";
// FASE 0 (blueprint DLA): evaluación del molde activo tras el gate (paso inyectado).
import { evaluarMoldeEnActa } from "../molde/evaluacion";
// FASE B3 (blueprint DLA): bandas OCR dinámicas desde regiones de layout (ONNX).
import { ocrBandaDinamicaSiDisponible } from "./ocr-dinamico";
// PLAN-AGENTE-LAYOUT F4: gate estructural del molde activo (etapa LAYOUT).
import { evaluarEstructuraDelActa } from "./estructura";
// FASE F (plan post-v2.3) — el CUERPO de §5 vive en pipeline.ts (move-only) y
// recibe por inyección los helpers que este módulo comparte con el recorte.
import { correrPipelineL2 } from "../pipeline";
import { logger } from "../../logger"; // SPRINT-A A6 — console→logger (mensajes byte-idénticos)
// R-28 — piezas extraídas del antiguo scanner-core-bridge.ts.
import {
  capturarFrame,
  decodeArchivoMemo,
  entradaSimDeImagen,
  esperarWorkerCaliente,
  QUAD_IDENTITY,
  type EntradaPipeline,
} from "./captura";
import { conRampa } from "./progreso";
import {
  calidadDeActa,
  contrasteEfectivoDe,
  esquinasDeActa,
  scoreDeCalidad,
} from "./calidad";
import {
  ocrBanda,
  ocrBandaInferior,
  reconocerRapidOcr,
  reconocerRapidOcrCascada,
  reconocerRapidOcrEscalonado,
} from "./ocr";
import {
  DETALLE_ILEGIBLE,
  DETALLE_TIMEOUT,
  DETALLE_GENERICO,
  DETALLE_INCOMPLETA,
  DETALLE_SIN_VOTOS,
  DETALLE_BAJO,
  fmtClasif,
  senalDeContenido,
  type CamposActa,
  type OpcionesEscaneoConTimeout,
  type ParcialPipeline,
  type PasosPipelineL2,
  type ResultadoGate,
} from "./protocolo";
import {
  correrPipelineRecorte,
  RECORTE_TIMEOUT_MS,
  type ParcialRecorte,
} from "./pipeline-recorte";
// 7.1 (C3): techos del gate — única fuente de verdad (politica/umbrales.ts).
import {
  TECHO_SIN_SENAL,
  TECHO_ESCUDO_FONDO,
  UMBRAL_RECHAZO_SCORE,
} from "../politica/umbrales";

function dosDigitos(n: number): string {
  return String(n).padStart(2, "0");
}

export class RealCoreBridge implements E14Bridge {
  private contador = 0;

  async escanearActa(opciones: OpcionesEscaneoConTimeout): Promise<Acta> {
    // Resolución de la entrada (L3 §5 CAMARA + F1 SIMULACIÓN):
    //  · CAMARA + archivo (ZSL/captureSmart/iOS) → MISMO pipeline que ARCHIVO.
    //  · CAMARA sin archivo + frameActual (video vivo) → grab síncrono.
    //  · SIMULACIÓN sin archivo (D35) → el acta E-14 incluida, EXACTAMENTE
    //    como un archivo de IMPORTAR (la foto real del mantenedor, EXIF incluido).
    //  · Sin entrada → error explícito (el guard del store ya avisó).
    let entrada: EntradaPipeline;
    if (opciones.archivo) {
      entrada = { archivo: opciones.archivo };
    } else if (opciones.fuente === "CAMARA") {
      const video = opciones.frameActual;
      const dataUrl = video && video.readyState >= 2 && video.videoWidth
        ? capturarFrame(video)
        : null;
      if (!dataUrl) {
        throw new Error("SIN CAPTURA PARA ANALIZAR (fuente CÁMARA)");
      }
      entrada = { dataUrl };
    } else if (opciones.fuente === "SIMULACION") {
      // SIMULACIÓN = pipeline real sobre la imagen del catálogo elegida en la
      // galería del visor. EXACTAMENTE como IMPORTAR: File →
      // fileToCaptureDataUrl (F-IMPORT: EXIF/12MP) y de ahí todos los pasos
      // reales (orientación, completitud, esquinas, OCR, banda inferior y
      // gate con el score medido). Sin selección se sirve la primera imagen
      // del catálogo.
      const sim = await entradaSimDeImagen(opciones.imagenSimulada ?? IMAGENES_SIMULADAS[0].id);
      entrada = { archivo: sim.archivo };
    } else {
      throw new Error("SIN IMAGEN PARA ANALIZAR (fuente ARCHIVO)");
    }

    // Acumulador de lo que ya se tiene (el acta de timeout rellena lo que
    // alcance a conocer — p. ej. fotoOriginal si el decode alcanzó a correr).
    const parcial: ParcialPipeline = {};
    let vencido = false; // tras el timeout no se emite más progreso (§5)
    const emitir = (p: ProgresoAnalisis) => {
      if (!vencido) opciones.onProgreso?.(p);
    };

    // e67 (cambio B): reloj del rescate — ms REALES del pipeline completo
    // (el callback de rescate viaja con este dato, jamás inventado).
    const tInicioEscaneo = performance.now();
    // H4: identidad del ESCANEO (performance.now es monótono — único por
    // disparo). El watchdog y el pipeline tardío la comparten para que la
    // muestra de perf se emita una sola vez.
    parcial.escaneoId = `esc-${tInicioEscaneo}`;
    return new Promise<Acta>((resolve, reject) => {
      const timer = setTimeout(() => {
        vencido = true;
        // §5: el timeout NO rechaza la Promise — resuelve un acta RECHAZADA
        // controlada (el toast crit sale del flujo normal del store).
        const actaVencida = this.construirActa(opciones, parcial, {
          score: 0,
          scoreVisual: 0,
          status: "RECHAZADA",
          rechazo: { tipo: "ILEGIBLE", detalle: DETALLE_TIMEOUT },
        });
        // KIT e14-remediacion-movil-v1 (B1 — P0 #3): el WATCHDOG EMITE SU
        // PerfActa con `vencido: true` y los parciales ya medidos (proceso/
        // calidad hasta donde existan — parcial.msParciales). Antes, si el
        // pipeline no llegaba a su emisor final, la muestra del peor caso se
        // perdía (0/1 timeout con datos en la medición del informe).
        try {
          void import("../obs/captura")
            .then((m) =>
              m.emitirPerfDeActa({
                actaId: actaVencida.id,
                escaneoId: parcial.escaneoId,
                status: actaVencida.status,
                intento: opciones.intento,
                tiempos: parcial.msParciales ?? {},
                scoreVisual: 0,
                scoreFinal: 0,
                gate: "TIMEOUT",
                ocrValido: false,
                vencido: true,
                camino: "pipeline",
              }),
            )
            .catch(() => {});
        } catch {
          /* la emisión del watchdog jamás rompe el desenlace */
        }
        resolve(actaVencida);
        // Presupuesto OPCIONAL por llamada (OpcionesEscaneoConTimeout);
        // el default manda en el flujo individual (120_000 desde e67).
      }, opciones.timeoutMs ?? presupuestoEscaneoEfectivo());

      // FASE F (plan post-v2.3): el cuerpo de §5 vive en `pipeline.ts` y se
      // ejecuta con los pasos INYECTADOS (mismos helpers de este módulo,
      // compartidos con el recorte §7.5 — sin cambios de decisión).
      correrPipelineL2(
        opciones,
        entrada,
        parcial,
        emitir,
        this.pasosPipelineL2(),
      ).then(
        (acta) => {
          if (vencido) {
            // e67 (cambio B) — RESCATE post-timeout: el pipeline siguió
            // vivo tras el vencimiento y terminó con un desenlace REAL
            // (gate/score del pipeline, no del watchdog). Ya no se
            // descarta en silencio: viaja por onRescateTardio para que el
            // receptor valide y revierta el rechazo si es válido. Sin
            // callback → no-op, comportamiento de siempre.
            opciones.onRescateTardio?.(
              acta,
              Math.round(performance.now() - tInicioEscaneo),
            );
            return;
          }
          clearTimeout(timer);
          resolve(acta);
        },
        (error) => {
          // KIT e14-heic-tope-v1 — el rescate HEIC rechazo o agotó su plazo, la
          // trazabilidad NO puede depender de que el llamador recuerde loggear:
          // el mantenedor necesita ver en el registro que un acta murió por el
          // formato de la foto, no por el motor.
          if (error instanceof ErrorRescateHeic) {
            logger.warn("[e14] rescate HEIC topado", { mensaje: error.message });
          }
          if (vencido) {
            // e67: el pipeline TARDÍO falló — traza honesta; el acta
            // queda RECHAZADA por tiempo (correcto, caso C del kit).
            logger.info("[e14] pipeline falló tras timeout", {
              mensaje: error instanceof Error ? error.message : String(error),
            });
            return;
          }
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error("ERROR DE PIPELINE"));
        },
      );
    });
  }

  /** FASE F (plan post-v2.3) — «pasos inyectables» de §5: literal barato con
   *  las referencias de módulo + los DOS métodos de esta clase que el cuerpo
   *  movido a `pipeline.ts` consume. Mismos helpers que el recorte (§7.5). */
  private pasosPipelineL2(): PasosPipelineL2 {
    return {
      conRampa,
      decodeArchivoMemo,
      quadIdentidad: QUAD_IDENTITY,
      esperarWorkerCaliente,
      // FASE A3 (blueprint DLA): kill-switch del operador (Panel DEV).
      deskewHabilitado: leerFlags().deskew,
      calidadDeActa,
      scoreDeCalidad,
      contrasteEfectivoDe,
      senalDeContenido,
      esquinasDeActa,
      reconocerRapidOcrEscalonado,
      reconocerRapidOcrCascada,
      ocrBanda,
      ocrBandaInferior,
      fmtClasif,
      construirActa: (o, p, c) => this.construirActa(o, p, c),
      evaluarGate: (s, t, c, i, m) => this.evaluarGate(s, t, c, i, m),
      DETALLE_ILEGIBLE,
      DETALLE_INCOMPLETA,
      DETALLE_SIN_VOTOS,
      DETALLE_BAJO,
      TECHO_SIN_SENAL,
      TECHO_ESCUDO_FONDO,
      // FASE 0 (blueprint DLA): evaluación del molde tras el gate —
      // ETAPA B: reenvía el CONTEXTO E-14 al router universal (el molde
      // puede convertirse en el veredicto del acta); null honesto sin
      // moldes o con el flag apagado.
      evaluarMolde: (fotoProcesada, contexto) =>
        evaluarMoldeEnActa(fotoProcesada, contexto),
      // FASE B3 (blueprint DLA): bandas OCR dinámicas (PP-DocLayout) cuando
      // el flag + modelo están; undefined = bandas fijas de siempre.
      ocrBandaDinamica: ocrBandaDinamicaSiDisponible,
      // PLAN-AGENTE-LAYOUT F4: gate estructural ANTES del OCR (etapa LAYOUT)
      // — null honesto sin molde con layout / flag / modelo (etapa saltada).
      evaluarEstructuraActa: evaluarEstructuraDelActa,
    };
  }

  /**
   * L5 (§7.5) — RECORTE MANUAL (rescate D20): re-ejecuta el pipeline §5 sobre
   * `fotoOriginal` con el quad del editor (F5-MANUAL: `manual: true` respeta
   * el quad al píxel, sin refine) y devuelve el acta ACTUALIZADA. El acta
   * conserva IDENTIDAD (fuente/intento/maxIntentos/paginación/título…) — el
   * rescate NO es una captura nueva, no consume intento. Timeout 15 s igual
   * que escanearActa: resuelve un acta RECHAZADA ILEGIBLE controlada.
   * F4/D37: `rotacionOverride` (4º parámetro) hornea la rotación LOCAL del
   * editor — el retorno de pipelineRecorte fija `rotation: rotacionUsada`.
   * KIT e14-esquinas-suaves-v1 (Q2): `manual` (6º parámetro, default false)
   * marca el recorte del EDITOR (decisión CON VISTA — escudo-manual: la tinta
   * al filo del crop manual nunca RECHAZA). Solo lo pasa el store
   * (aplicarRecorte); mejorarResolución conserva el default (conservador).
   */
  recortar(
    acta: Acta,
    quad: Quad,
    onProgreso?: (p: ProgresoAnalisis) => void,
    rotacionOverride?: number,
    // KIT e14-quad-sobel-v1 (P1 §4-B): origen del quad cuando la detección
    // corrió (mejorarResolución). El recorte MANUAL del editor (store) no lo
    // pasa — el quad lo puso el usuario, ninguna detección corrió → undefined
    // → token ausente (n/d no miente).
    quadOrigen?: OrigenQuad | "pagina-completa" | null,
    // KIT e14-esquinas-suaves-v1 (Q2): recorte del editor = decisión CON VISTA.
    manual = false,
  ): Promise<Acta> {
    const fotoOriginal = acta.fotoOriginal;
    if (!fotoOriginal) {
      return Promise.reject(new Error("SIN FOTO ORIGINAL PARA RECORTAR"));
    }
    const rotacion = rotacionOverride ?? acta.rotation ?? 0;
    // KIT e14-recorte-manual-v1 (T1): acumulador del recorte YA HORNEADO —
    // pipelineRecorte lo llena apenas el warp completa (patrón `parcial` del
    // escaneo §5, A7); el timeout lo usa para que el acta RECHAZADA por
    // tiempo muestre EL RECORTE NUEVO del mantenedor y no la foto anterior. Si el
    // warp no alcanzó, parcial queda vacío → comportamiento actual.
    const parcial: ParcialRecorte = {};
    let vencido = false; // tras el timeout no se emite más progreso (§5)
    const emitir = (p: ProgresoAnalisis) => {
      if (!vencido) onProgreso?.(p);
    };

    return new Promise<Acta>((resolve, reject) => {
      const timer = setTimeout(() => {
        vencido = true;
        // §5: el timeout NO rechaza la Promise — resuelve el acta RECHAZADA
        // controlada (el toast sale del flujo normal del store).
        // KIT e14-recorte-manual-v1 (T1): `...parcial` trae el recorte ya
        // horneado si el warp alcanzó a correr — el mantenedor ve SU recorte
        // (puede re-aplicar/reintentar), no la foto anterior. Gate y score
        // INTACTOS: sigue RECHAZADA ILEGIBLE por tiempo.
        resolve({
          ...acta,
          ...parcial,
          score: 0,
          status: "RECHAZADA",
          rechazo: { tipo: "ILEGIBLE", detalle: DETALLE_TIMEOUT },
          // FIX (auditoría 2-a #8): el invariante del gate (RECHAZADA ⇒
          // clasificación descartada) también en el timeout del recorte —
          // el spread conservaba una clasificación AUTO previa (p. ej. de
          // un acta ADVERTENCIA que se re-recortaba) y el título/historial
          // mostraban mesa/tipo/página de una identificación que el propio
          // gate acaba de descartar (undefined = sin clasificación, mismo
          // convenio del contrato Acta).
          clasificacion: undefined,
        });
      }, RECORTE_TIMEOUT_MS);

      void correrPipelineRecorte(
        {
          evaluarGate: (s, t, c, i, m) => this.evaluarGate(s, t, c, i, m),
        },
        acta,
        fotoOriginal,
        quad,
        rotacion,
        emitir,
        quadOrigen,
        manual,
        parcial,
      ).then(
        (actaNueva) => {
          if (vencido) return; // ya resolvió el timeout: el resultado se descarta
          clearTimeout(timer);
          resolve(actaNueva);
        },
        (error) => {
          if (vencido) return;
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error("ERROR DE PIPELINE"));
        },
      );
    });
  }

  /**
   * KIT camara-visor-v1 (G3 — upgrade silencioso del lab L1789-1842):
   * RE-PROCESA el acta con una foto NUEVA a máxima resolución (la toma
   * full-res del sensor que aterrizó en segundo plano tras el disparo
   * rápido por escalera). REUTILIZA el pipeline existente (mismo patrón de
   * `recortar`: re-proceso sin consumir intento — el acta conserva
   * identidad de captura: fuente/intento/maxIntentos/paginación) con dos
   * diferencias obligatorias frente al recorte: (1) el QUAD se RE-DETECTA
   * sobre la foto nueva (los quads son normalizados 0-1 y el aspecto del
   * sensor 4:3 ≠ preview 16:9 — re-usar el quad del preview desplazaría el
   * warp; el lab hace exactamente esto con applyAutoQuad) y (2) la
   * `fotoOriginal` del acta queda REEMPLAZADA por la nueva. El gate se
   * re-evalúa COMPLETO (pipelineRecorte: completitud + marcadores + OCR +
   * clasificación — helper único §4.4).
   */
  async mejorarResolucion(
    acta: Acta,
    fotoNueva: string,
    onProgreso?: (p: ProgresoAnalisis) => void,
  ): Promise<Acta> {
    // 1) Detección del quad sobre la foto NUEVA (worker OpenCV → fallback
    //    Sobel del core — MISMA vía del pipeline de escaneo). Si no detecta
    //    (imagen sin bordes), quad identidad: la foto entera es el acta —
    //    degradación honesta (§0: sin datos reales no se inventa).
    //    KIT e14-quad-sobel-v1 (P1 §4-B): el origen viaja con el quad — y en
    //    el catch el origen es null (ni siquiera corrió el Sobel — n/d no
    //    miente, misma filosofía del T-A).
    let quad: Quad;
    let quadOrigen: OrigenQuad | "pagina-completa" | null = null;
    try {
      const detalle = await detectDocumentEdgesDetail(fotoNueva);
      quad = detalle.quad;
      quadOrigen = detalle.origen;
    } catch {
      // sin detección sobre la foto nueva: quad identidad — la foto entera es el acta (degradación honesta)
      quad = defaultQuad();
    }
    // 2) Pipeline de RECORTE existente sobre la foto nueva (calidad + OCR +
    //    gate completo, timeout 15 s igual que recortar). El acta conservada
    //    es la ORIGINAL del disparo (identidad); su fotoOriginal pasa a ser
    //    la full-res que aterrizó.
    const actaBase: Acta = { ...acta, fotoOriginal: fotoNueva };
    return this.recortar(actaBase, quad, onProgreso, undefined, quadOrigen);
  }

  /**
   * Gate §4.2 REVISADO (SPEC-cabecera-clasificacion §4 + §7.2 SPEC-rediseno-
   * revision) — helper ÚNICO para AMBOS pipelines (escaneo y recorte, §4.4):
   *  1. RECHAZADA SOLO por CALIDAD (score < UMBRAL_RECHAZO_SCORE=6.5 vía
   *     statusDeScore, §4.1) —
   *     la tarjeta «ACTA NO RECONOCIDA» queda reservada a este caso. Al
   *     AGOTAR intentos la contingencia es AUTOMÁTICA (C4, sin botón manual).
   *  2. Calidad suficiente + clasificación AUTO → status por score (OPTIMA/
   *     ADVERTENCIA) como hoy + clasificación persistida (Fase B al envío).
   *  3. Calidad suficiente + SUGERIDA/MANUAL (incluye OCR sin texto, §4.3) →
   *     EN_REVISION_HUMANA: la pantalla distingue por intento (§7.3 — «repetir-
   *     primero» antes de agotar; contingencia con panel al agotar).
   * PATRON_CABECERA ya NO decide el estado (§4.5) — solo traza en el log.
   * §X (SPEC-score-legible): la clasificación llega calculada desde el
   * pipeline — alimenta el score (piso por identificación).
   */
  private evaluarGate(
    score: number,
    ocrTexto: string,
    clasificacion: ClasificacionE14,
    intento: number,
    maxIntentos: number,
  ): ResultadoGate {
    if (score >= UMBRAL_RECHAZO_SCORE) {
      if (clasificacion.nivel === "AUTO") {
        return { status: statusDeScore(score), rechazo: null, clasificacion };
      }
      // SUGERIDA/MANUAL: la CONTINGENCIA (panel) llega SOLO al agotar intentos;
      // antes, el acta viaja como EN_REVISION_HUMANA «repetir-primero» (§7.3 —
      // la pantalla distingue por intento; el estado no cambia).
      return { status: "EN_REVISION_HUMANA", rechazo: null, clasificacion };
    }
    // score < 6.5 — rechazo por CALIDAD. Al AGOTAR intentos: contingencia
    // automática (C4) — el sistema escala solo, sin botón manual.
    if (intento >= maxIntentos) {
      return {
        status: "EN_REVISION_HUMANA",
        rechazo: ocrTextIsValid(ocrTexto)
          ? { tipo: "GENERICO", detalle: DETALLE_GENERICO }
          : { tipo: "ILEGIBLE", detalle: DETALLE_ILEGIBLE },
        clasificacion: null,
      };
    }
    return {
      status: "RECHAZADA",
      rechazo: ocrTextIsValid(ocrTexto)
        ? { tipo: "GENERICO", detalle: DETALLE_GENERICO }
        : { tipo: "ILEGIBLE", detalle: DETALLE_ILEGIBLE },
      clasificacion: null,
    };
  }

  /**
   * F2 (§F2.2, D36) — FILTRO: re-procesa la foto con el filtro elegido,
   * IGUAL que setFilterOnPage del core (apps/scanner-lab/src/components/
   * scanner/…/store.ts L644-669): SOLO processImage — sin re-OCR, sin
   * re-calidad (el gate ya resolvió). Devuelve el acta con fotoProcesada y
   * filtro actualizados. Sin timeout: es un ÚNICO processImage con fallback
   * canvas (misma exposición al cuelgue que tiene el lab aquí — documentado
   * en worklog como ADAPTACIÓN de la opción «timeout 15 s» del spec).
   */
  async revelar(acta: Acta, filtro: PageFilter): Promise<Acta> {
    const fotoOriginal = acta.fotoOriginal;
    if (!fotoOriginal) {
      throw new Error("SIN FOTO ORIGINAL PARA FILTRAR");
    }
    // Fuente: apps/scanner-lab/…/store.ts L644-669 (setFilterOnPage) —
    // processImage(original, quad, filter, rotation, { manual }).
    const resultado = await processImage(
      fotoOriginal,
      acta.quadDetectado ?? defaultQuad(),
      filtro,
      acta.rotation ?? 0,
      { manual: true },
    );
    // Guarda §D4: salida vacía de processImage jamás llega al acta como
    // fotoProcesada:'' (el catch de cambiarFiltro conserva la foto anterior).
    if (!resultado.processed) {
      throw new Error('PROCESADO DE IMAGEN SIN SALIDA (data URL vacío)');
    }
    return { ...acta, fotoProcesada: resultado.processed, filtro };
  }

  /**
   * F-OCR del lab (EditorView.tsx L1360-1395): corre requestOcr sobre la
   * imagen PROCESADA del acta y devuelve el texto crudo.
   * KIT e14-ocr-lee-original-v1 (PROD-1 §4.3): coherencia con la regla del
   * producto — el re-OCR manual del editor aplica la MISMA regla: lee el
   * RECORTE SIN filtro ("original", el crudo del warp) cuando hay
   * fotoOriginal + quadDetectado; fallback a la procesada (comportamiento de
   * hoy). NOTA (documentada): el texto del editor puede diferir del histórico
   * — ES la regla nueva del producto, NO un bug (en impresas con sello el
   * crudo colapsa chars — §1.2 del kit, esperado).
   * ADAPTACIÓN documentada: el lab elige imagen con prioridad
   * `preview ?? procesada-fresca ?? original` (L1373-1376) porque tiene
   * previewCache; en e14 la procesada SIEMPRE está fresca (todo cambio pasa
   * por el pipeline) → se usa fotoProcesada directa. El guard `previewLoading`
   * (L1364-1370) NO aplica (no hay preview en e14) → omitido. Sin timeout
   * extra (igual que el lab L1379 — requestOcr se gobierna solo).
   */
  async reconocerTexto(acta: Acta): Promise<string> {
    const fotoProcesada = acta.fotoProcesada;
    if (!fotoProcesada) {
      throw new Error("SIN FOTO PROCESADA PARA RECONOCER TEXTO");
    }
    // PROD-1 (§4.3): regla del producto en el re-OCR del editor — recorte
    // "original" con el quad horneado (misma convención POST-warp); el catch
    // cae al fallback de abajo (comportamiento de hoy, §5 del kit).
    if (acta.fotoOriginal && acta.quadDetectado) {
      try {
        const r = await processImage(
          acta.fotoOriginal,
          acta.quadDetectado,
          "original",
          acta.rotation ?? 0,
        );
        // Guarda §D4: salida vacía → mismo trato que un fallo de processImage
        // (cae al fallback de abajo con la fotoProcesada del acta).
        if (!r.processed) {
          throw new Error('PROCESADO DE IMAGEN SIN SALIDA (data URL vacío)');
        }
        // PROD-2 (§2-C2): el re-OCR del editor pasa por el ÚNICO motor.
        return reconocerRapidOcr(r.processed);
      } catch {
        /* cae al fallback de abajo */
      }
    }
    return reconocerRapidOcr(fotoProcesada); // comportamiento de hoy (fallback)
  }

  /** Acta final: seed SOLO cuando la clasificación no está resuelta (§1) + campos reales §3.1. */
  private construirActa(
    opciones: OpcionesEscaneo,
    parcial: ParcialPipeline,
    campos: CamposActa,
  ): Acta {
    const numeroMesa = opciones.objetivo
      ? opciones.objetivo.mesaId.replace(/\D/g, "").padStart(3, "0")
      : "001";
    this.contador += 1;

    // §1.2 (SPEC-titulo-ubicacion): clasificación AUTO → el acta nace con
    // título/ubicación REALES. KIT e14-sin-relleno-v1 + auditoría 2026-11-11
    // (hallazgos #2 y #3): NINGÚN campo de pantalla viene ya del acta de
    // demostración — sin clasificación el acta no muestra candidaturas con
    // votos, nombres de jurados ni un barcode inventado; el tipo se deriva de
    // la clasificación.
    const titUbi = tituloYUbicacionDe(campos.clasificacion ?? null);
    const tipoHonesto =
      campos.clasificacion?.tipo === "TRANSMISION"
        ? "SENADO DE LA REPÚBLICA"
        : campos.clasificacion?.tipo === "DELEGADOS"
          ? "CÓNSUL/EMBAJADOR"
          : "SIN CLASIFICAR";
    // ETAPA B (enrutamiento universal): acta reconocida por un MOLDE de la
    // biblioteca → el banner/tipo llevan el NOMBRE DEL DOCUMENTO (p. ej.
    // «RECIBO DE LUZ»), no «DOCUMENTO SIN IDENTIFICAR». La ubicación no
    // existe en documentos no electorales: honesta con «—».
    const enrutado = campos.evaluacionMolde?.enrutado === true;
    const nombreMolde = enrutado
      ? (campos.evaluacionMolde?.moldeNombre ?? "DOCUMENTO").toUpperCase()
      : null;
    return {
      id: `acta-${Date.now()}-${this.contador}`,
      titulo: nombreMolde ?? (titUbi?.titulo ?? "DOCUMENTO SIN IDENTIFICAR"),
      ubicacion: titUbi?.ubicacion ?? {
        departamento: "—",
        municipio: "—",
        zona: "—",
        puesto: "—",
        mesa: numeroMesa,
      },
      tipo: nombreMolde ?? tipoHonesto,
      // §6: página REAL del «Ver/Pag/de» cuando la clasificación la leyó.
      // KIT actas-vivas-paginas-v1 (FASE B): la página viaja COMO VENGA de
      // la clasificación (null incluido — DESCONOCIDA: el chip muestra
      // «PÁG - DE -» y el hueco va al primer libre; el default P1 mintió
      // con la pág 2 del Frankfurt, bug del mantenedor 16-oct). Sin
      // clasificación → objetivo seed (hoy).
      pagina: campos.clasificacion
        ? campos.clasificacion.pagina
        : {
            index: opciones.objetivo?.pagina ?? 1,
            total: 2,
          },
      candidatos: [],
      firmas: [],
      score: campos.score,
      scoreVisual: campos.scoreVisual,
      status: campos.status,
      rechazo: campos.rechazo,
      intento: opciones.intento ?? 1,
      maxIntentos: opciones.maxIntentos ?? 3,

      // ----- Campos reales (§3.1) -----
      fuente: opciones.fuente,
      fotoOriginal: parcial.fotoOriginal,
      fotoProcesada: campos.fotoProcesada,
      procesadaVacia: campos.procesadaVacia,
      recortada: campos.recortada ?? false,
      recorteLado: campos.recorteLado ?? null,
      ocrTexto: campos.ocrTexto,
      metricas: campos.calidad
        ? {
            sharpness: campos.calidad.sharpness,
            brightness: campos.calidad.brightness,
            contrast: campos.calidad.contrast,
          }
        : undefined,
      motor: campos.motor ?? "canvas",
      quadDetectado: campos.quadDetectado,
      rotation: 0,
      // F2/D36: default del producto (types.ts L50 del core) — toda captura
      // nace en B/N adaptativo (Fuente: CameraView.tsx L602-604 del lab).
      // §D8.3 (Rev. 3): EXCEPTO los assets sim as-is, que nacen "original".
      filtro: campos.filtro ?? ("bw" as PageFilter),
      // SPEC-cabecera-clasificacion §6: clasificación de cabecera (AUTO →
      // archivada en su mesa al envío; SUGERIDA/MANUAL → panel de corrección §5).
      clasificacion: campos.clasificacion ?? undefined,
      // FASE 0 (blueprint DLA): veredicto por molde (ADITIVO — sin score/status).
      evaluacionMolde: campos.evaluacionMolde ?? null,
      // PLAN-AGENTE-LAYOUT F4: veredicto del gate estructural (ADITIVO —
      // null = etapa saltada; el rechazo temprano lo lleva RECHAZADA).
      estructura: campos.estructura ?? null,
      // e64-qr T-2.1 — señal de la CAPA 0 QR de cámara (ADITIVA AL FINAL,
      // contrato D57): qrCam definido = el decodificador corrió ("leido" con
      // payload / "sin-payload" con null); undefined (timeout — el
      // instrumento no terminó) = los campos viajan AUSENTES (jamás
      // inventar). SOLO presencia — jamás contenido (red line 10).
      ...(parcial.qrCam
        ? { qrPayload: parcial.qrCam.payload, qrEstado: "leido" as const }
        : parcial.qrCam !== undefined
          ? { qrEstado: "sin-payload" as const }
          : {}),
    };
  }

  horaEnvio(): string {
    const d = new Date();
    return `${dosDigitos(d.getHours())}:${dosDigitos(d.getMinutes())}:${dosDigitos(d.getSeconds())}`;
  }

  horaHistorial(): string {
    const d = new Date();
    return `${dosDigitos(d.getHours())}:${dosDigitos(d.getMinutes())}`;
  }
}
