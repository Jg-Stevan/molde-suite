/**
 * verificar-moldes-reales-a56.mjs — banco de ENRUTAMIENTO de las variantes
 * reales en el Galaxy A56 (CDP, sin tocar el navegador del banco).
 *
 * Diferencia con verificar-reales.mjs: aquí NO se siembra un molde activo.
 * Se instala la biblioteca con los 6 moldes de variante (`*_real.molde.json`)
 * y se deja que el router decida por foto — es la prueba de que las variantes
 * se discriminan por geometría/anclas y de que el overlay pinta
 * verde/rojo en manuscritos.
 *
 * Las fotos se sirven desde public/dev-fixtures/reales-variantes/ (gitignored):
 * Chrome Android no puede leer /sdcard desde el DOM, así que el File se arma
 * in-page con fetch + DataTransfer (igual que el picker).
 *
 * Uso:
 *   TAMIZ_ADB_SERIAL=<serial> node scripts/entrega/verificar-moldes-reales-a56.mjs \
 *     [--limite 3] [--solo recibo-b] [--cdp http://127.0.0.1:9223]
 *
 * Salida: tabla por consola + scripts/resultados/moldes-reales-a56-<ts>.json
 * + captura por foto. Exit 1 si alguna foto no enruta o se queda sin acta.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  RESULTADOS,
  capturaDispositivo,
  conectarA56,
  crearProgreso,
  desarmarAutoCaptura,
  enderezarFoto,
  limpiarPwa,
  prepararImporte,
  seleccionarArchivo,
} from "./a56-comun.mjs";

const argDe = (n) => {
  const i = process.argv.indexOf(n);
  return i > -1 ? process.argv[i + 1] : null;
};
const CDP = argDe("--cdp") ?? "http://127.0.0.1:9223";
const SOLO = argDe("--solo");
const LIMITE = Number(argDe("--limite") ?? Infinity);
const DIR_FOTOS = join("apps", "tamiz", "public", "dev-fixtures", "reales-variantes");
const DIR_MOLDES = join("apps", "tamiz", "public", "moldes");

// Un molde por FAMILIA. Las variantes A/B/C son el mismo formulario impreso:
// solo cambia la tinta de relleno (medido 2026-11-25 en el A56: las 3
// variantes empatan en anclas y el router elegía a ciegas). La tinta se
// resuelve por campo (`htr` + `tinta` del resumen), no por molde.
const MOLDES = ["recibo_real", "comprobante_real"].map((k) => ({
  archivo: `${k}.molde.json`,
  texto: readFileSync(join(DIR_MOLDES, `${k}.molde.json`), "utf-8"),
}));

const FOTOS = readdirSync(DIR_FOTOS)
  .filter((f) => /\.(jpe?g|png)$/i.test(f))
  .filter((f) => !SOLO || f.includes(SOLO))
  .sort()
  .slice(0, LIMITE);
if (!FOTOS.length) {
  console.error(`BLOQUEADA: no hay fotos en ${DIR_FOTOS}`);
  process.exit(1);
}

/** Lee el acta RENDERIZADA (no una vieja del historial): sube por la fibra
 *  desde el img del visor hasta el prop `acta` de ReviewView. Sin visor montado
 *  la foto sigue analizando → listo:false (medido 2026-11-26: el walk global
 *  encontraba actas viejas del store y reportaba score/cajas de OTRA foto).
 *  Del DOM, el color real de cada caja de manuscrito del overlay. */
const SONDA = `(() => {
  const img = document.querySelector('[data-purpose="visor-documento"] img');
  const cajas = Array.from(
    document.querySelectorAll('[data-testid="campo-manuscrito"]'),
  ).map((el) => ({
    tipo: el.getAttribute('data-testid'),
    borde: getComputedStyle(el).borderTopColor,
    rotulo: (el.querySelector('[data-testid="campo-manuscrito-etiqueta"]')?.textContent || '').trim(),
  }));
  if (!img) return { listo: false, cajas };
  let acta = null;
  const fiberKey = Object.keys(img).find((k) => k.startsWith('__reactFiber$'));
  let cur = fiberKey ? img[fiberKey] : null;
  let g = 0;
  while (cur && g++ < 120 && !acta) {
    const p = cur.memoizedProps;
    if (p && p.acta && p.acta.evaluacionMolde && typeof p.acta.status === 'string') acta = p.acta;
    // ReviewView lee el acta del store zustand (useE14Store → useSyncExternalStore):
    // el snapshot vive en la cadena de hooks, NO en props (medido 2026-11-26).
    if (!acta) {
      let s = cur.memoizedState;
      let n = 0;
      while (s && n++ < 80 && !acta) {
        const ms = s.memoizedState;
        if (
          ms && typeof ms === 'object' &&
          typeof ms.status === 'string' &&
          typeof ms.id === 'string' &&
          'evaluacionMolde' in ms
        ) acta = ms;
        s = s.next;
      }
    }
    cur = cur.return;
  }
  if (!acta) return { listo: false, cajas };
  const ev = acta.evaluacionMolde;
  return {
    listo: true,
    id: acta.id,
    status: acta.status,
    scoreActa: acta.score,
    molde: ev.moldeNombre,
    enrutado: ev.enrutado === true,
    scoreMolde: ev.score,
    ok: ev.ok,
    total: ev.total,
    faltan: ev.obligatoriosFaltantes || [],
    campos: (ev.campos || []).map((c) => ({
      id: c.id,
      v: typeof c.valor === 'string' ? c.valor.slice(0, 40) : null,
      est: c.estado,
      htr: c.htr === true,
      tinta: c.tinta,
      band: (c.banderas || []).join(','),
    })),
    cajas,
  };
})()`;

const VERDE = "rgb(16, 185, 129)";
const ROJO = "rgb(239, 68, 68)";

const progreso = crearProgreso("moldes-reales-a56-progreso.log");
const { navegador, pagina, sesion } = await conectarA56(CDP);
pagina.on("pageerror", (e) => progreso(`[pageerror] ${String(e).slice(0, 300)}`));

const filas = [];
let indice = 0;

async function esperarActa(ms, excluirId = null) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    // Si el operador cambia de pestaña a mitad del análisis, Chrome Android
    // estrangula los timers: re-forzar el frente en cada poll.
    await pagina.bringToFront().catch(() => {});
    const r = await pagina.evaluate(SONDA).catch(() => null);
    if (r?.listo && r.id !== excluirId) {
      // El acta aparece en el ESTADO antes de que el visor pinte el overlay:
      // sin esta espera las cajas salían 0/0 (medido en el primer lote).
      await pagina.waitForTimeout(1800);
      const r2 = await pagina.evaluate(SONDA).catch(() => null);
      if (r2?.listo) return { ...r2, cajas: r2.cajas.length ? r2.cajas : r.cajas };
      return r;
    }
    const texto = await pagina.locator("body").innerText().catch(() => "");
    if (/RECHAZADA/.test(texto)) return { listo: false, rechazada: true, cajas: r?.cajas ?? [] };
    await pagina.waitForTimeout(3000);
  }
  return null;
}

try {
  progreso(
    `moldes-reales-a56 inicio · CDP=${CDP} · ${FOTOS.length} fotos · moldes=${MOLDES.length} · ${new Date().toISOString()}`,
  );
  await limpiarPwa(pagina, sesion);

  // Biblioteca del teléfono = SOLO los 6 moldes de variante. Se borra lo que
  // dejaron bancos anteriores para que la medición de discriminación sea limpia.
  const filasBiblioteca = MOLDES.map(({ archivo, texto }) => {
    const molde = JSON.parse(texto);
    // El id NO se trunca: las 3 variantes comparten prefijo de nombre
    // ("Comprobante de entrega — …") y truncar a 24 caracteres las colapsaba
    // en una sola fila de IndexedDB (medido: 6 moldes → 4 filas, y la
    // variante ausente "elegía" a la vecina).
    return {
      id: `molde_real_${archivo.replace(/\.molde\.json$/, "")}`,
      nombre: molde.nombre,
      guardadoEn: new Date().toISOString(),
      version: molde.version,
      json: molde,
      _archivo: archivo,
    };
  });
  if (new Set(filasBiblioteca.map((f) => f.id)).size !== filasBiblioteca.length) {
    throw new Error(`ids de biblioteca repetidos: ${filasBiblioteca.map((f) => f.id).join(", ")}`);
  }
  const antes = await pagina.evaluate(async (fs) => {
    const db = await new Promise((res, rej) => {
      const q = indexedDB.open("tamiz-moldes-v1", 1);
      q.onupgradeneeded = () => {
        if (!q.result.objectStoreNames.contains("moldes")) q.result.createObjectStore("moldes", { keyPath: "id" });
      };
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
    const store = db.transaction("moldes", "readwrite").objectStore("moldes");
    const viejo = await new Promise((res) => {
      const r = store.getAll();
      r.onsuccess = () => res(r.result);
    });
    await new Promise((res) => {
      const r = store.clear();
      r.onsuccess = () => res();
    });
    for (const fila of fs) {
      delete fila._archivo;
      await new Promise((res) => {
        const r = store.put(fila);
        r.onsuccess = () => res();
      });
    }
    db.close();
    localStorage.removeItem("tamiz.moldeActivo.v1");
    return { borrados: viejo.map((v) => v.nombre), instalados: fs.length };
  }, filasBiblioteca);
  progreso(`biblioteca: borrados=[${antes.borrados.join(", ")}] instalados=${antes.instalados}`);

  await pagina.goto("http://localhost:3100/", { waitUntil: "domcontentloaded", timeout: 90000 });
  await pagina.locator("input[type=file]").first().waitFor({ state: "attached", timeout: 120000 });
  await desarmarAutoCaptura(pagina);
  capturaDispositivo("moldes-reales-a56-00-inicio.png");

  for (const archivo of FOTOS) {
    // Re-forzar el primer plano POR FOTO: si en medio del lote alguien toca
    // el teléfono y cambia de pestaña, Chrome congela los timers y la foto
    // se queda en «DETECTANDO BORDES» hasta el timeout.
    await pagina.bringToFront().catch(() => {});
    // Una foto mala NO mata el lote (medido 2026-11-26: una excepción sin
    // capturar dejó el run muerto en la foto 13/21 con el teléfono sano).
    try {
      await prepararImporte(pagina);
      await seleccionarArchivo(pagina, `reales-variantes/${archivo}`);
      const t0 = Date.now();
      let r = await esperarActa(420000);
      // Fotos giradas 90° (recibos reales): el quad se cierra sobre un
      // fragmento y la procesada sale como sello diminuto. Se endereza con
      // el MISMO botón del operador y se espera el acta NUEVA.
      if (r?.listo) {
        const toques = await enderezarFoto(pagina, sesion);
        if (toques > 0) {
          const r2 = await esperarActa(420000, r.id);
          if (r2) r = r2;
        }
      }
      const seg = Math.round((Date.now() - t0) / 1000);
      if (!r) {
        filas.push({ archivo, error: "sin acta en 420 s" });
        progreso(`FALLA ${archivo.padEnd(42)} sin acta en 420 s`);
        capturaDispositivo(`mra-${++indice}-error.png`);
        continue;
      }
      const verde = r.cajas.filter((c) => c.borde === VERDE).length;
      const rojo = r.cajas.filter((c) => c.borde === ROJO).length;
      const fila = {
        archivo,
        segundos: seg,
        status: r.status ?? null,
        rechazada: r.rechazada === true,
        molde: r.molde ?? null,
        enrutado: r.enrutado === true,
        scoreMolde: r.scoreMolde ?? null,
        scoreActa: r.scoreActa ?? null,
        ok: r.ok ?? null,
        total: r.total ?? null,
        faltan: r.faltan ?? [],
        campos: r.campos ?? [],
        overlay: { verde, rojo, cajas: r.cajas },
      };
      fila.captura = capturaDispositivo(`mra-${String(++indice).padStart(2, "0")}-${archivo.replace(/\.jpg$/i, "")}.png`);
      const fallos = [];
      if (fila.rechazada) fallos.push("RECHAZADA (no enruta)");
      if (!fila.molde) fallos.push("sin molde");
      if (verde + rojo === 0) fallos.push("overlay sin cajas de manuscrito");
      // Semáforo esperado por variante (el papel es el mismo; cambia el relleno):
      //  A impreso con firmas vacías → relleno verde + firmas rojas;
      //  B formulario en blanco → TODO rojo (ningún verde falso);
      //  C mixto → verde donde hay trazo.
      if (/-b-/.test(archivo) && verde > 0) fallos.push(`verde falso en formulario en blanco (${verde})`);
      if (/-a-/.test(archivo) && rojo === 0) fallos.push("firmas vacías sin rojo");
      if (/-c-/.test(archivo) && verde === 0) fallos.push("mixto sin ningún verde");
      fila.fallos = fallos;
      filas.push(fila);
      progreso(
        `${fallos.length ? "FALLA" : "ok   "} ${archivo.padEnd(42)} ${String(fila.molde ?? "-").padEnd(22)} ` +
          `${fila.scoreMolde ?? "-"}/100 · ${fila.ok ?? "-"}/${fila.total ?? "-"} · verde ${verde} rojo ${rojo} · ${seg}s` +
          (fallos.length ? ` ← ${fallos.join("; ")}` : ""),
      );
    } catch (e) {
      filas.push({ archivo, error: String(e).slice(0, 200) });
      progreso(`FALLA ${archivo.padEnd(42)} ← ${String(e).slice(0, 160)}`);
      capturaDispositivo(`mra-${++indice}-error.png`);
    }
  }
} finally {
  await navegador.close();
}

mkdirSync(RESULTADOS, { recursive: true });
const salida = join(RESULTADOS, `moldes-reales-a56-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(salida, JSON.stringify({ cdp: CDP, medidoEn: new Date().toISOString(), filas }, null, 2));
progreso(`JSON: ${salida}`);
process.exit(filas.some((f) => f.error || f.fallos?.length) ? 1 : 0);
