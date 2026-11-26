/**
 * habilitar-a56.mjs — deja el A56 listo para probar la app A MANO (sin banco):
 * espera el USB, adb reverse :3100, forward del socket CDP, despierta Chrome,
 * limpia el service worker (bundle fresco con los últimos fixes), quita los
 * flags de experimentos (defaults de producción: F4+F3 ON, F2/F1 OFF) y
 * verifica que el paso de importación está en pantalla.
 *
 * Uso: node scripts/entrega/habilitar-a56.mjs [--espera 240]
 */
import { execFileSync } from "node:child_process";
import { ADB, conectarA56, limpiarPwa, serialAdb } from "./a56-comun.mjs";

const argDe = (n) => {
  const i = process.argv.indexOf(n);
  return i > -1 ? process.argv[i + 1] : null;
};
const ESPERA = Number(argDe("--espera") ?? 240);

console.log(`[habilitar] esperando dispositivo (≤${ESPERA}s)...`);
const t0 = Date.now();
let serial = null;
while (Date.now() - t0 < ESPERA * 1000) {
  serial = serialAdb();
  if (serial) break;
  await new Promise((r) => setTimeout(r, 2000));
}
if (!serial) {
  console.error("[habilitar] BLOQUEADA: sin dispositivo adb (¿cable / depuración USB?)");
  process.exit(1);
}
console.log(`[habilitar] dispositivo ${serial}`);

const adb = (...args) => execFileSync(ADB, ["-s", serial, ...args], { encoding: "utf-8" });
adb("reverse", "tcp:3100", "tcp:3100");
adb("forward", "tcp:9223", "localabstract:chrome_devtools_remote");

const { navegador, pagina, sesion } = await conectarA56();
try {
  // El dueño prueba con los defaults de producción: fuera overrides de los
  // bancos A/B (F2/F1 siguen default-off hasta que el banco los apruebe).
  await pagina.evaluate(() => {
    localStorage.removeItem("tamiz.flags.v1");
    localStorage.setItem("e14-ayuda-vista", "1");
  });
  await limpiarPwa(pagina, sesion);
  await pagina.locator("input[type=file]").first().waitFor({ state: "attached", timeout: 60000 });
  const flags = await pagina.evaluate(() => localStorage.getItem("tamiz.flags.v1"));
  console.log(`[habilitar] flags: ${flags ?? "(sin overrides — defaults de producción)"}`);
  console.log(`[habilitar] URL en el teléfono: http://localhost:3100/`);
  console.log("[habilitar] LISTA: app abierta en el paso de importación.");
} finally {
  await navegador.close().catch(() => {});
}