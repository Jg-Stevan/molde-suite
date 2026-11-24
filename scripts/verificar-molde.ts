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
// Etiqueta del artefacto: sin ella el archivo sale con timestamp y nadie sabe
// a qué código ni a qué imagen corresponde (los resultados entregados hubo que
// renombrarlos a mano y perdieron todo vínculo con el commit).
const ETIQUETA = argValor('--etiqueta');
// La imagen es el primer argumento posicional (no flag ni valor de flag).
const IMAGEN_POSICIONAL =
  args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--url' && args[i - 1] !== '--molde') ?? null;
const IMAGEN = IMAGEN_POSICIONAL ?? 'recibo-tachado.png';
// Con imagen propia el pipeline arranca con la subida: «Probar Plantilla»
// solo re-ejecutaría la corrida anterior (y contaminaría la señal de fin).
const imagenPropia = IMAGEN_POSICIONAL !== null;

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
  ok_count?: number;
  total?: number;
  requiere_revision: boolean;
  // El diálogo forense de Studio emite `campos` plano; el reporte crudo del motor
  // emite `paginas[].campos`. El arnés acepta AMBAS formas (antes solo la
  // segunda, así que imprimía 0 campos sobre sus propios artefactos).
  paginas?: { pagina: number; campos: CampoReporte[] }[];
  campos?: CampoReporte[];
  molde?: string;
  fecha?: string;
  validaciones?: { id: string; ok: boolean | null; detalle: string }[];
  obligatorios_faltantes?: string[];
}

/** Banderas que anulan la lectura: el campo NO es un acierto genuino. */
export const BANDERAS_NO_LECTURA = ['ancla_no_encontrada', 'ocr_vacio', 'zona_vacia', 'fallback_no_verificado'];

export function normalizarCampos(r: ReporteUniversal): CampoReporte[] {
  return r.campos ?? (r.paginas ?? []).flatMap((p) => p.campos);
}

/**
 * Métricas recalculadas AQUÍ, desde los estados y banderas del reporte. No se
 * copian del motor: el motor ya no puntúa `no_encontrado`, pero un campo
 * opcional o con la banda vacía puede llegar a `ok` por rutas distintas, y el
 * arnés tiene que poder discrepar (motivo de esta corrección: el 50.0 de la
 * entrega contaba `importe_texto` = "o" con conf 0.14 como acierto).
 */
export function metricas(campos: CampoReporte[]) {
  const ok = campos.filter((c) => c.estado === 'ok');
  const sucias = ok.filter((c) => (c.banderas ?? []).some((b) => BANDERAS_NO_LECTURA.includes(b)));
  const vacias = ok.filter(
    (c) => (c.valor === null || c.valor === undefined || String(c.valor).replace(/[^A-Za-z0-9ÁÉÍÓÚÑáéíóúñü]/g, '').length < 2) && c.valor !== true,
  );
  const noGenuinas = new Set([...sucias, ...vacias].map((c) => c.id));
  return {
    total: campos.length,
    ok: ok.length,
    score: campos.length ? Math.round((ok.length / campos.length) * 1000) / 10 : 0,
    score_genuino: campos.length
      ? Math.round(((ok.length - noGenuinas.size) / campos.length) * 1000) / 10
      : 0,
    no_genuinas: [...noGenuinas],
  };
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

    // 3) «Probar Plantilla» SOLO si no venía imagen: re-ejecuta la última
    //    corrida. Con imagen propia es un desperdicio (2-4 min de OCR) y su
    //    persistencia competía con la de nuestra corrida en el paso 5.
    const probar = pagina.getByRole('button', { name: /Probar Plantilla/i }).first();
    if (!imagenPropia && (await probar.count())) {
      await probar.click();
      console.log('[arnés] «Probar Plantilla» pulsado (sin imagen propia)');
      await pagina.waitForTimeout(2_000);
    }

    // 4) Subir imagen por el input oculto de Verificación (Playwright ignora
    //    la visibilidad del input). El onChange dispara el pipeline completo.
    //    Señal de fin: al terminar, el cliente PERSISTE la corrida (POST
    //    /api/pruebas, o PUT si re-ejecuta en sitio). Se promete ANTES de
    //    subir para no perderla si llega rápido.
    const persistida = pagina
      .waitForResponse(
        (r) =>
          r.url().includes('/api/pruebas') &&
          ['POST', 'PUT'].includes(r.request().method()) &&
          r.status() < 400,
        { timeout: 8 * 60_000 },
      )
      .catch(() => null);
    const input = pagina.locator('input[type="file"]').first();
    await input.setInputFiles(absImagen);
    console.log('[arnés] Imagen cargada — esperando fin del pipeline (OCR puede tardar minutos)…');

    // 5) Esperar fin: la persistencia (determinista) y, después, tres sondeos
    //    sin overlay. El heurístico busy→idle del original NUNCA salía si el
    //    pipeline terminaba antes del primer sondeo: el arnés agotaba los 8 min
    //    y moría en exit 3 sin artefacto (perdido real en una corrida de control).
    await pagina
      .getByText('Cargando corrida...')
      .waitFor({ state: 'hidden', timeout: 120_000 })
      .catch(() => {});
    const fin = Date.now() + 8 * 60_000; // OCR de página completa: hasta 8 min
    const ocupado = () =>
      pagina.locator('p', { hasText: /^(Procesando\.\.\.|OCR|Página)/ }).count().then((c) => c > 0);
    const respuesta = await persistida;
    if (respuesta) console.log(`[arnés] Corrida persistida (${respuesta.request().method()} ${respuesta.status()})`);
    else console.warn('[arnés] Sin señal de persistencia: me guío solo por el overlay.');
    let quietas = 0;
    while (Date.now() < fin && quietas < 3) {
      quietas = (await ocupado()) ? 0 : quietas + 1;
      await pagina.waitForTimeout(2_000);
    }
    if (quietas < 3) {
      console.error('[arnés] Timeout: el pipeline no terminó a tiempo.');
      process.exit(3);
    }
    console.log('[arnés] Corrida terminada');

    // 6) Fuente del reporte: la corrida PERSISTIDA por la app. El diálogo
    //    forense se quedó mostrando la corrida ANTERIOR mientras la UI no
    //    refrescaba: una corrida medida como 50.0 por el diálogo era 33.3 en
    //    la BD (con las firmas ya en requiere_revision). Leer la BD del
    //    propio Studio elimina esa clase de mentira.
    let reporte: ReporteUniversal | null = null;
    if (respuesta) {
      try {
        const cuerpo = (await respuesta.json()) as { id?: string };
        if (cuerpo?.id) {
          const d = (await fetch(`${URL_STUDIO}/api/pruebas/${cuerpo.id}`).then((x) => x.json())) as {
            score?: number;
            requiere_revision?: boolean;
            resultados?: unknown;
          };
          const r = (typeof d.resultados === 'string' ? JSON.parse(d.resultados) : d.resultados) as
            | ReporteUniversal
            | null;
          if (r) {
            r.score = r.score ?? d.score ?? 0;
            r.requiere_revision = r.requiere_revision ?? d.requiere_revision ?? false;
            reporte = r;
            console.log(`[arnés] Reporte de la corrida persistida ${cuerpo.id}`);
          }
        }
      } catch (e) {
        console.warn('[arnés] No se pudo leer la corrida persistida:', e);
      }
    }
    if (!reporte) {
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
      reporte = JSON.parse(texto.slice(inicio, finJson + 1)) as ReporteUniversal;
      console.warn('[arnés] Reporte tomado del DIÁLOGO (sin persistencia): puede estar obsoleto.');
    }
    if (!reporte) {
      console.error('[arnés] Sin reporte (ni persistido ni diálogo).');
      process.exit(4);
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const nombre = `${ETIQUETA ? ETIQUETA + '-' : ''}${stamp}.json`;
    const destino = resolve(DIR_SALIDA, nombre);
    const campos = normalizarCampos(reporte);
    const m = metricas(campos);
    const git = (argsGit: string[]) =>
      Bun.spawnSync({ cmd: ['git', ...argsGit], cwd: import.meta.dir }).stdout.toString().trim();
    const escrito = {
      // Metadatos de trazabilidad: sin esto un JSON de resultados no dice ni de
      // qué código salió ni con qué imagen, y la comparación queda en el aire.
      _meta: {
        generado_por: 'scripts/verificar-molde.ts',
        fecha_iso: new Date().toISOString(),
        commit: git(['rev-parse', 'HEAD']),
        rama: git(['rev-parse', '--abbrev-ref', 'HEAD']),
        url_studio: URL_STUDIO,
        imagen: absImagen,
        molde_etiqueta: NOMBRE_MOLDE,
        score_arnes: m.score,
        score_genuino_arnes: m.score_genuino,
        campos_no_genuinos: m.no_genuinas,
      },
      ...reporte,
    };
    writeFileSync(destino, JSON.stringify(escrito, null, 2), 'utf8');
    console.log(`[arnés] Reporte guardado: ${destino}`);

    // 7) Resumen comparable con el baseline.
    const ok = campos.filter((c) => c.estado === 'ok');
    const revision = campos.filter((c) => c.estado === 'requiere_revision');
    const noEncontrado = campos.filter((c) => c.estado === 'no_encontrado');
    const fallback = campos.filter((c) => c.fuente === 'referencia');
    const soloTexto = campos.filter((c) => (c.banderas ?? []).includes('ancla_solo_textual'));
    console.log('\n===== RESUMEN =====');
    console.log(`archivo:            ${reporte.archivo}`);
    console.log(`score motor:        ${reporte.score} (ok ${reporte.ok_count ?? ok.length}/${reporte.total ?? m.total})`);
    console.log(`score arnés:        ${m.score}  ·  genuino: ${m.score_genuino} (ok ${m.ok}/${m.total})`);
    if (m.no_genuinas.length) console.log(`  ok no genuinos:   ${m.no_genuinas.join(', ')}`);
    console.log(`requiere_revision:  ${reporte.requiere_revision}`);
    console.log(`estados:            ok ${ok.length} · revisión ${revision.length} · no_encontrado ${noEncontrado.length}`);
    console.log(`fuente referencia:  ${fallback.length}/${campos.length}`);
    console.log(`anclas solo-texto:  ${soloTexto.length}/${campos.length}  (bypass posicional)`);
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

if (import.meta.main) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
