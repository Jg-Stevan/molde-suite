/**
 * KIT qr-prechequeo-capa0-v1 (PLAN-AGENTE-EXTERNO, tarea A · P1) —
 * PRE-CHEQUEO BARATO de patrones localizadores QR.
 *
 * Motivo: cada escaneo SIN QR pagaba ~9.5 s muertos (log `qr-capa0-worker …
 * ms=95xx fin=vencido` — el acta muestra «CÓDIGO QR NO CORRIÓ EN ESTA
 * CAPTURA»): el worker de capa 0 mordía su presupuesto (8 s/5 s por tier) +
 * rescate zxing + camino base sobre una captura donde NO hay ningún QR que
 * pagar. Este módulo decide EN pocos ms si la captura tiene señales de
 * patrón localizador (los cuadrados concéntricos 1:1:3:1:1 que TODO QR
 * lleva) ANTES de arrancar el worker; el cliente (capa0-qr.client.ts) corta
 * a null inmediato cuando no hay señal.
 *
 * Doctrina (tarea A — GENEROSO contra falsos negativos: un falso positivo
 * sólo cuesta el camino de hoy ~9.5 s; un falso negativo PIERDE un QR real):
 *  · Umbral: OTSU (una foto de documento tiene dos modos claros papel/tinta)
 *    con fallback a 128 si la imagen es uniforme (varianza entre clases ~0 —
 *    p. ej. captura vacía: todo claro → sin runs → sin-candidato honesto).
 *    OTSU elegido sobre el fijo ~128: con iluminación tenue un fijo 128
 *    clasifica TODO oscuro → sin runs → falso negativo sistemático.
 *  · Tolerancia ±35% POR RUN contra la unidad de la ventana (banda clásica
 *    de los detectores run-length; absorbe inclinación, desenfoque y el
 *    jitter del muestreo nearest).
 *  · Confirmación vertical generosa: la ventana de columna vale si pasa la
 *    MISMA relación y (el run oscuro medio cubre ±2 filas del candidato O su
 *    centro cae a ≤ max(2, unitV) de la fila candidata) y la unidad vertical
 *    es compatible con la horizontal (factor 2 — tolera inclinación fuerte).
 *  · candidato con ≥2 patrones (un QR necesita 3, pero puede estar
 *    parcialmente ocluido por el dedo o la sombra — 2 evita el falso negativo).
 *
 * DOS PASES de escala (lección H-6 del doc hermano: el QR de campo mide
 * ~3-8% del ancho de la captura):
 *  · Pase 1 — lado largo ≤ PRECHEQUEO_LADO_LARGO (320): el pase barato
 *    (≤320² ≈ 102k px). Con módulo mínimo 2 px sólo ve QRs ≥ ~13% del ancho
 *    (el QR debe medir ≥ 42 px a 320) — ahí vive el fixture de aceptación
 *    (scripts/resultados/fixtures/qr-test-capa0.png, QR 400×400).
 *  · Pase 2 (RESCATE de resolución) — SÓLO si el pase 1 encontró <2 patrones
 *    y la fuente tiene más resolución: lado ≤ PRECHEQUEO_RESCATE_LADO (1280).
 *    Un QR del 5% de una captura de cámara de 1280 px mide 64 px → módulo
 *    ~3 px: INVISIBLE a 320, detectable a 1280. Sin el pase 2 el pre-chequeo
 *    fabricaría falsos negativos SISTEMÁTICOS sobre los QRs reales de campo
 *    (la peor regresión posible). Costo acotado (~5-10 ms) frente a los
 *    ~9.5 s que ahorra el camino sin-QR; el pase corta al llegar a 3
 *    patrones (confianza saturada).
 *
 * PURA: cero DOM, cero canvas, cero reló — testeable en bun (los tests viven
 * en prechequeo-qr.test.ts, SIN DOM). Jamás throw: cualquier entrada rara
 * (dimensiones inválidas, buffer corto) devuelve sin-candidato honesto — el
 * caller (que jamás puede bloquearse por el pre-chequeo) decide. La única
 * pieza con DOM es el wrapper prechequeoDesdeCanvas, para callers que YA
 * tienen un canvas acotado.
 */

/** Fuente de píxeles RGBA — la MISMA forma que devuelve getImageData (4
 *  bytes por píxel, fila por fila), sin acoplarse a ImageData para seguir
 *  pura y testeable headless. */
export interface ImagenAnalizable {
  width: number;
  height: number;
  rgba: Uint8Array | Uint8ClampedArray;
}

/** Resultado del pre-chequeo — contrato del kit (tarea A). */
export interface ResultadoPrechequeo {
  /** ¿Hay señales de patrón localizador QR? false ⇒ la capa 0 puede correr
   *  el camino corto (null inmediato) sin pagar worker ni rescate. */
  candidato: boolean;
  /** 0..1 — min(1, patrones/3): un QR completo visto da 3 patrones. */
  confianza: number;
  /** Nº de patrones localizadores detectados (deduplicados por proximidad). */
  patrones: number;
}

// ─── Constantes del algoritmo (doctrina en el header) ───────────────────────

/** Pase 1 — lado largo del análisis barato (tarea A: ≤ 320 px, nearest). */
export const PRECHEQUEO_LADO_LARGO = 320;

/** Pase 2 (rescate de resolución) — lado máximo del análisis fino. Motivo en
 *  el header: el QR de campo (3-8% del ancho) exige ≥1280 para módulo ≥2 px. */
export const PRECHEQUEO_RESCATE_LADO = 1280;

/** Tolerancia ±35% POR RUN contra la unidad de la ventana (tarea A). */
const TOLERANCIA_RUN = 0.35;

/** Módulo mínimo en px TRAS el downscale (tarea A) — se exige como unidad Y
 *  como piso de cada run: un run de 1 px es jitter del nearest, no estructura. */
const MODULO_MINIMO_PX = 2;

/** Escaneo de filas cada 2 px (tarea A) — un patrón mide ≥ 7·2 = 14 px de
 *  alto: saltarse filas no lo pierde y parte el costo del escaneo a la mitad. */
const PASO_FILAS = 2;

/** candidato ⇒ ≥2 patrones (tarea A: 3 es el QR completo, 2 cubre oclusión). */
const CANDIDATO_MINIMO = 2;

/** Techo del conteo — la confianza satura en 3 (min(1, patrones/3)): al
 *  llegar a 3 patrones el escaneo corta (early-exit del pase). */
const PATRONES_TECHO = 3;

/** Radio de dedup en unidades de módulo: los candidatos que la MISMA cruz
 *  produce en filas distintas caen a ≤ ~3·unit entre sí; dos patrones
 *  distintos de UN MISMO QR separan ≥ 14·unit (v1: centros a 14 módulos).
 *  5·unit con piso de 10 px separa limpio sin fusionar vecinos reales. */
const DEDUP_RADIO_UNIDADES = 5;

/** Compatibilidad de escala horizontal↔vertical exigida a la ventana de
 *  columna confirmatoria (factor 2 — generoso: un patrón real mide lo mismo
 *  en ambos ejes; el factor absorbe inclinación fuerte y perspectiva). */
const COMPAT_ESCALA = 2;

/** Resultado sin-candidato honesto (objeto fresco — el caller puede conservarlo). */
function resultadoVacio(): ResultadoPrechequeo {
  return { candidato: false, confianza: 0, patrones: 0 };
}

/**
 * Detecta patrones localizadores QR (cuadrados concéntricos 1:1:3:1:1) sobre
 * RGBA. Pura, sin DOM, jamás throw (tarea A — ver header para la doctrina y
 * los motivos de cada constante).
 */
export function detectarPatronesLocalizador(img: ImagenAnalizable): ResultadoPrechequeo {
  try {
    const w = img.width;
    const h = img.height;
    // Guardas de entrada: dimensiones sanas y buffer completo (un patrón
    // necesita 5 runs ≥2 px ≈ 14 px de ancho — debajo de 16 px no hay nada
    // que ver; el guard también evita divisiones degeneradas del muestreo).
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 16 || h < 16) {
      return resultadoVacio();
    }
    if (!img.rgba || img.rgba.length < w * h * 4) return resultadoVacio();

    const ladoFuente = Math.max(w, h);
    // Pase 1 — el barato (≤320): decide los QR grandes y el fixture de aceptación.
    let patrones = escaneoAScala(img, Math.min(PRECHEQUEO_LADO_LARGO, ladoFuente));
    // Pase 2 — rescate de resolución (header: QR de campo 3-8% invisible a
    // 320). Sólo si el pase 1 no alcanzó el mínimo Y hay más resolución que
    // mirar (si la fuente ya es ≤320, el pase 1 la vio completa: idéntico).
    if (patrones < CANDIDATO_MINIMO && ladoFuente > PRECHEQUEO_LADO_LARGO) {
      const patronesRescate = escaneoAScala(img, Math.min(PRECHEQUEO_RESCATE_LADO, ladoFuente));
      if (patronesRescate > patrones) patrones = patronesRescate; // max — la misma cruz en dos escalas NO suma dos patrones
    }
    return {
      candidato: patrones >= CANDIDATO_MINIMO,
      confianza: Math.min(1, patrones / PATRONES_TECHO),
      patrones,
    };
  } catch {
    // Un pre-chequeo roto no puede bloquear la capa 0 (tarea A: jamás throw).
    return resultadoVacio();
  }
}

/**
 * UN pase de escaneo a UNA escala: downscale nearest a `lado` de lado largo +
 * Otsu + run-length 1:1:3:1:1 por fila (paso PASO_FILAS) + confirmación por
 * columna en el centro del candidato + dedup por proximidad. Devuelve el nº
 * de patrones confirmados. Interna — pura, sin reló, sin throw.
 */
function escaneoAScala(img: ImagenAnalizable, lado: number): number {
  const w = img.width;
  const h = img.height;
  // 1) GRIS + downscale nearest a `lado` de lado largo (tarea A). Nearest por
  //    costo (un bilinear duplicaría el muestreo); el jitter que introduce lo
  //    absorbe la tolerancia ±35%. Mapeo exacto gx→floor(gx·w/gw) (sin sesgo).
  const escala = Math.min(1, lado / Math.max(w, h));
  const gw = Math.max(1, Math.round(w * escala));
  const gh = Math.max(1, Math.round(h * escala));
  const gris = new Uint8Array(gw * gh);
  const rgba = img.rgba;
  for (let gy = 0; gy < gh; gy++) {
    const sy = Math.min(h - 1, Math.floor((gy * h) / gh));
    const filaFuente = sy * w * 4;
    const filaGris = gy * gw;
    for (let gx = 0; gx < gw; gx++) {
      const sx = Math.min(w - 1, Math.floor((gx * w) / gw));
      const i = filaFuente + sx * 4;
      // Luma Rec.709 (MISMOS coeficientes que binarizadaQrDePixeles del
      // paquete — coherencia). El alfa se ignora: las capturas son opacas.
      gris[filaGris + gx] =
        (0.2126 * rgba[i]! + 0.7152 * rgba[i + 1]! + 0.0722 * rgba[i + 2]!) | 0;
    }
  }
  // 2) BINARIZA (Otsu + fallback 128 — doctrina en el header). 1 = oscuro.
  const umbral = umbralOtsu(gris);
  const bin = new Uint8Array(gw * gh);
  for (let p = 0; p < gris.length; p++) bin[p] = gris[p]! <= umbral ? 1 : 0;

  // Buffers de runs preasignados UNA vez (cero churn en el escaneo: el máx
  // de runs por fila es gw, por columna es gh).
  const filaLen = new Int32Array(gw);
  const filaIni = new Int32Array(gw);
  const filaOsc = new Uint8Array(gw);
  const colLen = new Int32Array(gh);
  const colIni = new Int32Array(gh);
  const colOsc = new Uint8Array(gh);

  // Patrones confirmados — dedup por proximidad (constante DEDUP_RADIO_UNIDADES).
  const cxGuardados: number[] = [];
  const cyGuardados: number[] = [];
  let patrones = 0;

  const registrar = (cx: number, cy: number, unit: number): void => {
    const radio = Math.max(10, DEDUP_RADIO_UNIDADES * unit);
    for (let k = 0; k < patrones; k++) {
      const dx = cx - cxGuardados[k]!;
      const dy = cy - cyGuardados[k]!;
      if (dx * dx + dy * dy < radio * radio) return; // la misma cruz vista en otra fila/columna
    }
    cxGuardados.push(cx);
    cyGuardados.push(cy);
    patrones++;
  };

  /** Confirmación del candidato horizontal (cx, yFila): la MISMA secuencia
   *  1:1:3:1:1 en la columna del centro (tarea A). Generosa — ver header. */
  const confirmaColumna = (cxF: number, yFila: number, unitH: number): boolean => {
    const cx = Math.min(gw - 1, Math.max(0, Math.round(cxF)));
    // Runs de la columna completa (una pasada; buffers reutilizados).
    let n = 0;
    let colorActual = bin[cx]!; // fila 0
    let ini = 0;
    for (let y = 1; y < gh; y++) {
      const c = bin[y * gw + cx]!;
      if (c !== colorActual) {
        colLen[n] = y - ini;
        colIni[n] = ini;
        colOsc[n] = colorActual;
        n++;
        colorActual = c;
        ini = y;
      }
    }
    colLen[n] = gh - ini;
    colIni[n] = ini;
    colOsc[n] = colorActual;
    n++;
    for (let i = 0; i + 5 <= n; i++) {
      if (colOsc[i]! !== 1) continue; // la ventana debe arrancar OSCURO
      const unitV = ventanaValida(
        colLen[i]!,
        colLen[i + 1]!,
        colLen[i + 2]!,
        colLen[i + 3]!,
        colLen[i + 4]!,
      );
      if (unitV === null) continue;
      // Compatibilidad de escala h↔v: un patrón real mide lo mismo en ambos
      // ejes; el factor 2 tolera inclinación fuerte (anti-falso-negativo).
      if (unitV < unitH / COMPAT_ESCALA || unitV > unitH * COMPAT_ESCALA) continue;
      const inicio = colIni[i + 2]!;
      const fin = inicio + colLen[i + 2]!;
      const centroV = inicio + colLen[i + 2]! / 2;
      // «≥2 filas por encima/debajo coherentes» (tarea A): el run oscuro medio
      // vertical cubre [y-2, y+2] (patrón derecho) O su centro cae a
      // ≤ max(2, unitV) de la fila candidata (patrón inclinado/graduado).
      if (
        (inicio <= yFila - 2 && fin >= yFila + 2) ||
        Math.abs(centroV - yFila) <= Math.max(2, unitV)
      ) {
        return true;
      }
    }
    return false;
  };

  // 3) ESCANEO de TODAS las filas (paso PASO_FILAS — tarea A).
  for (let y = 0; y < gh; y += PASO_FILAS) {
    // Runs de la fila (una pasada; buffers preasignados). El filo de la
    // imagen corta el último run — el patrón puede tocar el filo (se cierra
    // explícitamente tras el bucle).
    let n = 0;
    let colorActual = bin[y * gw]!;
    let ini = 0;
    for (let x = 1; x < gw; x++) {
      const c = bin[y * gw + x]!;
      if (c !== colorActual) {
        filaLen[n] = x - ini;
        filaIni[n] = ini;
        filaOsc[n] = colorActual;
        n++;
        colorActual = c;
        ini = x;
      }
    }
    filaLen[n] = gw - ini;
    filaIni[n] = ini;
    filaOsc[n] = colorActual;
    n++;
    // Ventanas de 5 runs consecutivos arrancando OSCURO.
    for (let i = 0; i + 5 <= n; i++) {
      if (filaOsc[i]! !== 1) continue;
      const unit = ventanaValida(
        filaLen[i]!,
        filaLen[i + 1]!,
        filaLen[i + 2]!,
        filaLen[i + 3]!,
        filaLen[i + 4]!,
      );
      if (unit === null) continue;
      // Centro del patrón = centro del run oscuro MEDIO (el 3·unit).
      const cx = filaIni[i + 2]! + filaLen[i + 2]! / 2;
      if (!confirmaColumna(cx, y, unit)) continue;
      registrar(cx, y, unit);
      if (patrones >= PATRONES_TECHO) return patrones; // confianza saturada — cortar el pase
    }
  }
  return patrones;
}

/**
 * ¿[d1 l2 d3 l4 d5] es la secuencia 1:1:3:1:1 (oscuro-claro-oscuro-claro-
 * oscuro) dentro de la tolerancia ±35% por run? Devuelve la unidad (tamaño
 * de módulo en px) o null si no es patrón. unit = Σruns/7 (la ventana se
 * auto-normaliza — técnica clásica de los detectores run-length de QR).
 */
function ventanaValida(
  d1: number,
  l2: number,
  d3: number,
  l4: number,
  d5: number,
): number | null {
  // Módulo ≥ 2 px tras el downscale (tarea A) Y cada run ≥ 2 px: un run de
  // 1 px es jitter del nearest, no estructura.
  if (
    d1 < MODULO_MINIMO_PX ||
    l2 < MODULO_MINIMO_PX ||
    d3 < MODULO_MINIMO_PX ||
    l4 < MODULO_MINIMO_PX ||
    d5 < MODULO_MINIMO_PX
  ) {
    return null;
  }
  const unit = (d1 + l2 + d3 + l4 + d5) / 7;
  if (unit < MODULO_MINIMO_PX) return null;
  if (Math.abs(d1 - unit) > TOLERANCIA_RUN * unit) return null;
  if (Math.abs(l2 - unit) > TOLERANCIA_RUN * unit) return null;
  if (Math.abs(d3 - 3 * unit) > TOLERANCIA_RUN * 3 * unit) return null;
  if (Math.abs(l4 - unit) > TOLERANCIA_RUN * unit) return null;
  if (Math.abs(d5 - unit) > TOLERANCIA_RUN * unit) return null;
  return unit;
}

/**
 * Umbral de OTSU (máxima varianza entre clases) con fallback a 128 cuando la
 * imagen es uniforme (mejorVar ≤ 0 — Otsu no separa nada; p. ej. captura
 * vacía/blanca: todo claro → sin runs → sin-candidato honesto). Motivo de la
 * elección en el header (un fijo 128 fabrica falsos negativos con iluminación
 * tenue). Pura.
 */
function umbralOtsu(gris: Uint8Array): number {
  const hist = new Int32Array(256);
  for (let p = 0; p < gris.length; p++) hist[gris[p]!]++;
  const total = gris.length;
  let sumaTotal = 0;
  for (let v = 0; v < 256; v++) sumaTotal += v * hist[v]!;
  let sumaB = 0;
  let wB = 0;
  let mejorVar = -1;
  let umbral = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!;
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumaB += t * hist[t]!;
    const mB = sumaB / wB;
    const mF = (sumaTotal - sumaB) / wF;
    const entre = wB * wF * (mB - mF) * (mB - mF);
    if (entre > mejorVar) {
      mejorVar = entre;
      umbral = t;
    }
  }
  // Degenerado (imagen uniforme): Otsu no separa → umbral fijo 128 (doctrina
  // en el header — sin señal estructural, el pre-chequeo no inventa candidato).
  if (mejorVar <= 0) return 128;
  return umbral;
}

// ─── Wrapper DOM (única pieza con canvas — callers que YA tienen uno) ───────

/**
 * Wrapper DOM del pre-chequeo: getImageData + downscale interno (tarea A).
 * Para un canvas GRANDE (foto completa) el getImageData entero son decenas de
 * MB: se remuestrea primero a un canvas temporal del lado del pase de rescate
 * (el detector remuestrea a ≤320 con nearest para el pase 1; el pase 2 vive a
 * esta escala). Jamás throw: canvas contaminado (CORS), contexto no-2d o SSR
 * sin DOM devuelven sin-candidato honesto — el caller decide.
 */
export function prechequeoDesdeCanvas(canvas: HTMLCanvasElement): ResultadoPrechequeo {
  try {
    if (!canvas || canvas.width < 1 || canvas.height < 1) return resultadoVacio();
    let fuente = canvas;
    const lado = Math.max(canvas.width, canvas.height);
    if (lado > PRECHEQUEO_RESCATE_LADO) {
      if (typeof document === "undefined") return resultadoVacio(); // SSR: sin señal honesta
      const escala = PRECHEQUEO_RESCATE_LADO / lado;
      const temp = document.createElement("canvas");
      temp.width = Math.max(1, Math.round(canvas.width * escala));
      temp.height = Math.max(1, Math.round(canvas.height * escala));
      const tctx = temp.getContext("2d", { willReadFrequently: true });
      if (!tctx) return resultadoVacio();
      tctx.imageSmoothingEnabled = true;
      tctx.imageSmoothingQuality = "high";
      tctx.drawImage(canvas, 0, 0, temp.width, temp.height);
      fuente = temp;
    }
    const ctx = fuente.getContext("2d", { willReadFrequently: true });
    if (!ctx) return resultadoVacio();
    const data = ctx.getImageData(0, 0, fuente.width, fuente.height);
    return detectarPatronesLocalizador({ width: data.width, height: data.height, rgba: data.data });
  } catch {
    // getImageData puede reventar (canvas contaminado por CORS) ⇒ sin señal
    // honesta — jamás throw (el caller no puede pagar una excepción aquí).
    return resultadoVacio();
  }
}
