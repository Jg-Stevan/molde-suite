// Tests del puente Tamiz → datalab (chandra-bridge). PUREZA: nada de DOM ni
// OCR aquí — solo las funciones puras exportadas (regiones sintetizadas,
// bandas, título, mapeo de líneas). La paridad del serializador contra el GT
// datalab-convert se verificó en el cierre del benchmark (100 % 11/11, dos
// documentos) y el flujo completo se verifica en navegador (§7 del plan).

import { describe, expect, test } from "bun:test";
import {
  agruparEnBandas,
  esTituloDeDocumento,
  mapLineasAConversion,
  regionesDesdeCampos,
} from "../src/lib/e14/conversion/chandra-bridge";
import type { LineaOcr, RegionLayout } from "@molde-suite/scanner-core/conversion";

function linea(texto: string, x0: number, y0: number, x1: number, y1: number, conf = 0.9): LineaOcr {
  return { bbox: [x0, y0, x1, y1], texto, conf };
}

describe("mapLineasAConversion", () => {
  test("conf de línea = media de las palabras, acotada a [0,1]", () => {
    const r = mapLineasAConversion([
      {
        texto: "RECIBO DE PAGO",
        bbox: [10, 10, 200, 30],
        palabras: [
          { texto: "RECIBO", conf: 1, bbox: [10, 10, 80, 30] },
          { texto: "DE", conf: 0.5, bbox: [90, 10, 110, 30] },
          { texto: "PAGO", conf: 0.3, bbox: [120, 10, 200, 30] },
        ],
      },
    ]);
    expect(r.length).toBe(1);
    expect(r[0]!.conf).toBeCloseTo(0.6, 5);
    expect(r[0]!.texto).toBe("RECIBO DE PAGO");
  });

  test("sin palabras → conf 0 (honesto: nada que promediar)", () => {
    const r = mapLineasAConversion([{ texto: "x", bbox: [0, 0, 10, 10] }]);
    expect(r[0]!.conf).toBe(0);
  });

  test("conf fuera de rango se acota antes de promediar", () => {
    const r = mapLineasAConversion([
      {
        texto: "a",
        bbox: [0, 0, 5, 5],
        palabras: [{ texto: "a", conf: 7, bbox: [0, 0, 5, 5] }],
      },
    ]);
    expect(r[0]!.conf).toBe(1);
  });
});

describe("agruparEnBandas", () => {
  test("líneas pegadas verticalmente → una banda (párrafo multi-línea)", () => {
    const bandas = agruparEnBandas([
      linea("Línea uno del párrafo", 10, 100, 300, 118),
      linea("línea dos del mismo", 10, 120, 280, 138),
    ]);
    expect(bandas.length).toBe(1);
    expect(bandas[0]!.bbox).toEqual([10, 100, 300, 138]);
  });

  test("brecha vertical grande → bandas separadas, ordenadas por y", () => {
    const bandas = agruparEnBandas([
      linea("TITULO", 10, 10, 200, 40),
      linea("cuerpo uno", 10, 300, 300, 320),
      linea("cuerpo dos", 10, 322, 300, 342),
    ]);
    expect(bandas.length).toBe(2);
    expect(bandas[0]!.bbox[1]).toBe(10);
    expect(bandas[1]!.bbox[1]).toBe(300);
  });

  test("líneas de la misma banda se ordenan por x (lectura)", () => {
    const bandas = agruparEnBandas([
      linea("derecha", 200, 100, 300, 118),
      linea("izquierda", 10, 101, 180, 118),
    ]);
    expect(bandas[0]!.lineas?.[0]!.texto).toBe("izquierda");
    expect(bandas[0]!.lineas?.[1]!.texto).toBe("derecha");
  });

  test("sin líneas → sin bandas", () => {
    expect(agruparEnBandas([])).toEqual([]);
  });
});

describe("esTituloDeDocumento", () => {
  const titulo: RegionLayout = {
    clase: "text",
    bbox: [10, 20, 300, 45],
    lineas: [linea("RECIBO DE PAGO", 10, 20, 300, 45)],
  };
  const cuerpo: RegionLayout = {
    clase: "text",
    bbox: [10, 800, 400, 830],
    lineas: [linea("RECIBO DE PAGO", 10, 800, 400, 830)],
  };
  const parrafo: RegionLayout = {
    clase: "text",
    bbox: [10, 100, 600, 120],
    lineas: [linea("D. Lucía Torres Medina, con DNI 48.221.907, administradora de la empresa", 10, 100, 600, 120)],
  };

  test("banda superior corta en mayúsculas → título", () => {
    expect(esTituloDeDocumento(titulo, 2200)).toBe(true);
  });

  test("la misma banda en el cuerpo del documento → NO es título", () => {
    expect(esTituloDeDocumento(cuerpo, 2200)).toBe(false);
  });

  test("banda superior larga (párrafo de identidad) → NO es título", () => {
    expect(esTituloDeDocumento(parrafo, 2200)).toBe(false);
  });

  test("prefijo conocido aunque no esté todo en mayúsculas", () => {
    const t: RegionLayout = {
      clase: "text",
      bbox: [10, 15, 260, 40],
      lineas: [linea("Comprobante de entrega", 10, 15, 260, 40)],
    };
    expect(esTituloDeDocumento(t, 2200)).toBe(true);
  });
});

describe("regionesDesdeCampos", () => {
  test("campo texto con rect → región Text en px", () => {
    const r = regionesDesdeCampos(
      [{ id: "fecha", etiqueta: "Fecha", tipo: "texto", estado: "ok", valor: "02 de febrero de 2026", rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.04 } }],
      1000,
      2000,
    );
    expect(r.length).toBe(1);
    expect(r[0]!.clase).toBe("text");
    expect(r[0]!.bbox).toEqual([100, 400, 400, 480]);
    expect(r[0]!.recortes).toBeUndefined();
  });

  test("campo firma → región Text con recorte inline (patrón del GT)", () => {
    const r = regionesDesdeCampos(
      [{ id: "firma_comprador", etiqueta: "Firma comprador", tipo: "firma", estado: "ok", valor: true, rect: { x: 0.08, y: 0.6, w: 0.46, h: 0.06 } }],
      1000,
      2000,
    );
    expect(r.length).toBe(1);
    expect(r[0]!.recortes?.[0]!.bbox).toEqual([80, 1200, 540, 1320]);
    expect(r[0]!.recortes?.[0]!.alt).toContain("signature");
    expect(r[0]!.recortes?.[0]!.jpegB64).toBeUndefined();
  });

  test("campo sin rect → fuera (sin geometría medible, nunca inventar)", () => {
    const r = regionesDesdeCampos(
      [{ id: "x", etiqueta: "X", tipo: "texto", estado: "no_encontrado", valor: null, rect: null }],
      1000,
      2000,
    );
    expect(r.length).toBe(0);
  });
});
