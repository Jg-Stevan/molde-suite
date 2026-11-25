/**
 * experimento-encode.mjs — Fase 3 (punto 5 del owner): aislar el costo del
 * codificador PNG (libpng, nativo del navegador, invisible al profiler del
 * worker) frente al filtro y al tamaño. Sobre la MISMA imagen real decodificada
 * y dibujada en un OffscreenCanvas, mide getImageData / convertToBlob png /
 * webp / jpeg en 4032 / 3000 / 2400 px de lado mayor. 2 repeticiones, mediana.
 *
 * Solo medición: no toca la app ni detection-worker.js. El producto sigue PNG.
 * Uso: TAMIZ_ADB_SERIAL=... node scripts/entrega/experimento-encode.mjs
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { conectarA56, RESULTADOS, crearProgreso } from "./a56-comun.mjs";

const progreso = crearProgreso("encode-progreso.log");
const FOTO = process.argv[2] ?? "20261123_201944.jpg";
const LADOS = [4032, 3000, 2400];
const REPS = 2;

const { navegador, pagina } = await conectarA56();
const resultados = [];
try {
  await pagina.goto("http://localhost:3100/", { waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => undefined);
  await pagina.evaluate(() => {
    document.querySelectorAll("video").forEach((v) => v.srcObject?.getTracks?.().forEach((t) => t.stop()));
  }).catch(() => undefined);

  for (const lado of LADOS) {
    const r = await pagina.evaluate(async ({ foto, lado, reps }) => {
      const resp = await fetch(`/dev-fixtures/reales/${foto}`);
      const blob = await resp.blob();
      const img = await createImageBitmap(blob);
      const s = lado / Math.max(img.width, img.height);
      const w = Math.round(img.width * s);
      const h = Math.round(img.height * s);
      const cv = new OffscreenCanvas(w, h);
      const ctx = cv.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      img.close();
      // Binarizar (luma > 128) para imitar la salida bw del worker: el encode
      // PNG de una imagen binaria (baja entropía) es el caso real del producto.
      const id0 = ctx.getImageData(0, 0, w, h);
      const d0 = id0.data;
      for (let i = 0; i < d0.length; i += 4) {
        const g = d0[i] * 0.299 + d0[i + 1] * 0.587 + d0[i + 2] * 0.114;
        const v = g > 128 ? 255 : 0;
        d0[i] = d0[i + 1] = d0[i + 2] = v;
        d0[i + 3] = 255;
      }
      ctx.putImageData(id0, 0, 0);
      const medir = async (fn) => {
        const t = performance.now();
        const out = await fn();
        return { ms: Math.round(performance.now() - t), bytes: out?.size ?? out?.byteLength ?? null };
      };
      const corridas = [];
      for (let i = 0; i < reps; i++) {
        const getImageData = await medir(() => ctx.getImageData(0, 0, w, h));
        const png = await medir(() => cv.convertToBlob({ type: "image/png" }));
        const webp = await medir(() => cv.convertToBlob({ type: "image/webp", quality: 0.9 }));
        const jpeg = await medir(() => cv.convertToBlob({ type: "image/jpeg", quality: 0.9 }));
        corridas.push({ getImageData, png, webp, jpeg });
      }
      const med = (k) => {
        const v = corridas.map((c) => c[k].ms).sort((a, b) => a - b);
        return v[Math.floor(v.length / 2)];
      };
      return {
        w, h,
        getImageDataMs: med("getImageData"),
        pngMs: med("png"), pngBytes: corridas[0].png.bytes,
        webpMs: med("webp"), webpBytes: corridas[0].webp.bytes,
        jpegMs: med("jpeg"), jpegBytes: corridas[0].jpeg.bytes,
        corridas,
      };
    }, { foto: FOTO, lado, reps: REPS });
    resultados.push({ lado, ...r });
    progreso(`lado=${lado} (${r.w}x${r.h}) getImageData=${r.getImageDataMs}ms PNG=${r.pngMs}ms (${r.pngBytes}B) WebP=${r.webpMs}ms (${r.webpBytes}B) JPEG=${r.jpegMs}ms (${r.jpegBytes}B)`);
  }
  const salida = join(RESULTADOS, `encode-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(salida, JSON.stringify({ foto: FOTO, reps: REPS, medidoEn: new Date().toISOString(), lados: resultados }, null, 2));
  progreso(`JSON: ${salida}`);
} finally {
  await navegador.close().catch(() => undefined);
}