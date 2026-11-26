/**
 * tabular-medicion.mjs — agrega scripts/resultados/medir-fases/resumen.json
 * (Fase 0 del plan de rendimiento) y produce la tabla fase × configuración:
 * tiempo a veredicto, etapas UI, tiempos del molde (IDB) y nº de pasadas OCR
 * parseadas de la consola. Escribe TABLA.md junto al resumen.
 *
 * Uso: node scripts/entrega/tabular-medicion.mjs [ruta-resumen]
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { RESULTADOS } from "./a56-comun.mjs";

const arg = process.argv[2];
const dir = join(RESULTADOS, "medir-fases");
const rutaResumen = arg ?? join(dir, "resumen.json");

let corridas = null;
if (readdirSync(dir).includes("resumen.json")) {
  corridas = JSON.parse(readFileSync(rutaResumen, "utf-8")).corridas;
} else {
  // Resumen incompleto: leer los JSON por corrida.
  corridas = readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("resumen"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf-8")));
}

const parseNum = (re, texto) => {
  const m = texto.match(re);
  return m ? Number(m[1]) : null;
};

const derivarDeConsola = (lineas = []) => {
  const s = lineas.join("\n");
  const cascada = lineas.find((l) => /\[e14\] ocr-cascada/.test(l)) ?? "";
  return {
    cascadaMs1: parseNum(/ ms1=(\d+)/, cascada),
    cascadaMs2: parseNum(/ ms2=(\d+)/, cascada),
    cascadaMsRoi: parseNum(/ msRoi=(\d+)/, cascada),
    cascadaMsMotor: parseNum(/ msMotor=(\d+)/, cascada),
    cascadaIntento1: (cascada.match(/intento1=(\w+)/) ?? [])[1] ?? null,
    cascadaRescate: cascada.includes("rescate=1"),
    orientacionMs: (() => {
      const l = lineas.find((x) => /\[e14\] orientacion/.test(x)) ?? "";
      return parseNum(/ ms=(\d+)/, l);
    })(),
    moldeOcrMs: (() => {
      const l = lineas.find((x) => /\[molde\] ratio de anclas/.test(x)) ?? "";
      return parseNum(/ocrMs: (\d+)/, l);
    })(),
    abEjecutado: lineas.some((l) => /\[molde\] A\/B binarizada vs original/.test(l)),
    celdasRapid: lineas.filter((l) => /\[e14-rapidocr\] celda/.test(l)).length,
    tessPasadas: lineas.filter((l) => /\[e14\] tess-best ok/.test(l)).length,
  };
};

const fmt = (v) => (v == null ? "-" : `${(v / 1000).toFixed(1)}s`);

const filas = [];
for (const c of corridas) {
  if (c.error) {
    filas.push({ foto: c.archivo, config: c.config, pase: c.pase, error: c.error.slice(0, 60) });
    continue;
  }
  const rot = c.rotacion;
  filas.push({
    foto: c.archivo.replace(/-impreso-firmas-vacias-|-todo-mano-|-mixto-/, "-"),
    config: c.config,
    pase: c.pase,
    ms: c.msVeredicto,
    veredicto: c.veredicto,
    etapas: (c.etapas ?? []).map((e) => `${e.fase}@${e.t}`).join(" "),
    moldeOcr: c.acta?.tiempos?.ocr_ms ?? null,
    moldeMotor: c.acta?.tiempos?.motor_ms ?? null,
    moldeRender: c.acta?.tiempos?.render_ms ?? null,
    okTotal: c.acta ? `${c.acta.ok ?? "-"}/${c.acta.total ?? "-"}` : null,
    enrutado: c.acta?.enrutado ?? null,
    rotMs: rot?.msVeredicto ?? null,
    ...derivarDeConsola(c.consola),
  });
}

const lineasTabla = [];
lineasTabla.push("# Fase 0 — medición por corrida (A56)");
lineasTabla.push("");
lineasTabla.push("| foto | config | pase | veredicto | molde_ocr | molde_motor | tess | rescate | A/B | rotación |");
lineasTabla.push("|---|---|---|---|---|---|---|---|---|---|");
for (const f of filas) {
  lineasTabla.push(
    `| ${f.foto ?? "?"} | ${f.config} | ${f.pase} | ${f.ms != null ? fmt(f.ms) : f.error ?? "TIMEOUT"} ` +
      `(${f.veredicto ?? "-"}) | ${fmt(f.moldeOcr)} | ${fmt(f.moldeMotor)} | ${f.cascadaIntento1 ?? "-"} | ` +
      `${f.cascadaRescate ? "sí" : "no"} | ${f.abEjecutado ? "sí" : "no"} | ${f.rotMs != null ? fmt(f.rotMs) : "-"} |`,
  );
}

// Reparto por config: media de veredicto por foto/config.
lineasTabla.push("");
lineasTabla.push("## Media por configuración");
lineasTabla.push("");
lineasTabla.push("| config | media veredicto | runs | media rotación |");
lineasTabla.push("|---|---|---|---|");
const porConfig = {};
for (const f of filas) {
  if (f.ms == null) continue;
  (porConfig[f.config] ??= []).push(f);
}
for (const [config, fs] of Object.entries(porConfig)) {
  const media = fs.reduce((a, f) => a + f.ms, 0) / fs.length;
  const rots = fs.filter((f) => f.rotMs != null);
  const mediaRot = rots.length ? rots.reduce((a, f) => a + f.rotMs, 0) / rots.length : null;
  lineasTabla.push(`| ${config} | ${(media / 1000).toFixed(1)}s | ${fs.length} | ${mediaRot != null ? `${(mediaRot / 1000).toFixed(1)}s` : "-"} |`);
}

const tabla = lineasTabla.join("\n");
console.log(tabla);
writeFileSync(join(dir, "TABLA.md"), tabla + "\n");
console.log(`\n→ ${join(dir, "TABLA.md")}`);
