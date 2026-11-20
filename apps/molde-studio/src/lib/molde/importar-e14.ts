// Importador: convierte el molde E-14 v2 (e14.schema.v2.json) al formato
// universal v3, preservando la semántica del motor:
// - fila/banda/casilla_firma -> ancla_relativa con x_absoluto=true
//   (x es columna absoluta del documento, y se offsetea desde el ancla)
// - campos regex (texto) -> ancla_relativa con la zona a la derecha del ancla
// - recuento_si_no -> aproximación con offsets relativos (refinar en editor)
// Todo queda editable y alineable con OCR desde el editor visual.

import type { CampoMolde, Molde as MoldeE14, Zona } from './types';
import {
  MOLDE_UNIVERSAL_VERSION,
  nuevoIdCampo,
  type CampoUniversal,
  type MoldeUniversal,
  type RectNorm,
} from './universal-types';

function limpiarRegex(patron: string): string {
  // '\s*' -> ' ', '\W{0,2}' -> ' ', '\d' -> ' ', sin paréntesis/llaves/símbolos
  return patron
    .replace(/\\[sSwWdD]+/g, ' ')
    .replace(/[\\^$(){}[\]|.*+?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Primera palabra útil del patrón como texto de ancla (ej: 'CONSULADO'). */
function anclaDePatron(patron: string): string {
  const limpio = limpiarRegex(patron);
  const palabra = limpio.split(' ').find((p) => p.length >= 3);
  return (palabra ?? limpio.split(' ')[0] ?? '').toUpperCase().replace(/[^A-Z0-9ÁÉÍÓÚÑÜ ]/g, '').trim();
}

function tipoUniversal(c: CampoMolde): CampoUniversal['tipo'] {
  if (c.tipo === 'firma') return 'firma';
  if (c.tipo === 'texto') return 'texto';
  return 'presencia';
}

interface Rel {
  dx: number;
  dy: number;
  w: number;
  h: number;
  xAbs: boolean;
}

/** Convierte una zona v2 (fila/banda/casilla_firma) en offsets relativos al ancla. */
function zonaARelativa(zona: Zona, juradoNum?: number): Rel | null {
  switch (zona.tipo) {
    case 'fila':
      return {
        dx: zona.columna_x0,
        dy: zona.y0_rel,
        w: zona.columna_x1 - zona.columna_x0,
        h: zona.y1_rel - zona.y0_rel,
        xAbs: true,
      };
    case 'banda':
      return { dx: zona.x0, dy: zona.y0_rel, w: zona.x1 - zona.x0, h: zona.y1_rel - zona.y0_rel, xAbs: true };
    case 'casilla_firma': {
      const [a, b] = juradoNum !== undefined && juradoNum % 2 === 0 ? zona.col_der : zona.col_izq;
      return { dx: a, dy: zona.dy0, w: b - a, h: zona.dy1 - zona.dy0, xAbs: true };
    }
    default:
      return null;
  }
}

function zonaFijaARect(zf: { x0: number; y0: number; x1: number; y1: number }): RectNorm {
  return { x: zf.x0, y: zf.y0, w: zf.x1 - zf.x0, h: zf.y1 - zf.y0 };
}

export function importarMoldeE14(m: MoldeE14): MoldeUniversal {
  const campos: CampoUniversal[] = m.campos.map((c) => {
    const base: CampoUniversal = {
      id: nuevoIdCampo(),
      etiqueta: c.etiqueta,
      pagina: c.pagina,
      tipo: tipoUniversal(c),
      estrategia: 'zona_fija',
      zona: c.zona_fija ? zonaFijaARect(c.zona_fija) : { x: 0.05, y: 0.05, w: 0.3, h: 0.03 },
      umbral: c.umbral_tinta ?? 0.03,
      obligatorio: c.obligatorio,
      nota: c.nota,
    };

    // Campos de texto (regex): buscar el ancla y leer la zona a su derecha
    if (c.tipo === 'texto' && c.patron) {
      const anclaTxt = anclaDePatron(c.patron);
      if (anclaTxt) {
        base.estrategia = 'ancla_relativa';
        base.ancla = { texto: anclaTxt };
        base.zona = { x: 0.1, y: 0.0, w: 0.2, h: 0.024 };
        base.nota = `${c.nota ? c.nota + ' · ' : ''}Importado del regex v2: la zona se ubica a la derecha del ancla — ajustar en editor.`;
      }
      return base;
    }

    // recuento_si_no (B3 diferencial): aproximación editable
    if (c.estrategia === 'recuento_si_no') {
      base.estrategia = 'ancla_relativa';
      base.ancla = { texto: 'RECUENTO' };
      base.zona =
        c.lado === 'SI'
          ? { x: 0.52, y: 0.014, w: 0.05, h: 0.018 }
          : { x: 0.66, y: 0.014, w: 0.05, h: 0.018 };
      base.nota = `${c.nota ? c.nota + ' · ' : ''}Importado del mecanismo diferencial B3 (ventana SI/NO) — ajustar offsets en editor.`;
      return base;
    }

    // ancla_zona con cadena de anclas
    if (c.estrategia === 'ancla_zona' && c.anclas && c.anclas.length > 0) {
      const principal = c.anclas[0];
      const anclaTxt = anclaDePatron(principal.patron);
      if (anclaTxt) {
        base.estrategia = 'ancla_relativa';
        base.ancla = { texto: anclaTxt };
        if (c.anclas.length > 1) base.ancla_respaldo = anclaDePatron(c.anclas[1].patron);
        if (c.zona) {
          const rel = zonaARelativa(c.zona, c.jurado_num);
          if (rel) {
            base.zona = { x: rel.dx, y: rel.dy, w: rel.w, h: rel.h };
            base.x_absoluto = rel.xAbs;
          } else if (c.zona_fija) {
            base.estrategia = 'zona_fija';
            base.zona = zonaFijaARect(c.zona_fija);
          }
        } else if (c.zona_fija) {
          base.estrategia = 'zona_fija';
          base.zona = zonaFijaARect(c.zona_fija);
        }
        if (c.jurado_num) {
          base.nota = `${c.nota ? c.nota + ' · ' : ''}Jurado ${c.jurado_num}: columna por paridad (importado de la rejilla 2x2).`;
        }
      }
    }

    return base;
  });

  return {
    tipo: 'universal',
    version: MOLDE_UNIVERSAL_VERSION,
    nombre: `E-14 (importado ${m.version})`,
    descripcion: `Importado de e14.schema v${m.version}. Zonas fila/banda conservan x absoluto; ejecuta "Alinear anclas (OCR)" para capturar las posiciones de referencia y refina en el editor.`,
    documento: 'acta_e14',
    idioma: 'spa',
    campos,
  };
}

/** Detecta si un JSON es un molde E-14 v1/v2 (por su campo tipo/campos). */
export function pareceMoldeE14(obj: unknown): obj is MoldeE14 {
  if (typeof obj !== 'object' || obj === null) return false;
  const m = obj as Record<string, unknown>;
  return typeof m.motor === 'object' && Array.isArray(m.campos) && m.tipo === 'acta_e14';
}
