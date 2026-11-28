/**
 * Tests del banner de REVISIÓN con AUTO (2026-11-27). `src/lib/e14/ui/banner.ts`
 * es puro (tipos del dominio + strings) → se prueba sin DOM ni React, que es
 * justo la razón de extraer los textos del componente.
 */
import { describe, expect, test } from "bun:test";
import type { Acta } from "@molde-suite/scanner-core/dominio/types";
import {
  DOCUMENTO_NO_IDENTIFICADO,
  estaClasificado,
  estaIdentificado,
  faltantesDelMolde,
  mandaElMolde,
  notaDelBanner,
  textoDelBanner,
  tituloDelAviso,
} from "../src/lib/e14/ui/banner";

/** Acta mínima: solo lo que leen los helpers. */
function acta(parte: Partial<Acta>): Acta {
  return { titulo: "", status: "EN_REVISION_HUMANA", ...parte } as Acta;
}

const EVALUACION = {
  moldeNombre: "RECIBO DE PAGO",
  total: 12,
  ok: 5,
  score: 42,
  requiereRevision: false,
  obligatoriosFaltantes: ["importe", "firma_emisor"],
  banderas: [],
  tiempos: { render_ms: 1, ocr_ms: 1, motor_ms: 1 },
  campos: [
    { id: "importe", etiqueta: "IMPORTE", tipo: "texto", estado: "no_encontrado", valor: null, conf: null, obligatorio: true },
    { id: "firma_emisor", etiqueta: "FIRMA DEL EMISOR", tipo: "firma", estado: "no_encontrado", valor: false, conf: null, obligatorio: true },
    { id: "fecha_emision", etiqueta: "FECHA DE EMISIÓN", tipo: "texto", estado: "ok", valor: "2026-11-03", conf: 0.9, obligatorio: true },
    { id: "numero_recibo", etiqueta: "N.º RECIBO", tipo: "texto", estado: "ok", valor: "014", conf: 0.9, obligatorio: true },
    { id: "concepto", etiqueta: "CONCEPTO", tipo: "texto", estado: "ok", valor: "Alquiler", conf: 0.9, obligatorio: false },
  ],
  enrutado: true,
  identificado: true,
} as const;

describe("banner con identificación automática", () => {
  test("documento identificado por la biblioteca → su nombre", () => {
    const a = acta({ evaluacionMolde: { ...EVALUACION } as unknown as Acta["evaluacionMolde"] });
    expect(textoDelBanner(a)).toBe("RECIBO DE PAGO");
    expect(estaIdentificado(a.evaluacionMolde)).toBe(true);
    expect(mandaElMolde(a)).toBe(true);
  });

  test("clasificación electoral REAL → el puesto (fix del mantenedor 14-oct)", () => {
    const a = acta({
      titulo: "FRANKFURT - CONSULADO · DOC 001 — PRINCIPAL P1",
      clasificacion: {
        nivel: "AUTO",
        tipo: "TRANSMISION",
        mesa: 1,
        pagina: { index: 1, total: 2 },
        puesto: { codigo: "02", nombre: "FRANKFURT - CONSULADO" },
      },
      evaluacionMolde: { ...EVALUACION, enrutado: false, identificado: true } as unknown as Acta["evaluacionMolde"],
    });
    expect(textoDelBanner(a)).toBe("FRANKFURT - CONSULADO · DOC 001 — PRINCIPAL P1");
    // Un acta E-14 reconocida conserva su check list curado (el molde es pista).
    expect(mandaElMolde(a)).toBe(false);
  });

  test("la SUGERIDA vacía de pipeline NO es clasificación: no hay huecos", () => {
    const vacia = { nivel: "SUGERIDA", tipo: null, mesa: null, pagina: null } as const;
    expect(estaClasificado(vacia)).toBe(false);
    const a = acta({ titulo: "— · DOC — — DOC", clasificacion: vacia as unknown as Acta["clasificacion"] });
    expect(textoDelBanner(a)).toBe(DOCUMENTO_NO_IDENTIFICADO);
    expect(textoDelBanner(a)).not.toContain("· DOC —");
  });

  test("sin molde y sin clasificación → DOCUMENTO NO IDENTIFICADO", () => {
    const a = acta({ titulo: "— · DOC — — DOC", evaluacionMolde: null });
    expect(textoDelBanner(a)).toBe(DOCUMENTO_NO_IDENTIFICADO);
    expect(notaDelBanner(a)).toBe("Ninguna plantilla de la biblioteca coincide con esta foto.");
    expect(tituloDelAviso(a)).toBe(DOCUMENTO_NO_IDENTIFICADO);
  });

  test("el aviso de un documento identificado dice QUÉ falta, no cuántos intentos", () => {
    const a = acta({ evaluacionMolde: { ...EVALUACION } as unknown as Acta["evaluacionMolde"] });
    const nota = notaDelBanner(a)!;
    expect(nota).toContain("FALTAN 2 DE 4");
    expect(nota).toContain("IMPORTE");
    expect(nota).toContain("FIRMA DEL EMISOR");
    expect(faltantesDelMolde(a.evaluacionMolde, 3)).toEqual(["IMPORTE", "FIRMA DEL EMISOR"]);
    expect(tituloDelAviso(a)).toBe("DATOS INCOMPLETOS");
    for (const txt of [textoDelBanner(a), nota, tituloDelAviso(a)]) {
      expect(txt).not.toContain("CLASIFICACIÓN PENDIENTE");
      expect(txt).not.toContain("INTENTO");
    }
  });

  test("identificado y completo → sin nota (la píldora ya informa)", () => {
    const a = acta({
      status: "OPTIMA",
      evaluacionMolde: {
        ...EVALUACION,
        obligatoriosFaltantes: [],
        requiereRevision: false,
      } as unknown as Acta["evaluacionMolde"],
    });
    expect(notaDelBanner(a)).toBeNull();
  });
});
