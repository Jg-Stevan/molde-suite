// FASE C (blueprint DLA): importación de BORRADORES de molde generados con
// Chandra OCR (vía sidecar `services/sidecar-dla` — POST /borrador-molde) o
// mapeo LOCAL directo desde el JSON estructurado de Chandra.
//
// Cómo se usa (dos caminos):
//   1. Sidecar activo: curl -F file=@referencia.png http://127.0.0.1:3070/ocr
//      → /estructura → /borrador-molde devuelve el molde; pegarlo en el
//      editor (Aplicar JSON) y calibrar a mano (el borrador PROPONE, el
//      humano aprueba — Fase 5 del plan).
//   2. Este script: mapeo puro JSON Chandra → MoldeUniversal sin servidor,
//      para calibración offline o para tests. `bun run scripts/importar-borrador.ts <entrada.json> <salida.json>`
//
// El borrador respeta la VALIDACIÓN v3 (esMoldeUniversal): rects normalizados
// 0-1 finitos, umbrales en [0,1], ancla con texto no vacío. Los placeholders
// (bloques sin bbox) quedan marcados en `nota` para recalibración en editor.

import { writeFileSync, readFileSync } from 'node:fs';
import { erroresMolde, esMoldeUniversal, type CampoUniversal, type MoldeUniversal, type RectNorm } from '@molde-suite/scanner-core/molde/universal-types';

interface BloqueChandra {
  texto?: string;
  bbox?: number[]; // [x0, y0, x1, y1] en px o 0-1
  clase?: string;
  tipo?: string;
}

interface EntradaChandra {
  ancho?: number;
  alto?: number;
  width?: number;
  height?: number;
  bloques?: BloqueChandra[];
  blocks?: BloqueChandra[];
}

const MAX_CAMPOS = 120;

function idCampo(): string {
  return `campo_${Math.random().toString(36).slice(2, 8)}`;
}

/** Rect normalizado 0-1 con clamp (w/h > 0). Los rects ya-normalizados
 * (todos los valores ≤ 1.5) pasan tal cual; los px se normalizan con dims. */
function normalizarRect(b: number[] | undefined, dims: { w: number; h: number }): RectNorm | null {
  if (!b || b.length < 4 || b.some((v) => !Number.isFinite(v))) return null;
  const [x0, y0, x1, y1] = b;
  const yaNorm = Math.max(x0, y0, x1, y1) <= 1.5;
  const x = yaNorm ? x0 : x0 / dims.w;
  const y = yaNorm ? y0 : y0 / dims.h;
  const w = yaNorm ? x1 - x0 : (x1 - x0) / dims.w;
  const h = yaNorm ? y1 - y0 : (y1 - y0) / dims.h;
  const cx = Math.min(1, Math.max(0, x));
  const cy = Math.min(1, Math.max(0, y));
  return {
    x: cx,
    y: cy,
    w: Math.max(0.01, Math.min(1 - cx, w)),
    h: Math.max(0.01, Math.min(1 - cy, h)),
  };
}

function clasificarTipo(texto: string): { tipo: CampoUniversal['tipo']; clave: boolean } {
  const t = texto.toLowerCase();
  if (/\bcasilla\b|checkbox|\[ \]|\[x\]|\bo sí\b|\bno\b/i.test(t)) return { tipo: 'checkbox', clave: /\[ \]|\[x\]/.test(t) };
  if (/\bfirma\b|signature/i.test(t)) return { tipo: 'firma', clave: false };
  return { tipo: 'texto', clave: false };
}

/** Mapeo puro: JSON Chandra → borrador MoldeUniversal (validado v3). */
export function mapearBorrador(entrada: EntradaChandra, nombre = 'Borrador Chandra'): { molde: MoldeUniversal | null; errores: string[]; resumen: Record<string, number> } {
  const w = entrada.ancho ?? entrada.width ?? 1000;
  const h = entrada.alto ?? entrada.height ?? Math.round(w * 1.414);
  const bloques = entrada.bloques ?? entrada.blocks ?? [];
  const campos: CampoUniversal[] = [];
  const resumen: Record<string, number> = { texto: 0, checkbox: 0, firma: 0, presencia: 0 };
  let truncada = false;

  for (const b of bloques) {
    if (campos.length >= MAX_CAMPOS) {
      truncada = true;
      break;
    }
    const texto = (b.texto ?? '').trim();
    if (!texto) continue;
    const { tipo } = clasificarTipo(texto);
    const rect = normalizarRect(b.bbox, { w, h });
    const campo: CampoUniversal = {
      id: idCampo(),
      etiqueta: texto.slice(0, 80),
      pagina: 1,
      tipo,
      estrategia: 'zona_fija',
      zona: rect ?? { x: 0.1, y: 0.1, w: 0.8, h: 0.05 },
      umbral: 0.02,
      obligatorio: false,
      nota: rect ? undefined : 'PLACEHOLDER sin bbox: recalibrar en editor',
    };
    // Ancla solo con bloques legibles (≥8 chars): el motor la busca por OCR.
    if (texto.length >= 8 && rect) campo.ancla = { texto: texto.slice(0, 60), rect };
    campos.push(campo);
    resumen[tipo] = (resumen[tipo] ?? 0) + 1;
  }

  const molde: MoldeUniversal = {
    tipo: 'universal',
    version: '3.0.0',
    nombre,
    documento: 'borrador_chandra',
    campos,
    validaciones: [],
    ...(truncada ? { meta: { estado: 'validando' as const, validacion: 'borrador truncado a 120 campos' } } : {}),
  };
  if (!esMoldeUniversal(molde)) {
    return { molde: null, errores: erroresMolde(molde), resumen };
  }
  return { molde, errores: [], resumen };
}

// ---- CLI ----
const [, , entrada, salida] = process.argv;
if (!entrada || !salida) {
  console.log('Uso: bun run scripts/importar-borrador.ts <entrada-chandra.json> <salida-molde.json>');
  process.exit(0);
}
const parseado: unknown = JSON.parse(readFileSync(entrada, 'utf8'));
const { molde, errores, resumen } = mapearBorrador(parseado as EntradaChandra);
if (!molde) {
  console.error('Borrador inválido:', errores);
  process.exit(1);
}
writeFileSync(salida, JSON.stringify(molde, null, 2) + '\n');
console.log(`Borrador v3 escrito en ${salida} — campos: ${molde.campos.length}`, resumen);
console.log('Siguiente paso: pegar el JSON en Molde Studio (Aplicar JSON) y calibrar a mano.');
