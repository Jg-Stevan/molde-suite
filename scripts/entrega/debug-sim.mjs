import { chromium } from "playwright";
const navegador = await chromium.launch({ headless: true, args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage", "--js-flags=--max-old-space-size=4096"] });
const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
p.on("console", (m) => { const t = m.text(); if (m.type() === "error" || m.type() === "warning") console.log("[console]", m.type(), t.slice(0, 400)); });
p.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 500)));
await p.goto("http://localhost:3100/", { waitUntil: "domcontentloaded", timeout: 90000 });
await p.locator("input[type=file]").first().waitFor({ state: "attached", timeout: 120000 });
await p.waitForTimeout(2500);
const modal = p.getByRole("dialog", { name: /Cómo funciona/i });
if (await modal.count()) {
  const b = modal.getByRole("button", { name: /Entendido/i });
  if (await b.count()) { await b.click(); console.log("modal cerrado"); }
}
await p.waitForTimeout(1000);
const ver = p.getByRole("button", { name: /VER IMÁGENES SIMULADAS|SIMULACIÓN/i });
console.log("botones sim:", await ver.count());
await ver.first().click();
await p.waitForTimeout(900);
const tarjetas = await p.locator("button", { hasText: "Óptima" }).count();
console.log("tarjetas Óptima:", tarjetas);
await p.screenshot({ path: "scripts/resultados/dbg-galeria.png" });
if (tarjetas) {
  await p.locator("button", { hasText: "Óptima" }).first().click();
  let listo = false;
  for (let i = 0; i < 45 && !listo; i++) {
    await p.waitForTimeout(2000);
    const t = await p.locator("body").innerText().catch(() => "");
    if (/ÓPTIMA|ADVERTENCIA|RECHAZADA|REVISIÓN HUMANA|ENVIADA|escaneo falló/i.test(t)) {
      console.log("estado tras", (i + 1) * 2, "s:", (t.match(/ÓPTIMA|ADVERTENCIA|RECHAZADA|REVISIÓN HUMANA|ENVIADA|El escaneo falló[^\n]*/) ?? ["?"])[0]);
      listo = true;
    }
  }
  if (!listo) console.log("sin cambio de estado en 90 s");
  await p.screenshot({ path: "scripts/resultados/dbg-sim-resultado.png" });
}
await navegador.close();
process.exit(0);
