/**
 * fusionar-a13.mjs — une los crudos por motor del A13 (un motor por carga,
 * límite de plataforma E19: máximo una copia de ORT por página) más el crudo
 * histórico de Tesseract en un único resultados-medicion.json por equipo.
 *
 *   bun fusionar-a13.mjs
 *
 * Lee motores/a13/sinmolde-*/resultados-medicion.json + motores/a13/motores-sinmolde/resultados-medicion.json
 * (tess, del primer cierre) y escribe motores/a13/motores-sinmolde/resultados-medicion.json.
 */
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = decodeURIComponent(new URL("../../../", import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1");
const BASE = join(RAIZ, "scripts/resultados/medicion-ocr/motores/a13");
const DESTINO = join(BASE, "motores-sinmolde", "resultados-medicion.json");
const BASELINE = join(BASE, "motores-sinmolde", "tess-baseline.json");

// Idempotencia: el crudo original de Tesseract se aparta una vez; re-fusionar
// no duplica corridas.
if (!existsSync(BASELINE) && existsSync(DESTINO)) copyFileSync(DESTINO, BASELINE);

const fuentes = [BASELINE];
for (const d of readdirSync(BASE)) {
  const f = join(BASE, d, "resultados-medicion.json");
  if (d.startsWith("sinmolde-") && existsSync(f)) fuentes.push(f);
}

const resultados = [];
const meta = { initFrioMs: {}, calentamientoMs: {}, erroresMotor: {}, fuentes: [] };
let base = null;
for (const f of fuentes) {
  if (!existsSync(f)) continue;
  const s = JSON.parse(readFileSync(f, "utf8"));
  base ??= s.meta ?? {};
  resultados.push(...(s.resultados ?? []));
  for (const k of Object.keys(s.meta?.initFrioMs ?? {})) meta.initFrioMs[k] = s.meta.initFrioMs[k];
  for (const k of Object.keys(s.meta?.calentamientoMs ?? {})) meta.calentamientoMs[k] = s.meta.calentamientoMs[k];
  for (const k of Object.keys(s.meta?.erroresMotor ?? {})) meta.erroresMotor[k] = s.meta.erroresMotor[k];
  meta.fuentes.push(f.replace(RAIZ, ".").replace(/\\/g, "/"));
}

const salida = {
  meta: { ...base, ...meta, nota: "A13: un motor ORT por carga (E19, Chrome 32 bits); fusionado por fusionar-a13.mjs." },
  resultados,
};
writeFileSync(DESTINO, JSON.stringify(salida, null, 1) + "\n", "utf8");
console.log(`fusionado: ${resultados.length} corridas de ${meta.fuentes.length} fuentes → ${DESTINO}`);
