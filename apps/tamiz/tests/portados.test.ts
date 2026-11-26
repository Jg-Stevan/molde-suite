/**
 * Tests unitarios de los portados del plan de consolidación (Bloques 1-3):
 *   · rotarDataUrl90 (P5 — guarda honesta fuera del DOM)
 *   · PDF individual y CONSOLIDADO multipágina (Bloque 2.6 — jspdf, sin ZIP)
 *   · QR con zxing-wasm sobre píxeles reales (Bloque 2.5 — fixture generado)
 *   · senal-lectura UNIVERSAL (Bloque 2.4 — anclas genéricas, cero E-14)
 *   · política universal del gate (C3 lectura + escudo-fondo + escudo-MANUAL)
 */
import { describe, expect, test } from "bun:test";

import { rotarDataUrl90 } from "@molde-suite/scanner-core/core/canvas-imagen";
import { downloadBlob, pdfConsolidadoDeActas, pdfDeActa, type DocPdf } from "../src/lib/e14/core/pdf-export";
import { aplicarPoliticaUniversal, TECHO_MANUAL } from "../src/lib/e14/politica/gate";
import { ANCLAS_LECTURA, norm, senalDeLectura } from "@molde-suite/scanner-core/dominio/senal-lectura";
import { RealCoreBridge } from "../src/lib/e14/bridge/real-core-bridge";
import {
  MOLDE_DEMO_RECIBO,
  UMBRAL_RUTA_SCORE,
  debeEnrutar,
  moldeElectoral,
} from "../src/lib/e14/molde/enrutamiento";
import { readBarcodesFromImageData } from "zxing-wasm/reader";
import { writeBarcode } from "zxing-wasm/writer";

// ── fixture: JPEG mínimo (16×12) inline — el test NO depende de binarios ───
const JPEG_FIXTURE =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAMABADASIAAhEBAxEB/8QAFwAAAwEAAAAAAAAAAAAAAAAAAAUGBP/EABsQAAEEAwAAAAAAAAAAAAAAAAABAgMEBQYH/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAWEQEBAAAAAAAAAAAAAAAAAAAABQf/2gAMAwEAAhEDEQA/AJgA//9k=";

describe("resultado documental", () => {
  test("no inventa firmas detectadas", () => {
    const bridge = new RealCoreBridge() as unknown as {
      construirActa: (opciones: object, parcial: object, campos: object) => { firmas: unknown[] };
    };
    const acta = bridge.construirActa(
      { fuente: "ARCHIVO" },
      {},
      { score: 9, scoreVisual: 9, status: "OPTIMA" },
    );
    expect(acta.firmas).toEqual([]);
  });
});

describe("rotarDataUrl90 (P5)", () => {
  test("rechaza input inválido SIN crashear el proceso (guard honesto)", async () => {
    expect(rotarDataUrl90("no-es-dataurl")).rejects.toThrow();
  });
});

describe("PDF (Bloque 2.6 — jspdf)", () => {
  const doc = (n: number): DocPdf => ({
    titulo: `DOCUMENTO DE PRUEBA ${n}`,
    estado: "GUARDADO_LOCAL",
    score: 8.6,
    foto: JPEG_FIXTURE,
    hora: "2026-11-24 19:20",
  });

  test("pdfDeActa produce un PDF de UNA página", async () => {
    const blob = pdfDeActa(doc(1));
    expect(blob.size).toBeGreaterThan(200);
    const txt = await blob.text();
    expect(txt.startsWith("%PDF")).toBe(true);
    expect((txt.match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(1);
  });

  test("pdfConsolidadoDeActas produce multipágina (2 docs = 2 páginas)", async () => {
    const blob = pdfConsolidadoDeActas([doc(1), doc(2)]);
    expect(blob.size).toBeGreaterThan(200);
    const txt = await blob.text();
    expect(txt.startsWith("%PDF")).toBe(true);
    expect((txt.match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(2);
  });

  test("downloadBlob existe (flujo de guardado)", () => {
    expect(typeof downloadBlob).toBe("function");
  });
});

describe("QR / códigos de barras (Bloque 2.5 — zxing-wasm)", () => {
  test("decodifica un QR real desde píxeles (fixture TAMIZ-TEST-001)", async () => {
    // Generado al vuelo con zxing-wasm writer: no depende de /tmp/qr-test.raw.
    const qr = await writeBarcode("TAMIZ-TEST-001", { format: "QRCode", scale: 1 });
    const d = qr.svg.match(/<path d="([^"]+)"/)![1]!;
    const escala = 6, W = 29 * escala, H = W;
    const rgba = new Uint8ClampedArray(W * H * 4).fill(255);
    for (const m of d.matchAll(/M(\d+) (\d+)h(\d+)v(\d+)h-\d+Z/g)) {
      const [, xs, ys, ws, hs] = m;
      for (let y = Number(ys) * escala; y < (Number(ys) + Number(hs)) * escala; y++) {
        for (let x = Number(xs) * escala; x < (Number(xs) + Number(ws)) * escala; x++) {
          const p = (y * W + x) * 4;
          rgba[p] = rgba[p + 1] = rgba[p + 2] = 0;
        }
      }
    }
    const resultados = await readBarcodesFromImageData({
      data: rgba,
      width: W,
      height: H,
    } as ImageData);
    expect(resultados.length).toBeGreaterThan(0);
    expect(resultados[0]!.text).toBe("TAMIZ-TEST-001");
  });
});

describe("senal-lectura UNIVERSAL (Bloque 2.4)", () => {
  test("norm es byte-fiel con upstream (pleave de diacríticos)", () => {
    expect(norm("ÁÉÍ  óú-ñ")).toBe("AEI OU N");
  });

  test("documento genérico real → nivel FUERTE (anclas genéricas)", () => {
    const texto =
      "REGISTRO DE PRUEBA FECHA 2026-11-24 FOLIO 001842 TOTAL 1850000 " +
      "SERIE A2026 XY 77341 FIRMA DIRECCION OFICINA NIT 900123456";
    const s = senalDeLectura(texto);
    expect(s.nivel).toBe("FUERTE");
    expect(s.anclas).toBeGreaterThanOrEqual(6);
  });

  test("texto casi vacío → DEBIL (techo honesto)", () => {
    expect(senalDeLectura("hola").nivel).toBe("DEBIL");
  });

  test("cero anclas electorales: las regex NO mencionan E-14/REGISTRADURÍA/MESA", () => {
    const patrones = ANCLAS_LECTURA.map(([, re]) => re.source).join("|");
    expect(patrones).not.toMatch(/E\\s\*-\\s\*14|REGISTRADUR|MESA/);
  });
});

describe("política universal del gate (Bloque 2.4)", () => {
  test("C3 FUERTE: el piso de lectura vence (score ≥ 8.5)", () => {
    const r = aplicarPoliticaUniversal({
      score: 5.0,
      nivelLectura: "FUERTE",
      calidadPoor: false,
      contrasteEfectivo: 0.5,
      completa: true,
      manual: false,
    });
    expect(r.score).toBeGreaterThanOrEqual(8.5);
    expect(r.vetoIncompleta).toBe(false);
  });

  test("C3 DEBIL: techo honesto 5.9", () => {
    const r = aplicarPoliticaUniversal({
      score: 9.0,
      nivelLectura: "DEBIL",
      calidadPoor: false,
      contrasteEfectivo: 0.5,
      completa: true,
      manual: false,
    });
    expect(r.score).toBeLessThanOrEqual(5.9);
  });

  test("escudo-MANUAL Q2: recorte manual NO veto, degrada al techo 7.9", () => {
    const r = aplicarPoliticaUniversal({
      score: 9.5,
      nivelLectura: "MEDIA",
      calidadPoor: false,
      contrasteEfectivo: 0.5,
      completa: false, // el guard sospecha cortadura
      manual: true, // …pero el operador recortó a mano en el editor
    });
    expect(r.vetoIncompleta).toBe(false);
    expect(r.score).toBeLessThanOrEqual(TECHO_MANUAL);
    expect(r.techoDiag.join(",")).toContain("escudo-manual");
  });

  test("escudo-fondo: contraste < 0.18 caps el score", () => {
    const r = aplicarPoliticaUniversal({
      score: 9.5,
      nivelLectura: "MEDIA",
      calidadPoor: false,
      contrasteEfectivo: 0.1,
      completa: true,
      manual: false,
    });
    expect(r.score).toBeLessThanOrEqual(7.2);
    expect(r.techoDiag.join(",")).toContain("escudo-fondo");
  });
});

describe("enrutado universal de moldes (ETAPA B)", () => {
  const recibo = MOLDE_DEMO_RECIBO;
  const actaE14 = { ...MOLDE_DEMO_RECIBO, nombre: "ACTA E-14", documento: "acta_e14" };

  test("moldeElectoral decide por lo que el molde DECLARA, no por el OCR", () => {
    expect(moldeElectoral(actaE14)).toBe(true);
    expect(moldeElectoral(recibo)).toBe(false);
  });

  test("documento genérico se enruta AUNQUE el clasificador electoral crea que es E-14", () => {
    // Regresión: `esE14` se enciende con cualquier «MESA»/«DELEGADOS» del OCR;
    // un recibo que mencione esas palabras no puede quedar aditivo para siempre.
    expect(debeEnrutar(recibo, { esE14: true }, 90, 3)).toBe(true);
    expect(debeEnrutar(recibo, { esE14: false }, 90, 3)).toBe(true);
    expect(debeEnrutar(recibo, undefined, 90, 3)).toBe(true);
  });

  test("acta E-14 reconocida contra su propio molde → el gate manda (ADITIVO)", () => {
    expect(debeEnrutar(actaE14, { esE14: true }, 95, 8)).toBe(false);
  });

  test("molde del acta sobre un documento NO reconocido como electoral → enruta", () => {
    expect(debeEnrutar(actaE14, { esE14: false }, 95, 8)).toBe(true);
    expect(debeEnrutar(actaE14, undefined, 95, 8)).toBe(true);
  });

  test("sin confianza del motor no se enruta (umbral y campos leídos)", () => {
    expect(debeEnrutar(recibo, undefined, UMBRAL_RUTA_SCORE - 1, 3)).toBe(false);
    expect(debeEnrutar(recibo, undefined, UMBRAL_RUTA_SCORE, 3)).toBe(true);
    // Prohibido el falso ok: cero campos leídos ⇒ nunca veredicto del molde.
    expect(debeEnrutar(recibo, undefined, 100, 0)).toBe(false);
  });
});
