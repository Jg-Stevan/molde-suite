// Tests golden del contrato del molde (Fase 2b) — fixtures REALES del repo
// (moldes-finales/). Verifican: el validador estructural acepta los moldes
// vivos (retrocompatibilidad v1.x y v3.x), las guardas de contrato son
// aditivas y el sobre con checksum hace round-trip y detecta alteraciones.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLAVES_TOP_LEVEL, erroresContrato, esMoldeUniversal, MOLDE_UNIVERSAL_VERSION } from './contrato';
import { crearSobreMolde, esSobreConMolde, verificarSobreMolde, type SobreMolde } from './sobre';

function fixture(nombre: string): unknown {
  return JSON.parse(readFileSync(join(import.meta.dir, '__fixtures__', nombre), 'utf8'));
}

describe('contrato del molde .json (golden fixtures)', () => {
  test('fixture real e14_acta (v3.0.0) pasa el validador y las guardas', () => {
    const molde = fixture('e14_acta.molde.json');
    expect(esMoldeUniversal(molde)).toBe(true);
    expect(erroresContrato(molde)).toEqual([]);
  });

  test('fixture real comprobante_entrega (v1.3.x) pasa (retrocompatibilidad v1.x)', () => {
    const molde = fixture('comprobante_entrega.molde.json');
    expect(esMoldeUniversal(molde)).toBe(true);
    expect(erroresContrato(molde)).toEqual([]);
  });

  test('MOLDE_UNIVERSAL_VERSION es semver y las claves del contrato están documentadas', () => {
    expect(MOLDE_UNIVERSAL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(CLAVES_TOP_LEVEL).toContain('campos');
    expect(CLAVES_TOP_LEVEL).toContain('layout');
  });

  test('las guardas son ADITIVAS: version no-semver y campos vacíos se rechazan', () => {
    const molde = fixture('e14_acta.molde.json') as Record<string, unknown>;
    const malaVersion = { ...molde, version: 'tres-punto-cero' };
    expect(esMoldeUniversal(malaVersion)).toBe(true); // el motor aún lo acepta
    expect(erroresContrato(malaVersion).some((e) => e.startsWith('version'))).toBe(true);

    const camposVacios = { ...molde, campos: [] };
    expect(erroresContrato(camposVacios).some((e) => e.startsWith('campos'))).toBe(true);
  });
});

describe('sobre con checksum (protocolo Studio -> Tamiz)', () => {
  test('round-trip: crear -> esSobreConMolde -> verificar ok', async () => {
    const molde = fixture('e14_acta.molde.json');
    if (!esMoldeUniversal(molde)) throw new Error('El fixture debe ser un molde universal');
    const sobre = await crearSobreMolde(molde);
    expect(sobre).not.toBeNull();
    expect(esSobreConMolde(sobre)).toBe(true);
    const v = await verificarSobreMolde(sobre!);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.checksum).toBe(sobre!.checksum);
  });

  test('el checksum es el SHA-256 de JSON.stringify(molde) (protocolo byte a byte)', async () => {
    const molde = fixture('comprobante_entrega.molde.json');
    const sobre = await crearSobreMolde(molde);
    const esperado = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(molde)),
    );
    const hex = Array.from(new Uint8Array(esperado))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    expect(sobre!.checksum).toBe(hex);
  });

  test('detecta alteración del cuerpo (checksum_invalido)', async () => {
    const molde = fixture('e14_acta.molde.json');
    const sobre = (await crearSobreMolde(molde))!;
    const alterado = {
      ...sobre,
      molde: { ...(sobre.molde as object), nombre: 'MOLDE ALTERADO' },
    };
    const v = await verificarSobreMolde(alterado);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motivo).toBe('checksum_invalido');
  });

  test('acepta checksum en mayúsculas (comparación case-insensitive como tamiz)', async () => {
    const molde = fixture('e14_acta.molde.json');
    const sobre = (await crearSobreMolde(molde))!;
    const v = await verificarSobreMolde({ checksum: sobre.checksum.toUpperCase(), molde });
    expect(v.ok).toBe(true);
  });
});
