/**
 * generar-fixture-mesa.mjs — crea `recibo-en-mesa.png`: el fixture de recibo
 * (papel completo, sin bordes visibles) compuesto sobre una mesa oscura con
 * textura y rotado ~9°. Sirve para verificar la detección de quad de la FOTO
 * (el papel queda DENTRO del encuadre con bordes claros): la heurística Sobel
 * axis-aligned del port no puede reproducir el quad rotado, el detector
 * OpenCV del visor sí.
 *
 * Salida versionada: scripts/resultados/fixtures/recibo-en-mesa.png
 * (copia servida por el dev server en apps/tamiz/public/dev-fixtures/).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, "..", "..");
const ENTRADA = join(RAIZ, "scripts", "resultados", "fixtures", "recibo-sin-firmas.png");
const SALIDA = join(RAIZ, "scripts", "resultados", "fixtures", "recibo-en-mesa.png");

const b64 = readFileSync(ENTRADA).toString("base64");
const navegador = await chromium.launch();
const pagina = await navegador.newPage();
const dataUrl = await pagina.evaluate(async (fuente) => {
  const img = new Image();
  img.src = `data:image/png;base64,${fuente}`;
  await img.decode();

  const W = 1400;
  const H = 1900;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");

  // Mesa: base oscura + manchas (PRNG determinista para que el fixture sea
  // reproducible byte a byte en cada regeneración).
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, "#33383f");
  grad.addColorStop(1, "#22262b");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  let s = 20261125;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
  for (let i = 0; i < 900; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const r = 8 + rnd() * 70;
    ctx.fillStyle = `rgba(${rnd() > 0.5 ? "255,255,255" : "0,0,0"},${0.015 + rnd() * 0.035})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Papel rotado ~9° con sombra.
  const ancho = W * 0.78;
  const alto = (img.naturalHeight / img.naturalWidth) * ancho;
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate((9 * Math.PI) / 180);
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 18;
  ctx.drawImage(img, -ancho / 2, -alto / 2, ancho, alto);
  ctx.restore();

  return c.toDataURL("image/png");
}, b64);

writeFileSync(SALIDA, Buffer.from(dataUrl.split(",")[1], "base64"));
await navegador.close();
console.log(`fixture: ${SALIDA}`);
