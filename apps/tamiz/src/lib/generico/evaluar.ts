import { evaluarDocumentoUniversal } from '@jg-stevan/scanner-core/molde/universal-engine';
import type { MoldeUniversal } from '@jg-stevan/scanner-core/molde/universal-types';
import { configurarProveedorOcr } from '@jg-stevan/scanner-core/molde/ocr-tipos';
import { proveedorOcrTamiz } from '@/lib/e14/molde/ocr-proveedor';
import { prepararPagina } from './procesar';
import { calcularVeredicto } from './veredicto';
import type { ResultadoGenerico } from './tipos';

let proveedorListo = false;

function asegurarProveedor(): void {
  if (proveedorListo) return;
  configurarProveedorOcr(proveedorOcrTamiz);
  proveedorListo = true;
}

export interface OpcionesEvaluacion {
  onProgreso?: (mensaje: string) => void;
  /** Se cancela entre páginas; el OCR de una página no se interrumpe. */
  cancelado?: () => boolean;
}

export class EvaluacionCancelada extends Error {
  constructor() {
    super('Evaluación cancelada');
    this.name = 'EvaluacionCancelada';
  }
}

/**
 * Evalúa N capturas (una por hoja, en el orden en que se tomaron) contra el
 * molde. El motor ya crea páginas sintéticas para las hojas ausentes; el
 * veredicto de producto se calcula aparte (veredicto.ts).
 */
export async function evaluarCapturas(
  molde: MoldeUniversal,
  fotos: string[],
  opts: OpcionesEvaluacion = {},
): Promise<ResultadoGenerico> {
  asegurarProveedor();
  const { onProgreso, cancelado } = opts;
  const canvases: HTMLCanvasElement[] = [];
  const t0 = performance.now();
  try {
    for (let i = 0; i < fotos.length; i++) {
      if (cancelado?.()) throw new EvaluacionCancelada();
      onProgreso?.(`Preparando página ${i + 1}/${fotos.length}...`);
      // Cede el hilo para que la UI pinte el progreso (warp es síncrono).
      await new Promise((r) => setTimeout(r, 0));
      const preparada = await prepararPagina(fotos[i]);
      canvases.push(preparada.canvas);
    }
    if (cancelado?.()) throw new EvaluacionCancelada();
    const renderMs = Math.round(performance.now() - t0);
    onProgreso?.('Leyendo documento...');
    const universal = await evaluarDocumentoUniversal(
      canvases,
      molde,
      molde.nombre,
      onProgreso,
      renderMs,
      { previews: false },
    );
    return calcularVeredicto(molde, universal, fotos.length);
  } finally {
    for (const c of canvases) {
      c.width = 0;
      c.height = 0;
    }
  }
}
