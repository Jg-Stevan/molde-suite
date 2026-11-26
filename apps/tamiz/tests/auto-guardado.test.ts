/**
 * §4 (REGLA DE ORO — plan cierre 2 agentes, 2026-11-26) — LOS 4 TESTS
 * OBLIGATORIOS del plan + excepciones + kill-switch. La función bajo prueba
 * es PURA (politica/auto-guardado.ts): la misma que cablea el store en
 * analisisCompletado y en la edición del operador (§5).
 */
import { describe, expect, test } from 'bun:test';

import type { ResumenMoldeActa, ResumenMoldeCampo } from '@molde-suite/scanner-core/dominio/types';
import {
  decidirAutoGuardado,
  esLegible,
  obligatorioValido,
} from '../src/lib/e14/politica/auto-guardado';

function campo(parciales: Partial<ResumenMoldeCampo> & { id: string; etiqueta: string }): ResumenMoldeCampo {
  return {
    id: parciales.id,
    etiqueta: parciales.etiqueta,
    tipo: 'texto',
    estado: 'ok',
    valor: 'X',
    conf: 0.9,
    rect: null,
    ancla_rect: null,
    fuente: 'ancla',
    banderas: [],
    ...parciales,
  };
}

function resumen(campos: ResumenMoldeCampo[], extra: Partial<ResumenMoldeActa> = {}): ResumenMoldeActa {
  const ok = campos.filter((c) => c.estado === 'ok').length;
  const faltantes = campos
    .filter((c) => c.obligatorio && c.estado !== 'ok')
    .map((c) => c.etiqueta);
  return {
    moldeNombre: 'RECIBO DE LUZ',
    total: campos.length,
    ok,
    score: campos.length ? Math.round((ok / campos.length) * 1000) / 10 : 0,
    requiereRevision: campos.some((c) => c.estado === 'requiere_revision'),
    obligatoriosFaltantes: faltantes,
    banderas: [],
    tiempos: { render_ms: 0, ocr_ms: 0, motor_ms: 0 },
    campos,
    enrutado: true,
    ...extra,
  };
}

describe('§4 REGLA DE ORO — tests obligatorios del plan', () => {
  // (1) documento legible con obligatorios completos → guarda solo
  test('(1) ÓPTIMA con obligatorios completos → SE GUARDA SOLO', () => {
    const r = resumen([
      campo({ id: 'suscriptor', etiqueta: 'NÚMERO DE SUSCRIPTOR', obligatorio: true, estado: 'ok', valor: '1234567' }),
      campo({ id: 'valor', etiqueta: 'VALOR A PAGAR', obligatorio: true, estado: 'ok', valor: '45000' }),
      campo({ id: 'consumo', etiqueta: 'CONSUMO (kWh)', obligatorio: false, estado: 'ok', valor: '310' }),
    ]);
    const d = decidirAutoGuardado({ status: 'OPTIMA', evaluacionMolde: r }, true);
    expect(d.autoEnviar).toBe(true);
    expect(d.motivo).toBe(null);
  });

  test('(1b) HUECO CERRADO B4: ADVERTENCIA legible (obligatorios completos, un opcional dudoso) → SE GUARDA SOLO', () => {
    const r = resumen([
      campo({ id: 'suscriptor', etiqueta: 'NÚMERO DE SUSCRIPTOR', obligatorio: true, estado: 'ok', valor: '1234567' }),
      campo({ id: 'valor', etiqueta: 'VALOR A PAGAR', obligatorio: true, estado: 'ok', valor: '45000' }),
      // opcional ilegible — el documento sigue siendo legible §4 (solo
      // los OBLIGATORIOS deciden).
      campo({ id: 'consumo', etiqueta: 'CONSUMO (kWh)', obligatorio: false, estado: 'requiere_revision', valor: null, conf: null }),
    ]);
    r.requiereRevision = true; // viene del opcional
    const d = decidirAutoGuardado({ status: 'ADVERTENCIA', evaluacionMolde: r }, true);
    expect(d.autoEnviar).toBe(true);
  });

  test('(1c) semáforo de tinta: manuscrito obligatorio CON trazo medido → presente y válido', () => {
    const conTinta = campo({ id: 'firma', etiqueta: 'FIRMA DEL CLIENTE', tipo: 'firma', obligatorio: true, estado: 'requiere_revision', valor: null, tinta: true, conf: null });
    expect(obligatorioValido(conTinta)).toBe(true);
    const sinTinta = campo({ id: 'firma', etiqueta: 'FIRMA DEL CLIENTE', tipo: 'firma', obligatorio: true, estado: 'no_encontrado', valor: null, tinta: false, conf: null });
    expect(obligatorioValido(sinTinta)).toBe(false);
  });

  test('(1d) SIN REGRESIÓN: ÓPTIMA del gate E-14 con resumen ADITIVO (obligatorios del molde sin leer) → auto-envío de siempre', () => {
    // El resumen ADITIVO no es el veredicto — sus obligatorios NO bloquean.
    const r = resumen([
      campo({ id: 'suscriptor', etiqueta: 'NÚMERO DE SUSCRIPTOR', obligatorio: true, estado: 'no_encontrado', valor: null, conf: null }),
    ]);
    r.enrutado = false;
    const d = decidirAutoGuardado({ status: 'OPTIMA', evaluacionMolde: r }, true);
    expect(d.autoEnviar).toBe(true);
  });

  // (2) legible pero con UN obligatorio faltante → NO guarda solo
  test('(2) ADVERTENCIA con UN obligatorio faltante (vacío) → NO guarda solo', () => {
    const r = resumen([
      campo({ id: 'suscriptor', etiqueta: 'NÚMERO DE SUSCRIPTOR', obligatorio: true, estado: 'ok', valor: '1234567' }),
      campo({ id: 'valor', etiqueta: 'VALOR A PAGAR', obligatorio: true, estado: 'no_encontrado', valor: null, conf: null }),
    ]);
    r.obligatoriosFaltantes = []; // caso contrived: el resumen no lo demitó
    const d = decidirAutoGuardado({ status: 'ADVERTENCIA', evaluacionMolde: r }, true);
    expect(d.autoEnviar).toBe(false);
    expect(d.motivo).toBe('OBLIGATORIO_FALTANTE');
  });

  test('(2b) ÓPTIMA con obligatoriosFaltantes no vacío → NO guarda solo (defensa)', () => {
    const r = resumen([
      campo({ id: 'valor', etiqueta: 'VALOR A PAGAR', obligatorio: true, estado: 'no_encontrado', valor: null, conf: null }),
    ]);
    const d = decidirAutoGuardado({ status: 'OPTIMA', evaluacionMolde: r }, true);
    expect(d.autoEnviar).toBe(false);
    expect(d.motivo).toBe('OBLIGATORIO_FALTANTE');
  });

  test('(2c) obligatorio manuscrito SIN tinta (hoja en blanco) → NO guarda solo', () => {
    const r = resumen([
      campo({ id: 'suscriptor', etiqueta: 'NÚMERO DE SUSCRIPTOR', obligatorio: true, estado: 'ok', valor: '1234567' }),
      campo({ id: 'firma', etiqueta: 'FIRMA DEL CLIENTE', tipo: 'firma', obligatorio: true, estado: 'no_encontrado', valor: null, tinta: false, conf: null }),
    ]);
    const d = decidirAutoGuardado({ status: 'ADVERTENCIA', evaluacionMolde: r }, true);
    expect(d.autoEnviar).toBe(false);
    expect(d.motivo).toBe('OBLIGATORIO_FALTANTE');
  });

  test('(2d) `relacion_ambigua` en un obligatorio → NO guarda solo (excepción §4)', () => {
    const r = resumen([
      campo({ id: 'suscriptor', etiqueta: 'NÚMERO DE SUSCRIPTOR', obligatorio: true, estado: 'ok', valor: '1234567' }),
      campo({ id: 'firma2', etiqueta: 'FIRMA 2', tipo: 'firma', obligatorio: true, estado: 'requiere_revision', valor: null, tinta: true, banderas: ['relacion_ambigua'] }),
    ]);
    const d = decidirAutoGuardado({ status: 'ADVERTENCIA', evaluacionMolde: r }, true);
    expect(d.autoEnviar).toBe(false);
    expect(d.motivo).toBe('RELACION_AMBIGUA');
  });

  test('(2e) acta SIN TINTA (procesadaVacia) → NO guarda solo', () => {
    const d = decidirAutoGuardado(
      { status: 'OPTIMA', procesadaVacia: true, evaluacionMolde: null },
      true,
    );
    expect(d.autoEnviar).toBe(false);
    expect(d.motivo).toBe('SIN_TINTA');
  });

  test('(2f) ADVERTENCIA sin evidencia de campos (gate E-14, sin molde) → conservador: NO auto-envía', () => {
    const d = decidirAutoGuardado({ status: 'ADVERTENCIA', evaluacionMolde: null }, true);
    expect(d.autoEnviar).toBe(false);
    expect(d.motivo).toBe('SIN_EVIDENCIA_DE_CAMPOS');
  });

  // (3) EN_REVISION_HUMANA → NO guarda solo
  test('(3) EN_REVISION_HUMANA → NO guarda solo', () => {
    const d = decidirAutoGuardado({ status: 'EN_REVISION_HUMANA', evaluacionMolde: null }, true);
    expect(d.autoEnviar).toBe(false);
    expect(d.motivo).toBe('EN_REVISION_HUMANA');
  });

  test('(3b) RECHAZADA → NO guarda solo', () => {
    const d = decidirAutoGuardado({ status: 'RECHAZADA', evaluacionMolde: null }, true);
    expect(d.autoEnviar).toBe(false);
    expect(d.motivo).toBe('RECHAZADA');
  });

  // (4) multipágina: lote 2/2 válido → un solo auto-guardado del acta
  test('(4) lote multipágina 2/2 válido (campos de ambas páginas ok) → auto-envía UNA vez', () => {
    const r = resumen([
      // página 1
      campo({ id: 'suscriptor', etiqueta: 'NÚMERO DE SUSCRIPTOR', obligatorio: true, estado: 'ok', valor: '1234567', pagina: 1 }),
      campo({ id: 'periodo', etiqueta: 'PERIODO FACTURADO', obligatorio: true, estado: 'ok', valor: '2026-11', pagina: 1 }),
      // página 2
      campo({ id: 'valor', etiqueta: 'VALOR A PAGAR', obligatorio: true, estado: 'ok', valor: '45000', pagina: 2 }),
    ]);
    const d = decidirAutoGuardado({ status: 'OPTIMA', evaluacionMolde: r }, true);
    expect(d.autoEnviar).toBe(true);
    expect(esLegible({ status: 'OPTIMA', evaluacionMolde: r })).toBe(true);
    // El «UNA sola vez» lo garantiza el store (una sola llamada
    // registrarEnvio por lote — analisisCompletado multipágina).
  });

  test('(4b) lote 2/2 con UN obligatorio de la pág. 2 faltante → NO auto-guarda', () => {
    const r = resumen([
      campo({ id: 'suscriptor', etiqueta: 'NÚMERO DE SUSCRIPTOR', obligatorio: true, estado: 'ok', valor: '1234567', pagina: 1 }),
      campo({ id: 'valor', etiqueta: 'VALOR A PAGAR', obligatorio: true, estado: 'no_encontrado', valor: null, conf: null, pagina: 2 }),
    ]);
    const d = decidirAutoGuardado({ status: 'RECHAZADA', evaluacionMolde: r }, true);
    expect(d.autoEnviar).toBe(false);
    expect(d.motivo).toBe('RECHAZADA');
    expect(esLegible({ status: 'RECHAZADA', evaluacionMolde: r })).toBe(false);
  });

  // Kill-switch del operador (§3.4 — flag autoGuardado en tamiz.flags.v1)
  test('flag autoGuardado=false → NUNCA auto-guarda (kill-switch honesto)', () => {
    const r = resumen([
      campo({ id: 'suscriptor', etiqueta: 'NÚMERO DE SUSCRIPTOR', obligatorio: true, estado: 'ok', valor: '1234567' }),
    ]);
    const d = decidirAutoGuardado({ status: 'OPTIMA', evaluacionMolde: r }, false);
    expect(d.autoEnviar).toBe(false);
    expect(d.motivo).toBe('FLAG_APAGADA');
  });

  test('esLegible: ÓPTIMA sin resumen (gate E-14) → legible (regla existente D4)', () => {
    expect(esLegible({ status: 'OPTIMA', evaluacionMolde: null })).toBe(true);
  });
});
