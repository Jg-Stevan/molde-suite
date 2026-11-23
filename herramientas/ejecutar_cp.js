#!/usr/bin/env node
/**
 * Matriz CP-01..CP-20 de /generico/ contra Tamiz (:3100) con Playwright.
 * Cada caso: selecciona molde → sube imágenes → VERIFICAR → espera veredicto
 * → captura PNG completa → intercepta la descarga del reporte JSON → valida.
 */
const { chromium } = require('/home/z/.npm-global/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');

const RAIZ = '/home/z/molde-suite-work';
const INSUMOS = path.join(RAIZ, 'insumos-cp');
const EVID = path.join(RAIZ, 'evidencias');
const REPORTES = path.join(RAIZ, 'reportes');
fs.mkdirSync(EVID, { recursive: true });
fs.mkdirSync(REPORTES, { recursive: true });

const MOLDES = {
  comp: 'Comprobante de entrega del producto',
  rec: 'Recibo de pago',
  e22: 'E-22 Resolución de la Comisión Escrutadora',
  e24: 'E-24 Cuadro de resultados del escrutinio',
  e26: 'E-26 Acta parcial del escrutinio municipal',
};

const CASOS = [
  ['CP-01', 'comp', ['comprobante-a-firmado.png'], ['ADVERTENCIA'], 420],
  ['CP-02', 'comp', ['comprobante-b-llenado.png'], ['ADVERTENCIA'], 420],
  ['CP-03', 'comp', ['comprobante-c-completado.png'], ['ADVERTENCIA'], 420],
  ['CP-04', 'comp', ['comprobante-a-sin-firmar.png'], ['RECHAZADA'], 420],
  ['CP-05', 'rec', ['recibo-a-firmado.png'], ['ADVERTENCIA'], 420],
  ['CP-06', 'rec', ['recibo-b-llenado.png'], ['ADVERTENCIA'], 420],
  ['CP-07', 'rec', ['recibo-c-completado.png'], ['ADVERTENCIA'], 420],
  ['CP-08', 'rec', ['recibo-c-sin-llenar.png'], ['RECHAZADA'], 420],
  ['CP-09', 'e22', ['e22-p1.png', 'e22-p2.png'], ['OPTIMA', 'ADVERTENCIA'], 600],
  ['CP-10', 'e22', ['e22-p1.png'], ['RECHAZADA'], 600],
  ['CP-11', 'e22', ['e22-slot1-p2.png', 'e22-slot2-p1.png'], ['RECHAZADA'], 600],
  ['CP-12', 'e24', ['e24-p1.png', 'e24-p2.png'], ['OPTIMA', 'ADVERTENCIA'], 600],
  ['CP-13', 'e24', ['e24-slot1-p2.png', 'e24-slot2-p1.png'], ['RECHAZADA'], 600],
  ['CP-14', 'e26', ['e26-p1.png', 'e26-p2.png', 'e26-p3.png', 'e26-p4.png', 'e26-p5.png', 'e26-p6.png'], ['OPTIMA', 'ADVERTENCIA'], 900],
  ['CP-15', 'e26', ['e26-p1.png', 'e26-p2.png', 'e26-p3.png', 'e26-p5.png', 'e26-p6.png'], ['RECHAZADA'], 900],
  ['CP-16', 'e26', ['e26-p1.png', 'e26-p2.png', 'e26-slot3-duplicado-p2.png', 'e26-p4.png', 'e26-p5.png', 'e26-p6.png'], ['RECHAZADA'], 900],
  ['CP-17', 'e26', ['e26-slot-1.png', 'e26-slot-3.png', 'e26-slot-2.png', 'e26-slot-4.png', 'e26-slot-5.png', 'e26-slot-6.png'], ['RECHAZADA'], 900],
  ['CP-18', 'e22', ['e17-ajeno.png'], ['RECHAZADA'], 600],
  ['CP-19', 'e26', ['e26-p1.png', 'e26-p2.png', 'e26-p3.png', 'e26-p4.png', 'e26-p5.png', 'e26-p6-rotada180.png'], ['OPTIMA', 'ADVERTENCIA'], 900],
  ['CP-20', 'e26', ['e26-p1.png', 'e26-p2.png', 'e26-p3.png', 'e26-p4.png', 'e26-p5.png', 'e26-p6.png'], ['OPTIMA', 'ADVERTENCIA'], 900],
  ['CP-20b', 'e26', ['e26-p1.png', 'e26-p2.png', 'e26-p3.png', 'e26-p4.png', 'e26-p5.png', 'e26-p6.png'], ['OPTIMA', 'ADVERTENCIA'], 900],
  ['CP-20c', 'e26', ['e26-p1.png', 'e26-p2.png', 'e26-p3.png', 'e26-p4.png', 'e26-p5.png', 'e26-p6.png'], ['OPTIMA', 'ADVERTENCIA'], 900],
];

const VEREDICTO_RE = /(ÓPTIMA|ADVERTENCIA|RECHAZADA)/;

async function main() {
  const solo = process.argv.slice(2);
  const casos = CASOS.filter(([id]) => !solo.length || solo.includes(id));
  const navegador = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const ctx = await navegador.newContext({ viewport: { width: 480, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const erroresConsola = [];
  page.on('pageerror', (e) => erroresConsola.push('pageerror: ' + String(e).slice(0, 200)));
  page.on('console', (m) => {
    if (m.type() === 'error') erroresConsola.push('console: ' + m.text().slice(0, 200));
  });

  await page.goto('http://localhost:3100/generico/', { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForSelector('#molde', { timeout: 60000 });
  await page.waitForTimeout(3000); // hidratación de React en dev

  const resumen = [];
  for (const [cid, claveMolde, archivos, esperado, timeoutMs] of casos) {
    const t0 = Date.now();
    const fila = { id: cid, molde: MOLDES[claveMolde], imagenes: archivos.length, esperado };
    console.log(`\n===== ${cid} (${claveMolde}) × ${archivos.length} =====`);
    try {
      // recarga fresca por caso: memoria y estado limpios
      await page.goto('http://localhost:3100/generico/', { waitUntil: 'networkidle', timeout: 120000 });
      await page.waitForTimeout(1500);
      // seleccionar molde (el select dispara reiniciar() con React onChange)
      await page.selectOption('#molde', MOLDES[claveMolde]);
      await page.waitForTimeout(400);

      // subir imágenes por el input de galería (2.º input file, sin capture)
      const inputs = page.locator('input[type="file"][accept="image/*"]');
      const galeria = inputs.nth(1);
      const rutas = archivos.map((a) => path.join(INSUMOS, cid, a));
      await galeria.setInputFiles(rutas);
      await page.waitForTimeout(500);

      const textoBtn = await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((x) => /Verificar \d+ hoja/.test(x.textContent));
        return b ? b.textContent.trim() : 'NO-BOTON';
      });
      const mHojas = textoBtn.match(/Verificar (\d+)/);
      if (!mHojas || Number(mHojas[1]) !== archivos.length) {
        throw new Error(`botón dice "${textoBtn}" pero esperaba ${archivos.length} hojas; cuerpo: ${(await page.evaluate(() => document.body.innerText.slice(0, 400))).replace(/\n/g, " | ")}`);
      }

      // interceptar la descarga del reporte ANTES de verificar
      const promesaDescarga = page.waitForEvent('download', { timeout: timeoutMs * 1000 });

      await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((x) => /Verificar \d+ hoja/.test(x.textContent));
        b.click();
      });

      // esperar veredicto
      await page.waitForFunction((src) => new RegExp(src).test(document.body.innerText), VEREDICTO_RE.source, { timeout: timeoutMs * 1000 });
      const texto = await page.evaluate(() => document.body.innerText);
      const veredicto = texto.match(VEREDICTO_RE)[1];
      const duracion = (Date.now() - t0) / 1000;

      // evidencia (pantalla completa)
      await page.screenshot({ path: path.join(EVID, `${cid}.png`), fullPage: true });

      // descargar reporte via el botón de la app (descarga real del navegador)
      let datos = null;
      try {
        await page.evaluate(() => {
          const b = [...document.querySelectorAll('button')].find((x) => /Descargar reporte JSON/.test(x.textContent));
          if (b) b.click();
        });
        const descarga = await promesaDescarga;
        const ruta = path.join(REPORTES, `${cid}.json`);
        await descarga.saveAs(ruta);
        datos = JSON.parse(fs.readFileSync(ruta, 'utf8'));
      } catch (e) {
        console.log('  (descarga no capturada: ' + String(e).slice(0, 80) + ')');
      }

      fila.obtenido = veredicto;
      fila.resultado = esperado.includes(veredicto) ? 'PASS' : 'FAIL';
      fila.duracion_s = Math.round(duracion * 10) / 10;
      fila.reporte_json = Boolean(datos);
      if (datos) {
        fila.faltantes_duros = datos.faltantes_duros;
        fila.paginas_faltantes = datos.paginas_faltantes;
        fila.por_revisar_n = (datos.por_revisar || []).length;
        fila.score = datos.metricas && datos.metricas.score;
        fila.tiempos = datos.metricas && datos.metricas.tiempos;
      }
      console.log(`  -> ${veredicto} (esperado ${JSON.stringify(esperado)}) ${fila.resultado} ${duracion.toFixed(0)}s reporte=${fila.reporte_json ? 'sí' : 'NO'}`);

      // nueva captura para el siguiente caso
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((x) => /Nueva captura/.test(x.textContent));
        if (b) b.click();
      });
      await page.waitForTimeout(600);
    } catch (e) {
      fila.resultado = 'ERROR';
      fila.error = String(e).slice(0, 300);
      try {
        await page.screenshot({ path: path.join(EVID, `${cid}.png`), fullPage: true });
      } catch {}
      console.log(`  -> ERROR ${String(e).slice(0, 180)}`);
      try {
        await page.evaluate(() => {
          const b = [...document.querySelectorAll('button')].find((x) => /Nueva captura/.test(x.textContent));
          if (b) b.click();
        });
      } catch {}
      await page.waitForTimeout(600);
    }
    resumen.push(fila);
  }

  // prueba de humo E-14 (regresión): abrir la home y leer el shell
  let regresion = { resultado: 'OK', notas: '' };
  try {
    await page.goto('http://localhost:3100/', { waitUntil: 'networkidle', timeout: 90000 });
    await page.waitForTimeout(3000);
    const vistasVisitadas = [];
    let enlaceGenerico = false;
    for (const vista of ['REVISIÓN', 'ACTAS', 'RESUMEN', 'MOLDES', 'ESCANEAR']) {
      try {
        await page.evaluate((nombre) => {
          const b = [...document.querySelectorAll('button, a')]
            .find((x) => x.textContent.trim().toUpperCase().includes(nombre));
          if (b) b.click();
        }, vista);
        await page.waitForTimeout(1200);
        vistasVisitadas.push(vista);
        const texto = await page.evaluate(() => document.body.innerText.toUpperCase());
        if (texto.includes('MOLDES INCLUIDOS') || texto.includes('VERIFICAR CON MOLDES INCLUIDOS')) enlaceGenerico = true;
      } catch {}
    }
    const textoFinal = await page.evaluate(() => document.body.innerText.toUpperCase());
    const sinErrores = !textoFinal.includes('APPLICATION ERROR');
    regresion = {
      resultado: vistasVisitadas.length >= 4 && sinErrores ? 'OK' : 'REVISAR',
      notas: `Vistas abiertas: ${vistasVisitadas.join(', ')}. Enlace a /generico/ visible en MOLDES: ${enlaceGenerico ? 'sí' : 'no'}. Sin error de aplicación: ${sinErrores ? 'sí' : 'no'}.`,
    };
    await page.screenshot({ path: path.join(EVID, 'regresion-e14.png'), fullPage: true });
  } catch (e) {
    regresion = { resultado: 'ERROR', notas: String(e).slice(0, 200) };
  }

  fs.writeFileSync(
    path.join(REPORTES, 'resumen-cp.json'),
    JSON.stringify({ casos: resumen, regresion_e14: regresion, errores_consola: erroresConsola.slice(0, 30) }, null, 2),
  );
  console.log('\n==== RESUMEN ====');
  for (const r of resumen) {
    console.log(`  ${r.id.padEnd(7)} ${r.resultado} ${r.obtenido || ''} ${r.error || ''}`);
  }
  console.log(`  E14     ${regresion.resultado} ${regresion.notas}`);
  if (erroresConsola.length) console.log(`  errores de consola capturados: ${erroresConsola.length}`);
  await navegador.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
