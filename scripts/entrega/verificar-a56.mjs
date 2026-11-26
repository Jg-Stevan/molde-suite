/**
 * verificar-a56.mjs — banco de verificación E2E en el Galaxy A56 REAL.
 *
 * Conecta por CDP al Chrome del teléfono (adb forward tcp:9223
 * localabstract:chrome_devtools_remote), activa el molde versionado en
 * localStorage, limpia el service worker PWA (un CSS cacheado viejo deja
 * fondos transparentes), importa cada fixture desde /dev-fixtures/ (los PNG
 * se copian a apps/tamiz/public/dev-fixtures/ para que el dev server los
 * sirva) y mide score/veredicto/verificación sobre el dispositivo.
 *
 * Uso:
 *   adb reverse tcp:3100 tcp:3100
 *   adb forward tcp:9223 localabstract:chrome_devtools_remote
 *   node scripts/entrega/verificar-a56.mjs [--cdp http://127.0.0.1:9223] [--solo <texto>]
 *
 * Salida: tabla por consola + JSON en scripts/resultados/a56-importacion-<ts>.json
 * y capturas a56-<n>-<fixture>.png. Exit 1 si el banco no cumple.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  MOLDE,
  RESULTADOS,
  VEREDICTOS,
  capturaDispositivo,
  conectarA56,
  crearProgreso,
  desarmarAutoCaptura,
  esperarVeredicto,
  limpiarPwa,
  prepararImporte,
  seleccionarArchivo,
  sembrarMolde,
} from "./a56-comun.mjs";

const argCdp = process.argv.indexOf("--cdp");
const CDP = argCdp > -1 ? process.argv[argCdp + 1] : "http://127.0.0.1:9223";

const FIXTURES = [
  { archivo: "pag-01.png", etiqueta: "recibo_pago/pag-01 (limpia)", optimo: true },
  { archivo: "recibo-tachado.png", etiqueta: "recibo-tachado", revision: true },
  { archivo: "recibo-datos-nuevos.png", etiqueta: "recibo-datos-nuevos" },
  { archivo: "recibo-sin-firmas.png", etiqueta: "recibo-sin-firmas" },
  { archivo: "recorte-60pct-usuario.png", etiqueta: "recorte-60pct-usuario" },
  { archivo: "recorte-66pct-sin-firma.png", etiqueta: "recorte-66pct-sin-firma" },
  { archivo: "rotada-12.png", etiqueta: "rotada-12" },
];

const argSolo = process.argv.indexOf("--solo");
const SOLO = argSolo > -1 ? process.argv[argSolo + 1] : null;
const CORRER = SOLO
  ? FIXTURES.filter((f) => f.etiqueta.includes(SOLO) || f.archivo.includes(SOLO))
  : FIXTURES;

const progreso = crearProgreso("a56-progreso.log");
const { navegador, pagina, sesion } = await conectarA56(CDP);

// Trazas de diagnóstico del dispositivo → log de progreso (errores y e14/molde).
pagina.on("console", (m) => {
  const t = m.text();
  if (/\[e14\]|\[molde\]|error|falló|fail/i.test(t)) progreso(`[console] ${t.slice(0, 300)}`);
});
pagina.on("pageerror", (e) => progreso(`[pageerror] ${String(e).slice(0, 300)}`));

const filas = [];
let indice = 0;

try {
  progreso(`A56 banco inicio · CDP=${CDP} · ${new Date().toISOString()}`);
  // ── Molde versionado activo ANTES de recargar (misma clave del registry) ──
  const moldeTexto = readFileSync(MOLDE, "utf-8");
  JSON.parse(moldeTexto);
  await sembrarMolde(pagina, moldeTexto);
  await limpiarPwa(pagina, sesion);
  await desarmarAutoCaptura(pagina);
  capturaDispositivo("a56-00-inicio.png");

  for (const { archivo, etiqueta, optimo, revision } of CORRER) {
    await prepararImporte(pagina);
    await seleccionarArchivo(pagina, archivo);

    // Misma guarda del banco de escritorio: si el veredicto ANTERIOR persiste,
    // la importación no arrancó → error honesto, jamás medir otro resultado.
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
      filas.push({ fixture: etiqueta, error: "la importación no arrancó (veredicto previo persiste)" });
      progreso(`FALLA ${etiqueta.padEnd(30)} la importación no arrancó`);
      capturaDispositivo(`a56-${++indice}-error.png`);
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
      filas.push({ fixture: etiqueta, error: "sin veredicto en 300 s" });
      progreso(`FALLA ${etiqueta.padEnd(30)} sin veredicto en 300 s`);
      capturaDispositivo(`a56-${++indice}-error.png`);
      continue;
    }
    const fila = {
      fixture: etiqueta,
      segundos: Math.round((Date.now() - t0) / 1000),
      score: (texto.match(/\d+\.\d+\/10/) ?? [])[0] ?? null,
      veredicto: (texto.match(VEREDICTOS) ?? [])[0] ?? null,
      banner: (texto.match(/RECIBO DE PAGO|NO IDENTIFICADO/i) ?? [])[0] ?? null,
      verificacion: (texto.match(/\d+% (?:OK|ALERTA|RECHAZADO)/) ?? [])[0] ?? null,
      molde: (texto.match(/MOLDE:[^\n]{0,60}/) ?? [])[0] ?? null,
    };
    fila.captura = capturaDispositivo(`a56-${String(++indice).padStart(2, "0")}-${archivo.replace(/\.png$/, "")}.png`);
    filas.push(fila);

    const fallos = [];
    if (!fila.score || Number(fila.score.split("/")[0]) === 0) fallos.push("score 0 (página negra)");
    if (optimo) {
      if (fila.veredicto !== "ÓPTIMA") fallos.push("esperado ÓPTIMA");
      if (fila.verificacion !== "100% OK") fallos.push("esperado 100% OK");
      if (String(fila.banner ?? "").toUpperCase() !== "RECIBO DE PAGO") fallos.push("molde no enrutado (banner)");
    } else if (revision) {
      if (fila.veredicto !== "REVISIÓN HUMANA") fallos.push("esperado REVISIÓN HUMANA");
    } else {
      const pct = Number((fila.verificacion ?? "0").split("%")[0]);
      if (pct < 70) fallos.push(`lectura insuficiente (${fila.verificacion ?? "sin dato"})`);
    }
    if (fallos.length) fila.fallos = fallos;
    progreso(
      `${fallos.length ? "FALLA" : "ok   "} ${etiqueta.padEnd(30)} ${fila.score ?? "?"} ` +
        `${fila.veredicto ?? "?"} · ${fila.verificacion ?? "?"} · ${fila.molde ?? "-"} · ${fila.segundos}s` +
        (fallos.length ? ` ← ${fallos.join("; ")}` : ""),
    );
  }
} finally {
  await navegador.close(); // solo desconecta CDP; el Chrome del teléfono sigue
}

mkdirSync(RESULTADOS, { recursive: true });
const salida = join(RESULTADOS, `a56-importacion-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(salida, JSON.stringify({ cdp: CDP, medidoEn: new Date().toISOString(), filas }, null, 2));
progreso(`JSON: ${salida}`);
process.exit(filas.some((f) => f.error || f.fallos) ? 1 : 0);
