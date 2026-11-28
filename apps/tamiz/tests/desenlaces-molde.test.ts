/**
 * Plan §5 — TRES desenlaces honestos de un documento regido por molde:
 *   · ausencia obligatoria comprobada / regla incumplida → RECHAZADA
 *   · obligatorio sin ubicación o lectura segura          → EN_REVISION_HUMANA
 *   · obligatorios verificados                            → ADVERTENCIA u ÓPTIMA
 * Sin filas por campo, `veredictoDeResumen` conserva el comportamiento viejo.
 */
import { describe, expect, test } from "bun:test";
import type {
  ResumenMoldeActa,
  ResumenMoldeCampo,
} from "@molde-suite/scanner-core/dominio/types";
import { veredictoDeResumen } from "../src/lib/e14/molde/enrutamiento";
import {
  ausenciaComprobada,
  clasificarDesenlace,
  etiquetasInseguras,
} from "../src/lib/e14/molde/desenlaces";

const RECT = { x: 0.1, y: 0.2, w: 0.3, h: 0.05 };

function fila(parte: Partial<ResumenMoldeCampo> & { id: string; etiqueta: string }): ResumenMoldeCampo {
  return {
    tipo: "texto",
    estado: "ok",
    valor: "x",
    conf: 0.9,
    obligatorio: true,
    banderas: [],
    ...parte,
  } as ResumenMoldeCampo;
}

function resumen(parte: Partial<ResumenMoldeActa> & { campos?: ResumenMoldeCampo[] }): ResumenMoldeActa {
  const campos = parte.campos;
  const faltan = (campos ?? [])
    .filter((c) => c.obligatorio && c.estado !== "ok")
    .map((c) => c.etiqueta);
  return {
    moldeNombre: "RECIBO DE PAGO",
    total: campos?.length ?? 0,
    ok: (campos ?? []).filter((c) => c.estado === "ok").length,
    score: 80,
    requiereRevision: false,
    obligatoriosFaltantes: faltan,
    banderas: [],
    tiempos: { render_ms: 1, ocr_ms: 1, motor_ms: 1 },
    enrutado: true,
    identificado: true,
    ...parte,
    ...(campos ? { campos } : {}),
  } as ResumenMoldeActa;
}

describe("clasificarDesenlace", () => {
  test("no_encontrado con ANCLA real y tinta CERO = ausencia comprobada", () => {
    const c = fila({
      id: "importe",
      etiqueta: "IMPORTE",
      estado: "no_encontrado",
      valor: null,
      rect: RECT,
      fuente: "ancla",
      ancla_rect: RECT,
      tinta: false,
    });
    expect(ausenciaComprobada(c)).toBe(true);
  });

  test("no_encontrado SIN zona = incertidumbre (no se afirma que falte)", () => {
    const c = fila({ id: "importe", etiqueta: "IMPORTE", estado: "no_encontrado", valor: null });
    expect(ausenciaComprobada(c)).toBe(false);
  });

  test("zona puesta por LAYOUT sin hit de ancla = incierto (E2E recibo, falso FALTA)", () => {
    // Caso medido 2026-11-28: «Forma de pago»/«Fecha de pago» existen en el
    // papel pero el OCR no las leyó; con rect de layout se contaban como
    // ausencia y el documento salía RECHAZADA en falso.
    const c = fila({
      id: "forma_pago",
      etiqueta: "FORMA DE PAGO",
      estado: "no_encontrado",
      valor: null,
      rect: RECT,
      fuente: "layout",
    });
    expect(ausenciaComprobada(c)).toBe(false);
  });

  test("ancla real pero TINTA presente = incierto (fallo de OCR, no ausencia)", () => {
    const c = fila({
      id: "fecha_pago",
      etiqueta: "FECHA DE PAGO",
      estado: "no_encontrado",
      valor: null,
      rect: RECT,
      fuente: "ancla",
      ancla_rect: RECT,
      tinta: true,
    });
    expect(ausenciaComprobada(c)).toBe(false);
  });

  test("firma sin tinta medida junto a su ancla = ausencia comprobada", () => {
    const c = fila({
      id: "firma_emisor",
      etiqueta: "FIRMA DEL EMISOR",
      tipo: "firma",
      estado: "no_encontrado",
      valor: false,
      fuente: "ancla",
      ancla_rect: RECT,
      tinta: false,
    });
    expect(ausenciaComprobada(c)).toBe(true);
  });

  test("página declarada que no se capturó = ausencia comprobada", () => {
    const c = fila({
      id: "pagina2",
      etiqueta: "PÁGINA 2",
      estado: "no_encontrado",
      valor: null,
      banderas: ["pagina_faltante"],
    });
    expect(ausenciaComprobada(c)).toBe(true);
  });

  test("requiere_revision nunca es ausencia", () => {
    const c = fila({ id: "importe", etiqueta: "IMPORTE", estado: "requiere_revision", rect: RECT });
    expect(ausenciaComprobada(c)).toBe(false);
  });

  test("sin filas → null (camino histórico)", () => {
    expect(clasificarDesenlace({ obligatoriosFaltantes: ["X"] } as unknown as ResumenMoldeActa)).toBeNull();
  });
});

describe("veredictoDeResumen con filas (tres desenlaces)", () => {
  test("obligatorio AUSENTE con zona verificada → RECHAZADA y lo nombra", () => {
    const v = veredictoDeResumen(
      resumen({
        campos: [
          fila({ id: "fecha", etiqueta: "FECHA", valor: "2026-11-03" }),
          fila({
            id: "importe",
            etiqueta: "IMPORTE",
            estado: "no_encontrado",
            valor: null,
            rect: RECT,
            fuente: "ancla",
            ancla_rect: RECT,
            tinta: false,
          }),
        ],
      }),
    );
    expect(v.status).toBe("RECHAZADA");
    expect(v.rechazo?.tipo).toBe("MOLDE");
    expect(v.rechazo?.detalle).toContain("AUSENTES");
    expect(v.rechazo?.detalle).toContain("IMPORTE");
  });

  test("obligatorio dudoso (requiere_revision) → EN_REVISION_HUMANA sin rechazo", () => {
    const v = veredictoDeResumen(
      resumen({
        requiereRevision: true,
        campos: [
          fila({ id: "fecha", etiqueta: "FECHA", valor: "2026-11-03" }),
          fila({ id: "importe", etiqueta: "IMPORTE", estado: "requiere_revision", rect: RECT }),
        ],
      }),
    );
    expect(v.status).toBe("EN_REVISION_HUMANA");
    expect(v.rechazo).toBeNull();
  });

  test("obligatorio no_encontrado SIN zona → EN_REVISION_HUMANA (no se inventa ausencia)", () => {
    const v = veredictoDeResumen(
      resumen({
        campos: [fila({ id: "importe", etiqueta: "IMPORTE", estado: "no_encontrado", valor: null })],
      }),
    );
    expect(v.status).toBe("EN_REVISION_HUMANA");
  });

  test("declarado faltante sin fila propia → EN_REVISION_HUMANA", () => {
    const v = veredictoDeResumen(
      resumen({
        campos: [fila({ id: "fecha", etiqueta: "FECHA" })],
        obligatoriosFaltantes: ["FIRMA DEL PAGADOR"],
      }),
    );
    expect(v.status).toBe("EN_REVISION_HUMANA");
  });

  test("regla del molde incumplida → RECHAZADA (defensa del cierre)", () => {
    const v = veredictoDeResumen(
      resumen({
        requiereRevision: true,
        campos: [
          fila({
            id: "fecha_pago",
            etiqueta: "FECHA DE PAGO",
            estado: "requiere_revision",
            banderas: ["validacion_fallida"],
          }),
          fila({ id: "fecha", etiqueta: "FECHA DE EMISIÓN" }),
        ],
      }),
    );
    expect(v.status).toBe("RECHAZADA");
    expect(v.rechazo?.detalle).toContain("REGLA DEL MOLDE INCUMPLIDA");
    expect(v.rechazo?.detalle).toContain("FECHA DE PAGO");
  });

  test("obligatorios verificados con score bajo → ADVERTENCIA (el % solo no rechaza)", () => {
    const v = veredictoDeResumen(
      resumen({
        score: 42,
        requiereRevision: true,
        campos: [
          fila({ id: "fecha", etiqueta: "FECHA" }),
          fila({ id: "importe", etiqueta: "IMPORTE" }),
          fila({ id: "concepto", etiqueta: "CONCEPTO", obligatorio: false, estado: "no_encontrado" }),
        ],
      }),
    );
    expect(v.status).toBe("ADVERTENCIA");
    expect(v.rechazo).toBeNull();
  });

  test("todo verificado y sin dudas → ÓPTIMA", () => {
    const v = veredictoDeResumen(
      resumen({ score: 100, campos: [fila({ id: "importe", etiqueta: "IMPORTE" })] }),
    );
    expect(v.status).toBe("OPTIMA");
  });
});

describe("veredictoDeResumen sin filas (compatibilidad)", () => {
  test("faltantes declarados sin filas → RECHAZADA histórica", () => {
    const v = veredictoDeResumen(
      resumen({ score: 42, obligatoriosFaltantes: ["IMPORTE", "FIRMA DEL EMISOR"] }),
    );
    expect(v.status).toBe("RECHAZADA");
    expect(v.rechazo?.detalle).toContain("FALTANTES");
  });

  test("score bajo sin filas → RECHAZADA histórica", () => {
    const v = veredictoDeResumen(resumen({ score: 42 }));
    expect(v.status).toBe("RECHAZADA");
    expect(v.rechazo?.detalle).toContain("UMBRAL");
  });
});

describe("etiquetasInseguras", () => {
  test("inciertos + sin fila, sin duplicados y con tope", () => {
    const d = clasificarDesenlace(
      resumen({
        campos: [
          fila({ id: "a", etiqueta: "A", estado: "requiere_revision", rect: RECT }),
          fila({ id: "b", etiqueta: "B", estado: "requiere_revision", rect: RECT }),
        ],
        obligatoriosFaltantes: ["B", "C", "D"],
      }),
    )!;
    expect(etiquetasInseguras(d, 10)).toEqual(["A", "B", "C", "D"]);
    expect(etiquetasInseguras(d, 2)).toEqual(["A", "B"]);
  });
});
