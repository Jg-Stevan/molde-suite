// FASE 0 (blueprint DLA): tipos de OCR del motor universal + PROVEEDOR
// INYECTABLE. El motor universal v3 vivía en apps/molde-studio acoplado a
// `@/lib/ocr/ocr-client` (worker Tesseract del Studio). Al extraerlo a
// packages/scanner-core para que TAMIZ también lo ejecute (evaluación de
// moldes sobre fotos de cámara), el motor pasa a consumir OCR por un
// proveedor configurable: cada app registra su implementación (Studio su
// worker auto-hospedado con probe SIMD; Tamiz su worker del puente) y el
// motor deja de saber de dónde viene el texto.

export interface PalabraOcr {
  texto: string;
  conf: number;
  bbox: [number, number, number, number]; // x0, y0, x1, y1 (px)
}

export interface LineaOcr {
  texto: string;
  bbox: [number, number, number, number];
  palabras: PalabraOcr[];
}

/** Contrato mínimo de OCR que el motor universal necesita por página. */
export interface ProveedorOcr {
  /** OCR de línea/página completa con palabras y bboxes en px del canvas. */
  ocrLines: (canvas: HTMLCanvasElement) => Promise<{ lines: LineaOcr[]; conf: number | null }>;
  /** OCR de una línea única (recorte de campo). psm: 6/7/8/13 de Tesseract. */
  ocrTextoUnico: (
    canvas: HTMLCanvasElement,
    opts?: { whitelist?: string; psm?: '6' | '7' | '8' | '13' },
  ) => Promise<{ texto: string; conf: number | null }>;
}

let proveedor: ProveedorOcr | null = null;

/** Registra el proveedor OCR de la app host. Idempotente (última gana). */
export function configurarProveedorOcr(p: ProveedorOcr): void {
  proveedor = p;
}

/** Proveedor activo. Sin registro, el motor lanza con error ACCIONABLE. */
export function proveedorOcr(): ProveedorOcr {
  if (!proveedor) {
    throw new Error(
      '[scanner-core] No hay proveedor OCR configurado: la app host debe llamar ' +
        'configurarProveedorOcr({ ocrLines, ocrTextoUnico }) antes de evaluar moldes.',
    );
  }
  return proveedor;
}

/** ¿Hay proveedor registrado? (para UIs que deshabilitan el flujo sin OCR). */
export function hayProveedorOcr(): boolean {
  return proveedor !== null;
}

/** JPEG de página/campo para previews — replicado del pdf-client del Studio
 * (escala a maxW y comprime); vive aquí para que el motor no dependa del
 * cliente PDF de una app concreta. */
export function canvasJpeg(canvas: HTMLCanvasElement, maxW = 1400, q = 0.85): string {
  let src = canvas;
  if (canvas.width > maxW) {
    src = document.createElement('canvas');
    src.width = maxW;
    src.height = Math.round((canvas.height * maxW) / canvas.width);
    const ctx = src.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, src.width, src.height);
  }
  return src.toDataURL('image/jpeg', q);
}
