/**
 * Regresión del plan §B (rotada-12 — «el visor cae a la foto original»):
 *   · CAUSA RAÍZ medida: `procesadaVacia` se calculaba sobre una miniatura de
 *     200 px que BORRA los trazos finos — rotada-12 (1.37 % de tinta real a
 *     resolución completa) medía 0.0009 < 0.002 y §D4 mostraba la ORIGINAL
 *     aunque la procesada tenía contenido (el OCR leyó 9/12 por la vía cruda).
 *     El ancho de medición ahora es ANCHO_MEDIDA_TINTA=600 (tinta@600 = 0.0124).
 *   · Blindaje anti-degenerados del quad (gemelos image-processor.ts y
 *     workers/fallback-canvas.ts — misma matemática, mismo commit): un quad con
 *     NaN/±Inf envenenaba crop (canvas 0×0 → drawImage no-op SILENCIOSO →
 *     toDataURL '') y warp (hypot(NaN) → ancho NaN). Ahora se sana a identidad
 *     y el ancho queda clampeado ≥1 — un '' silencioso es imposible.
 * Tests de FUNCIONES PURAS (sin DOM — las guardas viven en quad-guardas.ts y
 * la medición en pipeline.ts; el decode PNG del fixture no se replica aquí
 * porque bun no trae decodificador de imágenes sin dependencias nuevas).
 */
import { describe, expect, test } from 'bun:test';

import {
  anchoSalidaDeQuad,
  sanearQuad,
  sanearQuadPlano,
} from '@molde-suite/scanner-core/core/quad-guardas';
// Gemelo worker (misma matemática por doctrina) — módulo puro importable.
import '@molde-suite/scanner-core/workers/fallback-canvas';
// quadSesgado (homografía, solo lectura) documenta POR QUÉ la sanitización
// debe correr ANTES de la decisión crop/warp.
import { quadSesgado } from '@molde-suite/scanner-core/molde/homografia';
import {
  ANCHO_MEDIDA_TINTA,
  razonTintaDePixeles,
} from '../src/lib/e14/pipeline';

import type { Quad } from '@molde-suite/scanner-core/core/types';

const QUAD_IDENTITY: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

/** Quad sesgado sano (foto en ángulo) — como el que produce el detector. */
const QUAD_SESGADO: Quad = [
  { x: 0.08, y: 0.05 },
  { x: 0.9, y: 0.12 },
  { x: 0.86, y: 0.92 },
  { x: 0.04, y: 0.88 },
];

describe('guarda anti-degenerados del quad — sanearQuad (gemelo main)', () => {
  test('quad sano → intacto (paridad byte-fiel con la matemática que funciona)', () => {
    const r = sanearQuad(QUAD_SESGADO);
    expect(r.saneado).toBe(false);
    expect(r.quad).toEqual(QUAD_SESGADO);
  });

  test('quad con NaN en una esquina → identidad (no envenena crop ni warp)', () => {
    const roto: Quad = [
      { x: 0.1, y: 0.1 },
      { x: Number.NaN, y: 0.1 },
      { x: 0.9, y: 0.9 },
      { x: 0.1, y: 0.9 },
    ];
    const r = sanearQuad(roto);
    expect(r.saneado).toBe(true);
    expect(r.quad).toEqual(QUAD_IDENTITY);
  });

  test('quad con ±Infinito → identidad', () => {
    const r = sanearQuad([
      { x: Number.POSITIVE_INFINITY, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: Number.NEGATIVE_INFINITY },
      { x: 0, y: 1 },
    ]);
    expect(r.saneado).toBe(true);
    expect(r.quad).toEqual(QUAD_IDENTITY);
  });

  test('documentación: quadSesgado NO detecta el quad con NaN — la guarda es obligatoria', () => {
    // Con NaN, las comparaciones de quadSesgado son false → devuelve false y el
    // pipeline entraría a la ruta CROP con min/max NaN (canvas 0×0 → ''). Por
    // eso sanearQuad corre ANTES de la decisión (image-processor.ts).
    const roto: Quad = [
      { x: Number.NaN, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    expect(quadSesgado(roto)).toBe(false);
    expect(quadSesgado(QUAD_IDENTITY)).toBe(false);
    expect(quadSesgado(QUAD_SESGADO)).toBe(true);
  });
});

describe('guarda anti-degenerados del quad — sanearQuadPlano (gemelo worker)', () => {
  test('plano sano → intacto', () => {
    const plano = [0.08, 0.05, 0.9, 0.12, 0.86, 0.92, 0.04, 0.88];
    const r = sanearQuadPlano(plano);
    expect(r.saneado).toBe(false);
    expect(r.plano).toEqual(plano);
  });

  test('plano con NaN → identidad aplanada', () => {
    const r = sanearQuadPlano([Number.NaN, 0, 1, 0, 1, 1, 0, 1]);
    expect(r.saneado).toBe(true);
    expect(r.plano).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
  });

  test('plano incompleto (<8 valores) → identidad', () => {
    const r = sanearQuadPlano([0, 0, 1, 0, 1, 1]);
    expect(r.saneado).toBe(true);
    expect(r.plano).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
  });

  test('PARIDAD de gemelos: main y worker deciden LO MISMO para el mismo quad', () => {
    const casos: Quad[] = [
      QUAD_IDENTITY,
      QUAD_SESGADO,
      [
        { x: Number.NaN, y: 0.2 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: Number.POSITIVE_INFINITY },
      ],
    ];
    for (const quad of casos) {
      const main = sanearQuad(quad);
      const worker = sanearQuadPlano(quad.flatMap((p) => [p.x, p.y]));
      expect(worker.saneado).toBe(main.saneado);
      const identidadEsperada = main.saneado ? QUAD_IDENTITY : quad;
      expect(worker.plano).toEqual(identidadEsperada.flatMap((p) => [p.x, p.y]));
    }
  });
});

describe('anchoSalidaDeQuad — ancho del warp con clamp anti-degenerados', () => {
  // Fórmula histórica (image-processor.ts antes de la guarda): media de los
  // lados TL→TR y BL→BR en px — el test asegura PARIDAD para quads sanos.
  const formulaHistorica = (quad: Quad, w: number, h: number): number =>
    (Math.hypot((quad[1].x - quad[0].x) * w, (quad[1].y - quad[0].y) * h) +
      Math.hypot((quad[2].x - quad[3].x) * w, (quad[2].y - quad[3].y) * h)) /
    2;

  test('quad sano → EXACTAMENTE la fórmula histórica (misma matemática)', () => {
    expect(anchoSalidaDeQuad(QUAD_SESGADO, 2120, 2505, 4032)).toBeCloseTo(
      formulaHistorica(QUAD_SESGADO, 2120, 2505),
      6,
    );
    expect(anchoSalidaDeQuad(QUAD_IDENTITY, 1700, 2200, 4032)).toBeCloseTo(
      formulaHistorica(QUAD_IDENTITY, 1700, 2200),
      6,
    );
  });

  test('quad con NaN → FINITO y ≥ 1 (antes: Math.min(4032, NaN) = NaN → canvas 0×0)', () => {
    const roto: Quad = [
      { x: Number.NaN, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 },
      { x: 0.1, y: 0.9 },
    ];
    const ancho = anchoSalidaDeQuad(roto, 2120, 2505, 4032);
    expect(Number.isFinite(ancho)).toBe(true);
    expect(ancho).toBeGreaterThanOrEqual(1);
  });

  test('quad degenerado (todas las esquinas iguales) → clamp a 1, jamás 0', () => {
    const punto: Quad = [
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.5 },
    ];
    expect(anchoSalidaDeQuad(punto, 2120, 2505, 4032)).toBe(1);
  });

  test('quad gigante → clampa al tope del lado mayor (4032)', () => {
    const enorme: Quad = [
      { x: -50, y: -50 },
      { x: 60, y: -40 },
      { x: 55, y: 70 },
      { x: -45, y: 60 },
    ];
    expect(anchoSalidaDeQuad(enorme, 2120, 2505, 4032)).toBe(4032);
  });
});

describe('razonTintaDePixeles — medición de tinta a ANCHO_MEDIDA_TINTA (causa raíz rotada-12)', () => {
  test('el ancho de medición es 600 (la miniatura de 200 px borraba trazos finos)', () => {
    expect(ANCHO_MEDIDA_TINTA).toBe(600);
  });

  /** Página sintética "recibo claro" (análoga a rotada-12): papel 255 con
   *  líneas de tinta fina de 3 px a resolución completa. Devuelve RGBA. */
  function paginaConTintaFina(w: number, h: number, lineas: number): { w: number; h: number; data: Uint8ClampedArray } {
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    const paso = Math.floor(h / lineas);
    for (let i = 0; i < lineas; i++) {
      const y0 = i * paso;
      for (let y = y0; y < Math.min(h, y0 + 3); y++) {
        for (let x = 0; x < w; x++) {
          const p = (y * w + x) * 4;
          data[p] = 20;
          data[p + 1] = 20;
          data[p + 2] = 20;
          data[p + 3] = 255;
        }
      }
    }
    return { w, h, data };
  }

  test('página REALMENTE en blanco → 0 a cualquier ancho (§D4 intacto para el caso legítimo)', () => {
    const blanca = { w: 2000, h: 2360, data: new Uint8ClampedArray(2000 * 2360 * 4).fill(255) };
    expect(razonTintaDePixeles(blanca, 200)).toBe(0);
    expect(razonTintaDePixeles(blanca, ANCHO_MEDIDA_TINTA)).toBe(0);
    expect(razonTintaDePixeles(blanca, 4000)).toBe(0);
  });

  test('REGRESIÓN rotada-12: tinta fina de 3 px se mide VACÍA a 200 px y CON tinta a 600', () => {
    // 15 líneas × 3 px sobre 2000×2360 ≈ 1.9 % de tinta a resolución completa —
    // el orden de magnitud del recibo claro del banco.
    const pagina = paginaConTintaFina(2000, 2360, 15);
    const a200 = razonTintaDePixeles(pagina, 200);
    const a600 = razonTintaDePixeles(pagina, ANCHO_MEDIDA_TINTA);
    // El falso positivo histórico: la reducción de 10× promedia (3·0 + 7·255)/10
    // = 178 > 120 ⇒ la miniatura de 200 px NO VE la tinta.
    expect(a200).toBeLessThan(0.002);
    // Con ANCHO_MEDIDA_TINTA la tinta sobrevive (margen ≥ 6× sobre el umbral,
    // como rotada-12 medida: 0.0124).
    expect(a600).toBeGreaterThanOrEqual(0.002);
    expect(a600).toBeGreaterThanOrEqual(a200 * 5);
  });

  test('criterio de umbral intacto: canal rojo < 120 cuenta como tinta', () => {
    // Un solo píxel a escala nativa (downscale identidad): 119 cuenta, 121 no.
    const uno = (r: number): { w: number; h: number; data: Uint8ClampedArray } => {
      const d = new Uint8ClampedArray(4).fill(255);
      d[0] = r;
      return { w: 1, h: 1, data: d };
    };
    expect(razonTintaDePixeles(uno(119), ANCHO_MEDIDA_TINTA)).toBe(1);
    expect(razonTintaDePixeles(uno(120), ANCHO_MEDIDA_TINTA)).toBe(0);
    expect(razonTintaDePixeles(uno(121), ANCHO_MEDIDA_TINTA)).toBe(0);
  });

  test('sin upscale: imagen pequeña se mide a su tamaño nativo', () => {
    // 10×10 con la mitad superior oscura → 0.5 esperado (ancho pedido 600 > 10).
    const d = new Uint8ClampedArray(10 * 10 * 4).fill(255);
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 10; x++) {
        const p = (y * 10 + x) * 4;
        d[p] = 0;
        d[p + 1] = 0;
        d[p + 2] = 0;
      }
    }
    expect(razonTintaDePixeles({ w: 10, h: 10, data: d }, ANCHO_MEDIDA_TINTA)).toBe(0.5);
  });

  test('entradas degeneradas (0 px) → 0 sin lanzar', () => {
    expect(razonTintaDePixeles({ w: 0, h: 0, data: new Uint8ClampedArray(0) }, 600)).toBe(0);
  });
});
