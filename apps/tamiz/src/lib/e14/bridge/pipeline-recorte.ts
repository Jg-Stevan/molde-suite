// CUERPO del pipeline de RECORTE (§7.5 — re-ejecución con quad elegido, ya
// sea el del editor manual o el re-detectado en mejorarResolución). Comparte
// calidad + OCR + gate con el pipeline de escaneo (helper único §4.4).

// 2.4 — política universal del gate (C3 lectura + escudo-fondo + escudo-MANUAL).
import { aplicarPoliticaUniversal } from '../politica/gate';
import { senalDeLectura } from '@molde-suite/scanner-core/dominio/senal-lectura';
import { clasificarDesdeOcr, type ClasificacionE14 } from '@molde-suite/scanner-core/dominio/clasificador';
import { processImage } from '@molde-suite/scanner-core/core/image-processor';
import type { Quad } from '@molde-suite/scanner-core/core/types';
import type { Acta, ProgresoAnalisis } from '@molde-suite/scanner-core/dominio/types';
import type { OrigenQuad } from '@molde-suite/scanner-core/core/image-processor';
import type { ResultadoGate } from './protocolo';
import { conRampa } from './progreso';
import { calidadDeActa, contrasteEfectivoDe, esquinasDeActa, scoreDeCalidad } from './calidad';
import { ocrBanda, ocrBandaInferior, reconocerRapidOcrEscalonado } from './ocr';
import { senalDeContenido } from './protocolo';
import { TECHO_SIN_SENAL } from '../politica/umbrales';

// KIT e14-recorte-manual-v1 (T1, upstream): el warp del editor mide 14–17.4 s
// en el equipo del mantenedor — con 15 s el recorte manual VENCE el timeout y
// el acta vuelve RECHAZADA ILEGIBLE con el parcial (no aplica). 30 s = upstream
// (apps/digielect14/src/lib/e14/bridge/pipeline-recorte.ts:115).
export const RECORTE_TIMEOUT_MS = 30_000;

/** Parcial YA HORNEADO del recorte (se llena apenas el warp completa). */
export interface ParcialRecorte {
  fotoProcesada?: string;
  filtro?: string;
  rotation?: number;
  recortada?: boolean;
  recorteLado?: string | null;
}

/** Dependencias del gate. */
export interface DepsRecorte {
  evaluarGate: (
    score: number,
    ocrTexto: string,
    clasificacion: ClasificacionE14,
    intento: number,
    maxIntentos: number,
  ) => ResultadoGate;
}

export async function correrPipelineRecorte(
  deps: DepsRecorte,
  acta: Acta,
  fotoOriginal: string,
  quad: Quad,
  rotacion: number,
  emitir: (p: ProgresoAnalisis) => void,
  _quadOrigen?: OrigenQuad | 'pagina-completa' | null,
  manual = false,
  parcial: ParcialRecorte = {},
): Promise<Acta> {
  void manual;
  // ---- RECORTANDO: warp con el quad elegido ----
  emitir(conRampa('RECORTANDO', 0.1));
  const filtro = (acta.filtro ?? 'bw') as 'original' | 'bw' | 'contrast';
  const warp = await processImage(fotoOriginal, quad, filtro, rotacion, { manual: true });
  // D2 (§D8.2) — VARIANTE OCR ORIGINAL en el recorte: el OCR JAMÁS lee la
  // variante binarizada; segundo warp SIN filtro (worker fallback-canvas).
  const warpOcr =
    filtro === 'original'
      ? warp
      : await processImage(fotoOriginal, quad, 'original', rotacion, { manual: true });
  // Guarda §D4 (contrato del visor): una salida VACÍA de processImage jamás
  // hornea el parcial ni el acta — '' como fotoProcesada está prohibido (el
  // catch del store resuelve con la píldora honesta y el acta conserva la
  // foto anterior).
  if (!warp.processed || !warpOcr.processed) {
    throw new Error('PROCESADO DE IMAGEN SIN SALIDA (data URL vacío)');
  }
  // El parcial se hornea apenas el warp completa (T1): si vence el timeout,
  // el acta de tiempo muestra ESTE recorte, no la foto anterior.
  parcial.fotoProcesada = warp.processed;
  parcial.filtro = filtro;
  parcial.rotation = rotacion;
  emitir(conRampa('RECORTANDO', 1));

  // ---- CALIDAD ----
  emitir(conRampa('CALIDAD', 0.4));
  const calidad = await calidadDeActa(warp.processed);
  const scoreVisual = scoreDeCalidad(calidad);

  // ---- OCR + bandas ----
  emitir(conRampa('OCR', 0.2));
  const ocrTexto = await reconocerRapidOcrEscalonado(warpOcr.processed);
  const banda = await ocrBanda(warpOcr.processed);
  const bandaInf = await ocrBandaInferior(warpOcr.processed);
  emitir(conRampa('OCR', 1));

  // ---- CLASIFICACIÓN + completitud ----
  const textoCompleto = `${banda}\n${ocrTexto}\n${bandaInf}`;
  const clasificacionBase = clasificarDesdeOcr(textoCompleto);
  const esquinas = await esquinasDeActa(warp.processed);
  parcial.recortada = !esquinas.completa;
  parcial.recorteLado = esquinas.ladoEsquina;

  // 2.4 — política UNIVERSAL (paridad con el escaneo) con manual: true:
  // C3 lectura → escudo-fondo → escudo-MANUAL (Q2): el recorte del editor
  // JAMÁS se veto por el guard (el operador VIO el papel); si la geometría
  // sospecha, el score degrada al techo 7.9 y decide el gate por intentos.
  const politica = aplicarPoliticaUniversal({
    score: scoreVisual,
    nivelLectura: senalDeLectura(textoCompleto).nivel,
    // El fork no mide `level` (piso de lectura vence — «el OCR manda»).
    calidadPoor: false,
    contrasteEfectivo: contrasteEfectivoDe(calidad),
    completa: esquinas.completa,
    manual: true,
  });
  let score = politica.score;
  let clasificacion: ClasificacionE14 | null = clasificacionBase;
  if (clasificacionBase && !senalDeContenido(textoCompleto, clasificacionBase)) {
    score = Math.min(score, TECHO_SIN_SENAL);
    clasificacion = null;
  }

  const clasifFinal: ClasificacionE14 = clasificacion ?? {
    nivel: 'SUGERIDA',
    tipo: null,
    mesa: null,
    pagina: null,
  };
  const gate = deps.evaluarGate(
    score,
    ocrTexto,
    clasifFinal,
    acta.intento ?? 1,
    acta.maxIntentos ?? 3,
  );
  return {
    ...acta,
    ...parcial,
    score,
    scoreVisual,
    status: gate.status,
    rechazo: gate.rechazo,
    ocrTexto,
    metricas: {
      sharpness: calidad.sharpness,
      brightness: calidad.brightness,
      contrast: calidad.contrast,
    },
    clasificacion: gate.clasificacion ?? undefined,
  };
}
