// CUERPO del pipeline de RECORTE (§7.5 — re-ejecución con quad elegido, ya
// sea el del editor manual o el re-detectado en mejorarResolución). Comparte
// calidad + OCR + gate con el pipeline de escaneo (helper único §4.4).

import { clasificarDesdeOcr, type ClasificacionE14 } from '@jg-stevan/scanner-core/dominio/clasificador';
import { processImage } from '@jg-stevan/scanner-core/core/image-processor';
import type { Quad } from '@jg-stevan/scanner-core/core/types';
import type { ActaFirma, ActaStatus, Acta, ProgresoAnalisis } from '@jg-stevan/scanner-core/dominio/types';
import type { OrigenQuad } from '@jg-stevan/scanner-core/core/image-processor';
import type { ResultadoGate } from './protocolo';
import { conRampa } from './progreso';
import { calidadDeActa, contrasteEfectivoDe, esquinasDeActa, scoreDeCalidad } from './calidad';
import { ocrBanda, ocrBandaInferior, reconocerRapidOcrEscalonado } from './ocr';
import { senalDeContenido } from './protocolo';
import { TECHO_SIN_SENAL } from '../politica/umbrales';

export const RECORTE_TIMEOUT_MS = 15_000;

/** Parcial YA HORNEADO del recorte (se llena apenas el warp completa). */
export interface ParcialRecorte {
  fotoProcesada?: string;
  filtro?: string;
  rotation?: number;
  recortada?: boolean;
  recorteLado?: string | null;
}

/** Dependencias del bridge (gate + firmas — helper único §4.4). */
export interface DepsRecorte {
  evaluarGate: (
    score: number,
    ocrTexto: string,
    clasificacion: ClasificacionE14,
    intento: number,
    maxIntentos: number,
  ) => ResultadoGate;
  firmasPorStatus: (firmas: ActaFirma[], status: ActaStatus) => ActaFirma[];
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
  const ocrTexto = await reconocerRapidOcrEscalonado(warp.processed);
  const banda = await ocrBanda(warp.processed);
  const bandaInf = await ocrBandaInferior(warp.processed);
  emitir(conRampa('OCR', 1));

  // ---- CLASIFICACIÓN + completitud ----
  const textoCompleto = `${banda}\n${ocrTexto}\n${bandaInf}`;
  const clasificacionBase = clasificarDesdeOcr(textoCompleto);
  const esquinas = await esquinasDeActa(warp.processed);
  parcial.recortada = !esquinas.completa;
  parcial.recorteLado = esquinas.ladoEsquina;

  let score = scoreVisual;
  let clasificacion: ClasificacionE14 | null = clasificacionBase;
  if (clasificacionBase && !senalDeContenido(textoCompleto, clasificacionBase)) {
    score = Math.min(score, TECHO_SIN_SENAL);
    clasificacion = null;
  }
  if (contrasteEfectivoDe(calidad) < 0.18) {
    score = Math.min(score, TECHO_SIN_SENAL);
  }

  if (!esquinas.completa) {
    return {
      ...acta,
      ...parcial,
      score: 0,
      status: 'RECHAZADA',
      rechazo: { tipo: 'INCOMPLETA', detalle: 'EL DOCUMENTO ESTÁ CORTADO EN EL ENCUADRE — ALÉJATE UN POCO Y CAPTURA EL DOCUMENTO COMPLETO' },
      firmas: deps.firmasPorStatus(acta.firmas, 'RECHAZADA'),
      clasificacion: undefined,
    };
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
    firmas: deps.firmasPorStatus(acta.firmas, gate.status),
    clasificacion: gate.clasificacion ?? undefined,
  };
}
