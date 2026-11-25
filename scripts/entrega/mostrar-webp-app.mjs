/**
 * mostrar-webp-app.mjs — WebP EN EL FLUJO COMPLETO DE IMPORTACIÓN de la app
 * (bw + original), con tiempo total y captura del A13.
 *
 * Parchea en runtime (CDP autoAttach) `OffscreenCanvas.prototype.convertToBlob`
 * de TODOS los workers de detección que crea la app para forzar
 * image/webp (sin tocar el asset md5), dispara un import real del fixture por
 * la UI y mide: cambio de archivo → imagen visible en el visor → veredicto.
 * `--png` corre el control sin parche. Reinicia Chrome antes de conectar
 * (los workers con instancias WASM acumuladas agotan la memoria del motor).
 *
 * Uso: TAMIZ_ADB_SERIAL=... node scripts/entrega/mostrar-webp-app.mjs [--png] [foto.jpg]
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ADB, MOLDE, RESULTADOS, VEREDICTOS, capturaDispositivo, conectarA56, cuerpo,
  crearProgreso, limpiarPwa, prepararImporte, seleccionarArchivo, sembrarMolde, serialAdb,
} from "./a56-comun.mjs";

const args = process.argv.slice(2);
const MODO_PNG = args.includes("--png");
const FOTO = args.find((a) => !a.startsWith("--")) ?? "reales/20261123_201944.jpg";
const MODO = MODO_PNG ? "png" : "webp";
const progreso = crearProgreso(`webp-app-${MODO}-progreso.log`);
const CDP = "http://127.0.0.1:9223";
const SERIAL = serialAdb();

const adbShell = (...cmd) =>
  execFileSync(ADB, ["-s", SERIAL, "shell", ...cmd], { encoding: "utf-8", timeout: 30000 });

async function esperarPagina(ms = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const lista = await (await fetch(`${CDP}/json/list`)).json();
      const p = lista.find((t) => t.type === "page" && t.url.includes("localhost:3100"));
      if (p) return p;
    } catch {
      /* chrome aún subiendo */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Chrome no expuso la página de :3100 tras el reinicio");
}

function reiniciarChrome() {
  progreso("reiniciando Chrome (limpiar instancias WASM acumuladas)…");
  adbShell("am", "force-stop", "com.android.chrome");
  adbShell("logcat", "-b", "all", "-c").catch?.(() => {});
  adbShell("am", "start", "-a", "android.intent.action.VIEW", "-d", "http://localhost:3100/", "-p", "com.android.chrome");
}

async function wsPagina() {
  const t = await esperarPagina();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error("timeout ws")), 10000);
    ws.addEventListener("open", () => { clearTimeout(to); res(); });
    ws.addEventListener("error", () => rej(new Error("error ws")));
  });
  return ws;
}

let parcheadas = 0;
const resultado = {
  modo: MODO,
  foto: FOTO,
  serial: SERIAL,
  arranque: new Date().toISOString(),
  workersParcheados: null,
  imagenVisibleMs: null,
  veredictoMs: null,
  mimeVisible: null,
  imgsVisibles: [],
  veredicto: null,
  error: null,
  captura: null,
};

async function main() {
  reiniciarChrome();
  await esperarPagina();
  let navegador, contexto, pagina, sesion;
  for (let intento = 1; ; intento++) {
    try {
      ({ navegador, contexto, pagina, sesion } = await conectarA56(CDP));
      break;
    } catch (e) {
      if (intento >= 6) throw e;
      progreso(`conexión CDP caída tras el reinicio (${e.message}) · reintento ${intento}`);
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
  // Medición de import: la cámara no participa; neutralizarla evita su
  // presión de memoria (idéntico en ambos modos → comparación justa).
  await contexto.addInitScript(() => {
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException("perfil: cámara deshabilitada para medir", "NotAllowedError"));
  });

  const consola = [];
  const tConn = Date.now();
  pagina.on("console", (m) => {
    if (consola.length < 400) consola.push(`[${Date.now() - tConn}ms] ${m.type()}: ${String(m.text()).slice(0, 300)}`);
  });
  pagina.on("pageerror", (e) => {
    if (consola.length < 400) consola.push(`[${Date.now() - tConn}ms] pageerror: ${String(e.message).slice(0, 300)}`);
  });

  const ws = await wsPagina();
  let id = 0;
  const pend = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) {
      const { res, rej } = pend.get(m.id);
      pend.delete(m.id);
      if (m.error) rej(new Error(m.error.message));
      else res(m.result);
      return;
    }
    if (
      !MODO_PNG &&
      m.method === "Target.attachedToTarget" &&
      m.params?.targetInfo?.type === "worker" &&
      String(m.params?.targetInfo?.url ?? "").includes("detection-worker.js")
    ) {
      parchear(m.params.sessionId, m.params.targetInfo.url).catch((e) =>
        progreso(`no se pudo parchear: ${e.message}`));
    }
  });
  function enviar(method, params = {}, sessionId, timeout = 30000) {
    const i = ++id;
    return new Promise((res, rej) => {
      const to = setTimeout(() => { pend.delete(i); rej(new Error(`timeout ${method}`)); }, timeout);
      pend.set(i, { res: (v) => { clearTimeout(to); res(v); }, rej: (e) => { clearTimeout(to); rej(e); } });
      ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  async function parchear(sessionId, url) {
    await enviar("Runtime.enable", {}, sessionId);
    for (let intento = 1; intento <= 4; intento++) {
      try {
        await enviar("Runtime.evaluate", {
          expression: `(() => { const o = OffscreenCanvas.prototype.convertToBlob;
            if (o.__webp) return "ya";
            const f = function(opts){ return o.call(this, Object.assign({}, opts, { type: "image/webp", quality: 0.9 })); };
            f.__webp = true; OffscreenCanvas.prototype.convertToBlob = f; return "ok"; })()`,
          returnByValue: true,
        }, sessionId, 90000);
        parcheadas++;
        progreso(`worker parcheado → webp: ${url}`);
        return;
      } catch (e) {
        progreso(`parcheo ${intento}/4 falló (${e.message})`);
        if (intento === 4) progreso(`no se pudo parchear ${url}`);
      }
    }
  }
  if (!MODO_PNG) await enviar("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });

  await sembrarMolde(pagina, readFileSync(MOLDE, "utf-8"));
  // El A13 revienta con bad_alloc en la escalada OCR (det [1,3,1760,1440])
  // en AMBOS modos — hallazgo aparte, no del códec. Presupuesto de 2.ª
  // pasada al mínimo legítimo del flag (5000 ms) para que la 1.ª pasada
  // (que sí pasa) cierre el acta y se abra el visor.
  await pagina.evaluate(() =>
    localStorage.setItem("tamiz.flags.v1", JSON.stringify({ ocrSegundaPresupuestoMs: 5000 })));
  resultado.flagsAplicadas = { ocrSegundaPresupuestoMs: 5000 };
  progreso("molde sembrado; limpiando PWA y recargando…");
  await limpiarPwa(pagina, sesion);
  await pagina.waitForTimeout(1500);
  await prepararImporte(pagina);

  progreso(`importando ${FOTO} (${MODO}) por el flujo completo de la app…`);
  const t0 = Date.now();
  await seleccionarArchivo(pagina, FOTO);

  const TOPE = 240000;
  while (Date.now() - t0 < TOPE) {
    await pagina.waitForTimeout(700);
    if (resultado.imagenVisibleMs == null) {
      const imgs = await pagina.evaluate(() =>
        Array.from(document.querySelectorAll("img"))
          .map((i) => ({ w: i.naturalWidth, h: i.naturalHeight, pref: (i.currentSrc || i.src || "").slice(0, 24) }))
          .filter((x) => x.w > 400 && /^data:image\//.test(x.pref)));
      if (imgs.length) {
        resultado.imagenVisibleMs = Date.now() - t0;
        resultado.imgsVisibles = imgs.slice(0, 6);
        resultado.mimeVisible = imgs[0].pref.replace(/;.*$/, "");
        progreso(`imagen visible en ${resultado.imagenVisibleMs} ms · ${imgs.map((x) => `${x.pref.replace(/;base64.*/, "")} ${x.w}x${x.h}`).join(", ")}`);
      }
    }
    const texto = await cuerpo(pagina);
    if (VEREDICTOS.test(texto)) {
      resultado.veredictoMs = Date.now() - t0;
      resultado.veredicto = texto.replace(/\s+/g, " ").slice(0, 220);
      progreso(`veredicto en ${resultado.veredictoMs} ms: ${resultado.veredicto.slice(0, 120)}`);
      break;
    }
    if (/memoria del motor|RECARGAR/i.test(texto)) {
      resultado.error = "la app reportó OOM del motor durante el import";
      progreso("⚠ la app mostró 'La memoria del motor se agotó'");
      break;
    }
  }
  if (resultado.imagenVisibleMs == null)
    progreso(`sin imagen visible dentro de ${TOPE} ms (webp=${!MODO_PNG} · parcheadas=${parcheadas})`);

  const webpVisible = /data:image\/webp/.test(JSON.stringify(resultado.imgsVisibles));
  if (MODO_PNG) progreso(`control PNG · mime visible: ${resultado.mimeVisible}`);
  else progreso(webpVisible ? "✔ el visor de la app está mostrando WebP" : "⚠ el visor no mostró data:image/webp");

  resultado.consola = consola.slice(-120);
  if (resultado.error || resultado.imagenVisibleMs == null) {
    for (const linea of consola.slice(-25)) progreso(`consola · ${linea}`);
    try {
      const eventos = adbShell("logcat", "-d", "-b", "events", "-s", "am_proc_died", "am_kill", "am_low_memory");
      resultado.logcatEventos = eventos.split("\n").filter((l) => l.trim()).slice(-12);
      for (const l of resultado.logcatEventos) progreso(`logcat · ${l}`);
    } catch { /* mejor esfuerzo */ }
  }

  const cap = capturaDispositivo(`webp-app-${MODO}-${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
  if (cap) {
    resultado.captura = join(RESULTADOS, cap);
    progreso(`captura guardada: ${resultado.captura}`);
  }
  resultado.workersParcheados = parcheadas;
  ws.close();
  await navegador.close().catch(() => undefined);
}

try {
  await main();
} catch (e) {
  resultado.error = resultado.error ?? (e instanceof Error ? e.message : String(e));
  progreso(`FALLA: ${resultado.error}`);
} finally {
  const json = join(RESULTADOS, `webp-app-${MODO}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(json, JSON.stringify(resultado, null, 2));
  progreso(`JSON: ${json}`);
}
progreso(`fin · modo=${MODO} · imagen=${resultado.imagenVisibleMs}ms · veredicto=${resultado.veredictoMs}ms · parcheadas=${parcheadas}`);
process.exit(resultado.imagenVisibleMs != null && !resultado.error ? 0 : 2);
