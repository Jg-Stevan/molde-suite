/**
 * medir-fases-a56.mjs — FASE 0 del plan de rendimiento (plan plain-slope-buck):
 * mide dónde se come el tiempo por FASE en el A56 real, sin tocar la app.
 *
 * Canales (todos ya existentes):
 *  · Tiempo a veredicto por configuración (kill-switches tamiz.flags.v1).
 *  · Transiciones de progreso en la UI (DETECTANDO/RECORTANDO/CALIDAD/LAYOUT/OCR).
 *  · Consola: [e14] ocr-cascada ms1/ms2/msRoi/msMotor · [e14] orientacion ms=
 *    · [molde] ratio de anclas ocrMs · [molde] A/B · [e14-rapidocr] celda.
 *  · IDB e14-jornada-v1/acta/"en-revision" → acta.evaluacionMolde.tiempos.
 *  · RSS de Chrome vía `adb shell dumpsys meminfo` antes/después de cada run.
 *  · crossOriginIsolated / hardwareConcurrency / deviceMemory (una vez).
 *
 * Uso: TAMIZ_ADB_SERIAL=... node scripts/entrega/medir-fases-a56.mjs \
 *        [--cdp http://127.0.0.1:9223] [--fotos a.jpg,b.jpg] [--configs rapid,...]
 */
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import {
  ADB,
  RESULTADOS,
  VEREDICTOS,
  conectarA56,
  crearProgreso,
  cuerpo,
  desarmarAutoCaptura,
  despertarA56,
  enderezarFoto,
  prepararImporte,
  seleccionarArchivo,
  serialAdb,
  tocar,
} from "./a56-comun.mjs";
import { existsSync } from "node:fs";

const argDe = (n) => {
  const i = process.argv.indexOf(n);
  return i > -1 ? process.argv[i + 1] : null;
};
const CDP = argDe("--cdp") ?? "http://127.0.0.1:9223";
const DIR_FOTOS = join("apps", "tamiz", "public", "dev-fixtures", "reales-variantes");
const DIR_MOLDES = join("apps", "tamiz", "public", "moldes");

const FOTOS_DEFAULT = [
  "recibo-a-impreso-firmas-vacias-01.jpg",
  "recibo-b-todo-mano-01.jpg",
  "recibo-c-mixto-01.jpg",
  "comprobante-a-impreso-firmas-vacias-01.jpg",
  "comprobante-b-todo-mano-01.jpg",
  "comprobante-c-mixto-01.jpg",
];
const FOTOS = (argDe("--fotos") ?? FOTOS_DEFAULT.join(",")).split(",");

// Matriz del plan (Fase 0): cada config = flags en tamiz.flags.v1 + recarga.
const CONFIGS = {
  baseline: {},
  rapid: { ocrPrimeraPasadaRapida: true },
  sincascada: { ocrCascada: false },
  sinmolde: { evaluacionMolde: false },
  suelo: { ocrPrimeraPasadaRapida: true, evaluacionMolde: false },
};
const CLAVES_CONFIG = (argDe("--configs") ?? Object.keys(CONFIGS).join(",")).split(",");
if (CLAVES_CONFIG.some((c) => !CONFIGS[c])) {
  console.error(`config desconocida; válidas: ${Object.keys(CONFIGS).join(",")}`);
  process.exit(1);
}

// Etiquetas de fase que la UI pinta durante el análisis (orden del pipeline).
const FASES_UI = ["DETECTANDO", "RECORTANDO", "CALIDAD", "LAYOUT", "OCR"];
const TIMEOUT_RUN_MS = 300_000;
// Watchdog por corrida: una llamada de Playwright sin timeout NO puede
// bloquear el lote (medido 2026-11-26: evaluate colgado ≈60 min en silencio).
const WATCHDOG_RUN_MS = 420_000;

/** Carrera con reloj: rechaza con etiqueta si la promesa no termina a tiempo. */
const conReloj = (p, ms, etiqueta) =>
  Promise.race([
    p,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error(`WATCHDOG ${etiqueta} (${ms}ms)`)), ms),
    ),
  ]);

const progreso = crearProgreso("medir-fases-a56.log");
mkdirSync(join(RESULTADOS, "medir-fases"), { recursive: true });

function meminfoChrome() {
  try {
    const serial = serialAdb();
    const args = serial ? ["-s", serial] : [];
    const out = execFileSync(ADB, [...args, "shell", "dumpsys", "meminfo", "com.android.chrome"], {
      encoding: "utf-8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: 20_000,
    });
    const totales = out
      .split("\n")
      .filter((l) => /TOTAL/.test(l))
      .slice(0, 4)
      .map((l) => l.trim().slice(0, 90));
    return totales;
  } catch (e) {
    return [`sin meminfo: ${String(e).slice(0, 80)}`];
  }
}

const progresoPagina = (pagina, sesion) => async (ms, { veredicto = true } = {}) => {
  const t0 = Date.now();
  const etapas = [];
  let ver = null;
  let ultimoDespertar = 0;
  while (Date.now() - t0 < ms) {
    await pagina.waitForTimeout(400);
    // Pantalla encendida + pestaña al frente: si el teléfono duerme a mitad
    // del análisis el renderer se congela y el run se cuelga (medido).
    if (Date.now() - ultimoDespertar > 10_000) {
      ultimoDespertar = Date.now();
      try {
        const serial = serialAdb();
        const args = serial ? ["-s", serial] : [];
        execFileSync(ADB, [...args, "shell", "input", "keyevent", "KEYCODE_WAKEUP"], { timeout: 5_000 });
      } catch { /* best-effort */ }
    }
    await pagina.bringToFront().catch(() => {});
    const t = await cuerpo(pagina);
    if (veredicto && VEREDICTOS.test(t)) {
      ver = { texto: t.match(VEREDICTOS)[0], t: Date.now() - t0 };
      break;
    }
    for (const f of FASES_UI) {
      if (t.includes(f) && (etapas.length === 0 || etapas[etapas.length - 1].fase !== f)) {
        etapas.push({ fase: f, t: Date.now() - t0 });
      }
    }
  }
  return { ver, etapas };
};

// Acta persistida (jornada.ts: IDB e14-jornada-v1 / store acta / "en-revision").
const LEE_ACTA = `async () => {
  const db = await new Promise((res, rej) => {
    const q = indexedDB.open("e14-jornada-v1");
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
  const r = await new Promise((res) => {
    const rq = db.transaction("acta", "readonly").objectStore("acta").get("en-revision");
    rq.onsuccess = () => res(rq.result ?? null);
    rq.onerror = () => res(null);
  });
  db.close();
  if (!r || !r.acta) return null;
  const a = r.acta;
  const ev = a.evaluacionMolde;
  return ev
    ? { id: a.id, status: a.status, score: a.score, molde: ev.moldeNombre ?? null,
        enrutado: ev.enrutado === true, ok: ev.ok ?? null, total: ev.total ?? null,
        faltan: ev.obligatoriosFaltantes ?? [], tiempos: ev.tiempos ?? null }
    : { id: a.id, status: a.status, score: a.score, molde: null, enrutado: false,
        ok: null, total: null, faltan: [], tiempos: null };
}`;

const INFO_DISPOSITIVO = `() => ({
  crossOriginIsolated,
  nucleos: navigator.hardwareConcurrency ?? null,
  memoriaGb: navigator.deviceMemory ?? null,
})`;

const progresoLog = crearProgreso("medir-fases-a56.log");
const { navegador, pagina, sesion } = await conectarA56(CDP);

const lineas = [];
const oyente = (msg) => {
  const t = msg.text();
  if (/\[e14|\[molde|\[tamiz:info\] \[e14|rapidocr/i.test(t)) {
    lineas.push(t.slice(0, 400));
  }
};
pagina.on("console", oyente);
pagina.on("pageerror", (e) => lineas.push(`[pageerror] ${String(e).slice(0, 300)}`));

try {
  // 1) Sembrar biblioteca de moldes (router real) y quitar molde activo.
  const filas = ["recibo_real", "comprobante_real"].map((k) => {
    const molde = JSON.parse(readFileSync(join(DIR_MOLDES, `${k}.molde.json`), "utf-8"));
    return {
      id: `molde_real_${k}`,
      nombre: molde.nombre,
      guardadoEn: new Date().toISOString(),
      version: molde.version,
      json: molde,
    };
  });
  await pagina.evaluate(async (fs) => {
    const db = await new Promise((res, rej) => {
      const q = indexedDB.open("tamiz-moldes-v1", 1);
      q.onupgradeneeded = () => {
        if (!q.result.objectStoreNames.contains("moldes"))
          q.result.createObjectStore("moldes", { keyPath: "id" });
      };
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
    const store = db.transaction("moldes", "readwrite").objectStore("moldes");
    await new Promise((res) => {
      store.clear().onsuccess = () => res();
    });
    for (const f of fs) {
      await new Promise((res) => {
        store.put(f).onsuccess = () => res();
      });
    }
    db.close();
    localStorage.removeItem("tamiz.moldeActivo.v1");
  }, filas);

  // 2) Info de dispositivo (una vez, con flags default).
  await pagina.goto("http://localhost:3100/", { waitUntil: "domcontentloaded", timeout: 90000 });
  const info = await pagina.evaluate(INFO_DISPOSITIVO).catch(() => null);
  progreso(`dispositivo: ${JSON.stringify(info)} · configs=[${CLAVES_CONFIG.join(",")}] · fotos=${FOTOS.length}`);

  const corridas = [];
  for (const archivo of FOTOS) {
    for (const clave of CLAVES_CONFIG) {
      for (const pase of ["run1", ...(clave === "baseline" ? ["run2"] : [])]) {
        const etiqueta = `${archivo} ${clave} ${pase}`;
        const archivoJson = `${archivo}__${clave}__${pase}.json`;
        const rutaJson = join(RESULTADOS, "medir-fases", archivoJson);
        if (existsSync(rutaJson)) {
          progreso(`SKIP ${etiqueta} (ya medido)`);
          continue;
        }
        const run = async () => {
          despertarA56();
          // Flags de la config + recarga (los flags se leen al boot).
          await conReloj(
            pagina.evaluate((f) => {
              localStorage.setItem("tamiz.flags.v1", JSON.stringify(f));
            }, CONFIGS[clave]),
            30_000,
            "set-flags",
          );
          await conReloj(
            pagina.reload({ waitUntil: "domcontentloaded", timeout: 90000 }),
            120_000,
            "reload",
          );
          await conReloj(
            pagina.locator("input[type=file]").first().waitFor({ state: "attached", timeout: 60000 }),
            70_000,
            "esperar-input",
          );
          // Recarga puede caer en CÁMARA (AUTO): volver a IMPORTAR.
          const camara = pagina.getByRole("button", { name: /Importar/i });
          if (await camara.count()) {
            await tocar(pagina, sesion, camara.first(), "barra Importar").catch(() => {});
            await pagina.waitForTimeout(1500);
          }
          await desarmarAutoCaptura(pagina);

          const rssAntes = meminfoChrome();
          lineas.length = 0;
          await conReloj(prepararImporte(pagina), 180_000, "preparar-importe");
          await pagina.bringToFront().catch(() => {});
          const t0 = Date.now();
          await conReloj(seleccionarArchivo(pagina, `reales-variantes/${archivo}`), 30_000, "inyectar-archivo");
          const { ver, etapas } = await progresoPagina(pagina, sesion)(TIMEOUT_RUN_MS);
          const msVeredicto = ver ? ver.t : null;
          const acta = await pagina.evaluate(`(${LEE_ACTA})()`).catch(() => null);

          // Fotos giradas (recibos): 1.º veredicto con sello diminuto → rotar
          // (mismo gesto del operador) y medir el reproceso como pase extra.
          let rotacion = null;
          const toques = await conReloj(enderezarFoto(pagina, sesion, 2), 300_000, "enderezar");
          if (toques > 0) {
            const r2 = await progresoPagina(pagina, sesion)(TIMEOUT_RUN_MS);
            const acta2 = await pagina.evaluate(`(${LEE_ACTA})()`).catch(() => null);
            rotacion = { toques, msVeredicto: r2.ver ? r2.ver.t : null, veredicto: r2.ver?.texto ?? null, acta: acta2, etapas: r2.etapas };
          }

          const rssDespues = meminfoChrome();
          const fila = {
            archivo, config: clave, pase,
            msVeredicto, veredicto: ver?.texto ?? null, etapas,
            acta, rotacion, info,
            rssAntes, rssDespues,
            consola: [...lineas],
            medidoEn: new Date().toISOString(),
          };
          writeFileSync(rutaJson, JSON.stringify(fila, null, 2));
          return { fila, ver, etapas, msVeredicto, toques, rotacion, acta };
        };

        try {
          const { fila, ver, etapas, msVeredicto, toques, rotacion } = await conReloj(run(), WATCHDOG_RUN_MS, `run ${etiqueta}`);
          corridas.push(fila);
          progreso(
            `${etiqueta} → ${msVeredicto ?? "TIMEOUT"}ms veredicto=${ver?.texto ?? "-"} ` +
              `etapas=[${etapas.map((e) => `${e.fase}@${e.t}`).join(" ")}] ` +
              (rotacion ? `rotación(+${toques})=${rotacion.msVeredicto ?? "TIMEOUT"}ms` : ""),
          );
        } catch (e) {
          progreso(`FALLO ${etiqueta}: ${String(e).slice(0, 200)}`);
          corridas.push({ archivo, config: clave, pase, error: String(e).slice(0, 400) });
          // Re-sincronizar la app para el siguiente run (matar vista colgada).
          await conReloj(
            prepararImporte(pagina).catch(() => pagina.reload({ waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {})),
            200_000,
            "resincronizar",
          ).catch(() => {});
        }
      }
    }
  }

  const salida = join(RESULTADOS, "medir-fases", "resumen.json");
  writeFileSync(salida, JSON.stringify({ info, corridas }, null, 2));
  progreso(`RESUMEN: ${corridas.length} corridas → ${salida}`);
  const okas = corridas.filter((c) => c.msVeredicto != null);
  for (const c of okas) {
    progreso(`TABLA ${c.archivo} ${c.config} ${c.pase}: ${c.msVeredicto}ms molde_ocr=${c.acta?.tiempos?.ocr_ms ?? "-"} molde_motor=${c.acta?.tiempos?.motor_ms ?? "-"} molde_render=${c.acta?.tiempos?.render_ms ?? "-"}`);
  }
} finally {
  pagina.off("console", oyente);
  await navegador.close().catch(() => {});
}
