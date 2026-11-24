// EVALUADOR de reglas estructurales (PLAN-AGENTE-LAYOUT F2) — port tipado del
// prototipo validado docs/investigacion/pp-doclayout/estructura-e14.js
// (19/19 plus-L contra el GT de Chandra en E-14 p1), GENERALIZADO a reglas
// declarativas del molde: PROHIBIDO hardcodear el E-14 aquí (riesgo del plan §7).
//
// Mecánica portada del prototipo:
// · Pertenencia a zona: la caja debe caer COMPLETA dentro de la zona agrandada
//   por el margen (default 2% de W/H) — el margen fue clave en `Todas reales`
//   (sin él se perdían candidatos/votos/consulado por 4-30 px).
// · NMS interno por grupo (IoU 0.5) antes de tomar hasta `maximo`.
// · `dividir`: el contenedor de MAYOR ÁREA se parte por cortes relativos del
//   eje y (títulos fusionados de S, tablas de candidatos del E-14).
// · Banda de baja confianza: candidatos dentro de la zona con score entre
//   (minScore - banda) y minScore → estado baja_confianza (continúa a OCR).
//
// Sin DOM, sin React, sin ORT: corre en bun test, en worker y en navegador.

import type { ReglaLayout } from '@molde-suite/scanner-core/molde/universal-types';
import { normalizarClase } from './clases';
import { area, clamp01, iou as iouDe } from './geom';
import { nmsClaseAgnostico, type CajaConScore } from './nms';
import type {
  CajaLayout,
  ModeloLayout,
  OpcionesEstructura,
  ParteReglaLayout,
  ResultadoEstructura,
  ResultadoReglaLayout,
} from './tipos';

export const DEFAULT_MARGEN = 0.02;
export const DEFAULT_NMS_INTERNO = 0.5;
export const DEFAULT_MIN_SCORE = 0.2;
export const BANDA_BAJA = 0.05;

interface Candidato extends CajaConScore {
  caja: CajaLayout;
}

/** ¿La caja (px) cae COMPLETA dentro de la zona normalizada agrandada? */
function dentroZona(
  c: CajaLayout,
  zona: ReglaLayout['zona'],
  margen: number,
  W: number,
  H: number,
): boolean {
  const nx1 = c.x1 / W;
  const ny1 = c.y1 / H;
  const nx2 = c.x2 / W;
  const ny2 = c.y2 / H;
  const zx1 = zona.x - margen;
  const zy1 = zona.y - margen;
  const zx2 = zona.x + zona.w + margen;
  const zy2 = zona.y + zona.h + margen;
  return nx1 >= zx1 && ny1 >= zy1 && nx2 <= zx2 && ny2 <= zy2;
}

/** Cumple las restricciones de tamaño normalizadas (fracciones de la página). */
function cumpleTamano(c: CajaLayout, r: ReglaLayout, W: number, H: number): boolean {
  const w = (c.x2 - c.x1) / W;
  const h = (c.y2 - c.y1) / H;
  if (r.minW !== undefined && w < r.minW) return false;
  if (r.maxW !== undefined && w > r.maxW) return false;
  if (r.minH !== undefined && h < r.minH) return false;
  if (r.maxH !== undefined && h > r.maxH) return false;
  return true;
}

/** Parte un contenedor por cortes relativos del eje y (N cortes → N+1 partes). */
function partirContenedor(cont: CajaLayout, r: ReglaLayout): ParteReglaLayout[] {
  const d = r.dividir!;
  const cortes = [...d.cortes].sort((a, b) => a - b);
  const alto = cont.y2 - cont.y1;
  const limites = [cont.y1, ...cortes.map((f) => cont.y1 + clamp01(f) * alto), cont.y2];
  const partes: ParteReglaLayout[] = [];
  for (let i = 0; i < limites.length - 1; i++) {
    partes.push({
      etiqueta: d.etiquetas?.[i],
      campoId: d.campoIds?.[i],
      caja: {
        clase: cont.clase,
        score: cont.score,
        x1: cont.x1,
        y1: limites[i],
        x2: cont.x2,
        y2: limites[i + 1],
      },
    });
  }
  return partes;
}

/** Evalúa UNA regla contra el pool de detecciones (px de la página). */
function evaluarRegla(
  r: ReglaLayout,
  pool: CajaLayout[],
  W: number,
  H: number,
  opts: Required<Pick<OpcionesEstructura, 'margenDefault' | 'nmsInterno' | 'bandaBaja'>>,
): ResultadoReglaLayout {
  const margen = r.tolerancia ?? opts.margenDefault;
  const minScore = r.minScore ?? DEFAULT_MIN_SCORE;
  const minimo = r.minimo ?? 1;
  const maximo = r.maximo ?? 1;
  const clases = new Set(r.clases.map(normalizarClase));

  const enZona = pool.filter((c) => {
    if (!dentroZona(c, r.zona, margen, W, H)) return false;
    if (!clases.has(normalizarClase(String(c.clase)))) return false;
    if (!cumpleTamano(c, r, W, H)) return false;
    return true;
  });

  // Pool FUERTE (score >= minScore) para aceptar; el pool completo alimenta
  // la banda de baja confianza (score entre minScore-banda y minScore).
  const fuertes = enZona.filter((c) => c.score >= minScore);
  const nmsInt = nmsClaseAgnostico(fuertes, opts.nmsInterno);
  const aceptadas: CajaLayout[] = [];
  let partes: ParteReglaLayout[] | undefined;

  if (r.dividir) {
    // Contenedor de MAYOR ÁREA (prototipo: .sort((a,b)=>area(b)-area(a))[0]).
    const cont = [...nmsInt].sort((a, b) => area(b) - area(a))[0];
    if (cont) {
      partes = partirContenedor(cont, r);
      aceptadas.push(...partes.map((p) => p.caja));
    }
  } else {
    for (const c of nmsInt) {
      if (aceptadas.length >= maximo) break;
      aceptadas.push(c);
    }
  }

  const conteo = aceptadas.length;
  const scoreMax = conteo > 0 ? Math.max(...aceptadas.map((c) => c.score)) : null;
  let estado: ResultadoReglaLayout['estado'];
  let motivo: string | undefined;

  // Sobrante (opt-in estricto): la regla se llenó por top-N pero la zona
  // contiene MÁS candidatos fuertes distintos de lo permitido — señal de
  // documento equivocado para reglas que la declaran.
  const conSobrantes = r.estricto === true && nmsInt.length > maximo && conteo >= minimo;
  if (conSobrantes) {
    estado = 'sobrante';
    motivo = `Se esperaban entre ${minimo} y ${maximo} bloque(s) y hay ${nmsInt.length} candidatos`;
  } else if (conteo >= minimo && conteo <= maximo) {
    estado = 'ok';
  } else if (conteo > maximo) {
    estado = 'sobrante';
    motivo = `Se esperaban entre ${minimo} y ${maximo} bloque(s) y hay ${nmsInt.length} candidatos`;
  } else {
    const debiles = enZona.some((c) => c.score < minScore && c.score >= minScore - opts.bandaBaja);
    if (debiles) {
      estado = 'baja_confianza';
      motivo = `Candidatos con score bajo dentro de la zona (minScore ${minScore})`;
    } else {
      estado = 'faltante';
      motivo =
        r.dividir && enZona.length === 0
          ? 'No se detectó el contenedor dentro de la zona'
          : `Se esperaban ${minimo} bloque(s) y se encontraron ${conteo}`;
    }
  }

  return {
    reglaId: r.id,
    etiqueta: r.etiqueta,
    estado,
    cajas: aceptadas,
    partes,
    score: scoreMax,
    motivo,
  };
}

/**
 * Punto de entrada del gate estructural (contrato §4.3 del plan).
 *
 * @param detecciones Cajas de la página EN PIXELS (el motor ya escaló/clamp).
 * @param reglas      Reglas declarativas del molde (ReglaLayout[]).
 * @param W,H         Tamaño de la página en px.
 * @param opts        Margen/NMS/banda/página (defaults del plan §7).
 *
 * ASIGNACIÓN CODICIOSA entre reglas (en orden de declaración): una caja solo
 * puede satisfacer UNA regla — al aceptar, la caja y sus DUPLICADOS (IoU ≥ 0.5)
 * salen del pool para las reglas siguientes. Sin esto, el margen de 2% admite
 * vecinos (el número del código de barras entra en la franja de títulos y roba
 * el tercer título por 0.005 de score): el prototipo evitaba el robo por 0.1 px
 * de suerte con zonas estrictas; el consumo lo hace determinista y compatible
 * con el margen del dossier (clave en `Todas reales`).
 */
export function evaluarEstructura(
  detecciones: CajaLayout[],
  reglas: ReglaLayout[],
  W: number,
  H: number,
  opts?: OpcionesEstructura,
): ResultadoEstructura {
  const t0 =
    typeof performance !== 'undefined' ? performance.now() : Date.now();
  const opciones = {
    margenDefault: opts?.margenDefault ?? DEFAULT_MARGEN,
    nmsInterno: opts?.nmsInterno ?? DEFAULT_NMS_INTERNO,
    bandaBaja: opts?.bandaBaja ?? BANDA_BAJA,
  };
  const pagina = opts?.pagina;

  const pool: CajaLayout[] = detecciones.filter(
    (c) => Number.isFinite(c.x1) && Number.isFinite(c.y1) && c.x2 > c.x1 && c.y2 > c.y1,
  );

  const reglasPagina = reglas.filter((r) => pagina === undefined || (r.pagina ?? 1) === pagina);
  const resultados: ResultadoReglaLayout[] = [];
  for (const r of reglasPagina) {
    const res = evaluarRegla(r, pool, W, H, opciones);
    resultados.push(res);
    if (res.cajas.length > 0) {
      const consumidas = new Set(res.cajas);
      for (let i = pool.length - 1; i >= 0; i--) {
        const c = pool[i];
        if (consumidas.has(c) || res.cajas.some((a) => iouDe(c, a) >= 0.5)) {
          pool.splice(i, 1);
        }
      }
    }
  }

  const obligatoriasFaltantes = resultados
    .filter(
      (res) =>
        res.estado === 'faltante' || res.estado === 'baja_confianza',
    )
    .map((res) => res.reglaId)
    .filter((id) => reglasPagina.find((r) => r.id === id)?.obligatorio === true);

  const obligatoriasOk = resultados.every(
    (res) => {
      const r = reglasPagina.find((x) => x.id === res.reglaId);
      return r?.obligatorio !== true || res.estado === 'ok';
    },
  );
  const opcionalesConProblemas = resultados.some(
    (res) => res.estado !== 'ok' && reglasPagina.find((r) => r.id === res.reglaId)?.obligatorio !== true,
  );

  const ms =
    (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;

  return {
    modelo: 's',
    ms: Math.round(ms * 1000) / 1000,
    reglas: resultados,
    obligatorias_faltantes: obligatoriasFaltantes,
    ok: obligatoriasOk,
    requiere_revision: obligatoriasOk && opcionalesConProblemas,
  };
}

/** Ajusta el modelo reportado (el evaluador es agnóstico; el llamador sabe
 *  qué modelo produjo las detecciones). */
export function conModelo(res: ResultadoEstructura, modelo: ModeloLayout): ResultadoEstructura {
  return { ...res, modelo };
}

/** Exports reutilizados por los golden tests y el spike F0. */
export { iouDe as iou };
