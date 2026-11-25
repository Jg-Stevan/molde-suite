/**
 * diag-velocidad-a56.mjs — apaga TEMPORALMENTE procesos caros (kill-switches
 * de localStorage `tamiz.flags.v1`) y mide el tiempo hasta el veredicto en el
 * A56 real, para comparar contra la línea base del banco (30–56 s por
 * fixture, con el OCR del molde incluido).
 *
 * Uso: node scripts/entrega/diag-velocidad-a56.mjs [--fixture rotada-12.png]
 *      [--flags '{"evaluacionMolde":false}']
 * Restaurar: borrar la clave (localStorage.removeItem('tamiz.flags.v1')) y
 * recargar — los DEFAULTS vuelven solos (flags.ts).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  MOLDE,
  RESULTADOS,
  VEREDICTOS,
  capturaDispositivo,
  conectarA56,
  crearProgreso,
  cuerpo,
  desarmarAutoCaptura,
  limpiarPwa,
  prepararImporte,
  seleccionarArchivo,
  sembrarMolde,
} from "./a56-comun.mjs";

const argCdp = process.argv.indexOf("--cdp");
const CDP = argCdp > -1 ? process.argv[argCdp + 1] : "http://127.0.0.1:9223";
const argFixture = process.argv.indexOf("--fixture");
const FIXTURE = argFixture > -1 ? process.argv[argFixture + 1] : "rotada-12.png";
const argFlags = process.argv.indexOf("--flags");
const FLAGS = argFlags > -1 ? process.argv[argFlags + 1] : '{"evaluacionMolde":false}';

const progreso = crearProgreso("a56-velocidad.log");
const { navegador, pagina, sesion } = await conectarA56(CDP);

try {
  progreso(`A56 velocidad inicio · flags=${FLAGS} · fixture=${FIXTURE} · ${new Date().toISOString()}`);
  await sembrarMolde(pagina, readFileSync(MOLDE, "utf-8"));
  await pagina.evaluate((f) => {
    localStorage.setItem("tamiz.flags.v1", f);
  }, FLAGS);
  await limpiarPwa(pagina, sesion);
  const flagsVivos = await pagina.evaluate(() => localStorage.getItem("tamiz.flags.v1"));
  progreso(`flags aplicados en el teléfono: ${flagsVivos}`);
  await desarmarAutoCaptura(pagina);

  await prepararImporte(pagina);
  const t0 = Date.now();
  await seleccionarArchivo(pagina, FIXTURE);
  let acta = null;
  while (Date.now() - t0 < 300000) {
    await pagina.waitForTimeout(1000);
    const t = await cuerpo(pagina);
    if (VEREDICTOS.test(t)) {
      acta = t;
      break;
    }
  }
  const segundos = Math.round((Date.now() - t0) / 1000);
  const captura = capturaDispositivo("a56-velocidad-veredicto.png");
  progreso(`${acta ? "ok   " : "FALLA"} veredicto en ${segundos}s ← ${acta?.match(VEREDICTOS)?.[0] ?? "sin veredicto"}`);

  mkdirSync(RESULTADOS, { recursive: true });
  const salida = join(RESULTADOS, `a56-velocidad-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(
    salida,
    JSON.stringify(
      { cdp: CDP, flags: FLAGS, fixture: FIXTURE, segundos, veredicto: acta?.match(VEREDICTOS)?.[0] ?? null, captura, medidoEn: new Date().toISOString() },
      null,
      2,
    ),
  );
  progreso(`JSON: ${salida}`);
  process.exit(acta ? 0 : 1);
} finally {
  await navegador.close();
}
