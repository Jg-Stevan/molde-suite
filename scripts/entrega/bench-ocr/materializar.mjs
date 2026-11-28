/**
 * materializar.mjs — assets y bundle del arnés de MEDICIÓN (Windows).
 *
 * Todo queda en public/_bench (gitignored). No toca apps/* ni versiona pesos:
 *   · modelos fast/rapid copiados de apps/tamiz/public/models (ya verificados)
 *   · 4.0.0_best descargado de naptha/tessdata con SHA-256 fijado (autorizado)
 *   · vendor onnxruntime + tesseract copiados de apps/*
 *   · bundle de entry-medicion.ts (bun build)
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const RAIZ = resolve(import.meta.dir, "../../..");
const BENCH = join(RAIZ, "public/_bench");

const COPIAS = [
  ["apps/tamiz/public/models/tess/4.0.0_fast/spa.traineddata.gz", "models/tess/4.0.0_fast/spa.traineddata.gz",
    "8db1167a8c9bb015ac8e97278384c3b07dfa9bc8271569beea071d9e296b4487"],
  ["apps/tamiz/public/models/rapidocr/ch_PP-OCRv4_det_infer.onnx", "models/rapidocr/ch_PP-OCRv4_det_infer.onnx",
    "d2a7720d45a54257208b1e13e36a8479894cb74155a5efe29462512d42f49da9"],
  ["apps/tamiz/public/models/rapidocr/ch_PP-OCRv4_rec_infer.onnx", "models/rapidocr/ch_PP-OCRv4_rec_infer.onnx",
    "48fc40f24f6d2a207a2b1091d3437eb3cc3eb6b676dc3ef9c37384005483683b"],
  ["apps/tamiz/public/models/rapidocr/ch_ppocr_mobile_v2.0_cls_infer.onnx", "models/rapidocr/ch_ppocr_mobile_v2.0_cls_infer.onnx",
    "e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c"],
  ["apps/tamiz/public/models/rapidocr/ppocr_keys.txt", "models/rapidocr/ppocr_keys.txt",
    "a1c84d9bdb9ab29043c58896224d32941783eb821629618416dcb08f12886492"],
  ["apps/tamiz/public/vendor/onnxruntime/ort-wasm-simd-threaded.wasm", "vendor/onnxruntime/ort-wasm-simd-threaded.wasm", null],
  ["apps/tamiz/public/vendor/onnxruntime/ort-wasm-simd-threaded.mjs", "vendor/onnxruntime/ort-wasm-simd-threaded.mjs", null],
  ["apps/tamiz/public/vendor/tesseract/worker.min.js", "vendor/tesseract/worker.min.js", null],
  ["apps/tamiz/public/vendor/tesseract/tesseract-core-simd-lstm.wasm.js", "vendor/tesseract/tesseract-core-simd-lstm.wasm.js", null],
  ["apps/molde-studio/public/tesseract/tesseract-core-lstm.wasm.js", "vendor/tesseract/tesseract-core-lstm.wasm.js", null],
  // Detección de quad de la app (misma que usa el pipeline) + OpenCV que carga.
  // opencv-4.5.5.js es un puente de compatibilidad que hace importScripts del
  // core real (opencv-4.12.0-core.js) desde ../vendor/ relativo al worker.
  ["packages/scanner-core/assets/scanner/detection-worker.js", "scanner/detection-worker.js", null],
  ["apps/tamiz/public/vendor/opencv-4.5.5.js", "vendor/opencv-4.5.5.js", null],
  ["apps/tamiz/public/vendor/opencv-4.12.0-core.js", "vendor/opencv-4.12.0-core.js", null],
];

// Familia Tesseract (pedido del dueño 2026-11-28): además de 4.0.0_best spa,
// se suma el modelo estándar 4.0.0 y la lengua eng (spa+eng se prueba en la
// familia). Todo desde el mismo commit fijado de naptha/tessdata, con lock.
const COMMIT = "806cd9adc8c6e8abc11c782db1818c990576bebc";
const dataUrl = (dir, lang) => `https://raw.githubusercontent.com/naptha/tessdata/${COMMIT}/${dir}/${lang}.traineddata.gz`;
const DESCARGAS = [
  { ruta: "4.0.0_best/spa", sha256: "724c20ba45cff66937906a89c74f1a4ef6ac2d10d233f2387fd81c9a8421526a", nota: "4.0.0_best (autorizado por el dueño 2026-11-28)" },
  { ruta: "4.0.0/spa", sha256: "6cd52c545bceeacb2e43fad64fc0703a711c482ba20d1ca4b6915c09de9973e6", nota: "4.0.0 estándar (familia Tesseract 2026-11-28)" },
  { ruta: "4.0.0/eng", sha256: "ed350f3752f81ee8f38769edc14d92d997dababe23b565c59879372cc46a2468", nota: "4.0.0 estándar eng (familia Tesseract 2026-11-28)" },
  { ruta: "4.0.0_fast/eng", sha256: "18c1ac52b75e35d44735fb6c2a60acfaf23033524653200738e98f0243edb75b", nota: "4.0.0_fast eng (familia Tesseract 2026-11-28)" },
  { ruta: "4.0.0_best/eng", sha256: "341ff75b44432480cf6cab965c3e7c23fae4de240dfb49fa9604e6008f95a708", nota: "4.0.0_best eng (familia Tesseract 2026-11-28)" },
];

const sha256 = (ruta) => createHash("sha256").update(readFileSync(ruta)).digest("hex");

mkdirSync(BENCH, { recursive: true });

let errores = 0;
for (const [origen, destino, esperado] of COPIAS) {
  const src = join(RAIZ, origen);
  const dst = join(BENCH, destino);
  if (!existsSync(src)) { console.error(`FALTA origen ${origen}`); errores++; continue; }
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  if (esperado) {
    const real = sha256(dst);
    if (real !== esperado) { console.error(`SHA  ${destino}: ${real} ≠ ${esperado}`); errores++; continue; }
  }
  console.log(`OK  ${destino} (${Math.round(statSync(dst).size / 1024)} KB)`);
}

// Traineddata con lock SHA-256: descarga solo si falta o el hash no cuadra.
for (const d of DESCARGAS) {
  const destino = `models/tess/${d.ruta.split("/")[0]}/${d.ruta.split("/")[1]}.traineddata.gz`;
  const dst = join(BENCH, destino);
  const ok = existsSync(dst) && sha256(dst) === d.sha256;
  if (ok) { console.log(`OK  ${destino} (ya presente, SHA verificado)`); continue; }
  const url = dataUrl(...d.ruta.split("/"));
  console.log(`descargando ${url} …`);
  const r = await fetch(url);
  if (!r.ok) { console.error(`HTTP ${r.status} al descargar ${destino}`); errores++; continue; }
  const bytes = Buffer.from(await r.arrayBuffer());
  const real = createHash("sha256").update(bytes).digest("hex");
  if (real !== d.sha256) { console.error(`SHA ${destino}: ${real} ≠ ${d.sha256}`); errores++; continue; }
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, bytes);
  console.log(`OK  ${destino} (${Math.round(bytes.length / 1024)} KB) — naptha/tessdata ${COMMIT.slice(0, 7)} ${d.nota}`);
}

writeFileSync(join(BENCH, "index.html"), `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Arnés medición OCR</title></head>
<body><p>arnés de medición — <span id="h">cargando</span></p>
<script>
window.addEventListener("error", (e) => { document.getElementById("h").textContent = "ERROR " + e.message; });
// En el teléfono la pantalla debe quedar encendida: si se apaga, Chrome congela
// timers y las mediciones dejan de ser válidas.
const pedirWakelock = () => navigator.wakeLock?.request("screen").catch(() => {});
pedirWakelock();
document.addEventListener("visibilitychange", () => { if (!document.hidden) pedirWakelock(); });
window.__ARNES_LISTO = (async () => {
  document.getElementById("h").textContent = "bundle cargado; iniciando…";
  while (!window.__ARNES) await new Promise((r) => setTimeout(r, 50));
  window.__ARNES.iniciar().then(() => {
    const st = window.__ARNES.estado();
    document.getElementById("h").textContent = st.error ? "ERROR " + st.error : "listo: " + st.total + " corridas";
  });
})();
</script>
<script type="module" src="/_bench/bench-medicion.js"></script>
</body></html>
`);

if (procesarBuild()) process.exit(0);
else process.exit(1);

function procesarBuild() {
  if (process.argv.includes("--no-build")) return true;
  console.log("\nbun build entry-medicion.ts → public/_bench/bench-medicion.js …");
  const proc = Bun.spawnSync(
    ["bun", "build", "entry-medicion.ts", "--outfile", join(BENCH, "bench-medicion.js"), "--target", "browser", "--format", "esm", "--minify"],
    { cwd: import.meta.dir, stdout: "pipe", stderr: "inherit" },
  );
  if (proc.exitCode !== 0) { console.error("bun build falló"); return false; }
  console.log(`bundle OK (${Math.round(statSync(join(BENCH, "bench-medicion.js")).size / 1024)} KB)`);
  if (errores > 0) console.error(`\n${errores} asset(s) con problema`);
  return errores === 0;
}
