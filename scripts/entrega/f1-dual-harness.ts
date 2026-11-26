// @ts-nocheck
/**
 * Arnés local F1: equivalencia pixel a pixel entre el bw histórico
 * (`processImage 'bw'`) y el bw derivado del warp compartido
 * (`processImageDual`). Se bundlea con bun build a apps/tamiz/public/_f1/
 * y lo conduce f1-equivalencia-dual.mjs (Chromium de Playwright local).
 *
 * Query: ?foto=/dev-fixtures/reales-variantes/<archivo>&deskew=1
 */
import {
  processImage,
  processImageDual,
} from "../../packages/scanner-core/core/image-processor";

declare global {
  interface Window {
    __f1: Record<string, unknown>;
  }
}
window.__f1 = { estado: "iniciando" };

async function pxDe(src: string): Promise<ImageData> {
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("decode de salida falló"));
    i.src = src;
  });
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height);
}

function compara(a: ImageData, b: ImageData) {
  if (a.width !== b.width || a.height !== b.height) {
    return {
      identico: false,
      dimsDistintas: `${a.width}x${a.height} vs ${b.width}x${b.height}`,
    };
  }
  const da = a.data;
  const db = b.data;
  let diffPx = 0;
  let maxDiff = 0;
  for (let i = 0; i < da.length; i += 4) {
    const m = Math.max(
      Math.abs(da[i] - db[i]),
      Math.abs(da[i + 1] - db[i + 1]),
      Math.abs(da[i + 2] - db[i + 2]),
      Math.abs(da[i + 3] - db[i + 3]),
    );
    if (m > 0) {
      diffPx++;
      if (m > maxDiff) maxDiff = m;
    }
  }
  return {
    identico: diffPx === 0,
    w: a.width,
    h: a.height,
    totalPx: a.width * a.height,
    diffPx,
    pctDiff: +((diffPx / (a.width * a.height)) * 100).toFixed(4),
    maxDiff,
  };
}

async function dataUrlDe(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return await new Promise<string>((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result ?? ""));
    fr.onerror = () => rej(new Error("FileReader falló"));
    fr.readAsDataURL(blob);
  });
}

async function corre() {
  const q = new URLSearchParams(location.search);
  const foto = q.get("foto") ?? "";
  const deskew = q.get("deskew") === "1";
  if (!foto) throw new Error("falta ?foto=");
  const fotoUrl = await dataUrlDe(foto);
  // Mismo quad en ambos brazos: el warp del worker refina sobre él; el
  // pipeline real usa el detector, que es determinista para la misma foto.
  const quad = [
    { x: 0.02, y: 0.02 },
    { x: 0.98, y: 0.02 },
    { x: 0.98, y: 0.98 },
    { x: 0.02, y: 0.98 },
  ];
  const opts = { deskew };
  const t0 = performance.now();
  const hist = await processImage(fotoUrl, quad, "bw", 0, opts);
  const t1 = performance.now();
  const dual = await processImageDual(fotoUrl, quad, 0, opts);
  const t2 = performance.now();
  const cmpBw = compara(await pxDe(hist.processed), await pxDe(dual.bw.processed));
  const orig = await processImage(fotoUrl, quad, "original", 0, opts);
  const cmpOrig = compara(await pxDe(orig.processed), await pxDe(dual.original.processed));
  window.__f1 = {
    estado: "listo",
    resultado: {
      foto,
      deskew,
      engineHist: hist.precision?.engine ?? "local",
      refined: hist.precision?.refined ?? null,
      dims: `${hist.width}x${hist.height}`,
      msHistBw: Math.round(t1 - t0),
      msDual: Math.round(t2 - t1),
      bw: cmpBw,
      original: cmpOrig,
    },
  };
}

corre().catch((e) => {
  window.__f1 = { estado: "error", error: String(e?.stack ?? e) };
});
