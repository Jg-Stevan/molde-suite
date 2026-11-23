import {
  detectDocumentEdgesDetail,
  processImage,
} from '@jg-stevan/scanner-core/core/image-processor';

/** Tope de la foto que entra al procesador (memoria del móvil). */
const MAX_LADO_CAPTURA = 2000;
/** Escala canónica de análisis: las zonas 0..1 se miden sobre este canvas. */
export const LADO_MOTOR = 1200;

export interface PaginaPreparada {
  /** Imagen revelada (b/n + deskew) reutilizable como miniatura. */
  dataUrl: string;
  /** Canvas canónico que consume el motor. */
  canvas: HTMLCanvasElement;
  /** 'detector' | 'identidad' | 'sin-recorte' (fallback). */
  origen: string;
}

function cargarImagen(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo leer la imagen'));
    img.src = src;
  });
}

/** Reduce la foto sin ampliarla nunca (una foto pequeña se queda igual). */
export async function reducirDataUrl(
  dataUrl: string,
  maxLado = MAX_LADO_CAPTURA,
): Promise<string> {
  const img = await cargarImagen(dataUrl);
  const mayor = Math.max(img.naturalWidth, img.naturalHeight);
  if (!mayor || mayor <= maxLado) return dataUrl;
  const escala = maxLado / mayor;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * escala));
  c.height = Math.max(1, Math.round(img.naturalHeight * escala));
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  const salida = c.toDataURL('image/jpeg', 0.92);
  c.width = 0;
  c.height = 0;
  return salida;
}

/** dataURL → canvas de análisis (máx. `maxLado` px, sin upscale, fondo blanco). */
export async function dataUrlACanvas(
  dataUrl: string,
  maxLado = LADO_MOTOR,
): Promise<HTMLCanvasElement> {
  const img = await cargarImagen(dataUrl);
  const escala = Math.min(
    1,
    maxLado / Math.max(1, img.naturalWidth, img.naturalHeight),
  );
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * escala));
  c.height = Math.max(1, Math.round(img.naturalHeight * escala));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/**
 * ¿El anillo del borde de la foto es papel blanco? Un scan limpio (o una foto
 * donde la hoja llena el cuadro) trae bordes blancos: el detector de bordes
 * (pensado para fotos con fondo de mesa) agarra entonces la CAJA DE TINTA y
 * recorta mal la página, y el revelado b/n de processImage colapsa a NEGRO
 * una página casi blanca (estiramiento p5/p95 sin píxeles oscuros de fondo).
 * En ese caso la foto reducida YA es la página: se usa tal cual.
 */
async function bordesBlancos(dataUrl: string): Promise<boolean> {
  try {
    const img = await cargarImagen(dataUrl);
    const w = 240;
    const h = Math.max(1, Math.round((img.naturalHeight / Math.max(1, img.naturalWidth)) * w));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const grosorX = Math.max(2, Math.round(w * 0.03));
    const grosorY = Math.max(2, Math.round(h * 0.03));
    let muestras = 0;
    let oscuros = 0;
    let suma = 0;
    const considerar = (x: number, y: number): void => {
      const i = (y * w + x) * 4;
      const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      muestras++;
      suma += g;
      if (g < 200) oscuros++;
    };
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < grosorY; y++) {
        considerar(x, y);
        considerar(x, h - 1 - y);
      }
    }
    for (let y = grosorY; y < h - grosorY; y++) {
      for (let x = 0; x < grosorX; x++) {
        considerar(x, y);
        considerar(w - 1 - x, y);
      }
    }
    const media = suma / Math.max(1, muestras);
    const fracOscuros = oscuros / Math.max(1, muestras);
    // Tolerancia para cabeceras oscuras impresas que tocan el borde (p. ej. el
    // recuadro negro "E-24 CON"): una foto real con fondo de mesa tiene una
    // media mucho más baja y una fracción oscura dominante.
    return media >= 235 && fracOscuros <= 0.06;
  } catch {
    return false;
  }
}

/**
 * ¿El revelado b/n colapsó la página a negro? El estiramiento p5/p95 de
 * processImage convierte una página casi blanca en una imagen toda negra
 * cuando no hay píxeles oscuros suficientes en el foto completo. Detectarlo
 * es barato y permite rescatar la hoja con la foto original.
 */
async function reveladoColapsado(dataUrl: string): Promise<boolean> {
  try {
    const img = await cargarImagen(dataUrl);
    const w = 160;
    const h = Math.max(1, Math.round((img.naturalHeight / Math.max(1, img.naturalWidth)) * w));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    let suma = 0;
    const n = w * h;
    for (let i = 0; i < n; i++) {
      const j = i * 4;
      suma += 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
    }
    return suma / n < 60;
  } catch {
    return false;
  }
}

/**
 * Pipeline de una hoja: reducir → (scan limpio: identidad) → detector de
 * bordes → warp + b/n + deskew → canvas canónico.
 *
 * Guardias de rescate (no tocan el núcleo compartido):
 *  · bordes blancos → la foto ya es la página completa: sin recorte ni
 *    revelado b/n (el motor binariza cada recorte de campo por su cuenta).
 *  · revelado colapsado (imagen negra) → rescate con la foto reducida.
 *  · cualquier excepción → foto reducida tal cual ('sin-recorte').
 * Nunca se aborta la página: la evaluación es mejor intentarla que perderla.
 */
export async function prepararPagina(foto: string): Promise<PaginaPreparada> {
  // Guardia de scan limpio medido sobre la IMAGEN ORIGINAL (más fiable que el
  // JPEG reducido): si el anillo del borde es papel blanco, la foto ya es la
  // página completa. El canvas del motor se hace con UN SOLO re-muestreo
  // directa del original (PNG sin pérdida): el JPEG intermedio de
  // reducirDataUrl + el segundo escalado degradaban el OCR hasta fusionar
  // palabras ("Pág 2 de 6" → "Pág2de6") y las anclas caían del corte 0.72.
  if (await bordesBlancos(foto)) {
    return {
      dataUrl: foto,
      canvas: await dataUrlACanvas(foto),
      origen: 'identidad',
    };
  }

  const reducida = await reducirDataUrl(foto);
  try {
    const { quad, origen: detectado } = await detectDocumentEdgesDetail(reducida);
    const { processed } = await processImage(reducida, quad, 'bw', 0, {
      deskew: true,
    });
    if (processed && !(await reveladoColapsado(processed))) {
      return {
        dataUrl: processed,
        canvas: await dataUrlACanvas(processed),
        origen: detectado,
      };
    }
    // El b/n degradó la página: rescate honesto con la foto reducida.
    return {
      dataUrl: reducida,
      canvas: await dataUrlACanvas(reducida),
      origen: 'rescate-bn',
    };
  } catch {
    // Fallback silencioso y explícito en el origen del reporte.
    return {
      dataUrl: reducida,
      canvas: await dataUrlACanvas(reducida),
      origen: 'sin-recorte',
    };
  }
}
