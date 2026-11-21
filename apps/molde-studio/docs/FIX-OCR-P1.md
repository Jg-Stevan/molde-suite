# FIX P1 aplicado — OCR auto-hospedado con variante fijada (2026-11-21)

**Origen:** `diagnostico-molde-suite-2026-11-21.md` (sección 2, P1 crítico) y paquete
`molde-suite-fix-ocr.zip` (LEEME-APLICAR-FIX.md).
**Síntoma corregido:** `RuntimeError: Aborted(missing function: _ZN9tesseract13DotProductSSEEPKfS1_i)`
en "Probar Plantilla", "Alinear anclas con OCR" y subida en "Verificación".

---

## 1. Qué se aplicó

### 1.1 Assets auto-hospedados (P1.2 del diagnóstico)

```text
public/tesseract/
├── tesseract-core-simd-lstm.wasm.js   (3.9 MB, single-file, variante segura)
├── tesseract-core-lstm.wasm.js        (3.9 MB, fallback sin SIMD128)
├── worker.min.js                      (tesseract.js v7.0.0 — byte-idéntico al de npm)
└── lang-data/
    └── spa.traineddata.gz             (datos de idioma español)

sha256 (verificados contra CHECKSUMS.txt del paquete):
  c58b46a4…bb  tesseract-core-simd-lstm.wasm.js
  eef5f8b2…ac  tesseract-core-lstm.wasm.js
  576b7df7…6d  worker.min.js
  40be52f9…eb  lang-data/spa.traineddata.gz
```

El OCR ya **no depende de jsDelivr en runtime** (ni para el core ni para el
traineddata: v7 sin `langPath` descargaba `@tesseract.js-data/spa` del CDN).
Todo same-origin, como promete la UI ("OCR local en el navegador").

### 1.2 `src/lib/ocr/ocr-core-resolver.ts` (nuevo)

- Probe oficial SIMD128 (`WebAssembly.validate`) → elige `simd-lstm` o el
  fallback `lstm`. NUNCA devuelve la variante rota `relaxedsimd`.
- Respeta `basePath` (`NEXT_PUBLIC_BASE_PATH`, ej. `/molde-suite` en GH Pages;
  vacío en sandbox/dev).
- `tesseractWorkerOptions()` agrupa `corePath` + `workerPath` + `langPath`.

### 1.3 `src/lib/ocr/ocr-client.ts` (modificado)

1. **`createWorker` con assets fijados:** `...tesseractWorkerOptions()`. Al
   pasar un `corePath` que termina en `.wasm.js`, tesseract.js omite su
   detección de variantes → el binario defectuoso queda inalcanzable.
2. **`errorHandler`:** antes, un reject del worker se relanzaba como excepción
   no controlada en la página (`throw Error(data)` dentro de `onMessage` en
   tesseract.js). Ahora queda capturado y decide la recuperación.
3. **Recuperación ante abort (P1.4 del diagnóstico):** `conRecuperacion()`
   envuelve `ocrLines` / `ocrTextoUnico` / `relecturaId`: si el worker falla →
   `terminate()` + recrear + **UN reintento** (la operación re-aplica sus
   parámetros PSM/whitelist). Si el reintento también falla, el error que sube
   a la UI describe la causa real. `resetOcrWorker()` exportado para forzar
   recreación.
4. **Logger propio (P3):** solo los estados del ciclo de vida ("loading
   tesseract core", "initializing tesseract", "loading language traineddata",
   "initializing api", "recognizing text") alimentan la barra de progreso; todo
   lo demás se degrada a `console.debug`.

### 1.4 Patch del `worker.min.js` auto-hospedado (P3)

El core WASM emite su stderr directamente como `console.error` dentro del
worker ("Estimating resolution as N", "Error in boxClipToRectangle: box
outside rectangle", "Error in pixScanForForeground: invalid box"). El glue de
emscripten acepta overrides `print`/`printErr`, así que al worker auto-hospedado
se le parcheó la única llamada de instanciación (`TesseractProgress`) para
pasar `print`/`printErr` que degradan esos tres prefijos de ruido a
`console.debug("[tesseract-core]", …)` y dejan pasar los errores reales.

**IMPORTANTE:** si algún día se actualiza tesseract.js, hay que regenerar
`public/tesseract/worker.min.js` de la NUEVA versión y re-aplicar este patch
(buscar `TesseractProgress:function` y añadir `print`/`printErr` con el filtro).
Mantener versión fijada, nunca `@latest`.

### 1.5 Clamp de cajas de recorte (P1.3 del diagnóstico)

Ya existía y se conservó: `rectAPx` (motor universal) clampea x0/y0/x1/y1 a los
límites del canvas y rechaza zonas degeneradas (`zona_invalida`); el editor
también clampea en `recortarPreview`; `relecturaId` clampea su padding. Los
mensajes `boxClipToRectangle` que persistan son ruido interno del layout
analysis de Tesseract sobre la página completa (ahora a nivel debug).

---

## 2. Cambios P2 (latencia) y P3 (favicon) incluidos en el mismo push

- **Bundle dividido (P3.4 del diagnóstico):** `page.tsx` carga `EditorTab` y
  `VerificacionTab` con `next/dynamic` (`ssr: false`, fallback "Cargando
  módulo…"). La apertura del editor ya no parsea/ejecuta ambos módulos al
  cargar la página (long tasks de hasta 169 ms medidas).
- **Selección no urgente:** `setCampoSeleccionado` via `startTransition` — el
  pointerdown no bloquea (INP 640 ms medido).
- **Zonas memoizadas:** componente `ZonaCampo` con `React.memo` y props
  primitivas; rects resueltos una vez por render (`rectsPorId`). Al
  seleccionar/mover, solo la zona afectada re-renderiza.
- **mousemove con rAF:** la barra de estado de coordenadas actualiza una vez
  por frame como transición no urgente (antes: setState por evento).
- **Zoom no urgente:** `cambiarZoom` envuelve `setZoom` en `startTransition`.
- **Favicon (P3):** `src/app/icon.png` — Next.js lo sirve en `/molde-suite/`
  respetando el basePath (antes `favicon.ico` → 404).

---

## 3. Cómo verificar tras el deploy de GH Pages

En la máquina original (la que abortaba):

1. DevTools → Network → filtro `tesseract-core`:
   - UNA sola petición a
     `https://jg-stevan.github.io/molde-suite/tesseract/tesseract-core-simd-lstm.wasm.js`
     (HTTP 200, origen propio).
   - **NINGUNA** petición a `cdn.jsdelivr.net/npm/tesseract.js-core` ni a
     `@tesseract.js-data` (traineddata también self-hosted).
2. Editor → "Probar Plantilla" → subir el PDF E-14 de El Cairo:
   - La corrida completa: métricas, recortes y reporte JSON.
   - Consola sin `Aborted(missing function: …DotProductSSE…)`.
3. Repetir "Alinear anclas con OCR".
4. Consola limpia: el ruido del core aparece como `console.debug`
   ("[tesseract-core] …"), no como error.
5. `favicon.ico` → 200 (icon.png con basePath).

---

## 4. Rollback

- Revertir el commit del fix, o simplemente quitar el spread
  `...tesseractWorkerOptions()` en `ocr-client.ts` (vuelve al comportamiento
  jsDelivr/variante por defecto — la variante rota volvería a cargarse en CPUs
  con relaxed-SIMD, no recomendado).
- El resto del código (recuperación, logger, favicon, P2) es independiente y
  puede revertirse por separado sin romper el corePath.
