/**
 * diag-deteccion-a56.mjs — diagnóstico PUNTUAL de la DETECCIÓN en vivo
 * (plan primera ola, Fase 1+2): qué lente se abrió, si el bucle del core
 * está produciendo frames con quad y si el overlay tiene datos.
 *
 * Uso (con los túneles ya hechos: adb reverse tcp:3100 · forward tcp:9223):
 *   node scripts/entrega/diag-deteccion-a56.mjs
 *
 * Salida: consola + scripts/resultados/a56-deteccion-viva.png (adb screencap).
 * NO cierra el Chrome del teléfono.
 */
import { conectarA56, capturaDispositivo, tocar, crearProgreso } from "./a56-comun.mjs";

const progreso = crearProgreso("a56-deteccion.log");
const { pagina, sesion } = await conectarA56();

try {
  progreso("diag detección · goto raíz");
  await pagina.goto("http://localhost:3100/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await pagina.waitForTimeout(3500);

  // Asegura el modo CÁMARA (el botón del selector segmented).
  const camBtn = pagina.locator("button", { hasText: "CÁMARA" }).first();
  if (await camBtn.count()) {
    const via = await tocar(pagina, sesion, camBtn, "CÁMARA", progreso).catch(() => "no-tocado");
    progreso(`botón CÁMARA: ${via}`);
  } else {
    progreso("botón CÁMARA no encontrado (¿ya en cámara?)");
  }

  // Espera la telemetría de la lente (sondas secuenciales pueden tardar).
  let choice = null;
  for (let i = 0; i < 12 && !choice; i++) {
    await pagina.waitForTimeout(1500);
    choice = await pagina.evaluate(() => window.__cameraChoice ?? null);
  }
  progreso(`__cameraChoice: ${JSON.stringify(choice)}`);

  // Bucle de frames: muestras cada 2.5 s (fps/processed/dropped/quad).
  for (let i = 1; i <= 6; i++) {
    await pagina.waitForTimeout(2500);
    const fl = await pagina.evaluate(() => window.__frameLoop ?? null);
    progreso(`__frameLoop +${i * 2.5}s: ${JSON.stringify(fl)}`);
  }

  const estado = await pagina.evaluate(() => {
    const video = document.querySelector("video");
    const marca = document.querySelector('[data-testid="quad-overlay"], svg polygon, svg path');
    return {
      video: video
        ? {
            w: video.videoWidth,
            h: video.videoHeight,
            readyState: video.readyState,
            conStream: Boolean(video.srcObject),
            label: video.srcObject?.getVideoTracks?.()[0]?.label ?? null,
          }
        : null,
      overlay: Boolean(marca),
      texto: (document.body.innerText || "").slice(0, 400),
    };
  });
  progreso(`estado: ${JSON.stringify(estado)}`);
  capturaDispositivo("a56-deteccion-viva.png");
  progreso("captura: a56-deteccion-viva.png");
} catch (e) {
  progreso(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
}
process.exit(0);
