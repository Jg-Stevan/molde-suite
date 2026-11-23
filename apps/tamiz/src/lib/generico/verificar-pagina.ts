// Verificación POR PÁGINA (acordado: tarjeta «VERIFICACIÓN PAGINA N» del
// flujo guiado): gate LIGERO por hoja capturada — calidad fotográfica
// (misma escala 0..10 del mantenedor, calidad.ts) + presencia del
// encabezado de la plantilla en la página 1 (frases de la huella).
//
// NO es el gate final: la evaluación universal completa (campos, anclas,
// aritmética) sigue corriendo UNA VEZ al cerrar el documento
// (evaluarCapturas). Aquí solo se responde "¿esta hoja sirve?" en 1-2 s,
// como pide el flujo guiado, con datos medidos y nunca inventados.

import type { MoldeUniversal } from '@jg-stevan/scanner-core/molde/universal-types';
import { UMBRAL_RECHAZO_SCORE } from '@/lib/e14/politica/umbrales';
import {
  calidadDeActa,
  scoreDeCalidad,
} from '@/lib/e14/bridge/calidad';
import { prepararPagina } from './procesar';
import { frasesDeHuella, normalizarTexto } from './huella';

export type EstadoItem = 'ok' | 'alerta' | 'fallo';

export interface ItemVerificacionPagina {
  id: string;
  etiqueta: string;
  estado: EstadoItem;
  /** Valor REAL medido (número o texto corto). Nunca decorativo. */
  detalle: string;
}

export interface VerificacionPagina {
  numero: number;
  /** Score de calidad 0..10 (misma fórmula del mantenedor). */
  score: number;
  estado: 'ok' | 'alerta' | 'fallo';
  items: ItemVerificacionPagina[];
  /** Miniatura revelada (b/n + deskew) para la tarjeta del documento. */
  dataUrlProcesada: string;
  /** Origen del recorte (detector / identidad / sin-recorte). */
  origen: string;
}

/** Etiqueta del tono del score, misma semántica que la política E-14. */
export function palabraDeScore(score: number, estado: 'ok' | 'alerta' | 'fallo'): string {
  if (estado === 'fallo') return 'BAJA';
  if (estado === 'alerta') return 'ACEPTABLE';
  return score >= 9.5 ? 'EXCELENTE' : 'OPTIMA';
}

interface Metricas {
  sharpness: number;
  brightness: number;
  contrast: number;
}

function itemNitidez(m: Metricas): ItemVerificacionPagina {
  // Nitidez normalizada contra el techo de la fórmula del mantenedor (900).
  const nitidez = Math.min(1, m.sharpness / 900);
  return {
    id: 'nitidez',
    etiqueta: 'Nitidez',
    estado: nitidez >= 0.25 ? 'ok' : nitidez >= 0.12 ? 'alerta' : 'fallo',
    detalle: `${Math.round(nitidez * 100)}%`,
  };
}

function itemContraste(m: Metricas): ItemVerificacionPagina {
  return {
    id: 'contraste',
    etiqueta: 'Contraste',
    estado: m.contrast >= 35 ? 'ok' : m.contrast >= 20 ? 'alerta' : 'fallo',
    detalle: String(Math.round(m.contrast)),
  };
}

function itemLuminosidad(m: Metricas): ItemVerificacionPagina {
  const desvio = Math.abs(m.brightness - 190);
  return {
    id: 'luminosidad',
    etiqueta: 'Luminosidad',
    estado: desvio <= 80 ? 'ok' : desvio <= 110 ? 'alerta' : 'fallo',
    detalle: String(Math.round(m.brightness)),
  };
}

/**
 * Verifica UNA hoja capturada: prepara la página (mismo pipeline que el
 * motor), mide calidad y — en la página 1 con plantilla conocida —
 * comprueba el encabezado contra la huella.
 */
export async function verificarPagina(
  foto: string,
  numero: number,
  molde: MoldeUniversal | null,
): Promise<VerificacionPagina> {
  const preparada = await prepararPagina(foto);
  const metricas = await calidadDeActa(preparada.dataUrl);
  const score = scoreDeCalidad(metricas);

  const items: ItemVerificacionPagina[] = [
    itemNitidez(metricas),
    itemContraste(metricas),
    itemLuminosidad(metricas),
  ];

  if (numero === 1 && molde) {
    items.push(await itemEncabezado(preparada.dataUrl, molde));
  }

  const hayFallo = items.some((i) => i.estado === 'fallo');
  const hayAlerta = items.some((i) => i.estado === 'alerta');
  const estado: 'ok' | 'alerta' | 'fallo' =
    hayFallo || score < UMBRAL_RECHAZO_SCORE ? 'fallo' : hayAlerta ? 'alerta' : 'ok';

  return {
    numero,
    score,
    estado,
    items,
    dataUrlProcesada: preparada.dataUrl,
    origen: preparada.origen,
  };
}

/** Item de encabezado de página 1: ≥1 frase de la huella en la banda OCR. */
async function itemEncabezado(
  dataUrlProcesada: string,
  molde: MoldeUniversal,
): Promise<ItemVerificacionPagina> {
  const frases = frasesDeHuella(molde, true);
  try {
    // Reutiliza la banda del bridge (16% superior, PSM 6) sobre la página
    // YA revelada: es la misma imagen que verá el motor.
    const { ocrBanda } = await import('@/lib/e14/bridge/ocr');
    const texto = normalizarTexto(await ocrBanda(dataUrlProcesada));
    const encontradas = frases.filter((f) => texto.includes(f));
    return {
      id: 'encabezado',
      etiqueta: 'Encabezado',
      estado: encontradas.length > 0 ? 'ok' : 'alerta',
      detalle:
        encontradas.length > 0
          ? `${encontradas[0]}`
          : 'sin coincidencias',
    };
  } catch {
    return {
      id: 'encabezado',
      etiqueta: 'Encabezado',
      estado: 'alerta',
      detalle: 'OCR no disponible',
    };
  }
}
