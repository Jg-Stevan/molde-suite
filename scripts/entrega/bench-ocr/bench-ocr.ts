/**
 * bench-ocr.mjs — conductor del arnés V3 · Agente 1 (CDP crudo, §8).
 *
 * Sin Playwright/Puppeteer/onnxruntime-node. Secuencia:
 *   1. Servidor estático local (COOP/COEP para WASM multihilo) que sirve
 *      /_bench (bundle), /fixtures (dataset real, gitignored) y /gt (GT).
 *   2. Chrome headless con --remote-debugging-port; conexión WebSocket cruda
 *      al endpoint del navegador (patrón de scripts/entrega/probar-cdp-worker.mjs).
 *   3. Target.createTarget + Target.attachToTarget (flatten) + Runtime.evaluate
 *      con awaitPromise — el arnés expone window.__ARNES (iniciar/estado/
 *      ejecutar/resultado) y el conductor lo va sondeando por lotes.
 *   4. Fase ANALISIS (local, bun): compara el JSON crudo contra el GT
 *      (scripts/resultados/bench-ocr/dataset/) y produce resumen-motores.json
 *      + impresión humana de tablas.
 *
 * Uso: bun bench-ocr.mjs [--solo-analisis <archivo.json>]
 */

import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join, resolve, extname } from "node:path";

const RAIZ = resolve(import.meta.dir, "../../..");
const BENCH_DIR = join(RAIZ, "public/_bench");
const FIXTURES_DIR = join(RAIZ, "scripts/resultados/fixtures-reales/3-DOCUMENTOS-IMPRESOS - copia");
const GT_DIR = join(RAIZ, "scripts/resultados/bench-ocr/dataset");
const OUT_DIR = join(RAIZ, "scripts/resultados/bench-ocr/motores");

const PUERTO_HTTP = 8931;
const PUERTO_CDP = 9223;
const CHROME_CANDIDATOS = [
  "/home/z/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome",
  "/home/z/.cache/puppeteer/chrome/linux-157.0.8103.78/chrome-linux64/chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
];

// ─────────────────────────────────────────────────────────────────────────────
// 1. Servidor estático con COOP/COEP (WASM multihilo)
// ─────────────────────────────────────────────────────────────────────────────

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

const CABECERAS_GLOBALS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cache-Control": "no-store",
};

function servir(): typeof Bun.serve extends never ? never : ReturnType<typeof Bun.serve> {
  return Bun.serve({
    port: PUERTO_HTTP,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      let ruta = decodeURIComponent(url.pathname);
      let base: string;
      if (ruta === "/" || ruta.startsWith("/_bench/")) {
        base = BENCH_DIR;
        ruta = ruta === "/" ? "/index.html" : ruta.slice("/_bench".length);
      } else if (ruta.startsWith("/fixtures/")) {
        base = FIXTURES_DIR;
        ruta = ruta.slice("/fixtures".length);
      } else if (ruta.startsWith("/gt/")) {
        base = GT_DIR;
        ruta = ruta.slice("/gt".length);
      } else {
        return new Response("no encontrado", { status: 404 });
      }
      const archivo = join(base, ruta);
      if (!archivo.startsWith(base) || !existsSync(archivo)) return new Response("404", { status: 404 });
      const cuerpo = await Bun.file(archivo).arrayBuffer();
      return new Response(cuerpo, {
        headers: { ...CABECERAS_GLOBALS, "Content-Type": MIME[extname(archivo)] ?? "application/octet-stream" },
      });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Cliente CDP crudo (WebSocket nativo, patrón probar-cdp-worker.mjs)
// ─────────────────────────────────────────────────────────────────────────────

class Cdp {
  private ws: WebSocket;
  private id = 0;
  private pendientes = new Map<number, { res: (v: unknown) => void; rej: (e: Error) => void }>();
  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id && this.pendientes.has(msg.id)) {
        const p = this.pendientes.get(msg.id)!;
        this.pendientes.delete(msg.id);
        if (msg.error) p.rej(new Error(msg.error.message ?? JSON.stringify(msg.error)));
        else p.res(msg.result);
      }
    });
  }
  static async conectar(url: string): Promise<Cdp> {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener("open", () => res(null), { once: true });
      ws.addEventListener("error", () => rej(new Error("WS CDP error")), { once: true });
    });
    return new Cdp(ws);
  }
  enviar(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const t = setTimeout(() => {
        this.pendientes.delete(id);
        rej(new Error(`CDP timeout: ${method}`));
      }, 120000);
      this.pendientes.set(id, {
        res: (v) => { clearTimeout(t); res(v); },
        rej: (e) => { clearTimeout(t); rej(e); },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluar(expresion) {
    const r = (await this.enviar(
      "Runtime.evaluate",
      { expression: expresion, awaitPromise: true, returnByValue: true },
    ));
    if (r.result?.subtype === "error") throw new Error(r.result.description ?? "eval error");
    return r.result?.value;
  }
}

function esperar(url: string, intentos = 120, pausaMs = 500): Promise<unknown> {
  return new Promise(async (res, rej) => {
    for (let i = 0; i < intentos; i++) {
      try {
        const r = await fetch(url);
        if (r.ok) return res(await r.json());
      } catch { /* reintenta */ }
      await new Promise((r2) => setTimeout(r2, pausaMs));
    }
    rej(new Error(`no responde ${url}`));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Main — corrida del arnés
// ─────────────────────────────────────────────────────────────────────────────

let chromeProc: ReturnType<typeof spawn> | null = null;
let servidor: ReturnType<typeof Bun.serve> | null = null;
let chromePath: string | null = null;

function cdpArgs(): string[] {
  const perfil = "/tmp/bench-ocr-chrome-profile";
  return [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--enable-precise-memory-info",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--renderer-process-limit=1",
    "--js-flags=--max-old-space-size=1536",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${perfil}`,
    `--remote-debugging-port=${PUERTO_CDP}`,
    "--window-size=1400,1000",
    `http://127.0.0.1:${PUERTO_HTTP}/`,
  ];
}

function arrancarChrome(): void {
  if (!chromePath) throw new Error("no hay Chrome instalado");
  try { rmSync("/tmp/bench-ocr-chrome-profile", { recursive: true, force: true }); } catch {}
  chromeProc = spawn(chromePath, cdpArgs(), { stdio: ["ignore", "pipe", "pipe"] });
  chromeProc.stderr.on("data", (d) => { try { appendFileSync("/tmp/chrome-stderr.log", String(d)); } catch {} });
}

async function conectarArnés(): Promise<{ pagina: Cdp; t0: number }> {
  // patrón page-WS probado (captura-a56-cdp.mjs): el navegador abre la URL del
  // arnés directamente y el conductor se conecta AL WS DE LA PÁGINA (sin
  // browser-level Target.* — patrón inestable en headless v143).
  let pag: { type: string; url: string; webSocketDebuggerUrl: string } | null = null;
  for (let i = 0; i < 120 && !pag; i++) {
    try {
      const arr = (await (await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/list`)).json()) as { type: string; url: string; webSocketDebuggerUrl: string }[];
      pag = arr.find((t) => t.type === "page" && t.url.includes(`:${PUERTO_HTTP}`)) ?? null;
    } catch { /* chrome aún arrancando */ }
    if (!pag) await new Promise((r) => setTimeout(r, 500));
  }
  if (!pag) throw new Error("no hay página del arnés en /json/list");
  const t0 = Date.now();
  const pagina = await Cdp.conectar(pag.webSocketDebuggerUrl);
  await pagina.enviar("Runtime.enable");
  return { pagina, t0 };
}

async function correr(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  servidor = servir();
  console.log(`HTTP 127.0.0.1:${PUERTO_HTTP} (/_bench + /fixtures + /gt, COOP/COEP)`);

  chromePath = CHROME_CANDIDATOS.find((p) => existsSync(p)) ?? null;
  if (!chromePath) throw new Error("no hay Chrome instalado");
  arrancarChrome();
  console.log(`Chrome: ${chromePath} (CDP :${PUERTO_CDP})`);

  const t0 = Date.now();
  const { pagina } = await conectarArnés();
  console.log("CDP conectado (WS de página, patrón captura-a56-cdp)");
  await pagina.enviar("Runtime.enable");
  await pagina.enviar("Page.enable");
  await pagina.enviar("Page.reload");
  console.log("Página del arnés recargada — esperando inicialización (motores + assets locales)…");

  // esperando listo (poll estado; init descarga modelos locales + workers)
  let listo = false;
  let errorInit = "";
  for (let i = 0; i < 240; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const st = (await pagina.evaluar("window.__ARNES ? window.__ARNES.estado() : null")) as { listo?: boolean; error?: string } | null;
      if (st?.error) { errorInit = st.error; break; }
      if (st?.listo) { listo = true; break; }
      if (i % 10 === 0) process.stdout.write(".");
    } catch { /* página aún cargando */ }
  }
  if (!listo) throw new Error(`el arnés no quedó listo: ${errorInit || "timeout 360 s"}`);
  console.log(`\nArnés listo en ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  const plan = (await pagina.evaluar("window.__ARNES.estado().total")) as number;
  console.log(`Plan: ${plan} corridas`);

  // reanudación: --reanudar <archivo-parcial.json> reinyecta resultados previos
  const idxReanudar = process.argv.includes("--reanudar") ? process.argv[process.argv.indexOf("--reanudar") + 1] : null;
  if (idxReanudar && existsSync(idxReanudar)) {
    const previo = JSON.parse(readFileSync(idxReanudar, "utf8")) as { resultados?: unknown[] };
    const n = (previo.resultados ?? []).length;
    await pagina.evaluar(`window.__ARNES.inyectar(${JSON.stringify(previo.resultados ?? [])})`);
    console.log(`Reanudado desde ${n} resultados previos`);
  }

  // ejecución por lotes + RECICLAJE COMPLETO DE CHROME (OOM-safe): la recarga
  // de página NO libera el proceso renderer (la memoria WASM persiste), así
  // que cada 12 corridas se mata Chrome, se arranca uno nuevo y se reinyectan
  // los resultados parciales. El plan es determinista: idx = nº resultados.
  const salida = join(OUT_DIR, "resultados-motores.json");
  const parcial = join(OUT_DIR, "resultados-motores-parcial.json");
  const t1 = Date.now();
  let paginaActiva = pagina;
  const reciclarChrome = async (): Promise<void> => {
    const snap = (await paginaActiva.evaluar("window.__ARNES.resultado()")) as object;
    writeFileSync(parcial, JSON.stringify(snap));
    const nPrevios = ((snap as { resultados?: unknown[] }).resultados ?? []).length;
    chromeProc?.kill();
    await new Promise((r) => setTimeout(r, 1200));
    arrancarChrome();
    let nuevaPag: { type: string; url: string; webSocketDebuggerUrl: string } | null = null;
    for (let i = 0; i < 120 && !nuevaPag; i++) {
      try {
        const arr = (await (await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/list`)).json()) as { type: string; url: string; webSocketDebuggerUrl: string }[];
        nuevaPag = arr.find((t) => t.type === "page" && t.url.includes(`:${PUERTO_HTTP}`)) ?? null;
      } catch { /* chrome arrancando */ }
      if (!nuevaPag) await new Promise((r) => setTimeout(r, 500));
    }
    if (!nuevaPag) throw new Error("chrome reciclado: sin página");
    paginaActiva = await Cdp.conectar(nuevaPag.webSocketDebuggerUrl);
    await paginaActiva.enviar("Runtime.enable");
    let reListo = false;
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const st = (await paginaActiva.evaluar("window.__ARNES ? window.__ARNES.estado() : null")) as { listo?: boolean; error?: string } | null;
        if (st?.listo) { reListo = true; break; }
      } catch { /* arrancando */ }
    }
    if (!reListo) throw new Error("chrome reciclado: arnés no listo");
    const previo = JSON.parse(readFileSync(parcial, "utf8")) as { resultados?: unknown[] };
    await paginaActiva.evaluar(`window.__ARNES.inyectar(${JSON.stringify(previo.resultados ?? [])})`);
    console.log(`  ↻ chrome reciclado con ${nPrevios} resultados preservados`);
  };
  let reintentos = 0;
  let ultimoHechos = -1;
  while (true) {
    let r: { hechos: number; total: number; listo: boolean; errores: number };
    try {
      r = (await paginaActiva.evaluar("window.__ARNES.ejecutar(3)")) as { hechos: number; total: number; listo: boolean; errores: number };
    } catch (e) {
      // chrome muerto/colgado a mitad de lote: reciclar y reintentar el lote
      // (los resultados hasta el último checkpoint viven en el parcial; el idx
      // del arnés reinyectado deshace las corridas a medio hacer)
      reintentos++;
      if (reintentos > 8) throw new Error(`chrome muere repetidamente en la corrida ~${ultimoHechos + 1} (8 reciclos sin avance)`);
      console.log(`  ⚠ error de CDP (${String((e as Error).message).slice(0, 60)}) — reciclando chrome (intento ${reintentos})…`);
      try { await reciclarChrome(); } catch (e2) {
        console.log(`  ⚠ reciclo falló (${String((e2 as Error).message).slice(0, 50)}) — reintento directo…`);
        chromeProc?.kill();
        await new Promise((r) => setTimeout(r, 1500));
        arrancarChrome();
        const c = await conectarArnés();
        paginaActiva = c.pagina;
        await paginaActiva.enviar("Page.reload");
        await new Promise((r) => setTimeout(r, 2500));
        const previo = JSON.parse(readFileSync(parcial, "utf8")) as { resultados?: unknown[] };
        for (let i = 0; i < 60; i++) {
          try { const st = (await paginaActiva.evaluar("window.__ARNES ? window.__ARNES.estado() : null")) as { listo?: boolean } | null; if (st?.listo) break; } catch {}
          await new Promise((r) => setTimeout(r, 1500));
        }
        await paginaActiva.evaluar(`window.__ARNES.inyectar(${JSON.stringify((previo.resultados ?? []))})`);
      }
      continue;
    }
    if (r.hechos !== ultimoHechos) { reintentos = 0; ultimoHechos = r.hechos; }
    const pct = Math.round((r.hechos / r.total) * 100);
    const min = ((Date.now() - t1) / 60000).toFixed(1);
    console.log(`  ${r.hechos}/${r.total} (${pct}%) — ${min} min — errores: ${r.errores}`);
    // checkpoint cada 6 corridas (nunca se pierden más de ~6 al morir)
    if (r.hechos > 0 && r.hechos % 6 === 0) {
      const snap = (await paginaActiva.evaluar("window.__ARNES.resultado()")) as object;
      writeFileSync(parcial, JSON.stringify(snap));
    }
    if (r.listo) break;
  }
  console.log(`Corridas terminadas en ${((Date.now() - t1) / 60000).toFixed(1)} min`);

  const resultado = (await paginaActiva.evaluar("window.__ARNES.resultado()")) as object;
  writeFileSync(salida, JSON.stringify(resultado, null, 1));
  console.log(`Crudo guardado: ${salida} (${Math.round(Bun.file(salida).size / 1048576)} MB)`);

  console.log("\n═══ FASE ANALISIS ═══");
  await analizar(salida);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Fase análisis (local) — GT, métricas, resumen
// ─────────────────────────────────────────────────────────────────────────────

function norm(s: string): string {
  return (s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
function lev(a: string, b: string): number {
  if (a === b) return 0;
  const prev = new Uint16Array(b.length + 1);
  const cur = new Uint16Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const c = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + c);
    }
    prev.set(cur);
  }
  return prev[b.length];
}
function contieneFuzzy(paja: string, aguja: string, tolerancia = 0.82): boolean {
  const nP = norm(paja);
  const nA = norm(aguja);
  if (nA.length < 3) return nP.includes(nA);
  if (nP.includes(nA)) return true;
  // fuzzy por ventana (etiqueta borrosa/recortada)
  const palabras = nA.split(" ");
  for (let m = Math.max(1, palabras.length - 1); m <= palabras.length + 1; m++) {
    for (let i = 0; i + m <= palabras.length; i++) {
      const v = palabras.slice(i, i + m).join(" ");
      const score = 1 - lev(v, nA) / Math.max(v.length, nA.length);
      if (score >= tolerancia && nP.includes(v)) return true;
    }
  }
  return false;
}
function limpiarEjemplo(v: string): string {
  // "X (ejemplo de la spec)" → "X"
  return v.replace(/\s*\(ejemplo[^)]*\)/gi, "").trim();
}
function coberturaTokens(gt: string, ocr: string): number {
  const tokens = norm(gt).split(" ").filter((t) => t.length >= 3);
  if (tokens.length === 0) return 0;
  const nO = norm(ocr);
  const hit = tokens.filter((t) => nO.includes(t)).length;
  return hit / tokens.length;
}

const DOC_DE_RUTA = (ruta: string) =>
  ruta.startsWith("01-") ? "recibo_pago" : ruta.startsWith("02-") ? "comprobante_entrega" : ruta.startsWith("03-") ? "e26_acta_parcial" : "acta_e14";

async function analizar(rutaResultados: string): Promise<void> {
  const crudo = JSON.parse(readFileSync(rutaResultados, "utf8")) as { meta: unknown; resultados: Run[] };
  const runs = crudo.resultados;
  const gtRecibo = JSON.parse(readFileSync(join(GT_DIR, "gt-recibo-pago.json"), "utf8"));
  const gtComp = JSON.parse(readFileSync(join(GT_DIR, "gt-comprobante-entrega.json"), "utf8"));
  const gtE14 = JSON.parse(readFileSync(join(GT_DIR, "gt-e14.json"), "utf8"));
  const gtE26 = JSON.parse(readFileSync(join(GT_DIR, "gt-e26.json"), "utf8"));
  const gtTinta = JSON.parse(readFileSync(join(GT_DIR, "gt-tinta.json"), "utf8"));
  const GTS: Record<string, Record<string, unknown>> = { recibo_pago: gtRecibo, comprobante_entrega: gtComp, e26_acta_parcial: gtE26, acta_e14: gtE14 };

  const anclasDe = (gt: Record<string, unknown>): string[] => {
    const id = (gt.identificacion ?? {}) as Record<string, unknown>;
    const lista = (id.anclas ?? id.anclas_pagina_1 ?? []) as string[];
    const p2 = (id.anclas_pagina_2 ?? []) as string[];
    return [...lista, ...p2];
  };

  const p50p95 = (nums: number[]): { p50: number; p95: number } => {
    const a = [...nums].sort((x, y) => x - y);
    return { p50: a.length ? Math.round(a[Math.floor(a.length * 0.5)]) : 0, p95: a.length ? Math.round(a[Math.min(a.length - 1, Math.floor(a.length * 0.95))]) : 0 };
  };

  // ── latencia por motor (base+reps, excluye frío) ──
  const lat: Record<string, { caliente: number[]; frio: number[]; heap: number[] }> = {};
  for (const r of runs) {
    if (!["base", "rep"].includes(r.tipo) || r.error || !r.ms) continue;
    const m = r.motor;
    lat[m] ??= { caliente: [], frio: [], heap: [] };
    if (r.frio) lat[m].frio.push(r.ms);
    else lat[m].caliente.push(r.ms);
    if (r.heapMB > 0) lat[m].heap.push(r.heapMB);
  }
  const latResumen: Record<string, unknown> = {};
  for (const [m, v] of Object.entries(lat)) {
    const c = p50p95(v.caliente);
    latResumen[m] = { p50_caliente_ms: c.p50, p95_caliente_ms: c.p95, frio_ms: v.frio[0] ?? null, heap_pico_MB: Math.max(0, ...v.heap), n_caliente: v.caliente.length };
  }

  // ── ancla-recall (S4 / barridos) ──
  const anclaRecall = (r: Run, gt: Record<string, unknown>): { hits: number; total: number } => {
    const anclas = anclasDe(gt);
    if (!anclas.length || !r.texto) return { hits: 0, total: anclas.length };
    const hits = anclas.filter((a) => contieneFuzzy(r.texto!, a)).length;
    return { hits, total: anclas.length };
  };

  // ── barrido calidad ──
  const calidad: Record<string, { ms: number[]; heap: number[]; recall: number[]; recallPorMotor: Record<string, number[]> }> = {};
  for (const r of runs) {
    if (r.tipo !== "calidad" || r.error) continue;
    const key = `w${r.calidad?.w}q${r.calidad?.q}`;
    calidad[key] ??= { ms: [], heap: [], recall: [], recallPorMotor: {} };
    const gt = GTS[DOC_DE_RUTA(r.imagen)];
    const { hits, total } = anclaRecall(r, gt);
    calidad[key].ms.push(r.ms);
    if (r.heapMB > 0) calidad[key].heap.push(r.heapMB);
    if (total > 0) {
      const frac = hits / total;
      calidad[key].recall.push(frac);
      calidad[key].recallPorMotor[r.motor] ??= [];
      calidad[key].recallPorMotor[r.motor].push(frac);
    }
  }
  const calidadResumen: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(calidad)) {
    const media = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
    calidadResumen[k] = { ms_media: Math.round(media(v.ms)), heap_pico_MB: Math.max(0, ...v.heap), ancla_recall: media(v.recall).toFixed(3), por_motor: Object.fromEntries(Object.entries(v.recallPorMotor).map(([m, a]) => [m, media(a).toFixed(3)])) };
  }

  // ── barrido filtros ──
  const filtrosResumen: Record<string, unknown> = {};
  const porFiltro: Record<string, { ms: number[]; recall: number[]; porMotor: Record<string, number[]> }> = {};
  for (const r of runs) {
    if (r.tipo !== "filtro" || r.error) continue;
    const f = r.filtro ?? "?";
    porFiltro[f] ??= { ms: [], recall: [], porMotor: {} };
    const gt = GTS[DOC_DE_RUTA(r.imagen)];
    const { hits, total } = anclaRecall(r, gt);
    porFiltro[f].ms.push(r.ms);
    if (total > 0) {
      const frac = hits / total;
      porFiltro[f].recall.push(frac);
      porFiltro[f].porMotor[r.motor] ??= [];
      porFiltro[f].porMotor[r.motor].push(frac);
    }
  }
  for (const [f, v] of Object.entries(porFiltro)) {
    const media = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
    filtrosResumen[f] = { ms_media: Math.round(media(v.ms)), ancla_recall: media(v.recall).toFixed(3), por_motor: Object.fromEntries(Object.entries(v.porMotor).map(([m, a]) => [m, media(a).toFixed(3)])) };
  }

  // ── M2 (sin molde) — extracción por regex sobre el texto de las corridas base ──
  const m2Resumen: Record<string, unknown> = {};
  const M2_ES = extraccionM2();
  for (const doc of ["recibo_pago", "comprobante_entrega", "e26_acta_parcial", "acta_e14"]) {
    const runsDoc = runs.filter((r) => r.tipo === "base" && !r.error && DOC_DE_RUTA(r.imagen) === doc);
    const porMotor: Record<string, unknown> = {};
    for (const motor of ["tess_fast", "rapidocr"]) {
      const runsMotor = runsDoc.filter((r) => r.motor === motor);
      let idOk = 0, idTotal = 0;
      const camposTotales: Record<string, { ok: number; total: number }> = {};
      for (const r of runsMotor) {
        const gt = GTS[doc];
        const anclas = anclasDe(gt);
        if (anclas.length) {
          idTotal++;
          const hits = anclas.filter((a) => contieneFuzzy(r.texto!, a)).length;
          if (hits >= 2) idOk++;
        }
        const extraidos = M2_ES[doc](r.texto ?? "");
        const gtCampos = (gt.campos ?? []) as { id: string; valor_esperado?: string; patron?: string }[];
        for (const c of gtCampos) {
          const esperado = c.valor_esperado ? limpiarEjemplo(c.valor_esperado) : null;
          const valor = extraidos[c.id];
          const b = (camposTotales[c.id] ??= { ok: 0, total: 0 });
          b.total++;
          if (!valor) continue;
          if (esperado) {
            const nE = norm(esperado);
            const nV = norm(valor);
            if (nE.length > 40 ? coberturaTokens(esperado, valor) >= 0.6 : (nV.includes(nE) || nE.includes(nV) || (nV.length > 3 && 1 - lev(nV, nE) / Math.max(nV.length, nE.length) >= 0.75))) b.ok++;
          } else if (c.patron) {
            if (new RegExp(c.patron).test(valor)) b.ok++;
          } else b.ok++;
        }
      }
      porMotor[motor] = {
        identificacion: idTotal ? `${idOk}/${idTotal}` : "n/a",
        campos: Object.fromEntries(Object.entries(camposTotales).map(([k, v]) => [k, v.total ? `${v.ok}/${v.total}` : "0/0"])),
      };
    }
    m2Resumen[doc] = porMotor;
  }

  // ── M1/M3 — resolución por campo, patrón, falsos rechazos, fuente de ancla ──
  const pruebaM: Record<string, unknown> = {};
  for (const estrategia of ["m1", "m3"]) {
    const runsM = runs.filter((r) => r.tipo === estrategia && !r.error);
    const detalle: Record<string, unknown> = {};
    for (const r of runsM) {
      const key = `${r.molde} · ${r.motor} · ${r.imagen.split("/").pop()}`;
      const campos = (r.campos ?? []) as { id: string; estado?: string; obligatorio?: boolean; patron_ok?: boolean | null; fuente_ancla?: string; tipo?: string; valor?: string; con_tinta?: boolean }[];
      const texto = campos.filter((c) => c.tipo !== "tinta");
      const firma = campos.filter((c) => c.tipo === "tinta");
      const okTexto = texto.filter((c) => c.estado === "ok").length;
      const patronOk = texto.filter((c) => c.patron_ok === true).length;
      const conPatron = texto.filter((c) => c.patron_ok === true || c.patron_ok === false).length;
      const oblig = texto.filter((c) => c.obligatorio);
      const falsosRechazos = oblig.filter((c) => c.estado === "no_encontrado").length;
      const hits = texto.filter((c) => (c.fuente_ancla ?? "").includes("hit")).length;
      detalle[key] = {
        campos_texto: texto.length, ok: okTexto, patron_ok: `${patronOk}/${conPatron}`,
        obligatorios: oblig.length, falsos_rechazos: falsosRechazos,
        ancla_hit: hits, ancla_referencia: texto.filter((c) => (c.fuente_ancla ?? "").includes("referencia")).length,
        firmas: firma.length, firmas_con_tinta: firma.filter((c) => c.con_tinta === true).length,
        ms: r.ms,
      };
    }
    pruebaM[estrategia] = detalle;
  }

  // ── S6 tinta vs GT ──
  const tintaEval = evaluarTinta(runs, gtTinta);

  // ── ZXing ──
  const zxing = runs.filter((r) => r.tipo === "zxing").map((r) => ({ imagen: r.imagen.split("/").pop(), resultado: r.zxing ?? null, ms: r.ms }));

  // ── mantenimiento (molde genérico vs _a_real) ──
  const mantenimiento = calcularMantenimiento();

  const resumen = {
    meta: { ...(crudo.meta as object), fecha_analisis: new Date().toISOString() },
    latencia: latResumen,
    calidad: calidadResumen,
    filtros: filtrosResumen,
    m2_sin_molde: m2Resumen,
    prueba_m: pruebaM,
    tinta: tintaEval,
    zxing,
    mantenimiento,
  };
  const salida = join(OUT_DIR, "resumen-motores.json");
  writeFileSync(salida, JSON.stringify(resumen, null, 1));
  console.log(`Resumen guardado: ${salida}`);

  // ── impresión humana ──
  console.log("\n── LATENCIA (caliente, base+reps) ──");
  for (const [m, v] of Object.entries(latResumen)) console.log(`  ${m}: ${JSON.stringify(v)}`);
  console.log("\n── ANCLA-RECALL por calidad (media 6 imgs) ──");
  for (const [k, v] of Object.entries(calidadResumen)) console.log(`  ${k}: ${JSON.stringify(v)}`);
  console.log("\n── FILTROS ──");
  for (const [k, v] of Object.entries(filtrosResumen)) console.log(`  ${k}: ${JSON.stringify(v)}`);
  console.log("\n── PRUEBA M (agregado por molde·motor) ──");
  const aggM = agregarPruebaM(pruebaM);
  for (const [k, v] of Object.entries(aggM)) console.log(`  ${k}: ${JSON.stringify(v)}`);
  console.log("\n── S6 TINTA ──");
  console.log(`  ${JSON.stringify(tintaEval)}`);
  console.log("\n── ZXING ──");
  for (const z of zxing) console.log(`  ${z.imagen}: ${z.resultado ? (z.resultado as { formato: string; texto: string }).formato + " " + (z.resultado as { texto: string }).texto.slice(0, 60) : "sin lectura"} (${z.ms} ms)`);
  console.log("\n── MANTENIMIENTO ──");
  console.log(`  ${JSON.stringify(mantenimiento, null, 2)}`);
}

interface Run {
  id: string; tipo: string; motor: string; imagen: string; molde?: string; filtro?: string; calidad?: { w?: number; q?: number };
  ms: number; heapMB: number; frio?: boolean; texto?: string; conf?: number; palabras?: number;
  det?: { nBoxes: number; msDet: number; msCls: number; msRec: number };
  campos?: { id: string; estado?: string; obligatorio?: boolean; patron_ok?: boolean | null; fuente_ancla?: string; tipo?: string; valor?: string; con_tinta?: boolean; ratio?: number }[];
  tinta?: { id: string; fuente?: string; ratio?: number; con_tinta?: boolean; umbral?: number }[];
  zxing?: { formato: string; texto: string } | null;
  error?: string;
}

function agregarPruebaM(pruebaM: Record<string, Record<string, unknown>>): Record<string, unknown> {
  const agg: Record<string, { corridas: number; ok: number; campos: number; patronOk: number; conPatron: number; falsosRechazos: number; obligatorios: number; anclaHit: number; firmas: number; firmasTinta: number; ms: number[] }> = {};
  for (const [estrategia, detalle] of Object.entries(pruebaM)) {
    for (const [key, v] of Object.entries(detalle)) {
      const moldeMotor = `${key.split(" · ")[0]} · ${key.split(" · ")[1]}`;
      const a = (agg[`${estrategia}: ${moldeMotor}`] ??= { corridas: 0, ok: 0, campos: 0, patronOk: 0, conPatron: 0, falsosRechazos: 0, obligatorios: 0, anclaHit: 0, firmas: 0, firmasTinta: 0, ms: [] });
      const d = v as { campos_texto?: number; ok?: number; patron_ok?: string; obligatorios?: number; falsos_rechazos?: number; ancla_hit?: number; firmas?: number; firmas_con_tinta?: number; ms?: number };
      a.corridas++;
      a.campos += d.campos_texto ?? 0;
      a.ok += d.ok ?? 0;
      const [po, cp] = (d.patron_ok ?? "0/0").split("/").map(Number);
      a.patronOk += po; a.conPatron += cp;
      a.falsosRechazos += d.falsos_rechazos ?? 0;
      a.obligatorios += d.obligatorios ?? 0;
      a.anclaHit += d.ancla_hit ?? 0;
      a.firmas += d.firmas ?? 0;
      a.firmasTinta += d.firmas_con_tinta ?? 0;
      if (d.ms) a.ms.push(d.ms);
    }
  }
  return Object.fromEntries(Object.entries(agg).map(([k, v]) => [k, {
    corridas: v.corridas,
    resolucion_campos: v.campos ? `${v.ok}/${v.campos} (${Math.round((v.ok / v.campos) * 100)}%)` : "n/a",
    patron_ok: v.conPatron ? `${v.patronOk}/${v.conPatron} (${Math.round((v.patronOk / v.conPatron) * 100)}%)` : "n/a",
    falsos_rechazos_obligatorios: `${v.falsosRechazos}/${v.obligatorios}`,
    ancla_hit_pct: v.campos ? Math.round((v.anclaHit / v.campos) * 100) + "%" : "n/a",
    firmas_con_tinta: `${v.firmasTinta}/${v.firmas}`,
    ms_medio: v.ms.length ? Math.round(v.ms.reduce((s, x) => s + x, 0) / v.ms.length) : null,
  }]));
}

function evaluarTinta(runs: Run[], gtTinta: Record<string, unknown>): Record<string, unknown> {
  // GT aplanado recursivo: {docTipo: {img: {zonaId: bool}}} — baja a dicts
  // anidados (manuscritos, firmas_jurados, cc_jurados, firmas[])
  const gtPlano: Record<string, Record<string, Record<string, boolean>>> = {};
  for (const [doc, imgs] of Object.entries(gtTinta)) {
    if (doc === "nota" || typeof imgs !== "object") continue;
    gtPlano[doc] = {};
    const recorrer = (obj: Record<string, unknown>, rutaImg: string | null) => {
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v !== "object" || v === null) continue;
        const esImagen = /\.(png|jpg|jpeg)$/i.test(k);
        if (esImagen) {
          const zonas: Record<string, boolean> = {};
          const recoger = (nodo: Record<string, unknown>, prefijo: string) => {
            for (const [zk, zv] of Object.entries(nodo)) {
              if (typeof zv === "boolean") zonas[prefijo + zk] = zv;
              else if (Array.isArray(zv)) {
                (zv as unknown[]).forEach((b, i) => { if (typeof b === "boolean") zonas[`${prefijo}${zk}_${i + 1}`] = b; });
              } else if (typeof zv === "object" && zv !== null && zk !== "ratios" && zk !== "motivo" && zk !== "pagina" && zk !== "copia_esperada") {
                recoger(zv as Record<string, unknown>, `${prefijo}${zk}_`);
              }
            }
          };
          recoger(v as Record<string, unknown>, "");
          gtPlano[doc][k] = zonas;
        } else {
          recorrer(v as Record<string, unknown>, rutaImg);
        }
      }
    };
    recorrer(imgs as Record<string, unknown>, null);
  }

  let verdaderos = 0, falsos = 0, incorrectos = 0, total = 0;
  const porDoc: Record<string, { v: number; f: number; i: number; total: number }> = {};
  const detallesError: string[] = [];
  for (const r of runs.filter((x) => x.tipo === "tinta" && !x.error)) {
    const doc = DOC_DE_RUTA(r.imagen);
    const docGt = doc === "e26_acta_parcial" ? "e26" : doc === "acta_e14" ? "e14" : doc;
    const img = r.imagen.split("/").pop()!;
    const zonasGt = gtPlano[docGt]?.[img];
    if (!zonasGt) continue;
    const zonasRun = r.tinta ?? [];
    // emparejador zona↔GT: exacto → tokens plural-insensible (firma_jurado_1 ≡ firmas_jurados_1) → posicional (firmas_N)
    const tokensDe = (s: string): string[] => norm(s).split(/[\s_]+/).filter(Boolean).map((t) => (t.length > 1 ? t.replace(/s$/, "") : t));
    const mismaZona = (idRun: string, kGt: string): boolean => {
      if (kGt === idRun) return true;
      const a = tokensDe(idRun);
      const b = tokensDe(kGt);
      return a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");
    };
    for (let zi = 0; zi < zonasRun.length; zi++) {
      const z = zonasRun[zi];
      const esperado = zonasGt[z.id]
        ?? Object.entries(zonasGt).find(([k]) => mismaZona(z.id, k))?.[1]
        ?? zonasGt[`firmas_${zi + 1}`];
      if (esperado === undefined) continue;
      total++;
      const p = (porDoc[doc] ??= { v: 0, f: 0, i: 0, total: 0 });
      if (z.con_tinta === esperado) {
        verdaderos += esperado ? 0 : 0; // contadores por tipo abajo
        if (esperado) verdaderos++; else falsos++;
        p[esperado ? "v" : "f"]++;
      } else {
        incorrectos++;
        p.i++;
        detallesError.push(`${doc}/${img}/${z.id}: esperado ${esperado}, medido ${z.con_tinta} (ratio ${z.ratio})`);
      }
      p.total++;
    }
  }
  return { acierto: total ? `${verdaderos + falsos}/${total} (${Math.round(((verdaderos + falsos) / total) * 100)}%)` : "n/a", con_tinta_detectados: verdaderos, vacios_detectados: falsos, incorrectos, meta_95: total ? (verdaderos + falsos) / total >= 0.95 : false, por_documento: porDoc, desacuerdos: detallesError.slice(0, 12) };
}

// M2 — extractores por documento (regex por especificación)
function extraccionM2(): Record<string, (texto: string) => Record<string, string>> {
  const fechas = (t: string): string[] => {
    const out: string[] = [];
    const re = /(\d{1,2})\s*de\s*([A-Za-zÁÉÍÓÚáéíóúñÑ]+)\s*de\s*(\d{4})/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t))) out.push(`${m[1]} de ${m[2]} de ${m[3]}`);
    return out;
  };
  const fechaCorta = (t: string): string[] => {
    const out: string[] = [];
    const re = /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t))) out.push(`${m[1]}/${m[2]}/${m[3]}`);
    return out;
  };
  const despuesDe = (t: string, etiqueta: string, nLineas = 1): string => {
    const lineas = t.split(/\n+/);
    const idx = lineas.findIndex((l) => norm(l).includes(norm(etiqueta)));
    if (idx < 0) return "";
    return lineas.slice(idx + 1, idx + 1 + nLineas).join(" ").replace(new RegExp(norm(etiqueta).split(" ").join("\\s*"), "i"), "").trim();
  };

  return {
    recibo_pago: (t: string) => {
      const fs = fechas(t);
      const importe = t.match(/(\d{1,3}(?:\.\d{3})*,\d{2})\s*(?:€|EUR|euros)/i)?.[1] ?? t.match(/EUR\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i)?.[1] ?? "";
      const reciboNum = t.match(/REC[-\s]?\d{4}[-\s]?\d{3,4}/i)?.[0] ?? "";
      const iban = t.match(/ES\d{2}(?:[\s]?\d{4}){4,5}/)?.[0]?.replace(/\s+/g, " ") ?? "";
      const telefono = t.match(/(?:\+34\s?)?[89 6]\d{2}[\s.\-]?\d{3}[\s.\-]?\d{3}/)?.[0] ?? "";
      const dnix = [...t.matchAll(/\b(\d{2}\.?\d{3}\.?\d{3}|\d{8})\s*[- ]?\s*([A-Z])\b/g)].map((m) => `${m[1]}${m[2]}`);
      const cifx = [...t.matchAll(/\b([A-Z])[-\s]?(\d{8})\b/g)].map((m) => `${m[1]}-${m[2]}`);
      return {
        titulo: /recibo de pago/i.test(t) ? "RECIBO DE PAGO" : "",
        fecha_emision: fs[0] ?? "",
        fecha_pago: fs[1] ?? fechaCorta(t)[0] ?? "",
        numero_recibo: reciboNum,
        importe: importe,
        importe_texto: despuesDe(t, "La suma de", 1),
        concepto: despuesDe(t, "En concepto de", 1),
        forma_pago: despuesDe(t, "Forma de pago", 1),
        datos_emisor: despuesDe(t, "Recibí de", 0) || (dnix[0] ? `DNI ${dnix[0]}` : ""),
        datos_pagador: dnix[1] ? `DNI ${dnix[1]}` : "",
        iban_respaldo: iban,
        telefono: telefono,
        cif_detectados: cifx.join(", "),
      };
    },
    comprobante_entrega: (t: string) => {
      const fs = fechas(t);
      const telefono = t.match(/(?:\+34\s?)?[67]\d{2}[\s.\-]?\d{3}[\s.\-]?\d{3}/)?.[0] ?? "";
      const op = t.match(/(?:IP|OP)[- ]?\d{4}[- ]?\d{3,6}/i)?.[0] ?? "";
      const dni = t.match(/\b(\d{2}\.?\d{3}\.?\d{3}|\d{8})\s*[- ]?\s*([A-Z])\b/)?.[0] ?? "";
      const calle = t.match(/CALLE[:\s]+([^\n]+)/i)?.[0] ?? "";
      const nro = t.match(/NRO[:.\s]+([^\n]+)/i)?.[0] ?? "";
      return {
        titulo: /comprobante de entrega/i.test(t) ? "COMPROBANTE DE ENTREGA" : "",
        nombre_comprador: despuesDe(t, "Recibí de", 1),
        documento_comprador: dni,
        telefono,
        direccion: `${calle} ${nro}`.trim(),
        articulo: despuesDe(t, "Artículo", 1),
        numero_operacion: op,
        descripcion: despuesDe(t, "Descripción", 1),
        fecha_entrega: fs[0] ?? "",
      };
    },
    acta_e14: (t: string) => {
      const divipol = t.match(/\b(\d{1,2}-\d{2}-\d{2}-\d{2,3})\b/)?.[1] ?? "";
      const xx = t.match(/(?:XX|CODIGO XX)[^\d]{0,10}(\d{2,4})/i)?.[1] ?? "";
      const kit = t.match(/KIT[^\d]{0,10}(\d{3,6})/i)?.[1] ?? "";
      const civ = t.match(/(?:C\.?V\.?|CIV)[^\d]{0,10}(\d{3,6})/i)?.[1] ?? "";
      const suma = despuesDe(t, "SUMA TOTAL", 0).match(/\d{2,5}/)?.[0] ?? "";
      const copia = /TRANSMISION/i.test(t) ? "TRANSMISIÓN" : /CONSUL/i.test(t) ? "CÓNSUL/EMBAJADOR" : "";
      return {
        copia_destino: copia,
        divipol_consulado: divipol,
        codigo_xx: xx,
        kit,
        civ,
        suma_total: suma,
        codigo_barras_1d: "",
        codigo_qr: "",
      };
    },
    e26_acta_parcial: (t: string) => {
      const n = (etiqueta: string) => despuesDe(t, etiqueta, 0).match(/\d{1,6}/)?.[0] ?? "";
      return {
        departamento: despuesDe(t, "DEPARTAMENTO", 0),
        municipio: despuesDe(t, "MUNICIPIO", 0),
        umbral: n("UMBRAL"),
        cifra: n("CIFRA REPARTIDORA"),
        total_validos: n("VÁLIDOS"),
        pagina: /PÁGINA\s*(\d)/i.exec(t)?.[1] ?? "",
      };
    },
  };
}

function calcularMantenimiento(): Record<string, unknown> {
  const pares = [
    ["recibo genérico", join(RAIZ, "scripts/resultados/fixtures-reales/3-DOCUMENTOS-IMPRESOS - copia/01-RECIBO-DE-PAGO/molde/recibo_pago.molde.json")],
    ["recibo a_real", join(RAIZ, "scripts/resultados/fixtures-reales/3-DOCUMENTOS-IMPRESOS - copia/01-RECIBO-DE-PAGO/molde/recibo_a_real.molde.json")],
    ["comprobante genérico", join(RAIZ, "scripts/resultados/fixtures-reales/3-DOCUMENTOS-IMPRESOS - copia/02-RECIBO-DE-ENTREGA/molde/comprobante_entrega.molde.json")],
    ["comprobante a_real", join(RAIZ, "scripts/resultados/fixtures-reales/3-DOCUMENTOS-IMPRESOS - copia/02-RECIBO-DE-ENTREGA/molde/comprobante_a_real.molde.json")],
  ];
  const out: Record<string, unknown> = {};
  for (const [nombre, ruta] of pares) {
    if (!existsSync(ruta)) { out[nombre] = "no encontrado"; continue; }
    const molde = JSON.parse(readFileSync(ruta, "utf8")) as { campos: { id: string; ancla?: unknown; ancla_respaldo?: unknown; anclas?: unknown; zona?: unknown; estrategia?: string; umbral?: number; patron?: string; whitelist?: string; realce?: boolean }[] };
    out[nombre] = {
      version: (molde as unknown as { version?: string }).version,
      campos: molde.campos.length,
      anclas_declaradas: molde.campos.filter((c) => c.ancla).length,
      respaldos: molde.campos.filter((c) => c.ancla_respaldo).length,
      anclas_voto: molde.campos.filter((c) => c.anclas).length,
      zonas: molde.campos.filter((c) => c.zona).length,
      umbrales_calibrados: molde.campos.filter((c) => c.umbral != null).length,
      patrones: molde.campos.filter((c) => c.patron).length,
      whitelists: molde.campos.filter((c) => c.whitelist).length,
      campos_con_realce: molde.campos.filter((c) => c.realce).length,
    };
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Entrada
// ─────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args[0] === "--solo-analisis") {
  await analizar(args[1] ?? join(OUT_DIR, "resultados-motores.json"));
  process.exit(0);
} else {
  try {
    await correr();
  } catch (e) {
    console.error("FATAL:", (e as Error).message);
    process.exitCode = 1;
  } finally {
    chromeProc?.kill();
    servidor?.stop(true);
  }
}
