/**
 * probar-cdp-worker.mjs — condición 3 del arranque del perfilado: comprobar
 * que el cliente WebSocket nativo de Node 24 puede (a) hablar CDP con el
 * Chrome del A13, (b) auto-adjuntar el Dedicated Worker de detección
 * (`detection-worker.js`) con Target.setAutoAttach flatten:true, y (c) leer
 * dentro del worker `Module.HEAPU8.byteLength` (heap WASM de OpenCV) y el
 * heap JS. Es la base de la Fase 2 (Profiler sobre el hilo del worker).
 *
 * Uso: node scripts/entrega/probar-cdp-worker.mjs [--cdp http://127.0.0.1:9223]
 * Exit 0 si logra adjuntarse y evaluar; 1 si no.
 */
const argDe = (nombre) => {
  const i = process.argv.indexOf(nombre);
  return i > -1 ? process.argv[i + 1] : null;
};
const CDP = argDe("--cdp") ?? "http://127.0.0.1:9223";
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
  ws.addEventListener("open", () => {
    clearTimeout(to);
    res();
  });
  ws.addEventListener("error", () => {
    clearTimeout(to);
    rej(new Error("error websocket CDP"));
  });
});

let id = 0;
const pendientes = new Map();
const oyentes = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pendientes.has(m.id)) {
    const { res, rej } = pendientes.get(m.id);
    pendientes.delete(m.id);
    if (m.error) rej(new Error(`${m.error.message}`));
    else res(m.result);
    return;
  }
  for (const o of oyentes) o(m);
});

function enviar(method, params = {}, sessionId) {
  const i = ++id;
  return new Promise((res, rej) => {
    const to = setTimeout(() => {
      pendientes.delete(i);
      rej(new Error(`timeout ${method}`));
    }, 45000);
    pendientes.set(i, {
      res: (v) => {
        clearTimeout(to);
        res(v);
      },
      rej: (e) => {
        clearTimeout(to);
        rej(e);
      },
    });
    ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

try {
  const esperaWorker = new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error("worker de detección no se auto-adjuntó en 30 s")), 30000);
    oyentes.push((m) => {
      if (
        m.method === "Target.attachedToTarget" &&
        m.params?.targetInfo?.type === "worker" &&
        /detection-worker\.js/.test(m.params?.targetInfo?.url ?? "")
      ) {
        clearTimeout(to);
        res(m.params);
      }
    });
  });

  await enviar("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  // Worker nuevo con la misma URL que usa la app (si ya existe uno vivo, se reutiliza).
  await enviar("Runtime.evaluate", {
    expression: `(() => {
      window.__probeWorker = window.__probeWorker || new Worker("/scanner/detection-worker.js");
      return { creado: !!window.__probeWorker };
    })()`,
    returnByValue: true,
  });

  const adjunto = await esperaWorker;
  const sessionId = adjunto.sessionId;
  const url = adjunto.targetInfo?.url ?? "?";
  await enviar("Runtime.enable", {}, sessionId);

  let lectura = null;
  for (let intento = 0; intento < 12; intento++) {
    await dormir(2000);
    const r = await enviar(
      "Runtime.evaluate",
      {
        expression: `(() => {
          const m = typeof Module !== "undefined" ? Module : null;
          const pm = performance.memory || null;
          const claves = m ? Object.keys(m) : [];
          return {
            tieneModule: !!m,
            heapU8Bytes: m && m.HEAPU8 ? m.HEAPU8.byteLength : null,
            heapU8Mb: m && m.HEAPU8 ? +(m.HEAPU8.byteLength / 1048576).toFixed(1) : null,
            heapProps: claves.filter((k) => /heap/i.test(k)).slice(0, 20),
            clavesModule: claves.slice(0, 30),
            tieneCv: typeof cv !== "undefined",
            cvHeapU8Bytes: typeof cv !== "undefined" && cv.HEAPU8 ? cv.HEAPU8.byteLength : null,
            cvMemBytes:
              typeof cv !== "undefined" && cv.wasmMemory ? cv.wasmMemory.buffer.byteLength : null,
            cvClavesHeap: typeof cv !== "undefined" ? Object.keys(cv).filter((k) => /heap|memory/i.test(k)).slice(0, 20) : [],
            globales: Object.keys(globalThis).filter((k) => /^(cv|Module|wasm|heap)/i.test(k)).slice(0, 20),
            jsUsadoMb: pm ? +(pm.usedJSHeapSize / 1048576).toFixed(1) : null,
            jsTotalMb: pm ? +(pm.totalJSHeapSize / 1048576).toFixed(1) : null,
          };
        })()`,
        returnByValue: true,
        awaitPromise: false,
      },
      sessionId,
    );
    lectura = r?.result?.value ?? null;
    if (lectura?.heapU8Bytes) break;
  }

  const version = await enviar("Browser.getVersion").catch(() => null);
  console.log(
    JSON.stringify(
      {
        cdp: CDP,
        pagina: pagina.url,
        workerUrl: url,
        attach: "flatten autoAttach OK",
        lectura,
        browser: version ? `${version.product} ${version.revision}` : null,
      },
      null,
      2,
    ),
  );
  ws.close();
  process.exit(lectura?.tieneCv ? 0 : 2);
} catch (e) {
  console.error(`FALLA: ${e instanceof Error ? e.message : e}`);
  ws.close();
  process.exit(1);
}
