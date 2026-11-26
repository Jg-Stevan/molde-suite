import { describe, expect, test } from 'bun:test';
import { lineasDesdeRapid } from './ocr-mapeo';

const linea = (texto: string, conf: number, box: Array<{ x: number; y: number }>) => ({
  texto,
  conf,
  box,
});

describe('lineasDesdeRapid (F2)', () => {
  test('bbox = min/max de los puntos del polígono box', () => {
    const r = lineasDesdeRapid(
      [linea('hola', 0.9, [{ x: 10, y: 20 }, { x: 100, y: 20 }, { x: 100, y: 50 }, { x: 10, y: 50 }])],
      1,
    );
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]!.bbox).toEqual([10, 20, 100, 50]);
  });

  test('palabras siempre vacías (Rapid no da palabras)', () => {
    const r = lineasDesdeRapid([linea('texto', 0.8, [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 10 }, { x: 0, y: 10 }])], 1);
    expect(r.lines[0]!.palabras).toEqual([]);
  });

  test('conf de página = media de conf de líneas', () => {
    const r = lineasDesdeRapid(
      [
        linea('a', 0.8, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]),
        linea('b', 0.6, [{ x: 0, y: 20 }, { x: 10, y: 20 }, { x: 10, y: 30 }, { x: 0, y: 30 }]),
      ],
      1,
    );
    expect(r.conf).toBeCloseTo(0.7, 5);
  });

  test('factorEscala multiplica las coordenadas', () => {
    const r = lineasDesdeRapid(
      [linea('x', 0.9, [{ x: 100, y: 200 }, { x: 300, y: 200 }, { x: 300, y: 400 }, { x: 100, y: 400 }])],
      0.5,
    );
    expect(r.lines[0]!.bbox).toEqual([50, 100, 150, 200]);
  });

  test('líneas vacías o sin box se descartan; conf null si no hay líneas', () => {
    const r = lineasDesdeRapid(
      [linea('', 0.9, [{ x: 0, y: 0 }]), linea('ok', 0.5, [])],
      1,
    );
    expect(r.lines).toHaveLength(0);
    expect(r.conf).toBeNull();
  });

  test('orden por y luego x (mismo convenio que Tesseract)', () => {
    const r = lineasDesdeRapid(
      [
        linea('abajo', 0.9, [{ x: 0, y: 100 }, { x: 10, y: 100 }, { x: 10, y: 110 }, { x: 0, y: 110 }]),
        linea('arriba', 0.9, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]),
      ],
      1,
    );
    expect(r.lines[0]!.texto).toBe('arriba');
    expect(r.lines[1]!.texto).toBe('abajo');
  });
});
