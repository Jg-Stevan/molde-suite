/// <reference types="bun-types" />
// Batería de pruebas de la Fase 8 del PLAN (umbral adaptativo por clustering,
// variante 4.2 — solución de fondo del matiz residual de F4-1).
// Ejecutar desde apps/molde-studio:  bun test tests/fase8-clustering.test.ts
//
// Cubre:
//   Matiz residual (CORRECCIONES-POST-VERIFICACION §2.2) — vacía limpia
//     pegada al corte + vacía con flash encima del corte, resuelto con
//     corridas acumuladas: el corte sale de los DATOS (clustering), no del
//     corte fijo 0.002.
//   Regresión F4/F4-1 — con < 3 corridas el comportamiento es EXACTAMENTE el
//     anterior (primera corrida que sugiere gana; mismas guardas).
//   Guardas de honestidad sobre las clases (techo de ruido, separación 0.5×).
//   Determinismo (misma entrada → misma salida).

import { describe, expect, test } from 'bun:test';

import {
  MIN_CORRIDAS_CLUSTERING,
  TECHO_RUIDO,
  sugerirUmbral,
  sugerirUmbralClustering,
} from '@/lib/molde/universal-engine';
import type { ResultadoUniversal } from '@/lib/molde/universal-types';

/** ResultadoUniversal mínimo: cada ratio es una "medición de página" del campo. */
function corrida(campoId: string, ratios: number[]): ResultadoUniversal {
  return {
    score: 0,
    ok_count: 0,
    total: 0,
    requiere_revision: false,
    paginas: ratios.map((r) => ({
      pagina: 1,
      campos: [
        {
          id: campoId,
          estado: r > 0.002 ? 'ok' : 'no_encontrado',
          banderas: [],
          ratio: r,
        },
      ],
    })),
  } as unknown as ResultadoUniversal;
}

describe('Fase 8 — constantes exportadas para que las pruebas usen el MISMO criterio del motor', () => {
  test('TECHO_RUIDO queda entre el flash de la auditoría (0.0139) y el trazo más fino (0.045)', () => {
    expect(TECHO_RUIDO).toBe(0.02);
    expect(TECHO_RUIDO).toBeGreaterThan(0.0139);
    expect(TECHO_RUIDO).toBeLessThan(0.045);
  });
  test('MIN_CORRIDAS_CLUSTERING = 3 (PLAN Fase 8: ≥3-5 corridas)', () => {
    expect(MIN_CORRIDAS_CLUSTERING).toBe(3);
  });
});

describe('Fase 8 — matiz residual RESUELTO (clustering sobre varias corridas)', () => {
  test('el caso residual exacto [0.002, 0.0139, 0.079] + 2 corridas más → corte por ENCIMA del flash', () => {
    // La corrida 1 es el caso residual del informe: vacía limpia pegada al
    // corte (0.002) JUNTO a una vacía con flash encima del corte (0.0139).
    // Con una sola corrida pasa la guarda relativa y el minConTinta es el
    // FLASH (no un trazo). Con el ruido real medido en otras 2 corridas, el
    // clustering separa las clases por los datos y el corte queda entre
    // las distribuciones — el flash queda POR DEBAJO del umbral sugerido.
    const corridas = [
      corrida('firma_x', [0.002, 0.0139, 0.079]),
      corrida('firma_x', [0.0018, 0.0031, 0.098]),
      corrida('firma_x', [0.0011, 0.0025, 0.11]),
    ];
    const s = sugerirUmbralClustering(corridas, 'firma_x');
    expect(s.metodo).toBe('clustering');
    expect(s.corridasConMediciones).toBe(3);
    expect(s.sugerido).not.toBeNull();
    expect(s.motivo).toBeUndefined();
    expect(s.minConTinta).toBeCloseTo(0.079, 6);
    expect(s.maxSinTinta).toBeCloseTo(0.0139, 6);
    expect(s.sugerido).toBeCloseTo(0.079 * 0.7, 6);
    // LA VERIFICACIÓN CLAVE: el flash 0.0139 queda por debajo del corte —
    // en corridas futuras la vacía con flash NO se marcaría como firmada.
    expect(s.sugerido!).toBeGreaterThan(0.0139);
  });

  test('el caso exacto de la auditoría [0.0139, 0.079, 0.138] con 3 corridas → ANTES null (F4-1), AHORA calibra entre clases', () => {
    // Con una sola corrida, F4-1 bloquea con razón (sin_celdas_vacias: no
    // hay NINGUNA medición ≤ 0.002). Acumulado en 3 corridas del mismo
    // documento, la clase de ruido (flash ≈ 0.0139-0.0141) queda separada de
    // la clase de tinta y el corte sale de los datos: mismo veredicto que
    // buscaría una persona mirando los histogramas.
    const corridas = [
      corrida('firma_x', [0.0139, 0.079, 0.138]),
      corrida('firma_x', [0.0141, 0.081, 0.14]),
      corrida('firma_x', [0.0137, 0.077, 0.136]),
    ];
    const s = sugerirUmbralClustering(corridas, 'firma_x');
    expect(s.metodo).toBe('clustering');
    expect(s.sugerido).not.toBeNull();
    expect(s.motivo).toBeUndefined();
    expect(s.minConTinta).toBeCloseTo(0.077, 6);
    expect(s.maxSinTinta).toBeCloseTo(0.0141, 6);
    expect(s.sugerido!).toBeGreaterThan(0.0141);
    expect(s.sugerido!).toBeLessThan(0.077);
  });

  test('ratio 0 (celda totalmente limpia) entra a la clase de ruido sin romper el clustering', () => {
    const corridas = [
      corrida('firma_x', [0, 0.1]),
      corrida('firma_x', [0, 0.12]),
      corrida('firma_x', [0.001, 0.09]),
    ];
    const s = sugerirUmbralClustering(corridas, 'firma_x');
    expect(s.metodo).toBe('clustering');
    expect(s.sugerido).not.toBeNull();
    expect(s.minConTinta).toBeCloseTo(0.09, 6);
    expect(s.maxSinTinta).toBeCloseTo(0.001, 6);
    expect(s.sugerido).toBeCloseTo(0.063, 6);
  });

  test('el ruido real puede estar POR ENCIMA del corte fijo 0.002 y aun así calibra (fin del corte fijo)', () => {
    // Todas las "vacías" midieron 0.003-0.006 (papel rugoso): el corte fijo
    // 0.002 las habría clasificado como tinta y F4-1 habría bloqueado
    // (sin_celdas_vacias) aunque el ruido SÍ fue medido. El clustering ve
    // las dos clases y sugiere.
    const corridas = [
      corrida('firma_x', [0.004, 0.085]),
      corrida('firma_x', [0.003, 0.09]),
      corrida('firma_x', [0.006, 0.08]),
    ];
    const s = sugerirUmbralClustering(corridas, 'firma_x');
    expect(s.metodo).toBe('clustering');
    expect(s.sugerido).not.toBeNull();
    expect(s.minConTinta).toBeCloseTo(0.08, 6);
    expect(s.maxSinTinta).toBeCloseTo(0.006, 6);
    expect(s.sugerido).toBeCloseTo(0.056, 6);
  });
});

describe('Fase 8 — regresión: con < 3 corridas el comportamiento es EXACTAMENTE el anterior', () => {
  test('2 corridas: gana la PRIMERA que sugiere (c1 sano) aunque la c2 esté entrelazada', () => {
    const corridas = [
      corrida('firma_x', [0.001, 0.079, 0.138]), // sugiere 0.0553
      corrida('firma_x', [0.002, 0.0035]), // entrelazadas → no sugiere
    ];
    const s = sugerirUmbralClustering(corridas, 'firma_x');
    expect(s.metodo).toBe('corte_fijo');
    expect(s.corridasConMediciones).toBe(2);
    expect(s.sugerido).toBeCloseTo(0.079 * 0.7, 6);
    expect(s.motivo).toBeUndefined();
  });

  test('1 corrida con el caso de la auditoría → null + sin_celdas_vacias (F4-1 intacto)', () => {
    const s = sugerirUmbralClustering([corrida('firma_x', [0.0139, 0.079, 0.138])], 'firma_x');
    expect(s.metodo).toBe('corte_fijo');
    expect(s.sugerido).toBeNull();
    expect(s.motivo).toBe('sin_celdas_vacias');
  });

  test('1 corrida sana coincide EXACTAMENTE con sugerirUmbral (misma recomendación)', () => {
    const unica = corrida('firma_x', [0.001, 0.079, 0.138]);
    const a = sugerirUmbral(unica, 'firma_x');
    const b = sugerirUmbralClustering([unica], 'firma_x');
    expect(b.metodo).toBe('corte_fijo');
    expect(b.sugerido).toBe(a.sugerido);
    expect(b.minConTinta).toBe(a.minConTinta);
    expect(b.maxSinTinta).toBe(a.maxSinTinta);
  });

  test('sin mediciones en ninguna corrida → sin_mediciones', () => {
    const s = sugerirUmbralClustering([corrida('otro_campo', [0.1]), corrida('otro_campo', [0.2])], 'firma_x');
    expect(s.sugerido).toBeNull();
    expect(s.motivo).toBe('sin_mediciones');
    expect(s.corridasConMediciones).toBe(0);
  });
});

describe('Fase 8 — guardas de honestidad sobre las CLASES (nunca por debajo del ruido)', () => {
  test('clases entrelazadas (0.02-0.03 vs 0.058-0.062) → null con motivo, aunque haya 3 corridas', () => {
    const corridas = [
      corrida('firma_x', [0.02, 0.03, 0.06]),
      corrida('firma_x', [0.021, 0.031, 0.058]),
      corrida('firma_x', [0.019, 0.029, 0.062]),
    ];
    const s = sugerirUmbralClustering(corridas, 'firma_x');
    expect(s.metodo).toBe('clustering');
    expect(s.sugerido).toBeNull();
    expect(s.motivo).toBe('clases_entrelazadas');
    expect(s.maxSinTinta).toBeCloseTo(0.031, 6);
    expect(s.minConTinta).toBeCloseTo(0.058, 6);
  });

  test('el k-means arrastra el flash a la clase de tinta → guarda del techo rechaza y NO se calibra (caso ambiguo honesto)', () => {
    // Solo tres niveles, con la misma multiplicidad: {0.002}×3, {0.0139}×3,
    // {0.079}×3. Ni el k-means ni la brecha máxima pueden decidir si 0.0139
    // es flash o un trazo muy ligero: la clase alta tendría su mínimo a
    // nivel de ruido (0.0139 ≤ TECHO_RUIDO) → rechazo honesto.
    const corridas = [
      corrida('firma_x', [0.002, 0.0139, 0.079]),
      corrida('firma_x', [0.002, 0.0139, 0.079]),
      corrida('firma_x', [0.002, 0.0139, 0.079]),
    ];
    const s = sugerirUmbralClustering(corridas, 'firma_x');
    expect(s.metodo).toBe('clustering');
    expect(s.sugerido).toBeNull();
    expect(s.motivo).toBe('sin_tinta');
    expect(s.minConTinta).toBeCloseTo(0.0139, 6);
    expect(s.maxSinTinta).toBeCloseTo(0.002, 6);
  });

  test('todo a nivel trazo en 3 corridas (sin NINGUNA vacía medida) → sin_celdas_vacias (pre-gate)', () => {
    const corridas = [
      corrida('firma_x', [0.079, 0.138]),
      corrida('firma_x', [0.081, 0.14]),
      corrida('firma_x', [0.077, 0.136]),
    ];
    const s = sugerirUmbralClustering(corridas, 'firma_x');
    expect(s.metodo).toBe('clustering');
    expect(s.sugerido).toBeNull();
    expect(s.motivo).toBe('sin_celdas_vacias');
    expect(s.minConTinta).toBeCloseTo(0.077, 6);
    expect(s.maxSinTinta).toBeNull();
  });

  test('todo a nivel ruido en 3 corridas → sin_tinta (pre-gate)', () => {
    const corridas = [
      corrida('firma_x', [0.001, 0.004]),
      corrida('firma_x', [0.0008, 0.003]),
      corrida('firma_x', [0.0012, 0.005]),
    ];
    const s = sugerirUmbralClustering(corridas, 'firma_x');
    expect(s.metodo).toBe('clustering');
    expect(s.sugerido).toBeNull();
    expect(s.motivo).toBe('sin_tinta');
    expect(s.maxSinTinta).toBeCloseTo(0.005, 6);
    expect(s.minConTinta).toBeNull();
  });
});

describe('Fase 8 — determinismo y coherencia con el criterio del motor', () => {
  const corridas = [
    corrida('firma_x', [0.002, 0.0139, 0.079]),
    corrida('firma_x', [0.0018, 0.0031, 0.098]),
    corrida('firma_x', [0.0011, 0.0025, 0.11]),
  ];

  test('misma entrada → misma salida (sin azar en la inicialización)', () => {
    const a = sugerirUmbralClustering(corridas, 'firma_x');
    const b = sugerirUmbralClustering([...corridas].reverse(), 'firma_x');
    expect(a).toEqual(b);
  });

  test('el sugerido SIEMPRE queda por encima del ruido máximo y por debajo del trazo más fino', () => {
    const s = sugerirUmbralClustering(corridas, 'firma_x');
    expect(s.sugerido).not.toBeNull();
    expect(s.sugerido!).toBeGreaterThan(s.maxSinTinta!);
    expect(s.sugerido!).toBeLessThan(s.minConTinta!);
  });

  test('límite documentado: trazos por debajo del techo de ruido (0.02) NO calibran por clustering', () => {
    // Con trazos de 0.0025 (25× por debajo del trazo más fino del corpus,
    // 0.045) TODAS las mediciones quedan a nivel ruido → el clustering se
    // niega con razón (no hay tinta demostrable por encima del techo). Es el
    // camino seguro: esos campos se calibran con pocas corridas
    // (corte_fijo) o manualmente. TECHO_RUIDO es recalibrable si un corpus
    // futuro demuestra trazos legítimos por debajo de 0.02.
    const finas = [
      corrida('firma_x', [0.0002, 0.0025]),
      corrida('firma_x', [0.0003, 0.0026]),
      corrida('firma_x', [0.0004, 0.0027]),
    ];
    const s = sugerirUmbralClustering(finas, 'firma_x');
    expect(s.metodo).toBe('clustering');
    expect(s.sugerido).toBeNull();
    expect(s.motivo).toBe('sin_tinta');
    expect(s.maxSinTinta).toBeCloseTo(0.0027, 6);
  });
});
