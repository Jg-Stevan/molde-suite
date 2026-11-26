/**
 * verificacion-agente-a.mjs — protocolo de verificación en navegador (§7 del
 * plan de cierre PLAN-CIERRE-2-AGENTES-2026-11-26) para la rama del Agente A.
 *
 * Vías usadas:
 *  - SIMULACIÓN del propio app (catálogo e14-simulacion-imagenes-v1): el caso
 *    «Óptima» es el demo SANCIONADO del auto-envío (guardado automático REGLA
 *    DE ORO §4) y «Rechazada» el negativo. 100 % sintético (canvas in-app).
 *  - IMPORT con fixtures TRACKED del repo (scripts/resultados/fixtures,
 *    aprobados por el dueño 2026-11-24) vía File in-page (misma técnica del
 *    banco A56 en scripts/entrega/a56-comun.mjs).
 *  - Tarea #14: aislamiento F1/F2 sobre `rotada-12` con flags inyectados en
 *    tamiz.flags.v1 (F1=warpCompartido · F2=ocrPrimeraPasadaRapida), midiendo
 *    tiempo a veredicto (watchdog 240 s).
 *
 * Cada corrida arranca de una CARGA LIMPIA (SW/caches fuera, vista ESCANEAR) —
 * la navegación in-place entre estados resultó frágil en headless (la cámara
 * no existe y su aviso cambia el header; lección del banco A56).
 *
 * EVIDENCIA LOCAL (gitignore §3.3): scripts/resultados/ — NO versionar.
 *
 * Uso: node scripts/entrega/verificacion-agente-a.mjs
 */
import { mkdirSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, "..", "..");
const RESULTADOS = join(RAIZ, "scripts", "resultados");
mkdirSync(RESULTADOS, { recursive: true });

const TS = new Date().toISOString().replace(/[:.]/g, "-");
const JSON_SALIDA = join(RESULTADOS, `verificacion-agente-a-${TS}.json`);
const LOG_SALIDA = join(RESULTADOS, `verificacion-agente-a-${TS}.log`);

const progreso = (linea) => {
  console.log(linea);
  try {
    appendFileSync(LOG_SALIDA, `${new Date().toISOString()} ${linea}\n`);
  } catch {}
};

const APP = "http://localhost:3100/";
const MOLDE_PAGO = readFileSync(join(RAIZ, "apps", "tamiz", "public", "moldes", "recibo_pago.molde.json"), "utf8");
const VEREDICTOS = /ÓPTIMA|ADVERTENCIA|RECHAZADA|REVISIÓN HUMANA|ENVIADA/;

const resultados = { ts: TS, items: [], consolaErrores: [], corridas: [], capturas: [] };
const item = (nombre, ok, detalle) => {
  resultados.items.push({ nombre, ok, detalle });
  progreso(`[${ok ? "OK" : "FALLO"}] ${nombre} — ${detalle}`);
};
const captura = async (pagina, nombre) => {
  await pagina.screenshot({ path: join(RESULTADOS, nombre), fullPage: false }).catch(() => {});
  resultados.capturas.push(nombre);
  progreso(`captura: ${nombre}`);
};

const { chromium } = await import("playwright");
const navegador = await chromium.launch({
  headless: true,
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage", "--js-flags=--max-old-space-size=4096"],
});
const contexto = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
const pagina = await contexto.newPage();
pagina.on("console", (m) => {
  if (m.type() === "error") resultados.consolaErrores.push(m.text().slice(0, 300));
});
pagina.on("pageerror", (e) => resultados.consolaErrores.push(`pageerror: ${String(e).slice(0, 300)}`));

const cuerpo = () => pagina.locator("body").innerText().catch(() => "");
const veredictoDe = (texto) => (texto ? (texto.match(VEREDICTOS) ?? [null])[0] : null);

/** Carga limpia: SW/caches fuera, flags/molde según corrida, guía cerrada. */
async function cargarLimpio({ flags = null, molde = null } = {}) {
  await pagina.goto(APP, { waitUntil: "domcontentloaded", timeout: 90000 });
  await pagina.locator("input[type=file]").first().waitFor({ state: "attached", timeout: 120000 });
  await pagina.evaluate(async () => {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    for (const k of await caches.keys()) await caches.delete(k);
  }).catch(() => {});
  await pagina.evaluate(
    ({ molde, flags }) => {
      if (molde) localStorage.setItem("tamiz.moldeActivo.v1", molde);
      else localStorage.removeItem("tamiz.moldeActivo.v1");
      localStorage.setItem("e14-ayuda-vista", "1");
      if (flags) localStorage.setItem("tamiz.flags.v1", JSON.stringify(flags));
      else localStorage.removeItem("tamiz.flags.v1");
    },
    { molde, flags },
  );
  await pagina.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
  await pagina.locator("input[type=file]").first().waitFor({ state: "attached", timeout: 120000 });
  await pagina.waitForTimeout(1500);
  // Cerrar CUALQUIER diálogo de guía que haya quedado abierto.
  const guia = pagina.getByRole("dialog");
  for (let i = 0; i < 2 && (await guia.count()); i++) {
    const b = guia.first().getByRole("button", { name: /Entendido|Cerrar|Empezar|Siguiente/i });
    if (await b.count()) await b.first().click().catch(() => {});
    await pagina.waitForTimeout(600);
  }
  const auto = pagina.getByRole("button", { name: /Captura automática/i });
  if ((await auto.count()) && (await auto.first().getAttribute("aria-pressed")) === "true") {
    await auto.first().click().catch(() => {});
    await pagina.waitForTimeout(400);
  }
}

/** Abre la galería SIM desde ESCANEAR (cualquiera de las 4 entradas) y elige
 *  la tarjeta del catálogo. */
async function correrSim(idTarjeta, msMax = 240000) {
  let galeria = pagina.getByRole("button", { name: /Abrir la galería de imágenes simuladas/i });
  if (!(await galeria.count())) galeria = pagina.getByRole("button", { name: /^SIMULACIÓN$/i });
  if (!(await galeria.count())) galeria = pagina.getByRole("button", { name: /VER IMÁGENES SIMULADAS/i });
  if (!(await galeria.count())) galeria = pagina.getByRole("button", { name: /PROBAR CON SIMULACIÓN/i });
  if (!(await galeria.count())) throw new Error("sin entrada a la galería SIM");
  await galeria.first().click().catch(() => {});
  await pagina.waitForTimeout(700);
  // Si el primer click solo fijó la fuente y abrió el placeholder, el botón
  // «VER IMÁGENES SIMULADAS» abre el diálogo de la galería.
  const dialogo = pagina.getByRole("dialog");
  if (!(await dialogo.count())) {
    const ver = pagina.getByRole("button", { name: /VER IMÁGENES SIMULADAS/i });
    if (await ver.count()) await ver.first().click().catch(() => {});
    await pagina.waitForTimeout(700);
  }
  const tarjeta = pagina.getByRole("button", { name: new RegExp(idTarjeta, "i") }).first();
  if (!(await tarjeta.count())) throw new Error(`sin tarjeta SIM «${idTarjeta}»`);
  const t0 = Date.now();
  await tarjeta.click();
  while (Date.now() - t0 < msMax) {
    await pagina.waitForTimeout(2000);
    const t = await cuerpo();
    if (VEREDICTOS.test(t)) return { texto: t, ms: Date.now() - t0 };
  }
  return { texto: null, ms: Date.now() - t0 };
}

/** Corrida IMPORT: File REAL in-page servido por /dev-fixtures/. */
async function correrImport(nombre, msMax = 240000) {
  const error = await pagina.evaluate(async (n) => {
    const resp = await fetch(`/dev-fixtures/${n}`);
    if (!resp.ok) return `fetch HTTP ${resp.status}`;
    const blob = await resp.blob();
    const file = new File([blob], n, { type: blob.type || "image/png" });
    const dt = new DataTransfer();
    dt.items.add(file);
    const i = document.querySelector("input[type=file]:not([capture])");
    if (!i) return "sin input de importación";
    i.files = dt.files;
    i.dispatchEvent(new Event("change", { bubbles: true }));
    return null;
  }, nombre);
  if (error) throw new Error(`inyección de archivo falló: ${error}`);
  return esperarDesenlace(nombre, msMax);
}

/** Polling común: veredicto O aviso de fallo temprano (ESCANEO_FALLIDO). */
async function esperarDesenlace(nombre, msMax) {
  const t0 = Date.now();
  while (Date.now() - t0 < msMax) {
    await pagina.waitForTimeout(2000);
    const t = await cuerpo();
    if (VEREDICTOS.test(t)) return { texto: t, ms: Date.now() - t0 };
    if (/El escaneo falló|MEMORIA AGOTADA|HEIC/.test(t)) {
      const motivo = (t.match(/El escaneo falló[^\n]*|MEMORIA AGOTADA[^\n]*|HEIC[^\n]*/) ?? ["?"])[0];
      return { texto: `FALLO_TEMPRANO[${nombre}] ${motivo}`, ms: Date.now() - t0 };
    }
  }
  return { texto: null, ms: Date.now() - t0 };
}

/** Va al HISTORIAL directamente (item de la barra lateral). */
async function irHistorial() {
  const h = pagina.getByRole("button", { name: /HISTORIAL/i }).first();
  if (await h.count()) await h.click().catch(() => {});
  await pagina.waitForTimeout(1200);
}

// ═══════════ 1. CARGA PC sin errores ═══════════
progreso("── 1. Carga PC 1440x900 ──");
await cargarLimpio();
await captura(pagina, "a01-carga-pc.png");
const erroresCarga = resultados.consolaErrores.filter((e) => !/favicon|Manifest|DevTools|404/i.test(e));
item(
  "Carga PC sin errores de consola/hidratación",
  erroresCarga.length === 0,
  erroresCarga.length ? erroresCarga.join(" | ").slice(0, 400) : "0 errores",
);

// ═══════════ 2. SIM «Óptima» → OPTIMA → AUTO-GUARDADO (REGLA DE ORO) ═══════════
progreso("── 2. SIM Óptima → veredicto + auto-guardado ──");
const simOpt = await correrSim("Óptima");
resultados.corridas.push({
  via: "SIM",
  fixture: "optima (canvas in-app)",
  flags: "default",
  veredicto: veredictoDe(simOpt.texto),
  msHastaVeredicto: simOpt.ms,
  watchdog240s: simOpt.ms >= 240000,
});
const veredOpt = veredictoDe(simOpt.texto);
const cuerpoOpt = simOpt.texto ?? "";
await captura(pagina, "a02-sim-optima-veredicto.png");
item(
  "SIM Óptima → veredicto en <240 s",
  !!veredOpt && simOpt.ms < 240000,
  `veredicto=${veredOpt ?? "NINGUNO"} en ${(simOpt.ms / 1000).toFixed(1)}s`,
);
const autoEnviada = /ENVIADO AUTOMÁTICAMENTE|ENVIADA/.test(cuerpoOpt);
const seguir = /SEGUIR ESCANEANDO/i.test(cuerpoOpt);
item(
  "AUTO-GUARDADO sin toque (banner ENVIADA + SEGUIR ESCANEANDO)",
  veredOpt === "ÓPTIMA" ? autoEnviada && seguir : false,
  veredOpt === "ÓPTIMA"
    ? `ENVIADA=${autoEnviada} CTA=${seguir}`
    : `veredicto no alcanzó ÓPTIMA: ${veredOpt}`,
);
if (veredOpt === "ÓPTIMA") {
  await captura(pagina, "a03-sim-banner-enviada.png");
  await irHistorial();
  const cuerpoHist = await cuerpo();
  const filaOk = /ENVIADO AUTOMÁTICAMENTE|ENVIADA|CAPTURA ARCHIVADA|PROCESADO Y GUARDADO|ÓPTIMAS \(1\)/.test(cuerpoHist);
  item("HISTORIAL refleja el auto-guardado (una fila, estado real)", filaOk, filaOk ? "fila visible en HISTORIAL" : `sin fila — cuerpo: ${cuerpoHist.slice(0, 160)}`);
  await captura(pagina, "a04-sim-historial-enviada.png");
}

// ═══════════ 3. SIM «Rechazada» → NO auto-guarda ═══════════
progreso("── 3. SIM Rechazada → NO auto-guarda ──");
await cargarLimpio();
const simRej = await correrSim("Rechazada");
resultados.corridas.push({
  via: "SIM",
  fixture: "rechazada (canvas in-app)",
  flags: "default",
  veredicto: veredictoDe(simRej.texto),
  msHastaVeredicto: simRej.ms,
  watchdog240s: simRej.ms >= 240000,
});
const veredRej = veredictoDe(simRej.texto);
const sinEnviada = !/ENVIADO AUTOMÁTICAMENTE/.test(simRej.texto ?? "");
item(
  "SIM Rechazada → NO auto-guarda (sin banner ENVIADA)",
  veredRej === "RECHAZADA" && sinEnviada,
  `veredicto=${veredRej ?? "NINGUNO"}; banner ausente=${sinEnviada}`,
);
await captura(pagina, "a05-sim-rechazada.png");
await irHistorial();
const evidSim = /CAPTURA ARCHIVADA|RECHAZADA/.test(await cuerpo());
item("La rechazada queda archivada como evidencia (sin envío)", evidSim, evidSim ? "fila de evidencia visible" : "sin fila");
await captura(pagina, "a05b-sim-historial-evidencia.png");

// ═══════════ 4. IMPORT legible con obligatorio faltante → NO auto-guarda ═══════════
progreso("── 4. IMPORT recibo-sin-firmas (legible, firmas faltantes) ──");
await cargarLimpio({ molde: MOLDE_PAGO });
const imp1 = await correrImport("recibo-sin-firmas.png");
resultados.corridas.push({
  via: "IMPORT",
  fixture: "recibo-sin-firmas.png",
  flags: "default",
  veredicto: veredictoDe(imp1.texto),
  msHastaVeredicto: imp1.ms,
  watchdog240s: imp1.ms >= 240000,
});
const veredImp = veredictoDe(imp1.texto);
const sinEnviada2 = !/ENVIADO AUTOMÁTICAMENTE/.test(imp1.texto ?? "");
item(
  "Legible con obligatorio faltante → NO auto-guarda",
  !!veredImp && veredImp !== "ÓPTIMA" && veredImp !== "ENVIADA" && sinEnviada2,
  `veredicto=${veredImp ?? "NINGUNO"}; banner ausente=${sinEnviada2}`,
);
await captura(pagina, "a06-import-sin-firmas.png");
await irHistorial();
const evidencia = /CAPTURA ARCHIVADA/.test(await cuerpo());
item(
  "La captura queda como evidencia archivada (sin envío)",
  evidencia,
  evidencia ? "fila CAPTURA ARCHIVADA visible" : "sin fila de evidencia",
);
await captura(pagina, "a07-import-historial-evidencia.png");

// ═══════════ 5. Tarea #14: aislamiento F1/F2 sobre rotada-12 ═══════════
const CASOS14 = [
  { nombre: "default (F2/F1 OFF)", flags: null, cap: 210000, etiqueta: "base" },
  { nombre: "solo F1 (warpCompartido)", flags: { warpCompartido: true }, cap: 210000, etiqueta: "f1" },
  { nombre: "solo F2 (ocrPrimeraPasadaRapida)", flags: { ocrPrimeraPasadaRapida: true }, cap: 210000, etiqueta: "f2" },
];
for (const caso of CASOS14) {
  progreso(`── 5. Tarea #14: ${caso.nombre} ──`);
  await cargarLimpio({ molde: MOLDE_PAGO, flags: caso.flags });
  const r = await correrImport("rotada-12.png", caso.cap);
  resultados.corridas.push({
    via: "IMPORT",
    fixture: "rotada-12.png",
    flags: caso.flags,
    veredicto: veredictoDe(r.texto),
    msHastaVeredicto: r.ms,
    watchdog240s: r.ms >= 240000,
  });
  const v = veredictoDe(r.texto);
  item(
    `Tarea #14 ${caso.nombre}: corrida sin watchdog`,
    !!v && r.ms < 240000,
    v ? `veredicto=${v} en ${(r.ms / 1000).toFixed(1)}s` : `SIN VEREDICTO en ${(r.ms / 1000).toFixed(0)}s (cuelgue — consistente con #14)`,
  );
  await captura(pagina, `a08-t14-${caso.etiqueta}.png`);
}
progreso("── 5b. F2+F1 ambas ON: evidencia de corrida previa 2026-11-26T19-06-35 — 301 s SIN veredicto (cuelgue reproducido en escritorio) ──");

// ═══════════ 6. Móvil 390x844 ═══════════
progreso("── 6. Viewport móvil 390x844 ──");
const paginaMovil = await contexto.newPage();
await paginaMovil.setViewportSize({ width: 390, height: 844 });
paginaMovil.on("pageerror", (e) => resultados.consolaErrores.push(`movil pageerror: ${String(e).slice(0, 300)}`));
await paginaMovil.goto(APP, { waitUntil: "domcontentloaded", timeout: 90000 });
await paginaMovil.locator("input[type=file]").first().waitFor({ state: "attached", timeout: 120000 });
const guiaM = paginaMovil.getByRole("dialog");
if (await guiaM.count()) {
  const b = guiaM.first().getByRole("button", { name: /Entendido|Cerrar|Empezar/i });
  if (await b.count()) await b.first().click().catch(() => {});
}
const sinScrollX = await paginaMovil.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2);
item("Móvil 390x844 carga sin scroll horizontal", sinScrollX, `scrollWidth OK=${sinScrollX}`);
await captura(paginaMovil, "a09-carga-movil.png");
await paginaMovil.close();

await navegador.close();

// ═══════════ Resumen ═══════════
const fallos = resultados.items.filter((i) => !i.ok);
resultados.resumen = `${resultados.items.length - fallos.length}/${resultados.items.length} items OK`;
writeFileSync(JSON_SALIDA, JSON.stringify(resultados, null, 2));
progreso(`RESULTADOS → ${JSON_SALIDA}`);
progreso(`Resumen: ${resultados.resumen}`);
for (const i of resultados.items) progreso(`  [${i.ok ? "OK" : "FALLO"}] ${i.nombre} — ${i.detalle}`);
process.exit(0);
