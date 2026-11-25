import { describe, expect, test } from 'bun:test';
import {
  cascadaActiva,
  correrCascadaOcr,
  pasadaRoiCompuesta,
  type DepsOcrCascada,
  type PasadaCascada,
} from './cascada';
import { senalDeLectura } from '../dominio/senal-lectura';

const FUERTE = 'DOCUMENTO FECHA PAGINA TOTAL FIRMA NIT';
const MEDIA = 'FECHA TOTAL';
const DEBIL = 'HOLA';

const gate = (texto: string): 'AUTO' | 'SUGERIDA' | 'MANUAL' => {
  const n = senalDeLectura(texto).nivel;
  return n === 'FUERTE' ? 'AUTO' : n === 'MEDIA' ? 'SUGERIDA' : 'MANUAL';
};

function deps(over: Partial<DepsOcrCascada> = {}): DepsOcrCascada {
  return {
    intento1: async () => ({ texto: DEBIL, conf: 0.5, cap: 'tess', motor: 'tesseract' }),
    mismoMotorIntento1: false,
    ocr1280: async () => ({ texto: MEDIA, conf: 0.7, cap: 1280, motor: 'rapidocr' }),
    ocr1920: async () => ({ texto: MEDIA, conf: 0.75, cap: 1920, motor: 'rapidocr' }),
    ocrRoi: async () => ({ texto: DEBIL, conf: 0.4, cap: 'roi', motor: 'rapidocr' }),
    recortarRoi: async () => 'data:image/jpeg;base64,roi',
    clasificarNivel: gate,
    presupuestoVencido: () => false,
    ...over,
  };
}

describe('cascada OCR — núcleo puro (port digielect14)', () => {
  test('cascadaActiva: exige flag ON y nunca en SIM', () => {
    expect(cascadaActiva(true, false)).toBe(true);
    expect(cascadaActiva(true, undefined)).toBe(true);
    expect(cascadaActiva(false, false)).toBe(false);
    expect(cascadaActiva(true, true)).toBe(false);
  });

  test('GATE AUTO en el intento 1 ⇒ no paga core ni rescates', async () => {
    let coreLlamado = false;
    const s = await correrCascadaOcr(
      'foto',
      deps({
        intento1: async () => ({ texto: FUERTE, conf: 0.9, cap: 'tess', motor: 'tesseract' }),
        ocr1280: async () => {
          coreLlamado = true;
          return { texto: MEDIA, conf: 0.7, cap: 1280 };
        },
      }),
    );
    expect(s.paso).toBe('intento1');
    expect(s.motorIntento1).toBe('tesseract');
    expect(s.texto).toBe(FUERTE);
    expect(s.ms1280).toBeNull();
    expect(coreLlamado).toBe(false);
  });

  test('sin AUTO: core 1280 → 1920 y gana la MEJOR pasada', async () => {
    const s = await correrCascadaOcr(
      'foto',
      deps({
        ocr1920: async () => ({ texto: FUERTE, conf: 0.6, cap: 1920, motor: 'rapidocr' }),
        ocrRoi: async () => ({ texto: DEBIL, conf: 0.4, cap: 'roi' }),
      }),
    );
    expect(s.paso).toBe('1920');
    expect(s.texto).toBe(FUERTE);
    expect(s.ms1280).not.toBeNull();
    expect(s.ms1920).not.toBeNull();
  });

  test('sin AUTO y lectura débil: rescate ROI compuesto puede ganar (paso roi)', async () => {
    const s = await correrCascadaOcr(
      'foto',
      deps({
        ocrRoi: async () => ({ texto: FUERTE, conf: 0.55, cap: 'roi', motor: 'rapidocr' }),
      }),
    );
    expect(s.rescate).toBe(true);
    expect(s.paso).toBe('roi');
    expect(s.texto).toContain('DOCUMENTO');
  });

  test('presupuesto vencido ⇒ no se abre la 2.ª pasada ni el rescate', async () => {
    const s = await correrCascadaOcr(
      'foto',
      deps({ presupuestoVencido: () => true }),
    );
    expect(s.ms1920).toBeNull();
    expect(s.msRoi).toBeNull();
    expect(s.texto).toBe(MEDIA);
  });

  test('rescate final de otro motor solo con gate ≠ AUTO y presupuesto suficiente', async () => {
    // Mesa leída + 4 anclas ⇒ necesitaSegunda false pero el GATE sigue en
    // SUGERIDA (MEDIA): el core no escala y el paso 4 queda aislado.
    const MESA = 'MESA 001 FECHA TOTAL FIRMA NIT';
    const s = await correrCascadaOcr(
      'foto',
      deps({
        mismoMotorIntento1: true,
        intento1: async () => ({ texto: MESA, conf: 0.6, cap: 1280, motor: 'rapidocr' }),
        rescateMotor: async () => ({ texto: FUERTE, conf: 0.9, cap: 'tess', motor: 'tesseract' }),
        presupuestoRestanteMs: () => 60_000,
      }),
    );
    expect(s.ms1920).toBeNull();
    expect(s.paso).toBe('rescate-motor');
    expect(s.texto).toBe(FUERTE);
  });

  test('pasadaRoiCompuesta: ignora ROI vacío/null y promedia la conf de las útiles', () => {
    const top: PasadaCascada = { texto: 'A', conf: 0.5, cap: 'roi' };
    const bottom: PasadaCascada = { texto: '  ', conf: 0.9, cap: 'roi' };
    expect(pasadaRoiCompuesta(null, null)).toBeNull();
    const compuesta = pasadaRoiCompuesta(top, bottom);
    expect(compuesta?.texto).toBe('A');
    expect(compuesta?.conf).toBe(0.5);
  });
});
