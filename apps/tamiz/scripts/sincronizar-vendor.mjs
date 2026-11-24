/**
 * sincronizar-vendor.mjs — materializa en `public/` los binarios que ya vienen
 * dentro de los paquetes npm (núcleos y worker de Tesseract).
 *
 * El vendor se genera, no se versiona: copiar `node_modules/` al repo pesa
 * megas en cada clon y además el `.wasm` viejo servido con la librería nueva
 * rompe en runtime del OCR, no en el build.
 *
 * Lo que no está en npm (OpenCV, traineddata) lo baja `preparar-assets.mjs`.
 *
 * Uso: bun scripts/sincronizar-vendor.mjs
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf-8"));

// Los `.wasm` crudos de tesseract.js-core NO se copian: el worker solo importa
// los `.wasm.js` (wasm embebido en base64).
const COPIAS = [
  { paquete: "tesseract.js", origen: "dist/worker.min.js", destino: "public/vendor/tesseract/worker.min.js" },
];

// Las variantes de núcleo que el OCR puede pedir: la lib NO elige solo
// simd/no-simd — en un A56 (Chrome/ARM con relaxed-simd) arranca por
// `tesseract-core-relaxedsimd-lstm.wasm.js`. Se copia TODO el set `-lstm` que
// publica el paquete (derive del directorio, no de una lista fija: si npm
// añade una variante, el vendor la recibe sola y el importScripts no 404).
function nucleosLstm(dirCore) {
  return readdirSync(dirCore)
    .filter((f) => /^tesseract-core-.*-lstm\.wasm\.js$/.test(f))
    .map((f) => ({ paquete: "tesseract.js-core", origen: f, destino: `public/vendor/tesseract/${f}` }));
}

const OBSOLETOS = [
  "public/vendor/tesseract/tesseract-core-lstm.wasm",
  "public/vendor/tesseract/tesseract-core-simd-lstm.wasm",
  "public/vendor/tesseract/tesseract-core-relaxedsimd-lstm.wasm",
];

// Con bun workspaces el paquete puede vivir hoisted o aislado en
// node_modules/.bun/<pkg>@<ver>/node_modules/<pkg>; la raíz del monorepo es
// apps/tamiz/../.. — se prueban ambas.
function dirDe(paquete) {
  const raices = [RAIZ, join(RAIZ, "..", "..")];
  for (const raiz of raices) {
    const clasico = join(raiz, "node_modules", paquete);
    if (existsSync(clasico)) return clasico;
  }
  for (const raiz of raices) {
    try {
      const bunDir = join(raiz, "node_modules", ".bun");
      for (const entrada of readdirSync(bunDir)) {
        if (entrada.startsWith(paquete + "@")) {
          const candidata = join(bunDir, entrada, "node_modules", paquete);
          if (existsSync(candidata)) return candidata;
        }
      }
    } catch {
      /* sin .bun — sigue */
    }
  }
  return join(RAIZ, "node_modules", paquete);
}

const nucleos = nucleosLstm(dirDe("tesseract.js-core"));
if (nucleos.length === 0) {
  console.error(
    "BLOQUEADA: tesseract.js-core no publica ningún `tesseract-core-*-lstm.wasm.js` — " +
      "cambió la distribución del paquete; revisa qué variante importa el worker.",
  );
  process.exit(1);
}
COPIAS.push(...nucleos);

for (const paquete of new Set(COPIAS.map((c) => c.paquete))) {
  const dir = dirDe(paquete);
  if (!existsSync(dir)) {
    console.error(`BLOQUEADA: no hay ${paquete} instalado (ni hoisted ni aislado) — corre \`bun install\` primero.`);
    process.exit(1);
  }
  // Un pin exacto en package.json es un contrato: si el árbol instalado no lo
  // cumple, el binario servido no es el que se probó.
  const declarada = pkg.dependencies?.[paquete] ?? pkg.devDependencies?.[paquete];
  const instalada = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")).version;
  if (declarada && /^\d/.test(declarada) && declarada !== instalada) {
    console.error(
      `BLOQUEADA: ${paquete} instalado ${instalada} ≠ declarado ${declarada} en package.json — ` +
        "hace falta `bun install` con el lockfile del repo.",
    );
    process.exit(1);
  }
}

let copiados = 0;
let omitidos = 0;
for (const { paquete, origen, destino } of COPIAS) {
  const src = join(dirDe(paquete), origen);
  if (!existsSync(src)) {
    console.error(
      `BLOQUEADA: ${origen} no está en ${paquete} — la distribución del paquete cambió; ` +
        "revisa qué variante necesita ahora el pipeline antes de desplegar.",
    );
    process.exit(1);
  }
  const dst = join(RAIZ, destino);
  if (existsSync(dst) && statSync(dst).size === statSync(src).size) {
    omitidos++;
    continue;
  }
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  copiados++;
}

let borrados = 0;
for (const ruta of OBSOLETOS) {
  const dst = join(RAIZ, ruta);
  if (existsSync(dst)) {
    rmSync(dst);
    borrados++;
  }
}

const versiones = [...new Set(COPIAS.map((c) => c.paquete))]
  .map((n) => `${n}@${JSON.parse(readFileSync(join(dirDe(n), "package.json"), "utf-8")).version}`)
  .join(" · ");
const totalMB = (COPIAS.reduce((acc, { destino }) => acc + statSync(join(RAIZ, destino)).size, 0) / 1048576).toFixed(1);
console.log(
  `OK vendor npm (${versiones}) · ${COPIAS.length} archivos · ${totalMB} MB ` +
    `(${copiados} copiados, ${omitidos} ya estaban${borrados ? `, ${borrados} obsoletos borrados` : ""})`,
);
