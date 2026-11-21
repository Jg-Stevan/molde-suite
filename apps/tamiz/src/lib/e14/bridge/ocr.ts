// OCR del bridge (puerta al motor de Molde Studio, D8 opción B): el texto se
// reconoce con Tesseract.js (spa) — el MISMO motor que usa Molde Studio, así
// el acta se puede verificar luego contra el molde v3. Escalonado = varias
// escalas; Cascada = reintento con realce cuando la primera lectura es débil.

import { logger } from '../../logger';

type TesseractWorkerLike = {
  recognize: (imagen: unknown, opts?: unknown, out?: unknown) => Promise<{ data: { text?: string; confidence?: number } }>;
  setParameters: (p: Record<string, string>) => Promise<unknown>;
  terminate?: () => Promise<unknown>;
};

let workerPromise: Promise<TesseractWorkerLike> | null = null;

async function getWorker(): Promise<TesseractWorkerLike> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('spa', 1, {
        logger: () => {
          /* silencioso: el progreso vive en el pipeline */
        },
      });
      return worker as unknown as TesseractWorkerLike;
    })();
  }
  return workerPromise;
}

async function ocrDataUrl(dataUrl: string, psm?: string): Promise<{ texto: string; conf: number | null }> {
  try {
    const worker = await getWorker();
    if (psm) {
      await worker.setParameters({ tessedit_pageseg_mode: psm });
    }
    const ret = await worker.recognize(dataUrl);
    const conf = ret.data.confidence;
    return {
      texto: (ret.data.text ?? '').trim(),
      conf: typeof conf === 'number' && conf >= 0 ? conf / 100 : null,
    };
  } catch (e) {
    logger.warn('[ocr] recognize falló', { mensaje: (e as Error).message });
    return { texto: '', conf: null };
  }
}

/** OCR base (RapidOCR en el producto original; aquí Tesseract spa). */
export async function reconocerRapidOcr(dataUrl: string): Promise<string> {
  const r = await ocrDataUrl(dataUrl);
  return r.texto;
}

/** OCR escalonado: página completa y, si sale débil, reintento ampliado. */
export async function reconocerRapidOcrEscalonado(dataUrl: string): Promise<string> {
  const primera = await ocrDataUrl(dataUrl, '4');
  if (primera.texto.length >= 40) return primera.texto;
  const segunda = await ocrDataUrl(dataUrl, '3');
  return segunda.texto.length > primera.texto.length ? segunda.texto : primera.texto;
}

/** OCR en cascada: primera lectura + reintento con realce si salió débil. */
export async function reconocerRapidOcrCascada(dataUrl: string): Promise<string> {
  const primera = await reconocerRapidOcrEscalonado(dataUrl);
  if (primera.length >= 60) return primera;
  // Realce: escala de grises + estiramiento p5-p95 antes del reintento.
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    hist[(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) | 0]++;
  }
  const totalPx = px.length / 4;
  let acc = 0;
  let p5 = 0;
  let p95 = 255;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= totalPx * 0.05) {
      p5 = v;
      break;
    }
  }
  acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= totalPx * 0.95) {
      p95 = v;
      break;
    }
  }
  const span = Math.max(8, p95 - p5);
  for (let i = 0; i < px.length; i += 4) {
    const v = Math.min(255, Math.max(0, ((0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2] - p5) * 255) / span));
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(data, 0, 0);
  const segunda = await ocrDataUrl(c.toDataURL('image/jpeg', 0.92), '4');
  return segunda.texto.length > primera.length ? segunda.texto : primera;
}

/** OCR de la banda superior (cabecera/título del acta). */
export async function ocrBanda(dataUrl: string): Promise<string> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = Math.max(1, Math.round(img.naturalHeight * 0.16));
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height, 0, 0, c.width, c.height);
  return (await ocrDataUrl(c.toDataURL('image/jpeg', 0.92), '6')).texto;
}

/** OCR de la banda inferior (sello/firmas del acta). */
export async function ocrBandaInferior(dataUrl: string): Promise<string> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const c = document.createElement('canvas');
  const h16 = Math.max(1, Math.round(img.naturalHeight * 0.2));
  c.width = img.naturalWidth;
  c.height = h16;
  c.getContext('2d')!.drawImage(img, 0, img.naturalHeight - h16, c.width, h16, 0, 0, c.width, h16);
  return (await ocrDataUrl(c.toDataURL('image/jpeg', 0.92), '6')).texto;
}
