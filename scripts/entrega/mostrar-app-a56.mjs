/**
 * mostrar-app-a56.mjs — cómo se VE el resultado dentro de la app Tamiz en el
 * A56 real, con FOTOS REALES importadas por la UI (mismo camino del operador).
 * Siembra el molde de recibo, importa cada foto y captura la app al aparecer
 * la vista procesada y al veredicto. Registra las dimensiones naturales de la
 * imagen mostrada para distinguir RECORTE (dimensiones ≠ foto) de FOTO CRUDA.
 *
 * Uso: TAMIZ_ADB_SERIAL=<serial-a56> node scripts/entrega/mostrar-app-a56.mjs \
 *        [--fotos 20261123_201944.jpg,20261123_223112.jpg] [--cdp http://127.0.0.1:9224]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  MOLDE,
  RESULTADOS,
  VEREDICTOS,
  capturaDispositivo,
  conectarA56,
  cuerpo,
  crearProgreso,
  desarmarAutoCaptura,
  limpiarPwa,
  prepararImporte,
  seleccionarArchivo,
  sembrarMolde,
  serialAdb,
} from "./a56-comun.mjs";

const argDe = (n) => {
  const i = process.argv.indexOf(n);
  return i > -1 ? process.argv[i + 1] : null;
};
const CDP = argDe("--cdp") ?? "http://127.0.0.1:9224";
const FOTOS = (argDe("--fotos") ?? "20261123_201944.jpg,20261123_223112.jpg")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const MAX_MS = Number(argDe("--max") ?? 180000);

const progreso = crearProgreso("a56-mostrar-app.log");
if (!serialAdb()) {
  console.error("fija TAMIZ_ADB_SERIAL (A56)");
  process.exit(1);
}

const { navegador, pagina, sesion } = await conectarA56(CDP);
pagina.on("console", (m) => {
  const t = m.text();
  if (/\[e14\]|\[molde\]|error|falló|fail|ancla|score/i.test(t)) progreso(`[console] ${t.slice(0, 400)}`);
});
pagina.on("pageerror", (e) => progreso(`[pageerror] ${String(e).slice(0, 400)}`));
const filas = [];
try {
  progreso(`A56 mostrar-app (reales) · CDP=${CDP} · ${FOTOS.length} fotos · ${new Date().toISOString()}`);
  await sembrarMolde(pagina, readFileSync(MOLDE, "utf-8"));
  await limpiarPwa(pagina, sesion);
  await desarmarAutoCaptura(pagina);

  for (const foto of FOTOS) {
    let archivo = foto;
    if (!foto.includes("/")) {
      const enReales = await fetch(`http://localhost:3100/dev-fixtures/reales/${foto}`, { method: "HEAD" })
        .then((r) => r.ok)
        .catch(() => false);
      archivo = enReales ? `reales/${foto}` : foto;
    }
    const sinExt = archivo.split("/").pop().replace(/\.\w+$/, "");
    await prepararImporte(pagina);
    const t0 = Date.now();
    await seleccionarArchivo(pagina, archivo);
    progreso(`importado ${archivo} — esperando vista/veredicto…`);

    let vista = null;
    let veredicto = null;
    let imagen = null;
    const capturas = [];
    while (Date.now() - t0 < MAX_MS) {
      await pagina.waitForTimeout(1000);
      const est = await pagina
        .evaluate(() => {
          const imgs = Array.from(document.querySelectorAll("img"))
            .filter((i) => i.complete && i.naturalWidth >= 400 && i.getBoundingClientRect().width > 120)
            .map((i) => ({
              nw: i.naturalWidth,
              nh: i.naturalHeight,
              cssW: Math.round(i.getBoundingClientRect().width),
              src: i.src.slice(0, 30),
            }));
          return imgs;
        })
        .catch(() => []);
      if (est?.length) {
        imagen = est[0];
        if (!vista) {
          const nombre = `a56-app-vista-${sinExt}-${Date.now()}.png`;
          capturaDispositivo(nombre);
          capturas.push(nombre);
          vista = { ...est[0], captura: nombre };
          progreso(`vista ${archivo}: imagen ${est[0].nw}x${est[0].nh} (css ${est[0].cssW}px)`);
        }
      }
      const texto = await cuerpo(pagina);
      const m = texto.match(VEREDICTOS);
      if (m) {
        veredicto = m[0];
        await pagina.waitForTimeout(2500);
        // El visor puede montar la imagen DESPUÉS del texto del veredicto:
        // releer dimensiones para no perder la evidencia recorte-vs-cruda.
        const estFinal = await pagina
          .evaluate(() => {
            const imgs = Array.from(document.querySelectorAll("img"))
              .filter((i) => i.complete && i.naturalWidth >= 400 && i.getBoundingClientRect().width > 120)
              .map((i) => ({
                nw: i.naturalWidth,
                nh: i.naturalHeight,
                cssW: Math.round(i.getBoundingClientRect().width),
                src: i.src.slice(0, 30),
              }));
            return imgs;
          })
          .catch(() => []);
        if (estFinal?.length) imagen = estFinal[0];
        const nombre = `a56-app-veredicto-${sinExt}-${Date.now()}.png`;
        capturaDispositivo(nombre);
        capturas.push(nombre);
        break;
      }
    }
    const fila = {
      foto: archivo,
      segundos: Math.round((Date.now() - t0) / 1000),
      veredicto,
      imagenMostrada: imagen,
      vista,
      capturas,
    };
    filas.push(fila);
    progreso(
      `${veredicto ? "ok   " : "FALLA"} ${archivo} · ${veredicto ?? "sin veredicto"} · ${fila.segundos}s · ` +
        `imagen ${imagen?.nw ?? "?"}x${imagen?.nh ?? "?"} → ${capturas.join(", ")}`,
    );
  }
} finally {
  await navegador.close();
}

const salida = join(RESULTADOS, `a56-app-reales-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(salida, JSON.stringify({ fotos: filas, medidoEn: new Date().toISOString() }, null, 2));
progreso(`JSON: ${salida}`);
process.exit(0);
