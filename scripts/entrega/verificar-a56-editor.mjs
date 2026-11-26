/**
 * verificar-a56-editor.mjs — prueba TÁCTIL del editor en el Galaxy A56 REAL.
 *
 * Limpia el service worker PWA, siembra el molde y llega a una vista de
 * resultados (importa pag-01 si hace falta). Después toca con eventos
 * táctiles reales (CDP Input.dispatchTouchEvent vía a56-comun):
 *   1. «Recortar» → QuadEditor abierto + verificación de que el overlay
 *      pinta fondos opacos (si el SW sirve CSS viejo, computan transparentes).
 *   2. «ROTAR 90°» local del editor.
 *   3. «CANCELAR» → vuelve a la vista de resultados.
 *   4. Reabrir → «APLICAR RECORTE» → el pipeline re-corre → veredicto.
 *   5. «Rotar 90°» de la toolbar (rotarFoto: gira la PROCESADA, sin OCR).
 * Capturas adb de cada paso + JSON a56-editor-<ts>.json. Exit 1 si un paso
 * no se completa.
 *
 * Uso:
 *   adb forward tcp:9223 localabstract:chrome_devtools_remote
 *   node scripts/entrega/verificar-a56-editor.mjs [--cdp http://127.0.0.1:9223]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  MOLDE,
  RESULTADOS,
  VEREDICTOS,
  capturaDispositivo,
  conectarA56,
  crearProgreso,
  cuerpo,
  desarmarAutoCaptura,
  esperarVeredicto,
  limpiarPwa,
  prepararImporte,
  seleccionarArchivo,
  sembrarMolde,
  tocar,
} from "./a56-comun.mjs";

const argCdp = process.argv.indexOf("--cdp");
const CDP = argCdp > -1 ? process.argv[argCdp + 1] : "http://127.0.0.1:9223";

const progreso = crearProgreso("a56-editor.log");
const { navegador, pagina, sesion } = await conectarA56(CDP);

const pasos = [];
function paso(nombre, ok, extra = {}) {
  pasos.push({ paso: nombre, ok, ...extra });
  progreso(`${ok ? "ok   " : "FALLA"} ${nombre}${extra.nota ? ` ← ${extra.nota}` : ""}`);
}

async function abrirEditor() {
  const recortar = pagina.getByRole("button", { name: /Recortar/i }).first();
  const via = await tocar(pagina, sesion, recortar, "Recortar", progreso);
  const dialogo = pagina.getByRole("dialog", { name: /Ajuste de bordes del documento/i });
  await dialogo.waitFor({ state: "visible", timeout: 20000 });
  return { dialogo, via };
}

/** Los fondos del overlay y de APLICAR deben ser opacos; si computan
 *  rgba(0,0,0,0) el teléfono está corriendo CSS viejo cacheado (SW). */
async function revisarFondosEditor() {
  const fondos = await pagina.evaluate(() => {
    const dialogo = document.querySelector('[role="dialog"][aria-label="Ajuste de bordes del documento"]');
    const aplicar = document.querySelector('[aria-label="Aplicar el recorte"]');
    const cs = (el) => (el ? getComputedStyle(el).backgroundColor : null);
    return {
      dialogo: cs(dialogo),
      footer: cs(aplicar?.closest("footer")),
      aplicar: cs(aplicar),
    };
  });
  const opaco = (v) => Boolean(v) && !/rgba\(0, 0, 0, 0\)/.test(v);
  return { fondos, cssFresco: opaco(fondos.dialogo) && opaco(fondos.footer) && opaco(fondos.aplicar) };
}

try {
  progreso(`A56 editor inicio · CDP=${CDP} · ${new Date().toISOString()}`);

  const moldeTexto = readFileSync(MOLDE, "utf-8");
  JSON.parse(moldeTexto);
  await sembrarMolde(pagina, moldeTexto);
  await limpiarPwa(pagina, sesion);
  await desarmarAutoCaptura(pagina);

  // Estado de partida: vista de resultados con veredicto.
  if (!VEREDICTOS.test(await cuerpo(pagina))) {
    await prepararImporte(pagina);
    await seleccionarArchivo(pagina, "pag-01.png");
    progreso("importación pag-01 disparada para obtener vista de resultados");
    if (!(await esperarVeredicto(pagina))) throw new Error("sin veredicto tras importar pag-01");
    await pagina.waitForTimeout(2500);
  }
  await pagina.waitForTimeout(1500);

  // ── 1. Abrir QuadEditor con un toque en «Recortar» + CSS fresco ──────────
  const { dialogo, via: viaRecortar } = await abrirEditor().catch(() => ({ dialogo: null, via: null }));
  const captura1 = capturaDispositivo("a56-editor-01-quad-abierto.png");
  if (!dialogo) {
    paso("abrir QuadEditor (Recortar)", false, { captura: captura1, via: viaRecortar, nota: "el diálogo no apareció" });
    throw new Error("QuadEditor no abrió");
  }
  const { fondos, cssFresco } = await revisarFondosEditor();
  paso("abrir QuadEditor (Recortar)", true, { captura: captura1, via: viaRecortar });
  paso("overlay con fondos opacos (CSS fresco, no SW viejo)", cssFresco, {
    fondos,
    nota: cssFresco ? "" : "fondos transparentes: CSS cacheado — revisar limpiarPwa",
  });

  // ── 2. Rotación local dentro del editor ─────────────────────────────────
  const rotarEditor = dialogo.getByRole("button", { name: /Rotar la imagen 90 grados/i });
  const viaRotarEditor = await tocar(pagina, sesion, rotarEditor, "ROTAR 90° (editor)", progreso);
  await pagina.waitForTimeout(1200);
  const captura2 = capturaDispositivo("a56-editor-02-quad-rotado.png");
  paso("rotar 90° dentro del editor", true, { captura: captura2, via: viaRotarEditor });

  // ── 3. CANCELAR → vuelve a la vista de resultados ───────────────────────
  const cancelar = dialogo.getByRole("button", { name: /Cancelar el ajuste de bordes/i });
  const viaCancelar = await tocar(pagina, sesion, cancelar, "CANCELAR (editor)", progreso);
  let cerrado = false;
  try {
    await dialogo.waitFor({ state: "hidden", timeout: 15000 });
    cerrado = true;
  } catch {
    /* se evalúa abajo */
  }
  const captura3 = capturaDispositivo("a56-editor-03-cancelado.png");
  paso("cancelar y volver", cerrado, { captura: captura3, via: viaCancelar, nota: cerrado ? "" : "el diálogo sigue visible" });
  await pagina.waitForTimeout(1000);

  // ── 4. APLICAR RECORTE → aplicarRecorte re-corre el pipeline (OCR) ──────
  const antesAplicar = (await cuerpo(pagina)).match(VEREDICTOS)?.[0] ?? null;
  const { dialogo: dialogo2 } = await abrirEditor();
  const captura4 = capturaDispositivo("a56-editor-04a-aplicar.png");
  const aplicar = dialogo2.getByRole("button", { name: /Aplicar el recorte/i });
  const viaAplicar = await tocar(pagina, sesion, aplicar, "APLICAR RECORTE", progreso);
  const tAplicar = Date.now();
  let cerroAplicar = false;
  try {
    // Éxito = el editor se cierra solo (ReviewView: setEditando(false) si ok).
    await dialogo2.waitFor({ state: "hidden", timeout: 300000 });
    cerroAplicar = true;
  } catch {
    /* se evalúa abajo */
  }
  const huboErrorRecorte = !cerroAplicar && (await pagina.getByText(/NO SE PUDO RECORTAR/i).count()) > 0;
  await pagina.waitForTimeout(1500);
  const trasAplicar = cerroAplicar ? await esperarVeredicto(pagina, 120000) : null;
  const captura5 = capturaDispositivo("a56-editor-05-aplicado.png");
  paso("aplicar recorte (pipeline)", cerroAplicar && trasAplicar != null, {
    captura: captura4,
    capturaResultado: captura5,
    via: viaAplicar,
    veredictoAntes: antesAplicar,
    veredictoDespues: trasAplicar?.match(VEREDICTOS)?.[0] ?? null,
    segundos: Math.round((Date.now() - tAplicar) / 1000),
    errorRecorte: huboErrorRecorte,
    nota: cerroAplicar ? "" : huboErrorRecorte ? "error inline de recorte" : "el editor no se cerró",
  });

  // ── 5. «Rotar 90°» de la toolbar → gira la PROCESADA sin re-pipeline ────
  const srcAntes = await pagina.evaluate(() => {
    const img = document.querySelector('[data-purpose="visor-documento"] img');
    const s = img?.getAttribute("src") ?? "";
    return { len: s.length, pref: s.slice(0, 60) };
  });
  const veredictoAntesRotar = (await cuerpo(pagina)).match(VEREDICTOS)?.[0] ?? null;
  const rotarToolbar = pagina.getByRole("button", { name: /^Rotar 90°$/ }).first();
  const viaRotarToolbar = await tocar(pagina, sesion, rotarToolbar, "Rotar 90° (toolbar)", progreso);
  await pagina.waitForTimeout(2000);
  const srcDespues = await pagina.evaluate(() => {
    const img = document.querySelector('[data-purpose="visor-documento"] img');
    const s = img?.getAttribute("src") ?? "";
    return { len: s.length, pref: s.slice(0, 60) };
  });
  const fotoGirada = srcAntes.len !== srcDespues.len || srcAntes.pref !== srcDespues.pref;
  const veredictoTrasRotar = (await cuerpo(pagina)).match(VEREDICTOS)?.[0] ?? null;
  const captura6 = capturaDispositivo("a56-editor-06-rotar-toolbar.png");
  paso("rotar 90° desde la toolbar (foto girada, sin re-pipeline)", fotoGirada && veredictoTrasRotar != null, {
    captura: captura6,
    via: viaRotarToolbar,
    srcAntes: srcAntes.len,
    srcDespues: srcDespues.len,
    veredictoAntes: veredictoAntesRotar,
    veredictoDespues: veredictoTrasRotar,
    nota: fotoGirada ? "" : "la foto procesada no cambió",
  });
} finally {
  await navegador.close(); // solo desconecta CDP
}

mkdirSync(RESULTADOS, { recursive: true });
const salida = join(RESULTADOS, `a56-editor-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(salida, JSON.stringify({ cdp: CDP, medidoEn: new Date().toISOString(), pasos }, null, 2));
progreso(`JSON: ${salida}`);
process.exit(pasos.every((p) => p.ok) ? 0 : 1);
