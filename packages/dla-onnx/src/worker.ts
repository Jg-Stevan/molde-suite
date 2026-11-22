// Worker de inferencia ONNX (FASE B1 del blueprint DLA). Corre FUERA del
// hilo principal: la UI y el pipeline de escaneo jamás se bloquean.
//
// · Sesión: ort.InferenceSession.create con fallback WebGPU → WASM (si el
//   navegador no soporta WebGPU, WASM SIMD cubre — Tamiz ya emite COOP/COEP
//   condicional en su middleware, y sin COEP el wasm cae a 1 hilo de forma
//   controlada).
// · Caché de modelos en Cache Storage ("dla-onnx-v1"): el modelo se descarga
//   UNA vez y el PWA no lo re-descarga en cada sesión.
// · Decodificadores: 'yolo' (v8/v12 + NMS) y 'detr' (top-k), según preset.
//
// NOTA honesta: los presets y decodificadores cubren las familias citadas en
// el blueprint; la primera corrida contra el banco de pruebas (lessons/) es
// la que calibra confMin/IoU reales antes de activar por defecto.

import * as ort from 'onnxruntime-web';
import { PRESETS, type Deteccion, type MensajeWorker, type RespuestaWorker } from './tipos';

const CACHE_NOMBRE = 'dla-onnx-v1';

let sesion: ort.InferenceSession | null = null;
let presetKey: keyof typeof PRESETS = 'casillas';
let varianteLayout: 's' | 'plusL' = 's';

// Clases por variante: los índices NO comparten orden entre S (23) y plus-L
// (20) a partir de la clase 8. Los nombres son el contrato de layout-core.
const CLASES_LAYOUT_S = [
  'paragraph_title', 'image', 'text', 'number', 'abstract', 'content', 'figure_title',
  'formula', 'table', 'table_title', 'reference', 'doc_title', 'footnote', 'header',
  'algorithm', 'footer', 'seal', 'chart_title', 'chart', 'formula_number',
  'header_image', 'footer_image', 'aside_text',
];
const CLASES_LAYOUT_PLUSL = [
  'paragraph_title', 'image', 'text', 'number', 'abstract', 'content', 'figure_title',
  'formula', 'table', 'reference', 'doc_title', 'footnote', 'header', 'algorithm',
  'footer', 'seal', 'chart', 'formula_number', 'aside_text', 'reference_content',
];

self.onmessage = async (e: MessageEvent<MensajeWorker>) => {
  const msg = e.data;
  try {
    if (msg.tipo === 'cargar') {
      presetKey = msg.presetKey;
      varianteLayout = /plus[-_]?l/i.test(msg.url) ? 'plusL' : 's';
      sesion = await crearSesion(msg.url);
      responder({ tipo: 'listo', id: msg.id });
      return;
    }
    if (msg.tipo === 'detectar') {
      if (!sesion) throw new Error('Sesión ONNX no cargada');
      const preset = PRESETS[presetKey];
      const lista = await detectarConSesion(sesion, msg.bitmap, preset, msg.confMin ?? preset.confMin);
      responder({ tipo: 'detecciones', id: msg.id, lista });
      msg.bitmap.close();
      return;
    }
    if (msg.tipo === 'cerrar') {
      await sesion?.release();
      sesion = null;
      responder({ tipo: 'listo', id: msg.id });
    }
  } catch (err) {
    responder({ tipo: 'error', id: msg.id, mensaje: err instanceof Error ? err.message : String(err) });
  }
};

function responder(r: RespuestaWorker): void {
  (self as unknown as Worker).postMessage(r);
}

/** Crea la sesión ONNX con caché en Cache Storage y fallback de proveedores. */
async function crearSesion(url: string): Promise<ort.InferenceSession> {
  const buf = await bufferModelo(url);
  // PP-DocLayout: ORT WebGPU falla en MatMul para estos exportes (visto en PC
  // y celular del banco). WASM SIMD es el proveedor validado del dossier.
  if (presetKey === 'layout') {
    return await ort.InferenceSession.create(buf, { executionProviders: ['wasm'] });
  }
  try {
    return await ort.InferenceSession.create(buf, {
      executionProviders: ['webgpu', 'wasm'],
    });
  } catch {
    // WebGPU ausente/fallido → WASM (SIMD si el navegador lo ofrece).
    return await ort.InferenceSession.create(buf, { executionProviders: ['wasm'] });
  }
}

/** Fetch del modelo con caché Cache Storage (descarga única por versión). */
async function bufferModelo(url: string): Promise<ArrayBuffer> {
  if (typeof caches !== 'undefined') {
    const cache = await caches.open(CACHE_NOMBRE);
    const hit = await cache.match(url);
    if (hit) return await hit.arrayBuffer();
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Modelo no disponible (${resp.status}): ${url}`);
    const clon = resp.clone();
    try {
      await cache.put(url, clon);
    } catch {
      /* caché llena/indisponible: la sesión igual se crea */
    }
    return await resp.arrayBuffer();
  }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Modelo no disponible (${resp.status}): ${url}`);
  return await resp.arrayBuffer();
}

/** Preproceso letterbox cuadrado (NCHW float32) y corrida de la sesión. */
async function detectarConSesion(
  sesion: ort.InferenceSession,
  bitmap: ImageBitmap,
  preset: (typeof PRESETS)[keyof typeof PRESETS],
  confMin: number,
): Promise<Deteccion[]> {
  if (presetKey === 'layout') {
    return detectarLayoutDocumento(sesion, bitmap, confMin, varianteLayout);
  }
  const S = preset.tamEntrada;
  // Letterbox: escala uniforme + padding (esquinas en el mismo marco 0-1).
  const escala = Math.min(S / bitmap.width, S / bitmap.height);
  const nw = Math.max(1, Math.round(bitmap.width * escala));
  const nh = Math.max(1, Math.round(bitmap.height * escala));
  const padX = (S - nw) / 2;
  const padY = (S - nh) / 2;
  const lienzo = new OffscreenCanvas(S, S);
  const ctx = lienzo.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, S, S);
  ctx.drawImage(bitmap, padX, padY, nw, nh);
  const img = ctx.getImageData(0, 0, S, S);

  const k = preset.entrada === '0-255' ? 1 : 1 / 255;
  const area = S * S;
  const tensorData = new Float32Array(3 * area);
  for (let i = 0, p = 0; i < area; i++, p += 4) {
    tensorData[i] = img.data[p] * k; // R
    tensorData[area + i] = img.data[p + 1] * k; // G
    tensorData[2 * area + i] = img.data[p + 2] * k; // B
  }
  const input = new ort.Tensor('float32', tensorData, [1, 3, S, S]);
  const alimentacion: Record<string, ort.Tensor> = {};
  alimentacion[sesion.inputNames[0]] = input;
  const salida = await sesion.run(alimentacion);
  const out = salida[sesion.outputNames[0]];

  if (preset.decodificador === 'yolo') return decodificarYolo(out, preset, confMin, escala, padX, padY);
  // DETR/RT-DETR: boxes + scores como salidas separadas o un solo tensor.
  const scores = salida['scores'] ?? salida[sesion.outputNames[1] ?? ''];
  return decodificarDetr(out, scores ?? null, preset, confMin);
}

/**
 * PP-DocLayout S / plus-L (stock): estirado al lado canónico (sin letterbox),
 * `scale_factor=[lado/h, lado/w]`, `im_shape=[lado,lado]`; salida [N,6] con
 * [clase, score, x1, y1, x2, y2] en coordenadas de la imagen ORIGINAL.
 * S ya trae NMS; plus-L exige NMS clase-agnóstico 0.5 en la app.
 */
async function detectarLayoutDocumento(
  sesion: ort.InferenceSession,
  bitmap: ImageBitmap,
  confMin: number,
  variante: 's' | 'plusL',
): Promise<Deteccion[]> {
  const lado = variante === 's' ? 480 : 800;
  const W = bitmap.width;
  const H = bitmap.height;
  const lienzo = new OffscreenCanvas(lado, lado);
  const ctx = lienzo.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'medium';
  ctx.drawImage(bitmap, 0, 0, lado, lado);
  const px = ctx.getImageData(0, 0, lado, lado).data;
  const area = lado * lado;
  const data = new Float32Array(3 * area);
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  for (let i = 0, p = 0; i < area; i++, p += 4) {
    if (variante === 's') {
      data[i] = (px[p] / 255 - mean[0]) / std[0];
      data[area + i] = (px[p + 1] / 255 - mean[1]) / std[1];
      data[2 * area + i] = (px[p + 2] / 255 - mean[2]) / std[2];
    } else {
      data[i] = px[p] / 255;
      data[area + i] = px[p + 1] / 255;
      data[2 * area + i] = px[p + 2] / 255;
    }
  }

  const nombreImagen =
    sesion.inputNames.find((n) => /image|img/i.test(n)) ?? sesion.inputNames[0];
  const alimentacion: Record<string, ort.Tensor> = {
    [nombreImagen]: new ort.Tensor('float32', data, [1, 3, lado, lado]),
  };
  const nombreEscala = sesion.inputNames.find((n) => /scale/i.test(n));
  if (nombreEscala) {
    alimentacion[nombreEscala] = new ort.Tensor(
      'float32',
      new Float32Array([lado / H, lado / W]),
      [1, 2],
    );
  }
  const nombreForma = sesion.inputNames.find((n) => /shape/i.test(n));
  if (nombreForma) {
    alimentacion[nombreForma] = new ort.Tensor(
      'float32',
      new Float32Array([lado, lado]),
      [1, 2],
    );
  }

  const salida = await sesion.run(alimentacion);
  const nombreSalida =
    sesion.outputNames.find((n) => {
      const d = salida[n]?.dims ?? [];
      return (d.length === 2 && d[1] === 6) || (d.length === 3 && d[2] === 6);
    }) ?? sesion.outputNames[0];
  const out = salida[nombreSalida];
  const dims = out.dims;
  const filas = dims.length === 3 ? dims[1] : dims[0];
  const cols = dims[dims.length - 1];
  const bd = out.data as Float32Array;
  const clases = variante === 's' ? CLASES_LAYOUT_S : CLASES_LAYOUT_PLUSL;
  const umbral = confMin;
  const lista: Deteccion[] = [];

  for (let i = 0; i < filas; i++) {
    const o = i * cols;
    const score = bd[o + 1];
    if (!(score >= umbral)) continue;
    const x1 = bd[o + 2];
    const y1 = bd[o + 3];
    const x2 = bd[o + 4];
    const y2 = bd[o + 5];
    if (!(x2 > x1) || !(y2 > y1)) continue;
    const cls = Math.round(bd[o]);
    lista.push({
      clase: clases[cls] ?? `clase_${cls}`,
      conf: score,
      caja: {
        x: clamp01(x1 / W),
        y: clamp01(y1 / H),
        w: clamp01((x2 - x1) / W),
        h: clamp01((y2 - y1) / H),
      },
    });
  }
  // NMS clase-agnóstico 0.5 de la app para AMBAS variantes: el exporte de S
  // trae NMS propio, pero deja duplicados entre clases (p. ej. la imagen de
  // página y una tabla casi idéntica); el banco estructural corría NMS 0.5.
  return nms(lista, 0.5);
}

/** Decodificador YOLO (v8/v12): salida [1, 4+nc, N] en coords de entrada. */
function decodificarYolo(
  out: ort.Tensor,
  preset: (typeof PRESETS)[keyof typeof PRESETS],
  confMin: number,
  escala: number,
  padX: number,
  padY: number,
): Deteccion[] {
  const data = out.data as Float32Array;
  const dims = out.dims; // [1, 4+nc, N] o [1, N, 4+nc]
  const lista: Deteccion[] = [];
  const S = preset.tamEntrada;
  if (dims.length === 3 && dims[1] < dims[2]) {
    const nc = dims[1] - 4;
    const N = dims[2];
    for (let i = 0; i < N; i++) {
      let mejorClase = -1;
      let mejorConf = 0;
      for (let c = 0; c < nc; c++) {
        const conf = data[(4 + c) * N + i];
        if (conf > mejorConf) {
          mejorConf = conf;
          mejorClase = c;
        }
      }
      if (mejorConf < confMin) continue;
      const cx = data[0 * N + i];
      const cy = data[1 * N + i];
      const w = data[2 * N + i];
      const h = data[3 * N + i];
      lista.push(aDeteccion(mejorClase, mejorConf, cx - w / 2, cy - h / 2, w, h, escala, padX, padY, preset, S));
    }
  } else if (dims.length === 3) {
    // [1, N, 4+nc] (variante con filas por detección)
    const N = dims[1];
    const resto = dims[2] - 4;
    for (let i = 0; i < N; i++) {
      const base = i * dims[2];
      let mejorClase = -1;
      let mejorConf = 0;
      for (let c = 0; c < resto; c++) {
        const conf = data[base + 4 + c];
        if (conf > mejorConf) {
          mejorConf = conf;
          mejorClase = c;
        }
      }
      if (mejorConf < confMin) continue;
      const cx = data[base];
      const cy = data[base + 1];
      const w = data[base + 2];
      const h = data[base + 3];
      lista.push(aDeteccion(mejorClase, mejorConf, cx - w / 2, cy - h / 2, w, h, escala, padX, padY, preset, S));
    }
  }
  return nms(lista, preset.iou ?? 0.45);
}

/** Decodificador DETR/RT-DETR (PP-DocLayout/D-FINE): boxes normalizados 0-1
 * (cxcywh) + scores [1, N, nc]. Top-k por score, SIN NMS. */
function decodificarDetr(
  boxes: ort.Tensor,
  scores: ort.Tensor | null,
  preset: (typeof PRESETS)[keyof typeof PRESETS],
  confMin: number,
): Deteccion[] {
  const lista: Deteccion[] = [];
  const bd = boxes.data as Float32Array;
  if (!scores) {
    // Formato fusionado [1, N, 4+nc]: scores = columnas 4..4+nc.
    const dims = boxes.dims;
    if (dims.length !== 3) return lista;
    const N = dims[1];
    const resto = dims[2] - 4;
    for (let i = 0; i < N; i++) {
      const base = i * dims[2];
      let mejorClase = -1;
      let mejorConf = 0;
      for (let c = 0; c < resto; c++) {
        const conf = data0(bd[base + 4 + c]);
        if (conf > mejorConf) {
          mejorConf = conf;
          mejorClase = c;
        }
      }
      if (mejorConf < confMin) continue;
      const cx = bd[base], cy = bd[base + 1], w = bd[base + 2], h = bd[base + 3];
      const yaNorm = cx <= 1.5 && cy <= 1.5 && w <= 1.5;
      lista.push({
        clase: nombreClase(mejorClase, preset),
        conf: mejorConf,
        caja: yaNorm
          ? { x: clamp01(cx - w / 2), y: clamp01(cy - h / 2), w: clamp01(w), h: clamp01(h) }
          : { x: clamp01(cx - w / 2), y: clamp01(cy - h / 2), w: clamp01(w), h: clamp01(h) },
      });
    }
    return lista;
  }
  const sd = scores.data as Float32Array;
  const dimsS = scores.dims; // [1, N, nc]
  const dimsB = boxes.dims; // [1, N, 4]
  if (dimsS.length !== 3 || dimsB.length !== 3) return lista;
  const N = Math.min(dimsS[1], dimsB[1]);
  const nc = dimsS[2];
  for (let i = 0; i < N; i++) {
    let mejorClase = -1;
    let mejorConf = 0;
    for (let c = 0; c < nc; c++) {
      const conf = sd[i * nc + c];
      if (conf > mejorConf) {
        mejorConf = conf;
        mejorClase = c;
      }
    }
    if (mejorConf < confMin) continue;
    const base = i * 4;
    const cx = bd[base], cy = bd[base + 1], w = bd[base + 2], h = bd[base + 3];
    lista.push({
      clase: nombreClase(mejorClase, preset),
      conf: mejorConf,
      caja: { x: clamp01(cx - w / 2), y: clamp01(cy - h / 2), w: clamp01(w), h: clamp01(h) },
    });
  }
  return lista;
}

const data0 = (v: number): number => (v > 1 && v <= 100 ? v / 100 : v); // tolera scores en 0-100

function aDeteccion(
  clase: number,
  conf: number,
  x: number,
  y: number,
  w: number,
  h: number,
  escala: number,
  padX: number,
  padY: number,
  preset: (typeof PRESETS)[keyof typeof PRESETS],
  S: number,
): Deteccion {
  // Coords de entrada (letterbox) → px del bitmap → normalizado 0-1.
  const x0 = (x - padX) / escala;
  const y0 = (y - padY) / escala;
  const ww = w / escala;
  const hh = h / escala;
  void S;
  return {
    clase: nombreClase(clase, preset),
    conf,
    caja: { x: clamp01(x0), y: clamp01(y0), w: clamp01(ww), h: clamp01(hh) },
  };
}

function nombreClase(i: number, preset: (typeof PRESETS)[keyof typeof PRESETS]): string {
  return preset.clases?.[i] ?? `clase_${i}`;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** NMS clásico sobre detecciones (solo decodificador yolo). */
function nms(lista: Deteccion[], iouUmbral: number): Deteccion[] {
  const orden = [...lista].sort((a, b) => b.conf - a.conf);
  const keep: Deteccion[] = [];
  for (const d of orden) {
    if (keep.some((k) => iou(k.caja, d.caja) > iouUmbral)) continue;
    keep.push(d);
  }
  return keep;
}

function iou(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): number {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}
