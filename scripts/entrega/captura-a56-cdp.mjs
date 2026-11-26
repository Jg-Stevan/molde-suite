// Captura PNG de la página visible del A56 por CDP crudo (sin Playwright):
// conecta al target de /json/list y pide Page.captureScreenshot.
// Uso: node scripts/entrega/captura-a56-cdp.mjs [salida.png] [http://127.0.0.1:9223]
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const salida = process.argv[2] ?? join("scripts", "resultados", "a56-ver.png");
const CDP = process.argv[3] ?? "http://127.0.0.1:9223";

const lista = await (await fetch(`${CDP}/json/list`)).json();
const paginas = lista.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
if (paginas.length === 0) {
  console.error("sin páginas CDP");
  process.exit(1);
}
const objetivo = paginas.find((t) => (t.url ?? "").includes(":3100")) ?? paginas[0];
const ws = new WebSocket(objetivo.webSocketDebuggerUrl);
const png = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("timeout CDP 20 s")), 20_000);
  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ id: 1, method: "Page.captureScreenshot", params: { format: "png" } }));
  });
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id !== 1) return;
    clearTimeout(timer);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(Buffer.from(msg.result.data, "base64"));
  });
  ws.addEventListener("error", (e) => {
    clearTimeout(timer);
    reject(new Error(String(e.message ?? e)));
  });
});
ws.close();
writeFileSync(salida, png);
console.log(`PNG ${salida} · ${png.length} bytes · url=${objetivo.url}`);
