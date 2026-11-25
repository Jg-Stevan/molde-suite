// ETAPA B (plan "interfaz única E-14") — evaluación de MOLDES en el acta.
//
// Antes (FASE 0): solo el molde ACTIVO del operador se evaluaba tras el gate
// y su resumen era estrictamente ADITIVO (nadie lo mostraba). Ahora este
// módulo es el PUENTE Studio→Tamiz completo:
//
//   1. Registra el proveedor OCR de Tamiz en el motor compartido (una vez).
//   2. Si hay molde ACTIVO, se evalúa directamente (comportamiento de
//      siempre — la elección explícita del operador manda).
//   3. Si NO hay activo, el ROUTER (molde/enrutamiento.ts) corre UNA pasada
//      de OCR compartida, prefiltra la biblioteca por anclas y evalúa
//      COMPLETO solo al mejor candidato (motor universal, modo ligero).
//   4. Cuando el molde ganador NO es el del acta E-14 (o el operador lo eligió
//      y el documento no es electoral) y el candidato responde (score ≥
//      umbral), el resultado se marca `enrutado: true`: el veredicto del acta
//      (score/estado/banner) deriva del MOLDE. Solo un acta E-14 reconocida
//      evaluada contra su propio molde deja el resultado ADITIVO.
//
// FASE B2/B4 del blueprint DLA intactas: segunda opinión ONNX para casillas
// dudosas y bandera de presencia manuscrita (señales, nunca veredictos).

import { evaluarDocumentoUniversal } from '@molde-suite/scanner-core/molde/universal-engine';
import type {
  ResultadoCampoUniversal,
  ResultadoUniversal,
} from '@molde-suite/scanner-core/molde/universal-types';
import { configurarProveedorOcr } from '@molde-suite/scanner-core/molde/ocr-tipos';
import { canvasDesdeDataUrl } from '@molde-suite/scanner-core/core/canvas-imagen';
import type { MoldeUniversal } from '@molde-suite/scanner-core/molde/universal-types';
import type { ResumenMoldeActa, ResumenMoldeCampo } from '@molde-suite/scanner-core/dominio/types';
import { proveedorOcrTamiz, ocrLines } from './ocr-proveedor';
import { moldeActivo } from './registry';
import {
  candidatosDeSesion,
  debeEnrutar,
  elegirCandidato,
  sembrarMoldeDemo,
  type ContextoE14Acta,
} from './enrutamiento';
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

/** Banderas agregadas (sin duplicar) de todos los campos del resultado. */
function banderasAgregadas(resultado: ResultadoUniversal): string[] {
  const set = new Set<string>();
  for (const c of resultado.paginas.flatMap((p) => p.campos)) {
    for (const b of c.banderas) set.add(b);
  }
  return [...set];
}

/** Filas por campo para el checklist universal (Etapa B) — la presentación
 *  (destacado/obligatorio/grupo/orden) viaja desde la DEFINICIÓN del molde
 *  por id. */
function filasDeCampos(molde: MoldeUniversal, resultado: ResultadoUniversal): ResumenMoldeCampo[] {
  const defPorId = new Map(molde.campos.map((c) => [c.id, c]));
  return resultado.paginas.flatMap((p) => p.campos).map((c): ResumenMoldeCampo => {
    const def = defPorId.get(c.id);
    return {
      id: c.id,
      etiqueta: c.etiqueta,
      tipo: c.tipo,
      estado: c.estado,
      valor: c.valor,
      conf: c.conf,
      rect: c.rect,
      ...(def?.destacado ? { destacado: true } : {}),
      ...(def?.obligatorio ? { obligatorio: true } : {}),
      // FASE 4 (v3.2.0 — interfaz táctica): grupo/orden para la presentación
      // agrupada del checklist (Encabezado → Identificación → Cuerpo → Cierre).
      ...(def?.grupo ? { grupo: def.grupo } : {}),
      ...(def?.orden !== undefined ? { orden: def.orden } : {}),
    };
  });
}

/** Resumen LIGERO (sin crops/previews) para el Acta — ahora con filas. */
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
    campos: filasDeCampos(molde, resultado),
    enrutado: false,
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
 * ETAPA B — evalúa el mejor molde sobre la foto procesada del acta.
 *  · Molde ACTIVO → evaluación directa (comportamiento de siempre).
 *  · Sin activo → ROUTER sobre la biblioteca (prefiltro por anclas con UNA
 *    pasada de OCR compartida; evaluación completa solo al mejor candidato).
 *  · Devuelve null cuando no hay moldes o ningún ancla matchea — el pipeline
 *    no cambia nada (honesto).
 */
export async function evaluarMoldeEnActa(
  fotoProcesada: string,
  contexto?: ContextoE14Acta,
): Promise<ResumenMoldeActa | null> {
  if (!leerFlags().evaluacionMolde) return null;
  asegurarProveedor();
  await sembrarMoldeDemo();
  const moldes = await candidatosDeSesion();
  if (moldes.length === 0) return null;

  const t0 = performance.now();
  const canvas = await canvasDesdeDataUrl(fotoProcesada, { ancho: 1000 });
  const renderMs = Math.round(performance.now() - t0);

  // Elección del molde: activo explícito o mejor candidato del router.
  let molde: MoldeUniversal;
  if (moldeActivo()) {
    molde = moldes[0];
  } else {
    const ocr = await ocrLines(canvas);
    const candidato = elegirCandidato(moldes, ocr.lines, canvas.width, canvas.height);
    if (!candidato) return null; // ninguna ancla matchea → comportamiento de siempre
    molde = candidato.molde;
    logger.info('[molde] candidato del router', {
      nombre: molde.nombre,
      ratioAnclas: Math.round(candidato.ratioAnclas * 100) / 100,
    });
  }

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
  // Telemetría honesta del puente (visible en consola DEV): qué leyó el
  // motor universal y por qué estado va cada campo.
  logger.info('[molde] resumen del motor universal', {
    molde: molde.nombre,
    score: resultado.score,
    ok: resultado.ok_count,
    total: resultado.total,
    obligatoriosFaltantes: resultado.obligatorios_faltantes,
    campos: resultado.paginas
      .flatMap((p) => p.campos)
      .map(
        (c) =>
          `${c.etiqueta}=${c.estado}${typeof c.valor === 'string' && c.valor ? `(${c.valor})` : ''}${c.banderas.length > 0 ? `[${c.banderas.join('|')}]` : ''} rect=${c.rect ? `${c.rect.x.toFixed(3)},${c.rect.y.toFixed(3)},${c.rect.w.toFixed(3)},${c.rect.h.toFixed(3)}` : 'null'} fuente=${c.fuente ?? 'null'} ratio=${c.ratio != null ? c.ratio.toFixed(3) : 'null'} conf=${c.conf != null ? c.conf.toFixed(2) : 'null'}`,
      ),
  });

  // FASE B4 (blueprint DLA): PRESENCIA de manuscrito (D-FINE) — señal
  // agregada en el resumen, JAMÁS lectura de texto (el HTR sigue siendo
  // revisión humana). null detector = bandera ausente (Nivel 1).
  const banderaManuscrito = await banderaManuscritoSiDisponible(canvas);
  if (banderaManuscrito) resumen.banderas.push(banderaManuscrito);

  // ETAPA B — ¿el molde se convierte en el VEREDICTO del acta? Lo decide
  // `debeEnrutar` (qué molde ganó + confianza del motor), no el flag `esE14`
  // del clasificador electoral, que se enciende con cualquier «MESA» del OCR.
  if (debeEnrutar(molde, contexto, resultado.score, resultado.ok_count)) {
    resumen.enrutado = true;
    logger.info('[molde] acta ENRUTADA al molde', {
      nombre: molde.nombre,
      score: resultado.score,
      ok: resultado.ok_count,
      total: resultado.total,
    });
  }
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
