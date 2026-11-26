/**
 * generar-fixture-optimo.mjs — fixture sintético de «recibo COMPLETO» para la
 * verificación de navegador del Agente A (§7 del plan de cierre): toma el
 * fixture TRACKED `recibo-sin-firmas.png` (aprobado por el dueño, 2026-11-24)
 * y dibuja DOS rúbricas sintéticas dentro de las zonas de firma del molde
 * recibo_pago 1.3.3 (anclas «Firma» izq/der en y≈0.622 → zonas x 0.100-0.440
 * y 0.528-0.869, y 0.548-0.608). Tinta ~5 % de la zona (umbral 0.02, firmado
 * esperado 0.046-0.049).
 *
 * SALIDA LOCAL (gitignore §3.3): apps/tamiz/public/dev-fixtures/recibo-completo-sintetico.png
 * El fixture base ES sintético y está versionado; las rúbricas son trazos
 * programáticos — nada de documentos de personas reales.
 */
import { writeFileSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, "..", "..");
const ENTRADA = join(RAIZ, "apps", "tamiz", "public", "dev-fixtures", "recibo-sin-firmas.png");
const SALIDA = join(RAIZ, "apps", "tamiz", "public", "dev-fixtures", "recibo-completo-sintetico.png");

const b64 = readFileSync(ENTRADA).toString("base64");
const navegador = await chromium.launch({ headless: true });
const pagina = await navegador.newPage();
const dataUrl = await pagina.evaluate(async (fuente) => {
  const img = new Image();
  img.src = `data:image/png;base64,${fuente}`;
  await img.decode();
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);

  // Rúbrica sintética determinista: trazos superpuestos con curvas Bézier.
  let s = 20261127;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
  const rubrica = (x0, x1, y0, y1, semilla) => {
    s = semilla;
    const cx = x0 + (x1 - x0) * 0.5;
    const cy = y0 + (y1 - y0) * 0.55;
    ctx.strokeStyle = "rgba(20,24,38,0.92)";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // 4 pasadas de bucle creciente (tipo «firmado») + 1 subrayado.
    for (let i = 0; i < 4; i++) {
      ctx.lineWidth = 5 - i * 0.8;
      ctx.beginPath();
      ctx.moveTo(cx - (x1 - x0) * 0.28, cy + (y1 - y0) * 0.25 * (i % 2 ? 1 : -1));
      const vueltas = 5 + i;
      for (let t = 0; t <= vueltas; t++) {
        const px = cx - (x1 - x0) * 0.3 + ((x1 - x0) * 0.6 * t) / vueltas;
        const py =
          cy + Math.sin((t / vueltas) * Math.PI * (2 + i * 0.5)) * (y1 - y0) * (0.32 - i * 0.05) + (rnd() - 0.5) * 4;
        ctx.quadraticCurveTo(px + (rnd() - 0.5) * 8, py + (rnd() - 0.5) * 8, px, py);
      }
      ctx.stroke();
    }
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx - (x1 - x0) * 0.35, y1 - (y1 - y0) * 0.08);
    ctx.quadraticCurveTo(cx, y1 + (y1 - y0) * 0.1, cx + (x1 - x0) * 0.35, y1 - (y1 - y0) * 0.05);
    ctx.stroke();
  };

  // Zonas normalizadas del molde (emisor izq / pagador der).
  rubrica(0.105 * W, 0.435 * W, 0.550 * H, 0.606 * H, 777);
  rubrica(0.533 * W, 0.864 * W, 0.550 * H, 0.606 * H, 999);

  // FECHA DE EMISIÓN + N.º DE RECIBO: valores impresos del fixture base que
  // truncan dentro de sus zonas (README banco: 9/12). Se re-dibujan LIMPIOS y
  // completos dentro de sus zonas ancladas, SIN invadir la línea vecina:
  //   fecha  — zona x 0.550-0.850, y 0.092-0.116 (tapa y 0.086-0.118)
  //   numero — zona x 0.550-0.750, y 0.117-0.141 (tapa y 0.118-0.143)
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(255,255,255,1)";
  ctx.fillRect(0.535 * W, 0.086 * H, 0.33 * W, 0.032 * H);
  ctx.fillStyle = "rgba(18,20,26,0.95)";
  ctx.font = `${Math.round(H * 0.0175)}px Arial, Helvetica, sans-serif`;
  ctx.fillText("29 de julio de 2026", 0.700 * W, 0.104 * H);
  ctx.fillStyle = "rgba(255,255,255,1)";
  ctx.fillRect(0.540 * W, 0.1185 * H, 0.26 * W, 0.0275 * H);
  ctx.fillStyle = "rgba(18,20,26,0.95)";
  ctx.font = `bold ${Math.round(H * 0.018)}px Arial, Helvetica, sans-serif`;
  ctx.fillText("REC-1028-3232", 0.66 * W, 0.1305 * H);

  return c.toDataURL("image/png");
}, b64);

const png = Buffer.from(dataUrl.split(",")[1], "base64");
writeFileSync(SALIDA, png);
await navegador.close();
console.log(`OK ${SALIDA} (${png.length} bytes)`);
