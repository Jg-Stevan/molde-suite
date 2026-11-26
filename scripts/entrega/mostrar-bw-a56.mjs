/**
 * mostrar-bw-a56.mjs — resultado visual del pipeline (detect → warp → filtro
 * bw) en el Galaxy A56 real. Corre el worker de detección por CDP (mismo
 * protocolo que verificar-perfil-reales.mjs en el A13), guarda el PNG en
 * scripts/resultados/ y lo deja en la galería del teléfono
 * (/sdcard/Pictures/Tamiz/) abierto en pantalla con captura de evidencia.
 *
 * Uso (A56 con reverse tcp:3100 y forward tcp:9224):
 *   TAMIZ_ADB_SERIAL=<serial-a56> node scripts/entrega/mostrar-bw-a56.mjs \
 *     [--cdp http://127.0.0.1:9224] [--fotos a.jpg,b.jpg]
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ADB, RESULTADOS, capturaDispositivo, conectarA56, crearProgreso, limpiarPwa, serialAdb } from "./a56-comun.mjs";

const argDe = (n) => {
  const i = process.argv.indexOf(n);
  return i > -1 ? process.argv[i + 1] : null;
};
const CDP = argDe("--cdp") ?? "http://127.0.0.1:9224";
const FOTOS = (argDe("--fotos") ?? "20261123_201944.jpg,20261123_223112.jpg")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const progreso = crearProgreso("a56-mostrar-bw.log");
const serial = serialAdb();
if (!serial) {
  console.error("sin serial A56: fija TAMIZ_ADB_SERIAL");
  process.exit(1);
}
const adb = (args, ms = 30000) => execFileSync(ADB, ["-s", serial, ...args], { encoding: "utf-8", timeout: ms });

const { navegador, pagina, sesion } = await conectarA56(CDP);
try {
  progreso(`A56 mostrar-bw inicio · CDP=${CDP} · serial=${serial} · ${FOTOS.length} fotos · ${new Date().toISOString()}`);
  await limpiarPwa(pagina, sesion);
  await pagina
    .evaluate(() => {
      for (const v of document.querySelectorAll("video")) {
        try {
          v.srcObject?.getTracks?.().forEach((t) => t.stop());
        } catch {}
      }
    })
    .catch(() => undefined);

  const tBoot = Date.now();
  const inst = await pagina.evaluate(async () => {
    const w = window;
    if (w.__recorteWorker) return { reusado: true, opencvUrl: w.__recorteWorker.opencvUrl ?? null };
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
          const to = setTimeout(() => rej(new Error(`timeout ${msg.type} (60 s)`)), 60000);
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
    throw new Error(`worker no booteó: ${ultimo?.message}`);
  });
  progreso(`worker ${inst.reusado ? "reusado" : "listo"} (${inst.opencvUrl}) boot=${Date.now() - tBoot}ms`);

  for (const archivo of FOTOS) {
    const t0 = Date.now();
    const r = await pagina.evaluate(async (nombre) => {
      const drv = window.__recorteWorker;
      if (!drv) return { error: "worker no instalado" };
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
          return { error: `decode: ${String(e2?.message ?? e2)}` };
        }
      }
      marca("decode", t);
      const W = img.width;
      const H = img.height;
      const s = 400 / Math.max(W, H);
      t = performance.now();
      const small = await createImageBitmap(img, {
        resizeWidth: Math.max(1, Math.round(W * s)),
        resizeHeight: Math.max(1, Math.round(H * s)),
        resizeQuality: "low",
      });
      marca("mini", t);
      t = performance.now();
      let det;
      try {
        det = await drv.enviar({ type: "detect", bitmap: small, ts: drv.sigTs() }, [small]);
      } catch (e) {
        return { error: `detección: ${String(e?.message ?? e)}`, marcas };
      }
      marca("detect", t);
      const corners = det.corners ? Array.from(det.corners) : null;
      if (!corners) return { W, H, marcas, error: "sin quad" };
      t = performance.now();
      let wr;
      try {
        wr = await drv.enviar(
          { type: "warp", bitmap: img, quad: new Float32Array(corners), ts: drv.sigTs(), manual: true },
          [img],
        );
      } catch (e) {
        return { W, H, corners, marcas, error: `warp: ${String(e?.message ?? e)}` };
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
        return { W, H, corners, marcas, error: `enhance: ${String(e?.message ?? e)}` };
      }
      marca("enhanceBw", t);
      marcas.total = Math.round(performance.now() - tTotal);
      const buf = new Uint8Array(await enh.blob.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 8192) {
        bin += String.fromCharCode.apply(null, buf.subarray(i, i + 8192));
      }
      return { W, H, corners, marcas, pngBase64: btoa(bin), pngBytes: enh.blob.size, mime: enh.mime ?? null, w: enh.w, h: enh.h };
    }, archivo);

    if (r.error) {
      progreso(`FALLA ${archivo}: ${r.error}`);
      continue;
    }
    const sinExt = archivo.replace(/\.\w+$/, "");
    const png = Buffer.from(r.pngBase64, "base64");
    const host = join(RESULTADOS, `a56-bw-${sinExt}.png`);
    writeFileSync(host, png);
    const enCel = `/sdcard/Pictures/Tamiz/a56-bw-${sinExt}.png`;
    adb(["shell", "mkdir", "-p", "/sdcard/Pictures/Tamiz"]);
    adb(["push", host, enCel]);
    adb(["shell", "am", "broadcast", "-a", "android.intent.action.MEDIA_SCANNER_SCAN_FILE", "-d", `file://${enCel}`]);
    progreso(
      `ok ${archivo}: ${r.W}x${r.H} → ${r.w}x${r.h} bw=${r.marcas.enhanceBw}ms warp=${r.marcas.warp}ms det=${r.marcas.detect}ms png=${r.pngBytes}B host=${host} cel=${enCel} (${Date.now() - t0}ms)`,
    );

    adb(["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", `file://${enCel}`, "-t", "image/png", "--grant-read-uri-permission"]);
    await pagina.waitForTimeout(3000);
    const captura = capturaDispositivo(`a56-pantalla-${sinExt}.png`);
    progreso(`pantalla A56: ${captura ?? "captura falló"}`);
  }
} finally {
  await navegador.close();
}
progreso("fin");
process.exit(0);
