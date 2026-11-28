'use client';

// ─── PUERTO F-LENS v5 (digielect14) · selección del sensor trasero ─────────
// Con `facingMode: 'environment'` a secas Chrome elige el sensor QUIEN: en un
// Galaxy A56 negocia la GRAN ANGULAR (foco fijo → acta desenfocada a 30 cm y
// sin linterna). El camino de campo probado es: desbloqueo de labels → SONDEO
// SECUENCIAL de cada cámara (abrir-medir-cerrar, nunca dos vivas) → elección
// por facing primero y AF/resolución después → apertura VERIFICADA de la
// ganadora → red de seguridad por cascada. La elección se cachea con la huella
// del conjunto de cámaras y los caps medidos: si el driver renumera la lente,
// el track abierto no cuadra con lo cacheado y se re-sondea. La caché
// envenenada con una FRONTAL se sana al leerla (bug de campo del mantenedor).
//
// Orden y reglas conservadas byte a byte del upstream (D3 AF→resolución, D6
// sin AF en iOS→label simple, PROBE_TIMEOUT_MS, guardas de facing v5), más el
// guard anti-UW de campo E15: una trasera con < 65 % del área de la mayor no
// puede ser la principal aunque su sonda reporte AF.

const BACK_CAMERA_RE = /back|rear|environment|trasera|posterior|arri[eè]re/i;
const FRONT_CAMERA_RE = /front|delantera|anterior|face|facial|selfie/i;

/** Preview: 1280×720 ideal. La foto no sale del preview sino de `takePhoto`
 *  (escalera 2048×1536 + full-res en segundo plano), así que bajar el stream
 *  a 720p alivia CPU/memoria en equipos ≤ 4 GB sin tocar la captura. */
const IDEAL_PREVIEW_WIDTH = 1280;
const IDEAL_PREVIEW_HEIGHT = 720;
const IDEAL_PREVIEW_FPS = 30;

/** Plazo por sonda: una cámara colgada (driver Android lento) no puede
 *  bloquear el arranque 10 s — caduca y se sigue con la siguiente. */
const PROBE_TIMEOUT_MS = 2000;

/** Plazo de las aperturas REALES (no sondas): un permiso sin responder o un
 *  sensor ocupado dejaban «INICIANDO CÁMARA…» infinito en el A56 (medido
 *  2026-11-26: la vista de escaneo quedó atascada en esa pantalla). Vencido
 *  el plazo la apertura se da por fallida — el caller cae a su aviso con
 *  salida a SIMULACIÓN — y un stream que llegue tarde se cierra al aparecer. */
const OPEN_TIMEOUT_MS = 15_000;

/** Clave de la elección (la misma del upstream: tamiz es la continuación de
 *  e14, y el cacheado es por origen, así que no colisiona con el lab). */
const MAIN_CAMERA_CACHE_KEY = 'e14-main-camera-v1';

/** Regla relativa (E15): una trasera con < 65 % del área de la mayor no puede
 *  ser la principal (ultra gran angular/macro), aunque su sonda reporte AF.
 *  En el A12 la UW (GC5035, 5 MP) llegó a quedar cacheada como principal. */
const UMBRAL_AREA_PRINCIPAL = 0.65;

/** Tolerancia al comparar caps del track con la sonda/caché (redondeos del
 *  driver entre una apertura «pelada» y una con constraints). */
const TOLERANCIA_CAPS = 0.1;

export interface CameraProbeResult {
  deviceId: string;
  label: string;
  focusModes: string[];
  torch: boolean;
  maxWidth: number;
  maxHeight: number;
  /** Lo que el track REAL reporta ('user' | 'environment' | undefined). */
  facingMode?: string;
}

export interface EleccionCamara {
  stream: MediaStream | null;
  /** Sondas medidas (telemetría de QA). */
  sondas: CameraProbeResult[];
  /** Sonda ganadora (null si se abrió por cascada). */
  main: CameraProbeResult | null;
  /** true cuando el fallo fue de PERMISO (NotAllowedError/SecurityError): el
   *  visor debe avisar «permiso denegado», no «sin señal» — los sondeos y la
   *  cascada tragan excepciones, así que el motivo se propaga acá. */
  permisoDenegado: boolean;
}

interface MainCameraCache {
  deviceId: string;
  label: string;
  score: number;
  at: number;
  torch: boolean;
  focusModes: string[];
  maxWidth: number;
  maxHeight: number;
  facingMode?: string;
  /** Huella del conjunto de videoinput al escribir (ver `huellaDispositivos`). */
  devicesKey?: string;
}

/** Modos de foco que cuentan como autofocus REAL (regla D3). */
const REAL_AF_MODES = new Set(['continuous', 'single-shot']);

function areaSonda(p: CameraProbeResult): number {
  return p.maxWidth * p.maxHeight;
}

/** Sin sensor principal reportado (caps vacías) no se descarta nada. */
function poolSinMenores(pool: CameraProbeResult[]): CameraProbeResult[] {
  if (pool.length <= 1) return pool;
  const mayor = Math.max(...pool.map(areaSonda));
  if (mayor <= 0) return pool;
  const grandes = pool.filter((p) => areaSonda(p) >= mayor * UMBRAL_AREA_PRINCIPAL);
  return grandes.length > 0 ? grandes : pool;
}

/** djb2 sobre los deviceId de videoinput ordenados: identifica el CONJUNTO de
 *  cámaras. Si el driver renumera o aparece/desaparece una lente, cambia y la
 *  caché se invalida (antes solo se invalidaba por facing o fallo de apertura). */
export function huellaDispositivos(deviceIds: string[]): string {
  const s = [...deviceIds].sort().join('|');
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `d${(h >>> 0).toString(36)}-${deviceIds.length}`;
}

/** ¿Los caps del track abierto corresponden a lo que midió la sonda/caché?
 *  Sin reporte de ningún lado no se puede refutar: pasa. */
export function capsCoinciden(
  esperado: { maxWidth: number; maxHeight: number },
  actual: { width?: number; height?: number } | null,
  tolerancia = TOLERANCIA_CAPS,
): boolean {
  if (!actual || !actual.width || !actual.height) return true;
  if (!esperado.maxWidth || !esperado.maxHeight) return true;
  const cerca = (a: number, b: number): boolean => Math.abs(a - b) <= Math.max(a, b) * tolerancia;
  return cerca(actual.width, esperado.maxWidth) && cerca(actual.height, esperado.maxHeight);
}

interface LenteActual {
  label: string;
  torch: boolean;
  focusModes: string[];
  width?: number;
  height?: number;
}

function leerLenteDeStream(stream: MediaStream): LenteActual | null {
  try {
    const track = stream.getVideoTracks()[0];
    if (!track) return null;
    const caps = (track.getCapabilities?.() ?? {}) as {
      torch?: boolean;
      focusMode?: string[];
      width?: { max?: number };
      height?: { max?: number };
    };
    return {
      label: track.label || '',
      torch: caps.torch === true,
      focusModes: Array.isArray(caps.focusMode) ? caps.focusMode : [],
      width: caps.width?.max,
      height: caps.height?.max,
    };
  } catch {
    return null;
  }
}

/** Coincidencia completa de la lente esperada (sonda/caché) con la abierta:
 *  label, torch, AF real y caps. En el A12 camera 0 y camera 2 reportan el
 *  MISMO máximo (2576×1932): solo torch/AF/label distinguen la principal de
 *  la UW (E15); con solo caps la caché envenenada seguiría pasando. */
export function lenteCoincide(
  esperado: { label: string; torch: boolean; focusModes: string[]; maxWidth: number; maxHeight: number },
  actual: LenteActual | null,
): boolean {
  if (!actual) return true; // sin reporte no se puede refutar
  const labelOk = !esperado.label || !actual.label || esperado.label === actual.label;
  const torchOk = !esperado.torch || actual.torch;
  const afOk = !tieneRealAF(esperado.focusModes) || tieneRealAF(actual.focusModes);
  const capsOk = capsCoinciden(
    { maxWidth: esperado.maxWidth, maxHeight: esperado.maxHeight },
    actual,
  );
  return labelOk && torchOk && afOk && capsOk;
}

function tieneRealAF(modes: string[]): boolean {
  return modes.some((m) => REAL_AF_MODES.has(m.toLowerCase()));
}

function readCapsNum(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function esErrorPermiso(e: unknown): boolean {
  return e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
}

/** El facing real del track ya abierto — la verdad en apertura (puede existir
 *  aunque la sonda no lo hubiera capturado). undefined = sin reporte (Safari de
 *  escritorio, webcams USB). */
function leerFacingDeStream(stream: MediaStream): string | undefined {
  try {
    const track = stream.getVideoTracks()[0];
    if (!track || typeof track.getSettings !== 'function') return undefined;
    const st = track.getSettings() as { facingMode?: string } | undefined;
    return st?.facingMode;
  } catch {
    return undefined;
  }
}

/** Clasificación de ORIENTACIÓN: el facing del track MANDA sobre el label (los
 *  labels son localizados/mutables; facingMode es el dato del driver). */
function esSondaFrontal(p: CameraProbeResult): boolean {
  if (p.facingMode === 'user') return true;
  if (p.facingMode === 'environment') return false;
  return FRONT_CAMERA_RE.test(p.label) && !BACK_CAMERA_RE.test(p.label);
}

function esSondaTrasera(p: CameraProbeResult): boolean {
  if (p.facingMode === 'environment') return true;
  if (p.facingMode === 'user') return false;
  return BACK_CAMERA_RE.test(p.label) && !FRONT_CAMERA_RE.test(p.label);
}

/** Abre UNA cámara solo para leer sus capabilities y la CIERRA. SIN
 *  constraints de resolución: medir el sensor real requiere abrirla "pelada".
 *  El `finally` cierra SIEMPRE — nunca dos cámaras abiertas a la vez (con una
 *  viva, en muchos Android la 2ª apertura lanza NotReadableError y TODAS las
 *  sondas fallaban). Si la apertura llega tarde (caducó) se cierra igual. */
async function probeCamera(
  media: MediaDevices,
  deviceId: string,
  label: string,
  timeoutMs = 0,
): Promise<CameraProbeResult | null> {
  let stream: MediaStream | null = null;
  let timedOut = false;
  try {
    const opening = media.getUserMedia({ video: { deviceId: { exact: deviceId } }, audio: false });
    if (timeoutMs > 0) {
      stream = await Promise.race([
        opening,
        new Promise<null>((resolve) => {
          window.setTimeout(() => {
            timedOut = true;
            resolve(null);
          }, timeoutMs);
        }),
      ]);
      if (timedOut || stream === null) {
        void opening
          .then((s) => s.getTracks().forEach((t) => t.stop()))
          .catch(() => undefined);
        return null;
      }
    } else {
      stream = await opening;
    }
    const track = stream.getVideoTracks()[0];
    if (!track) return null;
    const caps = (track.getCapabilities?.() ?? {}) as {
      focusMode?: string[];
      torch?: boolean;
      width?: { max?: number };
      height?: { max?: number };
      facingMode?: string | string[];
    };
    const stFacing = (track.getSettings?.() ?? {}) as { facingMode?: string };
    const capsFacing = Array.isArray(caps.facingMode) ? caps.facingMode[0] : caps.facingMode;
    return {
      deviceId,
      label: label || track.label,
      focusModes: Array.isArray(caps.focusMode) ? caps.focusMode : [],
      torch: caps.torch === true,
      maxWidth: readCapsNum(caps.width?.max),
      maxHeight: readCapsNum(caps.height?.max),
      facingMode: stFacing?.facingMode ?? capsFacing,
    };
  } catch {
    return null; // ocupada/no accesible → descartada
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
  }
}

/** getUserMedia con reloj (ver OPEN_TIMEOUT_MS). Rechazos del navegador
 *  (permiso, no disponible) siguen propagándose: los callers conservan sus
 *  `permisoDenegado`/cascada. `null` = plazo vencido (apertura colgada). */
async function abrirConTimeout(
  media: MediaDevices,
  constraints: MediaStreamConstraints,
  ms = OPEN_TIMEOUT_MS,
): Promise<MediaStream | null> {
  let timedOut = false;
  const opening = media.getUserMedia(constraints);
  const stream = await Promise.race([
    opening,
    new Promise<null>((resolve) => {
      window.setTimeout(() => {
        timedOut = true;
        resolve(null);
      }, ms);
    }),
  ]);
  if (timedOut || stream === null) {
    void opening
      .then((s) => s.getTracks().forEach((t) => t.stop()))
      .catch(() => undefined);
    return null;
  }
  return stream;
}

/** Elige la principal: entre traseras con AF real gana la de MAYOR resolución
 *  de sensor (la principal siempre es el sensor grande; el torch desempata).
 *  Antes del AF, el pool relativo descarta UW/macro (regla E15: < 65 % del
 *  área de la mayor no puede ganar aunque reporte AF). Sin AF en ninguna
 *  (típico iOS, D6): label más simple (sin palabras de lente), luego menos
 *  palabras, luego más resolución. El pool de respaldo JAMÁS son "todas":
 *  traseras → no-frontales → todas (solo si el dispositivo no tiene nada más). */
export function chooseMainProbe(probes: CameraProbeResult[]): CameraProbeResult | null {
  if (probes.length === 0) return null;
  const backs = probes.filter(esSondaTrasera);
  const noFrontales = probes.filter((p) => !esSondaFrontal(p));
  const bruto = backs.length > 0 ? backs : noFrontales.length > 0 ? noFrontales : probes;
  const pool = poolSinMenores(bruto);
  const byRes = (a: CameraProbeResult, b: CameraProbeResult): number =>
    b.maxWidth * b.maxHeight - a.maxWidth * a.maxHeight;
  const withAf = pool.filter((p) => tieneRealAF(p.focusModes));
  if (withAf.length > 0) {
    return [...withAf].sort((a, b) => byRes(a, b) || (a.torch !== b.torch ? (a.torch ? -1 : 1) : 0))[0];
  }
  const lensWords = /ultra|gran angular|wide|angular|tele|teleobjetivo/i;
  const wordCount = (label: string): number => label.split(/\s+/).filter((w) => w.length > 0).length;
  const simples = pool.filter((p) => !lensWords.test(p.label));
  const ranked =
    simples.length > 0
      ? [...simples].sort((a, b) => wordCount(a.label) - wordCount(b.label) || byRes(a, b))
      : [...pool].sort((a, b) => a.label.length - b.label.length || byRes(a, b));
  return ranked[0];
}

function readMainCameraCache(): MainCameraCache | null {
  try {
    const raw = localStorage.getItem(MAIN_CAMERA_CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as MainCameraCache;
    if (!c || typeof c.deviceId !== 'string' || c.deviceId === '') return null;
    // SANEO: una entrada frontal (por facing o label) se borra AHORA y fuerza
    // re-sondeo — abre la frontal NUNCA falla, así que el resto de la
    // invalidación no la alcanza y el teléfono quedaba pegado para siempre.
    if (c.facingMode === 'user' || (FRONT_CAMERA_RE.test(c.label) && !BACK_CAMERA_RE.test(c.label))) {
      clearMainCameraCache();
      return null;
    }
    return c;
  } catch {
    return null; // almacenamiento corrupto/bloqueado → sondeo completo
  }
}

function writeMainCameraCache(p: CameraProbeResult, devicesKey: string): void {
  // Defensa en profundidad: jamás persistir una frontal.
  if (p.facingMode === 'user') return;
  if (FRONT_CAMERA_RE.test(p.label) && !BACK_CAMERA_RE.test(p.label)) return;
  try {
    localStorage.setItem(
      MAIN_CAMERA_CACHE_KEY,
      JSON.stringify({
        deviceId: p.deviceId,
        label: p.label,
        score: p.maxWidth * p.maxHeight,
        at: Date.now(),
        torch: p.torch,
        focusModes: p.focusModes,
        maxWidth: p.maxWidth,
        maxHeight: p.maxHeight,
        facingMode: p.facingMode,
        devicesKey,
      }),
    );
  } catch {
    /* cuota llena / modo privado — solo es una caché */
  }
}

function clearMainCameraCache(): void {
  try {
    localStorage.removeItem(MAIN_CAMERA_CACHE_KEY);
  } catch {
    /* nada que borrar */
  }
}

/** Red de seguridad: SOLO anchos IDEALES (ideal nunca rechaza). El primer
 *  intento fuerza EXACT la trasera — en algunos móviles «environment» a secas
 *  negocia la gran angular. Corre solo si las sondas no abrieron la principal. */
async function abrirConCascada(media: MediaDevices): Promise<{ stream: MediaStream | null; permisoDenegado: boolean }> {
  const intentos: MediaStreamConstraints[] = [
    {
      video: {
        facingMode: { exact: 'environment' },
        width: { ideal: IDEAL_PREVIEW_WIDTH },
        height: { ideal: IDEAL_PREVIEW_HEIGHT },
        frameRate: { ideal: IDEAL_PREVIEW_FPS },
      },
      audio: false,
    },
    {
      video: {
        facingMode: 'environment',
        width: { ideal: IDEAL_PREVIEW_WIDTH },
        height: { ideal: IDEAL_PREVIEW_HEIGHT },
        frameRate: { ideal: IDEAL_PREVIEW_FPS },
      },
      audio: false,
    },
    { video: { facingMode: 'environment' }, audio: false },
    { video: true, audio: false },
  ];
  for (const c of intentos) {
    try {
      const stream = await abrirConTimeout(media, c);
      if (!stream) continue; // plazo vencido: siguiente nivel
      return { stream, permisoDenegado: false };
    } catch (e) {
      if (esErrorPermiso(e)) return { stream: null, permisoDenegado: true }; // permiso: la cascada no ayuda
      /* siguiente nivel */
    }
  }
  return { stream: null, permisoDenegado: false };
}

/** Huella actual del conjunto de videoinput (null si el navegador aún no
 *  expone ids: sin permiso previo). */
async function leerHuellaVideoinput(media: MediaDevices): Promise<string | null> {
  try {
    const ids = (await media.enumerateDevices())
      .filter((d) => d.kind === 'videoinput' && d.deviceId)
      .map((d) => d.deviceId);
    return ids.length > 0 ? huellaDispositivos(ids) : null;
  } catch {
    return null;
  }
}

interface PrincipalAbierta {
  stream: MediaStream | null;
  main: CameraProbeResult | null;
  sondas: CameraProbeResult[];
  permisoDenegado: boolean;
  cacheHit: boolean;
  /** La lente abierta quedó contrastada contra sonda/caché (o no había con qué). */
  verificada: boolean;
}

/** Arranque estilo campo: vía rápida por caché → desbloqueo de labels →
 *  sondas secuenciales → elección → apertura verificada de la ganadora.
 *  `cancelado()` se consulta en cada paso (salir de la vista durante
 *  «INICIANDO CÁMARA» no debe dejar sensores abriéndose en background). */
async function abrirPorCache(media: MediaDevices, cache: MainCameraCache): Promise<PrincipalAbierta | null> {
  // Huella: si el conjunto de cámaras ya no es el de cuando se eligió
  // (driver renumeró ids, otra lente visible), la caché no se usa.
  const huellaActual = await leerHuellaVideoinput(media);
  if (huellaActual && cache.devicesKey && huellaActual !== cache.devicesKey) {
    clearMainCameraCache();
    return null;
  }
  try {
    const stream = await abrirConTimeout(media, {
      video: {
        deviceId: { exact: cache.deviceId },
        width: { ideal: IDEAL_PREVIEW_WIDTH },
        height: { ideal: IDEAL_PREVIEW_HEIGHT },
        frameRate: { ideal: IDEAL_PREVIEW_FPS },
      },
      audio: false,
    });
    if (!stream) {
      // Apertura colgada: la caché no es confiable — re-sondeo completo.
      clearMainCameraCache();
      return null;
    }
    if (leerFacingDeStream(stream) === 'user') {
      // Si lo abierto reporta 'user' la caché estaba venenada MÁS ALLÁ del
      // label (un driver mintió al escribirla).
      stream.getTracks().forEach((t) => t.stop());
      clearMainCameraCache();
      return null;
    }
    if (!lenteCoincide(cache, leerLenteDeStream(stream))) {
      // Otro sensor con el mismo id (renumeración) o una UW cacheada: cerrar
      // y re-sondear.
      stream.getTracks().forEach((t) => t.stop());
      clearMainCameraCache();
      return null;
    }
    return { stream, main: null, sondas: [], permisoDenegado: false, cacheHit: true, verificada: true };
  } catch (err) {
    clearMainCameraCache();
    if (esErrorPermiso(err)) {
      return { stream: null, main: null, sondas: [], permisoDenegado: true, cacheHit: false, verificada: false };
    }
    return null;
  }
}

async function abrirCamaraPrincipal(media: MediaDevices, cancelado: () => boolean): Promise<PrincipalAbierta> {
  const cache = readMainCameraCache();
  if (cache) {
    const porCache = await abrirPorCache(media, cache);
    if (porCache) return porCache;
  }

  const leerVideoinputs = async (): Promise<MediaDeviceInfo[]> => {
    try {
      return (await media.enumerateDevices()).filter((d) => d.kind === 'videoinput' && d.deviceId);
    } catch {
      return [];
    }
  };
  // Desbloqueo de labels: sin permiso previo, enumerateDevices trae label y
  // deviceId vacíos. Con permisos ya concedidos los labels salen sin abrir
  // stream (medido en A12/A56) y se ahorra una apertura completa por arranque
  // en frío.
  let devices = await leerVideoinputs();
  const rotulados = devices.length > 0 && devices.every((d) => !!d.label);
  if (!rotulados) {
    try {
      const unlock = await abrirConTimeout(media, { video: true, audio: false });
      unlock?.getTracks().forEach((t) => t.stop());
    } catch (e) {
      // Sin permiso los probes fallarán y se cae a la cascada — pero el motivo
      // hay que preservarlo para el aviso del visor.
      if (esErrorPermiso(e)) {
        return { stream: null, main: null, sondas: [], permisoDenegado: true, cacheHit: false, verificada: false };
      }
    }
    devices = await leerVideoinputs();
  }

  // Las frontales rotuladas no se sondean (la sonda es apertura real: en el
  // A12 son 2 de 4 cámaras y duplicaban el arranque en frío). Si el label no
  // permite descartar nada, se sondean todas.
  const sinFrontales = devices.filter(
    (d) => !(FRONT_CAMERA_RE.test(d.label) && !BACK_CAMERA_RE.test(d.label)),
  );
  const sondeables = sinFrontales.length > 0 ? sinFrontales : devices;

  const sondas: CameraProbeResult[] = [];
  for (const d of sondeables) {
    if (cancelado()) {
      return { stream: null, main: null, sondas, permisoDenegado: false, cacheHit: false, verificada: false };
    }
    const p = await probeCamera(media, d.deviceId, d.label, PROBE_TIMEOUT_MS);
    if (p) sondas.push(p);
  }
  let main = chooseMainProbe(sondas);
  if (!main && sondeables.length < devices.length) {
    // Red de seguridad: los labels engañaron o las candidatas no abrieron.
    for (const d of devices) {
      if (sondas.some((s) => s.deviceId === d.deviceId)) continue;
      if (cancelado()) break;
      const p = await probeCamera(media, d.deviceId, d.label, PROBE_TIMEOUT_MS);
      if (p) sondas.push(p);
    }
    main = chooseMainProbe(sondas);
  }
  const devicesKey = huellaDispositivos(devices.map((d) => d.deviceId));

  const intentos: MediaStreamConstraints[] = main
    ? [
        {
          video: {
            deviceId: { exact: main.deviceId },
            width: { ideal: IDEAL_PREVIEW_WIDTH },
            height: { ideal: IDEAL_PREVIEW_HEIGHT },
            frameRate: { ideal: IDEAL_PREVIEW_FPS },
          },
          audio: false,
        },
        { video: { deviceId: { exact: main.deviceId } }, audio: false },
      ]
    : [];
  intentos.push({ video: true, audio: false }); // último recurso (tablet/escritorio)

  for (let ai = 0; ai < intentos.length; ai += 1) {
    if (cancelado()) {
      return { stream: null, main, sondas, permisoDenegado: false, cacheHit: false, verificada: false };
    }
    try {
      const stream = await abrirConTimeout(media, intentos[ai]!);
      if (!stream) continue; // plazo vencido: siguiente intento
      // Guard de apertura (última línea de defensa): facing 'user' NO es la
      // principal pedida → cerrar y seguir con el siguiente intento.
      if (leerFacingDeStream(stream) === 'user') {
        stream.getTracks().forEach((t) => t.stop());
        if (main && ai < 2) clearMainCameraCache();
        continue;
      }
      // La lente abierta debe corresponder a lo que midió la sonda (mismo
      // deviceId puede hablar con otro sensor si el driver renumeró).
      const verificada = main ? lenteCoincide(main, leerLenteDeStream(stream)) : true;
      // La caché se escribe SOLO cuando la ganadora abrió y sus caps cuadran
      // (los 2 primeros intentos fijan su deviceId; el fallback no escribe).
      if (main && ai < 2 && verificada) writeMainCameraCache(main, devicesKey);
      // Vía zoom: si el track abrió con zoom < 1 (el 0.5× del MISMO sensor),
      // subirlo a 1 para el FOV de la principal.
      try {
        const track = stream.getVideoTracks()[0];
        const zcaps = track?.getCapabilities?.() as { zoom?: { min?: number; max?: number } } | undefined;
        const zst = track?.getSettings?.() as { zoom?: number } | undefined;
        if (
          zcaps?.zoom &&
          typeof zcaps.zoom.min === 'number' &&
          zcaps.zoom.min < 1 &&
          typeof zst?.zoom === 'number' &&
          zst.zoom < 1
        ) {
          await track
            ?.applyConstraints({ advanced: [{ zoom: 1 }] } as MediaTrackConstraints & { advanced: unknown[] })
            .catch(() => undefined);
        }
      } catch {
        /* sin soporte de zoom */
      }
      return { stream, main, sondas, permisoDenegado: false, cacheHit: false, verificada };
    } catch {
      /* siguiente nivel */
    }
  }
  return { stream: null, main, sondas, permisoDenegado: false, cacheHit: false, verificada: false };
}

/** Telemetría de QA (paridad con el upstream): qué lente quedó abierta y qué
 *  midieron las sondas — depuración remota sin acceso al dispositivo. */
function registrarTelemetria(
  stream: MediaStream,
  main: CameraProbeResult | null,
  sondas: CameraProbeResult[],
  meta: { cacheHit: boolean; verificada: boolean },
): void {
  try {
    const track = stream.getVideoTracks()[0];
    const st = track?.getSettings?.() as { width?: number; height?: number; facingMode?: string } | undefined;
    (window as unknown as { __cameraChoice?: unknown }).__cameraChoice = {
      elegida: main?.label ?? track?.label ?? '',
      facing: st?.facingMode ?? main?.facingMode ?? null,
      torch: main?.torch ?? false,
      focusModes: main?.focusModes ?? [],
      width: st?.width ?? 0,
      height: st?.height ?? 0,
      cacheHit: meta.cacheHit,
      verificada: meta.verificada,
      sondas: sondas.map((p) => ({
        label: p.label,
        facing: p.facingMode ?? null,
        torch: p.torch,
        af: p.focusModes,
        max: `${p.maxWidth}x${p.maxHeight}`,
      })),
    };
  } catch {
    /* solo telemetría */
  }
}

/** Abre la cámara trasera PRINCIPAL del dispositivo. Devuelve el stream (null
 *  = no se pudo, y el caller decide el aviso) junto con la sonda ganadora para
 *  el HUD de sensores. */
export async function abrirCamaraTrasera(
  media: MediaDevices,
  cancelado: () => boolean,
): Promise<EleccionCamara> {
  const porSondas = await abrirCamaraPrincipal(media, cancelado);
  if (porSondas.stream) {
    registrarTelemetria(porSondas.stream, porSondas.main, porSondas.sondas, {
      cacheHit: porSondas.cacheHit,
      verificada: porSondas.verificada,
    });
    return { stream: porSondas.stream, main: porSondas.main, sondas: porSondas.sondas, permisoDenegado: false };
  }
  if (porSondas.permisoDenegado || cancelado()) {
    return { stream: null, main: porSondas.main, sondas: porSondas.sondas, permisoDenegado: porSondas.permisoDenegado };
  }
  // Red de seguridad (si las sondas tampoco pudieron, p. ej. iOS con labels
  // vacíos): la cascada empieza forzando la trasera EXACT.
  const porCascada = await abrirConCascada(media);
  const stream = porCascada.stream;
  if (stream) {
    if (cancelado()) {
      stream.getTracks().forEach((t) => t.stop());
      return { stream: null, main: porSondas.main, sondas: porSondas.sondas, permisoDenegado: false };
    }
    registrarTelemetria(stream, porSondas.main, porSondas.sondas, { cacheHit: false, verificada: false });
  }
  return { stream, main: porSondas.main, sondas: porSondas.sondas, permisoDenegado: porCascada.permisoDenegado };
}

/** OLVIDAR la elección: fuerza el re-sondeo en el próximo arranque. Se expone
 *  para el Panel DEV/consola cuando un teléfono quede pegado a una lente
 *  equivocada (la caché también se invalida sola por fallo de apertura,
 *  facing 'user', huella de cámaras cambiada o caps que no cuadran). */
export function reinicioSondeoCamara(): { olvidada: string | null } {
  let olvidada: string | null = null;
  try {
    const raw = localStorage.getItem(MAIN_CAMERA_CACHE_KEY);
    if (raw) olvidada = (JSON.parse(raw) as MainCameraCache).deviceId ?? null;
    localStorage.removeItem(MAIN_CAMERA_CACHE_KEY);
  } catch {
    /* nada que borrar */
  }
  return { olvidada };
}
