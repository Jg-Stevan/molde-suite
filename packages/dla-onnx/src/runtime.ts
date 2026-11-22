// Runtime cliente del paquete dla-onnx (FASE B1): wrapper promise-based del
// worker. Un SOLO worker por página (singleton por preset), carga lazy del
// modelo (Cache Storage dentro del worker) y transfer de ImageBitmap (cero
// copia). Sin modelo configurado, `configuracionLista()` devuelve false y los
// consumidores NUNCA intentan cargar (Nivel 1 activo sin cambios).

import { PRESETS, type Deteccion, type PresetKey, type RespuestaWorker } from './tipos';

/** URLs de modelos (build-time). Ausentes = señal apagada (honesto). */
const urlsExplicitas = new Map<PresetKey, string>();

/** Fija una URL desde la app (Turbopack no inlinea env en paquetes workspace). */
export function configurarModelo(key: PresetKey, url: string | null | undefined): void {
  if (url) urlsExplicitas.set(key, url);
  else urlsExplicitas.delete(key);
}

export function urlModelo(key: PresetKey): string | null {
  const explicita = urlsExplicitas.get(key);
  if (explicita) return explicita;
  const env =
    typeof process !== 'undefined'
      ? (process.env as Record<string, string | undefined>)
      : undefined;
  switch (key) {
    case 'casillas':
      return env?.NEXT_PUBLIC_DLA_MODELO_CASILLAS ?? null;
    case 'layout':
      return env?.NEXT_PUBLIC_DLA_MODELO_LAYOUT ?? null;
    case 'manuscrito':
      return env?.NEXT_PUBLIC_DLA_MODELO_MANUSCRITO ?? null;
  }
}

/** ¿Hay modelo configurado para la señal? (los consumidores lo consultan ANTES). */
export function configuracionLista(key: PresetKey): boolean {
  return urlModelo(key) !== null;
}

interface Detector {
  detectar: (canvas: HTMLCanvasElement, confMin?: number) => Promise<Deteccion[]>;
  cerrar: () => Promise<void>;
}

const workers = new Map<PresetKey, Promise<Detector & { cargado: Promise<void> }>>();

/** Crea (o reutiliza) el detector del preset. Falla ACCIONABLE sin URL. */
export function crearDetector(key: PresetKey): Promise<Detector> {
  let p = workers.get(key);
  if (!p) {
    p = crearWorkerDetector(key);
    workers.set(key, p);
  }
  return p.then((d) => ({ detectar: d.detectar, cerrar: d.cerrar }));
}

async function crearWorkerDetector(key: PresetKey): Promise<Detector & { cargado: Promise<void> }> {
  const url = urlModelo(key);
  if (!url) {
    throw new Error(
      `[dla-onnx] Modelo "${key}" sin configurar: define NEXT_PUBLIC_DLA_${key.toUpperCase()} (URL del .onnx). ` +
        'Sin modelo, las señales DLA quedan apagadas y el producto corre en Nivel 1.',
    );
  }
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  let id = 0;
  const pendientes = new Map<number, { resolve: (r: RespuestaWorker) => void; reject: (e: Error) => void }>();
  worker.onmessage = (e: MessageEvent<RespuestaWorker>) => {
    const pend = pendientes.get(e.data.id);
    if (!pend) return;
    pendientes.delete(e.data.id);
    pend.resolve(e.data);
  };
  worker.onerror = (e) => {
    for (const [, pend] of pendientes) pend.reject(new Error(e.message || 'error de worker ONNX'));
    pendientes.clear();
  };
  const pedir = (mensaje: Record<string, unknown>, transfer?: Transferable[]): Promise<RespuestaWorker> =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pendientes.set(mid, { resolve, reject });
      worker.postMessage({ ...mensaje, id: mid }, transfer ?? []);
    });

  const cargado = (async () => {
    const r = await pedir({ tipo: 'cargar', url, presetKey: key });
    if (r.tipo === 'error') throw new Error(`[dla-onnx] carga de ${key}: ${r.mensaje}`);
  })();

  await cargado;
  return {
    cargado,
    detectar: async (canvas, confMin) => {
      const bitmap = await createImageBitmap(canvas);
      const r = await pedir({ tipo: 'detectar', bitmap, confMin }, [bitmap]);
      if (r.tipo === 'error') throw new Error(`[dla-onnx] detectar: ${r.mensaje}`);
      return r.tipo === 'detecciones' ? r.lista : [];
    },
    cerrar: async () => {
      await pedir({ tipo: 'cerrar' });
      worker.terminate();
      workers.delete(key);
    },
  };
}

export { PRESETS };
export type { Deteccion, PresetKey };
