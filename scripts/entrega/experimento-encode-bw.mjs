/**
 * experimento-encode-bw.mjs — Fase 3: costo REAL del encode PNG sobre la salida
 * bw limpia del worker (no una binarización ruidosa de la foto). Ejecuta
 * detect→warp→enhance bw en un worker, toma el blob PNG resultante, lo decodifica
 * a un OffscreenCanvas y mide getImageData / convertToBlob png / webp sobre ESE
 * contenido exacto. Aísla cuánto del enhance bw es codificador vs filtro.
 * Solo medición; no toca la app ni el asset.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { conectarA56, RESULTADOS, crearProgreso } from "./a56-comun.mjs";

const progreso = crearProgreso("encode-bw-progreso.log");
const FOTO = process.argv[2] ?? "20261123_201944.jpg";
const { navegador, pagina } = await conectarA56();
try {
  await pagina.goto("http://localhost:3100/", { waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => undefined);
  await pagina.evaluate(() => {
    document.querySelectorAll("video").forEach((v) => v.srcObject?.getTracks?.().forEach((t) => t.stop()));
  }).catch(() => undefined);

  const r = await pagina.evaluate(async (foto) => {
    const w = new Worker("/scanner/detection-worker.js?enc=1");
    await new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error("ready timeout")), 45000);
      const h = (e) => { if (e.data?.type === "ready") { clearTimeout(to); w.removeEventListener("message", h); res(); } };
      w.addEventListener("message", h);
    });
    let seq = 0;
    const enviar = (msg, tr) => new Promise((res, rej) => {
      const ts = ++seq;
      const to = setTimeout(() => rej(new Error("timeout " + msg.type)), 90000);
      const h = (e) => { if (e.data?.ts === ts) { clearTimeout(to); w.removeEventListener("message", h); res(e.data); } };
      w.addEventListener("message", h);
      w.postMessage({ ...msg, ts }, tr || []);
    });
    const resp = await fetch(`/dev-fixtures/reales/${foto}`);
    const img = await createImageBitmap(await resp.blob());
    const s = 400 / Math.max(img.width, img.height);
    const small = await createImageBitmap(img, { resizeWidth: Math.round(img.width * s), resizeHeight: Math.round(img.height * s), resizeQuality: "low" });
    const det = await enviar({ type: "detect", bitmap: small }, [small]);
    const corners = Array.from(det.corners);
    const wr = await enviar({ type: "warp", bitmap: img, quad: new Float32Array(corners), manual: true }, [img]);
    const tEnh = performance.now();
    const enh = await enviar({ type: "enhance", bitmap: wr.bitmap, mode: "bw", maxLongSide: 4032 }, [wr.bitmap]);
    const enhanceMs = Math.round(performance.now() - tEnh);
    const bwBlob = enh.blob;
    // Re-codificar el contenido bw REAL.
    const bmp = await createImageBitmap(bwBlob);
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    const medir = async (fn) => { const t = performance.now(); const o = await fn(); return { ms: Math.round(performance.now() - t), bytes: o?.size ?? o?.byteLength ?? null }; };
    const getImageData = await medir(() => ctx.getImageData(0, 0, cv.width, cv.height));
    const png = await medir(() => cv.convertToBlob({ type: "image/png" }));
    const webp = await medir(() => cv.convertToBlob({ type: "image/webp", quality: 0.9 }));
    w.terminate();
    return { w: cv.width, h: cv.height, enhanceMs, workerMsBw: enh.elapsedMs ?? null, bwBytes: bwBlob.size, getImageData, png, webp };
  }, FOTO);
  progreso(`bw real ${r.w}x${r.h}: enhance=${r.enhanceMs}ms (worker=${Math.round(r.workerMsBw)}ms) blob=${r.bwBytes}B | re-encode getImageData=${r.getImageData.ms}ms PNG=${r.png.ms}ms (${r.png.bytes}B) WebP=${r.webp.ms}ms (${r.webp.bytes}B)`);
  const salida = join(RESULTADOS, `encode-bw-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(salida, JSON.stringify({ foto: FOTO, medidoEn: new Date().toISOString(), ...r }, null, 2));
  progreso(`JSON: ${salida}`);
} finally {
  await navegador.close().catch(() => undefined);
}