/**
 * diag-warp-a56.mjs — verifica en el A56 REAL que la detección de la FOTO usa
 * el detector OpenCV del visor en vivo (no la heurística Sobel axis-aligned):
 * importa un fixture con el papel DENTRO del encuadre sobre mesa oscura
 * (`recibo-en-mesa.png`, rotado 9° — `--fixture` para cambiar), abre el
 * editor, toca «Detectar automáticamente los bordes del documento» y
 * comprueba que el polígono del quad deja de ser el marco completo y queda
 * ROTADO (esquinas fuera de 0/100, inferiores desplazadas en x).
 * Evidencia: capturas adb + JSON en scripts/resultados.
 *
 * Uso: node scripts/entrega/diag-warp-a56.mjs [--cdp http://127.0.0.1:9223]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  MOLDE,
  RESULTADOS,
  capturaDispositivo,
  conectarA56,
  crearProgreso,
  cuerpo,
  desarmarAutoCaptura,
  esperarVeredicto,
  limpiarPwa,
  prepararImporte,
  seleccionarArchivo,
  sembrarMolde,
  tocar,
} from "./a56-comun.mjs";

const argCdp = process.argv.indexOf("--cdp");
const CDP = argCdp > -1 ? process.argv[argCdp + 1] : "http://127.0.0.1:9223";
const argFixture = process.argv.indexOf("--fixture");
const FIXTURE = argFixture > -1 ? process.argv[argFixture + 1] : "recibo-en-mesa.png";
const progreso = crearProgreso("a56-warp.log");

const puntosDeQuad = (pagina) =>
  pagina.evaluate(() => {
    const p = document.querySelector(
      '[role="dialog"][aria-label="Ajuste de bordes del documento"] svg polygon',
    );
    return p?.getAttribute("points") ?? null;
  });

const esMarcoCompleto = (pts) =>
  !pts || /^0(\.0+)?,0(\.0+)? 100(\.0+)?,0(\.0+)? 100(\.0+)?,100(\.0+)? 0(\.0+)?,100(\.0+)?$/.test(pts);

/** El papel del fixture va rotado: un quad real lo refleja (el vértice
 *  inferior izquierdo NO comparte x con el superior izquierdo). */
const cuadroRotado = (pts) => {
  const pares = (pts ?? "").trim().split(/\s+/).map((p) => p.split(",").map(Number));
  if (pares.length !== 4) return false;
  return Math.abs(pares[0][0] - pares[3][0]) > 1.5 || Math.abs(pares[1][0] - pares[2][0]) > 1.5;
};

const { navegador, pagina, sesion } = await conectarA56(CDP);
const pasos = [];
const paso = (nombre, ok, extra = {}) => {
  pasos.push({ paso: nombre, ok, ...extra });
  progreso(`${ok ? "ok   " : "FALLA"} ${nombre}${extra.nota ? ` ← ${extra.nota}` : ""}`);
};

try {
  progreso(`A56 warp-detección inicio · CDP=${CDP} · ${new Date().toISOString()}`);
  await sembrarMolde(pagina, readFileSync(MOLDE, "utf-8"));
  await limpiarPwa(pagina, sesion);
  await desarmarAutoCaptura(pagina);

  const worker = await pagina.evaluate(() => window.__scannerPrecision?.() ?? null);
  paso("worker OpenCV del visor listo", Boolean(worker?.ready), { worker });

  await prepararImporte(pagina);
  await seleccionarArchivo(pagina, FIXTURE);
  const acta = await esperarVeredicto(pagina);
  paso(`importación ${FIXTURE} con veredicto`, acta != null, {
    veredicto: acta?.match(/ÓPTIMA|ADVERTENCIA|RECHAZADA|REVISIÓN HUMANA/)?.[0] ?? null,
  });
  await pagina.waitForTimeout(2500);

  const recortar = pagina.getByRole("button", { name: /Recortar/i }).first();
  await tocar(pagina, sesion, recortar, "Recortar", progreso);
  const dialogo = pagina.getByRole("dialog", { name: /Ajuste de bordes del documento/i });
  await dialogo.waitFor({ state: "visible", timeout: 20000 });
  await pagina.waitForTimeout(1200);
  const antes = await puntosDeQuad(pagina);
  const capturaAntes = capturaDispositivo("a56-warp-01-editor-quad-inicial.png");

  const detectar = dialogo.getByRole("button", {
    name: /Detectar automáticamente los bordes del documento/i,
  });
  const t0 = Date.now();
  await tocar(pagina, sesion, detectar, "DETECTAR (OpenCV)", progreso);

  let despues = antes;
  let ms = 0;
  for (let i = 0; i < 12; i++) {
    await pagina.waitForTimeout(500);
    despues = await puntosDeQuad(pagina);
    if (despues !== antes) {
      ms = Date.now() - t0;
      break;
    }
  }
  const capturaDespues = capturaDispositivo("a56-warp-02-editor-quad-detectado.png");
  const quadReal = despues !== antes && !esMarcoCompleto(despues) && cuadroRotado(despues);
  paso("detección OpenCV devuelve quad real ROTADO (no marco completo)", quadReal, {
    antes,
    despues,
    ms,
    captura: capturaDespues,
    nota: quadReal ? "" : "quad sin cambio real — revisar detector/worker",
  });
} finally {
  await navegador.close();
}

mkdirSync(RESULTADOS, { recursive: true });
const salida = join(RESULTADOS, `a56-warp-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(salida, JSON.stringify({ cdp: CDP, medidoEn: new Date().toISOString(), pasos }, null, 2));
progreso(`JSON: ${salida}`);
process.exit(pasos.every((p) => p.ok) ? 0 : 1);
