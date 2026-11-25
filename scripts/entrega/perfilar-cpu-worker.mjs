/**
 * perfilar-cpu-worker.mjs — Fase 2 del perfilado A13: CPU fino del hilo del
 * worker de detección (donde vive OpenCV/WASM y el encode PNG del bw).
 *
 * Usa el WebSocket nativo de Node 24 + Target.setAutoAttach flatten para
 * adjuntarse al Dedicated Worker y ejecutar Profiler.start/stop SOBRE SU
 * SESIÓN (no la del renderer). Agrega self-time por función y separa WASM vs
 * JS. No toca detection-worker.js ni la app: solo lectura.
 *
 * Uso: TAMIZ_ADB_SERIAL=... node scripts/entrega/perfilar-cpu-worker.mjs \
 *        [--fotos a.jpg,b.jpg] [--cdp http://127.0.0.1:9223] [--intervalo 250]
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { RESULTADOS } from "./a56-comun.mjs";

const argDe = (n) => {
  const i = process.argv.indexOf(n);
  return i > -1 ? process.argv[i + 1] : null;
};
const CDP = argDe("--cdp") ?? "http://127.0.0.1:9223";
const INTERVALO = Number(argDe("--intervalo") ?? 250);
const FOTOS = (argDe("--fotos") ?? "20261123_201944.jpg,20261123_223112.jpg").split(",");
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function objetivoPagina() {
  const lista = await (await fetch(`${CDP}/json/list`)).json();
  return (
    lista.find((t) => t.type === "page" && t.url.includes("localhost:3100")) ??
    lista.find((t) => t.type === "page") ??
    null
  );
}

const pagina = await objetivoPagina();
if (!pagina) {
  console.error("sin pestaña: abre la app en Chrome del teléfono");
  process.exit(1);
}
const ws = new WebSocket(pagina.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  const to = setTimeout(() => rej(new Error("timeout websocket CDP")), 10000);
  ws.addEventListener("open", () => { clearTimeout(to); res(); });
  ws.addEventListener("error", () => { clearTimeout(to); rej(new Error("error websocket CDP")); });
});

let id = 0;
const pendientes = new Map();
const oyentes = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pendientes.has(m.id)) {
    const { res, rej } = pendientes.get(m.id);
    pendientes.delete(m.id);
    if (m.error) rej(new Error(m.error.message));
    else res(m.result);
    return;
  }
  for (const o of oyentes) o(m);
});
function enviar(method, params = {}, sessionId, timeout = 120000) {
  const i = ++id;
  return new Promise((res, rej) => {
    const to = setTimeout(() => { pendientes.delete(i); rej(new Error(`timeout ${method}`)); }, timeout);
    pendientes.set(i, {
      res: (v) => { clearTimeout(to); res(v); },
      rej: (e) => { clearTimeout(to); rej(e); },
    });
    ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

function agregarPerfil(profile) {
  const nodos = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  let total = 0;
  for (let i = 0; i < samples.length; i++) {
    const dt = deltas[i] ?? 0;
    total += dt;
    self.set(samples[i], (self.get(samples[i]) ?? 0) + dt);
  }
  const filas = [...self.entries()]
    .map(([nid, us]) => {
      const n = nodos.get(nid);
      const cf = n?.callFrame ?? {};
      const url = cf.url ?? "";
      const esWasm = /wasm/i.test(url) || /^wasm-function/.test(cf.functionName ?? "");
      return {
        funcion: cf.functionName || "(anonymous)",
        archivo: url.split("/").pop() || url,
        linea: cf.lineNumber ?? null,
        selfMs: +(us / 1000).toFixed(1),
        pct: total ? +((us / total) * 100).toFixed(1) : 0,
        wasm: esWasm,
        hits: n?.hitCount ?? 0,
      };
    })
    .sort((a, b) => b.selfMs - a.selfMs);
  const totalMs = +(total / 1000).toFixed(1);
  const wasmMs = filas.filter((f) => f.wasm).reduce((a, b) => a + b.selfMs, 0);
  const jsMs = filas.filter((f) => !f.wasm).reduce((a, b) => a + b.selfMs, 0);
  return {
    totalMs,
    wasmMs: +wasmMs.toFixed(1),
    jsMs: +jsMs.toFixed(1),
    wasmPct: totalMs ? +((wasmMs / totalMs) * 100).toFixed(1) : 0,
    top: filas.slice(0, 20),
  };
}

const resultados = [];
try {
  const esperaWorker = new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error("worker no se auto-adjuntó en 40 s")), 40000);
    oyentes.push((m) => {
      if (
        m.method === "Target.attachedToTarget" &&
        m.params?.targetInfo?.type === "worker" &&
        /detection-worker\.js\?cpu=1/.test(m.params?.targetInfo?.url ?? "")
      ) { clearTimeout(to); res(m.params); }
    });
  });
  await enviar("Runtime.evaluate", {
    expression: `(() => { document.querySelectorAll("video").forEach((v) => { try { v.srcObject && v.srcObject.getTracks().forEach((t) => t.stop()); } catch {} }); return true; })()`,
    returnByValue: true,
  }).catch(() => undefined);
  await enviar("Runtime.evaluate", {
    expression: `(() => {
      try { window.__probeWorker && window.__probeWorker.terminate(); } catch {}
      try { window.__recorteWorker && window.__recorteWorker.terminate(); } catch {}
      try { window.__cpuWorker && window.__cpuWorker.terminate(); } catch {}
      const w = new Worker("/scanner/detection-worker.js?cpu=1");
      window.__cpuWorker = w;
      window.__cpuReady = new Promise((res, rej) => {
        const to = setTimeout(() => rej(new Error("timeout ready worker (45 s)")), 45000);
        const h = (e) => {
          const d = e.data;
          if (d && d.type === "ready") { clearTimeout(to); w.removeEventListener("message", h); res(d); }
          else if (d && d.type === "error") { clearTimeout(to); w.removeEventListener("message", h); rej(new Error(d.message)); }
        };
        w.addEventListener("message", h);
      });
      return true;
    })()`,
    returnByValue: true,
  });
  // Auto-adjuntar DESPUÉS de crear el worker nuevo: si se hace antes, se
  // adjunta al ?cpu=1 viejo (que luego terminamos) y la sesión queda inválida.
  await enviar("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  const adjunto = await esperaWorker;
  const sessionId = adjunto.sessionId;
  await enviar("Runtime.enable", {}, sessionId);
  console.log(`worker adjuntado: ${adjunto.targetInfo?.url} (session ${sessionId.slice(0, 8)}…)`);

  // Esperar el mensaje `ready` real del worker (no solo cv.HEAPU8, que aparece
  // a mitad de la inicialización de embind).
  await enviar("Runtime.evaluate", {
    expression: `window.__cpuReady.then(() => true)`,
    returnByValue: true,
    awaitPromise: true,
  }, undefined, 60000);
  console.log("OpenCV listo en el worker (ready recibido)");

  await enviar("Profiler.enable", {}, sessionId);
  await enviar("Profiler.setSamplingInterval", { interval: INTERVALO }, sessionId);

  for (const archivo of FOTOS) {
    console.log(`\nperfilando ${archivo} …`);
    await enviar("Profiler.start", {}, sessionId);
    const t0 = Date.now();
    const r = await enviar("Runtime.evaluate", {
      expression: `(async () => {
        const t0page = performance.now();
        const w = window.__cpuWorker;
        const marcas = {};
        const ipc = [];
        let seq = 0;
        const enviarW = (msg, transfer) => new Promise((res, rej) => {
          const ts = ++seq;
          const tEnvio = performance.now();
          const onMsg = (ev) => {
            const d = ev.data;
            if (d && d.ts === ts) {
              w.removeEventListener("message", onMsg);
              ipc.push({ tipo: msg.type, tEnvio, tRecv: performance.now(), workerMs: d.elapsedMs ?? null });
              res(d);
            }
          };
          w.addEventListener("message", onMsg);
          w.postMessage({ ...msg, ts }, transfer || []);
          setTimeout(() => { w.removeEventListener("message", onMsg); rej(new Error("timeout worker " + msg.type)); }, 90000);
        });
        let t = performance.now();
        const resp = await fetch("/dev-fixtures/reales/${archivo}");
        const blob = await resp.blob();
        marcas.fetch = Math.round(performance.now() - t);
        t = performance.now();
        const img = await createImageBitmap(blob);
        marcas.decode = Math.round(performance.now() - t);
        const s = 400 / Math.max(img.width, img.height);
        const small = await createImageBitmap(img, { resizeWidth: Math.round(img.width * s), resizeHeight: Math.round(img.height * s), resizeQuality: "low" });
        t = performance.now();
        const det = await enviarW({ type: "detect", bitmap: small }, [small]);
        marcas.detect = Math.round(performance.now() - t);
        const corners = det.corners ? Array.from(det.corners) : null;
        if (!corners) return { error: "sin quad", marcas };
        t = performance.now();
        const wr = await enviarW({ type: "warp", bitmap: img, quad: new Float32Array(corners), manual: true }, [img]);
        marcas.warp = Math.round(performance.now() - t);
        t = performance.now();
        const enh = await enviarW({ type: "enhance", bitmap: wr.bitmap, mode: "bw", maxLongSide: 4032 }, [wr.bitmap]);
        marcas.enhanceBw = Math.round(performance.now() - t);
        marcas.total = Math.round(performance.now() - t0page);
        return { marcas, ipc, pngBytes: enh.blob?.size ?? null, w: enh.w, h: enh.h, workerMsBw: enh.elapsedMs ?? null };
      })()`,
      returnByValue: true,
      awaitPromise: true,
    }, undefined, 180000);
    if (r?.exceptionDetails) {
      console.error("  excepción en pipeline:", JSON.stringify(r.exceptionDetails).slice(0, 400));
    }
    const datos = r?.result?.value ?? { error: "sin valor" };
    const { profile } = await enviar("Profiler.stop", {}, sessionId);
    const agg = agregarPerfil(profile);
    const msHost = Date.now() - t0;
    resultados.push({ archivo, msHost, ...datos, cpu: agg });
    console.log(`  total=${datos.marcas?.total}ms bw=${datos.marcas?.enhanceBw}ms workerMsBw=${datos.workerMsBw}`);
    console.log(`  CPU worker: total=${agg.totalMs}ms WASM=${agg.wasmMs}ms (${agg.wasmPct}%) JS=${agg.jsMs}ms`);
    console.log("  top funciones:");
    for (const f of agg.top.slice(0, 12)) {
      console.log(`    ${String(f.selfMs).padStart(7)}ms ${String(f.pct).padStart(5)}% ${f.wasm ? "WASM" : "JS  "} ${f.funcion} @ ${f.archivo}:${f.linea}`);
    }
  }

  const salida = join(RESULTADOS, `cpu-worker-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(salida, JSON.stringify({ cdp: CDP, intervaloUs: INTERVALO, medidoEn: new Date().toISOString(), fotos: resultados }, null, 2));
  console.log(`\nJSON: ${salida}`);
  ws.close();
  process.exit(0);
} catch (e) {
  console.error(`FALLA: ${e instanceof Error ? e.message : e}`);
  ws.close();
  process.exit(1);
}