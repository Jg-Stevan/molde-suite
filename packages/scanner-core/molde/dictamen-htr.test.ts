// Dictamen HTR por confianza (2026-11-26): con umbral operativo, una lectura
// `htr && obligatorio` que ya cumple el patrón anclado estricto y alcanza la
// confianza mínima puede ser `ok` (bandera `htr_conf_alta`). Sin umbral
// (null) la regla histórica — manuscritos SIEMPRE a revisión — es intacta.

import { test, expect, describe } from 'bun:test';
import { dictaminarCampo } from './universal-engine';

describe('dictaminarCampo — dictamen HTR por confianza', () => {
  test('opción null: comportamiento histórico (htr obligatorio → revisión)', () => {
    const r = dictaminarCampo(true, true, 0.95, ['htr_manual'], null);
    expect(r.estado).toBe('requiere_revision');
    expect(r.bandera).toBeUndefined();
  });

  test('conf >= umbral: ok con bandera htr_conf_alta (valor leído, no inventado)', () => {
    const r = dictaminarCampo(true, true, 0.93, ['htr_manual'], 0.8);
    expect(r.estado).toBe('ok');
    expect(r.bandera).toBe('htr_conf_alta');
  });

  test('conf < umbral: sigue a revisión', () => {
    const r = dictaminarCampo(true, true, 0.79, ['htr_manual'], 0.8);
    expect(r.estado).toBe('requiere_revision');
    expect(r.bandera).toBeUndefined();
  });

  test('relacion_ambigua gana al dictamen: revisión aunque la conf sea alta', () => {
    const r = dictaminarCampo(true, true, 0.98, ['htr_manual', 'relacion_ambigua'], 0.8);
    expect(r.estado).toBe('requiere_revision');
  });

  test('conf ausente en obligatorio: revisión con cualquier umbral', () => {
    expect(dictaminarCampo(true, true, null, ['htr_manual'], 0.8).estado).toBe(
      'requiere_revision',
    );
  });

  test('htr opcional: nunca fue bloqueado (histórico intacto con y sin umbral)', () => {
    expect(dictaminarCampo(true, false, 0.9, ['htr_manual'], null)).toEqual({ estado: 'ok' });
    expect(dictaminarCampo(true, false, 0.9, ['htr_manual'], 0.8)).toEqual({ estado: 'ok' });
  });

  test('sin htr: ok con conf razonable (regla general sin cambios)', () => {
    expect(dictaminarCampo(false, true, 0.7, [], null)).toEqual({ estado: 'ok' });
  });
});
