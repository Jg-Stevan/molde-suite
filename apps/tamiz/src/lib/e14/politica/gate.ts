/**
 * 7.2 (plan de remediación upstream) — POLÍTICA UNIVERSAL del gate de Tamiz
 * (Bloque 2.4). Versión LIMPIA de upstream politica/gate.ts: conserva las
 * reglas agnósticas al tipo de documento y EXCLUYE las electorales
 * (chip SIM del score, marcadores de votos/zona, medirZonaVotos).
 *
 * Reglas universales que SÍ aplica (orden del upstream §G3):
 *   C3 piso/techo por LECTURA → escudo-fondo → escudo-MANUAL Q2 → caps.
 *
 * El veto INCOMPLETA/SIN_VOTOS y el gate por intentos siguen en los
 * pipelines (sus entradas difieren por camino); aquí vive la política de
 * SCORE que ambos comparten (paridad escaneo↔recorte).
 */
import {
  PISO_LECTURA_FUERTE,
  TECHO_LECTURA_DEBIL,
  type NivelLectura,
} from "@molde-suite/scanner-core/dominio/senal-lectura";
import { TECHO_ESCUDO_FONDO } from "../politica/umbrales";

/** Techo del escudo-MANUAL (upstream Q2: token `escudo-manual:7.9`) — el
 *  operador VIO el papel al recortar: a lo sumo su crop cortó impresión. */
export const TECHO_MANUAL = 7.9;

export interface EntradaPoliticaUniversal {
  /** Score BRUTO de scoreDeCalidad (C3 se aplica AQUÍ). */
  score: number;
  /** Nivel de LECTURA del texto ya leído (OCR manda). */
  nivelLectura: NivelLectura;
  /** Nivel de calidad fotográfica (piso FUERTE no vence al `poor`). */
  calidadPoor: boolean;
  /** Contraste efectivo (escudo-fondo D10: flash/sombra sepulta el documento). */
  contrasteEfectivo: number;
  /** ¿El guard de completitud sospecha cortadura? */
  completa: boolean;
  /** ¿Es el RECORTE MANUAL del editor? (veto → escudo; el humano mandó). */
  manual: boolean;
}

export interface SalidaPoliticaUniversal {
  score: number;
  /** true ⇒ el llamador NO debe vetar por INCOMPLETA (degrada a escudo). */
  vetoIncompleta: boolean;
  /** Traza de diagnóstico (aditiva). */
  techoDiag: string[];
}

export function aplicarPoliticaUniversal(e: EntradaPoliticaUniversal): SalidaPoliticaUniversal {
  let score = e.score;
  const techoDiag: string[] = [];

  // C3 — el OCR manda: FUERTE sube al piso (vence al techo fair, nunca al
  // poor); DEBIL techo honesto. ANTES de los caps (pitfall §9.4/§9.5 upstream).
  if (e.nivelLectura === "FUERTE" && !e.calidadPoor) {
    score = Math.max(score, PISO_LECTURA_FUERTE);
    techoDiag.push(`piso-lectura-FUERTE:${PISO_LECTURA_FUERTE}`);
  } else if (e.nivelLectura === "DEBIL") {
    score = Math.min(score, TECHO_LECTURA_DEBIL);
    techoDiag.push(`techo-lectura-DEBIL:${TECHO_LECTURA_DEBIL}`);
  }

  // Escudo-fondo (D10): el flash/sombra sepulta el documento.
  if (e.contrasteEfectivo < 0.18) {
    score = Math.min(score, TECHO_ESCUDO_FONDO);
    techoDiag.push(`escudo-fondo:${TECHO_ESCUDO_FONDO}`);
  }

  // Q2 — recorte MANUAL: el veto del guard SOLO rechaza FUERA del editor;
  // dentro, degrada al escudo 7.9 (el operador decidió mirando).
  const vetoIncompleta = !e.completa && !e.manual;
  if (!e.completa && e.manual) {
    score = Math.min(score, TECHO_MANUAL);
    techoDiag.push(`escudo-manual:${TECHO_MANUAL}`);
  }

  return { score, vetoIncompleta, techoDiag };
}
