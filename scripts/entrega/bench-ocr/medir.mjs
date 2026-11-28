/**
 * medir.mjs — conductor del arnés de MEDICIÓN resolución × motores.
 *
 * Modo dispositivo (por defecto; pedido del dueño 2026-11-28: «primero en el a56»):
 *   corre el arnés en el Chrome del teléfono por adb.
 *   · Servidor estático COOP/COEP en el PC + `adb reverse tcp:8941 tcp:8941`.
 *   · CDP por el forward existente (A56 :9223, A13 :9224, A12 :9225).
 *   · Memoria pico medida con `dumpsys meminfo com.android.chrome` muestreado
 *     durante cada corrida; MemAvailable mínimo como contexto del gate de 4 GB.
 *   · Wake lock en la página para que no se apague la pantalla (timers congelados
 *     invalidarían los tiempos).
 *
 * Modo escritorio (--escritorio): laboratorio local con Chrome headless. No es la
 * medición oficial; la matriz se corre en los teléfonos.
 *
 * Uso:
 *   bun medir.mjs --equipo a56                  # matriz completa en el A56
 *   bun medir.mjs --equipo a56 --limite 4       # humo
 *   bun medir.mjs --equipo a56 --maestras propias
 *   bun medir.mjs --equipo a12 --hilos 1
 *   bun medir.mjs --equipo a56 --reanudar scripts/resultados/medicion-ocr/motores/a56/resultados-parcial.json
 *   bun medir.mjs --escritorio --limite 2
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";

const RAIZ = resolve(import.meta.dir, "../../..");
const BENCH = join(RAIZ, "public/_bench");
const DATOS = join(RAIZ, "scripts/resultados/medicion-ocr");
const MAESTRAS = join(DATOS, "maestras");
const GT = join(DATOS, "gt");
const OUT = join(DATOS, "motores");
const PERFIL = join(tmpdir(), "bench-medicion-chrome");

const PUERTO_HTTP = (() => {
  const i = process.argv.indexOf("--puerto");
  const p = i > -1 ? parseInt(process.argv[i + 1], 10) : NaN;
  return Number.isFinite(p) ? p : 8941;
})();
const PUERTO_CDP_ESCRITORIO = 9333;
const ADB = process.env.ADB_PATH ?? "C:/Users/JG/Android/platform-tools/adb.exe";
const CHROME_CANDIDATOS = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
].filter(Boolean);

// Gate duro del plan: la configuración debe caber en 4 GB con margen. PSS total
// del proceso Chrome medido en el teléfono (incluye su línea base ~200–300 MB).
const TECHO_PSS_4GB_MB = 2600;

const EQUIPOS = {
  a56: { coincidencia: "adb-R5GYB558JPE", cdp: 9223, hilos: 2, techoRecicloMB: 4200 },
  a13: { coincidencia: "adb-RF8T70G9SHK", cdp: 9224, hilos: 1, techoRecicloMB: 2300 },
  a12: { coincidencia: "adb-R58RA2Q1SDB", cdp: 9225, hilos: 1, techoRecicloMB: 2300 },
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gz": "application/gzip",
  ".onnx": "application/octet-stream",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

const CABECERAS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cache-Control": "no-store",
};

function servir() {
  return Bun.serve({
    port: PUERTO_HTTP,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      let ruta = decodeURIComponent(url.pathname);
      let base;
      if (ruta === "/" || ruta === "/_bench") { base = BENCH; ruta = "/index.html"; }
      else if (ruta.startsWith("/_bench/")) { base = BENCH; ruta = ruta.slice(7); }
      else if (ruta.startsWith("/maestras/")) { base = MAESTRAS; ruta = ruta.slice(9); }
      else if (ruta.startsWith("/gt/")) { base = GT; ruta = ruta.slice(3); }
      else return new Response("no encontrado", { status: 404 });
      if (ruta.endsWith("/") || ruta === "") ruta = "/index.html";
      const archivo = join(base, ruta);
      if (!archivo.startsWith(base) || !existsSync(archivo)) return new Response("404", { status: 404 });
      const cuerpo = await Bun.file(archivo).arrayBuffer();
      return new Response(cuerpo, {
        headers: { ...CABECERAS, "Content-Type": MIME[extname(archivo)] ?? "application/octet-stream" },
      });
    },
  });
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pendientes = new Map(); this.eventos = []; }
  static async conectar(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener("open", () => res(), { once: true });
      ws.addEventListener("error", () => rej(new Error("WS CDP error")), { once: true });
    });
    const cdp = new Cdp(ws);
    Cdp.escuchar(ws, cdp);
    return cdp;
  }
  enviar(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const t = setTimeout(() => { this.pendientes.delete(id); rej(new Error(`CDP timeout: ${method}`)); }, 300000);
      this.pendientes.set(id, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  static escuchar(ws, cdp) {
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id && cdp.pendientes.has(msg.id)) {
        const p = cdp.pendientes.get(msg.id);
        cdp.pendientes.delete(msg.id);
        if (msg.error) p.rej(new Error(msg.error.message ?? JSON.stringify(msg.error)));
        else p.res(msg.result);
        return;
      }
      if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning", "assert"].includes(msg.params?.type)) {
        const texto = (msg.params?.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300);
        cdp.eventos.push(`console.${msg.params.type}: ${texto}`);
      }
      if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params?.exceptionDetails;
        cdp.eventos.push(`exception: ${(d?.exception?.description ?? d?.text ?? "").slice(0, 300)}`);
      }
      if (msg.method === "Log.entryAdded") {
        const e = msg.params?.entry;
        cdp.eventos.push(`log.${e?.level}: ${(e?.text ?? "").slice(0, 200)} ${(e?.url ?? "").slice(0, 120)}`);
      }
    });
  }
  async evaluar(expresion) {
    const r = await this.enviar("Runtime.evaluate", { expression: expresion, awaitPromise: true, returnByValue: true, timeout: 290000 });
    if (r.result?.subtype === "error") throw new Error(r.result.description ?? "eval error");
    return r.result?.value;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// adb
// ─────────────────────────────────────────────────────────────────────────────

function sh(bin, args) {
  const p = Bun.spawnSync([bin, ...args], { stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, stdout: p.stdout.toString(), stderr: p.stderr.toString() };
}

const adb = (serial, ...args) => sh(ADB, ["-s", serial, ...args]);

function resolverSerial(coincidencia) {
  const r = sh(ADB, ["devices"]);
  if (r.code !== 0) throw new Error(`adb falla: ${r.stderr.trim()}`);
  const linea = r.stdout.split("\n").find((l) => l.includes(coincidencia) && l.includes("\tdevice"));
  if (!linea) throw new Error(`dispositivo no conectado (${coincidencia})`);
  return linea.split("\t")[0].trim();
}

function prop(serial, clave) {
  return adb(serial, "shell", "getprop", clave).stdout.trim();
}

function memoriaDisponibleMB(serial) {
  const out = adb(serial, "shell", "cat", "/proc/meminfo").stdout;
  const m = out.match(/MemAvailable:\s+(\d+)\s+kB/);
  return m ? Math.round(parseInt(m[1], 10) / 1024) : null;
}

function pssChromeMB(serial) {
  const out = adb(serial, "shell", "dumpsys", "meminfo", "com.android.chrome", "-s").stdout;
  const m = out.match(/TOTAL\s+PSS[:\s]+([\d.,]+)\s*K?/i) ?? out.match(/TOTAL[:\s]+([\d.,]+)\s*K?/i);
  return m ? Math.round(parseFloat(m[1].replace(/[.,]/g, "")) / 1024) : null;
}

// Pantalla encendida y sin bloqueo durante la medición (tiempos dependen de que
// Chrome no se congele). Devuelve el timeout previo para restaurarlo al final.
function mantenerDespierto(serial) {
  const previo = adb(serial, "shell", "settings", "get", "system", "screen_off_timeout").stdout.trim();
  adb(serial, "shell", "settings", "put", "system", "screen_off_timeout", "2147483647");
  adb(serial, "shell", "input", "keyevent", "KEYCODE_WAKEUP");
  adb(serial, "shell", "wm", "dismiss-keyguard");
  return previo;
}

function restaurarTimeout(serial, previo) {
  if (/^\d+$/.test(previo)) adb(serial, "shell", "settings", "put", "system", "screen_off_timeout", previo);
}

function infoEquipo(serial) {
  const meminfo = adb(serial, "shell", "cat", "/proc/meminfo").stdout;
  const total = meminfo.match(/MemTotal:\s+(\d+)\s+kB/);
  return {
    serial,
    modelo: prop(serial, "ro.product.model"),
    android: prop(serial, "ro.build.version.release"),
    memTotalMB: total ? Math.round(parseInt(total[1], 10) / 1024) : null,
    memDisponibleMB: memoriaDisponibleMB(serial),
    pantalla: adb(serial, "shell", "wm", "size").stdout.trim().replace(/\s+/g, " "),
  };
}

class MuestreadorMemoria {
  constructor(serial) {
    this.serial = serial;
    this.picoPssMB = null;
    this.memLibreMinMB = null;
    this.muestras = 0;
    this.timer = null;
    this.ocupado = false;
  }
  reset() { this.picoPssMB = null; this.memLibreMinMB = null; this.muestras = 0; }
  start() {
    this.timer = setInterval(() => this.muestra(), 800);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  muestra() {
    if (this.ocupado) return;
    this.ocupado = true;
    try {
      const pss = pssChromeMB(this.serial);
      if (pss != null) this.picoPssMB = Math.max(this.picoPssMB ?? 0, pss);
      if (this.muestras % 5 === 0) {
        const libre = memoriaDisponibleMB(this.serial);
        if (libre != null) this.memLibreMinMB = Math.min(this.memLibreMinMB ?? Infinity, libre);
      }
      this.muestras++;
    } catch { /* adb ocupado: se ignora la muestra */ }
    finally { this.ocupado = false; }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Arranque del arnés
// ─────────────────────────────────────────────────────────────────────────────

async function conectarPaginaTelefono(puertoCdp, intentos = 180) {
  for (let i = 0; i < intentos; i++) {
    try {
      const arr = await (await fetch(`http://127.0.0.1:${puertoCdp}/json/list`)).json();
      const paginas = arr.filter((t) => t.type === "page" && t.url.includes(`:${PUERTO_HTTP}`));
      // Con pestañas duplicadas del arnés, la congelada en segundo plano
      // rompe la conducción (eval timeout). Solo se conduce la visible.
      for (const pag of paginas) {
        const cdp = await Cdp.conectar(pag.webSocketDebuggerUrl);
        const vis = await Promise.race([
          cdp.evaluar("document.visibilityState"),
          new Promise((r) => setTimeout(() => r(null), 3000)),
        ]).catch(() => null);
        if (vis === "visible") return cdp;
        try { cdp.ws.close(); } catch { /* ya cerrada */ }
      }
    } catch { /* Chrome aún arrancando */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no hay pestaña visible del arnés en el teléfono (CDP :${puertoCdp})`);
}

async function esperarListo(cdp, intentos = 420) {
  for (let i = 0; i < intentos; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const st = await cdp.evaluar("window.__ARNES ? window.__ARNES.estado() : null");
      if (st?.error) throw new Error(`arnés: ${st.error}`);
      if (st?.listo) return st;
      if (i % 10 === 0 && i > 0) process.stdout.write(".");
    } catch (e) {
      if (String(e.message).includes("arnés:")) throw e;
    }
  }
  try {
    const diag = await cdp.evaluar(`(() => ({
      h: document.getElementById("h")?.textContent ?? "?",
      arnes: !!window.__ARNES,
      estado: window.__ARNES ? window.__ARNES.estado() : null,
      recursos: performance.getEntriesByType("resource").map((r) => ({ n: r.name.split("/").slice(-2).join("/"), ms: Math.round(r.duration), tam: r.transferSize })).slice(-20),
      memoria: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
    }))()`);
    console.error("\nDIAGNÓSTICO:", JSON.stringify(diag, null, 1));
  } catch { /* sin diag */ }
  console.error("EVENTOS:", cdp.eventos.slice(-25).join("\n"));
  throw new Error("el arnés no quedó listo (timeout)");
}

async function snapConMemoria(cdp, pss, info) {
  const snap = await cdp.evaluar("window.__ARNES.resultado()");
  (snap.resultados ?? []).forEach((r, i) => {
    if (pss[i]?.pssMB != null) r.pssPicoMB = pss[i].pssMB;
    if (pss[i]?.libreMB != null) r.memLibreMinMB = pss[i].libreMB;
  });
  snap.meta = { ...(snap.meta ?? {}), dispositivo: info };
  return snap;
}

// ─────────────────────────────────────────────────────────────────────────────
// Análisis + scorecard 50/30/10/10
// ─────────────────────────────────────────────────────────────────────────────

function analizar(archivo, dirSalida) {
  const snap = JSON.parse(readFileSync(archivo, "utf8"));
  const resultados = snap.resultados ?? [];
  const ok = resultados.filter((r) => !r.error);
  console.log(`\n${ok.length}/${resultados.length} corridas sin error`);

  const byMotor = new Map();
  for (const r of ok) {
    const clave = `${r.motor}@${r.lado}`;
    if (!byMotor.has(clave)) byMotor.set(clave, { motor: r.motor, lado: r.lado, runs: [] });
    byMotor.get(clave).runs.push(r);
  }

  const mediana = (xs) => {
    const a = [...xs].sort((p, q) => p - q);
    if (a.length === 0) return NaN;
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };

  const filas = [];
  for (const { motor, lado, runs } of byMotor.values()) {
    const reales = runs.filter((r) => r.doc !== "sintetica");
    const sint = runs.filter((r) => r.doc === "sintetica");
    let etiqHit = 0, etiqTot = 0;
    for (const r of reales) {
      for (const e of r.etiquetas ?? []) { etiqTot++; if (e.hit) etiqHit++; }
    }
    const pss = runs.map((r) => r.pssPicoMB).filter((x) => x != null);
    filas.push({
      motor, lado,
      msMediana: Math.round(mediana(runs.map((r) => r.ms))),
      pssPicoMB: pss.length ? Math.max(...pss) : null,
      heapPicoMB: Math.max(...runs.map((r) => r.heapPicoMB ?? -1)),
      conf: Math.round(runs.reduce((s, r) => s + (r.conf ?? 0), 0) / runs.length),
      chars: Math.round(runs.reduce((s, r) => s + (r.chars ?? 0), 0) / runs.length),
      etiquetas: etiqTot ? `${etiqHit}/${etiqTot}` : "—",
      etiqRatio: etiqTot ? etiqHit / etiqTot : null,
      cer: sint.length ? mediana(sint.map((r) => r.cer)) : null,
      wer: sint.length ? mediana(sint.map((r) => r.wer)) : null,
      cabe4GB: pss.length ? Math.max(...pss) <= TECHO_PSS_4GB_MB : null,
      n: runs.length,
    });
  }
  filas.sort((a, b) => a.motor.localeCompare(b.motor) || a.lado - b.lado);

  console.log("\n═══ MOTOR × RESOLUCIÓN (todas las maestras, caliente) ═══");
  console.table(filas.map((f) => ({
    motor: f.motor,
    lado: f.lado,
    "ms mediana": f.msMediana,
    "PSS pico MB": f.pssPicoMB ?? "—",
    "heap MB": f.heapPicoMB,
    conf: f.conf,
    chars: f.chars,
    "etiquetas reales": f.etiquetas,
    CER: f.cer ?? "—",
    WER: f.wer ?? "—",
    "cabe 4GB": f.cabe4GB == null ? "—" : f.cabe4GB ? "sí" : "NO",
    n: f.n,
  })));

  const usables = filas.filter((f) => Number.isFinite(f.msMediana));
  const minMs = Math.min(...usables.map((f) => f.msMediana));
  const recursosDe = (f) => (f.pssPicoMB != null ? f.pssPicoMB : f.heapPicoMB > 0 ? f.heapPicoMB : null);
  const recursos = usables.map(recursosDe).filter((x) => x != null);
  const minRec = recursos.length ? Math.min(...recursos) : null;

  const score = usables.map((f) => {
    const precision = f.cer != null && f.etiqRatio != null
      ? 0.5 * (1 - f.cer) + 0.5 * f.etiqRatio
      : f.cer != null ? 1 - f.cer : f.etiqRatio ?? 0;
    const velocidad = minMs / f.msMediana;
    const rec = recursosDe(f);
    const recN = rec != null && minRec != null ? minRec / rec : 0.5;
    return {
      config: `${f.motor}@${f.lado}`,
      precision: +(precision * 100).toFixed(1),
      velocidad: +(velocidad * 100).toFixed(1),
      recursos: +(recN * 100).toFixed(1),
      gate4GB: f.cabe4GB,
      total: +(0.5 * precision * 100 + 0.3 * velocidad * 100 + 0.1 * 100 + 0.1 * recN * 100).toFixed(1),
      pssPicoMB: f.pssPicoMB,
    };
  }).sort((a, b) => b.total - a.total);

  console.log("\n═══ SCORECARD (pesos 50/30/10/10; «ligero» neutro en esta fase) ═══");
  console.table(score.slice(0, 12));

  const resumen = {
    fecha: new Date().toISOString(),
    meta: snap.meta,
    filas,
    score,
    gate: { techoPssMB: TECHO_PSS_4GB_MB, nota: "PSS total del proceso Chrome medido con dumpsys meminfo durante cada corrida; incluye la línea base del navegador." },
    nota: "Precisión = 50 % (1-CER sintética) + 50 % (etiquetas impresas halladas en maestras reales, con denominador); Velocidad = ms mediana caliente normalizada; Ligero = neutro (fase 1, se completa con tamaños/hashes); Recursos = PSS pico medido normalizado. Sin texto personal en este resumen.",
  };
  writeFileSync(join(dirSalida, "resumen-medicion.json"), JSON.stringify(resumen, null, 1));
  console.log(`\nResumen: ${join(dirSalida, "resumen-medicion.json")}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Modo dispositivo
// ─────────────────────────────────────────────────────────────────────────────

function opcion(nombre) {
  const i = process.argv.indexOf(nombre);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function correrDispositivo() {
  const nombre = opcion("--equipo") ?? "a56";
  const cfg = EQUIPOS[nombre];
  if (!cfg) throw new Error(`equipo desconocido: ${nombre} (usa ${Object.keys(EQUIPOS).join(", ")})`);
  const hilos = parseInt(opcion("--hilos") ?? String(cfg.hilos), 10);
  const propias = (opcion("--maestras") ?? "todas") === "propias";
  const maestra = opcion("--maestra") ?? "";
  const rectificadas = process.argv.includes("--rectificadas");
  // Inventario alternativo en /gt (p. ej. inventario-familia.json) y carpeta
  // de salida propia para no pisar la matriz principal del equipo.
  const inventario = opcion("--inventario") ?? "";
  const carpeta = opcion("--carpeta") ?? "";
  const limiteIdx = process.argv.indexOf("--limite");
  const limite = limiteIdx > -1 ? parseInt(process.argv[limiteIdx + 1], 10) : Infinity;

  if (!existsSync(join(BENCH, "bench-medicion.js"))) throw new Error("falta el bundle — ejecuta `bun materializar.mjs`");
  const serial = resolverSerial(cfg.coincidencia);
  const info = infoEquipo(serial);
  const timeoutPrevio = mantenerDespierto(serial);
  const dir = join(OUT, carpeta ? join(nombre, carpeta) : nombre);
  mkdirSync(dir, { recursive: true });

  const servidor = servir();
  console.log(`HTTP 127.0.0.1:${PUERTO_HTTP} (/_bench + /maestras + /gt, COOP/COEP)`);
  const rev = adb(serial, "reverse", `tcp:${PUERTO_HTTP}`, `tcp:${PUERTO_HTTP}`);
  if (rev.code !== 0) { servidor.stop(); throw new Error(`adb reverse falló: ${rev.stderr.trim()}`); }
  console.log(`pantalla: sin apagado ni bloqueo (timeout previo ${timeoutPrevio} ms)`);
  const url = `http://127.0.0.1:${PUERTO_HTTP}/_bench/?hilos=${hilos}&equipo=${nombre}${propias ? "&maestras=propias" : ""}${maestra ? `&maestra=${encodeURIComponent(maestra)}` : ""}${rectificadas ? "&rectificadas=1" : ""}${inventario ? `&inv=${encodeURIComponent(inventario)}` : ""}`;
  // La URL lleva «&»: va entre comillas dentro de un único comando para sh remoto.
  const am = sh(ADB, ["-s", serial, "shell", `am start -a android.intent.action.VIEW -d "${url}" -p com.android.chrome`]);
  if (am.code !== 0) { servidor.stop(); throw new Error(`am start falló: ${am.stderr.trim()}`); }
  console.log(`${info.modelo} (Android ${info.android}, ${info.memTotalMB} MB RAM) — ${serial}`);
  console.log(`URL en el teléfono: ${url} — hilos WASM: ${hilos} — maestras: ${maestra ? `solo «${maestra}» + sintética` : rectificadas ? "rectificadas (limpias) + sintética" : propias ? "propias + sintética" : "todas"}`);

  const cdp = await conectarPaginaTelefono(cfg.cdp);
  await cdp.enviar("Runtime.enable").catch(() => {});
  await cdp.enviar("Log.enable").catch(() => {});
  await cdp.enviar("Page.enable").catch(() => {});
  await cdp.enviar("Page.navigate", { url }).catch(() => {});
  let st = await esperarListo(cdp);
  console.log(`\nArnés listo: ${st.total} corridas`);

  const pss = [];
  const parcial = join(dir, "resultados-parcial.json");
  const idxReanudar = process.argv.indexOf("--reanudar");
  let previos = [];
  if (idxReanudar > -1 && existsSync(process.argv[idxReanudar + 1])) {
    previos = JSON.parse(readFileSync(process.argv[idxReanudar + 1], "utf8")).resultados ?? [];
    await cdp.evaluar(`window.__ARNES.inyectar(${JSON.stringify(previos)})`);
    yaHechos = previos.length;
    console.log(`Reanudado desde ${previos.length} resultados`);
  }

  const sampler = new MuestreadorMemoria(serial);
  sampler.start();
  const t0 = Date.now();
  let ultimoCheckpoint = -1;
  let reintentos = 0;

  const recargar = async () => {
    const snap = await snapConMemoria(cdp, pss, info);
    writeFileSync(parcial, JSON.stringify(snap));
    const hechos = (snap.resultados ?? []).length;
    await cdp.enviar("Page.navigate", { url }).catch(() => {});
    adb(serial, "shell", "input", "keyevent", "KEYCODE_WAKEUP");
    await esperarListo(cdp);
    await cdp.evaluar(`window.__ARNES.inyectar(${JSON.stringify(snap.resultados ?? [])})`);
    yaHechos = hechos;
    console.log(`  ↻ página recargada con ${hechos} resultados preservados`);
  };

  while (true) {
    const antes = yaHechos;
    sampler.reset();
    let r;
    try {
      r = await cdp.evaluar("window.__ARNES.ejecutar(1)");
    } catch (e) {
      reintentos++;
      if (reintentos > 6) throw new Error(`CDP falla repetidamente: ${e.message}`);
      console.log(`  ⚠ ${String(e.message).slice(0, 80)} — recargando (${reintentos})`);
      await recargar().catch(() => undefined);
      continue;
    }
    reintentos = 0;
    yaHechos = r.hechos;
    pss[antes] = { pssMB: sampler.picoPssMB, libreMB: sampler.memLibreMinMB };

    if (r.hechos !== ultimoCheckpoint && (r.hechos % 10 === 0 || r.listo)) {
      ultimoCheckpoint = r.hechos;
      writeFileSync(parcial, JSON.stringify(await snapConMemoria(cdp, pss, info)));
    }
    const min = ((Date.now() - t0) / 60000).toFixed(1);
    const ult = pss[antes];
    console.log(`  ${r.hechos}/${r.total} — ${min} min — errores: ${r.errores} — PSS: ${ult?.pssMB ?? "?"} MB — libre: ${ult?.libreMB ?? "?"} MB`);

    if (ult?.pssMB != null && ult.pssMB > cfg.techoRecicloMB) {
      console.log(`  ⚠ PSS ${ult.pssMB} MB > ${cfg.techoRecicloMB} — recargando para no acercarse al gate`);
      await recargar();
    }
    if (r.hechos >= limite) {
      console.log(`Límite alcanzado (${limite})`);
      const snap = await snapConMemoria(cdp, pss, info);
      writeFileSync(parcial, JSON.stringify(snap));
      sampler.stop();
      await cdp.enviar("Page.navigate", { url: "about:blank" }).catch(() => {});
      servidor.stop();
      restaurarTimeout(serial, timeoutPrevio);
      return;
    }
    if (r.listo) break;
  }

  sampler.stop();
  const snap = await snapConMemoria(cdp, pss, info);
  const salida = join(dir, "resultados-medicion.json");
  writeFileSync(salida, JSON.stringify(snap));
  console.log(`Crudo guardado: ${salida}`);
  const picoPss = Math.max(...(snap.resultados ?? []).map((x) => x.pssPicoMB ?? 0));
  console.log(`PSS pico medido en el teléfono: ${picoPss} MB (gate 4 GB: ≤ ${TECHO_PSS_4GB_MB} MB)`);
  await cdp.enviar("Page.navigate", { url: "about:blank" }).catch(() => {});
  servidor.stop();
  restaurarTimeout(serial, timeoutPrevio);
  analizar(salida, dir);
}

let yaHechos = 0;

// ─────────────────────────────────────────────────────────────────────────────
// Modo escritorio (laboratorio opcional, no es la medición oficial)
// ─────────────────────────────────────────────────────────────────────────────

let chromeProc = null;

function arrancarChromeEscritorio() {
  const chromePath = CHROME_CANDIDATOS.find((p) => existsSync(p));
  if (!chromePath) throw new Error("no hay Chrome instalado");
  try { rmSync(PERFIL, { recursive: true, force: true }); } catch { /* sin perfil previo */ }
  const q = new URLSearchParams();
  if (process.argv.includes("--rectificadas")) q.set("rectificadas", "1");
  const inv = opcion("--inventario");
  if (inv) q.set("inv", inv);
  const args = [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--enable-precise-memory-info", "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
    "--renderer-process-limit=1", "--js-flags=--max-old-space-size=1536",
    "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${PERFIL}`, `--remote-debugging-port=${PUERTO_CDP_ESCRITORIO}`,
    "--window-size=1400,1000", `http://127.0.0.1:${PUERTO_HTTP}/_bench/${q.size > 0 ? "?" + q : ""}`,
  ];
  chromeProc = spawn(chromePath, args, { stdio: ["ignore", "pipe", "pipe"] });
  chromeProc.stderr.on("data", () => { /* ruido de Chrome headless */ });
  console.log(`Chrome escritorio (CDP :${PUERTO_CDP_ESCRITORIO})`);
}

async function conectarPaginaEscritorio() {
  for (let i = 0; i < 120; i++) {
    try {
      const arr = await (await fetch(`http://127.0.0.1:${PUERTO_CDP_ESCRITORIO}/json/list`)).json();
      const pag = arr.find((t) => t.type === "page" && t.url.includes(`:${PUERTO_HTTP}`));
      if (pag) {
        const cdp = await Cdp.conectar(pag.webSocketDebuggerUrl);
        await cdp.enviar("Runtime.enable");
        await cdp.enviar("Log.enable");
        return cdp;
      }
    } catch { /* arrancando */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("no hay página del arnés en /json/list");
}

async function correrEscritorio() {
  const dir = join(OUT, "escritorio");
  mkdirSync(dir, { recursive: true });
  if (!existsSync(join(BENCH, "bench-medicion.js"))) throw new Error("falta el bundle — ejecuta `bun materializar.mjs`");
  const servidor = servir();
  console.log(`HTTP 127.0.0.1:${PUERTO_HTTP} (/_bench + /maestras + /gt, COOP/COEP)`);
  arrancarChromeEscritorio();
  let cdp = await conectarPaginaEscritorio();
  await esperarListo(cdp, 300).catch((e) => { throw e; });
  const limiteIdx = process.argv.indexOf("--limite");
  const limite = limiteIdx > -1 ? parseInt(process.argv[limiteIdx + 1], 10) : Infinity;

  const pss = [];
  while (true) {
    const r = await cdp.evaluar("window.__ARNES.ejecutar(1)");
    console.log(`  ${r.hechos}/${r.total} — errores: ${r.errores} — heap: ${r.heapMB} MB`);
    if (r.hechos >= limite || r.listo) break;
  }
  const snap = await snapConMemoria(cdp, pss, { modelo: "escritorio" });
  const salida = join(dir, "resultados-medicion.json");
  writeFileSync(salida, JSON.stringify(snap));
  chromeProc?.kill();
  servidor.stop();
  analizar(salida, dir);
}

// ─────────────────────────────────────────────────────────────────────────────

const ejecutar = process.argv.includes("--escritorio") ? correrEscritorio() : correrDispositivo();
ejecutar.catch((e) => {
  console.error(`FALLO: ${e.message}`);
  chromeProc?.kill();
  process.exit(1);
});
