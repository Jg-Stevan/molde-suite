/**
 * verificar-recorte-reales.mjs — DETECCIÓN + RECORTE (sin OCR) sobre las
 * fotos REALES del operador, usando el MISMO worker OpenCV del visor
 * (`/scanner/detection-worker.js`, protocolo detect/warp del detector-client:
 * detect a 400 px de lado mayor con esquinas en fracciones TL,TR,BR,BL; warp
 * a foto completa con cap 4032 — idéntico a processImage).
 *
 * Evidencia por foto: recorte JPEG (lo que vería el editor) + overlay del
 * quad sobre la foto reducida, para inspección visual. El OCR NO corre.
 *
 * Uso:
 *   TAMIZ_ADB_SERIAL=192.168.1.4:35543 node scripts/entrega/verificar-recorte-reales.mjs
 *     [--cdp http://127.0.0.1:9223] [--solo 20261123] [--limite 5]
 *
 * Salida: scripts/resultados/reales-recorte-<ts>.json + carpeta
 * scripts/resultados/reales-recorte/. Exit 1 si alguna detección/recorte falla.
 */
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RESULTADOS, RAIZ, conectarA56, crearProgreso } from "./a56-comun.mjs";

const argCdp = process.argv.indexOf("--cdp");
const CDP = argCdp > -1 ? process.argv[argCdp + 1] : "http://127.0.0.1:9223";
const argSolo = process.argv.indexOf("--solo");
const SOLO = argSolo > -1 ? process.argv[argSolo + 1] : null;
const argLimite = process.argv.indexOf("--limite");
const LIMITE = argLimite > -1 ? Number(process.argv[argLimite + 1]) : Infinity;

const DIR_REALES = join(RAIZ, "apps", "tamiz", "public", "dev-fixtures", "reales");
const DIR_SALIDA = join(RESULTADOS, "reales-recorte");
mkdirSync(DIR_SALIDA, { recursive: true });

const FOTOS = readdirSync(DIR_REALES)
  .filter((f) => /\.(jpe?g|png)$/i.test(f))
  .filter((f) => !SOLO || f.includes(SOLO))
  .sort()
  .slice(0, LIMITE);
if (FOTOS.length === 0) {
  console.error(`BLOQUEADA: no hay fotos en ${DIR_REALES}`);
  process.exit(1);
}

const progreso = crearProgreso("reales-recorte-progreso.log");
const { navegador, pagina } = await conectarA56(CDP);
pagina.on("pageerror", (e) => progreso(`[pageerror] ${String(e).slice(0, 300)}`));

/** Instala (una vez) el worker + el driver en la página. Devuelve estado.
 *  El boot puede fallar de forma transitoria en la gama baja (red del
 *  reverse, decodificación de opencv.js): 3 intentos, Worker nuevo cada vez. */
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
          const to = setTimeout(() => rej(new Error(`timeout ${msg.type} (25 s)`)), 25000);
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
      return { worker, enviar, sigTs: () => ++ts, opencvUrl: boot.opencvUrl ?? null, probe: boot.probe ?? null };
    };
    let ultimo = null;
    for (let i = 0; i < 3; i++) {
      try {
        const drv = await crear();
        w.__recorteWorker = drv;
        return { listo: true, opencvUrl: drv.opencvUrl, probe: drv.probe, intentos: i + 1 };
      } catch (e) {
        ultimo = e;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    throw new Error(`worker no booteó tras 3 intentos: ${ultimo instanceof Error ? ultimo.message : ultimo}`);
  });
}

/** Detecta + recorta UNA foto y devuelve esquinas, medidas y evidencias. */
async function detectarYRecortar(archivo) {
  return pagina.evaluate(async (nombre) => {
    const w = window;
    const drv = w.__recorteWorker;
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
    // Decode con 1 reintento: en gama baja Chrome falla esporádicamente
    // ("could not be decoded") por presión de memoria tras el warp anterior.
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
    // detect: 400 px de lado mayor (computeProcessDims del detector-client)
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
      // overlay sin quad: la foto tal cual
      const oc = new OffscreenCanvas(900, Math.max(1, Math.round((H / W) * 900)));
      oc.getContext("2d").drawImage(img, 0, 0, oc.width, oc.height);
      const ob = await oc.convertToBlob({ type: "image/jpeg", quality: 0.8 });
      const overlay = await new Promise((res) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result));
        fr.readAsDataURL(ob);
      });
      return { W, H, corners: null, msDet, error: "sin quad", overlay, crop: null, cropW: 0, cropH: 0 };
    }
    // warp a foto completa: se transfiere el MISMO bitmap (sin segunda
    // decodificación ni copia completa — clave en un A13 de 3 GB). El overlay
    // se pinta antes, desde ese bitmap, en un canvas reducido.
    const dataUrlDe = (b) =>
      new Promise((res) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result));
        fr.readAsDataURL(b);
      });
    const maxO = 900;
    const os = Math.min(1, maxO / Math.max(W, H));
    const oc = new OffscreenCanvas(Math.max(1, Math.round(W * os)), Math.max(1, Math.round(H * os)));
    const octx = oc.getContext("2d");
    octx.drawImage(img, 0, 0, oc.width, oc.height);
    const px = (i) => ({ x: corners[2 * i] * oc.width, y: corners[2 * i + 1] * oc.height });
    const pts = [px(0), px(1), px(2), px(3)];
    octx.lineWidth = Math.max(2, oc.width * 0.004);
    octx.strokeStyle = "#00e676";
    octx.fillStyle = "rgba(0,230,118,0.18)";
    octx.beginPath();
    octx.moveTo(pts[0].x, pts[0].y);
    for (const p of pts.slice(1)) octx.lineTo(p.x, p.y);
    octx.closePath();
    octx.fill();
    octx.stroke();
    octx.fillStyle = "#00e676";
    for (const [i, p] of pts.entries()) {
      octx.beginPath();
      octx.arc(p.x, p.y, Math.max(4, oc.width * 0.008), 0, Math.PI * 2);
      octx.fill();
      octx.fillStyle = "#fff";
      octx.font = `${Math.round(oc.width * 0.025)}px monospace`;
      octx.fillText(["1", "2", "3", "4"][i], p.x + 6, p.y - 6);
      octx.fillStyle = "#00e676";
    }
    const overlayBlob = await oc.convertToBlob({ type: "image/jpeg", quality: 0.82 });
    const overlay = await dataUrlDe(overlayBlob);

    const tWarp = performance.now();
    let wr;
    try {
      wr = await drv.enviar(
        { type: "warp", bitmap: img, quad: new Float32Array(corners), ts: drv.sigTs(), manual: false },
        [img],
      );
    } catch (e) {
      return { W, H, corners, msDet, overlay, error: `warp: ${String(e instanceof Error ? e.message : e)}` };
    }
    const msWarp = Math.round(performance.now() - tWarp);
    // recorte → JPEG
    const cw = wr.w;
    const ch = wr.h;
    const cc = new OffscreenCanvas(Math.max(1, cw), Math.max(1, ch));
    cc.getContext("2d").drawImage(wr.bitmap, 0, 0);
    wr.bitmap.close();
    const cropBlob = await cc.convertToBlob({ type: "image/jpeg", quality: 0.85 });
    const crop = await dataUrlDe(cropBlob);
    return {
      W,
      H,
      corners,
      msDet,
      msWarp,
      refined: wr.refined ?? null,
      fellBack: wr.fellBack ?? null,
      cropW: cw,
      cropH: ch,
      totalMs: Math.round(performance.now() - t0),
      crop,
      overlay,
    };
  }, archivo);
}

/** Área del quad (fracciones) por Gauss. */
function areaQuad(c) {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    a += c[2 * i] * c[2 * j + 1] - c[2 * j] * c[2 * i + 1];
  }
  return Math.abs(a) / 2;
}

const guardarDataUrl = (ruta, dataUrl) => {
  const b64 = String(dataUrl ?? "").split(",")[1] ?? "";
  writeFileSync(ruta, Buffer.from(b64, "base64"));
};

const filas = [];
try {
  progreso(`recorte reales inicio · CDP=${CDP} · ${FOTOS.length} fotos · ${new Date().toISOString()}`);
  await pagina.goto("http://localhost:3100/", { waitUntil: "domcontentloaded", timeout: 90000 });
  await pagina.waitForTimeout(1500);
  const inst = await instalarWorker().catch(async (e) => {
    progreso(`boot worker falló (${e instanceof Error ? e.message : e}) — recargando página`);
    await pagina.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
    await pagina.waitForTimeout(2000);
    return instalarWorker();
  });
  progreso(`worker OpenCV listo (${inst.opencvUrl ?? "url?"})${inst.intentos > 1 ? ` · intento ${inst.intentos}` : ""}`);

  for (const archivo of FOTOS) {
    let r;
    try {
      r = await detectarYRecortar(archivo);
    } catch (e) {
      // Un fallo aislado (decode/memoria del teléfono) NO aborta el lote.
      r = { error: String(e instanceof Error ? e.message : e).slice(0, 240) };
    }
    const base = archivo.replace(/\.[a-z]+$/i, "");
    const fila = {
      archivo,
      W: r.W ?? null,
      H: r.H ?? null,
      corners: r.corners ?? null,
      areaPct: r.corners ? Math.round(areaQuad(r.corners) * 1000) / 10 : null,
      msDet: r.msDet ?? null,
      msWarp: r.msWarp ?? null,
      cropW: r.cropW ?? 0,
      cropH: r.cropH ?? 0,
      refined: r.refined ?? null,
      error: r.error ?? null,
      recorte: null,
      overlay: null,
    };
    if (r.crop) {
      fila.recorte = `reales-recorte/${base}-crop.jpg`;
      guardarDataUrl(join(RESULTADOS, fila.recorte), r.crop);
    }
    if (r.overlay) {
      fila.overlay = `reales-recorte/${base}-quad.jpg`;
      guardarDataUrl(join(RESULTADOS, fila.overlay), r.overlay);
    }
    const fallos = [];
    if (fila.error) fallos.push(fila.error);
    if (fila.corners) {
      const c = fila.corners;
      if (c.some((v) => !Number.isFinite(v) || v < -0.03 || v > 1.03)) fallos.push("esquinas fuera de rango");
      if ((fila.areaPct ?? 0) < 8) fallos.push(`área del quad insuficiente (${fila.areaPct}%)`);
    }
    if (!fila.error && (fila.cropW < 200 || fila.cropH < 200)) fallos.push(`recorte diminuto (${fila.cropW}x${fila.cropH})`);
    if (fallos.length) fila.fallos = fallos;
    filas.push(fila);
    progreso(
      `${fallos.length ? "FALLA" : "ok   "} ${archivo.padEnd(24)} ` +
        `${fila.W}x${fila.H} quad=${fila.areaPct ?? "?"}% recorte=${fila.cropW}x${fila.cropH} ` +
        `det=${fila.msDet ?? "?"}ms warp=${fila.msWarp ?? "?"}ms${fila.refined === false ? " sin-refinar" : ""}` +
        (fallos.length ? ` ← ${fallos.join("; ")}` : ""),
    );
  }
} finally {
  await navegador.close();
}

const salida = join(RESULTADOS, `reales-recorte-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(salida, JSON.stringify({ cdp: CDP, medidoEn: new Date().toISOString(), filas }, null, 2));
progreso(`JSON: ${salida}`);
progreso(`capturas: ${DIR_SALIDA}`);
process.exit(filas.some((f) => f.error || f.fallos) ? 1 : 0);
