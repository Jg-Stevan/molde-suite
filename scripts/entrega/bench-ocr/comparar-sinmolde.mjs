/**
 * comparar-sinmolde.mjs — informe de la medición «motores sin molde» (2026-11-28).
 *
 * Lee los crudos por equipo y arma: (1) tabla motor × resolución con mediana de
 * ms, PSS pico, conf, etiquetas GT reales y CER/WER de la sintética; (2) la
 * extracción por valores del recibo (A56-limpia3) reutilizando
 * extraer-campos.mjs. Salida: markdown en la ruta de --salida.
 *
 *   bun comparar-sinmolde.mjs [--equipos a56,a12,a13] [--salida <ruta.md>]
 *
 * Los valores personales van redactados/enmascarados (lo hace extraer-campos).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const RAIZ = decodeURIComponent(new URL("../../../", import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1");
const dirScript = decodeURIComponent(new URL(".", import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1");
const BASE = join(RAIZ, "scripts/resultados/medicion-ocr/motores");
const args = process.argv.slice(2);
const op = (n, d) => {
  const i = args.indexOf("--" + n);
  return i > -1 ? args[i + 1] : d;
};
const EQUIPOS = (op("equipos", "a56,a12,a13")).split(",").map((x) => x.trim()).filter(Boolean);
const SALIDA = op("salida", join(homedir(), "Downloads", "motores-sinmolde.md"));
const CARPETA = op("carpeta", "motores-sinmolde");

const mediana = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);
const media = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

const etiquetasJson = JSON.parse(readFileSync(join(RAIZ, "scripts/resultados/medicion-ocr/gt/etiquetas.json"), "utf8"));
const cuentaEtiquetas = (r) => {
  const e = r.etiquetas ?? [];
  return { hit: e.filter((x) => x.hit).length, total: e.length };
};

const filas = [];
const secciones = [];
const extras = [];
for (const equipo of EQUIPOS) {
  const ruta = join(BASE, equipo, CARPETA, "resultados-medicion.json");
  // `p6` = página completa con PSM 6 (viene de la corrida de familia o del sondeo
  // del débil); se puntúa en igualdad de condiciones que los demás motores.
  const rutas = [ruta, join(BASE, equipo, "p6", "resultados-medicion.json")].filter((p) => existsSync(p));
  if (!rutas.includes(ruta)) {
    extras.push(`> **${equipo.toUpperCase()}**: sin crudo en \`${ruta.replace(/\\/g, "/")}\` (aún no terminó o no se corrió).`);
    if (!rutas.length) continue;
  }
  for (const p of rutas) {
  const s = JSON.parse(readFileSync(p, "utf8"));
  const res = s.resultados ?? [];
  for (const r of res) {
    const { hit, total } = cuentaEtiquetas(r);
    filas.push({
      equipo,
      motor: r.motor,
      maestra: r.maestra,
      doc: r.doc,
      lado: r.lado,
      ms: r.ms,
      conf: r.conf ?? 0,
      chars: r.chars ?? 0,
      hit,
      total,
      cer: r.cer,
      wer: r.wer,
      pss: r.pssPicoMB ?? 0,
      error: r.error ?? "",
    });
  }
  secciones.push({ equipo, meta: s.meta ?? {}, ruta: p });
  }
}

const agrupa = new Map();
for (const f of filas) {
  if (f.error) continue;
  const k = `${f.equipo}|${f.motor}|${f.lado}`;
  if (!agrupa.has(k)) agrupa.set(k, []);
  agrupa.get(k).push(f);
}
const tabla = [...agrupa.entries()].map(([k, v]) => {
  const [equipo, motor, lado] = k.split("|");
  const sin = v.filter((x) => x.doc !== "sintetica");
  const sinS = v.filter((x) => x.doc === "sintetica");
  return {
    equipo,
    motor,
    lado: Number(lado),
    n: v.length,
    ms: mediana(v.map((x) => x.ms)),
    pss: Math.max(...v.map((x) => x.pss)),
    conf: Math.round(media(v.map((x) => x.conf))),
    chars: Math.round(media(v.map((x) => x.chars))),
    etiquetas: sin.length ? `${v.reduce((s2, x) => s2 + x.hit, 0)}/${v.reduce((s2, x) => s2 + x.total, 0)}` : "—",
    cer: sinS.length ? media(sinS.map((x) => x.cer ?? 0)).toFixed(4) : "—",
    wer: sinS.length ? media(sinS.map((x) => x.wer ?? 0)).toFixed(4) : "—",
  };
}).sort((a, b) => (a.equipo === b.equipo ? a.motor.localeCompare(b.motor) || a.lado - b.lado : a.equipo.localeCompare(b.equipo)));

const md = [];
md.push("# Motores sin molde — lectura cruda (2026-11-28)");
md.push("");
md.push("Medición en Chrome de teléfonos reales, entrada = imagen limpia rectificada (A56-limpia3 recibo, A56-limpia4 comprobante) + sintética de control. Sin molde de Tamiz: solo OCR crudo y extracción por valores (anclas + patrones).");
md.push("");
md.push("## Tabla motor × resolución (caliente, mediana de ms)");
md.push("");
md.push("| equipo | motor | lado | n | ms mediana | PSS pico MB | conf | chars | etiquetas GT reales | CER (sint.) | WER (sint.) |");
md.push("|---|---|---|---|---|---|---|---|---|---|---|");
for (const t of tabla) {
  md.push(`| ${t.equipo} | ${t.motor} | ${t.lado} | ${t.n} | ${t.ms} | ${t.pss} | ${t.conf} | ${t.chars} | ${t.etiquetas} | ${t.cer} | ${t.wer} |`);
}
md.push("");
md.push("## Warmup, init en frío y motores no viables");
md.push("");
for (const s of secciones) {
  md.push(`### ${s.equipo.toUpperCase()}`);
  md.push("");
  md.push("```");
  for (const motor of Object.keys(s.meta.initFrioMs ?? {})) {
    const ini = s.meta.initFrioMs[motor];
    const cal = s.meta.calentamientoMs?.[motor];
    const err = s.meta.erroresMotor?.[motor];
    md.push(`${motor.padEnd(15)} init_frio=${String(ini).padStart(6)} ms  calentamiento=${String(cal).padStart(6)} ms  ${err ? "NO VIABLE: " + err.slice(0, 120) : "viable"}`);
  }
  md.push("```");
  md.push("");
}
for (const x of extras) md.push(x, "");

// ── Secciones de carpetas adicionales (nativo sin downsample, rescate de cabecera) ──
const seccionCarpeta = (carpetas, titulo, intro, notaEquipo = true) => {
  const filasEq = [];
  for (const equipo of EQUIPOS) {
    for (const carpeta of [].concat(carpetas)) {
    const ruta = join(BASE, equipo, carpeta, "resultados-medicion.json");
    if (!existsSync(ruta)) continue;
    for (const r of JSON.parse(readFileSync(ruta, "utf8")).resultados ?? []) {
      if (r.error) continue;
      filasEq.push({ equipo, motor: r.motor, maestra: r.maestra, lado: r.lado, r });
    }
    }
  }
  if (!filasEq.length) return;
  const agg = new Map();
  for (const f of filasEq) {
    const k = `${f.equipo}|${f.motor}|${f.maestra}|${f.lado}`;
    if (!agg.has(k)) agg.set(k, []);
    agg.get(k).push(f.r);
  }
  md.push(titulo);
  md.push("");
  md.push(intro);
  md.push("");
  md.push(`${notaEquipo ? "| equipo |" : ""} motor | maestra | lado | n | ms mediana | conf | PSS pico MB | etiquetas GT |`);
  md.push(`${notaEquipo ? "|---|" : ""}---|---|---|---|---|---|---|---|`);
  for (const [k, v] of [...agg.entries()].sort()) {
    const [equipo, motor, maestra, lado] = k.split("|");
    const hit = v.reduce((s2, r) => s2 + (r.etiquetas ?? []).filter((x) => x.hit).length, 0);
    const total = v.reduce((s2, r) => s2 + (r.etiquetas ?? []).length, 0);
    const pss = Math.max(...v.map((r) => r.pssPicoMB ?? 0));
    md.push(
      `${notaEquipo ? `| ${equipo} |` : ""} ${motor} | ${maestra} | ${lado} | ${v.length} | ${mediana(v.map((r) => r.ms))} | ${Math.round(media(v.map((r) => r.conf ?? 0)))} | ${pss || "no medido"} | ${hit}/${total} |`,
    );
  }
  md.push("");
};

seccionCarpeta(
  "nativo",
  "## Validación nativa (sin downsample)",
  "Corrida del ganador y de la referencia sobre las limpias a su lado mayor real (2463 recibo, 2577 comprobante; la sintética es upscale y no corre).",
);
seccionCarpeta(
  ["header", "header3"],
  "## Rescate de cabecera (recortes, coste medido)",
  "Recortes de la cabecera para cerrar `fecha_emision` y `numero_recibo`. `litert_header` = banda estrecha ×2; `litert_header_w` / `tess_header_pw` = banda ancha ×2; `tess_header_pw1` = banda ancha ×1; `tess_hdr_par*` = banda fina de las dos líneas (x 0,60–0,95 · y 0,135–0,195) a ×3 y ×2 con PSM 6/7/11.",
);

// ── Scorecard 50/30/10/10 por equipo (pesos fijados por el dueño) ──────────
// Precisión = 60 % CER sintética + 40 % etiquetas GT reales.
// Velocidad = 100 × msMínimoDelEquipo / msMediana. Recursos = 100 × (1 − PSS/2600).
// «Ligero» neutro en esta fase (100): el peso en disco del SDK se reporta aparte,
// sin modelos CDN vendoreados todavía.
const scorecards = [];
for (const equipo of EQUIPOS) {
  const filasEq = tabla.filter((t) => t.equipo === equipo);
  if (filasEq.length === 0) continue;
  const minMs = Math.min(...filasEq.map((t) => t.ms));
  const sc = filasEq.map((t) => {
    const [hit, total] = t.etiquetas === "—" ? [0, 0] : t.etiquetas.split("/").map(Number);
    const ratio = total > 0 ? hit / total : 0;
    const cer = t.cer === "—" ? null : Number(t.cer);
    const precision = cer == null ? null : 100 * (0.6 * Math.max(0, 1 - cer) + 0.4 * ratio);
    const velocidad = 100 * (minMs / t.ms);
    const ligero = 100;
    const recursos = t.pss > 0 ? Math.max(0, 100 * (1 - t.pss / 2600)) : null;
    const gate = t.pss > 0 && t.pss <= 2600;
    const total99 = precision != null && recursos != null
      ? 0.5 * precision + 0.3 * velocidad + 0.1 * ligero + 0.1 * recursos
      : null;
    return { ...t, precision, velocidad, ligero, recursos, gate, total: total99, ratio };
  }).sort((a, b) => (b.total ?? -1) - (a.total ?? -1));
  scorecards.push({ equipo, sc, minMs });

  md.push(`## Scorecard ${equipo.toUpperCase()} (pesos 50/30/10/10; «ligero» neutro en esta fase)`);
  md.push("");
  md.push("| motor | lado | precisión | velocidad | recursos | gate 4 GB | total | PSS pico MB | etiquetas reales |");
  md.push("|---|---|---|---|---|---|---|---|---|");
  for (const s of sc) {
    const f = (x) => (x == null ? "—" : x.toFixed(1));
    md.push(`| ${s.motor} | ${s.lado} | ${f(s.precision)} | ${f(s.velocidad)} | ${f(s.recursos)} | ${s.gate} | ${f(s.total)} | ${s.pss || "no medido"} | ${(100 * s.ratio).toFixed(0)} % (${s.etiquetas}) |`);
  }
  md.push("");
}

// ── Extracción por valores del recibo real (A56-limpia3), por equipo y motor ──
const extraer = (crudo, motor) => {
  const r = spawnSync(process.execPath, ["extraer-campos.mjs", crudo, "--motor", motor, "--maestra", "A56-limpia3"], { cwd: dirScript, encoding: "utf8", timeout: 120000 });
  return (r.stdout || "").trim() || (r.error ? `error: ${r.error.message}` : "");
};
md.push("## Campos extraídos (recibo real A56-limpia3, valores enmascarados)");
md.push("");
for (const s of secciones) {
  const ruta = s.ruta;
  const sdata = JSON.parse(readFileSync(ruta, "utf8"));
  const motores = [...new Set((sdata.resultados ?? []).filter((r2) => r2.maestra === "A56-limpia3" && !r2.error).map((r2) => r2.motor))];
  for (const motor of motores) {
    const out = extraer(ruta, motor);
    if (!out) continue;
    md.push(`### ${s.equipo.toUpperCase()} · ${motor}`);
    md.push("");
    md.push("```");
    md.push(out);
    md.push("```");
    md.push("");
  }
}

// ── Motores de hlo.txt sin medición: no viables con motivo comprobado ──────
md.push("## Motores de `hlo.txt` no medidos — no viables con motivo (registro npm, 2026-11-28)");
md.push("");
md.push("| motor | motivo técnico comprobado |");
md.push("|---|---|");
md.push("| client-side-ocr | `client-side-ocr@2.1.0` es la app demo React publicada (React 19 + Mantine 8); envuelve los mismos runtimes ya medidos (onnxruntime-web, RapidOCR, PPU PaddleOCR, tesseract.js 6). Duplicado. |");
md.push("| Scribe.js | `scribe.js-ocr@0.18.3` **AGPL-3.0** (incompatible) sobre un fork de tesseract.js 7 + PDF.js: mismo motor base medido + tooling PDF. |");
md.push("| OCRAD.js | `ocrad.js@0.0.1` **GPL-3.0**, sin mantenimiento (2014→2022), motor de reglas sin datos español; su README admite peor precisión que Tesseract. |");
md.push("| GOCR.js | Sin paquete npm (`E404`); port emscripten abandonado (GPL-3.0). `g-ocr` es Node nativo (ONNX CPU, sin build de navegador) y alemán. |");
md.push("| DocTR | Proyecto Python (TF/PyTorch) con servicio; sin build wasm de navegador → requeriría servidor (viola privacidad). |");
md.push("| Mieru-OCR | ddddocr de captchas; no procesa documentos. |");
md.push("");
md.push("Referencia: `npm view`/`npm search` del 2026-11-28 (versión, licencia, fechas, dependencias) + README de ocrad.js. Cero «pendiente».");
md.push("");

writeFileSync(SALIDA, md.join("\n") + "\n", "utf8");
console.log(md.join("\n"));
console.log(`\nEscrito: ${SALIDA}`);
