/**
 * preparar-assets.mjs — materializa en `public/` los binarios que NO vienen en npm.
 *
 * Cada entrada de `scripts/assets.lock.json` fija URL y SHA-256: si el origen
 * devuelve otro contenido el build PARA. Se sirve siempre el archivo probado,
 * nunca un modelo "parecido".
 *
 * Uso: bun scripts/preparar-assets.mjs   (lo invoca `preparar` desde predev/prebuild)
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFIESTO = join(RAIZ, "scripts", "assets.lock.json");
const INTENTOS = 3;

const { archivos } = JSON.parse(readFileSync(MANIFIESTO, "utf-8"));

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function descargar({ destino, url, sha256: esperado }) {
  const dst = join(RAIZ, destino);
  const tmp = `${dst}.tmp`;
  let ultimoError;

  for (let intento = 1; intento <= INTENTOS; intento++) {
    try {
      const res = await fetch(url, { redirect: "follow", headers: { "user-agent": "tamiz-preparar-assets" } });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const actual = sha256(bytes);
      if (actual !== esperado) {
        // No reintentar: el origen es otro archivo, no un corte de red.
        throw Object.assign(
          new Error(
            `SHA-256 ${actual} ≠ ${esperado} (${bytes.length} bytes) — el origen cambió; ` +
              "revisa scripts/assets.lock.json antes de desplegar",
          ),
          { fatal: true },
        );
      }
      mkdirSync(dirname(dst), { recursive: true });
      writeFileSync(tmp, bytes);
      renameSync(tmp, dst);
      return bytes.length;
    } catch (error) {
      ultimoError = error;
      rmSync(tmp, { force: true });
      if (error.fatal) break;
      if (intento < INTENTOS) await new Promise((r) => setTimeout(r, 1000 * intento));
    }
  }
  throw Object.assign(new Error(`${destino}: ${ultimoError?.message ?? "sin detalle"}`), { causa: ultimoError });
}

let bajados = 0;
let cacheados = 0;
let totalBytes = 0;

for (const asset of archivos) {
  const dst = join(RAIZ, asset.destino);
  if (existsSync(dst)) {
    const actual = sha256(readFileSync(dst));
    if (actual === asset.sha256) {
      cacheados++;
      totalBytes += statSync(dst).size;
      continue;
    }
    if (!asset.url) {
      console.error(`BLOQUEADA: ${asset.destino} existe pero su SHA-256 no es el fijado y el manifiesto no tiene URL.`);
      process.exit(1);
    }
    console.warn(`AVISO: ${asset.destino} no coincide con el hash fijado — se vuelve a bajar.`);
  }

  if (!asset.url) {
    console.error(`BLOQUEADA: falta ${asset.destino} y el manifiesto no declaró de dónde bajarlo.`);
    process.exit(1);
  }

  try {
    const bytes = await descargar(asset);
    bajados++;
    totalBytes += bytes;
    console.log(`  ↓ ${asset.destino} (${(bytes / 1048576).toFixed(1)} MB) verificando… OK`);
  } catch (error) {
    console.error(`BLOQUEADA: ${error.message}`);
    process.exit(1);
  }
}

console.log(
  `OK assets externos · ${archivos.length} archivos · ${(totalBytes / 1048576).toFixed(1)} MB ` +
    `(${bajados} bajados, ${cacheados} ya estaban)`,
);
