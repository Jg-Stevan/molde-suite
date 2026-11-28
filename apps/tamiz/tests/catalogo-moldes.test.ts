/**
 * Tests del CATÁLOGO empaquetado (AUTO, 2026-11-27). Criterio de pureza: la
 * decisión de siembra es una función pura (`decidirSiembra`) y la lista se
 * contrasta con los archivos reales de `public/moldes/` — sin DOM, sin
 * IndexedDB, sin red.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  CATALOGO_NOMBRES,
  CATALOGO_VERSION,
  decidirSiembra,
  urlDelMolde,
} from "../src/lib/e14/molde/catalogo";
import { esMoldeUniversal } from "@molde-suite/scanner-core/molde/universal-types";

const CARPETA_MOLDES = join(import.meta.dir, "..", "public", "moldes");

describe("catálogo de moldes empaquetados", () => {
  test("la lista vive sincronizada con public/moldes/", () => {
    const enDisco = readdirSync(CARPETA_MOLDES)
      .filter((f) => f.endsWith(".molde.json"))
      .map((f) => f.replace(/\.molde\.json$/, ""))
      .sort();
    // `prueba_2paginas` es un artefacto de prueba del Studio, no un documento.
    const esperados = enDisco.filter((n) => n !== "prueba_2paginas");
    expect([...CATALOGO_NOMBRES].sort()).toEqual(esperados);
  });

  test("variantes/ NO se siembra (empatan en ratio y el router elige a ciegas)", () => {
    const variantes = readdirSync(join(CARPETA_MOLDES, "variantes"))
      .filter((f) => f.endsWith(".molde.json"))
      .map((f) => f.replace(/\.molde\.json$/, ""));
    expect(variantes.length).toBeGreaterThan(0);
    for (const v of variantes) expect(CATALOGO_NOMBRES).not.toContain(v);
  });

  test("cada molde del catálogo es UNIVERSAL v3 válido", () => {
    const invalidos: string[] = [];
    const sinCampos: string[] = [];
    for (const nombre of CATALOGO_NOMBRES) {
      const json = JSON.parse(readFileSync(join(CARPETA_MOLDES, `${nombre}.molde.json`), "utf8"));
      if (!esMoldeUniversal(json)) invalidos.push(nombre);
      else if (json.campos.length === 0) sinCampos.push(nombre);
    }
    expect(invalidos).toEqual([]);
    expect(sinCampos).toEqual([]);
  });

  test("decidirSiembra: dispositivo nuevo → faltan TODOS", () => {
    const d = decidirSiembra(null, CATALOGO_NOMBRES, []);
    expect(d.falta).toBe(true);
    expect(d.nombres).toEqual([...CATALOGO_NOMBRES]);
  });

  test("decidirSiembra: con la marca puesta NO se vuelve a la red", () => {
    const d = decidirSiembra(String(CATALOGO_VERSION), CATALOGO_NOMBRES, []);
    expect(d.falta).toBe(false);
    expect(d.nombres).toEqual([]);
  });

  test("decidirSiembra: nunca pisa un molde ya importado por el operador", () => {
    const d = decidirSiembra(null, CATALOGO_NOMBRES, ["recibo_pago", "e14_acta"]);
    expect(d.falta).toBe(true);
    expect(d.nombres).not.toContain("recibo_pago");
    expect(d.nombres).not.toContain("e14_acta");
    expect(d.nombres).toContain("recibo_real");
  });

  test("decidirSiembra: un bump de CATALOGO_VERSION reabre la siembra", () => {
    expect(decidirSiembra(String(CATALOGO_VERSION - 1), CATALOGO_NOMBRES, []).falta).toBe(true);
    expect(decidirSiembra("basura", CATALOGO_NOMBRES, []).falta).toBe(true);
  });

  test("decidirSiembra: catálogo ya completo → sin fetch (lista vacía)", () => {
    const d = decidirSiembra(null, CATALOGO_NOMBRES, [...CATALOGO_NOMBRES]);
    expect(d.falta).toBe(true);
    expect(d.nombres).toEqual([]);
  });

  test("urlDelMolde lleva la versión (el cache-first del SW no puede estancarse)", () => {
    expect(urlDelMolde("recibo_pago")).toContain("/moldes/recibo_pago.molde.json");
    expect(urlDelMolde("recibo_pago")).toContain(`v=${CATALOGO_VERSION}`);
  });
});
