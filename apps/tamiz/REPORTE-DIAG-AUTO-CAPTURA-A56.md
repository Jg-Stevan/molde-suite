# Diagnóstico de campo · auto-captura rota en el Galaxy A56 (SM-A566E)

Medición: 2026-11-24, Chrome Android sobre `http://localhost:3100` (dev server +
`adb reverse`), acta encuadrada a ~35 cm sostenida con la mano normal.
Instrumentos: telemetría por frame (`window.__e14Telemetria`) + sonda pasiva de
`devicemotion` inyectada por CDP (no toca el código de la app).
Registro crudo: `medir.mjs` (60 s, 148 lecturas de gate, 2360 eventos de sensor).

---

## 1. Veredicto en una línea

**El gate de detección no está roto: dispara, y la captura se tira a la basura
después del disparo.** Hay un deadlock de candado entre `capturarInteligente` y
`despacharArchivo`, y el camino afectado es exactamente el que usa la lente
principal (foto con candidatos ZSL/burst).

## 2. Evidencia medida

### 2.1 Histograma de gates durante 60 s con papel en encuadre

| `block` (motivo del no-disparo) | lecturas |
|---|---|
| `rearm` (pendiente tras disparar) | **73** |
| `k-de-n:last-bad` | 31 |
| `sin-quad` | 24 |
| `k-de-n:sustain` | 9 |
| `none` (**disparo real**) | **4** |
| `k-de-n:not-enough-good` | 4 |
| `k-de-n:ok` (rezago de telemetría de 1 frame) | 2 |
| `cooldown` | 1 |

- Marcos con quad detectado: **125/148**.
- `block=motion`: **0 lecturas**.
- `block=edge`: **0 lecturas**.

Lectura: el k-de-n llega a `ok` y el loop llama `cb.onTrigger()` 4 veces. Después
de cada disparo el loop entra en `rearm` y **se queda ahí 23 s seguidas** (score
0.85–0.92, nunca cae bajo 0.8 porque el papel no se movió), sin que la app cambie
de vista ni aparezca el acta. Es decir: el disparo se pierde aguas abajo.

### 2.2 Calidad por frame (lo que ve el motor)

`score` en mano firme = 0.87–0.92 con `sharpness=1.0`, `exposure=0.60–0.75`,
`stability=0.93–0.99`, `eccentricity=1.0`. FPS efectivo de análisis **5–7**
(con `precision=true`, worker de OpenCV listo, `dropped` ≈1 en toda la sesión).

Consecuencia práctica: la ventana de 1200 ms acumula 6–8 muestras y el k dinámico
pide 5–6 buenas → el disparo tarda **~1.3–1.5 s** de encuadre estable. Los 31
`last-bad` son por los bajones de `stability` a 0 cuando el hueco entre muestras
supera la ventana de 600 ms (a 5–6 fps pasa seguido): no es un fallo, es el
precio del backpressure, y llega a disparar igualmente.

### 2.3 Temblor medido en el A56 (raw, sin filtrar)

`devicemotion` **sí llega**: 2376 eventos en 60 s = **37.3 Hz**, con
`acceleration` y `rotationRate` poblados (0 eventos nulos).

| señal | p50 | p90 | p99 | max |
|---|---|---|---|---|
| aceleración lineal (m/s²) | 0.224 | **1.828** | 4.852 | 14.588 |
| rotación (deg/s) | 4.628 | **50.335** | 157.223 | 284.032 |
| gravedad incl. (m/s²) | 9.838 | 10.416 | 12.508 | 22.568 |

Eventos fuera de quietud con los umbrales actuales (`acc>1.25` o `rot>14`):
**652/2360 = 27.6 % del tiempo**.

Lectura para el anti-temblor: el temblor fisiológico (4–8 Hz) cruza los umbrales
casi a diario, pero **hoy no está bloqueando nada** porque la compuerta solo se
evalúa en el frame candidato. Aun así es un dado: `stableSince` se reinicia con
UN pico y exige 280 ms de calma absoluta, así que el disparo depende de la suerte
de en qué fase del ciclo del temblor cae el frame.

## 3. Causa raíz (código)

Flujo real de una captura automática:

1. `frame-loop.ts:441` → `cb.onTrigger()`.
2. `useSesionCamara.ts:237-250` → filtros OK (`auto=true`, `procesando=false`,
   `cooldown=0`, sin import pendiente, sin análisis en vuelo) →
   `capturarRef.current()`.
3. `ScanView.tsx:414` → `if (procesandoRef.current) return;` pasa.
4. `ScanView.tsx:418` → **`procesandoRef.current = true`** (candado "captura en vuelo").
5. `ScanView.tsx:433` → `tomarFoto()` devuelve un Blob (en tamiz la foto sale del
   `<video>` por canvas; siempre funciona con la cámara viva).
6. `ScanView.tsx:442` → `despacharArchivo(fotoBlob, true)`.
7. `useDestello.ts:47` → **`if (procesandoRef.current) return;`** → **retorna sin
   hacer nada**. La foto se descarta, el escaneo nunca arranca y
   `procesandoRef` queda en `true` **para siempre** (solo se reseteaba en las
   ramas de fallo, `ScanView.tsx:464/468/487`, que esta ruta no pisa).

Efecto global: el primer disparo (automático o botón) mata la cámara hasta salir y
re-entrar del visor. El único camino que sobrevivía era el de `candidatos.length
=== 0` (`ScanView.tsx:458-466`), que llama `dispararEscaneo()` directamente y sí
libera el candado — por eso a veces "CAPTURA RECIBIDA · PASANDO A ANÁLISIS" aparecía
y otras veces no pasaba nada.

Confirmado en vivo tras la medición:

```json
{"procesando":true,"auto":true,"cooldownMs":0,"block":"sin-quad"}
```

`procesando` clavado en `true` con el cooldown a cero y el visor todavía en ESCANEAR.

## 4. Cambios YA aplicados (árbol sucio, sin commitear)

Ninguno toca la heurística del k-de-n ni los umbrales de score. El candado se
dividió en **dos dueños distintos** (revisión externa aceptada): uno para el
obturador y otro para el análisis. Antes era UN solo flag usado con dos
significados, y eso es lo que rompía el rele.

1. **`ScanView.tsx`** — nuevo `capturandoRef` (candado del obturador) junto al
   `procesandoRef` (candado del análisis). `capturarInteligente` toma SOLO el
   suyo, hace todo el trabajo dentro de `try` y lo suelta en `finally`; las dos
   líneas de "rele" (soltar el candado justo antes del hand-off) desaparecieron.
   `setProcesando(false)` queda únicamente en las ramas de fallo, que son las
   únicas que no despachan archivo.
2. **`useDestello.ts:47`** — `despacharArchivo` toma `procesandoRef` (análisis en
   vuelo) y lo libera en el `finally` de `dispararEscaneo()`. Se acabó el
   early-return que descartaba en silencio la foto ZSL/burst.
3. **`useSesionCamara.ts`** — el guard de `onTrigger` revisa AMBOS candados
   (`capturando` y `procesando`); el cleanup de la sesión resetea
   `procesandoRef`, `capturandoRef` y `cooldownRef` (paridad con upstream
   `useSesionCamara.ts:1111-1112`), así ningún candado sobrevive al ciclo de la
   cámara.
4. **`useSelectorFuente.ts`** — recibe `capturandoRef` y no cambia de fuente
   mientras el obturador o el análisis están ocupados.
5. Telemetría (diagnóstico, no comportamiento): `frame-loop.ts` publica
   `lastBlock` con el motivo exacto del no-disparo (`rearm`, `cooldown`,
   `k-de-n:<motivo>`, `motion` con `acc`/`calmMs`, `edge`, `sin-quad`, `none`) y
   `useSesionCamara.ts` lo estampa en `window.__e14Telemetria` junto a `shutter`,
   `auto`, `capturando`, `procesando` y `cooldownMs`.

## 5. Paridad con digielect14 (verificada por diff, no por memoria)

Contra `Jg-Stevan/e14-suite@HEAD`, `apps/digielect14/src/lib/e14/core/`:

- `quality.ts` → idéntico salvo el path del import (`@molde-suite/...`).
- `frame-loop.ts` → idéntico antes de añadir la telemetría de solo-lectura.
- `motion-stabilizer.ts` → **idéntico otra vez**: el paso-bajo anti-temblor se
  implementó, se midió y se revirtió (§6).

O sea: el motor del gate ya era porte fiel. El bug es propio del porte de tamiz
en la capa de captura/dispatch.

## 6. Filtro anti-temblor: se implementó, se midió y SE REVIRTIÓ

Por pedido del dueño se quedó con la compuerta **tal cual la trae digielect14**
(`motion-stabilizer.ts` idéntico a upstream, `diff` = 0 diferencias). El pedido
nació de un malentendido (hablaba del B/N de imagen, §8), pero la reversión se
defiende sola con la medición. El motivo es la medición, no la pereza:

- Lo que se había añadido (ya fuera del árbol): paso-bajo EMA de 1.er orden sobre
  `acceleration`/`rotationRate` con α derivada del `dt` real (`α = dt/(τ+dt)`,
  τ = 170 ms), compuerta sobre la señal filtrada (0.9 m/s² / 22 deg/s) y corte de
  emergencia en crudo (3.0 / 90).
- Con ese filtro instalado se corrieron dos corridas completas de 3 bloques
  quietos + 3 bloques de barrido (`temblor.log`, `temblor2.log`). **Lecturas de
  `block=motion`: 0 en los seis bloques**, tanto en los quietos como en los de
  barrido. El filtro nunca tuvo trabajo que hacer.
- Lo que sí rechazó los barridos son las capas que ya estaban en digielect: en los
  bloques de barrido dominaron `sin-quad` (20–30 de ~40 sondeos) y
  `k-de-n:last-bad` (18–34) — al mover el teléfono se pierde el cuadrilátero y
  cae la calidad antes de que la quietud importe. Umbral seco viejo: 0.0 % del
  tiempo por encima de 1.25 m/s² en esas tomas.

Conclusión: sobre este dispositivo el paso-bajo no cambió ninguna decisión
observable, así que no justifica complejidad ni riesgo en otros teléfonos
(el p90 de 1.83 m/s² con picos de 14.6 que midió §2.3 es real, pero en las
corridas de captura nunca llegó a bloquear un disparo que debiera bloquearse).
Si en el uso de campo aparece el caso "mano firme y no dispara", se retoma desde
`git log`, que el código quedó descrito aquí.

**Hallazgo aparte (comportamiento de upstream, no introducido aquí):** al volver
de REVISIÓN se remonta un `CameraFrameLoop` nuevo con `rearmNeeded = false`, así
que si el papel **sigue encuadrado** el gate dispara otra vez en el primer
segundo. Es lo que falseó la primera versión de esta prueba y es una decisión de
diseño de digielect que queda sin tocar.

## 7. Verificación en el dispositivo

1. **Ciclo completo y re-armado — OK.** Con `ciclo2.mjs` sobre el motor nuevo:
   recarga → 1ª acta en REVISIÓN (t+0.2 s) → clic a "volver al menú de escaneo" →
   visor ESCANEAR (t+1.9 s) → el k-de-n re-evalúa (`last-bad` → `sustain`) →
   **2ª auto-captura a los t+3.4 s sin tocar nada** → 2ª REVISIÓN a los t+12.2 s.
   Cero bloqueos por `motion` en toda la corrida. (Un intento anterior de este
   mismo test daba "re-arme funciona" por un falso positivo del script: la misma
   iteración marcaba el regreso al visor y la segunda acta; reescrito con
   estados `PRIMERA → VOLVIMOS → SALIMOS_DE_R → SEGUNDA`, el resultado es real.)
2. **Service Worker — OK.** `sw.js` precachea los tres núcleos LSTM
   (`lstm`, `simd-lstm`, `relaxedsimd-lstm`): el A56 niega `simd` y pide
   `relaxedsimd`, por eso el 404 solo aparecía en ese teléfono. En la corrida
   verificada el OCR sirvió `tesseract-core-relaxedsimd-lstm.wasm.js` desde
   `/vendor` con 200 OK.
3. **Compuerta de quietud — OK con el código de digielect.** 3 tomas quietas +
   3 barridos: las quietas capturaron, ningún barrido produjo una foto con
   `block=none`, y `motion` no apareció ni una vez (§6).

### Checks locales tras la reversión

`tsc --noEmit` 0 errores · `eslint` limpio en los 6 archivos tocados ·
`bun test` 33/33 (152 aserciones).

### Pendiente

Commit en `port/deteccion-digielect` y PR (**push solo con autorización
explícita**). `_headers` ya está resuelto: COOP + COEP para el
SharedArrayBuffer del wasm multihilo y `unsafe-eval` en el CSP, que es lo que
permite que el core emscripten de OpenCV arranque en el worker.

## 8. Capa de IMAGEN: el porte se había inventado su propio B/N

Petición del dueño: dejar solo el filtrado de digielect. Al comparar contra
`apps/digielect14/src/lib/e14/pipeline.ts` y
`packages/scanner-core/src/core/image-processor.ts` de upstream aparecieron
**tres divergencias encadenadas**, todas del porte de tamiz:

| # | tamiz (antes) | digielect14 |
|---|---|---|
| 1 | `bw` = umbral **fijo** casero: estiramiento p5/p95 + `v>165→255`, `v<90→0`, salida **JPEG q0.85** (`image-processor.ts:285-329`) | `bw` = `client.enhance(canvas,"bw")` del worker OpenCV: **Bradley-Roth adaptativo** (integral image) + despeckle + white-point, salida **PNG** |
| 2 | el **OCR** leía `warp.processed`, o sea la imagen binarizada | PROD-1 §4.1 / KIT `e14-ocr-lee-original-v1`: DOS variantes del MISMO warp — `"bw"` para mostrar/guardar y `"original"` (crudo) **para leer** |
| 3 | la **calidad** del acta se medía sobre la binarizada | `calidadDeActa(fotoOriginal, quad, …)` mide sobre el **crudo recortado** |

La 3 es la que explicaba el `9.7/10 ÓPTIMA` universal: un papel binarizado tiene
contraste máximo **por construcción**, así que el score se autoconfirmaba y el
guard `contrasteEfectivoDe(calidad) < 0.18` (techo a `TECHO_SIN_SENAL`) no podía
disparar nunca.

**Aplicado:**
- `packages/scanner-core/core/image-processor.ts` → `modoEnhance()` (mapeo
  `original→raw`, `bw→bw`, `contrast→text`, paridad con
  `filterToEnhanceMode`) y el revelado **delega en el worker**; el bloque canvas
  queda solo como fallback documented cuando OpenCV no está.
- `apps/tamiz/src/lib/e14/pipeline.ts` → `Promise.all` con las dos variantes
  (`.catch(() => null)` dentro, como upstream: si la variante de lectura falla
  se lee la revelada y el pipeline no muere) y `fotoLectura` alimenta a
  **CALIDAD y OCR**. Con SIMULACIÓN la revelada ya es `"original"`, así que el
  segundo warp no corre.
- `apps/tamiz/src/lib/e14/bridge/pipeline-recorte.ts` → la misma regla para el
  flujo de importado/recorte manual.
- **NO** se tocó la entrada de `evaluarEstructuraActa` (LAYOUT): esa etapa es
  propia de tamiz, no existe en digielect, y sus umbrales se calibraron sobre la
  imagen revelada. Cambiarla es una medición aparte.

**Medido en el A56 tras el cambio** (`bw-check.mjs`): la imagen del acta sale
`image/png` 52 KB 883×1142 → **el que corre es el Bradley-Roth del worker**, no
el fallback. Y el score del acta pasó de clavado 9.7 a **6.5/10**, que es
exactamente `UMBRAL_RECHAZO_SCORE` (≤ eso → RECHAZADA/BAJO). Es decir: el gate
ahora mide de verdad y queda en la frontera — hay que ver la distribución real de
varias capturas antes de decidir si los umbrales del producto se recalibran o si
el encuadre de prueba era realmente mediocre. **Decisión pendiente del dueño.**

Checks: `tsc --noEmit` 0 · eslint 0 en los archivos tocados · `bun test` 33/33
(tamiz) y 8/8 (scanner-core).

## 9. Segunda ola: los parches del agente externo

Entregó dos tandas. La primera, seis parches chicos (P1 timeout, P2 acciones del
editor, P3 motor de imagen, P4a fachada, P4b iconos, P5 `rotarDataUrl90`). La
segunda, **`PARCHES-TAMIZ-UNIVERSAL.patch`: 31 361 líneas sobre 81 archivos**,
que es un porte completo del motor (RapidOCR ONNX + workers, QR capa 0,
orientación, `politica/gate.ts`, `useSesionCamara` a resolución nativa,
QuadEditor de 754 líneas, ZoomableVisor con pinza, PDF/ZIP, HEIC).

**No entra tal cual.** Está generado sobre `f57586e` limpio y aquí ya teníamos
nuestro propio porte de los mismos módulos: `git apply` respondió
`frame-loop.ts / motion-stabilizer.ts / detector-client.ts / entorno.ts: already
exists in working directory` y `pipeline.ts / image-processor.ts / store/index.ts
/ useSesionCamara.ts: patch does not apply`. Montar el parche en un worktree
limpio (`.wt-universal`, fuera del repo) y de ahí **extraer archivo por archivo**
es la única forma de mezclar sin perder lo medido en §6-§8.

Aplicado en esta ronda (todo verificado contra las firmas reales del árbol):

| qué | archivo | nota |
|---|---|---|
| P1 timeout del recorte 15 s → 30 s | `bridge/pipeline-recorte.ts` | el warp del editor mide 14-17.4 s aquí también |
| P3 tope 3200 → 4032 y JPEG 0.85 → PNG | `packages/scanner-core/core/image-processor.ts` | camino canvas (fallback), no el del worker |
| P5 `rotarDataUrl90` | `packages/scanner-core/core/canvas-imagen.ts` | re-encode JPEG 0.92 (como upstream) |
| P2 guardas del editor | `store/index.ts` | guard simétrico, identidad al resolver, errores con copy fijo, rotación rápida sin re-pipeline, upgrade silencioso |
| QuadEditor completo (8 asas, lupa 3×, detección, teclado, inversa de la rotación CSS) | `components/e14/QuadEditor.tsx` 131 → 754 | del parche universal; **es la corrección del «el editor no funciona»** |
| `Point`/`loadImage`/`detectDocumentEdges` + warm-up del worker OpenCV | `lib/e14/fachada.ts` | se quitaron `fileToCaptureDataUrl`/`jpegDimensionsFromBlob` (pertenecen al port de importación/HEIC, aún no hecho) y el warm-up local de tamiz se conservó llamando a los dos |
| `RotateIcon`/`SparklesIcon` + `handle-pulse`/`borderdim` | `icons.tsx`, `globals.css` | del parche universal |

Un ajuste propio fueron necesarias: `logger.error('…', e)` del P2 no compila
aquí porque el logger de tamiz toma `Record<string, unknown>` → se pasó a
`{ mensaje: (e as Error).message }`, como el resto del repo.

**Filtro de alcance (regla del dueño: tamiz digitaliza y valida CUALQUIER
documento, no actas E-14).** Del Top-10 del agente hay tres filas que **no
nos interesan y no se van a portar**: D12 (clasificador electoral + DIVIPOL),
D5 (zona de votos / `marcadores.ts`) y el `probeOrientacion` con anclas de
cabecera de D3 en su variante electoral. Lo demás (OCR ONNX, gate por lectura,
captura nativa, editor, visor, export, HEIC, preparación de campo) sí es de un
escáner genérico. Ojo con la etiqueta «sin e14» del parche: **aún conserva
`PanelClasificacion.tsx`, `divipol` y 41 líneas añadidas con vocabulario
electoral**; lo único que hace con el catálogo demo es confinarlo a modo
SIMULACIÓN. Los rutas siguen llamándose `src/lib/e14/`.

**Dos bloqueos para decidir antes de mezclar el resto:**

1. **Dependencias nuevas** — el parche escribe en `apps/tamiz/package.json`
   `onnxruntime-web@1.31.1`, `zxing-wasm@^3.1.8`, `jspdf@^4.2.1`,
   `framer-motion@^14.14.0` y toca `bun.lock`. Regla del repo: nada nuevo sin OK
   explícito. Nota útil: `onnxruntime-web@^1.20.1` **ya está** en
   `packages/dla-onnx`, así que ese es un problema de versión compartida, no una
   dep nueva; los otros cuatro sí lo son.
2. **Bytes de modelo en el repo** — el parche comitea
   `public/models/rapidocr/ppocr_keys.txt` (32 KB), cuatro workers construidos
   (`public/scanner/*.worker.js`, 152 KB) y `qr/vendor/jsQR.js` (269 KB). Aquí la
   convención es scripts de preparación + hash fijado y `.gitignore`, igual que
   los assets que ya porteamos en §1-§5.

Estado: `tsc --noEmit` 0 · eslint 0 · 33/33 tamiz · 8/8 scanner-core. **Falta la
revisión táctil del editor nuevo en el A56** (el servidor vive en `:3100`, el
túnel CDP del §7 está caído).

---

## §9. Estado después de montar el parche (2026-11-24, mismo día)

Se montó `PARCHES-TAMIZ-UNIVERSAL.patch` y se corrigió lo que introdujo. Los
regresiones P0 que el parche trajera y ya están cerradas:

| Hallazgo | Cierre |
|---|---|
| Toda foto de cámara saltaba detección/recorte (`'archivo' in entrada`) | `pipeline.ts`: `esArchivoSubido = ... && opciones.fuente !== 'CAMARA'` |
| `procesandoRef` nunca se ponía en `true` (dobles despachos, colas concurrentes) | rearmado en `useDestello.despacharArchivo` con `try/finally` + early-return por `analisisEnVuelo` en el store + candado en `capturarInteligente` |
| Auto-captura comparaba `performance.now()` contra un cooldown en `Date.now()` | un solo reloj (`Date.now()`) en `useSesionCamara` |
| **Firmas inventadas** en el resultado documental | `construirActa` devuelve `firmas: []`; se borró `firmasPorStatus` del bridge y del gate de recorte; regresión en `tests/portados.test.ts` |
| **Rotación de documentos ajenos** por la brújula QR electoral | se sacó `orientacion-qr.ts` del pipeline y se eliminó el módulo (y su export); queda solo `probeOrientacion` genético |

Resolución del bloqueo 2 (bytes en el repo): **ningún `.onnx` ni traineddata viaja**.
Los 4 workers IIFE se generan con `preparar` y están gitignoreados;
`detection-worker.js` es el único artefacto versionado porque no tiene fuente
compilable (viaja con md5 fijado en `packages/scanner-core/assets.lock.json`);
`ppocr_keys.txt` queda ignorado (RapidOCR es solo fallback: el OCR base de Tamiz
es Tesseract spa, que sí se materializa); `jsQR 1.4.0` se versiona como vendor de
código, que es lo que era en el origen.

`origin/main` va 17 commits por delante (motor de moldes universal, homografía,
verificación documental): se mezcla `main` hacia esta rama, nunca al revés, y el
mapa se regenera con `bun run agent:map` después de la mezcla.

**Sigue abierto (decisiones del dueño, no del agente):**
1. **Dependencias** — `onnxruntime-web@1.31.1`, `zxing-wasm@^3.1.8`,
   `jspdf@^4.2.1`, `framer-motion@^14.14.0` entran con el porte y necesitan OK
   explícito. `onnxruntime-web` además es problema de versión compartida con
   `packages/dla-onnx` (`^1.20.1`).
2. **`CALIDAD` medida sobre la imagen binarizada** — `pipeline.ts` evalúa
   `calidadDeActa(warp.processed)` mientras el OCR lee `warpOcr.processed`.
3. **Enrutado de moldes** — `molde/evaluacion.ts` sigue exigiendo
   `contexto.esE14` para enrutar, o sea herencia electoral.
4. **`CameraFrameLoop` / `live.corners` sin cablear** — `useSesionCamara` corre su
   propio lazo rAF de 250 ms con Laplaciano en vez del lazo k-de-n porteado.
5. Distribución de scores sobre ≥20 capturas reales antes de tocar
   `UMBRAL_RECHAZO_SCORE`, y el presupuesto de ~8 s del worker de QR capa 0.

