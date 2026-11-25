/**
 * verificar-reales.mjs — importa las FOTOS REALES del operador (cámara del
 * teléfono, no fixtures sintéticos) en el Chrome Android por CDP y mide
 * score/veredicto/verificación/molde por imagen.
 *
 * Las fotos se sirven desde public/dev-fixtures/reales/ (gitignored) porque
 * Chrome Android no puede leer /sdcard desde DOM.setFileInputFiles: el
 * pipeline recibe el mismo File que entregaría el picker.
 *
 * Uso:
 *   TAMIZ_ADB_SERIAL=192.168.1.4:35543 node scripts/entrega/verificar-reales.mjs
 *     [--cdp http://127.0.0.1:9223] [--solo 20261123] [--limite 5]
 *
 * Salida: tabla por consola + JSON en scripts/resultados/reales-<ts>.json y
 * capturas real-<n>-<archivo>.png. Exit 1 si alguna fila no lee ≥70 %.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  MOLDE,
  RESULTADOS,
  RAIZ,
  VEREDICTOS,
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
} from "./a56-comun.mjs";

const argCdp = process.argv.indexOf("--cdp");
const CDP = argCdp > -1 ? process.argv[argCdp + 1] : "http://127.0.0.1:9223";
const argSolo = process.argv.indexOf("--solo");
const SOLO = argSolo > -1 ? process.argv[argSolo + 1] : null;
const argLimite = process.argv.indexOf("--limite");
const LIMITE = argLimite > -1 ? Number(process.argv[argLimite + 1]) : Infinity;

const DIR_REALES = join(RAIZ, "apps", "tamiz", "public", "dev-fixtures", "reales");
const TODAS = readdirSync(DIR_REALES)
  .filter((f) => /\.(jpe?g|png)$/i.test(f))
  .filter((f) => !SOLO || f.includes(SOLO))
  .sort()
  .slice(0, LIMITE);

if (TODAS.length === 0) {
  console.error(`BLOQUEADA: no hay fotos en ${DIR_REALES}`);
  process.exit(1);
}

const progreso = crearProgreso("reales-progreso.log");
const { navegador, pagina, sesion } = await conectarA56(CDP);

pagina.on("console", (m) => {
  const t = m.text();
  if (/\[e14\]|\[molde\]|error|falló|fail/i.test(t)) progreso(`[console] ${t.slice(0, 300)}`);
});
pagina.on("pageerror", (e) => progreso(`[pageerror] ${String(e).slice(0, 300)}`));

const filas = [];
let indice = 0;

try {
  progreso(`reales inicio · CDP=${CDP} · ${TODAS.length} fotos · ${new Date().toISOString()}`);
  await sembrarMolde(pagina, readFileSync(MOLDE, "utf-8"));
  await limpiarPwa(pagina, sesion);
  await desarmarAutoCaptura(pagina);
  capturaDispositivo("reales-00-inicio.png");

  for (const archivo of TODAS) {
    await prepararImporte(pagina);
    await seleccionarArchivo(pagina, `reales/${archivo}`);

    // Si persistiera el veredicto anterior, la importación no arrancó.
    const tSalida = Date.now();
    let salio = false;
    while (Date.now() - tSalida < 25000) {
      const t = await pagina.locator("body").innerText().catch(() => "");
      if (!VEREDICTOS.test(t)) {
        salio = true;
        break;
      }
      await pagina.waitForTimeout(1000);
    }
    if (!salio) {
      filas.push({ archivo, error: "la importación no arrancó (veredicto previo persiste)" });
      progreso(`FALLA ${archivo.padEnd(28)} la importación no arrancó`);
      capturaDispositivo(`real-${++indice}-error.png`);
      continue;
    }

    const t0 = Date.now();
    let texto = (await esperarVeredicto(pagina, 300000)) ?? "";
    let listo = texto !== "";
    if (listo) {
      await pagina.waitForTimeout(2500);
      texto = (await pagina.locator("body").innerText().catch(() => texto)).replace(/\n{2,}/g, "\n");
    }
    if (!listo) {
      filas.push({ archivo, error: "sin veredicto en 300 s" });
      progreso(`FALLA ${archivo.padEnd(28)} sin veredicto en 300 s`);
      capturaDispositivo(`real-${++indice}-error.png`);
      continue;
    }

    const fila = {
      archivo,
      segundos: Math.round((Date.now() - t0) / 1000),
      score: (texto.match(/\d+\.\d+\/10/) ?? [])[0] ?? null,
      veredicto: (texto.match(VEREDICTOS) ?? [])[0] ?? null,
      banner: (texto.match(/RECIBO DE PAGO|NO IDENTIFICADO/i) ?? [])[0] ?? null,
      verificacion: (texto.match(/\d+% (?:OK|ALERTA|RECHAZADO)/) ?? [])[0] ?? null,
      molde: (texto.match(/MOLDE:[^\n]{0,60}/) ?? [])[0] ?? null,
      detalle: texto.split("\n").slice(0, 40).join("\n"),
    };
    fila.captura = capturaDispositivo(`real-${String(++indice).padStart(2, "0")}-${archivo.replace(/\.[a-z]+$/i, "")}.png`);

    const pct = Number((fila.verificacion ?? "0").split("%")[0]);
    const fallos = [];
    if (!fila.score || Number(fila.score.split("/")[0]) === 0) fallos.push("score 0");
    if (pct < 70) fallos.push(`lectura insuficiente (${fila.verificacion ?? "sin dato"})`);
    if (fallos.length) fila.fallos = fallos;
    filas.push(fila);
    progreso(
      `${fallos.length ? "FALLA" : "ok   "} ${archivo.padEnd(28)} ${fila.score ?? "?"} ` +
        `${fila.veredicto ?? "?"} · ${fila.verificacion ?? "?"} · ${fila.molde ?? "-"} · ${fila.segundos}s` +
        (fallos.length ? ` ← ${fallos.join("; ")}` : ""),
    );
  }
} finally {
  await navegador.close();
}

mkdirSync(RESULTADOS, { recursive: true });
const salida = join(RESULTADOS, `reales-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(salida, JSON.stringify({ cdp: CDP, medidoEn: new Date().toISOString(), filas }, null, 2));
progreso(`JSON: ${salida}`);
process.exit(filas.some((f) => f.error || f.fallos) ? 1 : 0);
