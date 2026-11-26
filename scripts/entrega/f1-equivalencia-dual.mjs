/**
 * f1-equivalencia-dual.mjs — aceptación F1 en el COMPU (sin teléfono):
 * compara pixel a pixel el bw histórico (`processImage 'bw'`) contra el bw del
 * warp compartido (`processImageDual`) en Chromium local, con las fotos
 * reales del banco servidas por el dev server (:3100).
 *
 * Uso: node scripts/entrega/f1-equivalencia-dual.mjs [--deskew 1]
 * Requiere: dev server en :3100, bun (bundlea el harness), Playwright local.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const DIR_PUBLIC_F1 = join(RAIZ, "apps", "tamiz", "public", "_f1");
const FOTOS = [
  "comprobante-c-mixto-01.jpg",
  "comprobante-b-todo-mano-01.jpg",
  "comprobante-a-impreso-firmas-vacias-02.jpg",
];
const argDe = (n) => {
  const i = process.argv.indexOf(n);
  return i > -1 ? process.argv[i + 1] : null;
};
const DESKEW = argDe("--deskew") ?? "1";

mkdirSync(DIR_PUBLIC_F1, { recursive: true });
writeFileSync(
  join(DIR_PUBLIC_F1, "index.html"),
  `<!doctype html><meta charset="utf-8"><script type="module" src="./harness.js"></script>\n`,
);

console.log("[f1] bundleando harness...");
execFileSync(
  "bun",
  [
    "build",
    join(RAIZ, "scripts", "entrega", "f1-dual-harness.ts"),
    "--target",
    "browser",
    "--format",
    "esm",
    "--outfile",
    join(DIR_PUBLIC_F1, "harness.js"),
  ],
  { stdio: "inherit" },
);

const { chromium } = await import("playwright");
const navegador = await chromium.launch({ headless: true });
const resultados = [];
try {
  const pagina = await navegador.newPage();
  pagina.on("console", (m) => {
    if (m.type() === "error") console.log(`[f1][consola] ${m.text().slice(0, 300)}`);
  });
  for (const foto of FOTOS) {
    const url = `http://localhost:3100/_f1/index.html?foto=${encodeURIComponent(
      `/dev-fixtures/reales-variantes/${foto}`,
    )}&deskew=${DESKEW}`;
    await pagina.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await pagina.waitForFunction(
      () => window.__f1 && window.__f1.estado !== "iniciando",
      undefined,
      { timeout: 180000 },
    );
    const r = await pagina.evaluate(() => window.__f1);
    if (r.estado === "error") {
      console.error(`[f1] ${foto} → ERROR: ${r.error}`);
      resultados.push({ foto, error: r.error });
      continue;
    }
    const x = r.resultado;
    resultados.push(x);
    const bw = x.bw;
    console.log(
      `[f1] ${foto} · engine=${x.engineHist} · ${x.dims} · ` +
        `bw idéntico=${bw.identico}` +
        (bw.identico
          ? ""
          : ` · diff=${bw.diffPx}/${bw.totalPx}px (${bw.pctDiff}%) · max=${bw.maxDiff}`) +
        ` · msHist=${x.msHistBw} msDual=${x.msDual}` +
        ` · original idéntico=${x.original.identico}`,
    );
  }

  const fallos = resultados.filter((r) => r.error || !r.bw?.identico);
  const msHist = resultados.reduce((s, r) => s + (r.msHistBw ?? 0), 0);
  const msDual = resultados.reduce((s, r) => s + (r.msDual ?? 0), 0);
  console.log(
    `\n[f1] VEREDICTO: ${fallos.length === 0 ? "EQUIVALENTE (pixel a pixel)" : "NO EQUIVALENTE"} · ` +
      `${resultados.length - fallos.length}/${resultados.length} fotos · ` +
      `Σ msHist=${msHist} vs Σ msDual=${msDual}`,
  );
  writeFileSync(
    join(RAIZ, "scripts", "resultados", `f1-equivalencia-dual-${new Date().toISOString().replace(/[:.]/g, "-")}.json`),
    JSON.stringify({ fecha: new Date().toISOString(), deskew: DESKEW, resultados }, null, 2),
  );
  process.exitCode = fallos.length === 0 ? 0 : 1;
} finally {
  await navegador.close().catch(() => undefined);
  rmSync(DIR_PUBLIC_F1, { recursive: true, force: true });
}
