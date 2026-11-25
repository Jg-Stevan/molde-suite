// Tests unitarios del plan de extracción relacional (FASES 1, 2b y 3).
// Cubren las primitivas que el motor exporta para pruebas y las dos defensas
// que evitan el falso positivo: la cota de desplazamiento del bypass textual y
// el endurecimiento del fallback sin verificar.

import { test, expect, describe } from 'bun:test';
import {
  ANCLA_SCORE_MIN,
  ANCLA_TEXUAL_DESPLAZAMIENTO_MAX,
  buscarAncla,
  endurecerFallbackNoVerificado,
  parsearFechaTexto,
  parsearRango,
  resolverRectCampo,
  textoEnRect,
} from './universal-engine';
import type { CampoUniversal, RectNorm, ResultadoCampoUniversal } from './universal-types';
import type { LineaOcr, PalabraOcr } from './ocr-tipos';

const W = 1000;
const H = 1400;

/** Línea OCR sintética: palabras consecutivas de 90 px a la altura `cy` (px). */
function linea(texto: string, cy: number, x0 = 100): LineaOcr {
  const pals = texto.split(' ');
  const palabras: PalabraOcr[] = pals.map((t, i) => ({
    texto: t,
    conf: 0.95,
    bbox: [x0 + i * 90, cy - 12, x0 + (i + 1) * 90, cy + 12],
  }));
  return {
    texto,
    bbox: [x0, cy - 12, x0 + pals.length * 90, cy + 12],
    palabras,
  };
}

describe('buscarAncla — bypass textual solo_textual', () => {
  // Centro esperado del ancla en el molde de referencia.
  const esperado: RectNorm = { x: 0.1, y: 0.56, w: 0.27, h: 0.02 };
  const textoAncla = 'En concepto de';

  test('match perfecto ÚNICO con desplazamiento moderado (recorte) se acepta', () => {
    // dy = 0.20 → penalizado 1/(1+3·0.20) = 0.625 < ANCLA_SCORE_MIN: sin el
    // bypass el campo caería al fallback de referencia (el caso del recibo).
    const hit = buscarAncla(textoAncla, [linea(textoAncla, 0.77 * H)], W, H, esperado);
    expect(hit).not.toBeNull();
    expect(hit!.solo_textual).toBe(true);
    expect(hit!.score).toBeGreaterThanOrEqual(ANCLA_SCORE_MIN);
  });

  test('match perfecto pero LEJOS de la posición esperada NO se acepta', () => {
    // dy = 0.42 > ANCLA_TEXUAL_DESPLAZAMIENTO_MAX: la etiqueta está en la
    // cabecera, no en la banda del campo. Aceptarla anclaría el dato en un
    // sitio equivocado con aspecto de verificado.
    expect(ANCLA_TEXUAL_DESPLAZAMIENTO_MAX).toBeLessThan(0.42);
    const hit = buscarAncla(textoAncla, [linea(textoAncla, 0.15 * H)], W, H, esperado);
    expect(hit).not.toBeNull();
    expect(hit!.solo_textual).toBeFalsy();
    expect(hit!.score).toBeLessThan(ANCLA_SCORE_MIN);
  });

  test('con DOS ventanas perfectas dentro de la cota manda la posición', () => {
    const cerca = linea(textoAncla, 0.77 * H);
    const lejis = linea(textoAncla, 0.8 * H);
    const hit = buscarAncla(textoAncla, [lejis, cerca], W, H, esperado);
    expect(hit!.solo_textual).toBeFalsy();
    // El rect elegido es el de la línea más cercana al esperado.
    expect(hit!.rect.y).toBeCloseTo((0.77 * H - 12) / H, 6);
  });

  test('dos ventanas perfectas, una fuera de cota: sigue siendo ambiguo', () => {
    // Regresión medida: filtrar por cota antes de contar dejaba 1 «perfecto» y
    // concedía el bypass → las dos firmas del recibo tachado volvían a 'ok'.
    const hit = buscarAncla(
      textoAncla,
      [linea(textoAncla, 0.15 * H), linea(textoAncla, 0.77 * H)],
      W,
      H,
      esperado,
    );
    expect(hit!.solo_textual).toBeFalsy();
    expect(hit!.score).toBeLessThan(ANCLA_SCORE_MIN);
  });

  test('sin rect esperado no hay bypass que aplicar', () => {
    const hit = buscarAncla(textoAncla, [linea(textoAncla, 0.15 * H)], W, H);
    expect(hit!.solo_textual).toBeFalsy();
    expect(hit!.score).toBe(1);
  });

  test('DOS «Firma» perfectas en columnas distintas (recorte): la columna concede el bypass', () => {
    // Medido en recorte-66pct-sin-firma: etiquetas al pie (y≈0.9) contra la
    // referencia del molde (y≈0.622) → dy≈0.27 y score posicional < 0.72.
    // El match no es único, pero cada campo espera SU columna: la x desambigua.
    const izq = linea('Firma', 0.9 * H, 245);
    const der = linea('Firma', 0.9 * H, 666);
    const espEmisor: RectNorm = { x: 0.268, y: 0.622, w: 0.044, h: 0.01 };
    const espPagador: RectNorm = { x: 0.689, y: 0.622, w: 0.045, h: 0.01 };
    const hitE = buscarAncla('Firma', [izq, der], W, H, espEmisor);
    const hitP = buscarAncla('Firma', [izq, der], W, H, espPagador);
    expect(hitE!.solo_textual).toBe(true);
    expect(hitP!.solo_textual).toBe(true);
    expect(hitE!.rect.x).toBeCloseTo(245 / W, 6);
    expect(hitP!.rect.x).toBeCloseTo(666 / W, 6);
  });

  test('única perfecta en columna pero FUERA de la cota vertical: sin bypass', () => {
    // La «Firma» de la cabecera (dy≈0.48) no puede ganar el bypass aunque su
    // columna coincida: aceptarla anclaría el campo en una zona equivocada.
    const arriba = linea('Firma', 0.15 * H, 245);
    const pie = linea('Firma', 0.9 * H, 666);
    const espEmisor: RectNorm = { x: 0.268, y: 0.622, w: 0.044, h: 0.01 };
    const hit = buscarAncla('Firma', [arriba, pie], W, H, espEmisor);
    expect(hit!.solo_textual).toBeFalsy();
    expect(hit!.score).toBeLessThan(ANCLA_SCORE_MIN);
  });

  test('un solo «Firma» en columna (el otro par ausente): sigue mandando la posición', () => {
    // Recorte que elimina la columna derecha: el único perfecto está en la
    // columna del emisor y dentro de la cota → bypass (comportamiento nuevo,
    // misma cota que el caso único con desplazamiento).
    const izq = linea('Firma', 0.9 * H, 245);
    const espEmisor: RectNorm = { x: 0.268, y: 0.622, w: 0.044, h: 0.01 };
    const hit = buscarAncla('Firma', [izq], W, H, espEmisor);
    expect(hit!.solo_textual).toBe(true);
  });
});

describe('parsearRango (regla nueva del contrato, FASE 3)', () => {
  test('acepta >= y <= entre identificadores', () => {
    expect(parsearRango('fecha_pago >= fecha_emision')).toEqual({
      izq: 'fecha_pago',
      op: '>=',
      der: 'fecha_emision',
    });
    expect(parsearRango('a  <=  b')!.op).toBe('<=');
  });

  test('rechaza cualquier otro operador o forma (sin eval de expresiones)', () => {
    for (const mal of ['a == b', 'a > b', 'a < b', 'a >= b >= c', '1 >= b', 'a>=', '']) {
      expect(parsearRango(mal)).toBeNull();
    }
  });
});

describe('parsearFechaTexto (FASE 3)', () => {
  const utc = (a: number, m: number, d: number) => Date.UTC(a, m - 1, d);

  test('dd/mm/aaaa es europeo, no invertido', () => {
    expect(parsearFechaTexto('05/12/2026')).toBe(utc(2026, 12, 5));
  });

  test('ISO, separadores . y -, año de 2 dígitos y nombre de mes', () => {
    expect(parsearFechaTexto('2026-12-05')).toBe(utc(2026, 12, 5));
    expect(parsearFechaTexto('05.12.2026')).toBe(utc(2026, 12, 5));
    expect(parsearFechaTexto('05-12-26')).toBe(utc(2026, 12, 5));
    expect(parsearFechaTexto('24 de noviembre de 2026')).toBe(utc(2026, 11, 24));
    expect(parsearFechaTexto('10 setiembre 2026')).toBe(utc(2026, 9, 10));
  });

  test('fechas imposibles o fuera de rango no producen veredicto inventado', () => {
    expect(parsearFechaTexto('31/02/2026')).toBeNull();
    expect(parsearFechaTexto('00/13/2026')).toBeNull();
    expect(parsearFechaTexto('05/12/1899')).toBeNull();
    expect(parsearFechaTexto('')).toBeNull();
    expect(parsearFechaTexto('sin fecha')).toBeNull();
    expect(parsearFechaTexto(null as unknown as string)).toBeNull();
  });
});

describe('textoEnRect (FASE 1a: mapa OCR global)', () => {
  const lineas = [
    linea('RECIBO DE PAGO', 0.1 * H),
    linea('Pago del 50', 0.55 * H),
    linea('porcentaje restante', 0.58 * H),
    linea('PIE DE PAGINA', 0.95 * H),
  ];

  test('reúne solo las palabras dentro del rect, en orden de lectura', () => {
    const r = textoEnRect(lineas, { x: 0, y: 0.5, w: 1, h: 0.12 }, W, H);
    expect(r.texto).toBe('Pago del 50 porcentaje restante');
    expect(r.palabras).toBe(5);
  });

  test('rect vacío: sin texto y sin confianza (no un 0 fingido)', () => {
    const r = textoEnRect(lineas, { x: 0, y: 0.3, w: 1, h: 0.05 }, W, H);
    expect(r).toEqual({ texto: '', conf: null, palabras: 0 });
  });

  test('conf es la media de las palabras (documentado: cambió la magnitud)', () => {
    const mix = [
      {
        texto: 'a b',
        bbox: [100, 100, 280, 124] as [number, number, number, number],
        palabras: [
          { texto: 'a', conf: 0.9, bbox: [100, 100, 190, 124] as [number, number, number, number] },
          { texto: 'b', conf: 0.7, bbox: [190, 100, 280, 124] as [number, number, number, number] },
        ],
      },
    ];
    const r = textoEnRect(mix, { x: 0, y: 0.05, w: 1, h: 0.1 }, W, H);
    expect(r.texto).toBe('a b');
    expect(r.conf).toBeCloseTo(0.8, 6);
  });

  test('no fusiona dos líneas físicas separadas más de la tolerancia', () => {
    const r = textoEnRect([linea('uno', 0.5 * H), linea('dos', 0.7 * H)], { x: 0, y: 0.45, w: 1, h: 0.35 }, W, H);
    expect(r.palabras).toBe(2);
    expect(r.texto).toBe('uno dos');
  });
});

describe('endurecerFallbackNoVerificado (FASE 1b)', () => {
  const campo = (obligatorio: boolean, tipo = 'texto'): CampoUniversal =>
    ({ id: 'x', etiqueta: 'X', tipo, pagina: 1, obligatorio } as CampoUniversal);
  const resultado = (p: Partial<ResultadoCampoUniversal>): ResultadoCampoUniversal =>
    ({
      id: 'x',
      etiqueta: 'X',
      tipo: 'texto',
      pagina: 1,
      estado: 'ok',
      valor: 'texto reconocido con longitud suficiente',
      conf: 0.95,
      rect: null,
      crop: null,
      crop_dims: null,
      fuente: 'referencia',
      banderas: ['ancla_no_encontrada'],
      ...p,
    }) as ResultadoCampoUniversal;

  test('obligatorio sin posición verificada jamás queda ok', () => {
    const r = resultado({});
    endurecerFallbackNoVerificado(campo(true), r);
    expect(r.estado).toBe('requiere_revision');
    expect(r.banderas).toContain('fallback_no_verificado');
  });

  test('opcional sin posición verificada pasa a no_encontrado (el bug de importe_texto)', () => {
    // Medido en corrida real: `importe_texto` = "o", conf 0.14, ocr_vacio +
    // zona_vacia terminaba 'ok' y sumaba 8.3 al score.
    const r = resultado({ valor: 'o', conf: 0.14, banderas: ['ancla_no_encontrada', 'ocr_vacio', 'zona_vacia'] });
    endurecerFallbackNoVerificado(campo(false), r);
    expect(r.estado).toBe('no_encontrado');
  });

  test('lectura degenerada sin ancla perdida también se demuele', () => {
    const r = resultado({ valor: 'o', conf: 0.1, banderas: ['ocr_vacio'] });
    endurecerFallbackNoVerificado(campo(false), r);
    expect(r.estado).toBe('no_encontrado');
    expect(r.banderas).toContain('lectura_degenerada');
  });

  test('lectura corta pero anclada NO se toca (no es ruido de fallback)', () => {
    const r = resultado({ fuente: 'ancla', banderas: [], valor: 'SI' });
    endurecerFallbackNoVerificado(campo(false), r);
    expect(r.estado).toBe('ok');
  });

  test('FIRMA anclada solo por texto nunca queda ok (el falso positivo del diagnóstico)', () => {
    // Medido en corrida real tras el bypass: firma_emisor/firma_pagador 'ok'
    // conf 0.97, valor "true", fuente 'ancla' y `forma_sin_caja`. Su veredicto
    // es geometría; sin caja no hay firma.
    const firma = campo(true, 'firma');
    const r = resultado({
      tipo: 'firma',
      fuente: 'ancla',
      valor: 'true',
      conf: 0.97,
      banderas: ['ancla_solo_textual', 'forma_borrosa', 'forma_sin_caja'],
    });
    endurecerFallbackNoVerificado(firma, r);
    expect(r.estado).toBe('requiere_revision');
    expect(r.banderas).toContain('ancla_sin_geometria');
  });

  test('FIRMA con ancla geométrica sí se respeta', () => {
    const r = resultado({
      tipo: 'firma',
      fuente: 'ancla',
      valor: 'true',
      conf: 0.97,
      banderas: [],
    });
    endurecerFallbackNoVerificado(campo(true, 'firma'), r);
    expect(r.estado).toBe('ok');
  });
});

describe('resolverRectCampo — ancla_rect para el overlay (aditivo)', () => {
  const campo: CampoUniversal = {
    id: 'fecha',
    etiqueta: 'Fecha',
    pagina: 1,
    tipo: 'texto',
    estrategia: 'ancla_relativa',
    zona: { x: 0.2, y: 0.02, w: 0.2, h: 0.02 },
    ancla: { texto: 'Fecha:', rect: { x: 0.1, y: 0.5, w: 0.1, h: 0.02 } },
  };
  test('ancla encontrada → ancla_rect = rect del hit (normalizado)', () => {
    // El hit vive en cy = 0.5·H → su bbox normalizado y ≈ 0.5 (no la referencia).
    const r = resolverRectCampo(campo, [linea('Fecha:', 0.5 * H)], W, H);
    expect(r?.fuente).toBe('ancla');
    expect(r?.ancla_rect).toBeDefined();
    expect(r!.ancla_rect!.y).toBeCloseTo(0.5 - 12 / H, 2);
    expect(r!.ancla_rect!.x).toBeCloseTo(100 / W, 3);
  });
  test('referencia (ancla no encontrada) → sin ancla_rect', () => {
    const sinHit = resolverRectCampo(campo, [linea('Otra cosa', 0.9 * H)], W, H);
    expect(sinHit?.fuente).toBe('referencia');
    expect(sinHit?.ancla_encontrada).toBe(false);
    expect(sinHit?.ancla_rect).toBeUndefined();
  });

  test('firmas «Firma» duplicadas en documento recortado → rect al pie, no a la referencia', () => {
    // Geometría REAL del molde recibo_pago v1.4.0 (zona relativa al ancla
    // «Firma»). Antes: dy≈0.27 anulaba ambos matches → fallback y=0.548 (las
    // palabras del overlay aparecían a media página). Ahora la columna
    // desambigua y el rect cae sobre la rúbrica real (y≈0.82).
    const firma = (zonaX: number, anclaX: number): CampoUniversal => ({
      id: 'firma_emisor',
      etiqueta: 'Firma emisor (receptor)',
      pagina: 1,
      tipo: 'firma',
      estrategia: 'ancla_relativa',
      zona: { x: zonaX, y: -0.074, w: 0.34, h: 0.06 },
      ancla: { texto: 'Firma', rect: { x: anclaX, y: 0.622, w: 0.044, h: 0.01 } },
    });
    const lineas = [linea('Firma', 0.9 * H, 245), linea('Firma', 0.9 * H, 666)];
    const r = resolverRectCampo(firma(-0.168, 0.268), lineas, W, H);
    expect(r?.fuente).toBe('ancla');
    expect(r?.ancla_solo_textual).toBe(true);
    expect(r!.rect.y).toBeCloseTo(0.9 - 12 / H - 0.074, 3);
    expect(r!.rect.y).toBeGreaterThan(0.8);
    expect(r!.ancla_rect!.x).toBeCloseTo(245 / W, 6);
  });
});
