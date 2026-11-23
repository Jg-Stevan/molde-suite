'use client';

// FASE 1 (plan v2 — corrección del dueño #1 «REUTILIZAR, NO REINVENTAR»):
// facade fino de NORMALIZACIÓN de páginas para el Studio (Verificación).
//
// NO hay matemática nueva aquí. Este archivo SOLO COMPONE funciones que ya
// existen y funcionan en scanner-core (homografia.ts e image-processor.ts
// quedan INTACTOS):
//   - `processImage(foto, defaultQuad(), 'original', 0, { deskew: true })`
//     → el MISMO camino que Tamiz ejecuta en campo: warp de perspectiva si el
//     quad está sesgado + deskew residual por perfil de proyección
//     (`anguloDeskew` ±10° + `corregirDeskew`) ya dentro de processImage.
//   - Fallback directo (mismo paquete): `anguloDeskew()` + `corregirDeskew()`.
//
// Doctrina del quad (idéntica al pipeline de Tamiz): para ARCHIVOS SUBIDOS
// (escaneos ya recortados) el quad es IDENTIDAD + deskew — NO se re-recorta
// con el detector de bordes (lección del repo: el detector engancha recuadros
// internos del formulario). El detector solo es relevante en cámara, donde
// Tamiz ya lo usa. Este facade respeta exactamente eso.
//
// Salida: canvas a 1000 px de ancho (la canónica del motor — `escalarCanvas`
// del pdf-client, la misma escala sobre la que se calibraron los umbrales) +
// métricas INFORMATIVAS (ángulo aplicado) para el chip forense de Verificación.

import { defaultQuad, type PageFilter, type Quad } from '@jg-stevan/scanner-core/core/types';
import { processImage } from '@jg-stevan/scanner-core/core/image-processor';
import { anguloDeskew, corregirDeskew, quadSesgado } from '@jg-stevan/scanner-core/molde/homografia';
import { escalarCanvas } from '@/lib/ocr/pdf-client';

export interface PaginaNormalizada {
  /** Canvas normalizado (deskew aplicado, ancho de calibración 1000 px). */
  canvas: HTMLCanvasElement;
  /** Ángulo de inclinación corregido en grados (0 = no había inclinación). */
  deskewGrados: number;
  /** true si processImage aplicó warp de perspectiva (quad sesgado). */
  warped: boolean;
}

/** Decodifica un dataURL a canvas (decode del navegador, sin manipulación). */
async function decodificarCanvas(dataUrl: string): Promise<HTMLCanvasElement> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext('2d', { willReadFrequently: true })!.drawImage(img, 0, 0);
  return c;
}

/**
 * Normaliza UNA página para que el Studio calibre y pruebe sobre la MISMA
 * condición de imagen que Tamiz verá en campo (warp + deskew residuales).
 *
 * Acepta un canvas ya renderizado (el camino de Verificación: renderArchivos /
 * renderDocumento a 1000 px) o un dataURL. En ambos casos mide el ángulo de
 * ENTRADA con la MISMA función que processImage usa internamente
 * (`anguloDeskew`, solo lectura) para reportar la métrica honesta del chip.
 *
 * El camino primario es `processImage` (la función de producción); el fallback
 * directo compone `anguloDeskew` + `corregirDeskew` del mismo paquete si
 * processImage falla (decode/HEIC) — degradación honesta, sin invención.
 */
export async function normalizarPagina(
  entrada: HTMLCanvasElement | string,
): Promise<PaginaNormalizada> {
  const canvasEntrada =
    typeof entrada === 'string' ? await decodificarCanvas(entrada) : entrada;

  // Métrica informativa: el ángulo se mide con la función EXISTENTE sobre la
  // entrada (con quad identidad el canvas interno de processImage es el mismo
  // contenido, así que el ángulo reportado es el que se corrige).
  let deskewGrados = 0;
  try {
    deskewGrados = anguloDeskew(canvasEntrada);
  } catch {
    deskewGrados = 0; // sin medición: 0 honesto, el pipeline sigue
  }

  // Doctrina de archivos subidos: quad identidad (sin re-recorte del detector)
  // + filtro 'original' (sin revelado — la calibración fue sobre render limpio)
  // + deskew ON (flag del dueño; el kill-switch vive en la UI de Verificación).
  const quad: Quad = defaultQuad();
  const filtro: PageFilter = 'original';
  try {
    const foto = canvasEntrada.toDataURL('image/jpeg', 0.92);
    const procesada = await processImage(foto, quad, filtro, 0, { deskew: true });
    const canvas = escalarCanvas(await decodificarCanvas(procesada.processed), 1000);
    return { canvas, deskewGrados, warped: quadSesgado(quad) };
  } catch {
    // Fallback directo con las primitivas del mismo paquete (0 matemática
    // nueva): misma corrección, sin el paso de re-encode de processImage.
    const corregido = deskewGrados !== 0 ? corregirDeskew(canvasEntrada, deskewGrados) : canvasEntrada;
    return { canvas: escalarCanvas(corregido, 1000), deskewGrados, warped: false };
  }
}
