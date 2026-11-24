/**
 * construir-workers.mjs — materializa en `public/scanner/` los workers del motor.
 *
 * Dos procedencias distintas, un solo gate:
 *  · Los 4 IIFE del paquete (`packages/scanner-core/workers/*.ts`) se COMPILAN
 *    con los scripts del propio paquete. Son artefactos de build: no van al repo.
 *  · `detection-worker.js` NO tiene fuente compilable en la suite (viene
 *    precompilado del proyecto vendorizado) — viaja como asset de
 *    `packages/scanner-core/assets/` con su md5 fijado en `assets.lock.json` y
 *    se COPIA verificado, no se reconstruye.
 *
 * Uso: bun scripts/construir-workers.mjs   (lo invoca `preparar`)
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const MONOREPO = join(RAIZ, "..", "..");
const PAQUETE = join(MONOREPO, "packages", "scanner-core");
const DESTINO = join(RAIZ, "public", "scanner");

const IIFE = [
  "build-capa0-worker.mjs",
  "build-db-postprocess-worker.mjs",
  "build-fallback-canvas-worker.mjs",
  "build-reescalar-import-worker.mjs",
];

const ARCHIVOS_IIFE = [
  "capa0-qr.worker.js",
  "db-postprocess.worker.js",
  "fallback-canvas.worker.js",
  "reescalar-import.worker.js",
];

mkdirSync(DESTINO, { recursive: true });

let construidos = 0;
for (const script of IIFE) {
  const proceso = Bun.spawnSync({
    cmd: ["bun", join(PAQUETE, "scripts", script), "--out", DESTINO],
    cwd: RAIZ,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proceso.exitCode !== 0) {
    console.error(`BLOQUEADA: ${script} falló (exit ${proceso.exitCode}).`);
    console.error(new TextDecoder().decode(proceso.stderr));
    process.exit(1);
  }
  construidos++;
}

// detection-worker: asset precompilado, verificado por md5 del lock del paquete.
const FALTA = ARCHIVOS_IIFE.filter((f) => !existsSync(join(DESTINO, f)));
if (FALTA.length) {
  console.error(`BLOQUEADA: no quedaron en public/scanner: ${FALTA.join(", ")}.`);
  process.exit(1);
}

const lock = JSON.parse(readFileSync(join(PAQUETE, "assets.lock.json"), "utf-8"));
const [asset] = lock.assets;
const NOMBRE = basename(asset.ruta);
// La CLAVE del lock es la ruta de deploy relativa al monorepo; el destino real
// es el public/scanner de la app que corre el script (así sirve a ambas apps).
const referencia = Object.entries(lock.referencias_md5_por_deploy).find(([ruta]) =>
  ruta.endsWith(`/${NOMBRE}`),
);
if (!referencia) {
  console.error(`BLOQUEADA: ${NOMBRE} no tiene md5 de deploy en assets.lock.json.`);
  process.exit(1);
}
const md5Esperado = referencia[1];
const fuente = join(PAQUETE, asset.ruta);
const desplegado = join(DESTINO, NOMBRE);
const md5 = (bytes) => createHash("md5").update(bytes).digest("hex");

if (!existsSync(fuente)) {
  console.error(`BLOQUEADA: falta ${asset.ruta} en el paquete (md5 fijado ${asset.md5}).`);
  process.exit(1);
}
const bytesFuente = readFileSync(fuente);
if (md5(bytesFuente) !== asset.md5 || bytesFuente.length !== asset.bytes) {
  console.error(
    `BLOQUEADA: ${asset.ruta} no coincide con el md5 fijado (${asset.md5}) — el asset ` +
      "precompilado cambió y no hay fuente para reconstruirlo.",
  );
  process.exit(1);
}
let copiado = false;
if (!(existsSync(desplegado) && md5(readFileSync(desplegado)) === md5Esperado)) {
  mkdirSync(dirname(desplegado), { recursive: true });
  copyFileSync(fuente, desplegado);
  copiado = true;
}

console.log(
  `OK workers · ${construidos} IIFE construidos (${ARCHIVOS_IIFE.join(", ")}) · ` +
    `detection-worker ${copiado ? "copiado" : "ya estaba"} ` +
    `(${(statSync(desplegado).size / 1024).toFixed(0)} KB, md5 ${md5Esperado.slice(0, 8)}…)`,
);
