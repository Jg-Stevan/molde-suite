// OCR del pipeline — los MOTORES como digielect14 (port move-only de
// apps/digielect14/src/lib/e14/bridge/ocr.ts):
//   · RapidOCR PP-OCRv4 (paquete, singleton de sesión ÚNICO) como motor
//     primario — sin fallback de motor (texto vacío → el gate decide).
//   · OCR ESCALONADO (KIT e14-ocr-escalonado-v1): 1.ª pasada det 1280 →
//     si la lectura sale débil, 2.ª pasada 1920 (o ROI-cabecera por tier,
//     KIT gama-baja-20s) y QUEDARSE CON EL MEJOR (anclas → conf).
//   · CASCADA (KIT e14-ocr-cascada-v1): intento 1 (Tesseract best, D88 —
//     o RapidOCR con `ocrPrimeraPasadaRapida`) → GATE → core RapidOCR →
//     rescate ROI top/bottom → rescate final de otro motor.
//   · Bandas dirigidas (sup/inf) con el MISMO motor.
// La IDENTIFICACIÓN del documento es la de Tamiz (universal): el GATE entre
// motores usa la señal de lectura FUERTE como AUTO — ningún umbral nuevo.

import {
  DET_CAP_PROD,
  DET_CAP_RAPIDO,
  rapidOcrInit,
  rapidOcrReconocer,
  type RapidOcrLinea,
} from '@molde-suite/scanner-core/ocr/rapidocr';
import {
  anclasDe,
  elegirMejor,
  necesitaSegunda,
  rescateAporta,
  type PasadaOcr,
} from '@molde-suite/scanner-core/dominio/ocr-escalonado';
import {
  correrCascadaOcr,
  ROI_FRACCIONES,
  type DepsOcrCascada,
  type PasadaCascada,
} from '@molde-suite/scanner-core/orquestacion/cascada';
import { senalDeLectura } from '@molde-suite/scanner-core/dominio/senal-lectura';
import { canvasCon, loadImageMemo } from '@molde-suite/scanner-core/dominio/image-utils';
import { logger } from '../../logger';
import { leerFlags } from '../flags';
import { planOcrAdaptativo, presupuestoEscaneoEfectivo } from '../adaptacion/plan';
// Tesseract best (intento 1 / rescate de la cascada): el singleton spa del
// producto — el texto de ESTE motor vale SOLO por el GATE (§1 del kit).
import { getWorker, marcarReconocimientoTesseract } from './ocr-worker';
import { esFalloMemoriaMotor } from '../errores';

/** Calidad JPEG de los crops de OCR (misma que digielect: revisión 0.92). */
const CALIDAD_JPEG_OCR = 0.92;

/** Config del OCR por llamada — el pipeline la arma con SU presupuesto
 *  (mismo contrato de digielect14). Ausente = presupuesto por tier. */
export interface CfgOcr {
  /** Fuente SIMULACION: flujo de hoy a 1920, una pasada, 0 trazas. */
  simular?: boolean;
  /** Presupuesto total del pipeline (ms) — timeout EXISTENTE (§3). */
  presupuestoMs?: number;
  /** performance.now del INICIO del pipeline (base del presupuesto). */
  inicioMs?: number;
  /** La orientación ya está decidida (brújula QR): omite el sondeo cls. */
  orientacionDecidida?: boolean;
  /** Rechazo temprano: el veredicto ya está bloqueado ⇒ ninguna escalada. */
  corteIncompleta?: boolean;
}

function cfgEfectiva(cfg?: CfgOcr): Required<CfgOcr> {
  return {
    simular: cfg?.simular === true,
    presupuestoMs: cfg?.presupuestoMs ?? presupuestoEscaneoEfectivo(),
    inicioMs: cfg?.inicioMs ?? performance.now(),
    orientacionDecidida: cfg?.orientacionDecidida === true,
    corteIncompleta: cfg?.corteIncompleta === true,
  };
}

/** Motor de producción: RapidOCR PP-OCRv4 sobre el recorte original.
 *  Mismo contrato histórico: texto + progreso 0→1. Sin fallback de motor:
 *  el fallo sigue el camino controlado (texto vacío → el gate decide). */
export async function reconocerRapidOcr(
  dataUrl: string,
  onProgress?: (p: number) => void,
): Promise<string> {
  const rt = await rapidOcrInit();
  const r = await rapidOcrReconocer(rt, dataUrl, onProgress);
  return r.texto;
}

interface PasadaEscalonada extends PasadaOcr {
  detMs: number;
  recMs: number;
  cap: number;
}

/**
 * OCR principal de un pipeline — KIT e14-ocr-escalonado-v1 (§2): 1.ª pasada
 * det 1280 → si la lectura sale débil, 2.ª pasada 1920 (o ROI-cabecera si el
 * plan del tier lo pide) y QUEDARSE CON EL MEJOR (anclas, luego conf — NUNCA
 * automáticamente la 2.ª). El timeout EXISTENTE del pipeline manda: la 2.ª
 * pasada solo se ABRE si su coste estimado cabe (k·ms1 — A1 del kit
 * remediación: 2.5 completo · 1.2 ROI-cabecera, margen 8 s).
 */
export async function reconocerRapidOcrEscalonado(
  fotoOcr: string,
  onProgress?: (p: number) => void,
  cfg?: CfgOcr,
): Promise<string> {
  const c = cfgEfectiva(cfg);
  const rt = await rapidOcrInit();
  const omitirCls = c.orientacionDecidida;
  if (c.simular) {
    // SIM: flujo de hoy (det 1920, una pasada, 0 trazas).
    const r = await rapidOcrReconocer(rt, fotoOcr, onProgress);
    return r.texto;
  }
  // 1.ª pasada — det cap RÁPIDO (1280).
  const t1 = performance.now();
  const r1 = await rapidOcrReconocer(rt, fotoOcr, onProgress, {
    detCap: DET_CAP_RAPIDO,
    omitirCls,
    sinRescateBordes: c.corteIncompleta,
  });
  const ms1 = Math.round(performance.now() - t1);
  const senal1 = senalDeLectura(r1.texto);
  // Perillas de la escalada: plan por tier + overrides del operador.
  const planOcr = planOcrAdaptativo();
  const f = leerFlags();
  const modoReOcr =
    f.ocrReOcrRoi || (planOcr.adaptado && planOcr.ocrReOcrModo === 'roi-cabecera')
      ? 'roi-cabecera'
      : 'completo';
  const presupuestoSegunda =
    f.ocrSegundaPresupuestoMs != null && f.ocrSegundaPresupuestoMs > 0
      ? Math.min(c.presupuestoMs, f.ocrSegundaPresupuestoMs)
      : f.ocrSegundaTopeMs > 0
        ? Math.min(c.presupuestoMs, f.ocrSegundaTopeMs)
        : planOcr.adaptado && planOcr.ocrSegundaPresupuestoMs != null
          ? Math.min(c.presupuestoMs, planOcr.ocrSegundaPresupuestoMs)
          : c.presupuestoMs;
  const K_SEGUNDA_COMPLETO = 2.5; // re-OCR 1920 ≈ 2,5× la 1.ª pasada
  const K_SEGUNDA_ROI = 1.2; // ROI cabecera ≈ 1,0-1,2× la 1.ª pasada
  const MARGEN_SEGUNDA_MS = 8_000;
  const transcurridoAlDecidir = performance.now() - c.inicioMs;
  const kSegunda = modoReOcr === 'roi-cabecera' ? K_SEGUNDA_ROI : K_SEGUNDA_COMPLETO;
  const costeEstimadoSegunda = Math.round(ms1 * kSegunda);
  const tocaSegunda =
    necesitaSegunda(r1.texto) &&
    !c.corteIncompleta &&
    transcurridoAlDecidir < presupuestoSegunda &&
    costeEstimadoSegunda < c.presupuestoMs - transcurridoAlDecidir - MARGEN_SEGUNDA_MS;
  let elegido: PasadaEscalonada = {
    texto: r1.texto,
    conf: r1.confMedia,
    detMs: r1.msDet,
    recMs: r1.msRec,
    cap: DET_CAP_RAPIDO,
  };
  let ms2: number | null = null;
  let anclas2: number | null = null;
  if (tocaSegunda) {
    if (modoReOcr === 'roi-cabecera') {
      // Rescate ROI CABECERA: franja top 0-25% re-escalada a cap 1920
      // (MISMO helper y fracciones de la cascada). El candidato compuesto
      // se adopta SOLO si AÑADE anclas (`rescateAporta`); jamás tumba.
      const tR = performance.now();
      const roiUrl = await recortarRoiDataUrl(
        fotoOcr,
        ROI_FRACCIONES.top[0],
        ROI_FRACCIONES.top[1],
      );
      let msRoi = Math.round(performance.now() - tR);
      let adoptado = 0;
      if (roiUrl) {
        try {
          const rRoi = await rapidOcrReconocer(rt, roiUrl, onProgress);
          msRoi = Math.round(performance.now() - tR);
          const texto2 =
            rRoi.texto.trim().length > 0
              ? rRoi.texto.trim() + '\n' + r1.texto.trim()
              : r1.texto;
          anclas2 = anclasDe(texto2);
          if (rescateAporta(r1.texto, texto2)) {
            elegido = {
              texto: texto2,
              conf: r1.confMedia, // conf de la pasada BASE — conservador
              detMs: r1.msDet,
              recMs: r1.msRec,
              cap: DET_CAP_RAPIDO,
            };
            adoptado = 1;
          }
        } catch {
          /* fallo del rescate → r1 queda como está (jamás tumba) */
        }
      }
      ms2 = msRoi;
      logger.info(
        `[e14] ocr-rescate-cabecera y0=${ROI_FRACCIONES.top[0]} y1=${ROI_FRACCIONES.top[1]} ` +
          `ms=${msRoi} anclas1=${anclasDe(r1.texto)} anclas2=${anclas2 ?? '-'} adoptado=${adoptado}`,
      );
    } else {
      // 2.ª pasada — det cap PROD (1920); MISMO emit de progreso. Elegir el
      // MEJOR — NUNCA automáticamente la 2.ª.
      // F4: fallback det1920→1280 ante bad_alloc/presión de memoria.
      const t2 = performance.now();
      try {
        const r2 = await rapidOcrReconocer(rt, fotoOcr, onProgress, {
          detCap: DET_CAP_PROD,
          omitirCls,
        });
        ms2 = Math.round(performance.now() - t2);
        anclas2 = anclasDe(r2.texto);
        elegido = elegirMejor(
          { texto: r1.texto, conf: r1.confMedia, detMs: r1.msDet, recMs: r1.msRec, cap: DET_CAP_RAPIDO },
          { texto: r2.texto, conf: r2.confMedia, detMs: r2.msDet, recMs: r2.msRec, cap: DET_CAP_PROD },
        );
      } catch (e2) {
        if (leerFlags().ocrFallbackBadAlloc && esFalloMemoriaMotor(e2)) {
          logger.warn('[e14] escalada fallback 1280 por presión de memoria', {
            motivo: e2 instanceof Error ? e2.message : String(e2),
          });
          try {
            const r2b = await rapidOcrReconocer(rt, fotoOcr, onProgress, {
              detCap: DET_CAP_RAPIDO,
              omitirCls,
            });
            ms2 = Math.round(performance.now() - t2);
            anclas2 = anclasDe(r2b.texto);
            elegido = elegirMejor(
              { texto: r1.texto, conf: r1.confMedia, detMs: r1.msDet, recMs: r1.msRec, cap: DET_CAP_RAPIDO },
              { texto: r2b.texto, conf: r2b.confMedia, detMs: r2b.msDet, recMs: r2b.msRec, cap: DET_CAP_RAPIDO },
            );
          } catch {
            /* fallback también cae → r1 queda (jamás tumba) */
          }
        }
        /* otro error → r1 queda como está (mismo patrón que ROI-cabecera) */
      }
    }
  }
  logger.info(
    `[e14] ocr-escalonado pasada1=${DET_CAP_RAPIDO} lectura=${senal1.nivel} ` +
      `reocr=${ms2 != null ? 1 : 0} elegido=${elegido.cap} anclas1=${anclasDe(r1.texto)}` +
      (ms2 != null ? ` anclas2=${anclas2} ms1=${ms1} ms2=${ms2}` : ` ms1=${ms1}`) +
      (c.corteIncompleta ? ' corte=1' : '') +
      ` ventana=${presupuestoSegunda} k=${kSegunda} est=${costeEstimadoSegunda} abre=${tocaSegunda ? 1 : 0}`,
  );
  return elegido.texto;
}

/**
 * Recorte de UN ROI del warp para el rescate OCR: franja horizontal
 * [y0Frac, y1Frac] re-escalada a cap DET_CAP_PROD (1920) → dataUrl JPEG
 * 0.92. SOLO corre tras el warp full-res (entrada fotoOcr). JAMÁS lanza:
 * null = el ROI se descarta y la cascada continúa.
 */
async function recortarRoiDataUrl(
  foto: string,
  y0Frac: number,
  y1Frac: number,
): Promise<string | null> {
  try {
    const img = await loadImageMemo(foto);
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    if (!W || !H) return null;
    const y0 = Math.round(Math.max(0, Math.min(1, y0Frac)) * H);
    const y1 = Math.round(Math.max(0, Math.min(1, y1Frac)) * H);
    const hSrc = Math.max(1, y1 - y0);
    const escala = Math.min(1, DET_CAP_PROD / Math.max(W, hSrc));
    const wDst = Math.max(1, Math.round(W * escala));
    const hDst = Math.max(1, Math.round(hSrc * escala));
    const canvas = canvasCon(wDst, hDst);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, y0, W, hSrc, 0, 0, wDst, hDst);
    return canvas.toDataURL('image/jpeg', CALIDAD_JPEG_OCR);
  } catch {
    return null; // jamás tumba — el rescate se descarta
  }
}

/** Pasada Tesseract best (worker spa del producto) — texto SOLO-vía-GATE.
 *  null = no disponible (sin presupuesto/fallo/sin texto): el caller sigue
 *  con lo que tenga; jamás tumba el pipeline. */
async function tessPasadaParaGate(
  foto: string,
  cfg: Required<CfgOcr>,
): Promise<PasadaCascada | null> {
  const restante = cfg.presupuestoMs - (performance.now() - cfg.inicioMs);
  if (restante < 20_000) {
    logger.info(`[e14] tess-best omitido (restante ${Math.round(restante)}ms < 20000)`);
    return null;
  }
  try {
    const worker = await getWorker();
    marcarReconocimientoTesseract(1);
    try {
      const ret = await worker.recognize(foto);
      const texto = (ret.data.text ?? '').trim();
      if (!texto) throw new Error('tess-best: sin texto');
      const confRaw = ret.data.confidence;
      const conf = typeof confRaw === 'number' && confRaw >= 0 ? confRaw / 100 : 0;
      logger.info(`[e14] tess-best ok conf=${conf.toFixed(2)} chars=${texto.length}`);
      return { texto, conf, cap: 'tess', motor: 'tesseract' };
    } finally {
      marcarReconocimientoTesseract(-1);
    }
  } catch (e) {
    logger.warn('[e14] tess-best no disponible', {
      motivo: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/** GATE entre motores de la cascada — identificación UNIVERSAL de Tamiz:
 *  la lectura FUERTE (misma señal del score, senal-lectura) equivale al AUTO
 *  electoral de digielect. MEDIA/DEBIL escalan la cascada. */
function clasificarNivelUniversal(texto: string): 'AUTO' | 'SUGERIDA' | 'MANUAL' {
  const nivel = senalDeLectura(texto).nivel;
  return nivel === 'FUERTE' ? 'AUTO' : nivel === 'MEDIA' ? 'SUGERIDA' : 'MANUAL';
}

/**
 * La CASCADA en el pipeline (solo con `ocrCascada` ON — el pipeline decide):
 *   intento 1 (TESSERACT BEST por defecto — D88; RapidOCR 1280 con
 *   `ocrPrimeraPasadaRapida` o rechazo temprano) → GATE (lectura FUERTE)
 *   ⇒ listo; sin AUTO ⇒ core RapidOCR 1280 → necesitaSegunda → 1920 →
 *   elegirMejor; si débil y sin AUTO ⇒ rescate ROI top/bottom (cap 1920) →
 *   elegirMejor solo entre pasadas RapidOCR; rescate final Tesseract cuando
 *   el intento 1 fue la pasada rápida (entre motores decidió el GATE).
 */
export async function reconocerRapidOcrCascada(
  fotoOcr: string,
  onProgress?: (p: number) => void,
  cfg?: CfgOcr,
): Promise<{ texto: string; lineasRapid?: RapidOcrLinea[] }> {
  const c = cfgEfectiva(cfg);
  const rt = await rapidOcrInit();
  const omitirCls = c.orientacionDecidida;
  const rc = { detCap: DET_CAP_RAPIDO, omitirCls, sinRescateBordes: c.corteIncompleta };
  const aPasada = (
    r: Awaited<ReturnType<typeof rapidOcrReconocer>>,
    cap: number | 'roi',
  ): PasadaCascada => ({
    texto: r.texto,
    conf: r.confMedia,
    cap,
    msDet: r.msDet,
    msRec: r.msRec,
    nBoxes: r.nBoxes,
    nLineas: r.lineas.length,
    msRunRec: r.msRunRec,
    motor: 'rapidocr',
    lineasRapid: r.lineas,
  });
  const rapid = (foto: string, cap: number): Promise<PasadaCascada> =>
    rapidOcrReconocer(rt, foto, onProgress, { ...rc, detCap: cap }).then((r) => aPasada(r, cap));
  const rapid1280 = (foto: string): Promise<PasadaCascada> => rapid(foto, DET_CAP_RAPIDO);
  const rapidaPrimero = leerFlags().ocrPrimeraPasadaRapida === true;
  const deps: DepsOcrCascada = {
    intento1: async (foto) => {
      // D88: por defecto el intento 1 es Tesseract best y la pasada rápida
      // de RapidOCR queda de respaldo (y de rescate final más abajo).
      // RECHAZO TEMPRANO: no se paga Tess para un acta ya condenada.
      if (rapidaPrimero || c.corteIncompleta) return rapid1280(foto);
      const p = await tessPasadaParaGate(foto, c);
      return p ?? rapid1280(foto);
    },
    mismoMotorIntento1: rapidaPrimero,
    ocr1280: rapid1280,
    ocr1920: (foto) => rapid(foto, DET_CAP_PROD),
    ocrRoi: (roiDataUrl) => rapid(roiDataUrl, DET_CAP_PROD),
    recortarRoi: recortarRoiDataUrl,
    clasificarNivel: clasificarNivelUniversal,
    rescateMotor: rapidaPrimero ? (foto) => tessPasadaParaGate(foto, c) : undefined,
    presupuestoRestanteMs: () => c.presupuestoMs - (performance.now() - c.inicioMs),
    presupuestoVencido: () =>
      c.corteIncompleta || performance.now() - c.inicioMs >= c.presupuestoMs,
  };
  const s = await correrCascadaOcr(fotoOcr, deps);
  const ms1 = s.ms1280 != null ? s.ms1280 + s.msIntento1 : s.msIntento1;
  logger.info(
    `[e14] ocr-cascada intento1=${s.motorIntento1 === 'tesseract' ? 'tess-best' : DET_CAP_RAPIDO} ` +
      `gate1=${s.paso === 'intento1' ? 'AUTO' : 'NO'} elegido=${s.elegidoCap} ` +
      `rescate=${s.rescate ? 1 : 0} ms1=${ms1}` +
      (s.ms1920 != null ? ` ms2=${s.ms1920}` : ' ms2=-') +
      (s.msRoi != null ? ` msRoi=${s.msRoi}` : ' msRoi=-') +
      (s.msMotor != null ? ` msMotor=${s.msMotor}` : ' msMotor=-') +
      (c.corteIncompleta ? ' corte=1' : ''),
  );
  return { texto: s.texto, lineasRapid: s.lineasRapid as RapidOcrLinea[] | undefined };
}

/** OCR de la banda superior (cabecera/título) — franja 16% universal ya
 *  aprobada; el MOTOR es el de producción (RapidOCR), con la pasada rápida
 *  (`ocrBandaRapida`, default ON): texto GRANDE, sin cls ni rescate. */
export async function ocrBanda(dataUrl: string): Promise<string> {
  try {
    const img = await loadImageMemo(dataUrl);
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    if (!W || !H) return '';
    const h = Math.max(1, Math.round(H * 0.16));
    const canvas = canvasCon(W, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(img, 0, 0, W, h, 0, 0, W, h);
    const crop = canvas.toDataURL('image/jpeg', CALIDAD_JPEG_OCR);
    const rt = await rapidOcrInit();
    const r = leerFlags().ocrBandaRapida
      ? await rapidOcrReconocer(rt, crop, undefined, {
          detCap: DET_CAP_RAPIDO,
          omitirCls: true,
          sinRescateBordes: true,
        })
      : await rapidOcrReconocer(rt, crop);
    return r.texto;
  } catch {
    return ''; // sin banda nueva (nunca condena)
  }
}

/** OCR de la banda inferior (sello/firmas) — franja 20% universal. */
export async function ocrBandaInferior(dataUrl: string): Promise<string> {
  try {
    const img = await loadImageMemo(dataUrl);
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    if (!W || !H) return '';
    const h = Math.max(1, Math.round(H * 0.2));
    const canvas = canvasCon(W, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(img, 0, H - h, W, h, 0, 0, W, h);
    return await reconocerRapidOcr(canvas.toDataURL('image/jpeg', CALIDAD_JPEG_OCR));
  } catch {
    return ''; // señal extra: "" no condena — el gate decide con lo leído
  }
}
