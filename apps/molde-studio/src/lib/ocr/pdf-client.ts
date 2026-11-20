'use client';

// Render de paginas (PDF via pdf.js, imagen directa) a canvas para el motor.

// Las calibraciones del molde v2 (blockSize 31, area_min 150, umbrales de tinta)
// fueron ajustadas sobre paginas de 1000 px de ancho: mantener esa escala.
const TARGET_WIDTH = 1000;

export interface RenderizadoDocumento {
  canvases: HTMLCanvasElement[];
  numPaginas: number;
  renderMsPorPagina: number[];
}

async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  return pdfjs;
}

function drawScaled(
  source: HTMLCanvasElement,
  targetWidth: number,
): HTMLCanvasElement {
  const scale = Math.min(1, targetWidth / source.width);
  const w = Math.max(1, Math.round(source.width * scale));
  const h = Math.max(1, Math.round(source.height * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  return c;
}

export async function renderDocumento(file: File): Promise<RenderizadoDocumento> {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const pdfjs = await loadPdfjs();
    const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() });
    const doc = await loadingTask.promise;
    const canvases: HTMLCanvasElement[] = [];
    const renderMsPorPagina: number[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(3, Math.max(1, TARGET_WIDTH / base.width));
      const viewport = page.getViewport({ scale });
      const t0 = performance.now();
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport } as never).promise;
      canvases.push(canvas);
      renderMsPorPagina.push(performance.now() - t0);
    }
    await loadingTask.destroy();
    return { canvases, numPaginas: canvases.length, renderMsPorPagina };
  }
  // imagen suelta (foto recortada del acta)
  const bitmap = await createImageBitmap(file);
  const src = document.createElement('canvas');
  src.width = bitmap.width;
  src.height = bitmap.height;
  const sctx = src.getContext('2d', { willReadFrequently: true })!;
  sctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const t0 = performance.now();
  const canvas = drawScaled(src, TARGET_WIDTH);
  return { canvases: [canvas], numPaginas: 1, renderMsPorPagina: [performance.now() - t0] };
}

/** Acepta un PDF (varias paginas) o varias imagenes (una por pagina). */
export async function renderArchivos(files: File[]): Promise<RenderizadoDocumento> {
  const pdf = files.find(
    (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
  );
  if (pdf) return renderDocumento(pdf);
  const canvases: HTMLCanvasElement[] = [];
  const renderMsPorPagina: number[] = [];
  for (const f of files) {
    const r = await renderDocumento(f);
    canvases.push(...r.canvases);
    renderMsPorPagina.push(...r.renderMsPorPagina);
  }
  return { canvases, numPaginas: canvases.length, renderMsPorPagina };
}

/** JPEG (dataURL) de una pagina, reducido para enviar al VLM. */
export function canvasToJpeg(canvas: HTMLCanvasElement, maxW = 1400, q = 0.85): string {
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
