// FASE 0 — SPIKE: S vs plus-L con estructura (PLAN-AGENTE-LAYOUT §5, F0).
//
// Corre SIN modelo y SIN red: usa las detecciones GRABADAS de las corridas
// reales del celular (results-banco.jsonl → fixtures/) y el GT de Chandra.
// El cronómetro mide SOLO el post-proceso estructural en bun/desktop (el
// celular real NO estuvo disponible para esta entrega — se declara en el
// reporte; los tiempos de inferencia del dossier se citan como referencia).
//
//   bun run spike-s            (o bun run scripts/spike-s.ts)
//
// Salida: scripts/spike-s-result.json + tablas en stdout. El reporte
// Markdown vive en docs/investigacion/2026-11-22-spike-s-estructura.md.

import { conModelo, evaluarEstructura, metricas, type CajaLayout, type ReglaLayout } from '../src';
import { normalizarClase } from '../src/clases';

import gtJson from '../fixtures/e14-p1-gt.json';
import reglasPlusL from '../fixtures/e14-p1-reglas.json';
import reglasSpike from '../fixtures/e14-p1-reglas-s-spike.json';
import plusLJson from '../fixtures/plusL-e14-p1.json';
import sJson from '../fixtures/s-e14-p1.json';

interface FixtureDets {
  modelo: string;
  run: string;
  threshold: number;
  W: number;
  H: number;
  dets: { cls: string; score: number; x1: number; y1: number; x2: number; y2: number }[];
}

const W = 676;
const H = 2048;

const gt = (
  gtJson as { bloques: { type: string; x1: number; y1: number; x2: number; y2: number; text?: string }[] }
).bloques.map((b) => ({ ...b, score: 1 }));

/** Las cajas del motor llegan clamped a bordes (contrato F2: escalado a la
 *  página + clamp). El fixture de S trae y1 = -5 px del contenedor de página.
 *  Se aplica aquí para simular EXACTAMENTE lo que el evaluador recibirá. */
const cajas = (f: FixtureDets): CajaLayout[] =>
  f.dets.map((d) => ({
    clase: normalizarClase(d.cls),
    score: d.score,
    x1: Math.max(0, Math.min(d.x1, W)),
    y1: Math.max(0, Math.min(d.y1, H)),
    x2: Math.max(0, Math.min(d.x2, W)),
    y2: Math.max(0, Math.min(d.y2, H)),
  }));

interface Corrida {
  nombre: string;
  modelo: 's' | 'plusL';
  reglas: ReglaLayout[];
  dets: CajaLayout[];
}

const corridas: Corrida[] = [
  { nombre: 'plus-L + estructura E-14 (control, pool 0.2)', modelo: 'plusL', reglas: reglasPlusL.reglas as ReglaLayout[], dets: cajas(plusLJson as unknown as FixtureDets) },
  { nombre: 'S + estructura E-14 baseline (reglas plus-L)', modelo: 's', reglas: reglasPlusL.reglas as ReglaLayout[], dets: cajas(sJson as unknown as FixtureDets) },
  { nombre: 'S + estructura SPIKE (títulos partidos, text como tabla)', modelo: 's', reglas: reglasSpike.reglas as ReglaLayout[], dets: cajas(sJson as unknown as FixtureDets) },
];

const N_REPETICIONES = 200; // estabiliza el cronómetro del post-proceso

const filas = corridas.map((c) => {
  // Primera corrida funcional para el veredicto.
  const res = conModelo(evaluarEstructura(c.dets, c.reglas, W, H), c.modelo);
  const aceptadas = res.reglas.flatMap((r) => r.cajas);
  const m = metricas(aceptadas, gt);
  // Cronómetro: mediana de N repeticiones del post-proceso (sin inferencia).
  const tiempos: number[] = [];
  for (let i = 0; i < N_REPETICIONES; i++) {
    const r2 = evaluarEstructura(c.dets, c.reglas, W, H);
    tiempos.push(r2.ms);
  }
  tiempos.sort((a, b) => a - b);
  const mediana = tiempos[Math.floor(N_REPETICIONES / 2)];
  const obligatoriasMal = res.reglas
    .filter((r) => r.estado !== 'ok')
    .map((r) => {
      const regla = c.reglas.find((x) => x.id === r.reglaId);
      return regla?.obligatorio ? `${r.reglaId}(${r.estado})` : null;
    })
    .filter((x): x is string => x !== null);
  return {
    nombre: c.nombre,
    modelo: c.modelo,
    tp: m.tp,
    fp: m.preds - m.tp,
    preds: m.preds,
    P: m.P,
    R: m.R,
    F1: m.F1,
    msMedianaPost: Math.round(mediana * 1000) / 1000,
    gateOk: res.ok,
    requiereRevision: res.requiere_revision,
    obligatoriasMal,
    estados: res.reglas.map((r) => ({ id: r.reglaId, estado: r.estado, cajas: r.cajas.length })),
  };
});

console.log('=== F0 SPIKE — S vs plus-L con estructura (E-14 p1, GT Chandra 19 bloques) ===\n');
console.log(
  'corrida'.padEnd(58),
  'TP'.padStart(3), 'FP'.padStart(3), 'P'.padStart(7), 'R'.padStart(7), 'F1'.padStart(7), 'msPost'.padStart(8),
  ' gate',
);
for (const f of filas) {
  console.log(
    f.nombre.slice(0, 57).padEnd(58),
    String(f.tp).padStart(3),
    String(f.fp).padStart(3),
    String(f.P).padStart(7),
    String(f.R).padStart(7),
    String(f.F1).padStart(7),
    String(f.msMedianaPost).padStart(8),
    f.gateOk ? ' ok' : ' RECHAZA',
    f.obligatoriasMal.length ? ` [${f.obligatoriasMal.join(', ')}]` : '',
  );
}

console.log('\nCriterio acordado: S >= 16/19 con <= 1 FP -> S default del gate.');
const sSpike = filas[2];
console.log(
  `S + estructura SPIKE: ${sSpike.tp}/19 con ${sSpike.fp} FP ->`,
  sSpike.tp >= 16 && sSpike.fp <= 1 ? 'CUMPLE el criterio' : 'NO cumple (S queda como pre-gate)',
);
console.log(
  '\nNota V3: el truco del contenedor de página (image 0.51 y -5..1744 partido en ' +
    'las 2 tablas de candidatos) NO es aplicable con contención completa de zona: ' +
    'el contenedor nunca cae COMPLETO dentro de la zona de candidatos, y con zonas ' +
    'recortadas al contenedor produciría 2 FP (partes sobrantes). Documentado como ' +
    'rechazado: candidatos queda faltante para S.',
);

const salida = {
  fecha: new Date().toISOString().slice(0, 10),
  fuente: 'fixtures grabados del banco de pruebas (phone-mwrf3lq0 plus-L pool 0.2; phone-mwrgw19y S thr 0.2 NMS 0.5)',
  pagina: { W, H },
  gt: gt.length,
  cronometro: `post-proceso estructural, mediana de ${N_REPETICIONES} corridas en bun/desktop (sin inferencia; sin celular real en esta entrega)`,
  corridas: filas,
};
const ruta = `${import.meta.dir}/spike-s-result.json`;
await Bun.write(ruta, JSON.stringify(salida, null, 2));
console.log(`\nResultado: ${ruta}`);
