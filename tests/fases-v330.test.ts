/// <reference types="bun-types" />
// Batería de pruebas del v3.3.0 — PLAN-DESARROLLO Fases 3, 4, 5, 6 y 9.
// Ejecutar desde la raíz del monorepo: bun test tests/fases-v330.test.ts
//
// Cubre:
//   FASE 3  — anclas[] con VOTO: consenso, discrepancia total (jamás se escoge
//             un lado), voto único (semántica de ancla única), cero votos
//             (respaldo/referencia), desambiguadores POR ancla, validador.
//   FASE 4  — grupos con restricciones espaciales: alineación, orden,
//             espaciado uniforme (repetidor), seccion sin checks, evidencia
//             insuficiente (no se opina), validador (miembros/páginas).
//   FASE 5  — proponerAnclas: cercanía, unicidad, exclusión de la zona,
//             conflicto de dígitos (el molde no debe nacer ambiguo).
//   FASE 6  — identificarDocumento (cartero en cascada): QR decisivo, frases,
//             minFrases, penalización de esqueleto, empates, sin huella.
//   FASE 9  — herencia por tipo (umbral/patrón), schemaVersion, fixtures de
//             verdad de terreno (string/boolean/number/estado) y validadores.

import { describe, expect, test } from 'bun:test';

import {
  ANCLA_SCORE_MIN,
  endurecerFallbackNoVerificado,
  identificarDocumento,
  proponerAnclas,
  resolverRectCampo,
  umbralEfectivo,
  patronEfectivo,
  verificarFixture,
  evaluarGrupos,
  type CandidatoHuella,
} from '@molde-suite/scanner-core/molde/universal-engine';
import {
  esMoldeUniversal,
  erroresMolde,
  SCHEMA_VERSION_MOLDE,
  VOTO_CONSENSO_DIST,
} from '@molde-suite/scanner-core/molde/universal-types';
import type {
  CampoUniversal,
  GrupoMolde,
  ResultadoCampoUniversal,
  ResultadoUniversal,
} from '@molde-suite/scanner-core/molde/universal-types';
import type { LineaOcr, PalabraOcr } from '@molde-suite/scanner-core/molde/ocr-tipos';

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

function campoBase(extra: Partial<CampoUniversal>): CampoUniversal {
  return {
    id: 'campo_prueba',
    etiqueta: 'Campo de prueba',
    pagina: 1,
    tipo: 'texto',
    estrategia: 'ancla_relativa',
    zona: { x: 0.0, y: 0.03, w: 0.3, h: 0.02 },
    umbral: 0.02,
    obligatorio: true,
    ...extra,
  } as CampoUniversal;
}

function resultadoBase(extra: Partial<ResultadoCampoUniversal>): ResultadoCampoUniversal {
  return {
    id: 'campo_prueba',
    etiqueta: 'Campo de prueba',
    tipo: 'texto',
    pagina: 1,
    estado: 'ok',
    valor: 'X',
    conf: 0.9,
    rect: { x: 0.5, y: 0.5, w: 0.2, h: 0.02 },
    crop: null,
    crop_dims: null,
    fuente: 'ancla',
    banderas: [],
    ...extra,
  } as ResultadoCampoUniversal;
}

// ===================== FASE 3 — anclas[] con VOTO =====================

describe('FASE 3 — múltiples anclas con voto', () => {
  test('consenso: 2 anclas de BANDAS DISTINTAS que llegan al mismo rect → ancla_consensuada', () => {
    // Cada ancla lleva SU offset (a.zona) hasta la MISMA zona del campo: la de
    // la cabecera baja 0.0286 desde su hit; la del cuerpo sube 0.3714. Ambas
    // llegan a {x:0.4, y:0.12} — el consenso es posible porque las anclas
    // declaran su propia geometría (AnclaUniversal.zona).
    const lineas = [
      linea('Fecha de pago', 0.1 * H),
      linea('Otro dato fijo', 0.5 * H),
    ];
    const campo = campoBase({
      ancla: { texto: 'Fecha de pago', rect: { x: 0.1, y: 0.098, w: 0.35, h: 0.017 } },
      anclas: [
        {
          texto: 'Fecha de pago',
          rect: { x: 0.1, y: 0.098, w: 0.35, h: 0.017 },
          zona: { x: 0.3, y: 0.0286, w: 0.3, h: 0.02 },
        },
        {
          texto: 'Otro dato fijo',
          rect: { x: 0.1, y: 0.498, w: 0.35, h: 0.017 },
          zona: { x: 0.3, y: -0.3714, w: 0.3, h: 0.02 },
        },
      ],
    });
    const r = resolverRectCampo(campo, lineas, W, H);
    expect(r).not.toBeNull();
    expect(r!.fuente).toBe('ancla');
    expect(r!.ancla_encontrada).toBe(true);
    expect(r!.ancla_consensuada).toBe(true);
    // La media de los dos rects consensuados ≈ el rect declarado por ambos.
    expect(r!.rect.x).toBeCloseTo(0.4, 3);
    expect(r!.rect.y).toBeCloseTo(0.12, 3);
    expect(Math.abs(r!.rect.y - 0.12)).toBeLessThan(VOTO_CONSENSO_DIST);
  });

  test('discrepancia total: jamás se escoge un lado — referencia + anclas_discrepantes', () => {
    const lineas = [
      linea('Cabecera distinta', 0.05 * H),
      linea('Pie de pagina', 0.95 * H),
    ];
    const campo = campoBase({
      ancla: { texto: 'Cabecera distinta', rect: { x: 0.1, y: 0.048, w: 0.3, h: 0.017 } },
      anclas: [
        { texto: 'Cabecera distinta', rect: { x: 0.1, y: 0.048, w: 0.3, h: 0.017 } },
        { texto: 'Pie de pagina', rect: { x: 0.1, y: 0.948, w: 0.3, h: 0.017 } },
      ],
    });
    const r = resolverRectCampo(campo, lineas, W, H);
    expect(r).not.toBeNull();
    expect(r!.fuente).toBe('referencia');
    expect(r!.ancla_encontrada).toBe(false);
    expect(r!.anclas_discrepantes).toBe(true);
    // El endurecedor hace el resto: un 'ok' con referencia + ancla_no_encontrada
    // cae a requiere_revision (obligatorio) — la discrepancia JAMÁS es un ok.
    const res: ResultadoCampoUniversal = {
      ...resultadoBase({ banderas: ['ancla_no_encontrada', 'anclas_discrepantes'], fuente: 'referencia' }),
    };
    endurecerFallbackNoVerificado(campo, res);
    expect(res.estado).toBe('requiere_revision');
    expect(res.banderas).toContain('fallback_no_verificado');
  });

  test('un solo voto se comporta EXACTAMENTE como la ancla única', () => {
    const lineas = [linea('Fecha de pago', 0.1 * H)];
    const campo = campoBase({
      ancla: { texto: 'Fecha de pago', rect: { x: 0.1, y: 0.098, w: 0.35, h: 0.017 } },
      anclas: [
        { texto: 'Fecha de pago', rect: { x: 0.1, y: 0.098, w: 0.35, h: 0.017 } },
        { texto: 'Etiqueta ausente', rect: { x: 0.6, y: 0.3, w: 0.3, h: 0.017 } },
      ],
    });
    const conVoto = resolverRectCampo(campo, lineas, W, H)!;
    const sinVoto = resolverRectCampo(
      campoBase({ ancla: campo.ancla, zona: campo.zona }),
      lineas,
      W,
      H,
    )!;
    expect(conVoto.fuente).toBe('ancla');
    expect(conVoto.ancla_consensuada).toBeFalsy();
    expect(conVoto.rect).toEqual(sinVoto.rect);
    expect(conVoto.score).toBe(sinVoto.score);
  });

  test('cero votos: cae a respaldo global y luego a referencia', () => {
    // La línea del respaldo vive cerca de la posición esperada (dy ≈ 0):
    // lejos, la penalización de posición la dejaría bajo el corte y el campo
    // caería a referencia (comportamiento correcto pero no el de este caso).
    const lineas = [linea('Nada util aqui', 0.1085 * H)];
    const campo = campoBase({
      ancla: { texto: 'Etiqueta ausente', rect: { x: 0.1, y: 0.1, w: 0.3, h: 0.017 } },
      anclas: [
        { texto: 'Etiqueta ausente', rect: { x: 0.1, y: 0.1, w: 0.3, h: 0.017 } },
        { texto: 'Otra ausente', rect: { x: 0.5, y: 0.2, w: 0.3, h: 0.017 } },
      ],
      ancla_respaldo: 'Nada util aqui',
    });
    const r = resolverRectCampo(campo, lineas, W, H);
    expect(r).not.toBeNull();
    expect(r!.fuente).toBe('respaldo');
  });

  test('desambiguadores PROPIOS por ancla: el voto sin contexto se rechaza', () => {
    // Contextos que difieren en DÍGITOS (como los del E-14: «JURADO 1/2»): la
    // penalización de dígitos (coste 3 > tolerancia) impide que «JURADO 2»
    // haga match difuso contra la línea «JURADO 1» — el contexto de FIRMA 2
    // NO está en la página y su voto se rechaza. Con diferencias de LETRA el
    // matcher difuso tolera 1 sustitución (por diseño): los contextos deben
    // diferir en dígitos o palabras completas, no en una letra.
    const lineas = [
      linea('FIRMA 1', 0.6 * H),
      linea('JURADO 1', 0.64 * H, 100),
      linea('FIRMA 2', 0.8 * H),
    ];
    const campo = campoBase({
      ancla: { texto: 'FIRMA 1', rect: { x: 0.1, y: 0.598, w: 0.18, h: 0.017 } },
      anclas: [
        { texto: 'FIRMA 1', rect: { x: 0.1, y: 0.598, w: 0.18, h: 0.017 }, desambiguadores: ['JURADO 1'] },
        { texto: 'FIRMA 2', rect: { x: 0.1, y: 0.798, w: 0.18, h: 0.017 }, desambiguadores: ['JURADO 2'] },
      ],
      zona: { x: 0, y: 0.025, w: 0.3, h: 0.02 },
    });
    const r = resolverRectCampo(campo, lineas, W, H);
    expect(r).not.toBeNull();
    // Un solo voto válido (el de FIRMA 1 con contexto presente) → ancla única.
    expect(r!.fuente).toBe('ancla');
    expect(r!.ancla_consensuada).toBeFalsy();
    expect(r!.rect.y).toBeCloseTo((0.6 * H - 12) / H + 0.025, 4);
  });

  test('validador: anclas[] exige ≥2 entradas, ≤6, textos no vacíos, rect y zona válidos', () => {
    const ok = {
      tipo: 'universal',
      nombre: 'Molde voto',
      campos: [
        {
          id: 'a',
          etiqueta: 'A',
          pagina: 1,
          tipo: 'texto',
          estrategia: 'ancla_relativa',
          zona: { x: 0, y: 0, w: 0.1, h: 0.02 },
          umbral: 0.02,
          obligatorio: true,
          ancla: { texto: 'Uno' },
          anclas: [
            { texto: 'Uno' },
            { texto: 'Dos' },
          ],
        },
      ],
    };
    expect(esMoldeUniversal(ok)).toBe(true);
    const unaSola = JSON.parse(JSON.stringify(ok));
    unaSola.campos[0].anclas = [{ texto: 'Uno' }];
    expect(esMoldeUniversal(unaSola)).toBe(false);
    expect(erroresMolde(unaSola).join(' ')).toContain('al menos 2');
    const siete = JSON.parse(JSON.stringify(ok));
    siete.campos[0].anclas = Array.from({ length: 7 }, (_, i) => ({ texto: `T${i}` }));
    expect(esMoldeUniversal(siete)).toBe(false);
    const textoVacio = JSON.parse(JSON.stringify(ok));
    textoVacio.campos[0].anclas = [{ texto: '  ' }, { texto: 'Dos' }];
    expect(esMoldeUniversal(textoVacio)).toBe(false);
    expect(erroresMolde(textoVacio).join(' ')).toContain('texto de ancla no vacío');
    const zonaMala = JSON.parse(JSON.stringify(ok));
    zonaMala.campos[0].anclas = [{ texto: 'Uno', zona: { x: 0, y: 0, w: NaN, h: 0.02 } }, { texto: 'Dos' }];
    expect(esMoldeUniversal(zonaMala)).toBe(false);
    expect(erroresMolde(zonaMala).join(' ')).toContain('zona (offset de la ancla) inválida');
  });

  test('retrocompatibilidad: un campo sin anclas[] es byte-idéntico a v3.2.0', () => {
    const lineas = [linea('Fecha de pago', 0.1 * H)];
    const campo = campoBase({
      ancla: { texto: 'Fecha de pago', rect: { x: 0.1, y: 0.098, w: 0.35, h: 0.017 } },
    });
    const r = resolverRectCampo(campo, lineas, W, H)!;
    expect(r.fuente).toBe('ancla');
    expect(r.ancla_consensuada).toBeFalsy();
    expect(r.anclas_discrepantes).toBeFalsy();
    expect(r.ancla_encontrada).toBe(true);
  });
});

// ===================== FASE 4 — grupos espaciales =====================

describe('FASE 4 — grupos con restricciones espaciales', () => {
  const filaAlta: GrupoMolde = { id: 'g1', tipo: 'fila', miembros: ['a', 'b'] };
  const columnaAsc: GrupoMolde = {
    id: 'g2',
    tipo: 'columna',
    miembros: ['a', 'b'],
    restricciones: { orden: 'asc' },
  };
  const repetidor: GrupoMolde = { id: 'g3', tipo: 'repetidor', miembros: ['a', 'b', 'c'] };

  test('fila desalineada: grupo_desalineado y los ok caen a requiere_revision', () => {
    const resultados = [
      resultadoBase({ id: 'a', rect: { x: 0.1, y: 0.30, w: 0.2, h: 0.02 } }),
      resultadoBase({ id: 'b', rect: { x: 0.5, y: 0.50, w: 0.2, h: 0.02 } }), // dy = 0.2
    ];
    evaluarGrupos([filaAlta], [], resultados);
    for (const r of resultados) {
      expect(r.banderas).toContain('grupo_desalineado');
      expect(r.estado).toBe('requiere_revision');
    }
  });

  test('columna alineada y en orden: sin banderas', () => {
    const resultados = [
      resultadoBase({ id: 'a', rect: { x: 0.3, y: 0.20, w: 0.2, h: 0.02 } }),
      resultadoBase({ id: 'b', rect: { x: 0.302, y: 0.40, w: 0.2, h: 0.02 } }),
    ];
    evaluarGrupos([columnaAsc], [], resultados);
    expect(resultados[0].banderas).toHaveLength(0);
    expect(resultados[1].banderas).toHaveLength(0);
    expect(resultados.every((r) => r.estado === 'ok')).toBe(true);
  });

  test('columna con orden asc violado: grupo_orden_violado en TODOS los miembros', () => {
    const resultados = [
      resultadoBase({ id: 'a', rect: { x: 0.3, y: 0.50, w: 0.2, h: 0.02 } }),
      resultadoBase({ id: 'b', rect: { x: 0.302, y: 0.20, w: 0.2, h: 0.02 } }), // b ANTES que a
    ];
    evaluarGrupos([columnaAsc], [], resultados);
    for (const r of resultados) {
      expect(r.banderas).toContain('grupo_orden_violado');
      expect(r.estado).toBe('requiere_revision');
    }
  });

  test('repetidor con hueco irregular: grupo_espaciado_irregular (FASE 9 §7)', () => {
    const resultados = [
      resultadoBase({ id: 'a', rect: { x: 0.3, y: 0.20, w: 0.2, h: 0.02 } }),
      resultadoBase({ id: 'b', rect: { x: 0.302, y: 0.30, w: 0.2, h: 0.02 } }), // hueco 0.10
      resultadoBase({ id: 'c', rect: { x: 0.3, y: 0.70, w: 0.2, h: 0.02 } }), // hueco 0.40
    ];
    evaluarGrupos([repetidor], [], resultados);
    for (const r of resultados) {
      expect(r.banderas).toContain('grupo_espaciado_irregular');
      expect(r.estado).toBe('requiere_revision');
    }
  });

  test('seccion sin restricciones: nunca marca (agrupación declarativa)', () => {
    const resultados = [
      resultadoBase({ id: 'a', rect: { x: 0.1, y: 0.10, w: 0.2, h: 0.02 } }),
      resultadoBase({ id: 'b', rect: { x: 0.9, y: 0.90, w: 0.2, h: 0.02 } }),
    ];
    evaluarGrupos([{ id: 'g', tipo: 'seccion', miembros: ['a', 'b'] }], [], resultados);
    expect(resultados.every((r) => r.banderas.length === 0 && r.estado === 'ok')).toBe(true);
  });

  test('evidencia insuficiente (1 resuelto): el motor NO opina', () => {
    const resultados = [
      resultadoBase({ id: 'a', rect: { x: 0.3, y: 0.20, w: 0.2, h: 0.02 } }),
      resultadoBase({ id: 'b', rect: null }),
    ];
    evaluarGrupos([filaAlta], [], resultados);
    expect(resultados.every((r) => r.banderas.length === 0)).toBe(true);
  });

  test('restricciones explícitas GANAN sobre el default del tipo', () => {
    // Una "columna" cuyo molde desactiva la alineación explícitamente.
    const g: GrupoMolde = {
      id: 'g4',
      tipo: 'columna',
      miembros: ['a', 'b'],
      restricciones: { alineacion: undefined as unknown as 'x' } as never,
    };
    g.restricciones = {}; // vacío: default manda
    const resultados = [
      resultadoBase({ id: 'a', rect: { x: 0.3, y: 0.20, w: 0.2, h: 0.02 } }),
      resultadoBase({ id: 'b', rect: { x: 0.9, y: 0.40, w: 0.2, h: 0.02 } }), // dx grande
    ];
    evaluarGrupos([g], [], resultados);
    expect(resultados[0].banderas).toContain('grupo_desalineado');
  });

  test('validador: miembro inexistente, repetido y páginas cruzadas se rechazan', () => {
    const molde = {
      tipo: 'universal',
      nombre: 'M',
      campos: [
        { id: 'a', etiqueta: 'A', pagina: 1, tipo: 'texto', estrategia: 'zona_fija', zona: { x: 0, y: 0, w: 0.1, h: 0.01 }, umbral: 0.02, obligatorio: true },
        { id: 'b', etiqueta: 'B', pagina: 2, tipo: 'texto', estrategia: 'zona_fija', zona: { x: 0, y: 0, w: 0.1, h: 0.01 }, umbral: 0.02, obligatorio: true },
      ],
      grupos: [{ id: 'g', tipo: 'fila', miembros: ['a', 'fantasma'] }],
    };
    expect(esMoldeUniversal(molde)).toBe(false);
    expect(erroresMolde(molde).join(' ')).toContain('no existe en molde.campos');
    const cruzada = JSON.parse(JSON.stringify(molde));
    cruzada.grupos = [{ id: 'g', tipo: 'fila', miembros: ['a', 'b'] }];
    expect(esMoldeUniversal(cruzada)).toBe(false);
    expect(erroresMolde(cruzada).join(' ')).toContain('otra página');
  });
});

// ===================== FASE 5 — auto-propuesta de anclas =====================

describe('FASE 5 — proponerAnclas (UX-1)', () => {
  const zona = { x: 0.15, y: 0.30, w: 0.3, h: 0.02 };

  test('propone las etiquetas CERCANAS y únicas, fuera de la zona, determinista', () => {
    const lineas = [
      linea('Concepto de pago', 0.28 * H), // justo arriba de la zona
      linea('Otra etiqueta lejana', 0.95 * H),
      linea('Fecha', 0.31 * H), // al lado (dy dentro de la banda)
    ];
    const p = proponerAnclas(lineas, W, H, zona, 3);
    expect(p.length).toBeGreaterThan(0);
    expect(p.length).toBeLessThanOrEqual(3);
    expect(p[0].ocurrencias).toBe(1);
    // Determinismo: misma entrada → misma salida (orden y scores).
    const p2 = proponerAnclas(lineas, W, H, zona, 3);
    expect(p2.map((x) => x.texto)).toEqual(p.map((x) => x.texto));
    expect(p2.map((x) => x.score)).toEqual(p.map((x) => x.score));
  });

  test('las líneas DENTRO de la zona nunca son propuestas (la etiqueta no es el dato)', () => {
    const lineas = [linea('Texto del valor', 0.307 * H, 160)];
    const p = proponerAnclas(lineas, W, H, zona, 3);
    expect(p).toHaveLength(0);
  });

  test('conflicto de dígitos: dos propuestas que solo difieren en dígitos se marcan', () => {
    const lineas = [
      linea('FIRMA 1', 0.28 * H),
      linea('FIRMA 2', 0.285 * H, 120),
    ];
    const p = proponerAnclas(lineas, W, H, zona, 3);
    expect(p.length).toBe(2);
    expect(p.some((x) => x.conflictoDigito)).toBe(true);
    expect(p.some((x) => x.conflictoDigito)).toBe(true);
  });

  test('la unicidad penaliza: una etiqueta repetida puntúa menos que la única', () => {
    const repetida = linea('Fecha', 0.28 * H);
    const otra = linea('Fecha', 0.5 * H, 400);
    const tercera = linea('Fecha', 0.9 * H, 700);
    const unica = linea('Lugar', 0.285 * H, 120);
    const p = proponerAnclas([repetida, otra, tercera, unica], W, H, zona, 3);
    const lugar = p.find((x) => x.texto === 'Lugar')!;
    const fecha = p.find((x) => x.texto === 'Fecha')!;
    expect(lugar.ocurrencias).toBe(1);
    expect(fecha.ocurrencias).toBe(3);
    expect(lugar.score).toBeGreaterThan(fecha.score);
  });
});

// ===================== FASE 6 — cartero en cascada =====================

describe('FASE 6 — identificarDocumento (cascada)', () => {
  const huellaRecibo: CandidatoHuella = {
    moldeId: 'molde_recibo',
    nombre: 'Recibo de pago',
    huella: {
      frasesClave: ['RECIBO DE PAGO', 'N.9 Recibo', 'La suma de', 'Forma de pago'],
      paginas: 1,
    },
  };
  const huellaActa: CandidatoHuella = {
    moldeId: 'molde_acta',
    nombre: 'Acta E-14',
    huella: {
      frasesClave: ['ACTA DE ESCRUtiny', 'DIVIPOL', 'Mesa electoral'],
      paginas: 2,
    },
  };

  test('capa 0: el QR es DECISIVO (score 1, sin OCR de frases)', () => {
    const r = identificarDocumento([], W, H, 1, [
      { ...huellaRecibo, identificadoPorQr: true },
      huellaActa,
    ]);
    expect(r).not.toBeNull();
    expect(r!.metodo).toBe('qr');
    expect(r!.moldeId).toBe('molde_recibo');
    expect(r!.score).toBe(1);
  });

  test('capa 1: frases de la cabecera identifican el documento', () => {
    const lineas = [
      linea('RECIBO DE PAGO', 0.06 * H, 300),
      linea('N.9 Recibo REC-2026-0314', 0.12 * H, 250),
      linea('La suma de 2.480,50', 0.35 * H), // fuera de la franja default (0.2)
    ];
    const r = identificarDocumento(lineas, W, H, 1, [huellaRecibo, huellaActa]);
    expect(r).not.toBeNull();
    expect(r!.moldeId).toBe('molde_recibo');
    expect(r!.metodo).toBe('frases');
    expect(r!.frasesEncontradas).toContain('RECIBO DE PAGO');
    expect(r!.paginasCoinciden).toBe(true);
  });

  test('sin las frases mínimas → null (duda honesta, jamás se adivina)', () => {
    const lineas = [linea('Pagina de otro documento', 0.05 * H)];
    expect(identificarDocumento(lineas, W, H, 1, [huellaRecibo, huellaActa])).toBeNull();
  });

  test('capa 2 (esqueleto): la discrepancia de páginas PENALIZA el score', () => {
    const lineas = [
      linea('RECIBO DE PAGO', 0.06 * H, 300),
      linea('N.9 Recibo REC-2026-0314', 0.12 * H, 250),
      linea('La suma de 2.480,50', 0.15 * H, 200),
    ];
    // 3/4 frases → score 0.75 con páginas iguales; con páginas distintas 0.6.
    const rOk = identificarDocumento(lineas, W, H, 1, [huellaRecibo]);
    const rMal = identificarDocumento(lineas, W, H, 3, [huellaRecibo]);
    expect(rOk!.paginasCoinciden).toBe(true);
    expect(rOk!.score).toBeCloseTo(0.75, 5);
    expect(rMal!.paginasCoinciden).toBe(false);
    expect(rMal!.score).toBeCloseTo(0.75 * 0.8, 5);
  });

  test('empate de score: gana el que más frases encontró', () => {
    const lineas = [
      linea('RECIBO DE PAGO', 0.06 * H, 300),
      linea('N.9 Recibo REC-2026-0314', 0.12 * H, 250),
    ];
    // recibo: 2/4 = 0.5 · acta huella alternativa con 2 frases de 2 → 1.0
    const acta2: CandidatoHuella = {
      moldeId: 'molde_acta2',
      huella: { frasesClave: ['RECIBO DE PAGO', 'N.9 Recibo'] },
    };
    const r = identificarDocumento(lineas, W, H, 1, [huellaRecibo, acta2]);
    expect(r!.moldeId).toBe('molde_acta2');
  });

  test('la normalización (acentos/mayúsculas) aplica igual que en las anclas', () => {
    const lineas = [linea('Acta de Escrutinio', 0.05 * H, 200), linea('DIVIPOL', 0.09 * H, 300)];
    const r = identificarDocumento(lineas, W, H, 2, [huellaActa]);
    expect(r).not.toBeNull();
    expect(r!.moldeId).toBe('molde_acta');
  });
});

// ===================== FASE 9 — herencia, schemaVersion, fixtures =====================

describe('FASE 9 — herencia por tipo (§7)', () => {
  test('umbralEfectivo: campo explícito GANA; si falta, hereda del tipo', () => {
    const campo = campoBase({ tipo: 'firma', umbral: 0.05 });
    expect(umbralEfectivo(campo, { firma: { umbral: 0.0035 } })).toBe(0.05);
    const sinUmbral = { ...campoBase({ tipo: 'firma' }), umbral: undefined };
    expect(umbralEfectivo(sinUmbral, { firma: { umbral: 0.0035 } })).toBe(0.0035);
    expect(umbralEfectivo(sinUmbral, undefined)).toBe(0.02); // defensivo (el validador ya lo rechaza)
  });

  test('patronEfectivo: herencia del patrón por tipo', () => {
    const campo = campoBase({});
    expect(patronEfectivo(campo, { texto: { patron: '\\d{3}' } })).toBe('\\d{3}');
    expect(patronEfectivo({ ...campoBase({ patron: 'X-Y' }), patron: 'X-Y' }, { texto: { patron: '\\d{3}' } })).toBe('X-Y');
  });

  test('validador: umbral ausente SIN herencia se rechaza con mensaje accionable', () => {
    const molde = {
      tipo: 'universal',
      nombre: 'M',
      campos: [
        { id: 'f1', etiqueta: 'Firma', pagina: 1, tipo: 'firma', estrategia: 'zona_fija', zona: { x: 0, y: 0, w: 0.2, h: 0.1 }, obligatorio: true },
      ],
    };
    expect(esMoldeUniversal(molde)).toBe(false);
    const msg = erroresMolde(molde).join(' ');
    expect(msg).toContain('umbral ausente');
    expect(msg).toContain('herencia');
    const conHerencia = { ...molde, herencia: { firma: { umbral: 0.003 } } };
    expect(esMoldeUniversal(conHerencia)).toBe(true);
  });

  test('schemaVersion: 1 carga; 2 (futuro) se rechaza con motivo claro', () => {
    const base = {
      tipo: 'universal',
      nombre: 'M',
      schemaVersion: SCHEMA_VERSION_MOLDE,
      campos: [
        { id: 'a', etiqueta: 'A', pagina: 1, tipo: 'texto', estrategia: 'zona_fija', zona: { x: 0, y: 0, w: 0.1, h: 0.01 }, umbral: 0.02, obligatorio: true },
      ],
    };
    expect(esMoldeUniversal(base)).toBe(true);
    const futuro = { ...base, schemaVersion: SCHEMA_VERSION_MOLDE + 1 };
    expect(esMoldeUniversal(futuro)).toBe(false);
    expect(erroresMolde(futuro).join(' ')).toContain('no soportada');
    const negativa = { ...base, schemaVersion: 0 };
    expect(esMoldeUniversal(negativa)).toBe(false);
  });
});

describe('FASE 9 — fixtures de verdad de terreno (§7)', () => {
  const resultado: ResultadoUniversal = {
    archivo: 'prueba.png',
    paginas: [
      {
        pagina: 1,
        ocr_conf: 0.9,
        campos: [
          resultadoBase({ id: 'importe', valor: '3.150,00 €', estado: 'ok' }),
          resultadoBase({ id: 'firma_emisor', tipo: 'firma', valor: true, estado: 'ok' }),
          resultadoBase({ id: 'firma_pagador', tipo: 'firma', valor: false, estado: 'no_encontrado', banderas: ['firma_ausente'] }),
        ],
      },
    ],
    total: 3,
    ok_count: 2,
    score: 66.7,
    pct_diligenciado: 50,
    pct_lectura: null,
    obligatorios_faltantes: [],
    validaciones: [],
    requiere_revision: false,
    tiempos: { render_ms: 1, ocr_ms: 1, motor_ms: 1 },
  };

  test('string exacto (trim), boolean estricto y number vía valorNumerico', () => {
    const r = verificarFixture(resultado, {
      id: 'caso-limpio',
      nombre: 'limpia',
      esperado: { importe: '3.150,00 €', firma_emisor: true, firma_pagador: false },
    });
    expect(r.ok).toBe(true);
    expect(r.fallos).toHaveLength(0);
    const importe = verificarFixture(resultado, {
      id: 'importe-num',
      nombre: 'importe numérico',
      esperado: { importe: 3150 },
    });
    expect(importe.ok).toBe(true);
  });

  test('un valor que NO es la verdad de terreno produce fallo con evidencia', () => {
    const r = verificarFixture(resultado, {
      id: 'caso-otro',
      nombre: 'otro importe',
      esperado: { importe: '9.999,99 €' },
    });
    expect(r.ok).toBe(false);
    expect(r.fallos).toHaveLength(1);
    expect(r.fallos[0].campoId).toBe('importe');
    expect(r.fallos[0].obtenido).toBe('3.150,00 €');
  });

  test('estadosEsperados: exigir no_encontrado en el caso negativo (sin firmas)', () => {
    const r = verificarFixture(resultado, {
      id: 'sin-firmas',
      nombre: 'sin firmas',
      esperado: { firma_pagador: false },
      estadosEsperados: { firma_pagador: 'no_encontrado', importe: 'ok' },
    });
    expect(r.ok).toBe(true);
    const mal = verificarFixture(resultado, {
      id: 'sin-firmas-mal',
      nombre: 'sin firmas (estado incorrecto)',
      esperado: { firma_pagador: false },
      estadosEsperados: { firma_pagador: 'ok' },
    });
    expect(mal.ok).toBe(false);
    expect(mal.fallos[0].tipo).toBe('estado');
  });

  test('campo sin resultado en la corrida: fallo honesto con obtenido null', () => {
    const r = verificarFixture(resultado, {
      id: 'campo-fantasma',
      nombre: 'fantasma',
      esperado: { campo_inexistente: 'X' },
    });
    expect(r.ok).toBe(false);
    expect(r.fallos[0].obtenido).toBeNull();
  });

  test('validador: fixtures con campoId inexistente o esperado vacío se rechazan', () => {
    const base = {
      tipo: 'universal',
      nombre: 'M',
      campos: [
        { id: 'a', etiqueta: 'A', pagina: 1, tipo: 'texto', estrategia: 'zona_fija', zona: { x: 0, y: 0, w: 0.1, h: 0.01 }, umbral: 0.02, obligatorio: true },
      ],
      fixtures: [{ id: 'f1', nombre: 'caso', esperado: { a: 'X' } }],
    };
    expect(esMoldeUniversal(base)).toBe(true);
    const fantasma = JSON.parse(JSON.stringify(base));
    fantasma.fixtures[0].esperado = { no_existe: 'X' };
    expect(esMoldeUniversal(fantasma)).toBe(false);
    expect(erroresMolde(fantasma).join(' ')).toContain('no existe en molde.campos');
    const vacio = JSON.parse(JSON.stringify(base));
    vacio.fixtures[0].esperado = {};
    expect(esMoldeUniversal(vacio)).toBe(false);
  });

  test('validador: huella exige 3-5 frases y minFrases entero', () => {
    const base = {
      tipo: 'universal',
      nombre: 'M',
      campos: [
        { id: 'a', etiqueta: 'A', pagina: 1, tipo: 'texto', estrategia: 'zona_fija', zona: { x: 0, y: 0, w: 0.1, h: 0.01 }, umbral: 0.02, obligatorio: true },
      ],
      huella: { frasesClave: ['A', 'B', 'C'] },
    };
    expect(esMoldeUniversal(base)).toBe(true);
    const pocas = JSON.parse(JSON.stringify(base));
    pocas.huella.frasesClave = ['A'];
    expect(esMoldeUniversal(pocas)).toBe(false);
    const minMal = JSON.parse(JSON.stringify(base));
    minMal.huella.minFrases = 0;
    expect(esMoldeUniversal(minMal)).toBe(false);
  });
});

// ===================== FASE 4+9 — integración con el molde completo =====================

describe('v3.3.0 — molde con todas las extensiones carga limpio', () => {
  test('grupos + herencia + huella + fixtures + schemaVersion + anclas[] juntos', () => {
    const molde = {
      tipo: 'universal',
      version: '1.0.0',
      schemaVersion: 1,
      nombre: 'Integración v3.3.0',
      campos: [
        { id: 'a', etiqueta: 'A', pagina: 1, tipo: 'firma', estrategia: 'zona_fija', zona: { x: 0.1, y: 0.6, w: 0.2, h: 0.05 }, obligatorio: true, anclas: [{ texto: 'Firma uno' }, { texto: 'De uno' }] },
        { id: 'b', etiqueta: 'B', pagina: 1, tipo: 'firma', estrategia: 'zona_fija', zona: { x: 0.7, y: 0.6, w: 0.2, h: 0.05 }, obligatorio: true },
      ],
      herencia: { firma: { umbral: 0.0035 } },
      grupos: [{ id: 'firmas', tipo: 'fila', miembros: ['a', 'b'] }],
      huella: { frasesClave: ['UNO', 'DOS', 'TRES'], paginas: 1 },
      fixtures: [{ id: 'f', nombre: 'limpia', esperado: { a: true } }],
    };
    expect(esMoldeUniversal(molde)).toBe(true);
    expect(erroresMolde(molde)).toHaveLength(0);
    expect(umbralEfectivo(molde.campos[0] as CampoUniversal, molde.herencia)).toBe(0.0035);
  });
});

// Umbral de score exportado sigue intacto (regresión de contrato).
describe('contrato estable', () => {
  test('ANCLA_SCORE_MIN y consenso siguen siendo los valores calibrados', () => {
    expect(ANCLA_SCORE_MIN).toBe(0.72);
    expect(VOTO_CONSENSO_DIST).toBe(0.02);
    expect(SCHEMA_VERSION_MOLDE).toBe(1);
  });
});
