// Tests del pre-chequeo de patrones localizadores (KIT qr-prechequeo-capa0-v1,
// PLAN-AGENTE-EXTERNO tarea A) — SIN DOM: RGBA sintético dibujado a mano con
// primitivas de píxeles. Verifican el contrato del kit:
//  (a) 3 patrones localizadores en esquinas → candidato true, patrones ≥ 2
//  (b) «documento» sintético con franjas de texto (sin relación 1:1:3:1:1) → candidato false
//  (c) un solo patrón localizador → candidato false pero patrones === 1
//  (d) imagen vacía blanca → candidato false, confianza 0
//  (e) determinismo (misma entrada → misma salida)
//  + pase 1 con downscale (imagen 960×960) y pase de rescate (QR de campo
//    chico: módulo 3 px en 1280 — invisible a 320, lección H-6 del header).

import { describe, expect, test } from 'bun:test';
import {
  detectarPatronesLocalizador,
  PRECHEQUEO_LADO_LARGO,
  type ImagenAnalizable,
} from './prechequeo-qr';

/** Lienzo RGBA blanco opaco w×h (4 bytes por píxel — forma de getImageData). */
function lienzoBlanco(w: number, h: number): Uint8ClampedArray {
  return new Uint8ClampedArray(w * h * 4).fill(255);
}

/** Dibuja UN patrón localizador de 7×7 módulos (cuadrados concéntricos
 *  negro-blanco-negro-blanco-negro: anillo oscuro + centro oscuro 3×3) con
 *  origen (x0,y0) y tamaño de módulo `m`. Negro opaco sobre el fondo blanco. */
function dibujarPatron(
  data: Uint8ClampedArray,
  w: number,
  x0: number,
  y0: number,
  m: number,
): void {
  const pintar = (x: number, y: number): void => {
    const i = (y * w + x) * 4;
    data[i] = 0;
    data[i + 1] = 0;
    data[i + 2] = 0;
    data[i + 3] = 255;
  };
  for (let my = 0; my < 7; my++) {
    for (let mx = 0; mx < 7; mx++) {
      const borde = my === 0 || my === 6 || mx === 0 || mx === 6;
      const centro = my >= 2 && my <= 4 && mx >= 2 && mx <= 4;
      if (!borde && !centro) continue; // módulo claro — el fondo ya está blanco
      for (let py = 0; py < m; py++) {
        for (let px = 0; px < m; px++) pintar(x0 + mx * m + px, y0 + my * m + py);
      }
    }
  }
}

describe('pre-chequeo de patrones localizadores QR (tarea A)', () => {
  test('constante del kit fijada: PRECHEQUEO_LADO_LARGO === 320 (ancla de la tarea A)', () => {
    expect(PRECHEQUEO_LADO_LARGO).toBe(320);
  });

  test('(a) 3 patrones localizadores en esquinas → candidato true, patrones ≥ 2', () => {
    const w = 240;
    const h = 240;
    const data = lienzoBlanco(w, h);
    const m = 8; // escala ≥ 8 px por módulo (7×7 módulos = 56 px de patrón)
    dibujarPatron(data, w, 16, 16, m); // TL
    dibujarPatron(data, w, w - 16 - 7 * m, 16, m); // TR
    dibujarPatron(data, w, 16, h - 16 - 7 * m, m); // BL
    const r = detectarPatronesLocalizador({ width: w, height: h, rgba: data });
    expect(r.candidato).toBe(true);
    expect(r.patrones).toBeGreaterThanOrEqual(2);
    expect(r.patrones).toBeLessThanOrEqual(3); // el dedup no infla la cuenta
    expect(r.confianza).toBe(Math.min(1, r.patrones / 3));
  });

  test('(b) documento sintético con franjas de texto (sin 1:1:3:1:1) → candidato false', () => {
    const w = 240;
    const h = 240;
    const data = lienzoBlanco(w, h);
    // «Texto»: líneas de 22 px de pitch con segmentos (palabras) de ancho y
    // alto variables — LCG de semilla fija (fixture 100% reproducible).
    // Verticalmente coherente SÓLO por la altura de línea (4..6 px) con huecos
    // de 16..18 px → la confirmación de columna nunca encuentra 1:1:3:1:1.
    let semilla = 20260101;
    const azar = (tope: number): number => {
      semilla = (semilla * 1103515245 + 12345) & 0x7fffffff;
      return semilla % tope;
    };
    for (let y0 = 10; y0 + 6 <= h - 10; y0 += 22) {
      let x = 8 + azar(12);
      while (x < w - 8) {
        const ancho = 12 + azar(22); // palabra 12..33 px
        const alto = 4 + azar(3); // altura 4..6 px (ascendentes/descendentes)
        for (let yy = y0; yy < y0 + alto && yy < h; yy++) {
          for (let xx = x; xx < x + ancho && xx < w; xx++) {
            const i = (yy * w + xx) * 4;
            data[i] = 40;
            data[i + 1] = 40;
            data[i + 2] = 40;
          }
        }
        x += ancho + 5 + azar(10); // hueco entre palabras 5..14 px
      }
    }
    const r = detectarPatronesLocalizador({ width: w, height: h, rgba: data });
    expect(r.candidato).toBe(false);
    expect(r.patrones).toBe(0);
  });

  test('(c) un solo patrón localizador → candidato false pero patrones === 1', () => {
    const w = 240;
    const h = 240;
    const data = lienzoBlanco(w, h);
    dibujarPatron(data, w, 16, 16, 8);
    const r = detectarPatronesLocalizador({ width: w, height: h, rgba: data });
    expect(r.candidato).toBe(false); // <2 patrones — no hay QR confirmado
    expect(r.patrones).toBe(1);
    expect(r.confianza).toBeCloseTo(1 / 3, 9);
  });

  test('(d) imagen vacía blanca → candidato false, confianza 0 (Uint8Array, no clamped)', () => {
    // Cubre la rama Uint8Array de ImagenAnalizable (el resto usa clamped).
    const rgba = new Uint8Array(240 * 240 * 4).fill(255);
    const r = detectarPatronesLocalizador({ width: 240, height: 240, rgba });
    expect(r.candidato).toBe(false);
    expect(r.patrones).toBe(0);
    expect(r.confianza).toBe(0);
  });

  test('(e) determinismo: misma entrada → misma salida (2 patrones, QR ocluido)', () => {
    const w = 320;
    const h = 200;
    const data = lienzoBlanco(w, h);
    const m = 7;
    dibujarPatron(data, w, 10, 10, m); // TL
    dibujarPatron(data, w, w - 10 - 7 * m, 10, m); // TR — sin BL (QR «ocluido»)
    const img: ImagenAnalizable = { width: w, height: h, rgba: data };
    const a = detectarPatronesLocalizador(img);
    const b = detectarPatronesLocalizador(img);
    expect(a).toEqual(b);
    expect(a.candidato).toBe(true); // 2 patrones bastan (tarea A: oclusión)
    expect(a.patrones).toBe(2);
    expect(a.confianza).toBeCloseTo(2 / 3, 9);
  });

  test('pase 1 con downscale: QR grande en imagen 960×960 (módulo 32 px) → detectado', () => {
    const w = 960;
    const h = 960;
    const m = 32;
    const data = lienzoBlanco(w, h);
    dibujarPatron(data, w, 64, 64, m);
    dibujarPatron(data, w, w - 64 - 7 * m, 64, m);
    dibujarPatron(data, w, 64, h - 64 - 7 * m, m);
    const r = detectarPatronesLocalizador({ width: w, height: h, rgba: data });
    expect(r.candidato).toBe(true);
    expect(r.patrones).toBeGreaterThanOrEqual(2);
  });

  test('pase de rescate: QR de campo chico (módulo 3 px en 1280) invisible a 320 → detectado', () => {
    // El caso REAL del campo (lección H-6): QR ~5% del ancho de una captura
    // de cámara de 1280 px → módulo ~3 px. A 320 el módulo cae a 0.75 px
    // (<2 — rechazado por MODULO_MINIMO_PX): sin el pase de rescate esto
    // sería un falso NEGATIVO sistemático sobre QRs reales.
    const w = 1280;
    const h = 720;
    const m = 3;
    const data = lienzoBlanco(w, h);
    dibujarPatron(data, w, 40, 40, m); // TL
    dibujarPatron(data, w, w - 40 - 7 * m, 40, m); // TR
    const r = detectarPatronesLocalizador({ width: w, height: h, rgba: data });
    expect(r.candidato).toBe(true);
    expect(r.patrones).toBeGreaterThanOrEqual(2);
  });
});
