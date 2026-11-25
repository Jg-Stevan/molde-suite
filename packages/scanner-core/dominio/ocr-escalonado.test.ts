import { describe, expect, test } from 'bun:test';
import {
  anclasDe,
  elegirMejor,
  necesitaSegunda,
  rescateAporta,
} from './ocr-escalonado';

// Texto FUERTE por definición de senalDeLectura: ≥6 anclas genéricas.
const FUERTE = 'DOCUMENTO FECHA PAGINA TOTAL FIRMA NIT';
// MEDIA: 2 anclas (sin folio) — necesita 2.ª pasada.
const MEDIA = 'FECHA TOTAL';
const DEBIL = 'HOLA';

describe('ocr-escalonado — decisión del OCR escalonado (port digielect14)', () => {
  test('anclasDe cuenta anclas genéricas presentes', () => {
    expect(anclasDe(FUERTE)).toBe(6);
    expect(anclasDe(MEDIA)).toBe(2);
    expect(anclasDe(DEBIL)).toBe(0);
  });

  test('necesitaSegunda: FUERTE no reintenta; MEDIA/DEBIL sí', () => {
    expect(necesitaSegunda(FUERTE)).toBe(false);
    expect(necesitaSegunda(MEDIA)).toBe(true);
    expect(necesitaSegunda(DEBIL)).toBe(true);
  });

  test('elegirMejor: más anclas manda; empate → conf; empate total → la 1.ª (referencia)', () => {
    const a = { texto: MEDIA, conf: 0.99 };
    const b = { texto: FUERTE, conf: 0.5 };
    expect(elegirMejor(a, b)).toBe(b);
    const c = { texto: MEDIA, conf: 0.6 };
    expect(elegirMejor(a, c)).toBe(a);
    const d = { texto: MEDIA, conf: 0.99 };
    expect(elegirMejor(a, d)).toBe(a);
  });

  test('rescateAporta solo con anclas NUEVAS (candidato aditivo)', () => {
    expect(rescateAporta(MEDIA, `${MEDIA} ${DEBIL}`)).toBe(false);
    expect(rescateAporta(MEDIA, `${FUERTE}\n${MEDIA}`)).toBe(true);
  });
});
