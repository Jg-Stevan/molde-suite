/**
 * TESTS DE CARACTERIZACIÓN del flujo E14 — auditoría post-migración
 * (bloque 4: R5 del análisis de viabilidad — red de seguridad del
 * re-cableado hacia @molde-suite/scanner-core).
 *
 * Caracterizan el comportamiento ACTUAL de los módulos E14 de Tamiz que
 * sobrevivieron a la deduplicación (lógica pura, sin DOM/IndexedDB):
 *   · checklist.ts   — plantilla E14 del panel de REVISIÓN (grupos, estados,
 *                      contadores y tonos del semáforo).
 *   · jornada.ts     — mesasRealesDe: derivación del guion real de mesas
 *                      desde las actas archivadas (fix M10).
 *   · politica/umbrales.ts — ÚNICA fuente de verdad de los números del gate.
 *   · errores.ts     — cobertura del copy de avisos al operador.
 *
 * Regla de caracterización: fijan el comportamiento observable HOY. Si un
 * test falla tras tocar el código, se discute el cambio de comportamiento
 * ANTES de aceptarlo (no se "arregla" el test sin decidir la intención).
 */

import { describe, expect, test } from "bun:test";
import type { Acta } from "@molde-suite/scanner-core/dominio/types";
import {
  construirChecklist,
  conteoDeGrupo,
  etiquetaFormulario,
  PLANTILLA_E14,
  resumenDe,
  tonoDeGrupo,
  tonoDeStatus,
  type GrupoChecklist,
} from "../src/lib/e14/checklist";
import { mesasRealesDe } from "../src/lib/e14/jornada";
import { TEXTO_MOTIVO, type MotivoOperador } from "../src/lib/e14/errores";
import {
  SHUTTER_SCORE_VISOR,
  TECHO_ESCUDO_FONDO,
  TECHO_SIN_SENAL,
  TECHO_SEGUNDO_INTENTO,
  TIMEOUT_ALTO_MS,
  TIMEOUT_BAJO_MS,
  TIMEOUT_MEDIO_MS,
  UMBRAL_RECHAZO_SCORE,
} from "../src/lib/e14/politica/umbrales";

// ───────────────────────── Fixtures base ─────────────────────────

/** Acta E14 mínima con campos REALES del tipo de dominio del paquete. */
function actaBase(sobre: Partial<Acta> = {}): Acta {
  return {
    id: "acta-test-1",
    titulo: "DOC 01 · PRINCIPAL · Pág 1 de 2",
    ubicacion: {
      departamento: "CUNDINAMARCA",
      municipio: "BOGOTA",
      zona: "01",
      puesto: "SEDE PRUEBA",
      mesa: "01",
    },
    tipo: "TRANSMISION",
    pagina: { index: 1, total: 2 },
    candidatos: [],
    firmas: [],
    score: 8.6,
    status: "OPTIMA",
    rechazo: null,
    intento: 1,
    maxIntentos: 2,
    fuente: "CAMARA",
    ...sobre,
  };
}

const CLASIF_AUTO_COMPLETA = {
  nivel: "AUTO" as const,
  tipo: "TRANSMISION" as const,
  mesa: 1,
  pagina: { index: 1, total: 2 },
  departamento: { codigo: "05", nombre: "CUNDINAMARCA" },
  municipio: { codigo: "001", nombre: "BOGOTA" },
  zona: { codigo: "01" },
  puesto: { codigo: "0001", nombre: "SEDE PRUEBA" },
  kit: "44501",
  kitFuente: "identificacion-codigo-v1",
};

function item(grupo: GrupoChecklist, id: string) {
  const it = grupo.items.find((x) => x.id === id);
  expect(it).toBeDefined();
  return it!;
}

function grupoDe(
  pl: ReturnType<typeof construirChecklist>,
  id: string,
): GrupoChecklist {
  const g = pl.grupos.find((x) => x.id === id);
  expect(g).toBeDefined();
  return g!;
}

// ─────────────── etiquetaFormulario (piel universal) ───────────────

describe("checklist.ts — etiquetaFormulario", () => {
  test("TRANSMISION (con y sin tilde) → PRINCIPAL", () => {
    expect(etiquetaFormulario("TRANSMISION")).toBe("PRINCIPAL");
    expect(etiquetaFormulario("TRANSMISIÓN")).toBe("PRINCIPAL");
  });
  test("DELEGADOS → ANEXO", () => {
    expect(etiquetaFormulario("DELEGADOS")).toBe("ANEXO");
  });
  test("cualquier otro valor pasa sin cambios (dato del motor)", () => {
    expect(etiquetaFormulario("OTRO")).toBe("OTRO");
  });
});

// ─────────────── PLANTILLA_E14.construir (grupos) ───────────────

describe("checklist.ts — construirChecklist (acta ÓPTIMA completa)", () => {
  const pl = construirChecklist(
    actaBase({
      firmas: [
        { nombre: "JURADO 1", jurado: "J1", estado: "OK" },
        { nombre: "DELEGADO", jurado: "D1", estado: "TENUE" },
        { nombre: "—", jurado: "J3", estado: "NO_DETECTADO" },
      ],
      ocrTexto: "ACTA E-14 DE ESCUTINIO — TRANSMISION",
      qrPayload: "e14:05|001|01|0001|01|1",
      qrEstado: "leido",
      clasificacion: CLASIF_AUTO_COMPLETA,
      diagnostico: {
        gate: {
          completa: true,
          ladoEsquina: null,
          fondo: false,
          votos: { skipPag2: false, ok: true, densidadPct: 12.4 },
        },
        metricas: { sharpnessHi: 1, sharpness: 1, brightness: 128, contrasteEfectivo: 40 },
        tiempos: {},
      },
    }),
  );

  test("la plantilla activa es e14 / DOCUMENTO", () => {
    expect(PLANTILLA_E14.id).toBe("e14");
    expect(PLANTILLA_E14.nombre).toBe("DOCUMENTO");
    expect(pl.id).toBe("e14");
  });

  test("los 4 grupos presentes (firmas no vacía)", () => {
    expect(pl.grupos.map((g) => g.id)).toEqual([
      "huellas",
      "obligatorios",
      "integridad",
      "variables",
    ]);
  });

  test("firmas: etiqueta genérica para JURADO, nombre propio para el resto", () => {
    const g = grupoDe(pl, "huellas");
    // «JURADO 1» contiene «jurado» → piel genérica Firma N.
    expect(item(g, "firma-0")).toMatchObject({
      etiqueta: "Firma 1",
      estado: "ok",
      detalle: "Presente",
    });
    expect(item(g, "firma-1")).toMatchObject({
      etiqueta: "DELEGADO",
      estado: "alerta",
      detalle: "Tenue / baja nitidez",
    });
    // nombre «—» → cae al jurado «J3» (no contiene «jurado» → se pinta tal cual).
    expect(item(g, "firma-2")).toMatchObject({
      etiqueta: "J3",
      estado: "fallo",
      detalle: "No detectado",
    });
  });

  test("obligatorios: AUTO completo → todo ok con copy canónico", () => {
    const g = grupoDe(pl, "obligatorios");
    expect(item(g, "qr")).toMatchObject({ estado: "ok", detalle: "Payload leído" });
    expect(item(g, "cabecera")).toMatchObject({
      estado: "ok",
      detalle: "Match de cabecera",
    });
    expect(item(g, "tipo")).toMatchObject({
      estado: "ok",
      detalle: "PRINCIPAL",
    });
    expect(item(g, "mesa")).toMatchObject({ estado: "ok", detalle: "N.º 001" });
    expect(item(g, "pagina")).toMatchObject({ estado: "ok", detalle: "Pág 1 de 2" });
  });

  test("integridad: papel ok, corte ok, fondo limpio, tinta con densidad redondeada", () => {
    const g = grupoDe(pl, "integridad");
    expect(item(g, "papel")).toMatchObject({
      estado: "ok",
      detalle: "Bordes dentro del cuadro",
    });
    expect(item(g, "corte")).toMatchObject({ estado: "ok", detalle: "Sin corte detectado" });
    expect(item(g, "fondo")).toMatchObject({ estado: "ok", detalle: "Limpio" });
    expect(item(g, "votos")).toMatchObject({ estado: "ok", detalle: "Tinta 12%" });
    expect(item(g, "tinta-foto")).toMatchObject({ estado: "ok", detalle: "Tinta suficiente" });
  });

  test("variables: dep/mun/puesto/kit ok con fuente del kit", () => {
    const g = grupoDe(pl, "variables");
    expect(item(g, "departamento")).toMatchObject({ estado: "ok", detalle: "CUNDINAMARCA" });
    expect(item(g, "municipio")).toMatchObject({ estado: "ok", detalle: "BOGOTA" });
    expect(item(g, "puesto")).toMatchObject({ estado: "ok", detalle: "SEDE PRUEBA" });
    expect(item(g, "kit")).toMatchObject({
      estado: "ok",
      detalle: "Kit 44501 · identificacion-codigo-v1",
    });
  });

  test("contadores: resumen global [pasados/total]", () => {
    const r = resumenDe(pl);
    // firmas 3 + obligatorios 5 + integridad 5 + variables 4.
    expect(r.total).toBe(3 + 5 + 5 + 4);
    expect(r.pasados).toBe(r.total - 2); // firma TENUE (alerta) y firma NO_DETECTADO (fallo)
  });
});

describe("checklist.ts — degradaciones honestas (acta parcial)", () => {
  test("sin firmas el grupo huellas se OMITE", () => {
    const pl = construirChecklist(
      actaBase({
        ocrTexto: "",
        qrEstado: "sin-payload",
        recortada: true,
        recorteLado: "inf-izq",
        rechazo: { tipo: "INCOMPLETA", detalle: null },
        status: "RECHAZADA",
        score: 5.0,
      }),
    );
    expect(pl.grupos.map((g) => g.id)).not.toContain("huellas");
    expect(pl.grupos.map((g) => g.id)).toEqual([
      "obligatorios",
      "integridad",
      "variables",
    ]);
  });

  test("QR sin payload → fallo; cabecera/tipo/mesa/página sin clasificación → fallo o alerta", () => {
    const pl = construirChecklist(actaBase({ ocrTexto: "", qrEstado: "sin-payload" }));
    const g = grupoDe(pl, "obligatorios");
    expect(item(g, "qr")).toMatchObject({ estado: "fallo", detalle: "Ilegible / Sin lectura" });
    expect(item(g, "cabecera").estado).toBe("fallo");
    expect(item(g, "tipo").estado).toBe("fallo");
    expect(item(g, "mesa").estado).toBe("fallo");
    expect(item(g, "pagina").estado).toBe("fallo");
  });

  test("tipo por banda OCR (sin AUTO) → alerta «Por banda · PRINCIPAL»", () => {
    const pl = construirChecklist(
      actaBase({
        ocrTexto: "TRANSMISION",
        clasificacion: {
          nivel: "SUGERIDA",
          tipo: null,
          mesa: null,
          pagina: null,
          parciales: { mesa: 7 },
        },
      }),
    );
    const g = grupoDe(pl, "obligatorios");
    expect(item(g, "tipo")).toMatchObject({
      estado: "alerta",
      detalle: "Por banda · PRINCIPAL",
    });
    // mesa parcial → alerta con pad3
    expect(item(g, "mesa")).toMatchObject({ estado: "alerta", detalle: "N.º 007 · parcial" });
    // página: basta clasificación NO nula + acta.pagina → ok (PÁG X DE Y).
    expect(item(g, "pagina")).toMatchObject({ estado: "ok", detalle: "Pág 1 de 2" });
  });

  test("página sin clasificación → fallo honesto", () => {
    const pl = construirChecklist(actaBase({ ocrTexto: "", clasificacion: null }));
    const g = grupoDe(pl, "obligatorios");
    expect(item(g, "pagina")).toMatchObject({ estado: "fallo", detalle: "Sin lectura" });
  });

  test("QR presente pero clasificación ausente → alerta (no corrió) + cabecera fallo", () => {
    const pl = construirChecklist(actaBase({ ocrTexto: "" }));
    const g = grupoDe(pl, "obligatorios");
    expect(item(g, "qr")).toMatchObject({
      estado: "alerta",
      detalle: "No corrió en esta captura",
    });
    expect(item(g, "cabecera").estado).toBe("fallo");
  });

  test("recorte con lado → fallo con nombre legible del margen", () => {
    const pl = construirChecklist(
      actaBase({ recortada: true, recorteLado: "inf-izq" }),
    );
    const g = grupoDe(pl, "integridad");
    expect(item(g, "corte")).toMatchObject({
      estado: "fallo",
      detalle: "Margen inferior izquierdo: corte detectado",
    });
  });

  test("recorte con lado fuera del catálogo → el lado crudo va en el detalle", () => {
    const pl = construirChecklist(
      actaBase({ recortada: true, recorteLado: "x" }),
    );
    const g = grupoDe(pl, "integridad");
    expect(item(g, "corte").detalle).toBe("Margen x: corte detectado");
  });

  test("recorte sin lado conocido → detalle genérico", () => {
    const pl = construirChecklist(
      actaBase({ recortada: true, recorteLado: null }),
    );
    const g = grupoDe(pl, "integridad");
    expect(item(g, "corte").detalle).toBe("Corte de contenido detectado");
  });

  test("rechazo INCOMPLETA sin diagnóstico → papel fallo", () => {
    const pl = construirChecklist(
      actaBase({ rechazo: { tipo: "INCOMPLETA", detalle: null } }),
    );
    const g = grupoDe(pl, "integridad");
    expect(item(g, "papel")).toMatchObject({
      estado: "fallo",
      detalle: "Papel cortado por el encuadre",
    });
  });

  test("fondo incluido → alerta; sin tinta en votos → fallo; procesadaVacia → fallo", () => {
    const pl = construirChecklist(
      actaBase({
        procesadaVacia: true,
        diagnostico: {
          gate: {
            completa: true,
            ladoEsquina: null,
            fondo: true,
            votos: { skipPag2: false, ok: false },
          },
          metricas: { sharpnessHi: 1, sharpness: 1, brightness: 128, contrasteEfectivo: 40 },
          tiempos: {},
        },
      }),
    );
    const g = grupoDe(pl, "integridad");
    expect(item(g, "fondo")).toMatchObject({
      estado: "alerta",
      detalle: "Fondo incluido en el recorte",
    });
    expect(item(g, "votos")).toMatchObject({
      estado: "fallo",
      detalle: "Sin tinta en la zona de contenido",
    });
    expect(item(g, "tinta-foto")).toMatchObject({
      estado: "fallo",
      detalle: "Procesada sin tinta suficiente",
    });
  });

  test("skipPag2 omite el item de votos (página sin zona de contenido)", () => {
    const pl = construirChecklist(
      actaBase({
        diagnostico: {
          gate: {
            completa: true,
            ladoEsquina: null,
            fondo: false,
            votos: { skipPag2: true, ok: false },
          },
          metricas: { sharpnessHi: 1, sharpness: 1, brightness: 128, contrasteEfectivo: 40 },
          tiempos: {},
        },
      }),
    );
    const g = grupoDe(pl, "integridad");
    expect(g.items.find((x) => x.id === "votos")).toBeUndefined();
  });

  test("variables sin lectura → alerta, jamás fallo (informativa)", () => {
    const pl = construirChecklist(actaBase({}));
    const g = grupoDe(pl, "variables");
    for (const id of ["departamento", "municipio", "puesto", "kit"]) {
      expect(item(g, id).estado).toBe("alerta");
      expect(item(g, id).detalle).toBe("Sin lectura");
    }
  });
});

describe("checklist.ts — tonos del semáforo", () => {
  const g = (estados: Array<"ok" | "alerta" | "fallo">): GrupoChecklist => ({
    id: "g",
    titulo: "G",
    items: estados.map((estado, i) => ({
      id: `i${i}`,
      etiqueta: `I${i}`,
      detalle: null,
      estado,
    })),
  });

  test("tonoDeGrupo: fallo→crit · alerta→warn · ok→ok", () => {
    expect(tonoDeGrupo(g(["ok", "ok"]))).toBe("ok");
    expect(tonoDeGrupo(g(["ok", "alerta"]))).toBe("warn");
    expect(tonoDeGrupo(g(["alerta", "fallo"]))).toBe("crit");
  });

  test("conteoDeGrupo cuenta SOLO los ok como pasados", () => {
    expect(conteoDeGrupo(g(["ok", "alerta", "fallo", "ok"]))).toEqual({
      pasados: 2,
      total: 4,
    });
  });

  test("tonoDeStatus replica el semáforo del gate", () => {
    expect(tonoDeStatus("RECHAZADA")).toBe("crit");
    expect(tonoDeStatus("ADVERTENCIA")).toBe("warn");
    expect(tonoDeStatus("EN_REVISION_HUMANA")).toBe("warn");
    expect(tonoDeStatus("OPTIMA")).toBe("ok");
    expect(tonoDeStatus("ENVIADA")).toBe("ok");
  });
});

// ─────────────── jornada.ts — mesasRealesDe (fix M10) ───────────────

describe("jornada.ts — mesasRealesDe (guion real desde archivadas)", () => {
  const puesto = {
    clave: "05-001-01-0001",
    titulo: "SEDE PRUEBA",
    departamento: "CUNDINAMARCA",
    municipio: "BOGOTA",
    zona: "01",
    puesto: "SEDE PRUEBA",
  };

  test("mesa 1 completa (2 páginas) y mesa 2 a medio camino, con total 3", () => {
    const archivadas = {
      "05-001-01-0001-1": {
        clasificacion: CLASIF_AUTO_COMPLETA,
        huecos: [
          { tipo: "DELEGADOS" as const, pagina: 1 as const, estado: "OK" as const },
          { tipo: "DELEGADOS" as const, pagina: 2 as const, estado: "OK" as const },
          { tipo: "TRANSMISIÓN" as const, pagina: 1 as const, estado: "OK" as const },
          { tipo: "TRANSMISIÓN" as const, pagina: 2 as const, estado: "OK" as const },
        ],
      },
      "05-001-01-0001-2": {
        clasificacion: CLASIF_AUTO_COMPLETA,
        huecos: [
          { tipo: "DELEGADOS" as const, pagina: 1 as const, estado: "RESCANEO" as const },
        ],
      },
      "09-999-99-9999-1": {
        clasificacion: CLASIF_AUTO_COMPLETA,
        huecos: [],
      }, // otro puesto: se IGNORA
    };
    const mesas = mesasRealesDe(archivadas, puesto, 3);

    expect(mesas.map((m) => m.id)).toEqual(["DOC 01", "DOC 02", "DOC 03"]);
    expect(mesas[0]).toMatchObject({ estado: "COMPLETADA", progresoPct: 100 });
    expect(mesas[0].paginas).toEqual([
      { tipo: "DELEGADOS", pagina: 1, estado: "OK" },
      { tipo: "DELEGADOS", pagina: 2, estado: "OK" },
      { tipo: "TRANSMISIÓN", pagina: 1, estado: "OK" },
      { tipo: "TRANSMISIÓN", pagina: 2, estado: "OK" },
    ]);
    // mesa 2: único hueco RESCANEO → 0 páginas OK → PENDIENTE 0%.
    expect(mesas[1]).toMatchObject({ estado: "PENDIENTE", progresoPct: 0 });
    expect(mesas[2]).toMatchObject({ estado: "PENDIENTE", progresoPct: 0 });
  });

  test("sin total, las mesas salen SOLO de las archivadas en orden numérico", () => {
    const mesas = mesasRealesDe(
      {
        "05-001-01-0001-2": { clasificacion: CLASIF_AUTO_COMPLETA, huecos: [] },
        "05-001-01-0001-11": { clasificacion: CLASIF_AUTO_COMPLETA, huecos: [] },
        "05-001-01-0001-1": { clasificacion: CLASIF_AUTO_COMPLETA, huecos: [] },
      },
      puesto,
      null,
    );
    expect(mesas.map((m) => m.id)).toEqual(["DOC 01", "DOC 02", "DOC 11"]);
  });

  test("archivadas FUERA del rango del total se APENDAN al final", () => {
    const mesas = mesasRealesDe(
      {
        "05-001-01-0001-5": { clasificacion: CLASIF_AUTO_COMPLETA, huecos: [] },
      },
      puesto,
      2,
    );
    expect(mesas.map((m) => m.id)).toEqual(["DOC 01", "DOC 02", "DOC 05"]);
  });

  test("clasificación sin página → 2 páginas por defecto; con total 1 → 1 página", () => {
    const sinPagina = mesasRealesDe(
      {
        "05-001-01-0001-1": {
          clasificacion: { ...CLASIF_AUTO_COMPLETA, pagina: null },
          huecos: [],
        },
      },
      puesto,
      null,
    );
    expect(sinPagina[0].paginas).toHaveLength(4);

    const unaPagina = mesasRealesDe(
      {
        "05-001-01-0001-1": {
          clasificacion: { ...CLASIF_AUTO_COMPLETA, pagina: { index: 1, total: 1 } },
          huecos: [
            { tipo: "DELEGADOS", pagina: 1, estado: "OK" },
            { tipo: "TRANSMISIÓN", pagina: 1, estado: "OK" },
          ],
        },
      },
      puesto,
      null,
    );
    expect(unaPagina[0].paginas).toHaveLength(2);
    expect(unaPagina[0].paginas[0]).toMatchObject({ tipo: "DELEGADOS", estado: "OK" });
    expect(unaPagina[0]).toMatchObject({ estado: "COMPLETADA", progresoPct: 100 });
  });

  test("huecos parciales → EN_PROCESO con progreso proporcional", () => {
    const mesas = mesasRealesDe(
      {
        "05-001-01-0001-1": {
          clasificacion: CLASIF_AUTO_COMPLETA,
          huecos: [{ tipo: "DELEGADOS", pagina: 1, estado: "OK" }],
        },
      },
      puesto,
      null,
    );
    expect(mesas[0]).toMatchObject({ estado: "EN_PROCESO", progresoPct: 25 });
  });
});

// ─────────────── politica/umbrales.ts — números del producto ───────────────

describe("politica/umbrales.ts — ÚNICA fuente de verdad del gate", () => {
  test("umbrales de calidad y techos del gate (escala del mantenedor 0..10)", () => {
    expect(UMBRAL_RECHAZO_SCORE).toBe(6.5);
    expect(SHUTTER_SCORE_VISOR).toBe(0.55);
    expect(TECHO_SIN_SENAL).toBe(6.9);
    expect(TECHO_ESCUDO_FONDO).toBe(7.2);
    expect(TECHO_SEGUNDO_INTENTO).toBe(8.9);
  });

  test("timeouts por tier de dispositivo (ms)", () => {
    expect(TIMEOUT_ALTO_MS).toBe(120_000);
    expect(TIMEOUT_MEDIO_MS).toBe(240_000);
    expect(TIMEOUT_BAJO_MS).toBe(480_000);
  });
});

// ─────────────── errores.ts — copy de avisos ───────────────

describe("errores.ts — avisos al operador", () => {
  test("cada motivo canónico tiene copy no vacío (píldora del visor)", () => {
    const motivos: MotivoOperador[] = [
      "CAMARA_NO_DISPONIBLE",
      "PERMISO_DENEGADO",
      "SIN_SENAL",
      "ANALISIS_INTERRUMPIDO",
      "ALMACENAMIENTO_LLENO",
      "ARCHIVO_INVALIDO",
      "HEIC_NO_SOPORTADO",
      "ESCANEO_FALLIDO",
      "MEMORIA_AGOTADA",
    ];
    expect(Object.keys(TEXTO_MOTIVO).sort()).toEqual([...motivos].sort());
    for (const m of motivos) {
      expect(TEXTO_MOTIVO[m].length).toBeGreaterThan(0);
    }
  });
});
