import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const RAIZ = "/home/z/molde-suite";
const APP = "http://localhost:3100/";
const MOLDE = readFileSync(join(RAIZ, "apps/tamiz/public/moldes/recibo_pago.molde.json"), "utf8");
const VER = /ÓPTIMA|ADVERTENCIA|RECHAZADA|REVISIÓN HUMANA|ENVIADA/;
const nombre = process.argv[2] ?? "recibo-completo-sintetico.png";
const flagsArg = process.argv[3] ? JSON.parse(process.argv[3]) : null;
if (process.argv[3]) process.env.TAMIZ_FLAGS = process.argv[3];

const { chromium } = await import("playwright");
const navegador = await chromium.launch({ headless: true, args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage", "--js-flags=--max-old-space-size=4096"] });
const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const errs = [];
p.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); });

await p.goto(APP, { waitUntil: "domcontentloaded", timeout: 90000 });
await p.locator("input[type=file]").first().waitFor({ state: "attached", timeout: 120000 });
const guia = p.getByRole("button", { name: /Entendido|Cerrar|Empezar/i });
if (await guia.count()) await guia.first().click().catch(() => {});
await p.evaluate((m) => {
  localStorage.setItem("tamiz.moldeActivo.v1", m);
  localStorage.setItem("e14-ayuda-vista", "1");
  if (window.__flags) localStorage.setItem("tamiz.flags.v1", JSON.stringify(window.__flags));
}, MOLDE).catch(()=>{});
// Limpieza PWA (un CSS/JS cacheado viejo contamina la corrida — lección banco).
await p.evaluate(async () => {
  for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  for (const k of await caches.keys()) await caches.delete(k);
  localStorage.setItem("tamiz.moldeActivo.v1", "");
  localStorage.setItem("e14-ayuda-vista", "1");
  if (null) localStorage.setItem("tamiz.flags.v1", JSON.stringify(FLAGS_PLACEHOLDER));
  else localStorage.removeItem("tamiz.flags.v1");
  return true;
}).catch((e) => console.log("limpieza eval fallo:", e.message));

await p.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
await p.locator("input[type=file]").first().waitFor({ state: "attached", timeout: 120000 });
await p.waitForTimeout(2000);
const auto = p.getByRole("button", { name: /Captura automática/i });
if ((await auto.count()) && (await auto.first().getAttribute("aria-pressed")) === "true") { await auto.first().click(); }

await p.evaluate(async (n) => {
  const resp = await fetch(`/dev-fixtures/${n}`);
  const blob = await resp.blob();
  const file = new File([blob], n, { type: blob.type || "image/png" });
  const dt = new DataTransfer();
  dt.items.add(file);
  const i = document.querySelector("input[type=file]:not([capture])");
  i.files = dt.files;
  i.dispatchEvent(new Event("change", { bubbles: true }));
}, nombre);

const t0 = Date.now();
let cuerpo = "";
while (Date.now() - t0 < 300000) {
  await p.waitForTimeout(2500);
  cuerpo = await p.locator("body").innerText().catch(() => "");
  if (VER.test(cuerpo)) break;
}
const ms = Date.now() - t0;
await p.waitForTimeout(2500); // pintado de la tarjeta
console.log(`veredicto=${(cuerpo.match(VER) ?? ["NINGUNO"])[0]} en ${(ms/1000).toFixed(1)}s`);
console.log("ENVIADA banner:", /ENVIADO AUTOMÁTICAMENTE/.test(cuerpo), "| SEGUIR:", /SEGUIR ESCANEANDO/i.test(cuerpo));
const idx = cuerpo.indexOf("MOLDE: RECIBO DE PAGO");
console.log("--- CAMPOS ---");
console.log(cuerpo.slice(Math.max(0, idx - 700), idx + 300));
await p.screenshot({ path: join(RAIZ, "scripts/resultados/a02b-veredicto-optimo-v2.png") });
const nav = p.getByRole("button", { name: /HISTORIAL/i });
if (await nav.count()) {
  await nav.first().click().catch(() => {});
  await p.waitForTimeout(1200);
  const hist = await p.locator("body").innerText().catch(() => "");
  const i2 = hist.indexOf("DOCUMENTO");
  console.log("--- HISTORIAL ---");
  console.log(hist.slice(Math.max(0, i2), i2 + 500));
  await p.screenshot({ path: join(RAIZ, "scripts/resultados/a04b-historial-v2.png") });
}
writeFileSync(join(RAIZ, "scripts/resultados/scan-uno-ultimo.txt"), cuerpo);
console.log("errores consola:", errs.filter(e=>!/favicon|Manifest/i.test(e)).slice(0,5));
await navegador.close();
process.exit(0);
