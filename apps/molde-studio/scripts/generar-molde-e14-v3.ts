// Genera el molde de ejemplo v3 REGENERADO (Fase 2 del plan):
//   scripts/acta_e_14_exterior_consul_embajado.molde.json
//
// Transformaciones aplicadas sobre la calibración original
// (scripts/molde-e14-nuevo.json, hecha sobre la plantilla Nairobi 515):
//
// 1. Votaciones y suma (Fase 2.1/2.2): los campos de números manuscritos
//    pasan a tipo `texto` con `htr: true` + whitelist de dígitos + realce.
//    Así el cierre aritmético "suma_total == componentes" es REAL (la
//    defensa principal contra lecturas inventadas). El criterio de la
//    auditoría "PRESENTE 6/6" se mantiene en los campos de tinta puros
//    (totales de nivelación) con umbrales recalibrados a 0.006 — los
//    trazos finos midieron 0.76–1.11% contra el umbral viejo de 1.2%.
// 2. Patrones ANCLADOS (G-8/Fase 2.4): ^…$ explícitos + limpiar_valor para
//    valores con etiqueta pegada ("ZONA: 05").
// 3. Firmas sin etiqueta impresa (G-11): la zona baja por debajo de la
//    línea "FIRMA JURADO N:" (y +0.008) y el umbral baja a 0.018 — una
//    celda vacía medía 1.8% solo por la etiqueta contra un umbral de 2%.
// 4. `validaciones` de cierre (Fase 2.2) con parser seguro.
// 5. `paginasRef: []` explícito y SIN meta.precision (G-1): el score de la
//    tarjeta es siempre el de la última corrida real.
//
// Ejecutar: bun scripts/generar-molde-e14-v3.ts

import { writeFileSync } from 'node:fs';
import { esMoldeUniversal } from '../src/lib/molde/universal-types';
import type { CampoUniversal, MoldeUniversal, ValidacionMolde } from '../src/lib/molde/universal-types';

const fuente = (await import('./molde-e14-nuevo.json')).default as MoldeUniversal;

/** Campos de números manuscritos → lectura HTR honesta. */
const LECTURA_HTR = new Set([
  'suma_total',
  'votos_candidato_1',
  'votos_candidato_2',
  'votos_en_blanco',
  'votos_nulos',
  'votos_no_marcados',
]);
/** Patrones anclados por campo (G-8) + limpiar_valor cuando la etiqueta se pega. */
const PATRONES: Record<string, { patron: string; limpiar_valor?: string }> = {
  divipol_consulado: { patron: '^\\d{2}$', limpiar_valor: '(\\d{2})' },
  divipol_pais: { patron: '^\\d{3}$', limpiar_valor: '(\\d{3})' },
  divipol_zona: { patron: '^\\d{2}$', limpiar_valor: '(\\d{2})' },
  divipol_puesto: { patron: '^\\d{2}$', limpiar_valor: '(\\d{2})' },
  divipol_mesa: { patron: '^\\d{2}-\\d{2}$', limpiar_valor: '(\\d{2}-\\d{2})' },
  suma_total: { patron: '^[0-9]{1,3}( [0-9]{1,3}){0,2}$', limpiar_valor: '([0-9]{1,3}(?: [0-9]{1,3}){0,2})' },
  votos_candidato_1: { patron: '^[0-9]{1,3}( [0-9]{1,3}){0,2}$', limpiar_valor: '([0-9]{1,3}(?: [0-9]{1,3}){0,2})' },
  votos_candidato_2: { patron: '^[0-9]{1,3}( [0-9]{1,3}){0,2}$', limpiar_valor: '([0-9]{1,3}(?: [0-9]{1,3}){0,2})' },
  votos_en_blanco: { patron: '^[0-9]{1,3}( [0-9]{1,3}){0,2}$', limpiar_valor: '([0-9]{1,3}(?: [0-9]{1,3}){0,2})' },
  votos_nulos: { patron: '^[0-9]{1,3}( [0-9]{1,3}){0,2}$', limpiar_valor: '([0-9]{1,3}(?: [0-9]{1,3}){0,2})' },
  votos_no_marcados: { patron: '^[0-9]{1,3}( [0-9]{1,3}){0,2}$', limpiar_valor: '([0-9]{1,3}(?: [0-9]{1,3}){0,2})' },
};
/** Umbrales de tinta recalibrados (Fase 2.1: banda fina de votaciones). */
const UMBRALES: Record<string, number> = {
  total_votantes_e11: 0.006,
  total_votos_urna: 0.006,
  total_votos_incinerados: 0.006,
  // lecturas HTR: el umbral solo alimenta la heurística zona_vacia
  suma_total: 0.006,
  votos_candidato_1: 0.006,
  votos_candidato_2: 0.006,
  votos_en_blanco: 0.006,
  votos_nulos: 0.006,
  votos_no_marcados: 0.006,
};

const campos: CampoUniversal[] = fuente.campos.map((c) => {
  const out: CampoUniversal = { ...c, zona: { ...c.zona } };
  // 1. Lectura HTR de los números manuscritos.
  if (LECTURA_HTR.has(c.id)) {
    out.tipo = 'texto';
    out.htr = true;
    out.whitelist = '0123456789';
    out.realce = true;
    out.destacado = c.id === 'suma_total';
    out.nota = `${c.nota ? c.nota + ' · ' : ''}Lectura HTR (opción C de la Fase 2.5): el valor se muestra pero, al ser manuscrito, un humano debe confirmarlo.`;
  }
  // 2. Patrones anclados + limpieza de etiqueta pegada.
  const patron = PATRONES[c.id];
  if (patron) {
    out.patron = patron.patron;
    if (patron.limpiar_valor) out.limpiar_valor = patron.limpiar_valor;
  }
  // 3. Firmas sin etiqueta impresa (G-11).
  if (c.tipo === 'firma') {
    out.zona = { ...out.zona, y: c.zona.y + 0.008, h: Math.max(0.03, c.zona.h - 0.008) };
    out.umbral = 0.018;
    out.nota = `${c.nota ? c.nota + ' · ' : ''}Zona recalibrada: excluye la etiqueta impresa "FIRMA JURADO N:" (G-11).`;
  }
  // Umbrales recalibrados.
  if (UMBRALES[c.id] !== undefined) out.umbral = UMBRALES[c.id];
  return out;
});

const validaciones: ValidacionMolde[] = [
  {
    id: 'cierre_suma',
    regla: 'igualdad',
    expresion:
      'suma_total == votos_candidato_1 + votos_candidato_2 + votos_en_blanco + votos_nulos + votos_no_marcados',
    tolerancia: 0,
    descripcion:
      'La SUMA TOTAL debe cuadrar con la suma de votos de candidatos, blanco, nulos y no marcados. Una lectura de cierre que no cuadra queda en revisión (nunca "ok").',
  },
];

const molde: MoldeUniversal = {
  ...fuente,
  nombre: 'Acta E-14 Exterior (Cónsul/Embajador · Transmisión)',
  descripcion:
    'Molde del Acta E-14 de escrutinio exterior regenerado tras la auditoría (Fase 2 del plan): votaciones y suma como lectura HTR honesta (requieren confirmación humana), cierre aritmético de la suma total, patrones anclados con limpieza de etiqueta, firmas sin la etiqueta impresa y umbrales de tinta recalibrados a 0.006 (trazos finos medidos 0.76–1.11%).',
  paginasRef: [], // los escaneos de referencia no se publican (subir desde el editor)
  campos,
  validaciones,
  meta: {
    // G-1: SIN precision — el score de la tarjeta es SIEMPRE el de la última
    // corrida real. Solo queda metadatos de presentación.
    docs: fuente.meta?.docs,
    unidadDocs: fuente.meta?.unidadDocs,
    estado: 'validando',
    validacion: 'Nairobi (plantilla) + Barcelona (transmisión) + El Cairo (foto con flash)',
    etiquetas: fuente.meta?.etiquetas,
    etiquetaCampos: fuente.meta?.etiquetaCampos,
    orden: fuente.meta?.orden,
  },
};

if (!esMoldeUniversal(molde)) {
  console.error('✗ El molde regenerado NO pasa la validación esMoldeUniversal');
  process.exit(1);
}
if (molde.meta && 'precision' in (molde.meta as Record<string, unknown>)) {
  console.error('✗ meta.precision sigue presente (G-1)');
  process.exit(1);
}

writeFileSync(
  new URL('./acta_e_14_exterior_consul_embajado.molde.json', import.meta.url),
  JSON.stringify(molde, null, 2) + '\n',
  'utf8',
);
console.log(
  `✓ Molde regenerado: ${molde.campos.length} campos · ${validaciones.length} validación(es) · ` +
    `${campos.filter((c) => c.htr).length} campos HTR · firmas recalibradas: ${campos.filter((c) => c.tipo === 'firma').length}`,
);
