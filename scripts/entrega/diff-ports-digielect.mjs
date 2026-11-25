// Auditoría: ports de molde-suite vs apps/digielect14 + packages/scanner-core de Jg-Stevan/e14-suite (clon shallow en temp).
// Uso: node scripts/entrega/diff-ports-digielect.mjs [--ref RUTA_CLON]
import { readdirSync, statSync, readFileSync, mkdirSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { RAIZ, RESULTADOS } from "./a56-comun.mjs";

const argRef = process.argv.indexOf("--ref");
const REF = argRef > -1 ? process.argv[argRef + 1] : "C:/Users/JG/AppData/Local/Temp/e14-suite-ref";
const SALIDA = join(RESULTADOS, "diff-ports");
mkdirSync(SALIDA, { recursive: true });

const MAPAS = [
  { ref: join(REF, "packages/scanner-core/src"), port: join(RAIZ, "packages/scanner-core"), etiqueta: "scanner-core/src→core" },
  { ref: join(REF, "packages/scanner-core/workers"), port: join(RAIZ, "packages/scanner-core/workers"), etiqueta: "scanner-core/workers" },
  { ref: join(REF, "packages/scanner-core/scripts"), port: join(RAIZ, "packages/scanner-core/scripts"), etiqueta: "scanner-core/scripts" },
  { ref: join(REF, "packages/scanner-core/assets"), port: join(RAIZ, "packages/scanner-core/assets"), etiqueta: "scanner-core/assets" },
  { ref: join(REF, "apps/digielect14/src/lib"), port: join(RAIZ, "apps/tamiz/src/lib"), etiqueta: "app/lib" },
  { ref: join(REF, "apps/digielect14/src/components"), port: join(RAIZ, "apps/tamiz/src/components"), etiqueta: "app/components" },
  { ref: join(REF, "apps/digielect14/public/scanner"), port: join(RAIZ, "apps/tamiz/public/scanner"), etiqueta: "public/scanner" },
  { ref: join(REF, "apps/digielect14/public/vendor"), port: join(RAIZ, "apps/tamiz/public/vendor"), etiqueta: "public/vendor" },
];

function archivos(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...archivos(p));
    else out.push(p);
  }
  return out;
}

const sha = (b) => createHash("sha256").update(b).digest("hex").slice(0, 12);
const filas = [];
const soloPort = [];

for (const m of MAPAS) {
  const refs = archivos(m.ref);
  const ports = new Set(archivos(m.port).map((p) => relative(m.port, p)));
  for (const r of refs) {
    const rel = relative(m.ref, r);
    const candidatas = [join(m.port, rel), join(m.port, "src", rel)];
    const p = candidatas.find((c) => existsSync(c));
    const base = { mapa: m.etiqueta, rel };
    if (!p) { filas.push({ ...base, estado: "FALTA_EN_PORT" }); continue; }
    ports.delete(relative(m.port, p));
    const a = readFileSync(r);
    const b = readFileSync(p);
    if (a.equals(b)) { filas.push({ ...base, estado: "IGUAL", sha: sha(a) }); continue; }
    if (a.length > 1_500_000 || b.length > 1_500_000 || a.includes(0)) {
      filas.push({ ...base, estado: "DIFERENTE_GRANDE", shaRef: sha(a), shaPort: sha(b), bytesRef: a.length, bytesPort: b.length });
      continue;
    }
    const na = a.toString("utf8").replace(/\r\n/g, "\n");
    const nb = b.toString("utf8").replace(/\r\n/g, "\n");
    if (na === nb) { filas.push({ ...base, estado: "IGUAL_SALTO_LINEA", sha: sha(a) }); continue; }
    const ta = join(SALIDA, ".tmp-ref");
    const tb = join(SALIDA, ".tmp-port");
    writeFileSync(ta, na);
    writeFileSync(tb, nb);
    let diff = "";
    try {
      execFileSync("diff", ["-u", ta, tb], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    } catch (e) { diff = e.stdout ?? ""; }
    const mas = (diff.match(/^\+[^+]/gm) ?? []).length;
    const menos = (diff.match(/^-[^-]/gm) ?? []).length;
    const nombre = `${m.etiqueta}__${rel}`.replace(/[\\/]/g, "__") + ".diff";
    writeFileSync(join(SALIDA, nombre), diff);
    filas.push({ ...base, estado: "DIVERGE", mas, menos, diff: nombre });
  }
  for (const rel of ports) soloPort.push({ mapa: m.etiqueta, rel });
}

for (const t of [".tmp-ref", ".tmp-port"]) if (existsSync(join(SALIDA, t))) unlinkSync(join(SALIDA, t));
filas.sort((x, y) => (y.mas ?? 0) + (y.menos ?? 0) - ((x.mas ?? 0) + (x.menos ?? 0)));
const resumen = {
  ref: REF,
  generadoEn: new Date().toISOString(),
  totales: filas.reduce((acc, f) => ((acc[f.estado] = (acc[f.estado] ?? 0) + 1), acc), {}),
  filas,
  soloPort,
};
writeFileSync(join(SALIDA, "resumen.json"), JSON.stringify(resumen, null, 2));
console.log("TOTALES:", JSON.stringify(resumen.totales));
console.log("\n== DIVERGENCIAS (por tamaño de diff) ==");
for (const f of filas.filter((f) => f.estado === "DIVERGE" || f.estado === "DIFERENTE_GRANDE"))
  console.log(`${f.estado === "DIVERGE" ? `+${f.mas}/-${f.menos}` : `${f.bytesRef}→${f.bytesPort}B`}  ${f.mapa}  ${f.rel}`);
console.log("\n== FALTA EN PORT ==");
for (const f of filas.filter((f) => f.estado === "FALTA_EN_PORT")) console.log(`${f.mapa}  ${f.rel}`);
console.log("\n== SOLO EN PORT (adiciones) ==");
for (const f of soloPort) console.log(`${f.mapa}  ${f.rel}`);