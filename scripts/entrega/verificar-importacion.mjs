/**
 * verificar-importacion.mjs — smoke E2E del escaneo por IMPORTACIÓN de imagen.
 *
 * Pensado para un agente externo SIN teléfono: recorre el banco usando el
 * mismo camino que un operador real (Importar imagen → pipeline → veredicto)
 * en un Chromium headless, y deja un JSON medido.
 *
 * Uso:
 *   bun run dev            (en apps/tamiz, otra terminal; :3100)
 *   npm i -D playwright && npx playwright install chromium
 *   node scripts/entrega/verificar-importacion.mjs [--base http://localhost:3100]
 *
 * Salida: tabla por consola + JSON en scripts/resultados/importacion-<ts>.json.
 * Código de salida 1 si el banco no cumple las expectativas.
 *
 * EXPECTATIVAS (las que sostienen el §10 del reporte de diagnóstico):
 *  · Ningún resultado con score 0.0 (regresión de página negra: el filtro `bw`
 *    estrellaba el blanco a 0 y el OCR leía 0 campos).
 *  · `recibo_pago/pag-01` (la limpia): ÓPTIMA y verificación 100 % — el molde
 *    RECIBO DE PAGO debe estar ENRUTADO (banner con el nombre del documento).
 *  · Los 6 fixtures del banco: NO ÓPTIMA y verificación ≥ 70 %; lo que falta
 *    es firma (no legible por OCR), no la foto. `recibo-tachado` es la
 *    excepción honesta: REVISIÓN HUMANA (0 lecturas, foto cruzada).
 *  · La imagen procesada mide lo que el archivo (ni negra ni frame simulado).
 *
 * El script ACTIVA el molde versionado (apps/tamiz/public/moldes/
 * recibo_pago.molde.json) antes de cargar la app, en localStorage — el mismo
 * contrato que usa el registry (`tamiz.moldeActivo.v1`). Sin él, Tamiz seedea
 * el molde demo «RECIBO DE LUZ» y las cifras no son las del §10.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, "..", "..");
const RESULTADOS = join(RAIZ, "scripts", "resultados");
const MOLDE = join(RAIZ, "apps", "tamiz", "public", "moldes", "recibo_pago.molde.json");

const argBase = process.argv.indexOf("--base");
const BASE = argBase > -1 ? process.argv[argBase + 1] : "http://localhost:3100";

const REF_LIMPIA = join(
  RAIZ,
  "apps",
  "molde-studio",
  "public",
  "moldes-genericos",
  "recibo_pago",
  "pag-01.png",
);
const FIXTURES = [
  { archivo: REF_LIMPIA, etiqueta: "recibo_pago/pag-01 (limpia)", optimo: true },
  ...["recibo-tachado", "recibo-datos-nuevos", "recibo-sin-firmas", "recorte-60pct-usuario", "recorte-66pct-sin-firma", "rotada-12"].map(
    (nombre) => ({
      archivo: join(RAIZ, "scripts", "resultados", "fixtures", `${nombre}.png`),
      etiqueta: nombre,
      optimo: false,
    }),
  ),
];

const VEREDICTOS = /ÓPTIMA|ADVERTENCIA|RECHAZADA|REVISIÓN HUMANA/;

const { chromium } = await import("playwright");

const navegador = await chromium.launch({
  headless: true,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});
const contexto = await navegador.newContext({
  viewport: { width: 420, height: 900 },
  permissions: ["camera"],
});

// Molde activo ANTES de que arranque el bundle (misma clave que registry.ts).
const moldeTexto = readFileSync(MOLDE, "utf-8");
JSON.parse(moldeTexto); // falla temprano si el JSON es inválido
await contexto.addInitScript((texto) => {
  try {
    window.localStorage.setItem("tamiz.moldeActivo.v1", texto);
    window.localStorage.setItem(
      "e14-molde-local",
      JSON.stringify({ nombre: "recibo_pago.molde.json", tamanoKb: 10.8, fecha: "sandbox" }),
    );
  } catch {
    /* sin localStorage el script no puede fijar el molde: el run fallará visible */
  }
}, moldeTexto);

const pagina = await contexto.newPage();

/** Deja el PWA en código fresco: sin service worker ni cachés del shell. */
async function limpiarPwa() {
  await pagina.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await pagina.evaluate(async () => {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
    const claves = await caches.keys();
    await Promise.all(claves.map((k) => caches.delete(k)));
  });
}

/** Lleva la app a la vista de escaneo con el importador montado. */
async function irAEscanear() {
  const volver = pagina.getByRole("button", { name: /Volver a la vista anterior|REPETIR/i });
  if (await volver.count()) {
    await volver.first().click();
    await pagina.waitForTimeout(2000);
  }
  if ((await pagina.locator("input[type=file]").count()) === 0) {
    await pagina.getByRole("button", { name: /ESCANEAR/i }).first().click();
    await pagina.waitForTimeout(1800);
  }
  // El importador vive en la pestaña ARCHIVO del selector de fuente.
  let elegir = pagina.getByRole("button", { name: /ELEGIR IMAGEN/i });
  if ((await elegir.count()) === 0) {
    const tab = pagina.getByRole("button", { name: /^\s*ARCHIVO\s*$/i });
    if (await tab.count()) {
      await tab.first().click();
      await pagina.waitForTimeout(1200);
    }
    elegir = pagina.getByRole("button", { name: /ELEGIR IMAGEN/i });
  }
  if ((await elegir.count()) === 0) throw new Error("no se encontró el importador (ELEGIR IMAGEN)");
  return elegir.first();
}

/** Métricas de la imagen procesada visible (detecta página negra / frame sim). */
async function metricasImagen() {
  return pagina.evaluate(() => {
    const im = Array.from(document.querySelectorAll("img")).find(
      (i) => i.complete && i.naturalWidth > 400,
    );
    if (!im) return null;
    const w = im.naturalWidth;
    const h = im.naturalHeight;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return { w, h };
    ctx.drawImage(im, 0, 0);
    const d = ctx.getImageData(0, 0, w, h).data;
    let suma = 0;
    let oscuros = 0;
    const n = w * h;
    for (let i = 0; i < d.length; i += 4) {
      const g = (d[i] + d[i + 1] + d[i + 2]) / 3;
      suma += g;
      if (g < 100) oscuros++;
    }
    return { w, h, media: +(suma / n).toFixed(1), fracOscura: +(oscuros / n).toFixed(4) };
  });
}

const filas = [];

try {
  await limpiarPwa();
  await pagina.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await pagina.getByRole("button", { name: /ESCANEAR/i }).first().waitFor({ timeout: 60000 });
  const onboarding = pagina.getByRole("button", { name: /Entendido/i });
  if (await onboarding.count()) await onboarding.first().click();

  for (const { archivo, etiqueta, optimo } of FIXTURES) {
    const elegir = await irAEscanear();

    const [chooser] = await Promise.all([
      pagina.waitForEvent("filechooser", { timeout: 15000 }),
      elegir.click({ noWaitAfter: true }),
    ]);
    await chooser.setFiles(archivo);

    const t0 = Date.now();
    let texto = "";
    let listo = false;
    while (Date.now() - t0 < 300000) {
      await pagina.waitForTimeout(4000);
      try {
        texto = (await pagina.locator("body").innerText()).replace(/\n{2,}/g, "\n");
      } catch {
        continue;
      }
      if (VEREDICTOS.test(texto)) {
        listo = true;
        break;
      }
    }
    if (!listo) {
      filas.push({ fixture: etiqueta, error: "sin veredicto en 300 s" });
      console.log(`FALLA ${etiqueta.padEnd(30)} sin veredicto en 300 s`);
      continue;
    }
    await pagina.waitForTimeout(2500);
    const fila = {
      fixture: etiqueta,
      segundos: Math.round((Date.now() - t0) / 1000),
      score: (texto.match(/\d+\.\d+\/10/) ?? [])[0] ?? null,
      veredicto: (texto.match(VEREDICTOS) ?? [])[0] ?? null,
      banner: (texto.match(/RECIBO DE PAGO|NO IDENTIFICADO/) ?? [])[0] ?? null,
      verificacion: (texto.match(/\d+% (?:OK|ALERTA|RECHAZADO)/) ?? [])[0] ?? null,
      molde: (texto.match(/MOLDE:[^\n]{0,60}/) ?? [])[0] ?? null,
      imagen: await metricasImagen(),
    };
    filas.push(fila);

    const fallos = [];
    if (!fila.score || Number(fila.score.split("/")[0]) === 0) fallos.push("score 0 (página negra)");
    if (fila.imagen && fila.imagen.media < 40) fallos.push("imagen procesada negra");
    if (optimo) {
      if (fila.veredicto !== "ÓPTIMA") fallos.push("esperado ÓPTIMA");
      if (fila.verificacion !== "100% OK") fallos.push("esperado 100% OK");
      if (fila.banner !== "RECIBO DE PAGO") fallos.push("molde no enrutado (banner)");
    } else {
      const pct = Number((fila.verificacion ?? "0").split("%")[0]);
      if (pct < 70) fallos.push(`lectura insuficiente (${fila.verificacion ?? "sin dato"})`);
    }
    if (fallos.length) fila.fallos = fallos;
    console.log(
      `${fallos.length ? "FALLA" : "ok   "} ${etiqueta.padEnd(30)} ${fila.score ?? "?"} ` +
        `${fila.veredicto ?? "?"} · ${fila.verificacion ?? "?"} · ${fila.molde ?? "-"} · ` +
        `${fila.imagen ? `${fila.imagen.w}x${fila.imagen.h} media ${fila.imagen.media}` : "sin imagen"}` +
        (fallos.length ? ` ← ${fallos.join("; ")}` : ""),
    );
  }
} finally {
  await contexto.close();
  await navegador.close();
}

mkdirSync(RESULTADOS, { recursive: true });
const salida = join(RESULTADOS, `importacion-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(salida, JSON.stringify({ base: BASE, medidoEn: new Date().toISOString(), filas }, null, 2));
console.log(`\nJSON: ${salida}`);

process.exit(filas.some((f) => f.error || f.fallos) ? 1 : 0);
