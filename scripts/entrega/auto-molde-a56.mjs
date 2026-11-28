#!/usr/bin/env node
/**
 * AUTO-DE-MOLDE en el Galaxy A56 (2026-11-27) — banco E2E del plan
 * «identificación automática de molde»: verifica en el teléfono real que
 *
 *   1. el catálogo empaquetado se SIEMBRA solo (8 plantillas en IndexedDB,
 *      marcado en localStorage «tamiz.catalogoMoldes.v1»),
 *   2. el AUTO elige la plantilla SIN molde activo (el activo solo desempata),
 *   3. el banner nombra el DOCUMENTO IDENTIFICADO (nunca «— · DOC»),
 *   4. «Verificación Documental» lista los CAMPOS DEL MOLDE con su semáforo
 *      — incluso cuando el documento sale RECHAZADO por faltantes,
 *   5. «CLASIFICACIÓN PENDIENTE» / «INTENTO x DE y» desaparecieron de esa
 *      tarjeta, y
 *   6. el acta E-14 reconocida sigue mandando el gate electoral (no regresión).
 *
 * CDP PURO: Node 24 trae WebSocket global, así que el banco NO añade
 * dependencias (playwright no está en la máquina y la regla del dueño es no
 * introducirlas sin confirmación explícita). Requisitos del entorno:
 *   adb forward tcp:9223 localabstract:chrome_devtools_remote
 *   adb reverse tcp:3100 tcp:3100   +   el dev server de producción en :3100
 *
 * Uso: node scripts/entrega/auto-molde-a56.mjs [recibo|comprobante|acta]
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, "..", "..");
const OUT = join(RAIZ, "scripts", "resultados", "auto-molde-a56");
const CDP = process.env.TAMIZ_CDP ?? "http://127.0.0.1:9223";
const APP = "http://localhost:3100/";
const ADB = process.env.TAMIZ_ADB ?? "C:\\platform-tools\\adb.exe";
const VEREDICTOS = /ÓPTIMA|ADVERTENCIA|RECHAZADA|REVISIÓN HUMANA/;
/** Palabras que ya NO deben aparecer en la tarjeta de revisión. */
const PROHIBIDAS = ["CLASIFICACIÓN PENDIENTE", "INTENTO 1 DE", "INTENTO 2 DE", "— · DOC", "DOC — —"];
/** Claves de estado que el banco parte de cero. */
const CLAVES = [
  "tamiz.moldeActivo.v1",
  "tamiz.demoMolde.v1",
  "tamiz.catalogoMoldes.v1",
  "tamiz.flags.v1",
  "tamiz.dev",
];

mkdirSync(OUT, { recursive: true });
const ARCHIVO_LOG = join(OUT, "log.txt");
function progreso(linea) {
  console.log(linea);
  try {
    appendFileSync(ARCHIVO_LOG, `${new Date().toISOString()} ${linea}\n`);
  } catch {
    /* evidencia best-effort */
  }
}

function adb(...args) {
  try {
    return execFileSync(ADB, args, { encoding: "utf-8", maxBuffer: 30 * 1024 * 1024 });
  } catch {
    return null;
  }
}

/** Despierta y desbloquea el teléfono (medido: con la pantalla apagada el
 *  endpoint CDP existe pero no responde) y trae Chrome al frente. */
function despertar() {
  adb("shell", "input", "keyevent", "KEYCODE_WAKEUP");
  adb("shell", "input", "swipe", "500", "1800", "500", "700");
  adb("shell", "svc", "power", "stayon", "usb");
  adb("shell", "am", "start", "-n", "com.android.chrome/com.google.android.apps.chrome.Main");
}

// ── cliente CDP mínimo ──────────────────────────────────────────────────────
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.n = 0;
    this.pend = new Map();
    this.oyentes = new Map();
    ws.onmessage = (ev) => {
      const m = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString());
      if (m.id && this.pend.has(m.id)) {
        const { res, rej } = this.pend.get(m.id);
        this.pend.delete(m.id);
        if (m.error) rej(new Error(`${m.error.message} ${JSON.stringify(m.error.data ?? "")}`));
        else res(m.result);
      } else if (m.method) {
        for (const cb of this.oyentes.get(m.method) ?? []) cb(m.params);
      }
    };
  }
  static async abrir(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = () => rej(new Error("websocket CDP falló"));
      setTimeout(() => rej(new Error("websocket CDP: timeout de apertura")), 20000);
    });
    return new Cdp(ws);
  }
  on(método, cb) {
    if (!this.oyentes.has(método)) this.oyentes.set(método, []);
    this.oyentes.get(método).push(cb);
  }
  send(method, params = {}) {
    const id = ++this.n;
    return new Promise((res, rej) => {
      this.pend.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  /** Evalúa una función JS (como texto) en la página y devuelve su valor. */
  async js(fn, ...args) {
    const expression = `(${String(fn)})(${args.map((a) => JSON.stringify(a)).join(",")})`;
    const r = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails.exception?.description ?? r.exceptionDetails.text;
      throw new Error(`in-page: ${String(d).split("\n")[0]}`);
    }
    return r.result?.value;
  }
  async esperando(fn, ms, intervalo = 3000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const v = await this.js(fn).catch(() => null);
      if (v) return v;
      await new Promise((r) => setTimeout(r, intervalo));
    }
    return null;
  }
}

async function elegirPagina() {
  despertar();
  await new Promise((r) => setTimeout(r, 3000));
  const lista = await (await fetch(`${CDP}/json`)).json().catch(() => []);
  let pagina = lista.find((t) => t.type === "page" && t.url.includes("localhost:3100"));
  if (!pagina) {
    const creada = await (
      await fetch(`${CDP}/json/new?${new URLSearchParams({ url: APP })}`, { method: "PUT" })
    )
      .json()
      .catch(() => null);
    pagina = creada;
    await new Promise((r) => setTimeout(r, 8000));
  }
  if (!pagina?.webSocketDebuggerUrl) throw new Error("sin pestaña de Tamiz accesible por CDP");
  progreso(`pestaña: ${pagina.url}`);
  return Cdp.abrir(pagina.webSocketDebuggerUrl);
}

// ── pasos del banco ─────────────────────────────────────────────────────────
const limpiar = async (cdp) =>
  cdp.js(async (claves) => {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    for (const k of await caches.keys()) await caches.delete(k);
    for (const k of claves) localStorage.removeItem(k);
    const dbs = (await indexedDB.databases?.()) ?? [];
    await Promise.all(
      dbs.map(
        (d) =>
          new Promise((res) => {
            const q = indexedDB.deleteDatabase(d.name);
            q.onsuccess = q.onerror = q.onblocked = () => res();
          }),
      ),
    );
    return dbs.map((d) => d.name);
  }, CLAVES);

const leerBiblioteca = (cdp) =>
  cdp.js(async () => {
    // NO se abre la base a ciegas: open(name, 1) sobre una base borrada la
    // CREA vacía y sin store, y then la app (que crea `moldes` en
    // onupgradeneeded) no vuelve a recibir el upgrade → la siembra fallaría
    // por culpa del banco. Se sondea la existencia con databases().
    const existe = ((await indexedDB.databases?.()) ?? []).some((d) => d.name === "tamiz-moldes-v1");
    if (!existe) return [];
    const db = await new Promise((res, rej) => {
      const q = indexedDB.open("tamiz-moldes-v1");
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
    if (!db.objectStoreNames.contains("moldes")) {
      db.close();
      return [];
    }
    const filas = await new Promise((res, rej) => {
      const t = db.transaction("moldes", "readonly");
      const q = t.objectStore("moldes").getAll();
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
    db.close();
    return filas.map((f) => `${f.nombre} v${f.version}`);
  });

const importar = (cdp, archivo) =>
  cdp.js(async (nombre) => {
    const resp = await fetch(`/dev-fixtures/${nombre}`);
    if (!resp.ok) return `fetch HTTP ${resp.status}`;
    const blob = await resp.blob();
    const file = new File([blob], nombre, { type: blob.type || "image/jpeg" });
    const dt = new DataTransfer();
    dt.items.add(file);
    const i = document.querySelector("input[type=file]:not([capture])");
    if (!i) return "sin input de importación";
    i.files = dt.files;
    i.dispatchEvent(new Event("change", { bubbles: true }));
    return null;
  }, archivo);

/** Toque REAL en el centro del selector (Input.dispatchTouchEvent). */
async function tocar(cdp, selector, etiqueta) {
  const caja = await cdp.js((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, selector);
  if (!caja) return false;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: caja.x, y: caja.y, id: 1, radiusX: 6, radiusY: 6, force: 1 }],
  });
  await new Promise((r) => setTimeout(r, 90));
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  progreso(`tap ${etiqueta} (${Math.round(caja.x)},${Math.round(caja.y)})`);
  return true;
}

const leerTarjeta = (cdp) =>
  cdp.js((prohibidas) => {
    const limpio = (t) => (t ?? "").replace(/\s+/g, " ").trim();
    const banner = document.querySelector(
      '[data-testid="banner-revision"], [data-testid="barra-rechazo"]',
    );
    const verif = document.querySelector('[data-testid="verificacion-documental"]');
    const cuerpo = document.body.innerText;
    return {
      veredicto: limpio(banner?.innerText) || null,
      banner: limpio(banner?.innerText).slice(0, 160) || null,
      tieneVerif: Boolean(verif),
      counter: limpio(document.querySelector('[data-testid="checklist-counter"]')?.innerText) || null,
      filas: Array.from(document.querySelectorAll('[data-testid="checklist-item"]'))
        .map((e) => limpio(e.innerText))
        .filter(Boolean),
      detalleVisible: Boolean(document.querySelector('[data-testid="verificacion-detalle"]')),
      pistas: Array.from(document.querySelectorAll('[data-testid="molde-pista"]'))
        .map((e) => limpio(e.innerText))
        .slice(0, 4),
      // Dueño 2026-11-27: CERO edición manual (sin ✎ ni editor inline) y el visor
      // de lo leído accesible en rechazadas SIN modo dev.
      editores:
        document.querySelectorAll('[data-testid^="editar-campo"], [data-testid="editor-campo"]').length,
      chipConversion: Boolean(document.querySelector('[data-testid="conversion-dev"]')),
      presentes: prohibidas.filter((p) => cuerpo.includes(p)),
      texto: limpio(cuerpo).slice(0, 700),
    };
  }, PROHIBIDAS);

async function capturar(cdp, nombre) {
  const r = await cdp.send("Page.captureScreenshot", { format: "png" }).catch(() => null);
  if (r?.data) {
    writeFileSync(join(OUT, `${nombre}-cdp.png`), Buffer.from(r.data, "base64"));
    progreso(`captura CDP: ${nombre}-cdp.png`);
  }
  try {
    const png = execFileSync(ADB, ["exec-out", "screencap", "-p"], {
      maxBuffer: 30 * 1024 * 1024,
      encoding: "buffer",
    });
    writeFileSync(join(OUT, `${nombre}-tel.png`), png);
    progreso(`captura teléfono: ${nombre}-tel.png`);
  } catch {
    /* sin adb no hay captura del sistema */
  }
}

/** El toast «Nueva versión disponible» de PwaRegister salta en CUANTO se limpia
 *  el SW (Chromium dispara `updatefound` también en la primera instalación). No
 *  es inocuo: la pestaña sigue corriendo el shell anterior mientras el SW nuevo
 *  espera, y así se miden pantallas viejas. Se RECARGA y se re-espera el input. */
async function descartarActualizar(cdp) {
  for (let intento = 0; intento < 2; intento++) {
    const recargo = await cdp.js(() => {
      const b = Array.from(document.querySelectorAll("button")).find((x) =>
        /RECARGAR AHORA/i.test(x.innerText),
      );
      if (!b) return false;
      b.click();
      return true;
    });
    if (!recargo) return false;
    progreso("toast de actualización: RECARGAR AHORA pulsado, esperando la app…");
    const listo = await cdp
      .esperando(
        () => Boolean(document.querySelector("input[type=file]:not([capture])")),
        120000,
        4000,
      )
      .catch(() => false);
    if (!listo) throw new Error("la app no volvió tras RECARGAR AHORA");
  }
  return false;
}

/** Dueño 2026-11-27: en una captura RECHAZADA el chip «VER LO LEÍDO» tiene que
 *  ABRIR de verdad el visor (pestaña blob: con el HTML renderizado + .md +
 *  .json). Se comprueba desde fuera: el target nuevo aparece en /json. La
 *  pestaña se cierra al final para no ensuciar la corrida siguiente. */
async function verificarVisorConversion(cdp, etiqueta) {
  const targets = async () =>
    (await fetch(`${CDP}/json`).then((r) => r.json()).catch(() => [])).map((t) => t.id);
  const antes = new Set(await targets());
  if (!(await tocar(cdp, '[data-testid="conversion-dev"]', "VER LO LEÍDO"))) {
    return { pulsado: false };
  }
  let visor = null;
  for (let i = 0; i < 20 && !visor; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const lista = await fetch(`${CDP}/json`).then((r) => r.json()).catch(() => []);
    visor = lista.find((t) => t.type === "page" && t.url.startsWith("blob:") && !antes.has(t.id));
  }
  if (!visor) return { pulsado: true, abrio: false };
  const v = await Cdp.abrir(visor.webSocketDebuggerUrl);
  const contenido = await v
    .js(() => ({
      titulo: document.title,
      secciones: Array.from(document.querySelectorAll("h2")).map((e) => e.textContent.trim()),
      bloques: document.querySelectorAll("pre").length,
      kb: Math.round(document.body.innerText.length / 1024),
    }))
    .catch((e) => ({ error: e.message }));
  await fetch(`${CDP}/json/close/${visor.id}`).catch(() => {});
  v.ws.close();
  progreso(`${etiqueta}: visor de lo leído → ${JSON.stringify(contenido)}`);
  return { pulsado: true, abrio: true, contenido };
}

/** Un escaneo completo: importar → esperar veredicto → desplegar → leer. */
async function escanear(cdp, archivo, etiqueta) {
  const t0 = Date.now();
  const err = await importar(cdp, archivo);
  if (err) throw new Error(`${etiqueta}: ${err}`);
  progreso(`${etiqueta}: importado ${archivo}`);
  let tarjeta = null;
  // El pipeline del A56 tarda 30-180 s por foto; el teléfono se re-alza cada
  // tres sondeos (despertar() cuesta 2-4 s de adb inalámbrico y sin el foco
  // Chrome estrangula la pestaña y el OCR se congela).
  // Sonda de estado dentro de la PÁGINA. Ojo: la función se serializa y se
  // evalúa en el contexto de la pestaña, donde NO existen las constantes de
  // Node — VEREDICTOS se pasa como argumento (sin eso, cada sondeo lanzaba
  // ReferenceError, el catch lo tragaba y el banco esperaba 669 s una tarjeta
  // que sí estaba en pantalla).
  const sondeo = () =>
    cdp.js((patron) => {
      const limpio = (t) => (t ?? "").replace(/\s+/g, " ").trim();
      const c = document.querySelector(
        '[data-testid="banner-revision"], [data-testid="barra-rechazo"]',
      );
      const cuerpo = document.body.innerText;
      return {
        listo: new RegExp(patron).test(cuerpo) && Boolean(c),
        banner: limpio(c?.innerText).slice(0, 90) || null,
        hayInput: Boolean(document.querySelector("input[type=file]:not([capture])")),
        pilas: limpio(
          Array.from(document.querySelectorAll("[data-testid]"))
            .slice(0, 6)
            .map((e) => e.getAttribute("data-testid"))
            .join(","),
        ),
        cuerpo: limpio(cuerpo).slice(0, 200),
      };
    }, VEREDICTOS.source);
  for (let i = 0; i < 150; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    if (i % 3 === 2) despertar();
    let s = null;
    let cdpErr = null;
    try {
      s = await sondeo();
    } catch (e) {
      cdpErr = e.message;
    }
    if (s?.listo) {
      // Asentar el render: el pill del score aparece ANTES de que la tarjeta
      // y el portal de la verificación monten (medido — leer de inmediato
      // devuelve medio DOM y filas=0).
      await new Promise((r) => setTimeout(r, 3000));
      tarjeta = await leerTarjeta(cdp);
      break;
    }
    if (cdpErr || i % 3 === 2) {
      const seg = Math.round((Date.now() - t0) / 1000);
      progreso(
        cdpErr
          ? `${etiqueta}: esperando ${seg} s · CDP ERROR: ${cdpErr}`
          : `${etiqueta}: esperando ${seg} s · input=${s?.hayInput} banner=${s?.banner ?? "-"} ` +
            `testids=[${s?.pilas ?? "?"}] texto="${s?.cuerpo ?? "?"}"`,
      );
    }
  }
  const ms = Date.now() - t0;
  if (!tarjeta) {
    // Última lectura tolerante: si la tarjeta apareció justo al cerrar el
    // sondeo, el banco informa de ella en vez de morir sin evidencia.
    tarjeta = (await sondeo().catch(() => null))?.listo ? await leerTarjeta(cdp) : null;
    if (!tarjeta) {
      await capturar(cdp, `${etiqueta}-sin-tarjeta`);
      throw new Error(`${etiqueta}: sin tarjeta de revisión tras ${Math.round(ms / 1000)} s`);
    }
  }
  if (tarjeta.tieneVerif) {
    await tocar(cdp, '[data-testid="verificacion-toggle"]', "Verificación Documental");
    await new Promise((r) => setTimeout(r, 1500));
    tarjeta = await leerTarjeta(cdp);
  }
  progreso(
    `${etiqueta}: ${Math.round(ms / 1000)} s · banner="${tarjeta.banner}" · filas=${tarjeta.filas.length} · prohibidas=[${tarjeta.presentes}]`,
  );
  await capturar(cdp, etiqueta);
  // La captura va ANTES del chip: la pestaña del visor pasa la app a segundo
  // plano y la foto siguiente saldría con el visor encima.
  const visor = tarjeta.chipConversion ? await verificarVisorConversion(cdp, etiqueta) : null;
  writeFileSync(join(OUT, `${etiqueta}.json`), JSON.stringify({ ms, ...tarjeta, visor }, null, 2));
  return { ms, ...tarjeta, visor };
}

// ── corrida ────────────────────────────────────────────────────────────────
const SOLO = process.argv[2] ?? null;
const consola = [];

async function main() {
  const cdp = await elegirPagina();
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Network.enable");
  // SE LIMPIA la caché HTTP, no se DESACTIVA: desactivarla obliga al teléfono
  // a re-bajar los ~48 MB de modelos ONNX/tesseract en cada request y el
  // escaneo pasó de 26 s a 10 min (medido 2026-11-27). Limpiarla basta para que
  // el HTML no salga del bundle viejo (el toast «Nueva versión disponible» que
  // deja la app a medio montar).
  await cdp.send("Network.clearBrowserCache").catch(() => {});
  cdp.on("Runtime.consoleAPICalled", (p) => {
    const txt = (p.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ");
    if (/molde|ratio|ancla|catálogo|catalogo/i.test(txt)) consola.push(txt.slice(0, 600));
  });

  // SIN_LIMPIEZA = 1 → se conserva la biblioteca de la corrida anterior. Sirve
  // para medir variantes: sembrar una vez y luego quitar filas (abajo).
  const sinLimpieza = process.env.TAMIZ_SIN_LIMPIEZA === "1";
  const dbs = sinLimpieza ? ["(conservada por TAMIZ_SIN_LIMPIEZA)"] : await limpiar(cdp);
  progreso(`limpieza: IndexedDB ${sinLimpieza ? "NO borrada" : `borrada [${(dbs ?? []).join(", ")}]`} · claves ${CLAVES.join(", ")}`);
  await cdp.send("Page.navigate", { url: APP });
  const inputListo = await cdp.esperando(
    () => Boolean(document.querySelector("input[type=file]:not([capture])")),
    120000,
    4000,
  );
  if (!inputListo) throw new Error("la app no arrancó tras la limpieza");
  await cdp.js(() => {
    const b = Array.from(document.querySelectorAll("button")).find((x) =>
      /Entendido|Cerrar|Empezar/i.test(x.innerText),
    );
    b?.click();
    return true;
  });
  progreso("app lista (estado cero: sin catálogo, sin molde activo)");
  await descartarActualizar(cdp);
  progreso(`biblioteca antes del escaneo: ${JSON.stringify(await leerBiblioteca(cdp))}`);

  // TAMIZ_BIBLIOTECA_SIN = subtomas de nombre separadas por coma → BORRA esas
  // filas de la biblioteca (y se recarga: el registry cachea en módulo). Es la
  // palanca para medir el RIESGO 1 del plan — qué extrae `recibo_pago` cuando
  // `recibo_real` no está en la biblioteca — sin tocar el catálogo empaquetado.
  // Se usa junto a TAMIZ_SIN_LIMPIEZA=1 (primero hay que sembrar: una corrida
  // normal siembra, esta corrida mide).
  const recorte = (process.env.TAMIZ_BIBLIOTECA_SIN ?? "").split(",").filter(Boolean);
  if (recorte.length) {
    const borrados = await cdp.js(async (subtomAs) => {
      const existe = ((await indexedDB.databases?.()) ?? []).some((d) => d.name === "tamiz-moldes-v1");
      if (!existe) return null;
      const db = await new Promise((res, rej) => {
        const q = indexedDB.open("tamiz-moldes-v1");
        q.onsuccess = () => res(q.result);
        q.onerror = () => rej(q.error);
      });
      if (!db.objectStoreNames.contains("moldes")) {
        db.close();
        return null;
      }
      const filas = await new Promise((res, rej) => {
        const t = db.transaction("moldes", "readonly");
        const q = t.objectStore("moldes").getAll();
        q.onsuccess = () => res(q.result);
        q.onerror = () => rej(q.error);
      });
      const baja = filas.filter((f) =>
        subtomAs.some((s) => (f.nombre ?? "").toLowerCase().includes(s.toLowerCase())),
      );
      await new Promise((res, rej) => {
        const t = db.transaction("moldes", "readwrite");
        for (const m of baja) t.objectStore("moldes").delete(m.id);
        t.oncomplete = res;
        t.onerror = () => rej(t.error);
      });
      db.close();
      return baja.map((m) => m.nombre);
    }, recorte);
    progreso(`biblioteca recortada: fuera ${JSON.stringify(borrados)}`);
    await cdp.send("Page.navigate", { url: APP });
    await cdp.esperando(
      () => Boolean(document.querySelector("input[type=file]:not([capture])")),
      120000,
      4000,
    );
    await descartarActualizar(cdp);
    progreso(`biblioteca tras el recorte: ${JSON.stringify(await leerBiblioteca(cdp))}`);
  }

  // TAMIZ_ACTIVO_NOMBRE = nombre EXACTO de la biblioteca → lo activa como lo
  // haría el Panel MOLDES (localStorage + recarga: registry cachea el activo).
  // Sirve para medir el DESEMPATE del AUTO entre dos plantillas del mismo papel.
  const activar = process.env.TAMIZ_ACTIVO_NOMBRE ?? null;
  if (activar) {
    const nombre = await cdp.js(async (buscado) => {
      const db = await new Promise((res, rej) => {
        const q = indexedDB.open("tamiz-moldes-v1");
        q.onsuccess = () => res(q.result);
        q.onerror = () => rej(q.error);
      });
      const filas = await new Promise((res, rej) => {
        const q = db.transaction("moldes", "readonly").objectStore("moldes").getAll();
        q.onsuccess = () => res(q.result);
        q.onerror = () => rej(q.error);
      });
      db.close();
      const fila = filas.find((f) => f.nombre === buscado);
      if (!fila) return null;
      localStorage.setItem("tamiz.moldeActivo.v1", JSON.stringify(fila.json));
      return fila.nombre;
    }, activar);
    if (!nombre) throw new Error(`no hay fila en la biblioteca llamada «${activar}»`);
    await cdp.send("Page.navigate", { url: APP });
    await new Promise((r) => setTimeout(r, 6000));
    progreso(`molde ACTIVADO para medir el desempate: ${nombre}`);
  }

  const corridas = [];
  const planes = [
    { etiqueta: "recibo", archivo: "recibo-real-01.jpg" },
    { etiqueta: "comprobante", archivo: "comprobante-real-01.jpg" },
    { etiqueta: "acta-e14", archivo: "acta-e14-pag1.png" },
  ].filter((p) => !SOLO || p.etiqueta === SOLO);

  for (const p of planes) {
    // Solo el primer escaneo parte de cero; los siguientes conservan la
    // biblioteca sembrada (es lo que mide la latencia de la marca).
    const r = await escanear(cdp, p.archivo, p.etiqueta);
    corridas.push({ ...p, ...r });
    if (p.etiqueta === "recibo") {
      const bib = await leerBiblioteca(cdp);
      progreso(`biblioteca tras el 1.er escaneo (${bib.length}): ${bib.join(" | ")}`);
      progreso(`marca catálogo: ${await cdp.js(() => localStorage.getItem("tamiz.catalogoMoldes.v1"))}`);
      writeFileSync(join(OUT, "biblioteca.json"), JSON.stringify(bib, null, 2));
    }
    // Volver al paso de importación para la siguiente foto.
    await cdp.js(() => {
      const b = Array.from(document.querySelectorAll("button")).find((x) =>
        /VOLVER|REPETIR|ESCANEAR OTRO|NUEVO/i.test(x.innerText),
      );
      b?.click();
      return true;
    });
    await new Promise((r) => setTimeout(r, 2500));
    if (!(await cdp.js(() => Boolean(document.querySelector("input[type=file]:not([capture])"))))) {
      await cdp.send("Page.navigate", { url: APP });
      await new Promise((r) => setTimeout(r, 6000));
    }
  }

  // Asertores del plan.
  const recibo = corridas.find((c) => c.etiqueta === "recibo");
  const fallas = [];
  if (recibo) {
    if (!/recibo/i.test(recibo.banner ?? "")) fallas.push("el banner no nombra el documento identificado");
    if (recibo.filas.length < 6) fallas.push(`el desplegable lista ${recibo.filas.length} filas (se esperan los 12 campos del molde)`);
    if (recibo.presentes.length) fallas.push(`texto prohibido: ${recibo.presentes.join(", ")}`);
    if (recibo.editores) fallas.push(`${recibo.editores} filas siguen ofreciendo edición manual`);
    const rechazada = /RECHAZADA/.test(`${recibo.veredicto ?? ""} ${recibo.texto ?? ""}`);
    if (rechazada && !recibo.chipConversion) {
      fallas.push("captura RECHAZADA sin el chip VER LO LEÍDO (visor HTML/MD)");
    }
    if (recibo.chipConversion && !recibo.visor?.abrio) {
      fallas.push("el chip VER LO LEÍDO no abrió la pestaña del visor");
    }
    progreso(`recibo: editores=${recibo.editores} chip-conversión=${recibo.chipConversion} rechazada=${rechazada}`);
  }
  const comp = corridas.find((c) => c.etiqueta === "comprobante");
  if (comp && recibo) {
    if (comp.banner === recibo.banner) fallas.push("AUTO no discrimina: comprobante identificó el mismo molde que el recibo");
  }
  const acta = corridas.find((c) => c.etiqueta === "acta-e14");
  if (acta && acta.presentes.length) fallas.push(`acta E-14 conserva texto prohibido: ${acta.presentes.join(", ")}`);

  if (consola.length) {
    writeFileSync(join(OUT, "consola-molde.txt"), consola.join("\n"));
    progreso(`log del motor: ${consola.length} líneas en consola-molde.txt`);
    for (const l of consola.slice(-8)) progreso(`  · ${l}`);
  }
  progreso(
    fallas.length === 0
      ? `RESULTADO: OK — ${corridas.map((c) => `${c.etiqueta}=${Math.round(c.ms / 1000)}s`).join(" ")}`
      : `RESULTADO: FALLAS — ${fallas.join(" / ")}`,
  );
  writeFileSync(join(OUT, "resumen.json"), JSON.stringify({ corridas, fallas, consola }, null, 2));
  cdp.ws.close();
  process.exit(fallas.length ? 1 : 0);
}

main().catch((e) => {
  progreso(`ERROR: ${e.message}`);
  process.exit(2);
});
