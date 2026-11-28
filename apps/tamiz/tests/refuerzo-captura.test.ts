/** Contrato de resolución de la foto original (captura-refuerzo.ts).
 *  Objetivo 2048 de lado mayor, piso duro 1600: el OCR nunca consume más de
 *  1920 (reduce_max_side) y 1600 garantiza ≥1280 tras márgenes de encuadre.
 */
import { describe, expect, test } from "bun:test";

import {
  alcanzaMinimo,
  MINIMO_LADO_CAPTURA,
  necesitaRefuerzo,
  OBJETIVO_LADO_CAPTURA,
  planRefuerzo,
} from "../src/lib/e14/core/captura-refuerzo";

describe("contrato de captura — umbrales", () => {
  test("el contrato queda en 1600/2048", () => {
    expect(MINIMO_LADO_CAPTURA).toBe(1600);
    expect(OBJETIVO_LADO_CAPTURA).toBe(2048);
  });

  test("preview 720×1280 necesita refuerzo y no alcanza el piso", () => {
    expect(necesitaRefuerzo(720, 1280)).toBe(true);
    expect(alcanzaMinimo(720, 1280)).toBe(false);
  });

  test("1920×1920 (KN3) aún gana con el refuerzo", () => {
    expect(necesitaRefuerzo(1920, 1920)).toBe(true);
    expect(alcanzaMinimo(1920, 1920)).toBe(true);
  });

  test("lado mayor en el objetivo ya no se refuerza", () => {
    expect(necesitaRefuerzo(2048, 1536)).toBe(false);
    expect(necesitaRefuerzo(3060, 4080)).toBe(false);
  });

  test("frontera del piso: 1599 falla, 1600 cumple", () => {
    expect(alcanzaMinimo(900, 1599)).toBe(false);
    expect(alcanzaMinimo(900, 1600)).toBe(true);
  });

  test("medidas inválidas no cuentan", () => {
    expect(necesitaRefuerzo(0, 0)).toBe(false);
    expect(alcanzaMinimo(0, 0)).toBe(false);
    expect(planRefuerzo(Number.NaN, 1280)).toBeNull();
  });
});

describe("contrato de captura — plan de constraints", () => {
  test("track vertical conserva la orientación (1536×2048)", () => {
    expect(planRefuerzo(720, 1280)).toEqual({
      width: { ideal: 1536 },
      height: { ideal: 2048 },
    });
  });

  test("track apaisado pide 2048×1536", () => {
    expect(planRefuerzo(1280, 720)).toEqual({
      width: { ideal: 2048 },
      height: { ideal: 1536 },
    });
  });

  test("cuadrado se trata como vertical", () => {
    expect(planRefuerzo(1920, 1920)).toEqual({
      width: { ideal: 1536 },
      height: { ideal: 2048 },
    });
  });

  test("sin refuerzo no hay plan", () => {
    expect(planRefuerzo(2048, 1536)).toBeNull();
    expect(planRefuerzo(4080, 3060)).toBeNull();
  });
});
