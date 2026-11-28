/** Caché del visor de conversión atada a la revisión real de la imagen.
 *  Antes la clave era `acta.id|lote`: una foto nueva (recorte, giro, filtro,
 *  re-proceso full-res) reutilizaba el HTML de la lectura anterior. */
import { describe, expect, test } from "bun:test";

import { claveRevisionVisor } from "../src/lib/e14/hash";

const A = "data:image/png;base64,AAAA";
const B = "data:image/png;base64,BBBB";

describe("clave de caché del visor por revisión", () => {
  test("misma acta y mismas fotos → misma clave", async () => {
    const k1 = await claveRevisionVisor("acta-1", [A, B]);
    const k2 = await claveRevisionVisor("acta-1", [A, B]);
    expect(k1).toBe(k2);
  });

  test("foto nueva con el mismo id → clave distinta", async () => {
    const k1 = await claveRevisionVisor("acta-1", [A]);
    const k2 = await claveRevisionVisor("acta-1", [B]);
    expect(k1).not.toBe(k2);
  });

  test("páginas nuevas (lote distinto) → clave distinta", async () => {
    const k1 = await claveRevisionVisor("acta-1", [A]);
    const k2 = await claveRevisionVisor("acta-1", [A, B]);
    expect(k1).not.toBe(k2);
  });

  test("el orden de las páginas forma parte de la clave", async () => {
    const k1 = await claveRevisionVisor("acta-1", [A, B]);
    const k2 = await claveRevisionVisor("acta-1", [B, A]);
    expect(k1).not.toBe(k2);
  });

  test("actas distintas con la misma foto → clave distinta", async () => {
    const k1 = await claveRevisionVisor("acta-1", [A]);
    const k2 = await claveRevisionVisor("acta-2", [A]);
    expect(k1).not.toBe(k2);
  });
});
