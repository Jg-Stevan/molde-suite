// Ground truth de las 3 actas de prueba (mismo GT que el motor de referencia).
// La clave es la RAIZ de 12 digitos del documento; permite auto-validar la demo
// con los PDFs reales subidos (El Cairo, Nairobi, Frankfurt).

import type { ComparacionGt, ResultadoActa } from './types';

export interface GtActa {
  acta: string;
  regex: Record<string, string>;
  pres: Record<string, boolean>;
  ids: [string, string];
}

export const GT_POR_RAIZ: Record<string, GtActa> = {
  '710003993010': {
    acta: 'El Cairo',
    regex: {
      consulado_codigo: '88',
      pais_codigo: '335',
      pais_nombre: 'EGIPTO',
      zona_codigo: '05',
      puesto_codigo: '02',
      mesa_codigo: '001',
      lugar: 'El Cairo - Consulado',
    },
    pres: {
      total_votantes_e11: true,
      total_votos_urna: true,
      total_votos_incinerados: false,
      votos_candidato_1: true,
      votos_candidato_2: true,
      votos_en_blanco: true,
      votos_nulos: false,
      votos_no_marcados: false,
      suma_total: true,
      constancias_presente: false,
      recuento_si: false,
      recuento_no: true,
      firma_jurado_1: true,
      firma_jurado_2: true,
      firma_jurado_3: true,
      firma_jurado_4: false,
      cc_jurado_1: true,
      cc_jurado_2: true,
      cc_jurado_3: true,
      cc_jurado_4: false,
    },
    ids: ['710003993010102', '710003993010202'],
  },
  '712005322010': {
    acta: 'Nairobi',
    regex: {
      consulado_codigo: '88',
      pais_codigo: '515',
      pais_nombre: 'KENIA',
      zona_codigo: '05',
      puesto_codigo: '83',
      mesa_codigo: '001',
      lugar: 'MIERCOLES NAIROBI - CONSULADO',
    },
    pres: {
      total_votantes_e11: true,
      total_votos_urna: true,
      total_votos_incinerados: false,
      votos_candidato_1: true,
      votos_candidato_2: true,
      votos_en_blanco: true,
      votos_nulos: false,
      votos_no_marcados: false,
      suma_total: true,
      constancias_presente: false,
      recuento_si: false,
      recuento_no: true,
      firma_jurado_1: true,
      firma_jurado_2: true,
      firma_jurado_3: true,
      firma_jurado_4: false,
      cc_jurado_1: true,
      cc_jurado_2: true,
      cc_jurado_3: true,
      cc_jurado_4: false,
    },
    ids: ['712005322010102', '712005322010202'],
  },
  '710007453010': {
    acta: 'Frankfurt',
    regex: {
      consulado_codigo: '88',
      pais_codigo: '120',
      pais_nombre: 'ALEMANIA',
      zona_codigo: '15',
      puesto_codigo: '02',
      mesa_codigo: '012',
      lugar: 'Frankfurt Consulado',
    },
    pres: {
      total_votantes_e11: true,
      total_votos_urna: true,
      total_votos_incinerados: false,
      votos_candidato_1: true,
      votos_candidato_2: true,
      votos_en_blanco: false,
      votos_nulos: false,
      votos_no_marcados: false,
      suma_total: true,
      constancias_presente: false,
      recuento_si: false,
      recuento_no: true,
      firma_jurado_1: true,
      firma_jurado_2: true,
      firma_jurado_3: true,
      firma_jurado_4: true,
      cc_jurado_1: true,
      cc_jurado_2: true,
      cc_jurado_3: true,
      cc_jurado_4: true,
    },
    ids: ['710007453010102', '710007453010202'],
  },
};

export function gtPorRaiz(raiz: string | null): GtActa | null {
  if (!raiz) return null;
  return GT_POR_RAIZ[raiz] ?? null;
}

/** Compara el resultado del motor con el GT (misma logica que el motor Python). */
export function compararConGt(res: ResultadoActa, gt: GtActa): ComparacionGt {
  const errores: { campo: string; tag: string }[] = [];
  let total = 0;
  for (const [f, esperado] of Object.entries(gt.regex)) {
    total++;
    const r = res.campos[f];
    const valor = String(r?.valor ?? '').trim().toUpperCase();
    if (valor !== String(esperado).trim().toUpperCase()) {
      errores.push({ campo: f, tag: 'REGEX' });
    }
  }
  for (const [f, esperado] of Object.entries(gt.pres)) {
    total++;
    const r = res.campos[f];
    const val = r?.valor;
    const ok = r?.estado === 'ok' && val === esperado;
    if (!ok) {
      const tag = val === true && esperado === false ? 'FP' : val === false && esperado === true ? 'FN' : '??';
      errores.push({ campo: f, tag });
    }
  }
  total++; // ID (raiz)
  if (res.raiz !== gt.ids[0].slice(0, 12)) {
    errores.push({ campo: 'documento_id', tag: 'RAIZ' });
  }
  return {
    acta: gt.acta,
    coincidencia: total - errores.length,
    total,
    errores,
  };
}
