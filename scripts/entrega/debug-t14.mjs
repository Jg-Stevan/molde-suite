/**
 * debug-t14.mjs — reproduce el contexto exacto del ESCANEO_FALLIDO con F2 ON
 * observado en la verificación §A (mismo contexto de browser, corrida previa,
 * reload con flags, import) y captura logger.warn del store.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = "/home/z/molde-suite";
const MOLDE = readFileSync(join(RAIZ, "apps/tamiz/public/moldes/recibo_pago.molde.json"), "utf8");
const VER = /ÓPTIMA|ADVERTENCIA|RECHAZADA|REVISIÓN HUMANA|ENVIADA/;
const FALLO = /El escaneo falló|MEMORIA|HEIC/i;

const { chromium } = await import("playwright");
const navegador = await chromium.launch({
  headless: true,
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage", "--js-flags=--max-old-space-size=4096"],
});
const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
p.on("console", (m) => {
  const t = m.text();
  if (m.type() === "error" || m.type() === "warning") {
    if (!/404 \(Not Found\)|Bottom=|Total count|Min=|Max=|Mean=|SD=|Median|quartile|Range=/.test(t)) {
      console.log("[console]", m.type(), t.slice(0, 400));
    }
  }
});
p.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 400)));

async function cargarLimpio(flags) {
  await p.goto("http://localhost:3100/", { waitUntil: "domcontentloaded", timeout: 90000 });
  await p.locator("input[type=file]").first().waitFor({ state: "attached", timeout: 120000 });
  await p.evaluate(async () => {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    for (const k of await caches.keys()) await caches.delete(k);
  }).catch(() => {});
  await p.evaluate(
    ({ molde, flags }) => {
      localStorage.setItem("tamiz.moldeActivo.v1", molde);
      localStorage.setItem("e14-ayuda-vista", "1");
      if (flags) localStorage.setItem("tamiz.flags.v1", JSON.stringify(flags));
      else localStorage.removeItem("tamiz.flags.v1");
    },
    { molde: MOLDE, flags },
  );
  await p.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
  await p.locator("input[type=file]").first().waitFor({ state: "attached", timeout: 120000 });
  await p.waitForTimeout(2000);
  const guia = p.getByRole("dialog");
  if (await guia.count()) {
    const b = guia.first().getByRole("button", { name: /Entendido|Cerrar|Empezar/i });
    if (await b.count()) await b.first().click().catch(() => {});
  }
  await p.waitForTimeout(800);
}

async function importar(nombre, capMs = 150000) {
  const error = await p.evaluate(async (n) => {
    const resp = await fetch(`/dev-fixtures/${n}`);
    if (!resp.ok) return `HTTP ${resp.status}`;
    const blob = await resp.blob();
    const file = new File([blob], n, { type: blob.type || "image/png" });
    const dt = new DataTransfer();
    dt.items.add(file);
    const i = document.querySelector("input[type=file]:not([capture])");
    if (!i) return "sin input";
    i.files = dt.files;
    i.dispatchEvent(new Event("change", { bubbles: true }));
    return null;
  }, nombre);
  if (error) return { veredicto: `INYECCION:${error}`, ms: 0 };
  const t0 = Date.now();
  while (Date.now() - t0 < capMs) {
    await p.waitForTimeout(2000);
    const t = await p.locator("body").innerText().catch(() => "");
    const v = t.match(VER);
    if (v) return { veredicto: v[0], ms: Date.now() - t0 };
    if (FALLO.test(t)) return { veredicto: `FALLO_TEMPRANO: ${(t.match(FALLO) ?? [""])[0]}`, ms: Date.now() - t0 };
  }
  return { veredicto: "SIN_VEREDICTO", ms: Date.now() - t0 };
}

console.log("=== ciclo 1: default flags, import sin-firmas ===");
await cargarLimpio(null);
console.log("ciclo1:", JSON.stringify(await importar("recibo-sin-firmas.png")));

console.log("=== ciclo 2: F2 ON, import rotada-12 (el contexto que falló) ===");
await cargarLimpio({ ocrPrimeraPasadaRapida: true });
console.log("ciclo2:", JSON.stringify(await importar("rotada-12.png")));

await navegador.close();
process.exit(0);
