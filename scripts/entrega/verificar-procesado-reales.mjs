/**
 * verificar-procesado-reales.mjs — genera LO QUE VE EL OPERADOR para cada foto
 * REAL: warp de perspectiva del MISMO worker OpenCV del visor + filtro `bw`
 * (modo enhance `bw`, PNG, maxLongSide 4032) — idéntico a
 * processImage(foto, quad, 'bw', 0, { manual: true }) del editor
 * (pipeline-recorte.ts / image-processor.processImagePrecise).
 *
 * Deja cada resultado en:
 *   · host:  scripts/resultados/reales-procesado/<base>-bw.png (+ JSON)
 *   · móvil: /sdcard/Pictures/Tamiz/<base>-bw.png (push adb + escaneo de media)
 *
 * Uso:
 *   TAMIZ_ADB_SERIAL=192.168.1.4:35543 node scripts/entrega/verificar-procesado-reales.mjs
 *     [--cdp http://127.0.0.1:9223] [--solo 20261123] [--limite 5] [--sin-push]
 *
 * NO corre OCR. Exit 1 si alguna foto falla (decode/detección/warp/enhance).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ADB, RESULTADOS, RAIZ, conectarA56, crearProgreso, serialAdb } from "./a56-comun.mjs";

const argCdp = process.argv.indexOf("--cdp");
const CDP = argCdp > -1 ? process.argv[argCdp + 1] : "http://127.0.0.1:9223";
const argSolo = process.argv.indexOf("--solo");
const SOLO = argSolo > -1 ? process.argv[argSolo + 1] : null;
const argFotos = process.argv.indexOf("--fotos");
const FOTOS_ARG =
  argFotos > -1
    ? String(process.argv[argFotos + 1])
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : null;
const argLimite = process.argv.indexOf("--limite");
const LIMITE = argLimite > -1 ? Number(process.argv[argLimite + 1]) : Infinity;
const SIN_PUSH = process.argv.includes("--sin-push");

const DIR_REALES = join(RAIZ, "apps", "tamiz", "public", "dev-fixtures", "reales");
const DIR_SALIDA = join(RESULTADOS, "reales-procesado");
mkdirSync(DIR_SALIDA, { recursive: true });

const FOTOS = readdirSync(DIR_REALES)
  .filter((f) => /\.(jpe?g|png)$/i.test(f))
  .filter((f) => !SOLO || f.includes(SOLO))
  .filter((f) => !FOTOS_ARG || FOTOS_ARG.some((x) => f.includes(x)))
  .sort()
  .slice(0, LIMITE);
if (FOTOS.length === 0) {
  console.error(`BLOQUEADA: no hay fotos en ${DIR_REALES}`);
  process.exit(1);
}

const progreso = crearProgreso("reales-procesado-progreso.log");

/** Muestra de recursos del teléfono (memoria disponible, PSS de Chrome,
 *  load 1 min, temperatura AP) — una sola llamada adb por muestra. */
function medirRecursos() {
  const serial = serialAdb();
  if (!serial) return null;
  try {
    const out = execFileSync(
      ADB,
      [
        "-s",
        serial,
        "shell",
        "cat /proc/meminfo | grep MemAvailable; " +
          "dumpsys meminfo com.android.chrome 2>/dev/null | grep 'TOTAL PSS'; " +
          "cat /proc/loadavg; " +
          "dumpsys thermalservice 2>/dev/null | grep -m1 'mName=AP'",
      ],
      { encoding: "utf-8", timeout: 25000 },
    );
    const memKb = Number(/MemAvailable:\s+(\d+)/.exec(out)?.[1]);
    const pssKb = Number(/TOTAL PSS:\s+(\d+)/.exec(out)?.[1]);
    const load1 = Number(/^([\d.]+)\s+[\d.]+\s+[\d.]+/m.exec(out)?.[1]);
    const tempAP = Number(/mValue=([\d.]+).*mName=AP/.exec(out)?.[1]);
    return {
      memAvailableMb: Number.isFinite(memKb) ? Math.round(memKb / 1024) : null,
      chromePssMb: Number.isFinite(pssKb) ? Math.round(pssKb / 1024) : null,
      load1: Number.isFinite(load1) ? load1 : null,
      tempAP: Number.isFinite(tempAP) ? tempAP : null,
    };
  } catch {
    return null;
  }
}

/** Apaga la cámara del visor (no se mide con el sensor consumiendo CPU). */
async function detenerCamara() {
  await pagina
    .evaluate(() => {
      for (const v of document.querySelectorAll("video")) {
        v.srcObject?.getTracks?.().forEach((t) => t.stop());
      }
    })
    .catch(() => undefined);
}
const { navegador, pagina } = await conectarA56(CDP);
pagina.on("pageerror", (e) => progreso(`[pageerror] ${String(e).slice(0, 300)}`));

/** Worker OpenCV del visor + driver (3 intentos; Worker nuevo cada vez). */
async function instalarWorker() {
  return pagina.evaluate(async () => {
    const w = window;
    if (w.__recorteWorker) return { listo: true, opencvUrl: w.__recorteWorker.opencvUrl ?? null };
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
          const to = setTimeout(() => rej(new Error(`timeout ${msg.type} (40 s)`)), 40000);
          worker.onmessage = (e) => {
            const d = e.data;
            if (d.ts !== msg.ts) return;
            clearTimeout(to);
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
        return { listo: true, opencvUrl: drv.opencvUrl, intentos: i + 1 };
      } catch (e) {
        ultimo = e;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    throw new Error(`worker no booteó tras 3 intentos: ${ultimo instanceof Error ? ultimo.message : ultimo}`);
  });
}

/** detect(400px) → warp (foto completa, manual) → enhance bw (PNG, 4032). */
async function procesarFoto(archivo) {
  return pagina.evaluate(async (nombre) => {
    const drv = window.__recorteWorker;
    if (!drv) return { error: "worker no instalado" };
    const t0 = performance.now();
    let blob;
    try {
      const resp = await fetch(`/dev-fixtures/reales/${nombre}`);
      if (!resp.ok) return { error: `fetch HTTP ${resp.status}` };
      blob = await resp.blob();
    } catch (e) {
      return { error: `fetch: ${String(e)}` };
    }
    let img;
    try {
      img = await createImageBitmap(blob);
    } catch (e1) {
      await new Promise((r) => setTimeout(r, 600));
      try {
        img = await createImageBitmap(blob);
      } catch (e2) {
        return { error: `decode: ${String(e2 instanceof Error ? e2.message : e2)}` };
      }
    }
    const W = img.width;
    const H = img.height;
    const s = 400 / Math.max(W, H);
    const dw = Math.max(1, Math.round(W * s));
    const dh = Math.max(1, Math.round(H * s));
    const small = await createImageBitmap(img, { resizeWidth: dw, resizeHeight: dh, resizeQuality: "low" });
    const tDet = performance.now();
    let det;
    try {
      det = await drv.enviar({ type: "detect", bitmap: small, ts: drv.sigTs() }, [small]);
    } catch (e) {
      img.close();
      return { error: `detección: ${String(e instanceof Error ? e.message : e)}`, W, H };
    }
    const msDet = Math.round(performance.now() - tDet);
    const corners = det.corners ? Array.from(det.corners) : null;
    if (!corners) {
      img.close();
      return { W, H, corners: null, msDet, error: "sin quad" };
    }
    // warp manual (el editor aplica su quad detectado al píxel) — mismo bitmap
    const tWarp = performance.now();
    let wr;
    try {
      wr = await drv.enviar(
        { type: "warp", bitmap: img, quad: new Float32Array(corners), ts: drv.sigTs(), manual: true },
        [img],
      );
    } catch (e) {
      return { W, H, corners, msDet, error: `warp: ${String(e instanceof Error ? e.message : e)}` };
    }
    const msWarp = Math.round(performance.now() - tWarp);
    // enhance bw (PNG, 4032) = filtro por defecto del operador
    const tEnh = performance.now();
    let enh;
    try {
      enh = await drv.enviar(
        { type: "enhance", bitmap: wr.bitmap, mode: "bw", maxLongSide: 4032, ts: drv.sigTs() },
        [wr.bitmap],
      );
    } catch (e) {
      return { W, H, corners, msDet, msWarp, error: `enhance: ${String(e instanceof Error ? e.message : e)}` };
    }
    const msEnhance = Math.round(performance.now() - tEnh);
    const dataUrl = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.onerror = () => rej(new Error("FileReader del PNG falló"));
      fr.readAsDataURL(enh.blob);
    });
    return {
      W,
      H,
      corners,
      msDet,
      msWarp,
      msEnhance,
      refined: wr.refined ?? null,
      w: enh.w,
      h: enh.h,
      mime: enh.mime ?? null,
      totalMs: Math.round(performance.now() - t0),
      png: dataUrl,
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

const filas = [];
try {
  progreso(`procesado bw reales inicio · CDP=${CDP} · ${FOTOS.length} fotos · ${new Date().toISOString()}`);
  await pagina.goto("http://localhost:3100/", { waitUntil: "domcontentloaded", timeout: 90000 });
  await pagina.waitForTimeout(1500);
  progreso(`recursos iniciales: ${JSON.stringify(medirRecursos())}`);

  for (const [indice, archivo] of FOTOS.entries()) {
    // El renderer no acumula entre fotos de 12 MP: pestaña recargada por foto
    // (en el A13 de 3 GB el segundo enhance tumbó el proceso renderer).
    if (indice > 0) {
      await pagina.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
      await pagina.waitForTimeout(1200);
    }
    await detenerCamara();
    const inst = await instalarWorker().catch(async (e) => {
      progreso(`boot worker falló (${e instanceof Error ? e.message : e}) — recargando página`);
      await pagina.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
      await pagina.waitForTimeout(2000);
      await detenerCamara();
      return instalarWorker();
    });
    progreso(`worker OpenCV listo (${inst.opencvUrl ?? "url?"})${inst.intentos > 1 ? ` · intento ${inst.intentos}` : ""}`);
    await pagina.waitForTimeout(800);
    const antes = medirRecursos();
    let r;
    try {
      r = await procesarFoto(archivo);
    } catch (e) {
      r = { error: String(e instanceof Error ? e.message : e).slice(0, 240) };
    }
    const despues = medirRecursos();
    const base = archivo.replace(/\.[a-z]+$/i, "");
    const fila = {
      archivo,
      W: r.W ?? null,
      H: r.H ?? null,
      corners: r.corners ?? null,
      areaPct: r.corners ? Math.round(areaQuad(r.corners) * 1000) / 10 : null,
      msDet: r.msDet ?? null,
      msWarp: r.msWarp ?? null,
      msEnhance: r.msEnhance ?? null,
      totalMs: r.totalMs ?? null,
      w: r.w ?? null,
      h: r.h ?? null,
      error: r.error ?? null,
      recursos: { antes, despues },
      archivoSalida: null,
      enMovil: null,
    };
    if (r.png) {
      const b64 = String(r.png).split(",")[1] ?? "";
      const ruta = join(DIR_SALIDA, `${base}-bw.png`);
      writeFileSync(ruta, Buffer.from(b64, "base64"));
      fila.archivoSalida = `reales-procesado/${base}-bw.png`;
    }
    filas.push(fila);
    progreso(
      `${fila.error ? "FALLA" : "ok   "} ${archivo.padEnd(24)} ` +
        `quad=${fila.areaPct ?? "?"}% salida=${fila.w ?? "?"}x${fila.h ?? "?"} ` +
        `det=${fila.msDet ?? "?"}ms warp=${fila.msWarp ?? "?"}ms bw=${fila.msEnhance ?? "?"}ms ` +
        `total=${fila.totalMs ?? "?"}ms` +
        (antes && despues ? ` memLibre ${antes.memAvailableMb}→${despues.memAvailableMb}MB chromePSS ${antes.chromePssMb}→${despues.chromePssMb}MB load ${antes.load1}→${despues.load1} AP ${despues.tempAP}°C` : "") +
        (fila.error ? ` ← ${fila.error}` : ""),
    );
  }
} finally {
  await navegador.close();
}

// ─── Dejar los resultados TAMBIÉN en el teléfono (galería) ──────────────────
const serial = serialAdb();
let pushOk = false;
if (!SIN_PUSH && serial) {
  const dirMovil = "/sdcard/Pictures/Tamiz";
  try {
    execFileSync(ADB, ["-s", serial, "shell", "mkdir", "-p", dirMovil]);
    for (const f of filas) {
      if (!f.archivoSalida) continue;
      const local = join(RESULTADOS, f.archivoSalida);
      execFileSync(ADB, ["-s", serial, "push", local, `${dirMovil}/${f.archivoSalida.split("/").pop()}`]);
      f.enMovil = `${dirMovil}/${f.archivoSalida.split("/").pop()}`;
    }
    // Escaneo de media (galería ve los archivos sin reiniciar): mejor esfuerzo.
    try {
      execFileSync(ADB, [
        "-s",
        serial,
        "shell",
        "content",
        "call",
        "--uri",
        "content://media/external",
        "--method",
        "scan_volume",
        "--arg",
        "external_primary",
      ]);
    } catch {
      /* MediaProvider sin scan_volume en esta ROM: el archivo queda igualmente */
    }
    const ls = execFileSync(ADB, ["-s", serial, "shell", "ls", dirMovil], { encoding: "utf-8" });
    pushOk = true;
    progreso(`push al móvil OK (${dirMovil}): ${ls.trim().replace(/\n/g, " · ").slice(0, 400)}`);
  } catch (e) {
    progreso(`push al móvil FALLÓ: ${e instanceof Error ? e.message : e}`);
  }
} else if (!SIN_PUSH) {
  progreso("push al móvil SALTADO: sin serial adb (TAMIZ_ADB_SERIAL)");
}

const salida = join(RESULTADOS, `reales-procesado-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(
  salida,
  JSON.stringify({ cdp: CDP, medidoEn: new Date().toISOString(), pushMovil: pushOk, filas }, null, 2),
);
progreso(`JSON: ${salida}`);
progreso(`capturas host: ${DIR_SALIDA}`);
process.exit(filas.some((f) => f.error || !f.archivoSalida) ? 1 : 0);
