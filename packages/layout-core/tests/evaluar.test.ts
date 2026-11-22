// GOLDEN tests del evaluador (PLAN F2): fixtures GRABADOS de la corrida real
// en el celular (results-banco.jsonl) — NO se necesita el modelo ni DOM.
//
// Referencia del dossier (docs/investigacion/2026-11-22-pp-doclayout-en-navegador.md §5):
//   plus-L stock 0.5            → 12/19 (F1 0.750)
//   plus-L 0.4 + NMS            → 16/19 (F1 0.842)
//   plus-L + estructura E-14    → 19/19 (P = R = F1 = 1.0)
//   S 0.3 + NMS                 → 11/19 (F1 0.629)
//   S + estructura (pool 0.1)   → 8/19  (P 1.0, R 0.421)
//
// Corridas fuente: phone-mwrf3lq0 (plus-L pool 0.2 sin NMS de app),
// phone-mwrfakmk (plus-L 0.4 con NMS), phone-mwrgw19y (S, barrido).
// Página renderizada a 676×2048 px (pdf.js escala 2, lado máximo 2048).

import { describe, expect, test } from 'bun:test';
import { evaluarEstructura, conModelo } from '../src/evaluar';
import { metricas } from '../src/matcher';
import { normalizarClase } from '../src/clases';
import { nmsClaseAgnostico } from '../src/nms';
import type { CajaLayout } from '../src/tipos';
import type { ReglaLayout } from '@jg-stevan/scanner-core/molde/universal-types';

import gtJson from '../fixtures/e14-p1-gt.json';
import reglasJson from '../fixtures/e14-p1-reglas.json';
import plusLJson from '../fixtures/plusL-e14-p1.json';
import plusLNmsJson from '../fixtures/plusL-e14-p1-nms04.json';
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

const gt = (gtJson as { bloques: { type: string; x1: number; y1: number; x2: number; y2: number }[] }).bloques.map(
  (b) => ({ ...b, score: 1 }),
);

const cajas = (f: FixtureDets): CajaLayout[] =>
  f.dets.map((d) => ({ clase: normalizarClase(d.cls), score: d.score, x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2 }));

const reglas = (reglasJson as { reglas: ReglaLayout[] }).reglas;

describe('matcher contra GT de Chandra (E-14 p1, 19 bloques)', () => {
  test('plus-L stock 0.5 → 12/19 (F1 0.750)', () => {
    const dets = cajas(plusLJson as unknown as FixtureDets).filter((d) => d.score >= 0.5);
    const m = metricas(dets, gt);
    expect(m.gt).toBe(19);
    expect(m.tp).toBe(12);
    expect(m.preds).toBe(13);
    expect(m.F1).toBe(0.75);
  });

  test('plus-L 0.4 + NMS 0.5 → 16/19 (F1 0.842)', () => {
    const dets = cajas(plusLNmsJson as unknown as FixtureDets);
    const m = metricas(dets, gt);
    expect(m.gt).toBe(19);
    expect(m.tp).toBe(16);
    expect(m.preds).toBe(19);
    expect(m.F1).toBe(0.842);
  });
});

describe('evaluador estructural — golden 19/19', () => {
  test('plus-L pool 0.2 (73 cajas sin NMS de app) + reglas E-14 → 19/19, P=R=F1=1.0', () => {
    const dets = cajas(plusLJson as unknown as FixtureDets);
    expect(dets.length).toBe(73);
    const res = conModelo(evaluarEstructura(dets, reglas, W, H), 'plusL');
    const aceptadas = res.reglas.flatMap((r) => r.cajas);
    const m = metricas(aceptadas, gt);
    expect(m.tp).toBe(19);
    expect(m.preds).toBe(19);
    expect(m.P).toBe(1);
    expect(m.R).toBe(1);
    expect(m.F1).toBe(1);
    // Gate: todas las obligatorias ok.
    expect(res.ok).toBe(true);
    expect(res.obligatorias_faltantes).toEqual([]);
    // Post-proceso estructural ≤ 20 ms/página (umbral de aceptación del plan).
    expect(res.ms).toBeLessThan(20);
  });

  test('zonas y conteo esperado por regla (dossier §6)', () => {
    const res = conModelo(evaluarEstructura(cajas(plusLJson as unknown as FixtureDets), reglas, W, H), 'plusL');
    const porId = new Map(res.reglas.map((r) => [r.reglaId, r]));
    expect(porId.get('footer')?.cajas.length).toBe(3);
    expect(porId.get('title')?.cajas.length).toBe(3);
    expect(porId.get('candidatos')?.cajas.length).toBe(2);
    expect(porId.get('candidatos')?.partes?.length).toBe(2);
    expect(porId.get('nivelacion')?.estado).toBe('ok');
    expect(porId.get('votos')?.estado).toBe('ok');
    for (const r of res.reglas) expect(r.estado).toBe('ok');
  });
});

describe('evaluador estructural — punto de partida de F0 (S)', () => {
  test('S pool 0.2 + reglas E-14 actuales → 8/19 (P 1.0, R 0.421): el baseline del spike', () => {
    const dets = cajas(sJson as unknown as FixtureDets);
    const res = conModelo(evaluarEstructura(dets, reglas, W, H), 's');
    const aceptadas = res.reglas.flatMap((r) => r.cajas);
    const m = metricas(aceptadas, gt);
    expect(m.tp).toBe(8);
    expect(m.P).toBe(1);
    expect(m.R).toBeCloseTo(0.421, 2);
    // El gate estructural DEBE rechazar: faltan reglas obligatorias.
    expect(res.ok).toBe(false);
    expect(res.obligatorias_faltantes.length).toBeGreaterThan(0);
  });
});

describe('retrocompatibilidad y unitarios del evaluador', () => {
  test('sin detecciones: todas las obligatorias faltantes, ok=false', () => {
    const res = evaluarEstructura([], reglas, W, H);
    expect(res.ok).toBe(false);
    expect(res.reglas.every((r) => r.estado === 'faltante')).toBe(true);
    const obligatorias = reglas.filter((r) => r.obligatorio).map((r) => r.id);
    expect(res.obligatorias_faltantes.sort()).toEqual([...obligatorias].sort());
  });

  test('regla con margen: caja desplazada dentro de la tolerancia cuenta (2% clave del dossier)', () => {
    const regla: ReglaLayout = {
      id: 'zona_ajustada',
      etiqueta: 'Zona con caja al filo',
      zona: { x: 0.1, y: 0.1, w: 0.5, h: 0.2 },
      clases: ['text'],
      obligatorio: true,
    };
    // Caja que se sale 1.5% de la zona por arriba — entra por el margen 2%.
    const caja = { clase: 'text', score: 0.9, x1: 0.11 * W, y1: 0.086 * H, x2: 0.55 * W, y2: 0.28 * H };
    const res = evaluarEstructura([caja], [regla], W, H);
    expect(res.reglas[0].estado).toBe('ok');
  });

  test('baja confianza: candidato en zona con score 0.16 (minScore 0.2) → baja_confianza', () => {
    const regla: ReglaLayout = {
      id: 'franja',
      etiqueta: 'Franja débil',
      zona: { x: 0.1, y: 0.4, w: 0.8, h: 0.2 },
      clases: ['text'],
      obligatorio: true,
    };
    const caja = { clase: 'text', score: 0.16, x1: 0.2 * W, y1: 0.45 * H, x2: 0.7 * W, y2: 0.5 * H };
    const res = evaluarEstructura([caja], [regla], W, H);
    expect(res.reglas[0].estado).toBe('baja_confianza');
    expect(res.obligatorias_faltantes).toContain('franja');
    expect(res.ok).toBe(false);
  });

  test('sobrante (estricto): 2 bloques distintos donde maximo 1 → sobrante', () => {
    const regla: ReglaLayout = {
      id: 'unica',
      etiqueta: 'Bloque único',
      zona: { x: 0.1, y: 0.4, w: 0.8, h: 0.2 },
      clases: ['text'],
      maximo: 1,
      obligatorio: true,
      // El prototipo validado IGNORA sobrantes por defecto (zonas con ruido);
      // `estricto` lo vuelve señal de rechazo para reglas que lo declaran.
      estricto: true,
    };
    const a = { clase: 'text', score: 0.9, x1: 0.15 * W, y1: 0.42 * H, x2: 0.6 * W, y2: 0.5 * H };
    const b = { clase: 'text', score: 0.7, x1: 0.3 * W, y1: 0.55 * H, x2: 0.8 * W, y2: 0.58 * H };
    const res = evaluarEstructura([a, b], [regla], W, H);
    expect(res.reglas[0].estado).toBe('sobrante');
    expect(res.ok).toBe(false);
    // No está en faltantes (es sobrante), pero el gate no da ok.
    expect(res.obligatorias_faltantes).toEqual([]);
  });

  test('NMS interno: duplicado con IoU alto se suprime aunque cambie de clase', () => {
    const regla: ReglaLayout = {
      id: 'dup',
      etiqueta: 'Un bloque',
      zona: { x: 0.1, y: 0.4, w: 0.8, h: 0.2 },
      clases: ['text', 'table'],
      maximo: 1,
      obligatorio: true,
    };
    const a = { clase: 'text', score: 0.9, x1: 0.15 * W, y1: 0.42 * H, x2: 0.6 * W, y2: 0.5 * H };
    const b = { clase: 'table', score: 0.85, x1: 0.15 * W, y1: 0.421 * H, x2: 0.6 * W, y2: 0.5 * H };
    const res = evaluarEstructura([a, b], [regla], W, H);
    expect(res.reglas[0].cajas.length).toBe(1);
    expect(res.reglas[0].estado).toBe('ok');
  });

  test('dividir: 1 corte relativo → 2 partes, conteo 2, etiquetas mapeadas', () => {
    const regla: ReglaLayout = {
      id: 'dos',
      etiqueta: 'Contenedor partido',
      zona: { x: 0.1, y: 0.3, w: 0.8, h: 0.4 },
      clases: ['image', 'table'],
      minimo: 2,
      maximo: 2,
      obligatorio: true,
      dividir: { eje: 'y', cortes: [0.5], etiquetas: ['Arriba', 'Abajo'] },
    };
    const cont = { clase: 'table', score: 0.8, x1: 0.15 * W, y1: 0.35 * H, x2: 0.85 * W, y2: 0.6 * H };
    const res = evaluarEstructura([cont], [regla], W, H);
    expect(res.reglas[0].estado).toBe('ok');
    expect(res.reglas[0].partes?.length).toBe(2);
    expect(res.reglas[0].partes?.[0].etiqueta).toBe('Arriba');
    expect(res.reglas[0].partes?.[0].caja.y2).toBeCloseTo(res.reglas[0].partes?.[1].caja.y1 ?? 0, 3);
  });

  test('pagina: reglas de otra página se omiten del resultado', () => {
    const reglas2: ReglaLayout[] = [
      { id: 'p1', etiqueta: 'Página 1', zona: { x: 0, y: 0, w: 1, h: 1 }, clases: ['text'], obligatorio: true },
      { id: 'p2', etiqueta: 'Página 2', pagina: 2, zona: { x: 0, y: 0, w: 1, h: 1 }, clases: ['text'], obligatorio: true },
    ];
    const caja = { clase: 'text', score: 0.9, x1: 0.1 * W, y1: 0.1 * H, x2: 0.5 * W, y2: 0.2 * H };
    const res = evaluarEstructura([caja], reglas2, W, H, { pagina: 1 });
    expect(res.reglas.map((r) => r.reglaId)).toEqual(['p1']);
    expect(res.ok).toBe(true);
  });
});

describe('NMS clase-agnóstico (contrato plus-L)', () => {
  test('dedupe entre clases ordena por score', () => {
    const a = { score: 0.3, x1: 0, y1: 0, x2: 10, y2: 10 };
    const b = { score: 0.9, x1: 1, y1: 1, x2: 11, y2: 11 };
    const c = { score: 0.5, x1: 50, y1: 50, x2: 60, y2: 60 };
    const keep = nmsClaseAgnostico([a, b, c], 0.5);
    expect(keep.map((k) => k.score)).toEqual([0.9, 0.5]);
  });
});

describe('clases — normalización de alias (jamás índices)', () => {
  test('Picture/Table/SectionHeader → canónicas', () => {
    expect(normalizarClase('Picture')).toBe('image');
    expect(normalizarClase('Table')).toBe('table');
    expect(normalizarClase('PageFooter')).toBe('footer');
    expect(normalizarClase('SectionHeader')).toBe('doc_title');
    expect(normalizarClase('paragraph_title')).toBe('paragraph_title');
    expect(normalizarClase('content')).toBe('content');
  });
});
