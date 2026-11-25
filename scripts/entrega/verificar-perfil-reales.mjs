/**
 * verificar-perfil-reales.mjs — perfil de tiempos y memoria del pipeline real
 * (detect 400 px → warp 12 MP → enhance bw PNG 4032 → dataURL) en el A13.
 * SOLO mide: no toca app, detection-worker.js (asset md5), umbrales ni salidas.
 *
 * Muestreo por foto:
 *   · dispositivo cada 500 ms (1 adb shell): meminfo seleccionado (MemAvailable,
 *     Shmem, AnonPages, Writeback…), PSI, zram mm_stat, loadavg, freqs,
 *     thermal_zone*, y RSS/statm + oom_score_adj de los procesos Chrome.
 *     `smaps_rollup` está DENEGADO entre apps y `dmesg` también (sin root):
 *     PSS/swap solo con `dumpsys meminfo` 1× por foto y muertes por logcat.
 *   · página cada 250 ms: performance.memory, lag del event loop, longtasks.
 *   · IPC: tEnvio/tRecv de cada postMessage + elapsedMs/memory del worker.
 *
 * Arranque (condiciones del owner): logcat limpio (`logcat -b all -c`),
 * `am kill-all`, Chrome al frente con la app, pantalla despierta, forward CDP
 * tcp:9223 → chrome_devtools_remote y temperatura base registrada.
 *
 * Uso:
 *   TAMIZ_ADB_SERIAL=192.168.1.4:35543 node scripts/entrega/verificar-perfil-reales.mjs
 *     [--fotos a.jpg,b.jpg] [--sin-sampler] [--misma-pestana] [--sin-cooldown]
 *     [--cdp http://127.0.0.1:9223]
 *
 * Salida: scripts/resultados/perfil-a13-<ts>.json + perfil-a13-progreso.log.
 * Exit 1 si alguna foto no produce timeline.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ADB, RESULTADOS, RAIZ, conectarA56, crearProgreso, serialAdb } from "./a56-comun.mjs";

const argDe = (nombre) => {
  const i = process.argv.indexOf(nombre);
  return i > -1 ? process.argv[i + 1] : null;
};
const CDP = argDe("--cdp") ?? "http://127.0.0.1:9223";
const SIN_SAMPLER = process.argv.includes("--sin-sampler");
const MISMA_PESTANA = process.argv.includes("--misma-pestana");
const SIN_COOLDOWN = process.argv.includes("--sin-cooldown");
const FOTOS = (
  argDe("--fotos") ??
  // 2 fáciles + 2 difíciles (las difíciles son las giradas/manuscritas).
  "20261123_201944.jpg,20261123_202044.jpg,20261123_222555.jpg,20261123_223112.jpg"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const DIR_REALES = join(RAIZ, "apps", "tamiz", "public", "dev-fixtures", "reales");
const disponible = new Set(readdirSync(DIR_REALES));
for (const f of FOTOS) {
  if (!disponible.has(f)) {
    console.error(`BLOQUEADA: falta ${f} en ${DIR_REALES}`);
    process.exit(1);
  }
}
mkdirSync(RESULTADOS, { recursive: true });
const progreso = crearProgreso("perfil-a13-progreso.log");
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function adbShell(cmd, timeout = 20000) {
  const serial = serialAdb();
  if (!serial) return null;
  return execFileSync(ADB, ["-s", serial, "shell", cmd], {
    encoding: "utf-8",
    timeout,
    maxBuffer: 4 * 1024 * 1024,
  });
}

async function cdpResponde() {
  try {
    const r = await fetch(`${CDP}/json/version`, { signal: AbortSignal.timeout(4000) });
    return r.ok;
  } catch {
    return false;
  }
}

async function asegurarCdp() {
  if (await cdpResponde()) return "ya expuesto";
  const serial = serialAdb();
  if (!serial) return "sin serial";
  try {
    execFileSync(ADB, ["-s", serial, "forward", "tcp:9223", "localabstract:chrome_devtools_remote"], {
      timeout: 15000,
    });
    for (let i = 0; i < 6; i++) {
      await dormir(1000);
      if (await cdpResponde()) return "forward tcp:9223 creado";
    }
  } catch (e) {
    return `error forward: ${e.message.slice(0, 160)}`;
  }
  return "no responde tras forward";
}

// ─── Compuerta de arranque (buffers limpios, pantalla despierta, Chrome al frente) ──
const arranque = {};
{
  const serial = serialAdb();
  if (serial) {
    try {
      const potencia = adbShell("dumpsys power | grep -m1 mWakefulness", 15000) ?? "";
      arranque.wakefulness = potencia.trim() || "?";
      if (!/Awake/.test(potencia)) {
        adbShell("input keyevent KEYCODE_WAKEUP", 15000);
        arranque.wakefulness += " → KEYCODE_WAKEUP";
      }
    } catch (e) {
      arranque.wakefulness = `error: ${e.message.slice(0, 100)}`;
    }
    try {
      // Los eventos de muerte (am_proc_died/lmkd) deben ser SOLO de esta prueba.
      adbShell("logcat -b all -c", 15000);
      arranque.logcat = "limpiado";
    } catch (e) {
      arranque.logcat = `error: ${e.message.slice(0, 100)}`;
    }
    try {
      // Procesos en segundo plano fuera; Chrome al frente con la app (solo si
      // no hay ya una pestaña viva de la app, para no acumular pestañas).
      arranque.killAll = (adbShell("am kill-all", 20000) ?? "").trim().split("\n")[0] || "ok";
      const paginas = await fetch(`${CDP}/json/list`, { signal: AbortSignal.timeout(4000) })
        .then((r) => r.json())
        .catch(() => []);
      const hayApp = Array.isArray(paginas) && paginas.some((t) => t.type === "page" && t.url.includes("localhost:3100"));
      if (hayApp) {
        arranque.chromeAlFrente = "ya abierto";
      } else {
        adbShell('am start -a android.intent.action.VIEW -d "http://localhost:3100/" -p com.android.chrome', 20000);
        arranque.chromeAlFrente = "am start ok";
        await dormir(4000);
      }
    } catch (e) {
      arranque.killAll = `error: ${e.message.slice(0, 120)}`;
    }
    try {
      arranque.forwards = (execFileSync(ADB, ["-s", serial, "forward", "--list"], { encoding: "utf-8", timeout: 15000 }) ?? "")
        .trim()
        .split("\n")
        .filter(Boolean);
    } catch (e) {
      arranque.forwards = [`error: ${e.message.slice(0, 100)}`];
    }
  }
  arranque.cdp = await asegurarCdp();
}

// ─── Muestra del DISPOSITIVO (un solo shell persistente; sin round-trips adb) ──
// Cada tic emite @@TICK <epoch-ns> y lecturas baratas. ps/statm por proceso eran
// el 90 % del costo y además smaps_rollup está denegado: el RSS por proceso se
// toma aparte, una vez antes y otra después de la foto (fuera del cronometraje).
const CMD_LOOP = `while :; do
  echo "@@TICK $(date +%s%N)"
  echo __MEM__
  grep -E '^(MemAvailable|MemFree|SwapFree|SwapTotal|Dirty|Writeback|Shmem|AnonPages|Cached|SUnreclaim):' /proc/meminfo
  echo __PSI__
  cat /proc/pressure/memory 2>/dev/null
  echo __ZRAM__
  cat /sys/block/zram0/mm_stat 2>/dev/null
  echo __LOAD__
  cat /proc/loadavg
  echo __FREQ__
  cat /sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq 2>/dev/null
  sleep 0.5
done`;

function parsearMuestra(texto, t, msAdb) {
  const sec = {};
  let actual = null;
  for (const cruda of texto.split(/\r?\n/)) {
    const linea = cruda.trim();
    const m = /^__([A-Z]+)__$/.exec(linea);
    if (m) {
      actual = m[1].toLowerCase();
      sec[actual] = [];
      continue;
    }
    if (actual) sec[actual].push(linea);
  }
  const mem = {};
  for (const l of sec.mem ?? []) {
    const m = /^(\w+):\s+(\d+) kB/.exec(l);
    if (m) mem[m[1]] = Math.round(Number(m[2]) / 1024); // MB
  }
  const psi = {};
  for (const l of sec.psi ?? []) {
    const m = /^(some|full)\s+avg10=([\d.]+)\s+avg60=([\d.]+)\s+avg300=([\d.]+)\s+total=(\d+)/.exec(l);
    if (m) psi[m[1]] = { avg10: Number(m[2]), avg300: Number(m[4]), total: Number(m[5]) };
  }
  const zr = (sec.zram ?? [])[0]?.split(/\s+/).map(Number) ?? [];
  const zram =
    zr.length >= 7 && Number.isFinite(zr[0])
      ? {
          origMb: Math.round(zr[0] / 1048576),
          comprMb: Math.round(zr[1] / 1048576),
          memUsadaMb: Math.round(zr[2] / 1048576),
          usadaMaxMb: Math.round(zr[4] / 1048576),
          mismasPaginas: zr[5],
          paginasCompactadas: zr[6],
        }
      : null;
  const load1 = Number((sec.load ?? [])[0]?.split(/\s+/)[0]);
  const freqsMhz = (sec.freq ?? [])
    .map((x) => Math.round(Number(x) / 1000))
    .filter((x) => Number.isFinite(x) && x > 0);
  const thermal = {};
  for (const l of sec.therm ?? []) {
    const m = /^(\S+)\s+(-?\d+)/.exec(l);
    if (m) thermal[m[1]] = Number(m[2]); // m°C
  }
  const nombres = {};
  for (const l of sec.ps ?? []) {
    const p = l.split(/\s+/);
    const pid = Number(p[0]);
    if (Number.isFinite(pid) && pid > 0) nombres[pid] = p.find((x) => /chrome/i.test(x)) ?? p.slice(1).join(" ");
  }
  const procs = {};
  let pidActual = null;
  for (const l of sec.statm ?? []) {
    const s = /^@@\s+(\d+)/.exec(l);
    if (s) {
      pidActual = Number(s[1]);
      continue;
    }
    if (pidActual == null || !l) continue;
    const oom = /^oom\s+(-?\d+)/.exec(l);
    if (oom) {
      procs[pidActual] = { ...(procs[pidActual] ?? {}), oomScoreAdj: Number(oom[1]) };
      continue;
    }
    const campos = l.split(/\s+/).map(Number);
    if (campos.length >= 2 && Number.isFinite(campos[1])) {
      procs[pidActual] = {
        ...(procs[pidActual] ?? {}),
        nombre: nombres[pidActual] ?? null,
        vszMb: Math.round((campos[0] * 4) / 1024),
        rssMb: Math.round((campos[1] * 4) / 1024),
      };
    }
  }
  return {
    t,
    msAdb,
    mem,
    psi,
    zram,
    load1: Number.isFinite(load1) ? load1 : null,
    freqsMhz,
    thermal,
    procs,
  };
}

function crearSamplerDispositivo() {
  const serial = serialAdb();
  if (!serial) return null;
  const muestras = [];
  const hijo = spawn(ADB, ["-s", serial, "shell", CMD_LOOP], { stdio: ["ignore", "pipe", "ignore"] });
  let buf = "";
  hijo.stdout.setEncoding("utf-8");
  const procesar = () => {
    const idx = buf.lastIndexOf("@@TICK ");
    if (idx <= 0) return; // aún no hay un bloque completo
    const completo = buf.slice(0, idx);
    buf = buf.slice(idx);
    for (const bloque of completo.split("@@TICK ").slice(1)) {
      const m = /^(\d+)\r?\n([\s\S]*)$/.exec(bloque);
      if (m) muestras.push(parsearMuestra(m[2], Math.round(Number(m[1]) / 1e6), null));
    }
  };
  hijo.stdout.on("data", (trozo) => {
    buf += trozo;
    procesar();
  });
  return {
    muestras,
    stop: () =>
      new Promise((res) => {
        let resuelto = false;
        const fin = () => {
          if (resuelto) return;
          resuelto = true;
          res(muestras);
        };
        hijo.once("close", fin);
        hijo.kill(); // al cerrar stdout el while remoto muere con SIGPIPE
        setTimeout(fin, 1500);
      }),
  };
}

/** RSS de los procesos Chrome (una sola llamada; ps -o RSS no necesita smaps). */
function rssChrome() {
  try {
    const out = adbShell("ps -A -o PID,RSS,NAME | grep -i chrome | grep -v grep", 15000) ?? "";
    const filas = [];
    for (const l of out.split(/\r?\n/)) {
      const m = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(l);
      if (m) filas.push({ pid: Number(m[1]), rssMb: Math.round(Number(m[2]) / 1024), nombre: m[3].trim() });
    }
    return filas;
  } catch {
    return null;
  }
}

function dumpsysMeminfoChrome() {
  const serial = serialAdb();
  if (!serial) return null;
  try {
    const out = execFileSync(ADB, ["-s", serial, "shell", "dumpsys meminfo com.android.chrome"], {
      encoding: "utf-8",
      timeout: 30000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return out
      .split(/\r?\n/)
      .filter((l) => /TOTAL PSS|TOTAL RSS|Java Heap:|Native Heap:|Graphics:|GL mtrack|EGL mtrack|SwapPss|TOTAL SWAP/i.test(l))
      .map((l) => l.trim())
      .slice(0, 60);
  } catch {
    return null;
  }
}

function tempBateriaC() {
  try {
    const out = adbShell("dumpsys battery | grep -i temperature", 15000);
    const t = Number(/temperature:\s*(\d+)/i.exec(out ?? "")?.[1]);
    return Number.isFinite(t) ? t / 10 : null;
  } catch {
    return null;
  }
}

function instantaneaSistema(serial) {
  const partes = {};
  const leer = (etiqueta, cmd) => {
    try {
      partes[etiqueta] = execFileSync(ADB, ["-s", serial, "shell", cmd], {
        encoding: "utf-8",
        timeout: 20000,
        maxBuffer: 1024 * 1024,
      }).trim();
    } catch (e) {
      partes[etiqueta] = `error: ${e.message.slice(0, 120)}`;
    }
  };
  leer("kernel", "uname -r");
  // /sys/class/thermal/* está DENEGADO para shell en este build; thermalservice sí.
  leer("termica", "dumpsys thermalservice 2>/dev/null | grep -m8 -E 'mValue=.*mName='");
  return partes;
}

/** Temperatura de batería + zonas (AP/SKIN/BAT): solo entre fotos, fuera del
 *  cronometraje del pipeline. */
function termica() {
  try {
    const a = adbShell("dumpsys battery | grep -i temperature", 15000) ?? "";
    const bateriaC = Number(/temperature:\s*(\d+)/i.exec(a)?.[1]) / 10;
    const th = adbShell("dumpsys thermalservice 2>/dev/null | grep -m8 -E 'mValue=.*mName='", 15000) ?? "";
    const zonas = {};
    for (const l of th.split(/\r?\n/)) {
      const m = /mValue=([\d.]+).*mName=([A-Z_]+)/.exec(l);
      if (m) zonas[m[2]] = Number(m[1]);
    }
    return { bateriaC: Number.isFinite(bateriaC) ? bateriaC : null, zonas };
  } catch {
    return null;
  }
}

function recogerLogcat() {
  const serial = serialAdb();
  if (!serial) return null;
  const filtro = /am_kill|am_proc_died|am_low_memory|lmkd|lowmemorykiller|kill(ing|ed)?\s/i;
  const res = {};
  for (const [nombre, buffer] of [
    ["eventos", "events"],
    ["main", "main"],
  ]) {
    try {
      const out = execFileSync(ADB, ["-s", serial, "logcat", "-b", buffer, "-d"], {
        encoding: "utf-8",
        timeout: 30000,
        maxBuffer: 24 * 1024 * 1024,
      });
      res[nombre] = out.split(/\r?\n/).filter((l) => filtro.test(l)).slice(-40);
    } catch (e) {
      res[nombre] = [`error: ${e.message.slice(0, 160)}`];
    }
  }
  return res;
}

// ─── conexión y página ────────────────────────────────────────────────────
progreso(
  `perfil inicio · CDP=${CDP} (${arranque.cdp}) · serial=${serialAdb() ?? "?"} · ` +
    `${FOTOS.length} fotos · sampler=${SIN_SAMPLER ? "OFF (control)" : "ON"} · ` +
    `pestaña=${MISMA_PESTANA ? "misma" : "recargada"} · arranque=${JSON.stringify(arranque)}`,
);

let { navegador, contexto, pagina: paginaInicial, sesion: sesionInicial } = await conectarA56(CDP);
let pagina = paginaInicial;
let sesion = sesionInicial;
let paginaCaida = false;
const errores = [];
function vigilarPagina(p) {
  p.on("pageerror", (e) => errores.push(`[pageerror] ${String(e).slice(0, 300)}`));
  p.on("crash", () => {
    paginaCaida = true;
    errores.push(`[crash] renderer de la página murió (${new Date().toISOString()})`);
  });
}
vigilarPagina(pagina);

/** La app abre la cámara al montar y tras cada recarga: con 12 MP + cámara el
 *  lmkd mata el renderer (am_proc_died, available 214 MB). Para medir el
 *  import/worker se niega getUserMedia en TODAS las navegaciones del harness
 *  (solo perfilado; la app no se modifica). */
let camaraNeutralizada = false;
async function neutralizarCamara() {
  if (camaraNeutralizada) return;
  camaraNeutralizada = true;
  await contexto.addInitScript(() => {
    try {
      if (navigator.mediaDevices) {
        navigator.mediaDevices.getUserMedia = () =>
          Promise.reject(new DOMException("perfil: cámara deshabilitada para medir", "NotAllowedError"));
      }
    } catch {
      /* sin mediaDevices no hay cámara que apagar */
    }
  });
}

async function reiniciarChrome(motivo) {
  errores.push(`[recuperar] Chrome sin pestañas (${motivo}) — reinicio completo`);
  progreso("Chrome quedó sin TabModelList — reinicio completo del navegador");
  await navegador.close().catch(() => undefined);
  adbShell("am force-stop com.android.chrome", 15000);
  adbShell('am start -a android.intent.action.VIEW -d "http://localhost:3100/" -p com.android.chrome', 20000);
  await new Promise((r) => setTimeout(r, 5000));
  const nueva = await conectarA56(CDP);
  navegador = nueva.navegador;
  contexto = nueva.contexto;
  pagina = nueva.pagina;
  sesion = nueva.sesion;
  vigilarPagina(pagina);
  camaraNeutralizada = false; // contexto nuevo: hay que reinstalar el init script
  await neutralizarCamara();
  await pagina.goto("http://localhost:3100/", { waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => undefined);
  await pagina.waitForTimeout(1500).catch(() => undefined);
  await detenerCamara();
  paginaCaida = false;
}

async function recuperarPagina(motivo) {
  errores.push(`[recuperar] ${motivo}`);
  progreso(`página caída (${motivo}) — se crea una nueva`);
  await pagina.close().catch(() => undefined);
  let nueva;
  try {
    nueva = await contexto.newPage();
  } catch (e) {
    await reiniciarChrome(String(e instanceof Error ? e.message : e).slice(0, 120));
    return;
  }
  pagina = nueva;
  vigilarPagina(pagina);
  try {
    sesion = await contexto.newCDPSession(pagina);
    await neutralizarCamara();
    await pagina.goto("http://localhost:3100/", { waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => undefined);
    await pagina.waitForTimeout(1500).catch(() => undefined);
    await detenerCamara();
    paginaCaida = false;
  } catch (e) {
    await reiniciarChrome(`recuperación falló: ${String(e instanceof Error ? e.message : e).slice(0, 120)}`);
  }
}

async function detenerCamara() {
  await pagina
    .evaluate(() => {
      for (const v of document.querySelectorAll("video")) {
        v.srcObject?.getTracks?.().forEach((t) => t.stop());
      }
    })
    .catch(() => undefined);
}

/** Worker OpenCV del visor + driver. En MISMA_PESTANA reutiliza el existente
 *  (así se ve el crecimiento del heap WASM entre fotos); en recarga nace nuevo. */
async function instalarWorker() {
  return pagina.evaluate(async () => {
    const w = window;
    if (w.__recorteWorker) return { listo: true, opencvUrl: w.__recorteWorker.opencvUrl ?? null, reusado: true };
    const crear = async () => {
      const worker = new Worker("/scanner/detection-worker.js");
      let boot;
      try {
        boot = await new Promise((res, rej) => {
          const to = setTimeout(() => rej(new Error("timeout boot worker (30 s)")), 30000);
          worker.onmessage = (e) => {
            const d = e.data;
            if (d.type === "ready") {
              clearTimeout(to);
              res(d);
            } else if (d.type === "error") {
              clearTimeout(to);
              rej(new Error(`worker: ${d.message}`));
            }
          };
        });
      } catch (e) {
        worker.terminate();
        throw e;
      }
      let ts = Date.now();
      const enviar = (msg, transfer) =>
        new Promise((res, rej) => {
          const tEnvio = performance.now();
          const to = setTimeout(() => rej(new Error(`timeout ${msg.type} (60 s)`)), 60000);
          worker.onmessage = (e) => {
            const d = e.data;
            if (d.ts !== msg.ts) return;
            clearTimeout(to);
            window.__perfilIpc?.push({
              tipo: msg.type,
              tEnvio,
              tRecv: performance.now(),
              workerMs: typeof d.elapsedMs === "number" ? d.elapsedMs : null,
              memoriaWorker: d.memory ?? null,
              respuesta: d.type,
            });
            if (d.type === "error") rej(new Error(`worker ${msg.type}: ${d.message}`));
            else if (d.type === "busy") rej(new Error("worker busy"));
            else res(d);
          };
          worker.postMessage(msg, transfer);
        });
      return { worker, enviar, sigTs: () => ++ts, opencvUrl: boot.opencvUrl ?? null };
    };
    let ultimo = null;
    for (let i = 0; i < 3; i++) {
      try {
        const drv = await crear();
        w.__recorteWorker = drv;
        w.__perfilIpc = [];
        return { listo: true, opencvUrl: drv.opencvUrl, intentos: i + 1 };
      } catch (e) {
        ultimo = e;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    throw new Error(`worker no booteó tras 3 intentos: ${ultimo instanceof Error ? ultimo.message : ultimo}`);
  });
}

// ─── sampler de la PÁGINA (250 ms) ────────────────────────────────────────
async function instalarSamplerPagina() {
  return pagina.evaluate(() => {
    const base = { hostEpoch: Date.now(), paginaT: performance.now() };
    const e = { base, muestras: [], lag: [], longtasks: [] };
    window.__perfilA13 = e;
    const leerMem = () =>
      performance.memory
        ? {
            usadoMb: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1),
            totalMb: +(performance.memory.totalJSHeapSize / 1048576).toFixed(1),
            limiteMb: +(performance.memory.jsHeapSizeLimit / 1048576).toFixed(1),
          }
        : null;
    e.idMuestreo = setInterval(() => {
      e.muestras.push({ t: performance.now(), mem: leerMem() });
    }, 250);
    let objetivo = performance.now() + 100;
    const latido = () => {
      e.idLatido = setTimeout(() => {
        const ahora = performance.now();
        e.lag.push({ t: ahora, ms: Math.max(0, Math.round(ahora - objetivo - 100)) });
        objetivo = performance.now() + 100;
        latido();
      }, 100);
    };
    latido();
    try {
      e.observador = new PerformanceObserver((lista) => {
        for (const x of lista.getEntries()) e.longtasks.push({ t: x.startTime, dur: Math.round(x.duration) });
      });
      e.observador.observe({ entryTypes: ["longtask"] });
    } catch {
      e.observador = null;
    }
    return base;
  });
}

async function cerrarSamplerPagina() {
  return pagina
    .evaluate(() => {
      const e = window.__perfilA13;
      if (!e) return null;
      clearInterval(e.idMuestreo);
      clearTimeout(e.idLatido);
      e.observador?.disconnect();
      delete window.__perfilA13;
      return { base: e.base, muestras: e.muestras, lag: e.lag, longtasks: e.longtasks };
    })
    .catch(() => null);
}

// ─── pipeline por foto (idéntico al harness de procesado) ────────────────
async function procesarFoto(archivo) {
  return pagina.evaluate(async (nombre) => {
    const drv = window.__recorteWorker;
    if (!drv) return { error: "worker no instalado" };
    window.__perfilIpc = [];
    const marcas = {};
    const marca = (k, desde) => {
      marcas[k] = Math.round(performance.now() - desde);
    };
    const tTotal = performance.now();
    let t = performance.now();
    let blob;
    try {
      const resp = await fetch(`/dev-fixtures/reales/${nombre}`);
      if (!resp.ok) return { error: `fetch HTTP ${resp.status}` };
      blob = await resp.blob();
    } catch (e) {
      return { error: `fetch: ${String(e)}` };
    }
    marca("fetch", t);
    t = performance.now();
    let img;
    try {
      img = await createImageBitmap(blob);
    } catch {
      await new Promise((r) => setTimeout(r, 600));
      try {
        img = await createImageBitmap(blob);
      } catch (e2) {
        return { error: `decode: ${String(e2 instanceof Error ? e2.message : e2)}` };
      }
    }
    marca("decode", t);
    const W = img.width;
    const H = img.height;
    const s = 400 / Math.max(W, H);
    const dw = Math.max(1, Math.round(W * s));
    const dh = Math.max(1, Math.round(H * s));
    t = performance.now();
    const small = await createImageBitmap(img, { resizeWidth: dw, resizeHeight: dh, resizeQuality: "low" });
    marca("mini", t);
    t = performance.now();
    let det;
    try {
      det = await drv.enviar({ type: "detect", bitmap: small, ts: drv.sigTs() }, [small]);
    } catch (e) {
      img.close();
      return { error: `detección: ${String(e instanceof Error ? e.message : e)}`, W, H, marcas };
    }
    marca("detect", t);
    const corners = det.corners ? Array.from(det.corners) : null;
    if (!corners) {
      img.close();
      return { W, H, corners: null, marcas, error: "sin quad" };
    }
    t = performance.now();
    let wr;
    try {
      wr = await drv.enviar(
        { type: "warp", bitmap: img, quad: new Float32Array(corners), ts: drv.sigTs(), manual: true },
        [img],
      );
    } catch (e) {
      return { W, H, corners, marcas, error: `warp: ${String(e instanceof Error ? e.message : e)}` };
    }
    marca("warp", t);
    t = performance.now();
    let enh;
    try {
      enh = await drv.enviar(
        { type: "enhance", bitmap: wr.bitmap, mode: "bw", maxLongSide: 4032, ts: drv.sigTs() },
        [wr.bitmap],
      );
    } catch (e) {
      return { W, H, corners, marcas, error: `enhance: ${String(e instanceof Error ? e.message : e)}` };
    }
    marca("enhanceBw", t);
    t = performance.now();
    let dataUrlLen = null;
    try {
      const dataUrl = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result));
        fr.onerror = () => rej(new Error("FileReader del PNG falló"));
        fr.readAsDataURL(enh.blob);
      });
      dataUrlLen = dataUrl.length;
    } catch (e) {
      return { W, H, corners, marcas, error: `dataURL: ${String(e instanceof Error ? e.message : e)}` };
    }
    marca("dataUrl", t);
    marcas.total = Math.round(performance.now() - tTotal);
    return {
      W,
      H,
      corners,
      refined: wr.refined ?? null,
      w: enh.w,
      h: enh.h,
      mime: enh.mime ?? null,
      pngBytes: enh.blob?.size ?? null,
      dataUrlLen,
      marcas,
      ipc: window.__perfilIpc.slice(),
    };
  }, archivo);
}

function areaQuad(c) {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    a += c[2 * i] * c[2 * j + 1] - c[2 * j] * c[2 * i + 1];
  }
  return Math.abs(a) / 2;
}

async function esperarFrio(baseC) {
  if (SIN_COOLDOWN || baseC == null) return { omitido: true };
  const tope = Date.now() + 4 * 60 * 1000;
  const t0 = Date.now();
  for (;;) {
    const t = tempBateriaC();
    if (t == null) return { omitido: true };
    if (t <= baseC + 1.5) return { temperaturaC: t, esperaMs: Date.now() - t0 };
    if (Date.now() > tope) return { temperaturaC: t, esperaMs: Date.now() - t0, agotado: true };
    progreso(`cooldown: ${t}°C > base+1.5 (${(baseC + 1.5).toFixed(1)}) — espera 20 s`);
    await dormir(20000);
  }
}

function resumenFoto(fila) {
  const ms = fila.marcas ?? {};
  const dev = fila.muestrasDispositivo ?? [];
  const memLibre = dev.map((m) => m.mem?.MemAvailable).filter((x) => Number.isFinite(x));
  const ventana = dev.length > 1 ? Math.round((dev[dev.length - 1].t - dev[0].t) / 1000) : 0;
  const rss = fila.procesos?.despues ?? fila.procesos?.antes ?? [];
  const rssPico = rss.length ? Math.max(...rss.map((x) => x.rssMb)) : 0;
  const p = (k) => (ms[k] != null ? `${ms[k]}ms` : "?");
  return (
    `${fila.error ? "FALLA" : "ok   "} ${fila.archivo.padEnd(22)} ` +
    `dec=${p("decode")} det=${p("detect")} warp=${p("warp")} bw=${p("enhanceBw")} url=${p("dataUrl")} total=${p("total")} ` +
    `muestras=${dev.length}${ventana ? ` ventana=${ventana}s` : ""}` +
    (memLibre.length ? ` memLibreMin=${Math.min(...memLibre)}MB` : "") +
    (rssPico ? ` rssPico=${rssPico}MB` : "") +
    (fila.error ? ` ← ${fila.error}` : "")
  );
}

// ─── corrida ──────────────────────────────────────────────────────────────
const serial = serialAdb();
const sistema = serial ? instantaneaSistema(serial) : {};
const tempInicial = tempBateriaC();
progreso(`temperatura base: ${tempInicial ?? "?"}°C · kernel=${sistema.kernel ?? "?"}`);
const meminfoInicial = SIN_SAMPLER ? null : dumpsysMeminfoChrome();
const salida = join(RESULTADOS, `perfil-a13-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
const filas = [];

/** Evidencia incremental: una muerte del renderer (lmkd) no puede borrar las
 *  fotos ya medidas. */
function volcar(extra = {}) {
  try {
    writeFileSync(
      salida,
      JSON.stringify(
        {
          cdp: CDP,
          serial,
          medidoEn: new Date().toISOString(),
          sinSampler: SIN_SAMPLER,
          mismaPestana: MISMA_PESTANA,
          sinCooldown: SIN_COOLDOWN,
          arranque,
          sistema,
          tempInicialC: tempInicial,
          ...extra,
          errores,
          fotos: filas,
        },
        null,
        2,
      ),
    );
  } catch (e) {
    errores.push(`[json] no se pudo escribir: ${String(e).slice(0, 160)}`);
  }
}

const conTope = (promesa, ms, alternativa) =>
  Promise.race([promesa, new Promise((res) => setTimeout(() => res(alternativa), ms))]);

async function correrFoto(archivo, indice) {
  if (indice > 0 && !MISMA_PESTANA) {
    await pagina.reload({ waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => undefined);
    await pagina.waitForTimeout(1200).catch(() => undefined);
  }
  await conTope(detenerCamara(), 15000, undefined);
  if (MISMA_PESTANA && indice > 0) {
    // Separa basura no recolectada de memoria retenida antes de la foto.
    await sesion.send("HeapProfiler.collectGarbage").catch(() => undefined);
  }
  const camara = await pagina
    .evaluate(() =>
      Array.from(document.querySelectorAll("video")).map((v) => v.srcObject?.getVideoTracks?.().length ?? 0),
    )
    .catch(() => null);
  const tBoot = Date.now();
  let inst;
  try {
    inst = await instalarWorker();
  } catch (e) {
    progreso(`boot worker falló (${e instanceof Error ? e.message : e}) — recargando`);
    await pagina.reload({ waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => undefined);
    await pagina.waitForTimeout(2000).catch(() => undefined);
    await conTope(detenerCamara(), 15000, undefined);
    inst = await instalarWorker();
  }
  const bootMs = Date.now() - tBoot;
  progreso(`worker ${inst.reusado ? "reusado" : "listo"} (${inst.opencvUrl ?? "url?"}) boot=${bootMs}ms`);
  await pagina.waitForTimeout(600).catch(() => undefined);

  const termicaAntes = termica();
  const procesosAntes = SIN_SAMPLER ? null : rssChrome();
  const basePag = SIN_SAMPLER ? null : await instalarSamplerPagina().catch(() => null);
  const colector = SIN_SAMPLER ? null : crearSamplerDispositivo();
  const tFoto = Date.now();
  let r = {};
  let muestrasDispositivo = [];
  let pag = null;
  let meminfo = null;
  let termicaDespues = null;
  let procesosDespues = null;
  let tope = null;
  try {
    r = await Promise.race([
      procesarFoto(archivo),
      new Promise((_, rej) => {
        tope = setTimeout(() => rej(new Error("tope 180 s del pipeline agotado")), 180000);
      }),
    ]);
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e).slice(0, 200);
    r = { error: /tope 180/.test(msg) ? msg : `pipeline: ${msg}` };
  } finally {
    if (tope) clearTimeout(tope);
    if (colector) muestrasDispositivo = await conTope(colector.stop(), 5000, []);
    if (!SIN_SAMPLER) pag = await conTope(cerrarSamplerPagina(), 15000, null);
    if (!SIN_SAMPLER) meminfo = dumpsysMeminfoChrome();
    termicaDespues = termica();
    if (!SIN_SAMPLER) procesosDespues = rssChrome();
  }
  const msHost = Date.now() - tFoto;

  return {
    archivo,
    error: r.error ?? null,
    bootMs,
    msHost,
    camara,
    W: r.W ?? null,
    H: r.H ?? null,
    corners: r.corners ?? null,
    areaPct: r.corners ? Math.round(areaQuad(r.corners) * 1000) / 10 : null,
    w: r.w ?? null,
    h: r.h ?? null,
    mime: r.mime ?? null,
    pngBytes: r.pngBytes ?? null,
    dataUrlLen: r.dataUrlLen ?? null,
    marcas: r.marcas ?? null,
    ipc: r.ipc ?? [],
    memoriaPagina: pag,
    basePag,
    muestrasDispositivo,
    meminfo,
    termica: { antes: termicaAntes, despues: termicaDespues },
    procesos: { antes: procesosAntes, despues: procesosDespues },
    cooldown: null,
  };
}

try {
  await neutralizarCamara();
  await pagina.goto("http://localhost:3100/", { waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => undefined);
  await pagina.waitForTimeout(1500).catch(() => undefined);
  const vis = await pagina.evaluate(() => document.visibilityState).catch(() => "desconocido");
  if (vis !== "visible") progreso(`AVISO: pestaña ${vis} — Chrome en segundo plano contamina tiempos`);
  await conTope(detenerCamara(), 15000, undefined);

  for (const [indice, archivo] of FOTOS.entries()) {
    let fila = null;
    for (let intento = 1; intento <= 2 && fila == null; intento++) {
      try {
        if (paginaCaida || pagina.isClosed()) await recuperarPagina(`antes de ${archivo}`);
        fila = await correrFoto(archivo, indice);
        const recuperable =
          fila.error && /crash|Target|detached|worker|pipeline|tope|closed/i.test(fila.error);
        if (recuperable && intento < 2) {
          progreso(`reintento ${archivo} tras: ${fila.error}`);
          fila = null;
          await recuperarPagina(`fallo recuperable en ${archivo}`);
        }
      } catch (e) {
        const msg = String(e instanceof Error ? e.message : e).slice(0, 200);
        progreso(`foto ${archivo} intento ${intento} murió: ${msg}`);
        errores.push(`[foto ${archivo}] ${msg}`);
        fila = { archivo, error: msg, marcas: null };
        if (intento < 2) await recuperarPagina(msg).catch(() => undefined);
      }
    }
    filas.push(fila);
    progreso(resumenFoto(fila));
    volcar({ fase: "tras-foto" });

    if (indice < FOTOS.length - 1) {
      fila.cooldown = await esperarFrio(tempInicial).catch(() => ({ omitido: true }));
      if (!fila.cooldown.omitido) {
        progreso(
          `cooldown ok: ${fila.cooldown.temperaturaC ?? "?"}°C tras ${Math.round((fila.cooldown.esperaMs ?? 0) / 1000)}s` +
            (fila.cooldown.agotado ? " (TOPE agotado)" : ""),
        );
      }
      volcar({ fase: "tras-cooldown" });
    }
  }
} finally {
  await navegador.close().catch(() => undefined);
  volcar({
    fase: "final",
    tempFinalC: tempBateriaC(),
    meminfoInicial,
    meminfoFinal: SIN_SAMPLER ? null : dumpsysMeminfoChrome(),
    logcat: recogerLogcat(),
  });
}
progreso(`JSON: ${salida}`);
process.exit(filas.some((f) => f.error) ? 1 : 0);
