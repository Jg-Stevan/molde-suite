/// <reference types="bun-types" />
// Batería de pruebas de las correcciones post-verificación (informe
// "Informe-Verificación — molde-suite-mejoras.zip", 2026-11-21).
// Ejecutar desde apps/molde-studio:  bun test tests/correcciones-post-verificacion.test.ts
//
// Cubre:
//   F4-1 (§6.1) — guarda de sugerirUmbral cuando NO hay celdas vacías medidas.
//   F4  (§4.4)  — regresión de la guarda 4.1 original (clases entrelazadas).
//   F1  (§5.2)  — regresión del matcher ponderado (caso auditoría J4 vs J2).
//   O2  (§6.3)  — geometría de los desambiguadores añadidos al molde E-14.
//   O2  (§6.3)  — comportamiento funcional de desambiguado()/resolverRectCampo.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import {
  buscarAncla,
  editDistance,
  editDistancePonderada,
  RADIO_DESAMBIGUACION,
  resolverRectCampo,
  sugerirUmbral,
} from '@/lib/molde/universal-engine';
import { esMoldeUniversal, type MoldeUniversal } from '@/lib/molde/universal-types';
import type { LineaOcr } from '@/lib/molde/types';

// Lienzo de referencia del motor: 1000 px de ancho (TARGET_WIDTH), página
// vertical con la proporción del escaneo Nairobi (≈1414 px de alto).
const W = 1000;
const H = 1414;

/** Construye una línea OCR con palabras equidistribuidas dentro de un rect
 * normalizado (mismo contrato que entrega Tesseract vía ocrLines). */
function linea(
  texto: string,
  rect: { x: number; y: number; w: number; h: number },
): LineaOcr {
  const palabras = texto
    .split(' ')
    .filter(Boolean)
    .map((t) => ({ texto: t, conf: 0.99, bbox: [0, 0, 0, 0] as [number, number, number, number] }));
  const x0 = rect.x * W;
  const y0 = rect.y * H;
  const x1 = (rect.x + rect.w) * W;
  const y1 = (rect.y + rect.h) * H;
  const anchoPalabra = (x1 - x0) / Math.max(1, palabras.length);
  palabras.forEach((p, i) => {
    p.bbox = [Math.round(x0 + i * anchoPalabra), Math.round(y0), Math.round(x0 + (i + 1) * anchoPalabra), Math.round(y1)];
  });
  return { texto, bbox: [Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1)], palabras };
}

/** ResultadoUniversal mínimo con los ratios de un campo en una página. */
function resultadosConRatios(campoId: string, ratios: number[]) {
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
  } as unknown as Parameters<typeof sugerirUmbral>[0];
}

describe('F4-1 — guarda de sugerirUmbral sin celdas vacías (informe §6.1)', () => {
  test('caso exacto de la auditoría [0.0139, 0.079, 0.138] → NO sugiere (antes sugería 0.0097)', () => {
    // La zona vacía con flash (0.0139) supera el corte fijo 0.002 y entra como
    // "con tinta": maxSinTinta queda null, la guarda 4.1 no disparaba y la
    // función sugería 0.0097 — por debajo del ruido real.
    const s = sugerirUmbral(resultadosConRatios('firma_x', [0.0139, 0.079, 0.138]), 'firma_x');
    expect(s.sugerido).toBeNull();
    expect(s.motivo).toBe('sin_celdas_vacias');
    expect(s.minConTinta).toBeCloseTo(0.0139, 6);
    expect(s.maxSinTinta).toBeNull();
  });

  test('una sola medición "con tinta" sin vacías → tampoco sugiere', () => {
    const s = sugerirUmbral(resultadosConRatios('firma_x', [0.05]), 'firma_x');
    expect(s.sugerido).toBeNull();
    expect(s.motivo).toBe('sin_celdas_vacias');
  });

  test('caso sano (vacía limpia + trazos) → sigue sugiriendo trazo × 0.7', () => {
    const s = sugerirUmbral(resultadosConRatios('firma_x', [0.001, 0.079, 0.138]), 'firma_x');
    expect(s.sugerido).not.toBeNull();
    expect(s.motivo).toBeUndefined();
    expect(s.sugerido).toBeCloseTo(0.079 * 0.7, 6);
    expect(s.maxSinTinta).toBeCloseTo(0.001, 6);
  });

  test('regresión guarda 4.1: clases entrelazadas (0.002 / 0.0035) → null con motivo', () => {
    const s = sugerirUmbral(resultadosConRatios('firma_x', [0.002, 0.0035]), 'firma_x');
    expect(s.sugerido).toBeNull();
    expect(s.motivo).toBe('clases_entrelazadas');
  });

  test('sin mediciones / sin tinta → motivos explícitos', () => {
    const sinMed = sugerirUmbral(resultadosConRatios('firma_x', []), 'firma_x');
    expect(sinMed.sugerido).toBeNull();
    expect(sinMed.motivo).toBe('sin_mediciones');
    const sinTinta = sugerirUmbral(resultadosConRatios('firma_x', [0.001, 0.0005]), 'firma_x');
    expect(sinTinta.sugerido).toBeNull();
    expect(sinTinta.motivo).toBe('sin_tinta');
  });
});

describe('F1 — regresión del matcher ponderado (informe §5.2)', () => {
  test('el bug original: editDistance plana cuenta 1 dígito', () => {
    expect(editDistance('FIRMA JURADO 4', 'FIRMA JURADO 2')).toBe(1);
  });
  test('la versión ponderada cuesta 3 (sustitución de dígito ×3)', () => {
    expect(editDistancePonderada('FIRMA JURADO 4', 'FIRMA JURADO 2')).toBe(3);
  });
  test('tolerancia de letras intacta: "FIRNA" sigue costando 1', () => {
    expect(editDistancePonderada('FIRNA', 'FIRMA')).toBe(1);
  });
  test('match difuso de J4 contra la etiqueta de J2 (geometría de la auditoría) → rechazado < 0.72', () => {
    // J2 en su posición real del escaneo (ancla.rect del molde), J4 buscando
    // desde su rect esperado: el score ponderado + penalización de posición
    // da ≈0.651 (antes, con distancia plana, 0.765 ≥ 0.72 — el falso positivo).
    const lineas = [linea('FIRMA JURADO 2:', { x: 0.625, y: 0.8386, w: 0.159, h: 0.0046 })];
    const hit = buscarAncla('FIRMA JURADO 4', lineas, W, H, { x: 0.624, y: 0.9062, w: 0.163, h: 0.0053 });
    expect(hit).not.toBeNull();
    expect(hit!.score).toBeLessThan(0.72);
  });
  test('la etiqueta correcta sigue aceptándose', () => {
    const lineas = [linea('FIRMA JURADO 4:', { x: 0.624, y: 0.9062, w: 0.163, h: 0.0053 })];
    const hit = buscarAncla('FIRMA JURADO 4', lineas, W, H, { x: 0.624, y: 0.9062, w: 0.163, h: 0.0053 });
    expect(hit).not.toBeNull();
    expect(hit!.score).toBeGreaterThanOrEqual(0.72);
  });
});

// ---- O2: molde E-14 con desambiguadores ----

const MOLDE_E14: MoldeUniversal = JSON.parse(
  readFileSync(new URL('../templates/e14/molde-e14.json', import.meta.url), 'utf8'),
) as MoldeUniversal;

const centro = (r: { x: number; y: number; w: number; h: number }) => ({
  cx: r.x + r.w / 2,
  cy: r.y + r.h / 2,
});
const distancia = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) => {
  const ca = centro(a);
  const cb = centro(b);
  return Math.hypot(Math.abs(ca.cx - cb.cx), Math.abs(ca.cy - cb.cy));
};

describe('O2 — desambiguadores del molde E-14 (informe §6.3, recomendación 5)', () => {
  const firmas = MOLDE_E14.campos.filter((c) => c.id.startsWith('firma_jurado_'));

  test('el molde con desambiguadores sigue siendo válido', () => {
    expect(esMoldeUniversal(MOLDE_E14)).toBe(true);
  });

  test('las 4 firmas declaran desambiguadores', () => {
    expect(firmas.length).toBe(4);
    for (const f of firmas) {
      expect(f.desambiguadores?.length ?? 0).toBeGreaterThan(0);
    }
  });

  test('el contexto exigido SÍ está dentro del radio respecto del rect propio (hit legítimo aceptado)', () => {
    for (const f of firmas) {
      for (const texto of f.desambiguadores ?? []) {
        // "JURADO 3" → firma_jurado_3: el compañero de columna del acta.
        const numero = texto.match(/(\d+)/)?.[1];
        const companero = firmas.find((o) => o.id.endsWith(`jurado_${numero}`));
        expect(companero).toBeDefined();
        const d = distancia(f.ancla!.rect!, companero!.ancla!.rect!);
        expect(d).toBeLessThanOrEqual(RADIO_DESAMBIGUACION);
      }
    }
  });

  test('el contexto NO está junto a las etiquetas de la OTRA banda (hit cruzado rechazado)', () => {
    // J1 (arriba-izquierda) exige "JURADO 3" (abajo-izquierda): esa etiqueta NO
    // está a ≤0.3 de J2 ni de J4 (banda derecha) — el hit cruzado cae a
    // respaldo/referencia con desambiguacion_fallida.
    const j1 = firmas.find((f) => f.id === 'firma_jurado_1')!;
    const j3 = firmas.find((f) => f.id === 'firma_jurado_3')!;
    for (const otro of firmas.filter((f) => f.id !== 'firma_jurado_1' && f.id !== 'firma_jurado_3')) {
      expect(distancia(j3.ancla!.rect!, otro.ancla!.rect!)).toBeGreaterThan(RADIO_DESAMBIGUACION);
    }
    // Y simétricamente para J3 → "JURADO 1".
    for (const otro of firmas.filter((f) => f.id !== 'firma_jurado_1' && f.id !== 'firma_jurado_3')) {
      expect(distancia(j1.ancla!.rect!, otro.ancla!.rect!)).toBeGreaterThan(RADIO_DESAMBIGUACION);
    }
  });

  test('funcional: hit de firma_jurado_1 CON contexto (J3 visible) → fuente ancla', () => {
    const campo = firmas.find((f) => f.id === 'firma_jurado_1')!;
    const lineas = [
      linea('FIRMA JURADO 1:', campo.ancla!.rect!),
      linea('FIRMA JURADO 3:', firmas.find((f) => f.id === 'firma_jurado_3')!.ancla!.rect!),
    ];
    const r = resolverRectCampo(campo, lineas, W, H);
    expect(r).not.toBeNull();
    expect(r!.fuente).toBe('ancla');
    expect(r!.desambiguacion_fallida).toBeUndefined();
  });

  test('funcional: hit en posición correcta SIN contexto (J3 no aparece por OCR) → cae a referencia con bandera', () => {
    const campo = firmas.find((f) => f.id === 'firma_jurado_1')!;
    const lineas = [linea('FIRMA JURADO 1:', campo.ancla!.rect!)];
    const r = resolverRectCampo(campo, lineas, W, H);
    expect(r).not.toBeNull();
    expect(r!.fuente).toBe('referencia');
    expect(r!.desambiguacion_fallida).toBe(true);
  });

  test('compatibilidad: campo SIN desambiguadores no exige contexto', () => {
    const campo = firmas.find((f) => f.id === 'firma_jurado_1')!;
    const sinDesambiguar = { ...campo, desambiguadores: undefined };
    const lineas = [linea('FIRMA JURADO 1:', campo.ancla!.rect!)];
    const r = resolverRectCampo(sinDesambiguar, lineas, W, H);
    expect(r).not.toBeNull();
    expect(r!.fuente).toBe('ancla');
  });
});
