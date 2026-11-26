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
      // Excepción honesta del §10: foto cruzada → 0 lecturas → REVISIÓN
      // HUMANA. No se le exige el ≥70% de los demás (no hay nada que leer).
      revision: nombre === "recibo-tachado",
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
    // Perfil fresco = overlay de GUÍA RÁPIDA por encima de la app: el diálogo
    // secuestra la vista y el tab ESCANEAR jamás se ve. Misma clave que
    // AyudaOverlay.tsx (LS_KEY = "e14-ayuda-vista").
    window.localStorage.setItem("e14-ayuda-vista", "1");
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

/** Desarma la AUTO-CAPTURA de la cámara simulada (ScanView.tsx:738): si queda
 *  armada, el frame fake dispara capturas que pisan la importación y la app
 *  puede quedarse en ANALIZANDO sin veredicto jamás. */
async function desarmarAutoCaptura() {
  await pagina.waitForTimeout(1500); // el toggle monta con la vista
  const auto = pagina.getByRole("button", { name: /Captura automática/i });
  if ((await auto.count()) && (await auto.first().getAttribute("aria-pressed")) === "true") {
    await auto.first().click().catch(() => {});
    await pagina.waitForTimeout(500);
  }
}

/** Montar la vista de escaneo con el input del importador presente. El input
 *  oculto (ScanView.tsx:645, aria-label "Importar imagen") es el mismo que
 *  usa el dock: se dispara por JS porque en viewport móvil el click sintético
 *  sobre el botón no llega al handler en Certain_states headless. */
async function prepararImporte() {
  const volver = pagina.getByRole("button", { name: /Volver a la vista anterior|REPETIR/i });
  if (await volver.count()) {
    await volver.first().click().catch(() => {});
    await pagina.waitForTimeout(2000);
  }
  const input = pagina.locator("input[type=file]").first();
  try {
    await input.waitFor({ state: "attached", timeout: 10000 });
  } catch {
    // El «volver» no devolvió la vista de escaneo (p. ej. sigue ANALIZANDO o
    // cayó a otra pantalla): recarga dura — el addInitScript resiembra el
    // molde activo y las claves LS en cada navegación.
    await limpiarPwa();
    await pagina.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
    const guia = pagina.getByRole("button", { name: /Entendido|Cerrar|Empezar/i });
    if (await guia.count()) await guia.first().click().catch(() => {});
    await input.waitFor({ state: "attached", timeout: 120000 });
  }
  await desarmarAutoCaptura();
}

/** Dispara el filechooser vía input y entrega el archivo. */
async function importar(archivo) {
  const [chooser] = await Promise.all([
    pagina.waitForEvent("filechooser", { timeout: 20000 }),
    pagina.evaluate(() => {
      const i = document.querySelector("input[type=file]");
      if (!i) throw new Error("sin input de importación montado");
      i.click();
    }),
  ]);
  await chooser.setFiles(archivo);
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
let indiceFixture = 0;

try {
  await limpiarPwa();
  await pagina.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  // Arranque duro en perfil fresco: (1) la GUÍA RÁPIDA (e14-ayuda-vista, ya
  // sembrada arriba) se descarta por si acaso; (2) la cámara simulada del
  // Chromium headless dispara la AUTO-CAPTURA nada más montar y la app entra
  // en «analizando», que oculta las pestañas — el ESCANEAR jamás aparece.
  // Se desarma la auto-captura antes de esperar nada (ScanView.tsx:738).
  // La app abre en la vista de escaneo: esperar el input del importador montado.
  await pagina.locator("input[type=file]").first().waitFor({ state: "attached", timeout: 120000 });
  const guia = pagina.getByRole("button", { name: /Entendido|Cerrar|Empezar/i });
  if (await guia.count()) await guia.first().click().catch(() => {});
  await desarmarAutoCaptura();

  for (const { archivo, etiqueta, optimo, revision } of FIXTURES) {
    await prepararImporte();
    await importar(archivo);

    // La importación debe SACAR la vista del veredicto anterior (entra a
    // ANALIZANDO). Si a los 20 s sigue el veredicto viejo, el archivo no
    // arrancó el pipeline: error honesto, no medir el resultado de otro fixture.
    const tSalida = Date.now();
    let salio = false;
    while (Date.now() - tSalida < 20000) {
      const t = await pagina.locator("body").innerText().catch(() => "");
      if (!VEREDICTOS.test(t)) {
        salio = true;
        break;
      }
      await pagina.waitForTimeout(1000);
    }
    if (!salio) {
      filas.push({ fixture: etiqueta, error: "la importación no arrancó (veredicto previo persiste)" });
      console.log(`FALLA ${etiqueta.padEnd(30)} la importación no arrancó`);
      continue;
    }

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
    // Re-leer y VOLCAR la vista: el banner/chips pueden montarse con la
    // animación posterior al veredicto; el TXT deja la evidencia inspeccionable.
    try {
      texto = (await pagina.locator("body").innerText()).replace(/\n{2,}/g, "\n");
    } catch {
      /* mantener el último texto bueno */
    }
    mkdirSync(RESULTADOS, { recursive: true });
    writeFileSync(join(RESULTADOS, `vista-${++indiceFixture}.txt`), texto);
    const fila = {
      fixture: etiqueta,
      segundos: Math.round((Date.now() - t0) / 1000),
      score: (texto.match(/\d+\.\d+\/10/) ?? [])[0] ?? null,
      veredicto: (texto.match(VEREDICTOS) ?? [])[0] ?? null,
      banner: (texto.match(/RECIBO DE PAGO|NO IDENTIFICADO/i) ?? [])[0] ?? null,
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
      if (String(fila.banner ?? "").toUpperCase() !== "RECIBO DE PAGO") fallos.push("molde no enrutado (banner)");
    } else if (revision) {
      // Excepción honesta (§10): la foto cruzada no tiene lecturas; el gate
      // debe mandar a REVISIÓN HUMANA, jamás inventar un ok ni rechazar por
      // geometría. El ≥70% no aplica: no hay nada legible que leer.
      if (fila.veredicto !== "REVISIÓN HUMANA") fallos.push("esperado REVISIÓN HUMANA");
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
