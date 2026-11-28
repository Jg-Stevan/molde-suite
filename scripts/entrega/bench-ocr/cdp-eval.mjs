/**
 * cdp-eval.mjs — evalúa una expresión en la pestaña de Chrome de un teléfono.
 * Uso: bun cdp-eval.mjs --cdp http://127.0.0.1:9223 --match 127.0.0.1:3100 \
 *        --expr 'JSON.stringify(window.__cameraChoice)' [--archivo expr.js] [--salida out.json]
 */
import { readFileSync, writeFileSync } from "node:fs";

const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const CDP = arg("--cdp") ?? "http://127.0.0.1:9223";
const MATCH = arg("--match") ?? "3100";
const exprArg = arg("--expr");
const expr = arg("--archivo") ? readFileSync(arg("--archivo"), "utf8") : exprArg;
if (!expr) { console.error("falta --expr o --archivo"); process.exit(1); }

const lista = await (await fetch(`${CDP}/json/list`)).json();
const pag = lista.find((p) => p.type === "page" && (p.url ?? "").includes(MATCH));
if (!pag) { console.error(`sin pestaña que incluya «${MATCH}»`); process.exit(1); }

const ws = new WebSocket(pag.webSocketDebuggerUrl);
let id = 0;
const pend = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); p(m); }
};
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
const enviar = (method, params = {}) =>
  new Promise((res, rej) => {
    const n = ++id;
    pend.set(n, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
    ws.send(JSON.stringify({ id: n, method, params }));
  });

const r = await enviar("Runtime.evaluate", {
  expression: expr,
  awaitPromise: true,
  returnByValue: true,
  timeout: 290000,
});
ws.close();
if (r.exceptionDetails) {
  const d = r.exceptionDetails.exception?.description ?? r.exceptionDetails.text;
  console.error(`excepción: ${String(d).slice(0, 500)}`);
  process.exit(2);
}
const v = r.result?.value;
if (arg("--imagen")) {
  // El valor debe ser un dataURL de imagen: decodificar a binario.
  if (typeof v !== "string" || !v.startsWith("data:image/")) {
    console.error(`--imagen esperaba dataURL, llegó ${typeof v}`);
    process.exit(3);
  }
  const b64 = v.slice(v.indexOf(",") + 1);
  writeFileSync(arg("--imagen"), Buffer.from(b64, "base64"));
  console.log(`imagen ${arg("--imagen")} (${Buffer.from(b64, "base64").length} bytes)`);
} else if (arg("--salida")) {
  writeFileSync(arg("--salida"), typeof v === "string" ? v : JSON.stringify(v, null, 1));
  console.log(`guardado ${arg("--salida")}`);
} else {
  console.log(typeof v === "string" ? v : JSON.stringify(v, null, 1));
}
