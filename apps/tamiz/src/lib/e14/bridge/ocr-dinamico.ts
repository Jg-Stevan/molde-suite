// FASE B3 (blueprint DLA): banda OCR DINÁMICA con PP-DocLayout (Nivel 2).
// Reemplaza los porcentajes fijos (16% superior / 20% inferior) de ocrBanda/
// ocrBandaInferior cuando el operador activa `dlaOnnx` y configura la URL del
// modelo (NEXT_PUBLIC_DLA_MODELO_LAYOUT). Sin señal disponible (flag off, sin
// URL, error de sesión) → null y el pipeline usa las bandas fijas de siempre
// (Nivel 1 intacto — degradación honesta).

import { leerFlags } from "../flags";
import { logger } from "../../logger";
import { canvasDesdeDataUrl } from "@molde-suite/scanner-core/core/canvas-imagen";
import "../dla/config";

let avisadoSinModelo = false;

/** OCR de la banda dinámica ('sup' cabecera / 'inf' pie) o null sin señal. */
export async function ocrBandaDinamicaSiDisponible(
  fotoProcesada: string,
  parte: "sup" | "inf",
): Promise<string | null> {
  if (!leerFlags().dlaOnnx) return null;
  if (!process.env.NEXT_PUBLIC_DLA_MODELO_LAYOUT) {
    if (!avisadoSinModelo) {
      avisadoSinModelo = true;
      logger.info("[dla-onnx] flag activa sin NEXT_PUBLIC_DLA_MODELO_LAYOUT: bandas fijas");
    }
    return null;
  }
  try {
    const { crearDetectorLayout, bandasDesdeRegiones } = await import("@jg-stevan/dla-onnx");
    const detector = await crearDetectorLayout();
    if (!detector) return null;
    const canvas = await canvasDesdeDataUrl(fotoProcesada, { ancho: 800 });
    const regiones = await detector.detectar(canvas);
    const bandas = bandasDesdeRegiones(regiones);
    const banda = parte === "sup" ? bandas.sup : bandas.inf;
    if (!banda) return null;
    const recorte = document.createElement("canvas");
    recorte.width = canvas.width;
    recorte.height = Math.max(8, Math.round((banda.y1 - banda.y0) * canvas.height));
    const ctx = recorte.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(
      canvas,
      0,
      Math.round(banda.y0 * canvas.height),
      canvas.width,
      recorte.height,
      0,
      0,
      canvas.width,
      recorte.height,
    );
    // OCR del recorte con el MISMO worker del puente (psm 6, bloque de texto).
    const { getWorker } = await import("./ocr-worker");
    const worker = await getWorker();
    await worker.setParameters({ tessedit_pageseg_mode: "6" });
    const ret = await worker.recognize(recorte);
    return (ret.data.text ?? "").trim() || null;
  } catch (e) {
    logger.warn("[dla-onnx] banda dinámica no disponible", { mensaje: (e as Error).message });
    return null;
  }
}
