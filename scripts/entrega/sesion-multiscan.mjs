/**
 * sesion-multiscan.mjs — reproduce el escenario A56 de la tarea #14: N
 * escaneos CONSECUTIVOS en la MISMA sesión del navegador (sin recargas entre
 * corridas — el reciclado post-veredicto de F4 queda en juego), con flags
 * inyectados. Mide tiempo a veredicto por corrida.
 *
 * Uso: node scripts/entrega/sesion-multiscan.mjs <fixture> <n> '<flagsJSON>'
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = "/home/z/molde-suite";
const MOLDE = readFileSync(join(RAIZ, "apps/tamiz/public/moldes/recibo_pago.molde.json"), "utf8");
const VER = /ÓPTIMA|ADVERTENCIA|RECHAZADA|REVISIÓN HUMANA|ENVIADA/;
const fixture = process.argv[2] ?? "rotada-12.png";
const N = Number(process.argv[3] ?? 4);
const flags = process.argv[4] ? JSON.parse(process.argv[4]) : null;

const { chromium } = await import("playwright");
const navegador = await chromium.launch({
  headless: true,
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage", "--js-flags=--max-old-space-size=4096"],
});
const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
p.on("console", (m) => {
  const t = m.text();
  if (m.type() === "error" || m.type() === "warning") console.log("[console]", m.type(), t.slice(0, 260));
});
p.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 400)));

await p.goto("http://localhost:3100/", { waitUntil: "domcontentloaded", timeout: 90000 });
await p.locator("input[type=file]").first().waitFor({ state: "attached", timeout: 120000 });
await p.waitForTimeout(2500);
const guia = p.getByRole("dialog");
if (await guia.count()) {
  const b = guia.first().getByRole("button", { name: /Entendido|Cerrar|Empezar/i });
  if (await b.count()) await b.first().click().catch(() => {});
}
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

const resultados = [];
for (let i = 1; i <= N; i++) {
  console.log(`--- corrida ${i}/${N} (${fixture}) ---`);
  const error = await p.evaluate(async (n) => {
    const resp = await fetch(`/dev-fixtures/${n}`);
    if (!resp.ok) return `HTTP ${resp.status}`;
    const blob = await resp.blob();
    const file = new File([blob], n, { type: blob.type || "image/png" });
    const dt = new DataTransfer();
    dt.items.add(file);
    const inp = document.querySelector("input[type=file]:not([capture])");
    if (!inp) return "sin input";
    inp.files = dt.files;
    inp.dispatchEvent(new Event("change", { bubbles: true }));
    return null;
  }, fixture);
  if (error) { console.log("inyección falló:", error); break; }
  const t0 = Date.now();
  let veredicto = null;
  while (Date.now() - t0 < 120000) {
    await p.waitForTimeout(2000);
    const t = await p.locator("body").innerText().catch(() => "");
    const m = t.match(VER);
    if (m) { veredicto = m[0]; break; }
  }
  const ms = Date.now() - t0;
  resultados.push({ corrida: i, veredicto, ms, cuelgue: !veredicto });
  console.log(`corrida ${i}: veredicto=${veredicto ?? "NINGUNO"} en ${(ms / 1000).toFixed(1)}s${!veredicto ? "  ← CUELGE" : ""}`);
  if (!veredicto) break;
  // Volver a ESCANEAR SIN recargar: el CTA/botón del propio app.
  const seguir = p.getByRole("button", { name: /SEGUIR ESCANEANDO/i });
  if (await seguir.count()) {
    await seguir.first().click();
    await p.waitForTimeout(1500);
  } else {
    const repetir = p.getByRole("button", { name: /REPETIR CAPTURA|ESCANEAR/i });
    if (await repetir.count()) { await repetir.first().click(); await p.waitForTimeout(1500); }
    else {
      const esc = p.getByRole("button", { name: /Escanear documento/i });
      if (await esc.count()) { await esc.first().click(); await p.waitForTimeout(1500); }
    }
  }
}
console.log("RESUMEN:", JSON.stringify(resultados));
writeFileSync(join(RAIZ, "scripts/resultados/sesion-multiscan-ultimo.json"), JSON.stringify({ fixture, flags, N, resultados }, null, 2));
await navegador.close();
process.exit(0);
