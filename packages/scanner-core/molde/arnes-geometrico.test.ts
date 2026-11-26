// Tests del plan de extracción relacional — FASES 5 y 6.
// Arnés geométrico (proyección afín desde ≥3 anclas fiables), votación 2/3
// en la adopción (geometría + patrón/confianza; nunca 'ok' con una señal) y
// conversión/reparación número↔letras con cruce verificable.

import { test, expect, describe } from 'bun:test';
import {
  ARNES_CONF_PROY_MIN,
  evaluarValidaciones,
  proyectarPorArnes,
  type CajaLayout,
} from './universal-engine';
import { letrasANumero, repararNumeroAmbiguo } from './letras-numero';
import type {
  CampoUniversal,
  MoldeUniversal,
  RectNorm,
  ResultadoCampoUniversal,
} from './universal-types';
import type { LineaOcr, PalabraOcr } from './ocr-tipos';

const W = 1000;
const H = 1400;

function linea(texto: string, cy: number, conf = 0.95, x0 = 100): LineaOcr {
  const pals = texto.split(' ');
  const palabras: PalabraOcr[] = pals.map((t, i) => ({
    texto: t,
    conf,
    bbox: [x0 + i * 90, cy - 12, x0 + (i + 1) * 90, cy + 12],
  }));
  return { texto, bbox: [x0, cy - 12, x0 + pals.length * 90, cy + 12], palabras };
}

/** Campo ancla_relativa cuya caja de referencia (rectEditor) es `ref`. */
function campoAncla(id: string, ref: RectNorm, extra: Partial<CampoUniversal> = {}): CampoUniversal {
  return {
    id,
    etiqueta: id,
    pagina: 1,
    tipo: 'texto',
    estrategia: 'ancla_relativa',
    zona: { x: 0, y: 0.04, w: ref.w, h: ref.h },
    ancla: { texto: `ANCLA ${id}`, rect: { x: ref.x, y: ref.y - 0.04, w: 0.2, h: 0.02 } },
    obligatorio: true,
    ...extra,
  } as CampoUniversal;
}

function resOk(id: string, rect: RectNorm): ResultadoCampoUniversal {
  return {
    id, etiqueta: id, tipo: 'texto', pagina: 1, estado: 'ok', valor: 'x', conf: 0.95,
    rect, crop: null, crop_dims: null, fuente: 'ancla', banderas: [],
  };
}

function resFallback(id: string, rect: RectNorm): ResultadoCampoUniversal {
  return {
    id, etiqueta: id, tipo: 'texto', pagina: 1, estado: 'requiere_revision', valor: null,
    conf: null, rect, crop: null, crop_dims: null, fuente: 'referencia',
    banderas: ['ancla_no_encontrada', 'fallback_no_verificado'],
  };
}

const traslacion = (r: RectNorm, dy: number): RectNorm => ({ ...r, y: r.y + dy });

describe('proyectarPorArnes — arnés geométrico (FASE 5)', () => {
  // x diverso entre votos: sin él los centros son colineales y el afín no
  // es identificable (el motor devuelve null y no proyecta — correcto).
  const ref1: RectNorm = { x: 0.05, y: 0.10, w: 0.4, h: 0.04 };
  const ref2: RectNorm = { x: 0.30, y: 0.24, w: 0.4, h: 0.04 };
  const ref3: RectNorm = { x: 0.05, y: 0.50, w: 0.4, h: 0.04 };
  const ref4: RectNorm = { x: 0.10, y: 0.32, w: 0.5, h: 0.04 };
  const DY = 0.2;

  const campos = [
    campoAncla('a1', ref1),
    campoAncla('a2', ref2),
    campoAncla('a3', ref3),
    campoAncla('t4', ref4),
  ];

  test('3 anclas fiables reubican el huérfano y su valor del mapa global', () => {
    const resultados = [
      resOk('a1', traslacion(ref1, DY)),
      resOk('a2', traslacion(ref2, DY)),
      resOk('a3', traslacion(ref3, DY)),
      resFallback('t4', ref4),
    ];
    // La posición REAL del valor de t4: centro (0.35, 0.34+DY).
    const cy = (0.34 + DY) * H;
    const out = proyectarPorArnes(campos, resultados, [linea('PAGO ACREEDOR', cy, 0.95, 200)], W, H);
    expect(out).not.toBeNull();
    expect(out!.anclas).toBe(3);
    expect(out!.confProyeccion).toBeGreaterThanOrEqual(ARNES_CONF_PROY_MIN);
    expect(out!.rescatados).toBe(1);
    const t4 = resultados[3];
    expect(t4.fuente).toBe('arnes');
    expect(t4.valor).toBe('PAGO ACREEDOR');
    expect(t4.estado).toBe('ok'); // votación 2/3: geometría + patrón/confianza
    expect(t4.banderas).toContain('ancla_inferida');
    expect(t4.banderas).not.toContain('fallback_no_verificado');
    expect(t4.banderas).toContain('ancla_no_encontrada'); // honesto: nunca apareció
  });

  test('con menos de 3 anclas NO toca nada', () => {
    const resultados = [
      resOk('a1', traslacion(ref1, DY)),
      resOk('a2', traslacion(ref2, DY)),
      resFallback('t4', ref4),
    ];
    const out = proyectarPorArnes(campos.slice(0, 4), resultados, [], W, H);
    expect(out).toBeNull();
    expect(resultados[2].fuente).toBe('referencia');
    expect(resultados[2].banderas).toContain('fallback_no_verificado');
  });

  test('anclas incoherentes (residual alto) → geometría no fiable, cero adopción', () => {
    const resultados = [
      resOk('a1', traslacion(ref1, DY)),
      resOk('a2', traslacion(ref2, DY)),
      resOk('a3', traslacion(ref3, -0.25)), // voto que contradice a los otros dos
      resFallback('t4', ref4),
    ];
    const cy = (0.34 + DY) * H;
    const out = proyectarPorArnes(campos, resultados, [linea('PAGO ACREEDOR', cy, 0.95, 200)], W, H);
    expect(out).not.toBeNull();
    expect(out!.confProyeccion).toBeLessThan(ARNES_CONF_PROY_MIN);
    expect(out!.rescatados).toBe(0);
    expect(resultados[3].fuente).toBe('referencia'); // jamás 'ok' por geometría dudosa
  });

  test('lectura con confianza insuficiente: fuente arnes pero requiere_revision (votación 2/3)', () => {
    const resultados = [
      resOk('a1', traslacion(ref1, DY)),
      resOk('a2', traslacion(ref2, DY)),
      resOk('a3', traslacion(ref3, DY)),
      resFallback('t4', ref4),
    ];
    const cy = (0.34 + DY) * H;
    proyectarPorArnes(campos, resultados, [linea('PAGO ACREEDOR', cy, 0.55, 200)], W, H);
    const t4 = resultados[3];
    expect(t4.fuente).toBe('arnes');
    expect(t4.valor).toBe('PAGO ACREEDOR');
    expect(t4.estado).toBe('requiere_revision');
    expect(t4.banderas).toContain('conf_baja');
  });

  test('lectura que no cumple el patrón → requiere_revision con patron_no_cumple', () => {
    const camposPatron = [
      campoAncla('a1', ref1),
      campoAncla('a2', ref2),
      campoAncla('a3', ref3),
      campoAncla('t4', ref4, { patron: '^\\d+([.,]\\d+)?$' }),
    ];
    const resultados = [
      resOk('a1', traslacion(ref1, DY)),
      resOk('a2', traslacion(ref2, DY)),
      resOk('a3', traslacion(ref3, DY)),
      resFallback('t4', ref4),
    ];
    const cy = (0.34 + DY) * H;
    proyectarPorArnes(camposPatron, resultados, [linea('PAGO ACREEDOR', cy, 0.95, 200)], W, H);
    expect(resultados[3].estado).toBe('requiere_revision');
    expect(resultados[3].banderas).toContain('patron_no_cumple');
  });

  test('dos firmas huérfanas con cajas seal reciben rects DISTINTOS (FASE 5c)', () => {
    const refF: RectNorm = { x: 0.15, y: 0.70, w: 0.3, h: 0.08 };
    const camposF = [
      campoAncla('a1', ref1),
      campoAncla('a2', ref2),
      campoAncla('a3', ref3),
      { ...campoAncla('f1', refF, { tipo: 'firma' }) },
      { ...campoAncla('f2', refF, { tipo: 'firma' }) },
    ];
    const rF = (id: string) => ({
      ...resFallback(id, refF),
      tipo: 'firma' as const,
    });
    const resultados = [
      resOk('a1', traslacion(ref1, DY)),
      resOk('a2', traslacion(ref2, DY)),
      resOk('a3', traslacion(ref3, DY)),
      rF('f1'),
      rF('f2'),
    ];
    const seal = (x: number, y: number): CajaLayout => ({
      clase: 'seal',
      rect: { x, y, w: 0.18, h: 0.09 },
      conf: 0.9,
    });
    // Centro proyectado de ambas: (0.30, 0.74+0.2=0.94) — sellanos cerca.
    const cajas: CajaLayout[] = [seal(0.05, 0.88), seal(0.45, 0.92)];
    const out = proyectarPorArnes(camposF, resultados, [], W, H, { cajasLayout: cajas });
    expect(out!.rescatados).toBe(2);
    expect(resultados[3].rect).not.toEqual(resultados[4].rect);
    expect(resultados[3].fuente).toBe('arnes');
    expect(resultados[4].fuente).toBe('arnes');
  });
});

describe('letrasANumero / repararNumeroAmbiguo (FASE 6b)', () => {
  test('conversión español', () => {
    expect(letrasANumero('ciento cincuenta mil')).toBe(150000);
    expect(letrasANumero('ciento cincuenta mil pesos')).toBe(150000);
    expect(letrasANumero('dos mil cuatrocientos ochenta')).toBe(2480);
    expect(letrasANumero('veinticinco')).toBe(25);
    expect(letrasANumero('un millón doscientos mil')).toBe(1200000);
    expect(letrasANumero('trescientos sesenta y cinco')).toBe(365);
    expect(letrasANumero('dos mil con cincuenta')).toBe(2000.5);
  });
  test('null cuando no es número completo — nunca inventa', () => {
    expect(letrasANumero('')).toBeNull();
    expect(letrasANumero('lo')).toBeNull();
    expect(letrasANumero('ciento cinco manzanas')).toBeNull();
    expect(letrasANumero('150000')).toBeNull();
  });
  test('reparación unívoca de glifos ambiguos', () => {
    const r = repararNumeroAmbiguo('15O.000');
    expect(r).not.toBeNull();
    expect(r!.texto).toBe('150.000');
    expect(r!.valor).toBe(150000);
    expect(repararNumeroAmbiguo('2.480,50')).toBeNull(); // ya limpio
    expect(repararNumeroAmbiguo('15X.000')).toBeNull();  // X sin dígito unívoco
    expect(repararNumeroAmbiguo('DEPAGO')).toBeNull();
  });
});

describe('cruce número↔letras en validaciones (FASE 6b)', () => {
  const moldeConCruce = (): MoldeUniversal =>
    ({
      version: '3.2.0',
      tipo_documento: 'recibo',
      campos: [
        campoAncla('importe', { x: 0.1, y: 0.3, w: 0.3, h: 0.04 }),
        campoAncla('importe_texto', { x: 0.1, y: 0.36, w: 0.6, h: 0.04 }),
      ],
      validaciones: [
        { id: 'c1', regla: 'igualdad', expresion: 'importe == importe_texto' },
      ],
    }) as unknown as MoldeUniversal;

  test('importe ambiguo reparado Y validado por las letras → ok con bandera', () => {
    const molde = moldeConCruce();
    const porId = new Map<string, ResultadoCampoUniversal>([
      ['importe', {
        id: 'importe', etiqueta: 'importe', tipo: 'texto', pagina: 1,
        estado: 'requiere_revision', valor: '15O.000', conf: 0.9, rect: null,
        crop: null, crop_dims: null, fuente: 'ancla',
        banderas: ['patron_no_cumple'],
      }],
      ['importe_texto', {
        id: 'importe_texto', etiqueta: 'importe texto', tipo: 'texto', pagina: 1,
        estado: 'ok', valor: 'ciento cincuenta mil pesos', conf: 0.95, rect: null,
        crop: null, crop_dims: null, fuente: 'ancla', banderas: [],
      }],
    ]);
    const res = evaluarValidaciones(molde, porId);
    expect(res).toHaveLength(1);
    expect(res[0].ok).toBe(true);
    const imp = porId.get('importe')!;
    expect(imp.valor).toBe('150.000');
    expect(imp.estado).toBe('ok');
    expect(imp.banderas).toContain('auto_reparado_numero');
    expect(imp.banderas).not.toContain('patron_no_cumple');
  });

  test('sin cruce verificable NO se repara (prohibido inventar)', () => {
    const molde = moldeConCruce();
    const porId = new Map<string, ResultadoCampoUniversal>([
      ['importe', {
        id: 'importe', etiqueta: 'importe', tipo: 'texto', pagina: 1,
        estado: 'requiere_revision', valor: '15O.000', conf: 0.9, rect: null,
        crop: null, crop_dims: null, fuente: 'ancla', banderas: [],
      }],
      ['importe_texto', {
        id: 'importe_texto', etiqueta: 'importe texto', tipo: 'texto', pagina: 1,
        estado: 'ok', valor: 'doscientos mil pesos', conf: 0.95, rect: null,
        crop: null, crop_dims: null, fuente: 'ancla', banderas: [],
      }],
    ]);
    const res = evaluarValidaciones(molde, porId);
    expect(res[0].ok).toBeNull(); // no evaluable: 15O.000 sigue sin parsear
    expect(porId.get('importe')!.valor).toBe('15O.000'); // intacto
    expect(porId.get('importe')!.banderas).not.toContain('auto_reparado_numero');
  });
});
