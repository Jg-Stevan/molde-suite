// FASE 0 (blueprint DLA): evaluación del MOLDE ACTIVO sobre el acta de Tamiz.
// El pipeline llama `evaluarMolde(fotoProcesada)` tras el gate (paso
// inyectado en PasosMolde) cuando hay un molde registrado (molde/registry.ts)
// y el flag del operador lo habilita.
//
// Qué hace:
//   1. Registra el proveedor OCR de Tamiz en el motor compartido (una vez).
//   2. Renderiza la foto PROCESADA del acta a un canvas de 1000 px de ancho
//      — la misma escala canónica del motor (pdf-client del Studio usa
//      TARGET_WIDTH=1000), para que las zonas normalizadas 0-1 signifiquen
//      lo mismo en ambas apps.
//   3. Ejecuta evaluarDocumentoUniversal en MODO LIGERO (sin previews ni
//      crops: el Acta lleva un resumen; la memoria del móvil manda).
//   4. FASE B2 (blueprint DLA): SEGUNDA OPINIÓN ONNX para las casillas que
//      cayeron en `requiere_revision` — si el detector de casillas está
//      configurado (flag + URL del modelo), confirma o revierte con bandera
//      `onnx_segunda_opinion`. NUNCA inventa: sin detector disponible, nada
//      cambia.
//
// Principio de honestidad intacto: este paso es ADITIVO (no cambia score ni
// status del gate); su veredicto viaja en `acta.evaluacionMolde`.

import { evaluarDocumentoUniversal } from '@jg-stevan/scanner-core/molde/universal-engine';
import type {
  ResultadoCampoUniversal,
  ResultadoUniversal,
} from '@jg-stevan/scanner-core/molde/universal-types';
import { configurarProveedorOcr } from '@jg-stevan/scanner-core/molde/ocr-tipos';
import type { MoldeUniversal } from '@jg-stevan/scanner-core/molde/universal-types';
import type { ResumenMoldeActa } from '@jg-stevan/scanner-core/dominio/types';
import { proveedorOcrTamiz } from './ocr-proveedor';
import { moldeActivo } from './registry';
import '../dla/config';
import { leerFlags } from '../flags';
import { logger } from '../../logger';

let proveedorRegistrado = false;
function asegurarProveedor(): void {
  if (!proveedorRegistrado) {
    configurarProveedorOcr(proveedorOcrTamiz);
    proveedorRegistrado = true;
  }
}

/** Escala una imagen (dataURL) a un canvas de `ancho` px (canónica del motor). */
async function fotoACanvas(dataUrl: string, ancho: number): Promise<HTMLCanvasElement> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = ancho;
  c.height = Math.max(1, Math.round((img.naturalHeight / Math.max(1, img.naturalWidth)) * ancho));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/** Banderas agregadas (sin duplicar) de todos los campos del resultado. */
function banderasAgregadas(resultado: ResultadoUniversal): string[] {
  const set = new Set<string>();
  for (const c of resultado.paginas.flatMap((p) => p.campos)) {
    for (const b of c.banderas) set.add(b);
  }
  return [...set];
}

/** Resumen LIGERO (sin crops/previews) para el Acta. */
function resumir(molde: MoldeUniversal, resultado: ResultadoUniversal): ResumenMoldeActa {
  const banderas = banderasAgregadas(resultado)
    .filter((b) => !b.startsWith('forma_fill_'));
  return {
    moldeNombre: molde.nombre,
    total: resultado.total,
    ok: resultado.ok_count,
    score: resultado.score,
    requiereRevision: resultado.requiere_revision,
    obligatoriosFaltantes: resultado.obligatorios_faltantes,
    banderas,
    tiempos: resultado.tiempos,
  };
}

/**
 * FASE B2 — segunda opinión ONNX sobre casillas dudosas. Requiere:
 *   - flag `dlaOnnx` activa (Panel DEV),
 *   - URL del modelo configurada (NEXT_PUBLIC_DLA_MODELO_CASILLAS).
 * Confirmación con confianza ≥ 0.7: el estado del campo se ajusta con la
 * bandera `onnx_segunda_opinion`. Sin modelo/sin sesión → no-op silencioso.
 */
async function segundaOpinionCasillas(
  canvas: HTMLCanvasElement,
  resultado: ResultadoUniversal,
): Promise<void> {
  if (!leerFlags().dlaOnnx) return;
  const url = process.env.NEXT_PUBLIC_DLA_MODELO_CASILLAS;
  if (!url) return;
  const dudosas = resultado.paginas
    .flatMap((p) => p.campos)
    .filter(
      (c) =>
        c.tipo === 'checkbox' &&
        c.estado === 'requiere_revision' &&
        c.rect,
    ) as (ResultadoCampoUniversal & { rect: NonNullable<ResultadoCampoUniversal['rect']> })[];
  if (dudosas.length === 0) return;
  try {
    const dla = await import('@jg-stevan/dla-onnx');
    const detector = await dla.crearDetectorCasillas();
    if (!detector) return;
    for (const c of dudosas) {
      const x0 = Math.max(0, Math.floor(c.rect.x * canvas.width));
      const y0 = Math.max(0, Math.floor(c.rect.y * canvas.height));
      const w = Math.min(canvas.width - x0, Math.ceil(c.rect.w * canvas.width));
      const h = Math.min(canvas.height - y0, Math.ceil(c.rect.h * canvas.height));
      if (w < 12 || h < 12) continue;
      const zona = document.createElement('canvas');
      zona.width = w;
      zona.height = h;
      zona.getContext('2d', { willReadFrequently: true })!.drawImage(canvas, x0, y0, w, h, 0, 0, w, h);
      const detecciones = await detector.detectar(zona);
      const mejor = detecciones.sort((a, b) => b.conf - a.conf)[0];
      if (!mejor || mejor.conf < 0.7) continue;
      c.banderas.push('onnx_segunda_opinion');
      c.estado = mejor.marcada ? 'ok' : 'no_encontrado';
      c.valor = mejor.marcada;
    }
  } catch (e) {
    // La segunda opinión es ADITIVA: su falta jamás rompe la evaluación.
    logger.warn('[molde] segunda opinión ONNX no disponible', { mensaje: (e as Error).message });
  }
}

/**
 * Evalúa el molde activo sobre la foto procesada del acta.
 * Devuelve null cuando no hay molde activo (el pipeline no cambia nada).
 */
export async function evaluarMoldeEnActa(fotoProcesada: string): Promise<ResumenMoldeActa | null> {
  const molde = moldeActivo();
  if (!molde) return null;
  if (!leerFlags().evaluacionMolde) return null;
  asegurarProveedor();
  const t0 = performance.now();
  const canvas = await fotoACanvas(fotoProcesada, 1000);
  const renderMs = Math.round(performance.now() - t0);
  const resultado = await evaluarDocumentoUniversal(
    [canvas],
    molde,
    molde.nombre,
    undefined,
    renderMs,
    { previews: false },
  );
  await segundaOpinionCasillas(canvas, resultado);
  const resumen = resumir(molde, resultado);
  // FASE B4 (blueprint DLA): PRESENCIA de manuscrito (D-FINE) — señal
  // agregada en el resumen, JAMÁS lectura de texto (el HTR sigue siendo
  // revisión humana). null detector = bandera ausente (Nivel 1).
  const banderaManuscrito = await banderaManuscritoSiDisponible(canvas);
  if (banderaManuscrito) resumen.banderas.push(banderaManuscrito);
  return resumen;
}

/**
 * FASE B4 — bandera de presencia manuscrita con D-FINE. Requiere flag
 * `dlaOnnx` + NEXT_PUBLIC_DLA_MODELO_MANUSCRITO. Sin modelo → null.
 */
async function banderaManuscritoSiDisponible(canvas: HTMLCanvasElement): Promise<string | null> {
  if (!leerFlags().dlaOnnx) return null;
  if (!process.env.NEXT_PUBLIC_DLA_MODELO_MANUSCRITO) return null;
  try {
    const { regionesManuscritas } = await import('@jg-stevan/dla-onnx');
    const regiones = await regionesManuscritas(canvas);
    if (!regiones || regiones.length === 0) return null;
    return `region_manuscrita_${regiones.length}`;
  } catch {
    return null;
  }
}
