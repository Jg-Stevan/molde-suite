/**
 * preparar.mjs — materializa los assets del arnés con verificación SHA-256
 * (lección ppocr-keys-404: TODO peso que el motor fetch()ea debe estar
 * declarado con URL+SHA-256 antes de la primera corrida) y compila el bundle.
 *
 * Uso: bun preparar.mjs [--no-build]
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const RAIZ = resolve(import.meta.dir, "../../..");
const BENCH = join(RAIZ, "public/_bench");

// ── Lock de assets del arnés (URL+SHA-256 verificados en D0/D1) ─────────────
// fast + rapidocr provienen de apps/tamiz/scripts/assets.lock.json (mismos
// hashes probados del repo). best: naptha/tessdata mismo commit 806cd9a,
// sabor 4.0.0_best — SHA-256 medido en la descarga inicial (2026-11-27).
const LOCK = [
  {
    destino: "models/tess/4.0.0_fast/spa.traineddata.gz",
    sha256: "8db1167a8c9bb015ac8e97278384c3b07dfa9bc8271569beea071d9e296b4487",
    origen: "apps/tamiz/scripts/assets.lock.json (naptha/tessdata 806cd9a 4.0.0_fast)",
  },
  {
    destino: "models/tess/4.0.0_best/spa.traineddata.gz",
    sha256: "724c20ba45cff66937906a89c74f1a4ef6ac2d10d233f2387fd81c9a8421526a",
    origen: "naptha/tessdata 806cd9a 4.0.0_best (descarga 2026-11-27)",
  },
  {
    destino: "models/rapidocr/ch_PP-OCRv4_det_infer.onnx",
    sha256: "d2a7720d45a54257208b1e13e36a8479894cb74155a5efe29462512d42f49da9",
    origen: "apps/tamiz/scripts/assets.lock.json (SWHL/RapidOCR 1cfba2e)",
  },
  {
    destino: "models/rapidocr/ch_PP-OCRv4_rec_infer.onnx",
    sha256: "48fc40f24f6d2a207a2b1091d3437eb3cc3eb6b676dc3ef9c37384005483683b",
    origen: "apps/tamiz/scripts/assets.lock.json (SWHL/RapidOCR 1cfba2e)",
  },
  {
    destino: "models/rapidocr/ch_ppocr_mobile_v2.0_cls_infer.onnx",
    sha256: "e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c",
    origen: "apps/tamiz/scripts/assets.lock.json (SWHL/RapidOCR 1cfba2e)",
  },
  {
    destino: "models/rapidocr/ppocr_keys.txt",
    sha256: "a1c84d9bdb9ab29043c58896224d32941783eb821629618416dcb08f12886492",
    origen: "apps/tamiz/scripts/assets.lock.json (PaddleOCR main ppocr_keys_v1)",
  },
  {
    destino: "vendor/onnxruntime/ort-wasm-simd-threaded.wasm",
    sha256: null,
    origen: "node_modules/onnxruntime-web@1.31.1 dist (npm inmutable)",
  },
  {
    destino: "vendor/onnxruntime/ort-wasm-simd-threaded.mjs",
    sha256: null,
    origen: "node_modules/onnxruntime-web@1.31.1 dist (npm inmutable)",
  },
  {
    destino: "vendor/tesseract/worker.min.js",
    sha256: null,
    origen: "apps/molde-studio/public/tesseract (comiteado)",
  },
  {
    destino: "vendor/tesseract/tesseract-core-simd-lstm.wasm.js",
    sha256: null,
    origen: "apps/molde-studio/public/tesseract (comiteado)",
  },
  {
    destino: "vendor/tesseract/tesseract-core-lstm.wasm.js",
    sha256: null,
    origen: "apps/molde-studio/public/tesseract (comiteado)",
  },
];

function sha256Archivo(ruta) {
  return createHash("sha256").update(readFileSync(ruta)).digest("hex");
}

let errores = 0;
let ok = 0;
for (const item of LOCK) {
  const destino = join(BENCH, item.destino);
  if (!existsSync(destino)) {
    console.error(`FALTA  ${item.destino}  (${item.origen})`);
    errores++;
    continue;
  }
  if (item.sha256) {
    const real = sha256Archivo(destino);
    if (real !== item.sha256) {
      console.error(`SHA    ${item.destino}\n  esperado ${item.sha256}\n  real     ${real} — origen: ${item.origen}`);
      errores++;
      continue;
    }
  }
  const kb = Math.round(statSync(destino).size / 1024);
  console.log(`OK     ${item.destino} (${kb} KB)`);
  ok++;
}

if (errores > 0) {
  console.error(`\n${errores} asset(s) con problema — el arnés NO arranca hasta resolverlos (lección ppocr-keys-404).`);
  process.exit(1);
}
console.log(`\n${ok} assets verificados.`);

if (!process.argv.includes("--no-build")) {
  console.log("\nbun build entry.ts → public/_bench/bench-ocr.js …");
  const proc = Bun.spawnSync(["bun", "build", "entry.ts", "--outfile", join(BENCH, "bench-ocr.js"), "--target", "browser", "--minify"], {
    cwd: import.meta.dir,
    stdout: "pipe",
    stderr: "inherit",
  });
  if (proc.exitCode !== 0) {
    console.error("bun build falló");
    process.exit(1);
  }
  console.log("bundle OK.");
}
