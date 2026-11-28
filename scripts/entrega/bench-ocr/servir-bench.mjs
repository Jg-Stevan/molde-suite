/**
 * servir-bench.mjs — servidor estático COOP/COEP del arnés, independiente del
 * conductor (para inspeccionar imágenes con el teléfono sin correr la matriz).
 * Uso: bun servir-bench.mjs [--puerto 8941]
 */
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const RAIZ = resolve(import.meta.dir, "../../..");
const BENCH = join(RAIZ, "public/_bench");
const MED = resolve(import.meta.dir, "../../resultados/medicion-ocr");
const MAESTRAS = join(MED, "maestras");
const GT = join(MED, "gt");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".onnx": "application/octet-stream",
  ".gz": "application/gzip",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
};
const CABECERAS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cache-Control": "no-store",
};
const i = process.argv.indexOf("--puerto");
const PUERTO = i > -1 ? parseInt(process.argv[i + 1], 10) : 8941;

Bun.serve({
  port: PUERTO,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    let ruta = decodeURIComponent(url.pathname);
    let base;
    if (ruta === "/" || ruta === "/_bench") { base = BENCH; ruta = "/index.html"; }
    else if (ruta.startsWith("/_bench/")) { base = BENCH; ruta = ruta.slice(7); }
    else if (ruta.startsWith("/maestras/")) { base = MAESTRAS; ruta = ruta.slice(9); }
    else if (ruta.startsWith("/gt/")) { base = GT; ruta = ruta.slice(3); }
    else return new Response("no encontrado", { status: 404 });
    if (ruta.endsWith("/") || ruta === "") ruta = "/index.html";
    const archivo = join(base, ruta);
    if (!archivo.startsWith(base) || !existsSync(archivo)) return new Response("404", { status: 404 });
    return new Response(await Bun.file(archivo).arrayBuffer(), {
      headers: { ...CABECERAS, "Content-Type": MIME[extname(archivo)] ?? "application/octet-stream" },
    });
  },
});
console.log(`arnés en http://127.0.0.1:${PUERTO}/_bench/ (COOP/COEP)`);
