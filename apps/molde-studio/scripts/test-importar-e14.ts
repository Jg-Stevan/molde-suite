// Smoke test del importador E-14 → universal v3 (Fase 5.1).
// Criterio del plan: un campo v2 `tipo texto + patron + ancla_zona` migra con
// zona y ancla (la geometría prevalece sobre el regex); el campo regex puro
// (sin anclas) sigue usando la vía ancla-derecha.
//
// Ejecutar: bun scripts/test-importar-e14.ts

import { importarMoldeE14, pareceMoldeE14 } from '../src/lib/molde/importar-e14';
import type { Molde as MoldeE14 } from '../src/lib/molde/types';

let fallos = 0;
function check(nombre: string, cond: boolean, detalle?: string) {
  if (cond) {
    console.log(`  ✓ ${nombre}`);
  } else {
    fallos++;
    console.error(`  ✗ ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  }
}

const moldeV2 = {
  tipo: 'acta_e14',
  version: '2.0.0',
  descripcion: 'molde v2 de prueba',
  motor: {},
  clasificacion: { anclas: ['E-14'], min_anclas: 1, regex: 'E.?14' },
  paginas: { requeridas: 2, marcador: 'E-14', marcador_obligatorio: true, inferencia: { pagina_1: [], pagina_2: [] } },
  identificacion: {
    patron: '7\\d{14}',
    fallback: '\\d{15}',
    raiz: { inicio: 0, fin: 15 },
    digito_pagina: 15,
    consenso: { tolerancia_edicion: 1 },
  },
  campos: [
    {
      // CASO 1 (Fase 5.1): texto + patron + ancla_zona con zona fila.
      // Antes: la vía regex ganaba y el campo perdía su geometría.
      nombre: 'zona_code',
      etiqueta: 'Zona (texto con ancla y geometría)',
      pagina: 1,
      tipo: 'texto',
      estrategia: 'ancla_zona',
      patron: 'ZONA\\s*:?\\s*(\\d{2})',
      anclas: [{ patron: 'ZONA' }],
      zona: { tipo: 'fila', columna_x0: 0.4, columna_x1: 0.5, y0_rel: 0.01, y1_rel: 0.03 },
      obligatorio: true,
    },
    {
      // CASO 2: regex puro (sin anclas) → vía ancla a la derecha (sin cambio).
      nombre: 'lugar',
      etiqueta: 'Lugar de votación (regex puro)',
      pagina: 1,
      tipo: 'texto',
      estrategia: 'regex',
      patron: 'LUGAR\\s*:?\\s*(\\w+)',
      obligatorio: false,
    },
    {
      // CASO 3: firma con casilla_firma y jurado par → columna derecha.
      nombre: 'firma_j2',
      etiqueta: 'Firma jurado 2',
      pagina: 2,
      tipo: 'firma',
      estrategia: 'ancla_zona',
      patron: 'FIRMA',
      anclas: [{ patron: 'FIRMA JURADO 2' }],
      jurado_num: 2,
      zona: {
        tipo: 'casilla_firma',
        col_izq: [0.1, 0.2],
        col_der: [0.3, 0.4],
        desde: 'etiqueta_y0',
        dy0: 0.01,
        dy1: 0.05,
      },
      obligatorio: false,
    },
    {
      // CASO 4: recuento_si_no — aproximación editable (sin cambio).
      nombre: 'recuento',
      etiqueta: 'Hubo recuento (SÍ)',
      pagina: 2,
      tipo: 'presencia',
      estrategia: 'recuento_si_no',
      lado: 'SI',
      obligatorio: false,
    },
  ],
  validaciones: [],
} as unknown as MoldeE14;

console.log('Smoke del importador E-14 → v3 (Fase 5.1)');

check('pareceMoldeE14 detecta el molde v2', pareceMoldeE14(moldeV2));

const universal = importarMoldeE14(moldeV2);
check('el molde convertido es universal v3', universal.tipo === 'universal' && Array.isArray(universal.campos));
check('4 campos migrados', universal.campos.length === 4, `llegaron ${universal.campos.length}`);

const zona = universal.campos.find((c) => c.etiqueta.includes('Zona'));
check(
  'CASO 1: campo texto+patron+ancla_zona conserva la zona (geometría)',
  Boolean(zona && Math.abs(zona.zona.x - 0.4) < 1e-9 && Math.abs(zona.zona.w - 0.1) < 1e-9 && Math.abs(zona.zona.h - 0.02) < 1e-9),
  zona ? JSON.stringify(zona.zona) : 'no encontrado',
);
check('CASO 1: x_absoluto de la fila v2', zona?.x_absoluto === true);
check('CASO 1: ancla desde la cadena v2', zona?.ancla?.texto === 'ZONA');
check('CASO 1: NO usa la zona por defecto del regex (0.2×0.024)', !(zona && Math.abs(zona.zona.w - 0.2) < 1e-9 && Math.abs(zona.zona.h - 0.024) < 1e-9));

const lugar = universal.campos.find((c) => c.etiqueta.includes('Lugar'));
check('CASO 2: regex puro → ancla a la derecha (zona 0.2×0.024)', lugar?.estrategia === 'ancla_relativa' && lugar.zona.w === 0.2 && lugar.zona.h === 0.024);
check('CASO 2: ancla extraída del patrón', lugar?.ancla?.texto === 'LUGAR');

const firma = universal.campos.find((c) => c.tipo === 'firma');
check('CASO 3: firma jurado par → columna derecha (x=0.3)', Math.abs((firma?.zona.x ?? -1) - 0.3) < 1e-9, JSON.stringify(firma?.zona));
check('CASO 3: x_absoluto de la casilla_firma', firma?.x_absoluto === true);

const recuento = universal.campos.find((c) => c.etiqueta.includes('recuento'));
check('CASO 4: recuento SI → ventana 0.52', recuento?.zona.x === 0.52 && recuento.ancla?.texto === 'RECUENTO');

if (fallos > 0) {
  console.error(`\n✗ ${fallos} comprobaciones fallaron`);
  process.exit(1);
}
console.log('\n✓ Importador OK: la geometría de ancla_zona prevalece sobre el regex');
