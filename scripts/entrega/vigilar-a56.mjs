/**
 * vigilar-a56.mjs — vigía de prueba EN VIVO: mientras el operador captura
 * con la cámara del A56, registra cada veredicto nuevo que aparece en la
 * página y guarda captura adb + línea en scripts/resultados/a56-vivo.log.
 *
 * Uso: node scripts/entrega/vigilar-a56.mjs [--minutos 30] [--cdp URL]
 */
import { VEREDICTOS, capturaDispositivo, conectarA56, crearProgreso } from "./a56-comun.mjs";

const argMin = process.argv.indexOf("--minutos");
const MINUTOS = argMin > -1 ? Number(process.argv[argMin + 1]) : 30;
const argCdp = process.argv.indexOf("--cdp");
const CDP = argCdp > -1 ? process.argv[argCdp + 1] : "http://127.0.0.1:9223";

const progreso = crearProgreso("a56-vivo.log");
const { navegador, pagina } = await conectarA56(CDP);

let ultimo = null;
let n = 0;
const t0 = Date.now();
progreso(`vigía inicio · ${MINUTOS} min · ${pagina.url()}`);

while (Date.now() - t0 < MINUTOS * 60 * 1000) {
  await pagina.waitForTimeout(3000);
  let t;
  try {
    t = (await pagina.locator("body").innerText()).replace(/\n{2,}/g, "\n");
  } catch {
    continue;
  }
  const veredicto = t.match(VEREDICTOS)?.[0];
  if (!veredicto) continue;
  const score = t.match(/\d+\.\d+\/10/)?.[0] ?? "?";
  const verificacion = t.match(/\d+% (?:OK|ALERTA|RECHAZADO)/)?.[0] ?? "?";
  const campos = t.match(/\d+\/\d+ CAMPOS OK/)?.[0] ?? "";
  const clave = `${veredicto}|${score}|${verificacion}|${campos}`;
  if (clave === ultimo) continue;
  ultimo = clave;
  const captura = capturaDispositivo(`a56-vivo-${String(++n).padStart(2, "0")}.png`);
  progreso(`resultado #${n}: ${score} ${veredicto} · ${verificacion} ${campos} · captura=${captura}`);
}

progreso("vigía fin");
await navegador.close();
