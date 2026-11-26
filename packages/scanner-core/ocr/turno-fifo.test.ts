/**
 * turno-fifo.test.ts — TEST DE CARRERA del mutex FIFO de reconocimiento
 * (plan de cierre §A2: «test unitario que simule la intercalación (getWorker
 * durante ventana de reciclado)»).
 *
 * La cola real vive en rapidocr.ts (`conTurnoReconocimiento` delega aquí).
 * Estas pruebas reproducen el escenario A56 del 2026-11-26 con actores
 * sintéticos (timers controlados, sin ORT/canvas):
 *   - «prewarm F4» toma el turno y tarda;
 *   - «primer escaneo rapid-first» llega DURANTE el vuelo del prewarm → debe
 *     esperar y correr DESPUÉS (antes intercalaba session.run y se colgaba);
 *   - «getWorker durante ventana de reciclado» (rapidOcrReiniciar suelta el
 *     runtime mientras un reconocimiento está en vuelo): la petición que
 *     llega en ese hueco debe encolarse, no solaparse;
 *   - un reconocimiento que RECHAZA (runtime muerto/watchdog) NO envenena la
 *     cola: el siguiente entra igual.
 */
import { describe, expect, test } from "bun:test";
import { crearTurnoFifo } from "./turno-fifo";

/** Micro-tarea sintética: resuelve tras `ms` con el valor dado. */
function tarea(ms: number, valor: string, registro: string[]) {
  return () =>
    new Promise<string>((resolve, reject) => {
      const t = setTimeout(() => {
        registro.push(`fin:${valor}`);
        resolve(valor);
      }, ms);
      // Permite simular rechazos: valor "!" rechaza al vencer el timer.
      if (valor.startsWith("!")) {
        clearTimeout(t);
        registro.push(`fin:${valor}`);
        reject(new Error(`fallo simulado ${valor}`));
      }
    });
}

describe("crearTurnoFifo — mutex FIFO de reconocimiento RapidOCR (§A2)", () => {
  test("prewarm F4 en vuelo + primer escaneo rapid-first: el escaneo ESPERA y corre después (cero solape)", async () => {
    const fifo = crearTurnoFifo();
    const registro: string[] = [];
    let enVuelo = 0;
    let maxSolape = 0;

    const vigilar = <T>(p: Promise<T>) =>
      p.then((v) => {
        enVuelo--;
        return v;
      });

    // t0: el prewarm F4 pide turno y tarda 20 ms.
    enVuelo++;
    const prewarm = fifo.correr(async () => {
      registro.push("inicio:prewarm");
      await new Promise((r) => setTimeout(r, 20));
      registro.push("fin:prewarm");
      return "prewarm";
    });
    vigilar(prewarm);

    // t≈5ms: el primer escaneo rapid-first llega DURANTE el vuelo del prewarm.
    await new Promise((r) => setTimeout(r, 5));
    enVuelo++;
    const escaneo = fifo.correr(async () => {
      registro.push("inicio:escaneo");
      await new Promise((r) => setTimeout(r, 10));
      registro.push("fin:escaneo");
      return "escaneo";
    });
    vigilar(escaneo);

    const [r1, r2] = await Promise.all([prewarm, escaneo]);

    expect(r1).toBe("prewarm");
    expect(r2).toBe("escaneo");
    // Orden estricto de pedido y una a una.
    expect(registro).toEqual([
      "inicio:prewarm",
      "fin:prewarm",
      "inicio:escaneo",
      "fin:escaneo",
    ]);
    expect(maxSolape).toBe(0);
  });

  test("getWorker durante ventana de reciclado: la petición en ese hueco se ENCOLA y corre tras la que vuela", async () => {
    const fifo = crearTurnoFifo();
    const registro: string[] = [];

    // Escaneo N vuela (30 ms). El reciclado post-veredicto suelta el runtime
    // mientras tanto (aquí: solo marca tiempo); un getWorker/rapidOcrInit
    // llega a los 10 ms — dentro de la ventana — y debe quedar DETRÁS.
    const escaneoN = fifo.correr(async () => {
      registro.push("inicio:escaneoN");
      await new Promise((r) => setTimeout(r, 30));
      registro.push("fin:escaneoN");
      return "N";
    });
    await new Promise((r) => setTimeout(r, 10));
    const getWorker = fifo.correr(async () => {
      registro.push("inicio:getWorker");
      return "w";
    });

    const [rn, rw] = await Promise.all([escaneoN, getWorker]);
    expect(rn).toBe("N");
    expect(rw).toBe("w");
    expect(registro).toEqual(["inicio:escaneoN", "fin:escaneoN", "inicio:getWorker"]);
  });

  test("un reconocimiento que RECHAZA no envenena la cola (el siguiente entra igual)", async () => {
    const fifo = crearTurnoFifo();
    const registro: string[] = [];

    const muerto = fifo.correr(async () => {
      registro.push("inicio:muerto");
      throw new Error("runtime terminado");
    });
    await expect(muerto).rejects.toThrow("runtime terminado");

    // El turno siguiente llega tras el rechazo y DEBE correr igual.
    const siguiente = fifo.correr(async () => {
      registro.push("inicio:siguiente");
      return "siguiente";
    });
    expect(await siguiente).toBe("siguiente");
    expect(registro).toEqual(["inicio:muerto", "inicio:siguiente"]);
  });

  test("cero solape bajo N peticiones concurrentes y orden FIFO de arranque", async () => {
    const fifo = crearTurnoFifo();
    let enVuelo = 0;
    let maxSolape = 0;
    const orden: number[] = [];

    const correrUno = (i: number) =>
      fifo.correr(async () => {
        enVuelo++;
        maxSolape = Math.max(maxSolape, enVuelo);
        orden.push(i);
        await new Promise((r) => setTimeout(r, 2));
        enVuelo--;
        return i;
      });

    // 8 peticiones simultáneas (warm-up + router + rec-lote + escaneos...).
    const resultados = await Promise.all([0, 1, 2, 3, 4, 5, 6, 7].map(correrUno));
    expect(resultados).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(orden).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(maxSolape).toBe(1);
  });

  test("alObtenerTurno reporta la espera: cero en la ruta única, >0 cuando llegó durante el vuelo", async () => {
    const fifo = crearTurnoFifo();

    let espera1 = -1;
    const solo = fifo.correr(async () => "solo", (ms) => (espera1 = ms));
    await solo;
    expect(espera1).toBeGreaterThanOrEqual(0);
    expect(espera1).toBeLessThan(50); // sin contención ≈ 0

    let espera2 = -1;
    const larga = fifo.correr(async () => {
      await new Promise((r) => setTimeout(r, 25));
      return "larga";
    });
    await new Promise((r) => setTimeout(r, 5));
    let espera3 = -1;
    const tras = fifo.correr(async () => "tras", (ms) => (espera3 = ms));
    await Promise.all([larga, tras]);
    expect(espera3).toBeGreaterThanOrEqual(15); // esperó el vuelo de «larga»
  });
});
