/**
 * e19-medir.mjs — bloqueo E19 (sesiones ONNX en el Chrome del A13, 32 bits).
 *
 * Sirve public/_bench (COOP/COEP, no-store) en 127.0.0.1:8945, expone el dist
 * de onnxruntime-web del arnés en /ort/ y conduce e19.html por CDP en el A13.
 * Escribe todo en scripts/resultados/medicion-ocr/e19/.
 *
 * Uso:
 *   bun e19-medir.mjs                 # matriz ORT + sondas de memoria
 *   bun e19-medir.mjs --solo ort      # solo matriz
 *   bun e19-medir.mjs --variantes a,b,d
 *   bun e19-medir.mjs --empezar mem   # reanuda por etapa
 *   bun e19-medir.mjs --reanudar      # conserva resultados.json previo
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const RAIZ = resolve(import.meta.dir, "../../..");
const BENCH = join(RAIZ, "public/_bench");
const ORT_DIST = join(RAIZ, "scripts/entrega/bench-ocr/node_modules/onnxruntime-web/dist");
const OUT = join(RAIZ, "scripts/resultados/medicion-ocr/e19");
const PUERTO = 8945;
const PUERTO_CDP = 9224;
const ADB = process.env.ADB_PATH ?? "C:/Users/JG/Android/platform-tools/adb.exe";
const SERIAL = "adb-RF8T70G9SHK-EIQWrm._adb-tls-connect._tcp";

const argv = process.argv.slice(2);
const opt = (nombre, def) => {
  const i = argv.indexOf(`--${nombre}`);
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def;
};
const flag = (nombre) => argv.includes(`--${nombre}`);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".onnx": "application/octet-stream",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
};
const CABECERAS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cache-Control": "no-store",
};

function servir() {
  return Bun.serve({
    port: PUERTO,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      let ruta = decodeURIComponent(url.pathname);
      let base, rel;
      if (ruta.startsWith("/_bench/")) { base = BENCH; rel = ruta.slice(7); }
      else if (ruta === "/" || ruta === "/_bench") { base = BENCH; rel = "/e19.html"; }
      else if (ruta.startsWith("/ort/")) { base = ORT_DIST; rel = "/" + ruta.slice(5); }
      else return new Response("no encontrado", { status: 404 });
      const archivo = join(base, rel);
      if (!archivo.startsWith(base) || !existsSync(archivo)) return new Response("404", { status: 404 });
      const cuerpo = await Bun.file(archivo).arrayBuffer();
      return new Response(cuerpo, {
        headers: { ...CABECERAS, "Content-Type": MIME[extname(archivo)] ?? "application/octet-stream" },
      });
    },
  });
}

// ── CDP ──────────────────────────────────────────────────────────────────────
class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pend = new Map(); this.eventos = []; }
  static async conectar(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener("open", () => res(), { once: true });
      ws.addEventListener("error", () => rej(new Error("WS CDP error")), { once: true });
    });
    const c = new Cdp(ws);
    ws.addEventListener("message", (ev) => {
      let m; try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m.id && c.pend.has(m.id)) {
        const p = c.pend.get(m.id);
        c.pend.delete(m.id);
        m.error ? p.rej(new Error(m.error.message ?? JSON.stringify(m.error))) : p.res(m.result);
        return;
      }
      if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params?.type)) {
        const t = (m.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 400);
        c.eventos.push(`console.${m.params.type}: ${t}`);
      }
      if (m.method === "Runtime.exceptionThrown") {
        const d = m.params?.exceptionDetails;
        c.eventos.push(`exception: ${(d?.exception?.description ?? d?.text ?? "").slice(0, 500)}`);
      }
      if (m.method === "Log.entryAdded") {
        const e = m.params?.entry;
        c.eventos.push(`log.${e?.level}: ${(e?.text ?? "").slice(0, 300)}`);
      }
      if (m.method === "Inspector.targetCrashed") c.eventos.push("targetCrashed");
    });
    return c;
  }
  enviar(method, params = {}, timeout = 180000) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const t = setTimeout(() => { this.pend.delete(id); rej(new Error(`CDP timeout ${method}`)); }, timeout);
      this.pend.set(id, {
        res: (v) => { clearTimeout(t); res(v); },
        rej: (e) => { clearTimeout(t); rej(e); },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluar(expr, timeout = 120000) {
    const r = await this.enviar("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, timeout);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text ?? "eval exception");
    if (r.result?.subtype === "error") throw new Error(r.result.description ?? "eval error");
    return r.result?.value;
  }
  async navegar(url) {
    await this.enviar("Page.navigate", { url }, 30000);
  }
}

// ── adb ──────────────────────────────────────────────────────────────────────
const adb = (...args) => {
  const p = Bun.spawnSync([ADB, "-s", SERIAL, ...args], { stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
};
const prop = (k) => adb("shell", "getprop", k).out.trim();
const memAvailableMB = () => {
  const m = adb("shell", "cat", "/proc/meminfo").out.match(/MemAvailable:\s+(\d+)\s+kB/);
  return m ? Math.round(parseInt(m[1], 10) / 1024) : null;
};
const pssChromeMB = () => {
  const out = adb("shell", "dumpsys", "meminfo", "com.android.chrome", "-s").out;
  const m = out.match(/TOTAL\s+PSS[:\s]+([\d.,]+)\s*K?/i) ?? out.match(/TOTAL[:\s]+([\d.,]+)\s*K?/i);
  return m ? Math.round(parseFloat(m[1].replace(/[.,]/g, "")) / 1024) : null;
};

// ── utilidades ───────────────────────────────────────────────────────────────
const esperar = (m) => Bun.sleep(m);

async function paginas() {
  const arr = await (await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/list`)).json();
  return arr.filter((t) => t.type === "page");
}

async function conectarPagina(intentos = 60) {
  for (let i = 0; i < intentos; i++) {
    try {
      const ps = await paginas();
      const p = ps.find((t) => t.url.includes(`:${PUERTO}`)) ?? ps[0];
      if (p) {
        const c = await Cdp.conectar(p.webSocketDebuggerUrl);
        await c.enviar("Page.enable");
        await c.enviar("Runtime.enable");
        await c.enviar("Log.enable");
        return c;
      }
    } catch { /* reintento */ }
    await esperar(500);
  }
  throw new Error("no hay pestaña CDP para conducir");
}

async function esperarFin(cdp, url, limiteMs) {
  const t0 = Date.now();
  let ultima = "";
  while (Date.now() - t0 < limiteMs) {
    try {
      const estado = await cdp.evaluar(
        `(() => { const s = window.__e19; if (!s) return "sin-sonda"; if (s.url !== location.href) return "contexto-viejo"; return s.estado; })()`,
        15000,
      );
      ultima = estado;
      if (estado === "fin") return true;
      if (estado === "sin-sonda" && Date.now() - t0 > 20000) return false;
    } catch (e) {
      ultima = `eval-error: ${e.message}`;
    }
    await esperar(700);
  }
  console.log(`   timeout (${limiteMs} ms), último estado: ${ultima}`);
  return false;
}

async function correrPagina(cdp, url, limiteMs, opciones = {}) {
  if (!opciones.yaNavegada) {
    try {
      await cdp.navegar(url);
    } catch (e) {
      return { error: `navegar: ${e.message}`, eventos: cdp.eventos.splice(0) };
    }
  }
  if (opciones.esperarArranque) {
    // Esperar a que la sonda esté lista, forzar GC (libera reservas wasm de la
    // página anterior) y solo entonces soltar la sonda.
    const t0 = Date.now();
    while (Date.now() - t0 < 45000) {
      try {
        const est = await cdp.evaluar(`(window.__e19 || {}).estado || "sin-sonda"`, 15000);
        if (est === "listo" || est === "fin") break;
      } catch { /* aún cargando */ }
      await esperar(300);
    }
    try {
      await cdp.enviar("HeapProfiler.enable", {});
      await cdp.enviar("HeapProfiler.collectGarbage", {});
      await cdp.enviar("HeapProfiler.collectGarbage", {});
    } catch { /* no crítico */ }
    await esperar(1200);
    try { await cdp.evaluar("window.__arrancar = true", 15000); } catch { /* noop */ }
  }
  const fin = await esperarFin(cdp, url, limiteMs);
  let dato = null;
  try {
    dato = await cdp.evaluar(`JSON.stringify(window.__e19 || null)`, 30000);
    dato = dato ? JSON.parse(dato) : null;
  } catch (e) {
    dato = { error: `leer resultado: ${e.message}` };
  }
  const eventos = cdp.eventos.splice(0);
  return { fin, dato, eventos };
}

// ── pestañas nuevas (renderer propio) para las sondas de memoria ─────────────
const sandboxPids = () =>
  adb("shell", "ps", "-A").out.split("\n").filter((l) => /sandboxed_process/.test(l))
    .map((l) => l.trim().split(/\s+/)[1]).filter(Boolean);

async function navegadorCdp() {
  const v = await (await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/version`)).json();
  return Cdp.conectar(v.webSocketDebuggerUrl);
}

async function sondaEnPestanaNueva(browser, url, limiteMs) {
  const antes = new Set(sandboxPids());
  const t = await browser.enviar("Target.createTarget", { url }, 20000);
  const targetId = t.targetId;
  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    await esperar(250);
    const arr = await (await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/list`)).json();
    const p = arr.find((x) => x.id === targetId);
    wsUrl = p?.webSocketDebuggerUrl ?? null;
  }
  if (!wsUrl) {
    try { await browser.enviar("Target.closeTarget", { targetId }); } catch { /* noop */ }
    return { fin: false, dato: { error: "sin websocket para la pestaña nueva" }, eventos: [] };
  }
  const cdp = await Cdp.conectar(wsUrl);
  await cdp.enviar("Page.enable");
  await cdp.enviar("Runtime.enable");
  await cdp.enviar("Log.enable");
  const r = await correrPagina(cdp, url, limiteMs, { yaNavegada: true, esperarArranque: true });
  const despues = sandboxPids();
  r.pidsNuevos = despues.filter((p) => !antes.has(p));
  try { cdp.ws.close(); } catch { /* noop */ }
  try { await browser.enviar("Target.closeTarget", { targetId }); } catch { /* noop */ }
  return r;
}

async function cerrarPestanasSonda(browser) {
  const arr = await (await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/list`)).json();
  const nuestras = arr.filter((t) => t.type === "page" && t.url.includes(`:${PUERTO}`));
  for (const t of nuestras) {
    try { await browser.enviar("Target.closeTarget", { targetId: t.id }, 10000); } catch { /* noop */ }
  }
  return nuestras.length;
}

// ── arranque en el teléfono ──────────────────────────────────────────────────
function mantenerDespierto() {
  const previo = adb("shell", "settings", "get", "system", "screen_off_timeout").out.trim();
  adb("shell", "settings", "put", "system", "screen_off_timeout", "2147483647");
  adb("shell", "input", "keyevent", "KEYCODE_WAKEUP");
  adb("shell", "wm", "dismiss-keyguard");
  return previo;
}
function restaurarTimeout(previo) {
  if (/^\d+$/.test(previo)) adb("shell", "settings", "put", "system", "screen_off_timeout", previo);
}

function informacionEquipo() {
  const abilist = prop("ro.product.cpu.abilist");
  const abilist32 = prop("ro.product.cpu.abilist32");
  const abilist64 = prop("ro.product.cpu.abilist64");
  const pkg = adb("shell", "dumpsys", "package", "com.android.chrome").out;
  const abis = [...pkg.matchAll(/primaryCpuAbi=([^\s]+)/g)].map((m) => m[1]);
  const ps = adb("shell", "ps", "-A").out.split("\n").filter((l) => /com\.android\.chrome/.test(l));
  const procesos = [];
  for (const linea of ps) {
    const partes = linea.trim().split(/\s+/);
    const pid = partes[1];
    if (!/^\d+$/.test(pid ?? "")) continue;
    const reg = { linea: linea.trim().slice(0, 160), pid };
    const exe = adb("shell", "ls", "-l", `/proc/${pid}/exe`);
    reg.leerExe = exe.code === 0 ? exe.out.trim() : `denegado (${exe.err.trim().split("\n")[0]})`;
    const elf = adb("shell", "head", "-c", "5", `/proc/${pid}/exe`);
    reg.elf = elf.code === 0 ? Buffer.from(elf.out).toString("latin1") : "denegado";
    procesos.push(reg);
  }
  const maps = adb("shell", "cat", `/proc/${procesos.find((p) => /sandboxed_process/.test(p.linea))?.pid ?? "0"}/maps`);
  return {
    modelo: prop("ro.product.model"),
    release: prop("ro.build.version.release"),
    sdk: prop("ro.build.version.sdk"),
    kernel: adb("shell", "uname", "-a").out.trim(),
    abilist, abilist32, abilist64,
    chromePrimaryCpuAbi: [...new Set(abis)],
    chromeApkPath: (pkg.match(/codePath=([^\s]+)/) ?? [])[1] ?? null,
    procesos,
    mapsDisponible: maps.code === 0,
    mapsError: maps.code === 0 ? null : maps.err.trim().split("\n")[0],
    memAvailableMB: memAvailableMB(),
    pssChromeMB: pssChromeMB(),
    sondaWasmNavegador: "ver sondas de memoria en el JSON (runtime del renderer)",
  };
}

// ── plan de pruebas ──────────────────────────────────────────────────────────
const MATRIZ = [
  { v: "a", m: "cls" },
  { v: "a", m: "det" },
  { v: "b", m: "det" },
  { v: "c", m: "det" },
  { v: "d", m: "det" },
  { v: "d2", m: "det" },
  { v: "e", m: "det" },
  { v: "e2", m: "det" },
  { v: "e3", m: "det" },
  { v: "g", m: "det" },
  { v: "g2", m: "det" },
  { v: "h", m: "det" },
];

const SONDAS = [
  { p: "single", mb: 512 },
  { p: "single", mb: 640 },
  { p: "single", mb: 768 },
  { p: "single", mb: 896 },
  { p: "single", mb: 1024 },
  { p: "single", mb: 1536 },
  { p: "single", mb: 2048 },
  { p: "sharedort" },
  { p: "nonsharedort" },
  { p: "sharedgrow" },
  { p: "sharedcumulative" },
  { p: "cumulative" },
  { p: "grow" },
  { p: "arraybuffer" },
];

const MULTI = [
  { v: "r1" },
  { v: "r2" },
  { v: "r5" },
  { v: "r3" },
  { v: "r4" },
  { v: "r6" },
  { v: "r7" },
];

function urlOrt(v, m) { return `http://127.0.0.1:${PUERTO}/_bench/e19.html?s=ort&v=${v}&m=${m}`; }
function urlMulti(v) { return `http://127.0.0.1:${PUERTO}/_bench/e19.html?s=mult&v=${v}`; }
function urlMem(p, mb) { return `http://127.0.0.1:${PUERTO}/_bench/e19.html?s=mem&esperar=1&p=${p}${mb ? `&mb=${mb}` : ""}`; }

// ── principal ────────────────────────────────────────────────────────────────
const servidor = servir();
console.log(`HTTP 127.0.0.1:${PUERTO} (/_bench + /ort, COOP/COEP, no-store)`);

mkdirSync(OUT, { recursive: true });
const RUTA_JSON = join(OUT, "resultados.json");
const salida = flag("reanudar") && existsSync(RUTA_JSON)
  ? JSON.parse(readFileSync(RUTA_JSON, "utf8"))
  : { creado: new Date().toISOString(), equipo: "a13", version: 1, intentos: [], sondas: [], dispositivo: null };
salida.actualizado = new Date().toISOString();

const timeoutPrevio = mantenerDespierto();
console.log(`timeout pantalla previo: ${timeoutPrevio}`);

try {
  adb("reverse", `tcp:${PUERTO}`, `tcp:${PUERTO}`);
  console.log("adb reverse 8945 OK");

  salida.dispositivo = informacionEquipo();
  console.log("dispositivo:", salida.dispositivo.modelo, "abi:", salida.dispositivo.abilist, "chrome:", salida.dispositivo.chromePrimaryCpuAbi);

  // Abrir Chrome en la URL de la sonda (sin '&' para no pelear con el shell de adb).
  adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", `http://127.0.0.1:${PUERTO}/_bench/e19.html`, "-p", "com.android.chrome");
  await esperar(2500);

  let cdp = await conectarPagina();
  console.log("CDP conectado a la página del teléfono");

  const solo = opt("solo", null);
  const varFiltro = opt("variantes", null)?.split(",").map((s) => s.trim());
  const empezar = opt("empezar", "ort");

  if (empezar !== "mem" && empezar !== "mult") {
    for (const prueba of MATRIZ) {
      if (solo && solo !== "ort") break;
      if (varFiltro && !varFiltro.includes(prueba.v)) continue;
      const ya = salida.intentos.find((i) => i.variante === prueba.v && i.modelo === prueba.m);
      if (ya && ya.dato && ya.dato.estado === "fin") { console.log(`= ${prueba.v}/${prueba.m} ya estaba`); continue; }
      const etiqueta = `${prueba.v}/${prueba.m}`;
      console.log(`→ ${etiqueta}`);
      const t0 = Date.now();
      const r = await correrPagina(cdp, urlOrt(prueba.v, prueba.m), 150000);
      const intento = {
        variante: prueba.v,
        modelo: prueba.m,
        msReloj: Date.now() - t0,
        fin: r.fin,
        dato: r.dato,
        eventos: (r.eventos ?? []).slice(0, 40),
        memAvailableMB: memAvailableMB(),
        pssChromeMB: pssChromeMB(),
      };
      salida.intentos.push(intento);
      writeFileSync(RUTA_JSON, JSON.stringify(salida, null, 2));
      const o = r.dato?.ort;
      console.log(o ? (o.ok ? `   OK ${o.ms} ms` : `   FALLO ${o.ms} ms: ${o.error}`) : `   sin dato (fin=${r.fin}) ${r.dato?.error ?? ""}`);
      if (/targetCrashed|contexto-viejo|sin-sonda/.test(JSON.stringify(r)) && r.fin === false) {
        console.log("   (el renderer parece caído; reintento de conexión)");
        try { cdp.ws.close(); } catch { /* noop */ }
        await esperar(3000);
        cdp = await conectarPagina();
      }
    }
  }

  if (empezar === "mult" || solo === "mult" || !solo) {
    salida.multi = salida.multi ?? [];
    for (const prueba of MULTI) {
      if (varFiltro && !varFiltro.includes(prueba.v)) continue;
      if (solo && solo !== "mult") continue;
      const ya = salida.multi.find((m) => m.variante === prueba.v && m.dato?.estado === "fin");
      if (ya) { console.log(`= mult ${prueba.v} ya estaba`); continue; }
      console.log(`→ mult ${prueba.v}`);
      const t0 = Date.now();
      const r = await correrPagina(cdp, urlMulti(prueba.v), 300000);
      const item = { variante: prueba.v, msReloj: Date.now() - t0, fin: r.fin, dato: r.dato, eventos: (r.eventos ?? []).slice(0, 40), memAvailableMB: memAvailableMB(), pssChromeMB: pssChromeMB() };
      salida.multi.push(item);
      writeFileSync(RUTA_JSON, JSON.stringify(salida, null, 2));
      const res = (r.dato?.multi?.resultados ?? []).map((x) => `${x.modelo || "?"}:${x.ok ? "OK" : "FALLO"}:${x.ms}${x.error ? " " + x.error : ""}`);
      console.log(`   ${r.fin ? res.join(" | ").slice(0, 600) : "sin dato (fin=false)"} sesiones=${r.dato?.multi?.sesiones}`);
      if (!r.fin) {
        try { cdp.ws.close(); } catch { /* noop */ }
        await esperar(3000);
        cdp = await conectarPagina();
      }
    }
  }

  if (empezar === "mem" || solo === "mem" || !solo) {
    const browser = await navegadorCdp();
    try {
      const previas = await cerrarPestanasSonda(browser);
      if (previas) console.log(`pestañas previas de sondas cerradas: ${previas}`);
      for (const s of SONDAS) {
        const etiqueta = `${s.p}${s.mb ? ":" + s.mb + "MB" : ""}`;
        if (solo && solo !== "mem") break;
        if (salida.sondas.find((x) => x.prueba === s.p && x.mb === (s.mb ?? null) && x.dato?.estado === "fin")) {
          console.log(`= sonda ${etiqueta} ya estaba`);
          continue;
        }
        console.log(`→ sonda ${etiqueta} (pestaña nueva)`);
        const r = await sondaEnPestanaNueva(browser, urlMem(s.p, s.mb), 180000);
        const sonda = { prueba: s.p, mb: s.mb ?? null, fin: r.fin, dato: r.dato, pidsNuevos: r.pidsNuevos ?? [], eventos: (r.eventos ?? []).slice(0, 20), memAvailableMB: memAvailableMB() };
        salida.sondas.push(sonda);
        writeFileSync(RUTA_JSON, JSON.stringify(salida, null, 2));
        const m = r.dato?.memoria;
        console.log(`   ${m ? JSON.stringify(m) : "sin dato (fin=" + r.fin + ")"} pids=${JSON.stringify(r.pidsNuevos)}`);
      }
    } finally {
      const cerradas = await cerrarPestanasSonda(browser);
      console.log(`pestañas de la sonda cerradas: ${cerradas}`);
      browser.ws.close();
    }
  }

  salida.dispositivoFinal = {
    memAvailableMB: memAvailableMB(),
    pssChromeMB: pssChromeMB(),
    fin: new Date().toISOString(),
  };
  writeFileSync(RUTA_JSON, JSON.stringify(salida, null, 2));
  console.log(`datos en ${RUTA_JSON}`);
  try { cdp.ws.close(); } catch { /* noop */ }
} finally {
  restaurarTimeout(timeoutPrevio);
  adb("reverse", "--remove", `tcp:${PUERTO}`);
  servidor.stop(true);
  console.log(`timeout pantalla restaurado a ${timeoutPrevio}; reverse 8945 retirado; servidor cerrado`);
}
