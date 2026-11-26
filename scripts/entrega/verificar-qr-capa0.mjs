/**
 * verificar-qr-capa0.mjs — aceptación de la tarea A (PLAN-AGENTE-EXTERNO).
 *
 * Dos imports por la UI real (mismo camino que verificar-importacion.mjs):
 *  1. recibo_pago/pag-01 (SIN QR) → el pre-chequeo debe cortar el camino QR
 *     en pocos ms (log `qr-capa0 prechequeo sin-candidato ms=…`) y NUNCA
 *     pagar el worker vencido (~9.5 s muertos de antes).
 *  2. fixtures/qr-test-capa0.png (CON QR) → el worker debe devolver el
 *     payload EXACTO `MOLDE-SUITE-QR-CAPA0-TEST-2026`. Se captura enganchando
 *     Worker.postMessage (el acta vive en memoria, no en IndexedDB).
 *
 * Uso: bun run dev en apps/tamiz (:3100) y
 *   node scripts/entrega/verificar-qr-capa0.mjs [--base http://localhost:3100]
 * Salida: JSON en scripts/resultados/qr-capa0-<ts>.json · exit 1 si falla.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, "..", "..");
const RESULTADOS = join(RAIZ, "scripts", "resultados");
const MOLDE = join(RAIZ, "apps", "tamiz", "public", "moldes", "recibo_pago.molde.json");
const PAYLOAD_ESPERADO = "MOLDE-SUITE-QR-CAPA0-TEST-2026";

const argBase = process.argv.indexOf("--base");
const BASE = argBase > -1 ? process.argv[argBase + 1] : "http://localhost:3100";

const SIN_QR = join(RAIZ, "apps", "molde-studio", "public", "moldes-genericos", "recibo_pago", "pag-01.png");
const CON_QR = join(RESULTADOS, "fixtures", "qr-test-capa0.png");
const VEREDICTOS = /ÓPTIMA|ADVERTENCIA|RECHAZADA|REVISIÓN HUMANA/;

const { chromium } = await import("playwright");
const navegador = await chromium.launch({
  headless: true,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});
const contexto = await navegador.newContext({ viewport: { width: 420, height: 900 }, permissions: ["camera"] });

const logsQr = [];
const moldeTexto = readFileSync(MOLDE, "utf-8");
await contexto.addInitScript((texto) => {
  try {
    window.localStorage.setItem("tamiz.moldeActivo.v1", texto);
    window.localStorage.setItem("e14-ayuda-vista", "1");
  } catch { /* sin LS el run fallará visible */ }
  // Enganche PASIVO del Worker: captura los payload que el worker QR devuelve
  // al cliente ({id, corrio, payload, tier, ms}). No altera el mensaje.
  const OrigWorker = window.Worker;
  window.__qrPayloads = [];
  window.Worker = class extends OrigWorker {
    constructor(...args) {
      super(...args);
      this.addEventListener("message", (e) => {
        const d = e.data;
        if (d && typeof d === "object" && "payload" in d && typeof d.payload === "string") {
          window.__qrPayloads.push(d.payload);
        }
      });
    }
  };
}, moldeTexto);

const pagina = await contexto.newPage();
pagina.on("console", (msg) => {
  const t = msg.text();
  if (t.includes("qr-capa0")) logsQr.push(t);
});

async function limpiarPwa() {
  await pagina.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await pagina.evaluate(async () => {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
    const claves = await caches.keys();
    await Promise.all(claves.map((k) => caches.delete(k)));
  });
}

async function desarmarAutoCaptura() {
  await pagina.waitForTimeout(1500);
  const auto = pagina.getByRole("button", { name: /Captura automática/i });
  if ((await auto.count()) && (await auto.first().getAttribute("aria-pressed")) === "true") {
    await auto.first().click().catch(() => {});
    await pagina.waitForTimeout(500);
  }
}

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
    await limpiarPwa();
    await pagina.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
    const guia = pagina.getByRole("button", { name: /Entendido|Cerrar|Empezar/i });
    if (await guia.count()) await guia.first().click().catch(() => {});
    await input.waitFor({ state: "attached", timeout: 120000 });
  }
  await desarmarAutoCaptura();
}

async function importarYEsperar(archivo) {
  await prepararImporte();
  const [chooser] = await Promise.all([
    pagina.waitForEvent("filechooser", { timeout: 20000 }),
    pagina.evaluate(() => {
      const i = document.querySelector("input[type=file]");
      if (!i) throw new Error("sin input de importación montado");
      i.click();
    }),
  ]);
  await chooser.setFiles(archivo);
  const t0 = Date.now();
  while (Date.now() - t0 < 300000) {
    await pagina.waitForTimeout(3000);
    const t = await pagina.locator("body").innerText().catch(() => "");
    if (VEREDICTOS.test(t)) return { segundos: Math.round((Date.now() - t0) / 1000), texto: t };
  }
  return { segundos: null, texto: "" };
}

const resultado = { base: BASE, medidoEn: new Date().toISOString(), sinQr: null, conQr: null, fallos: [] };

try {
  await limpiarPwa();
  await pagina.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await pagina.locator("input[type=file]").first().waitFor({ state: "attached", timeout: 120000 });
  const guia = pagina.getByRole("button", { name: /Entendido|Cerrar|Empezar/i });
  if (await guia.count()) await guia.first().click().catch(() => {});
  await desarmarAutoCaptura();

  // ── 1) Documento SIN QR: pre-chequeo corto, jamás worker vencido ──
  logsQr.length = 0;
  const r1 = await importarYEsperar(SIN_QR);
  const pre = logsQr.find((l) => l.includes("prechequeo sin-candidato"));
  const vencido = logsQr.find((l) => l.includes("fin=vencido"));
  const msPre = pre ? Number((pre.match(/ms=(\d+)/) ?? [])[1]) : null;
  resultado.sinQr = { segundos: r1.segundos, logPrechequeo: pre ?? null, msPrechequeo: msPre, workerVencido: vencido ?? null, logs: [...logsQr] };
  if (!r1.segundos) resultado.fallos.push("sin-QR: sin veredicto en 300 s");
  if (!pre) resultado.fallos.push("sin-QR: no hubo log de prechequeo sin-candidato");
  if (msPre != null && msPre > 2000) resultado.fallos.push(`sin-QR: prechequeo lento (${msPre} ms)`);
  if (vencido) resultado.fallos.push("sin-QR: el worker QR pagó el presupuesto vencido");

  // ── 2) Imagen CON QR: payload exacto del worker ──
  logsQr.length = 0;
  await pagina.evaluate(() => { window.__qrPayloads = []; });
  const r2 = await importarYEsperar(CON_QR);
  const payloads = await pagina.evaluate(() => window.__qrPayloads ?? []);
  const finPayload = logsQr.find((l) => l.includes("fin=payload"));
  resultado.conQr = {
    segundos: r2.segundos,
    payloads,
    payloadEsperado: PAYLOAD_ESPERADO,
    logWorker: finPayload ?? null,
    logs: [...logsQr],
  };
  if (!r2.segundos) resultado.fallos.push("con-QR: sin veredicto en 300 s");
  if (!payloads.includes(PAYLOAD_ESPERADO)) resultado.fallos.push(`con-QR: payload exacto no devuelto (recibidos: ${JSON.stringify(payloads)})`);
} finally {
  await contexto.close();
  await navegador.close();
}

mkdirSync(RESULTADOS, { recursive: true });
const salida = join(RESULTADOS, `qr-capa0-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(salida, JSON.stringify(resultado, null, 2));
console.log(`sin-QR: prechequeo ${resultado.sinQr?.msPrechequeo ?? "?"} ms · vencido=${resultado.sinQr?.workerVencido ? "SÍ" : "no"}`);
console.log(`con-QR: payloads=${JSON.stringify(resultado.conQr?.payloads)} · esperado=${PAYLOAD_ESPERADO}`);
console.log(`JSON: ${salida}`);
if (resultado.fallos.length) {
  console.log("FALLOS:", resultado.fallos.join("; "));
  process.exit(1);
}
console.log("OK — tarea A verificada (sin QR no paga 8 s; con QR lee el payload exacto)");
process.exit(0);