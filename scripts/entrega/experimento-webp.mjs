/**
 * experimento-webp.mjs — A/B PNG vs WebP sobre la MISMA foto, sin tocar el
 * asset md5: parchea `OffscreenCanvas.prototype.convertToBlob` DENTRO del
 * worker vía CDP (Runtime.evaluate sobre la sesión del worker) para forzar
 * image/webp. Mide el enhance real (elapsedMs interno + blob) con cada códec y
 * guarda ambos blobs en host y en /sdcard/Pictures/Tamiz/ para verlos en el
 * teléfono.
 *
 * Uso: TAMIZ_ADB_SERIAL=... node scripts/entrega/experimento-webp.mjs [foto.jpg]
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ADB, RESULTADOS, serialAdb } from "./a56-comun.mjs";

const argDe = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const CDP = argDe("--cdp") ?? "http://127.0.0.1:9223";
const FOTO = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "20261123_201944.jpg";
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function objetivoPagina() {
  const lista = await (await fetch(`${CDP}/json/list`)).json();
  return lista.find((t) => t.type === "page" && t.url.includes("localhost:3100")) ?? lista.find((t) => t.type === "page") ?? null;
}
const pagina = await objetivoPagina();
if (!pagina) { console.error("sin pestaña de la app"); process.exit(1); }
const ws = new WebSocket(pagina.webSocketDebuggerUrl);
await new Promise((res, rej) => { const to = setTimeout(() => rej(new Error("timeout ws")), 10000); ws.addEventListener("open", () => { clearTimeout(to); res(); }); ws.addEventListener("error", () => rej(new Error("error ws"))); });
let id = 0; const pend = new Map(); const oyentes = [];
ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); if (m.error) rej(new Error(m.error.message)); else res(m.result); return; } for (const o of oyentes) o(m); });
function enviar(method, params = {}, sessionId, timeout = 180000) {
  const i = ++id;
  return new Promise((res, rej) => { const to = setTimeout(() => { pend.delete(i); rej(new Error(`timeout ${method}`)); }, timeout); pend.set(i, { res: (v) => { clearTimeout(to); res(v); }, rej: (e) => { clearTimeout(to); rej(e); } }); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); });
}

const ENHANCE_EXPR = (foto) => `(async () => {
  const w = window.__webpWorker;
  let seq = 0;
  const enviarW = (msg, tr) => new Promise((res, rej) => {
    const ts = ++seq; let to;
    const h = (e) => { if (e.data?.ts === ts) { clearTimeout(to); w.removeEventListener("message", h); res(e.data); } };
    w.addEventListener("message", h);
    to = setTimeout(() => { w.removeEventListener("message", h); rej(new Error("timeout " + msg.type)); }, 90000);
    w.postMessage({ ...msg, ts }, tr || []);
  });
  const resp = await fetch("/dev-fixtures/reales/${foto}");
  const img = await createImageBitmap(await resp.blob());
  const s = 400 / Math.max(img.width, img.height);
  const small = await createImageBitmap(img, { resizeWidth: Math.round(img.width * s), resizeHeight: Math.round(img.height * s), resizeQuality: "low" });
  const det = await enviarW({ type: "detect", bitmap: small }, [small]);
  const corners = Array.from(det.corners);
  const wr = await enviarW({ type: "warp", bitmap: img, quad: new Float32Array(corners), manual: true }, [img]);
  const t = performance.now();
  const enh = await enviarW({ type: "enhance", bitmap: wr.bitmap, mode: "bw", maxLongSide: 4032 }, [wr.bitmap]);
  const enhanceHostMs = Math.round(performance.now() - t);
  const b64 = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.readAsDataURL(enh.blob); });
  return { enhanceHostMs, workerMs: enh.elapsedMs ?? null, blobType: enh.blob.type, mime: enh.mime ?? null, bytes: enh.blob.size, w: enh.w, h: enh.h, b64 };
})()`;

async function correrWorker(tag, patchWebp) {
  // Registrar el listener ANTES de crear el worker (el attach puede llegar al instante).
  const esperaAdjunto = new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error("attach timeout")), 40000);
    const o = (m) => { if (m.method === "Target.attachedToTarget" && m.params?.targetInfo?.type === "worker" && String(m.params?.targetInfo?.url ?? "").includes(`detection-worker.js?${tag}=1`)) { clearTimeout(to); oyentes.splice(oyentes.indexOf(o), 1); res(m.params); } };
    oyentes.push(o);
  });
  // Worker nuevo y limpio por modo.
  await enviar("Runtime.evaluate", {
    expression: `(() => { try { window.__webpWorker && window.__webpWorker.terminate(); } catch {}
      const w = new Worker("/scanner/detection-worker.js?${tag}=1"); window.__webpWorker = w;
      window.__webpReady = new Promise((res, rej) => { const to = setTimeout(() => rej(new Error("ready timeout")), 45000);
        const h = (e) => { if (e.data?.type === "ready") { clearTimeout(to); w.removeEventListener("message", h); res(); } };
        w.addEventListener("message", h); });
      return true; })()`,
    returnByValue: true,
  });
  const adjunto = await esperaAdjunto;
  const sid = adjunto.sessionId;
  await enviar("Runtime.enable", {}, sid);
  await enviar("Runtime.evaluate", { expression: `window.__webpReady.then(() => true)`, returnByValue: true, awaitPromise: true }, undefined, 60000);
  if (patchWebp) {
    const p = await enviar("Runtime.evaluate", {
      expression: `(() => { const o = OffscreenCanvas.prototype.convertToBlob;
        OffscreenCanvas.prototype.convertToBlob = function(opts){ return o.call(this, Object.assign({}, opts, { type: "image/webp", quality: 0.9 })); };
        return { parcheado: true, tipo: OffscreenCanvas.prototype.convertToBlob.toString().includes("webp") }; })()`,
      returnByValue: true,
    }, sid);
    console.log(`  patch convertToBlob→webp: ${JSON.stringify(p?.result?.value)}`);
    const v = await enviar("Runtime.evaluate", {
      expression: `(async () => { const c = new OffscreenCanvas(16, 16); const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 16, 16); const b = await c.convertToBlob({ type: "image/png" }); return b.type; })()`,
      returnByValue: true,
      awaitPromise: true,
    }, sid);
    console.log(`  verificación dentro del worker → ${v?.result?.value}`);
  }
  const r = await enviar("Runtime.evaluate", { expression: ENHANCE_EXPR(FOTO), returnByValue: true, awaitPromise: true }, undefined, 180000);
  if (r?.exceptionDetails) console.error("  excepción:", JSON.stringify(r.exceptionDetails).slice(0, 300));
  const d = r?.result?.value ?? {};
  const ext = patchWebp ? "webp" : "png";
  if (d.b64) {
    const archivoHost = join(RESULTADOS, `webp-ab-${ext}-${FOTO.replace(/\.[a-z]+$/, "")}.${ext}`);
    writeFileSync(archivoHost, Buffer.from(d.b64, "base64"));
    d.hostFile = archivoHost;
    const serial = serialAdb();
    try {
      execFileSync(ADB, serial ? ["-s", serial, "push", archivoHost, `/sdcard/Pictures/Tamiz/${ext.toUpperCase()}-A13.${ext}`] : ["push", archivoHost, `/sdcard/Pictures/Tamiz/${ext.toUpperCase()}-A13.${ext}`], { stdio: "ignore" });
      d.telefono = `/sdcard/Pictures/Tamiz/${ext.toUpperCase()}-A13.${ext}`;
    } catch { /* push best-effort */ }
  }
  delete d.b64;
  return d;
}

try {
  await enviar("Runtime.evaluate", { expression: `(() => { document.querySelectorAll("video").forEach((v)=>{try{v.srcObject&&v.srcObject.getTracks().forEach(t=>t.stop())}catch{}}); return true; })()`, returnByValue: true }).catch(() => {});
  await enviar("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  console.log(`PNG (control) ${FOTO} …`);
  const png = await correrWorker("pngctl", false);
  console.log(`  ${png.enhanceHostMs} ms host · ${Math.round(png.workerMs)} ms worker · ${png.mime} · ${png.bytes} B · ${png.w}x${png.h}`);
  await dormir(1000);
  console.log(`WebP (parche runtime) ${FOTO} …`);
  const webp = await correrWorker("webpctl", true);
  console.log(`  ${webp.enhanceHostMs} ms host · ${Math.round(webp.workerMs)} ms worker · ${webp.mime} · ${webp.bytes} B · ${webp.w}x${webp.h}`);
  const diff = {
    foto: FOTO,
    medidoEn: new Date().toISOString(),
    png,
    webp,
    deltaMs: png.enhanceHostMs - webp.enhanceHostMs,
    factor: +(png.enhanceHostMs / Math.max(1, webp.enhanceHostMs)).toFixed(2),
    deltaBytes: webp.bytes - png.bytes,
  };
  const salida = join(RESULTADOS, `webp-ab-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(salida, JSON.stringify(diff, null, 2));
  console.log(`\nDIFERENCIA: ${diff.deltaMs} ms más rápido con WebP (${diff.factor}×) · ${diff.deltaBytes} B`);
  console.log(`JSON: ${salida}`);
  console.log(`archivos: ${png.hostFile} | ${webp.hostFile}`);
  ws.close();
  process.exit(0);
} catch (e) {
  console.error(`FALLA: ${e instanceof Error ? e.message : e}`);
  ws.close();
  process.exit(1);
}