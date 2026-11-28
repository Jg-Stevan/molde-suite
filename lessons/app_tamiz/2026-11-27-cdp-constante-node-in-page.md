---
id: "app_tamiz-a56-cdp-2026-11-27"
plantilla: "n/a (banco de verificación E2E)"
tipo_documento: "medición en el Galaxy A56 por CDP puro"
condicion: "scripts/entrega/auto-molde-a56.mjs sobre build de producción en :3100, adb inalámbrico, Chrome 158"
herramientas_usadas: ["Runtime.evaluate", "Input.dispatchTouchEvent", "Page.captureScreenshot", "/json", "indexedDB.databases()"]
version_motor: "feat/auto-molde (entrega 7)"
resultado: "fallo_robustez"
campos_fallidos: []
metrica: { falsos_negativos: "3 corridas de 669 s «sin tarjeta» que SÍ tenían tarjeta", costo: "~35 min de teléfono y 3 diagnósticos a ciegas" }
---

## Problema observado

El banco esperaba el veredicto y nunca lo veía:

```
recibo: esperando veredicto (669 s)…
ERROR: recibo: sin tarjeta de revisión tras 669 s
```

…mientras la captura del teléfono mostraba la tarjeta completa («2.5/10
RECHAZADA», 12 filas). El `resumen.json` de esa corrida lo confirma: `texto`
sí contenía «RECHAZADA» y `banner` era `null` — el DOM estaba listo, la sonda
no lo veía.

## Causa raíz

Dos errores del HARNESS, no de la app:

1. **Constante de Node dentro de una función in-page.** El sondeo de espera
   hacía `VEREDICTOS.test(t)` con `VEREDICTOS` declarado en el módulo Node. La
   función se serializa con `String(fn)` y se evalúa en la pestaña, donde ese
   identificador NO existe → `ReferenceError: VEREDICTOS is not defined`.
2. **`catch { }` que traga el error.** El loop hacía
   `await tarjetaLista().catch(() => null)`, así que la excepción se convertía
   en «todavía no está» en cada uno de los 150 polls. Sin log, el síntoma era
   indistinguible de un pipeline congelado.

Añadido después: el toast «Nueva versión disponible» (`PwaRegister`) aparece en
cuanto se limpia el SW —Chromium dispara `updatefound` también en la primera
instalación— y la pestaña sigue corriendo el shell anterior.

## Qué funcionó / qué no

- ✅ Imprimir el ERROR de CDP y el `innerText` de la página en cada poll: el
  diagnóstico salió a la primera línea en la corrida siguiente.
- ✅ Pasar las constantes como ARGUMENTOS (`cdp.js((patron) => …, VEREDICTOS.source)`,
  igual que `PROHIBIDAS` y `CLAVES`, que nunca fallaron).
- ✅ `descartarActualizar()`: pulsar «RECARGAR AHORA» y re-esperar el input antes
  de importar. Con eso el escaneo tardó 26-33 s (antes: 669 s).
- ❌ `catch(() => null)` sin registrar el motivo: convierte un bug del banco en
  un falso negativo de 10 minutos.
- ❌ `Network.setCacheDisabled(true)` (corregido en la misma sesión): re-baja
  ~48 MB de modelos y el escaneo pasa de 26 s a 669 s. Usar
  `Network.clearBrowserCache()`.

## Recomendación para próximas plantillas

1. Toda función que se pasa a `cdp.js` debe ser **autocontenida**: cualquier
   valor del lado Node entra por parámetro. Un `ReferenceError` in-page es un
   bug del banco, no de la app.
2. Ningún `catch` de un sondeo sin `progreso()` con el mensaje: un banco que
   falla en silencio cuesta más que el feature que verifica.
3. Después de limpiar el SW, asumir el toast de actualización y recargar antes
   de medir.
