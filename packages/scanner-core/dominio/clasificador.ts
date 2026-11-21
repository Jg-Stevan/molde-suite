// Clasificador de cabecera del documento (contrato D8 opción B).
// Lee el OCR crudo de la página y extrae la clasificación Divipol parcial:
// departamento/municipio/zona/puesto/mesa + tipo de página. La confirmación
// final la hace el humano en PanelClasificacion (nivel MANUAL/SUGERIDA).

import type { TipoPagina } from './types';

export interface DivipolRef {
  codigo: string;
  nombre: string;
}

/** Clasificación completa del documento tras el OCR + edición humana.
 *  Los campos Divipol aceptan null (el panel los pone en null al limpiar). */
export interface ClasificacionE14 {
  nivel: 'AUTO' | 'SUGERIDA' | 'MANUAL';
  tipo: 'TRANSMISION' | 'DELEGADOS' | null;
  mesa: number | null;
  pagina: { index: number; total: number } | null;
  departamento?: DivipolRef | null;
  municipio?: DivipolRef | null;
  zona?: { codigo: string; nombre?: string } | null;
  puesto?: DivipolRef | null;
  kit?: string | number | null;
  kitFuente?: string | null;
  parciales?: {
    cabecera?: boolean;
    mesa?: number;
    tipo?: 'TRANSMISION' | 'DELEGADOS';
  };
  confianzas?: {
    departamento?: number;
    municipio?: number;
    puesto?: number;
    tipo?: number;
  };
  codigoUnico?: { crudo: string };
  avisos?: string[];
}

/** Patrón de la cabecera E-14 (traza/log — el gate NO decide solo con esto). */
export const PATRON_CABECERA = /E[\s.-]?14|ELECTORA[LN]|ESCUTINIO/i;

/** Detecta el tipo de página por su banda de título en el OCR crudo. */
export function tipoDeBanda(textoOcr: string): 'TRANSMISION' | 'DELEGADOS' | null {
  if (/TRANSMISI[ÓO]N/i.test(textoOcr)) return 'TRANSMISION';
  if (/DELEGADOS/i.test(textoOcr)) return 'DELEGADOS';
  return null;
}

/** Normaliza el tipo de página (acepta variantes con/sin tilde). */
export function tipoPaginaDe(tipo: string): TipoPagina | null {
  if (/TRANSMISI[ÓO]N/i.test(tipo)) return 'TRANSMISIÓN';
  if (/DELEGADOS/i.test(tipo)) return 'DELEGADOS';
  return null;
}

const pad = (n: number | string, w = 2) => String(n).padStart(w, '0');

/** Clave de puesto "dep-mun-zon-std" (o "" si falta lo esencial). */
export function claveDePuesto(c: ClasificacionE14): string {
  const dep = c.departamento?.codigo;
  const mun = c.municipio?.codigo;
  const zon = c.zona?.codigo;
  const std = c.puesto?.codigo;
  if (!dep || !mun || !zon || !std) return '';
  return `${pad(dep)}-${pad(mun)}-${pad(zon)}-${pad(std)}`;
}

/** Clave de mesa "dep-mun-zon-std-mesa" (o "" si falta lo esencial). */
export function claveDeMesa(c: ClasificacionE14): string {
  const base = claveDePuesto(c);
  if (!base || c.mesa === null || c.mesa === undefined) return '';
  return `${base}-${pad(c.mesa, 3)}`;
}

/** Título legible + ubicación desde la clasificación. */
export function tituloYUbicacionDe(c: ClasificacionE14 | null): {
  titulo: string;
  ubicacion: { departamento: string; municipio: string; zona: string; puesto: string; mesa: string };
} | null {
  if (!c) return null;
  const puesto = c.puesto?.nombre ?? '—';
  const mesa = c.mesa !== null && c.mesa !== undefined ? String(c.mesa).padStart(3, '0') : '—';
  const tipo = c.tipo === 'TRANSMISION' ? 'PRINCIPAL' : c.tipo === 'DELEGADOS' ? 'ANEXO' : 'DOC';
  const pag = c.pagina ? ` P${c.pagina.index}` : '';
  const titulo = `${puesto} · DOC ${mesa} — ${tipo}${pag}`.trim();
  return {
    titulo,
    ubicacion: {
      departamento: c.departamento?.nombre ?? '—',
      municipio: c.municipio?.nombre ?? '—',
      zona: c.zona?.codigo ?? '—',
      puesto,
      mesa,
    },
  };
}

/**
 * Clasificación parcial desde el OCR crudo de la página: busca la cabecera,
 * los códigos Divipol impresos y el número de mesa. Todo lo no encontrado
 * queda ausente (jamás se inventa) — el humano lo completa.
 */
export function clasificarDesdeOcr(texto: string): ClasificacionE14 | null {
  const plano = texto.toUpperCase().replace(/\s+/g, ' ');
  const cabecera = PATRON_CABECERA.test(plano);
  const tipo = tipoDeBanda(plano);
  // Divipol impreso: "CONSULADO: 88", "PAÍS: 335", "ZONA: 05", "PUESTO: 02", "MESA: 001"
  const num = (etiqueta: string): string | null => {
    const m = new RegExp(`${etiqueta}\\s*:?\\s*(\\d{1,4})`).exec(plano);
    return m ? m[1] : null;
  };
  const mesaTxt = num('MESA');
  const mesa = mesaTxt ? Number(mesaTxt) : null;
  if (!cabecera && !tipo && mesa === null) return null;
  const clasif: ClasificacionE14 = {
    nivel: 'AUTO',
    tipo,
    mesa: mesa !== null && Number.isFinite(mesa) ? mesa : null,
    pagina: null,
    parciales: {
      cabecera,
      mesa: mesa ?? undefined,
      tipo: tipo ?? undefined,
    },
  };
  const dep = num('CONSULADO');
  const mun = num('PAIS') ?? num('PAÍS');
  const zon = num('ZONA');
  const std = num('PUESTO');
  if (dep) clasif.departamento = { codigo: dep, nombre: '—' };
  if (mun) clasif.municipio = { codigo: mun, nombre: '—' };
  if (zon) clasif.zona = { codigo: zon };
  if (std) clasif.puesto = { codigo: std, nombre: '—' };
  return clasif;
}
