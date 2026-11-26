/**
 * a56-comun.mjs — helpers compartidos del banco E2E por CDP en el Galaxy A56
 * real (y en cualquier Chrome Android con depuración por USB/WiFi).
 *
 * Todo lo que ya funcionaba en scripts/entrega/verificar-a56.mjs vive aquí
 * UNA vez: conexión CDP con selección de la página del dev server, toque
 * táctil real (Input.dispatchTouchEvent), capturas por adb, limpieza del
 * service worker PWA (un CSS cacheado viejo deja fondos transparentes),
 * importación de fixtures servidos en /dev-fixtures/ como File in-page y
 * esperas de veredicto.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
export const RAIZ = resolve(AQUI, "..", "..");
export const RESULTADOS = join(RAIZ, "scripts", "resultados");
export const ADB = "C:\\platform-tools\\adb.exe";
export const MOLDE = join(RAIZ, "apps", "tamiz", "public", "moldes", "recibo_pago.molde.json");

export const VEREDICTOS = /ÓPTIMA|ADVERTENCIA|RECHAZADA|REVISIÓN HUMANA/;

/** Progreso en vivo a consola + archivo (el stdout redirigido de PowerShell
 *  bufferiza; el archivo es la fuente de evidencia en vivo). */
export function crearProgreso(nombreLog) {
  const archivo = join(RESULTADOS, nombreLog);
  return (linea) => {
    console.log(linea);
    try {
      appendFileSync(archivo, `${new Date().toISOString()} ${linea}\n`);
    } catch {
      /* evidencia best-effort */
    }
  };
}

/** Serial adb a usar: TAMIZ_ADB_SERIAL lo fija (dos teléfonos a la vez);
 *  sin la variable y con un único dispositivo conectado se infiere. */
export function serialAdb() {
  if (process.env.TAMIZ_ADB_SERIAL) return process.env.TAMIZ_ADB_SERIAL;
  try {
    const salida = execFileSync(ADB, ["devices"], { encoding: "utf-8" });
    const seriales = salida
      .split("\n")
      .slice(1)
      .map((l) => l.trim().split(/\s+/))
      .filter((p) => p[1] === "device")
      .map((p) => p[0]);
    return seriales.length === 1 ? seriales[0] : null;
  } catch {
    return null;
  }
}

/** Captura del dispositivo (pantalla completa, píxeles físicos) vía adb. */
export function capturaDispositivo(nombre) {
  try {
    const serial = serialAdb();
    const args = serial
      ? ["-s", serial, "exec-out", "screencap", "-p"]
      : ["exec-out", "screencap", "-p"];
    const png = execFileSync(ADB, args, { maxBuffer: 30 * 1024 * 1024 });
    writeFileSync(join(RESULTADOS, nombre), png);
    return nombre;
  } catch {
    return null;
  }
}

/** Despierta el teléfono y trae Chrome al frente ANTES de conectar por CDP:
 *  medido 2026-11-26 — con la pantalla bloqueada o Chrome en segundo plano el
 *  socket @chrome_devtools_remote existe pero el endpoint HTTP no responde
 *  (connectOverCDP muere a los 30 s). */
export function despertarA56() {
  const serial = serialAdb();
  const args = serial ? ["-s", serial] : [];
  try {
    execFileSync(ADB, [...args, "shell", "input", "keyevent", "KEYCODE_WAKEUP"]);
    execFileSync(ADB, [...args, "shell", "input", "keyevent", "82"]);
    // SIN -d: con URL, Chrome abre una PESTAÑA NUEVA en cada conexión y el
    // banco acaba midiendo una pestaña vieja mientras importa en otra
    // (medido 2026-11-26: 3 pestañas de localhost acumuladas).
    execFileSync(ADB, [
      ...args, "shell", "am", "start",
      "-n", "com.android.chrome/com.google.android.apps.chrome.Main",
    ]);
  } catch {
    /* best-effort: sin adb no hay banco */
  }
}

/** Conecta por CDP al Chrome del teléfono y devuelve la página del dev
 *  server + una sesión CDP para inyectar input táctil. */
export async function conectarA56(cdp = "http://127.0.0.1:9223") {
  despertarA56();
  const { chromium } = await import("playwright");
  const navegador = await chromium.connectOverCDP(cdp);
  const contexto = navegador.contexts()[0];
  // Varias pestañas de :3100 son normales (recargas/duplicados): se prefiere
  // la VISIBLE — una pestaña en segundo plano (TikTok al frente) queda
  // estrangulada por Chrome y el pipeline parece colgado.
  const candidatas = contexto.pages().filter((p) => p.url().includes("localhost:3100"));
  let pagina = null;
  // Con varias pestañas de la app (recargas/duplicados) se prefiere la que
  // tiene el FOCO real; si ninguna, la visible; una pestaña en segundo plano
  // queda estrangulada por Chrome y el pipeline parece colgado.
  for (const p of candidatas) {
    if (await p.evaluate(() => document.hasFocus()).catch(() => false)) {
      pagina = p;
      break;
    }
  }
  if (!pagina) {
    for (const p of candidatas) {
      const vis = await p.evaluate(() => document.visibilityState).catch(() => "hidden");
      if (vis === "visible") {
        pagina = p;
        break;
      }
    }
  }
  pagina ??= candidatas[0] ?? null;
  if (!pagina) {
    // Chrome quedó sin pestaña (p. ej. navegador.close() de un run anterior
    // cerró la única pestaña): se abre una nueva y se carga la app.
    pagina = await contexto.newPage();
    await pagina
      .goto("http://localhost:3100/", { waitUntil: "domcontentloaded", timeout: 90000 })
      .catch(() => undefined);
  }
  // Medido 2026-11-26: si el operador abre otra pestaña, Chrome Android
  // estrangula la de la app y el pipeline se CONGELA a mitad del análisis
  // (2452 ms al 18 % durante minutos). El banco necesita la pestaña al
  // frente para que el teléfono use su CPU.
  await pagina.bringToFront().catch(() => undefined);
  const sesion = await contexto.newCDPSession(pagina);
  return { navegador, contexto, pagina, sesion };
}

/** Toca el centro del locator con eventos táctiles REALES del dispositivo
 *  (CDP Input.dispatchTouchEvent). connectOverCDP no expone page.touchscreen,
 *  así que se inyecta touchStart/touchEnd; el navegador sintetiza el click
 *  como con un dedo físico. Si falla, cae a mouse (se devuelve el camino). */
export async function tocar(pagina, sesion, locator, etiqueta, progreso = () => {}) {
  await locator.waitFor({ state: "visible", timeout: 15000 });
  const caja = await locator.boundingBox();
  if (!caja) throw new Error(`sin caja para ${etiqueta}`);
  const x = caja.x + caja.width / 2;
  const y = caja.y + caja.height / 2;
  let via = "touch-cdp";
  try {
    await sesion.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y, id: 1, radiusX: 6, radiusY: 6, force: 1 }],
    });
    await pagina.waitForTimeout(80);
    await sesion.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } catch {
    try {
      await pagina.touchscreen.tap(x, y);
      via = "touchscreen";
    } catch {
      await pagina.mouse.click(x, y);
      via = "mouse-fallback";
    }
  }
  progreso(`tap ${etiqueta} (${Math.round(x)},${Math.round(y)}) ${via}`);
  return via;
}

export async function cuerpo(pagina) {
  return pagina.locator("body").innerText().catch(() => "");
}

/** Poll hasta que aparezca un veredicto; devuelve el texto o null. */
export async function esperarVeredicto(pagina, ms = 300000, intervalo = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    await pagina.waitForTimeout(intervalo);
    const t = await cuerpo(pagina);
    if (VEREDICTOS.test(t)) return t;
  }
  return null;
}

/** Siembra el molde versionado + la marca de ayuda ANTES de recargar (mismas
 *  claves del registry de producción). */
export async function sembrarMolde(pagina, textoMolde) {
  await pagina.evaluate((texto) => {
    localStorage.setItem("tamiz.moldeActivo.v1", texto);
    localStorage.setItem("e14-ayuda-vista", "1");
  }, textoMolde);
}

/** Limpieza PWA del teléfono: sin esto, el service worker sirve un bundle
 *  viejo y las clases Tailwind nuevas (bg-brand-green, bg-black/85…) no
 *  pintan → fondos transparentes. Desregistra SW, borra caches, recarga sin
 *  caché y espera el input de importación. */
export async function limpiarPwa(pagina, sesion) {
  await pagina.evaluate(async () => {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    for (const k of await caches.keys()) await caches.delete(k);
  });
  await sesion.send("Network.setCacheDisabled", { cacheDisabled: true }).catch(() => {});
  await pagina.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
  await pagina.locator("input[type=file]").first().waitFor({ state: "attached", timeout: 120000 });
  const guia = pagina.getByRole("button", { name: /Entendido|Cerrar|Empezar/i });
  if (await guia.count()) await guia.first().click().catch(() => {});
}

/** Si el auto-captura quedó armado, lo desarma (no queremos timers durante
 *  el banco). */
export async function desarmarAutoCaptura(pagina) {
  await pagina.waitForTimeout(1500);
  const auto = pagina.getByRole("button", { name: /Captura automática/i });
  if ((await auto.count()) && (await auto.first().getAttribute("aria-pressed")) === "true") {
    await auto.first().click().catch(() => {});
    await pagina.waitForTimeout(500);
  }
}

/** Deja la app en el paso de importación (vuelve de una vista anterior si
 *  hace falta; recarga si el input no aparece). */
export async function prepararImporte(pagina) {
  const volver = pagina.getByRole("button", { name: /Volver a la vista anterior|REPETIR/i });
  if (await volver.count()) {
    await volver.first().click().catch(() => {});
    await pagina.waitForTimeout(2000);
  }
  const input = pagina.locator("input[type=file]").first();
  try {
    await input.waitFor({ state: "attached", timeout: 15000 });
  } catch {
    await pagina.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
    await pagina.locator("input[type=file]").first().waitFor({ state: "attached", timeout: 120000 });
    const guia = pagina.getByRole("button", { name: /Entendido|Cerrar|Empezar/i });
    if (await guia.count()) await guia.first().click().catch(() => {});
  }
  await desarmarAutoCaptura(pagina);
}

/** Endereza la foto con el botón «Rotar 90°» del visor (el mismo gesto del
 *  operador) cuando el recorte salió mal: fotos giradas 90° sobre mesa oscura
 *  hacen que el quad se cierre sobre un fragmento y la «foto procesada» queda
 *  como un sello diminuto (medido 2026-11-26 con los recibos reales). Cada
 *  toque reprocesa; se espera a que el img del visor cambie y sea vertical
 *  grande. Devuelve los toques dados. */
export async function enderezarFoto(pagina, sesion, max = 3) {
  const dims = () =>
    pagina
      .evaluate(() => {
        const img = document.querySelector('[data-purpose="visor-documento"] img');
        return img ? { w: img.naturalWidth, h: img.naturalHeight } : null;
      })
      .catch(() => null);
  let toques = 0;
  for (let i = 0; i < max; i++) {
    const d = await dims();
    if (d && d.w >= 400 && d.h >= d.w) return toques;
    const boton = pagina.getByRole("button", { name: /Rotar 90/i });
    if (!(await boton.count())) return toques;
    await tocar(pagina, sesion, boton.first(), "Rotar 90°");
    toques++;
    const t0 = Date.now();
    let prev = d;
    while (Date.now() - t0 < 240000) {
      await pagina.waitForTimeout(3000);
      await pagina.bringToFront().catch(() => {});
      const ahora = await dims();
      if (ahora && (!prev || ahora.w !== prev.w || ahora.h !== prev.h)) {
        prev = ahora;
        if (ahora.w >= 400 && ahora.h >= ahora.w) return toques;
        break;
      }
    }
  }
  return toques;
}

/** Entrega el fixture al input como File REAL in-page: fetch del dev server
 *  (los PNG viven en public/dev-fixtures/) + DataTransfer. Chrome Android
 *  (sandbox) no puede leer /sdcard desde DOM.setFileInputFiles, pero el
 *  pipeline recibe exactamente el mismo File que entrega el picker y el
 *  evento change burbujea a React igual que una selección del operador. */
export async function seleccionarArchivo(pagina, nombreArchivo) {
  const error = await pagina.evaluate(async (nombre) => {
    const resp = await fetch(`/dev-fixtures/${nombre}`);
    if (!resp.ok) return `fetch HTTP ${resp.status}`;
    const blob = await resp.blob();
    const file = new File([blob], nombre, { type: blob.type || "image/png" });
    const dt = new DataTransfer();
    dt.items.add(file);
    const i = document.querySelector("input[type=file]:not([capture])");
    if (!i) return "sin input de importación";
    i.files = dt.files;
    i.dispatchEvent(new Event("change", { bubbles: true }));
    return null;
  }, nombreArchivo);
  if (error) throw new Error(`inyección de archivo falló: ${error}`);
}
