/**
 * diag-a56-hit.mjs — diagnóstico puntual (A56 real): abre el QuadEditor por
 * toque y pregunta al navegador qué elemento recibe el toque en el centro de
 * APLICAR RECORTE, más los fondos computados (rgba(0,0,0,0) delata CSS
 * cacheado por el service worker).
 *
 * Uso: node scripts/entrega/diag-a56-hit.mjs [--cdp http://127.0.0.1:9223]
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { RESULTADOS, conectarA56, tocar } from "./a56-comun.mjs";

const argCdp = process.argv.indexOf("--cdp");
const CDP = argCdp > -1 ? process.argv[argCdp + 1] : "http://127.0.0.1:9223";

const { navegador, pagina, sesion } = await conectarA56(CDP);

// Abrir el editor si no está abierto.
const dialogo = pagina.getByRole("dialog", { name: /Ajuste de bordes del documento/i });
if (!(await dialogo.count())) {
  await tocar(pagina, sesion, pagina.getByRole("button", { name: /Recortar/i }).first(), "Recortar");
  await dialogo.waitFor({ state: "visible", timeout: 20000 });
}
await pagina.waitForTimeout(1500);

const diag = await pagina.evaluate(() => {
  const aplicar = document.querySelector('[aria-label="Aplicar el recorte"]');
  const cancelar = document.querySelector('[aria-label="Cancelar el ajuste de bordes"]');
  const rotarEd = document.querySelector('[aria-label="Rotar la imagen 90 grados"]');
  const caja = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const describir = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName,
      aria: el.getAttribute("aria-label"),
      texto: (el.textContent || "").trim().slice(0, 40),
      clase: String(el.className).slice(0, 120),
      z: cs.zIndex,
      pos: cs.position,
    };
  };
  const c = caja(aplicar);
  const punto = c ? { x: c.x + c.w / 2, y: c.y + c.h / 2 } : null;
  const arriba = punto ? document.elementFromPoint(punto.x, punto.y) : null;
  const pilaArriba = punto ? document.elementsFromPoint(punto.x, punto.y) : [];
  const footer = aplicar && aplicar.closest("footer");
  const dialog = document.querySelector('[role="dialog"][aria-label="Ajuste de bordes del documento"]');
  const fondo = (el) => (el ? getComputedStyle(el).backgroundColor : null);
  const csDialog = dialog && getComputedStyle(dialog);
  const animaciones = dialog
    ? dialog.getAnimations({ subtree: true }).map((a) => ({ playState: a.playState }))
    : [];
  return {
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    aplicar: caja(aplicar),
    cancelar: caja(cancelar),
    rotarEditor: caja(rotarEd),
    centroAplicar: punto,
    elementoArriba: describir(arriba),
    pila: pilaArriba.slice(0, 6).map(describir),
    fondos: { dialogo: fondo(dialog), footer: fondo(footer), aplicar: fondo(aplicar) },
    dialogBackdrop: csDialog?.backdropFilter,
    animaciones,
  };
});

writeFileSync(join(RESULTADOS, "diag-a56-hit.json"), JSON.stringify(diag, null, 2));
console.log(JSON.stringify(diag, null, 2));

// Cerrar el editor para dejar la app como estaba.
await tocar(pagina, sesion, pagina.getByRole("button", { name: /Cancelar el ajuste de bordes/i }), "CANCELAR");
await pagina.waitForTimeout(800);
await navegador.close();
