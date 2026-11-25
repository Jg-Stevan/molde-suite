/**
 * extraer-procesada-a56.mjs — extrae la FOTO PROCESADA (recorte) del acta que
 * está en pantalla en el A56 sin depender de la descarga de Chrome: parchea
 * URL.createObjectURL en la página para capturar el Blob que la app entrega
 * al botón «Imagen», lo lee como dataURL y lo guarda en el host. Después la
 * abre en el teléfono (Pictures + VIEW) para verla a pantalla completa.
 *
 * Uso: TAMIZ_ADB_SERIAL=<serial-a56> node scripts/entrega/extraer-procesada-a56.mjs \
 *        [--cdp http://127.0.0.1:9224] [--nombre recorte-app]
 */
import { execFileSync } from "node:child_process";
import { statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ADB, RESULTADOS, capturaDispositivo, conectarA56, crearProgreso, serialAdb, tocar } from "./a56-comun.mjs";

const argDe = (n) => {
  const i = process.argv.indexOf(n);
  return i > -1 ? process.argv[i + 1] : null;
};
const CDP = argDe("--cdp") ?? "http://127.0.0.1:9224";
const NOMBRE = argDe("--nombre") ?? "recorte-app";

const progreso = crearProgreso("a56-extraer-procesada.log");
const SERIAL = serialAdb();
if (!SERIAL) {
  console.error("fija TAMIZ_ADB_SERIAL (A56)");
  process.exit(1);
}
const adb = (args) => execFileSync(ADB, ["-s", SERIAL, ...args], { encoding: "utf-8" });

const { navegador, pagina, sesion } = await conectarA56(CDP);
let captura = null;
try {
  const texto = await pagina.locator("body").innerText().catch(() => "");
  progreso(`pantalla actual: ${(texto.match(/ÓPTIMA|ADVERTENCIA|RECHAZADA|REVISIÓN HUMANA/) ?? [])[0] ?? "?"}`);

  // Captura del Blob de la app: cualquier imagen que termine en un <a download>.
  await pagina.evaluate(() => {
    window.__procesada = null;
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (obj) => {
      try {
        if (obj instanceof Blob && (obj.type || "").startsWith("image/")) {
          const fr = new FileReader();
          fr.onload = () => {
            window.__procesada = fr.result;
          };
          fr.readAsDataURL(obj);
        }
      } catch {
        /* captura best-effort */
      }
      return orig(obj);
    };
  });

  const boton = pagina.getByRole("button", { name: /Descargar imagen en alta calidad/i }).first();
  if (!(await boton.count())) throw new Error("no hay botón Imagen en esta pantalla");
  await tocar(pagina, sesion, boton, "Imagen", progreso);

  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    await pagina.waitForTimeout(700);
    captura = await pagina.evaluate(() => window.__procesada ?? null).catch(() => null);
    if (captura) break;
  }
  capturaDispositivo(`${NOMBRE}-tras-descarga.png`);
} finally {
  await navegador.close();
}

if (!captura || !captura.startsWith("data:image/")) {
  progreso("la app no entregó ninguna imagen al botón Imagen (sin foto procesada)");
  process.exit(1);
}
const mime = captura.slice(5, captura.indexOf(";"));
const ext = mime.includes("jpeg") ? "jpg" : mime.includes("webp") ? "webp" : "png";
const destino = join(RESULTADOS, `${NOMBRE}.${ext}`);
writeFileSync(destino, Buffer.from(captura.split(",")[1], "base64"));
progreso(`foto procesada (${mime}) → ${destino} (${statSync(destino).size} bytes)`);

try {
  adb(["shell", "mkdir", "-p", "/sdcard/Pictures/Tamiz"]);
  adb(["push", destino, `/sdcard/Pictures/Tamiz/${NOMBRE}.${ext}`]);
  adb(["shell", "am", "broadcast", "-a", "android.intent.action.MEDIA_SCANNER_SCAN_FILE", "-d", `file:///sdcard/Pictures/Tamiz/${NOMBRE}.${ext}`]);
  adb(["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", `file:///sdcard/Pictures/Tamiz/${NOMBRE}.${ext}`, "-t", mime]);
  await new Promise((r) => setTimeout(r, 2500));
  const cap = capturaDispositivo(`${NOMBRE}-visor.png`);
  progreso(`visor en teléfono: ${cap ?? "sin captura"}`);
} catch (e) {
  progreso(`no se pudo abrir en el teléfono: ${String(e).slice(0, 120)}`);
}
process.exit(0);
