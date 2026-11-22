// PLAN-AGENTE-LAYOUT F4: GATE ESTRUCTURAL (etapa LAYOUT entre CALIDAD y OCR).
// Ejecuta el evaluador de reglas declarativas del molde activo
// (@jg-stevan/layout-core — lógica compartida Studio↔Tamiz) sobre las
// regiones detectadas por PP-DocLayout (@jg-stevan/dla-onnx).
// Lema del gate: «un documento equivocado no debe gastar un OCR completo».
//
// Patrón defensivo de ocr-dinamico.ts (FASE B3): flag + env + detector
// null-safe y try/catch TOTAL — NUNCA lanza: null = etapa saltada y el
// escaneo continúa (retrocompatible con moldes sin `layout`, v3.0.0).

import { evaluarEstructura, normalizarClase } from '@jg-stevan/layout-core';
import type { CajaLayout } from '@jg-stevan/layout-core';
import type { EstructuraActa } from '@jg-stevan/scanner-core/dominio/types';
import '../dla/config';
import { moldeActivo } from '../molde/registry';
import { leerFlags } from '../flags';
import { logger } from '../../logger';

/** Tope del lado mayor del canvas de detección (la memoria del móvil manda). */
const LADO_MAX = 2048;

/**
 * Gate estructural del acta con el molde activo, o null cuando NO aplica:
 *  - sin molde activo, molde sin `layout` o sin reglas (v3.0.0 — etapa saltada),
 *  - flag `dlaOnnx` apagada (kill-switch del operador, Panel DEV — señales ONNX),
 *  - modelo de layout no configurado (NEXT_PUBLIC_DLA_MODELO_LAYOUT → detector null),
 *  - cualquier fallo de carga/detección/evaluación (degradación honesta).
 *
 * El veredicto NUNCA inventa: `ok`/`obligatorias_faltantes` salen del
 * evaluador puro de layout-core con las cajas REALES del detector.
 */
export async function evaluarEstructuraDelActa(
  fotoProcesada: string,
): Promise<EstructuraActa | null> {
  const molde = moldeActivo();
  if (!molde?.layout || molde.layout.reglas.length === 0) return null; // etapa saltada
  if (!leerFlags().dlaOnnx) return null; // señales ONNX apagadas por el operador
  let detector;
  try {
    const { crearDetectorLayout } = await import('@jg-stevan/dla-onnx');
    detector = await crearDetectorLayout();
  } catch {
    return null;
  }
  if (!detector) return null; // modelo no configurado → Nivel 1 intacto
  try {
    const t0 = performance.now();
    const canvas = await fotoACanvasTope(fotoProcesada, LADO_MAX);
    const W = canvas.width;
    const H = canvas.height;
    const detecciones = await detector.detectar(canvas);
    // Detecciones normalizadas 0-1 → cajas en PIXELS de la página (contrato
    // del evaluador de layout-core). Clases crudas → canónicas (nombres,
    // jamás índices — regla del dossier MODELOS-Y-DATOS §3).
    const cajas: CajaLayout[] = detecciones.map((d) => ({
      clase: normalizarClase(d.clase),
      score: d.conf,
      x1: clamp01(d.caja.x) * W,
      y1: clamp01(d.caja.y) * H,
      x2: clamp01(d.caja.x + d.caja.w) * W,
      y2: clamp01(d.caja.y + d.caja.h) * H,
    }));
    const resultado = evaluarEstructura(cajas, molde.layout.reglas, W, H, {
      pagina: 1,
    });
    // ms del ESTADIO completo (render + inferencia + evaluación): dato honesto
    // para el diagnóstico en pantalla (el watchdog mide lo mismo en msParciales).
    const ms = Math.round(performance.now() - t0);
    // Mapeo a EstructuraActa: cajas NORMALIZADAS de vuelta (el overlay de
    // REVISIÓN las posiciona con %). Honestidad del modelo: el detector
    // configurado hoy es la variante S de PP-DocLayout (preset 'layout' de
    // dla-onnx); si el molde declara plusL el gate se evaluó IGUALMENTE con S
    // y se reporta el modelo REAL usado (el evaluador es agnóstico — cuando
    // plus-L exista en dla-onnx este campo sigue al preset efectivo).
    return {
      modelo: resultado.modelo,
      ms,
      ok: resultado.ok,
      requiere_revision: resultado.requiere_revision,
      obligatorias_faltantes: [...resultado.obligatorias_faltantes],
      reglas: resultado.reglas.map((r) => ({
        reglaId: r.reglaId,
        etiqueta: r.etiqueta,
        estado: r.estado,
        motivo: r.motivo,
        cajas: r.cajas.map((c) => ({
          x: clamp01(c.x1 / W),
          y: clamp01(c.y1 / H),
          w: clamp01((c.x2 - c.x1) / W),
          h: clamp01((c.y2 - c.y1) / H),
        })),
      })),
    };
  } catch (e) {
    logger.warn('[e14] gate estructural no disponible', {
      mensaje: (e as Error).message,
    });
    return null;
  }
}

/** Carga un dataURL a canvas escalado para que su lado MAYOR mida `tope` px. */
async function fotoACanvasTope(dataUrl: string, tope: number): Promise<HTMLCanvasElement> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const ladoMayor = Math.max(img.naturalWidth, img.naturalHeight);
  const escala = ladoMayor > tope ? tope / ladoMayor : 1;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * escala));
  c.height = Math.max(1, Math.round(img.naturalHeight * escala));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
