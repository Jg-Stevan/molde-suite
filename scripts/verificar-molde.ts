/**
 * Arnés de verificación reproducible — FASE 0b (plan extracción relacional).
 *
 * Recorre Studio end-to-end y guarda el Reporte JSON de una corrida:
 *   1. Abre Studio (default http://localhost:3000).
 *   2. Biblioteca → molde «Recibo de pago» → «Abrir en Editor Visual»
 *      → «Probar Plantilla».
 *   3. Sube la imagen de prueba vía el input de Verificación.
 *   4. Espera el fin del pipeline (sin «Cargando corrida...» ni overlay de
 *      progreso).
 *   5. Abre «Reporte JSON», extrae el JSON del diálogo forense.
 *   6. Lo guarda en scripts/resultados/<timestamp>.json.
 *   7. Imprime resumen: score, campos ok/revisión/fallback, banderas.
 *
 * Uso:
 *   bun scripts/verificar-molde.ts [ruta-imagen] [--url http://localhost:3000] [--molde Nombre]
 *
 *   bun scripts/verificar-molde.ts "C:/Users/JG/Downloads/recibo-completo tachado.png"
 *
 * Baseline registrado (main, 2026-11-24): score 33.3 · requiere_revision ·
 * 8/12 campos fuente 'referencia' · firma_emisor y firma_pagador 'ok' conf 0.97
 * en el MISMO rect (falso positivo). El resumen impreso permite comparar contra
 * ese baseline tras cada cambio del motor.
 *
 * RESTRICCIÓN del plan respetada: NO añade dependencias al repo. Playwright
 * se resuelve por import dinámico si el entorno ya lo tiene (instalación a
 * nivel usuario / workspace). Sin Playwright, imprime instrucciones exactas.
 */

import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ---- argumentos ----
// Uso: bun scripts/verificar-molde.ts [ruta-imagen] [--url http://localhost:3000] [--molde Nombre]
const args = process.argv.slice(2);
function argValor(flag: string): string | null {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
}
const URL_STUDIO = argValor('--url') ?? process.env.STUDIO_URL ?? 'http://localhost:3000';
const NOMBRE_MOLDE = argValor('--molde') ?? 'Recibo de pago';
// La imagen es el primer argumento posicional (no flag ni valor de flag).
const IMAGEN =
  args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--url' && args[i - 1] !== '--molde') ??
  'recibo-tachado.png';

const DIR_SALIDA = resolve(import.meta.dir, 'resultados');

interface CampoReporte {
  id: string;
  etiqueta: string;
  estado: string;
  valor: unknown;
  conf: number | null;
  fuente?: string | null;
  banderas?: string[];
  rect?: { x: number; y: number; w: number; h: number } | null;
}
interface ReporteUniversal {
  archivo: string;
  score: number;
  ok_count: number;
  total: number;
  requiere_revision: boolean;
  paginas?: { pagina: number; campos: CampoReporte[] }[];
  validaciones?: { id: string; ok: boolean | null; detalle: string }[];
  obligatorios_faltantes?: string[];
}

async function main(): Promise<void> {
  let pw: { chromium: { launch: (opts?: unknown) => Promise<any> } };
  try {
    // Import dinámico: sin dependencia dura en package.json (regla del plan).
    pw = (await import(/* @vite-ignore */ 'playwright')) as unknown as typeof pw;
  } catch {
    try {
      pw = (await import('playwright-core')) as unknown as typeof pw;
    } catch {
      console.error(`
[arnés] Playwright no está disponible en este entorno.

Este arnés respeta la restricción del plan (NINGUNA dependencia nueva en el
package.json del repo). Opciones para ejecutarlo:

  1) Instalación a nivel usuario (fuera del repo):
       bun add -g playwright && bunx playwright install chromium
     y volver a correr:
       bun scripts/verificar-molde.ts "<ruta-imagen>"

  2) MCP Playwright del dueño (25 tools mcp__chrome:*): pedir al agente que
     siga los PASOS MANUALES equivalentes (mismo flujo que automatiza este
     script) y guardar el JSON en scripts/resultados/.

Pasos que automatiza (referencia manual):
  ${URL_STUDIO} → Biblioteca → «${NOMBRE_MOLDE}» → «Abrir en Editor Visual»
  → «Probar Plantilla» → Verificación → subir imagen → esperar fin de corrida
  → «Reporte JSON» → copiar el JSON del diálogo → scripts/resultados/.
`);
      process.exit(2);
    }
  }

  const absImagen = resolve(process.cwd(), IMAGEN);
  try {
    statSync(absImagen);
  } catch {
    console.error(`[arnés] No existe la imagen de prueba: ${absImagen}`);
    process.exit(2);
  }

  mkdirSync(DIR_SALIDA, { recursive: true });
  console.log(`[arnés] Studio: ${URL_STUDIO} · molde: «${NOMBRE_MOLDE}» · imagen: ${absImagen}`);

  const navegador = await pw.chromium.launch({ headless: true });
  const pagina = await navegador.newPage();
  const erroresConsola: string[] = [];
  pagina.on('console', (msg: { type(): string; text(): string }) => {
    if (msg.type() === 'error') erroresConsola.push(msg.text());
  });
  pagina.on('pageerror', (err: Error) => erroresConsola.push(String(err)));

  try {
    // 1) Biblioteca
    await pagina.goto(URL_STUDIO, { waitUntil: 'domcontentloaded', timeout: 60_000 });

    // 2) Tarjeta del molde → «Abrir en Editor Visual» (anclada por el título).
    const botonAbrir = pagina.getByRole('button', { name: /Abrir en Editor Visual/i }).first();
    await botonAbrir.waitFor({ state: 'visible', timeout: 30_000 });
    // Si hay varias tarjetas, elegir la que contiene el nombre del molde.
    const totalAbrir = await pagina.getByRole('button', { name: /Abrir en Editor Visual/i }).count();
    let elegido = botonAbrir;
    if (totalAbrir > 1) {
      for (let i = 0; i < totalAbrir; i++) {
        const b = pagina.getByRole('button', { name: /Abrir en Editor Visual/i }).nth(i);
        const contexto = b.locator('xpath=ancestor::*[contains(., "' + NOMBRE_MOLDE + '")][1]');
        if ((await contexto.count()) > 0) {
          elegido = b;
          break;
        }
      }
    }
    await elegido.click();
    console.log('[arnés] Editor abierto');

    // 3) «Probar Plantilla» (re-ejecuta la última corrida si la hay).
    const probar = pagina.getByRole('button', { name: /Probar Plantilla/i }).first();
    if (await probar.count()) {
      await probar.click();
      console.log('[arnés] «Probar Plantilla» pulsado');
      await pagina.waitForTimeout(2_000);
    }

    // 4) Subir imagen por el input oculto de Verificación (Playwright ignora
    //    la visibilidad del input). El onChange dispara el pipeline completo.
    const input = pagina.locator('input[type="file"]').first();
    await input.setInputFiles(absImagen);
    console.log('[arnés] Imagen cargada — esperando fin del pipeline (OCR puede tardar minutos)…');

    // 5) Esperar fin: sin «Cargando corrida...» y sin overlay de progreso.
    await pagina
      .getByText('Cargando corrida...')
      .waitFor({ state: 'hidden', timeout: 120_000 })
      .catch(() => {});
    await pagina
      .getByText('Reporte JSON')
      .waitFor({ state: 'visible', timeout: 120_000 })
      .catch(() => {});
    const fin = Date.now() + 8 * 60_000; // OCR de página completa: hasta 8 min
    let ocupadoPrevio = false;
    while (Date.now() < fin) {
      const overlay = await pagina
        .locator('p', { hasText: /^(Procesando\.\.\.|OCR|Página)/ })
        .count();
      const ocupado = overlay > 0;
      if (ocupadoPrevio && !ocupado) break;
      ocupadoPrevio = ocupado;
      await pagina.waitForTimeout(2_000);
    }
    if (ocupadoPrevio) {
      console.error('[arnés] Timeout: el pipeline no terminó a tiempo.');
      process.exit(3);
    }
    console.log('[arnés] Corrida terminada');

    // 6) «Reporte JSON» → extraer del diálogo forense.
    await pagina.getByRole('button', { name: /Reporte JSON/i }).click();
    const dialogo = pagina.locator('[role="dialog"][aria-label*="Reporte forense"]');
    await dialogo.waitFor({ state: 'visible', timeout: 15_000 });
    const texto = (await dialogo.innerText()).trim();
    const inicio = texto.indexOf('{');
    const finJson = texto.lastIndexOf('}');
    if (inicio < 0 || finJson <= inicio) {
      console.error('[arnés] No se pudo extraer el JSON del diálogo.');
      process.exit(4);
    }
    const json = texto.slice(inicio, finJson + 1);
    const reporte = JSON.parse(json) as ReporteUniversal;

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const destino = resolve(DIR_SALIDA, `${stamp}.json`);
    writeFileSync(destino, JSON.stringify(reporte, null, 2), 'utf8');
    console.log(`[arnés] Reporte guardado: ${destino}`);

    // 7) Resumen comparable con el baseline.
    const campos = (reporte.paginas ?? []).flatMap((p) => p.campos);
    const ok = campos.filter((c) => c.estado === 'ok');
    const revision = campos.filter((c) => c.estado === 'requiere_revision');
    const noEncontrado = campos.filter((c) => c.estado === 'no_encontrado');
    const fallback = campos.filter((c) => c.fuente === 'referencia');
    console.log('\n===== RESUMEN =====');
    console.log(`archivo:            ${reporte.archivo}`);
    console.log(`score:              ${reporte.score} (ok ${reporte.ok_count}/${reporte.total})`);
    console.log(`requiere_revision:  ${reporte.requiere_revision}`);
    console.log(`estados:            ok ${ok.length} · revisión ${revision.length} · no_encontrado ${noEncontrado.length}`);
    console.log(`fuente referencia:  ${fallback.length}/${campos.length}`);
    if (reporte.validaciones?.length) {
      for (const v of reporte.validaciones) console.log(`validación ${v.id}: ok=${v.ok} (${v.detalle})`);
    }
    console.log('\n--- campos ---');
    for (const c of campos) {
      console.log(
        `${c.id.padEnd(16)} ${c.estado.padEnd(17)} ${(c.fuente ?? '-').padEnd(10)} ` +
          `conf=${c.conf === null ? '-' : c.conf.toFixed(2)}  banderas=[${(c.banderas ?? []).join(', ')}]`,
      );
    }
    console.log(`\nerrores de consola: ${erroresConsola.length}`);
    if (erroresConsola.length) console.log(erroresConsola.slice(0, 5).join('\n---\n'));

    await navegador.close();
  } catch (err) {
    console.error('[arnés] Fallo:', err);
    try {
      await pagina.screenshot({ path: resolve(DIR_SALIDA, `fallo-${Date.now()}.png`), fullPage: true });
    } catch {}
    await navegador.close();
    process.exit(5);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
