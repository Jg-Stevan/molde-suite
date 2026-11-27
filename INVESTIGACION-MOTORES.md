# INVESTIGACION-MOTORES.md — Benchmark V3 · fase A1 (Agente 1)

> **Fecha:** 2026-11-27 · **Rama:** `bench/agente-1-arnes-motores` · **Plan:**
> [`PLAN-BENCHMARK-V3.md`](PLAN-BENCHMARK-V3.md) §5, fase A1.
> **Alcance:** investigación **documental** (§8: sin instalar nada al inicio)
> de motores para las situaciones **S1–S4 + S6** sobre el dataset real
> (recibo de pago, comprobante de entrega, E-26, E-14). Tres candidatos por
> situación, en fichas. La verificación empírica (tiempos, recall, heap) queda
> para la fase **D1** con el arnés. **Tablas (S5) y salidas .md/.html son
> territorio del Agente 2** (prueba S) — aquí solo se citan como frontera.

---

## 1. Estado heredado que obliga este estudio

| Hecho | Fuente |
|---|---|
| V2 midió Tesseract spa OEM=1 PSM=3: **recall 0.92**, **1507 ms/pág** (variantes psm4/1200px sin mejora neta; 1200px PSM3 DEGRADA a 0.84) | `apps/molde-studio/scripts/benchmark-motores-r2.json` |
| **Corrección de nomenclatura (§8):** lo etiquetado «tess-best» en logs de V2 era realmente `4.0.0_fast` — V3 re-mide el *best* real | §8 del plan V3; `apps/tamiz/scripts/assets.lock.json` sirve `public/models/tess/4.0.0_fast/spa.traineddata.gz` |
| Motor de **producción** de Tamiz hoy: **RapidOCR PP-OCRv4** (det+cls+rec ONNX en `onnxruntime-web`), con cascada *rapid-first* y fallback a Tesseract | `apps/tamiz/src/lib/e14/ocr/rapidocr.ts`, `docs/DECISION-rapidocr-fallback.md` |
| Lección reciente: un asset que el motor `fetch()` sin estar en `assets.lock.json` mata el motor en clon fresco (`ppocr_keys.txt HTTP 404`) — TODO peso del benchmark debe declararse con URL+SHA-256 | `lessons/app_tamiz/2026-11-26-ppocr-keys-404.md` |
| El repo ya sirve assets Tesseract en `apps/molde-studio/public/tesseract/`: core SIMD-LSTM **3.7 MB**, worker **109 KB**, `spa.traineddata.gz` **2.0 MB** | árbol del repo |
| PP-DocLayout ya investigado en el repo: **S 4.9 MB / plus-L 129.7 MB**; E-14 p1: plus-L F1 **1.000**, S+estructura SPIKE F1 **0.914**, S baseline 0.593 | `docs/investigacion/2026-11-22-pp-doclayout-en-navegador.md`, `docs/investigacion/2026-11-22-spike-s-estructura.md` |

**Versiones vigentes verificadas contra npm (2026-11-27):**

| Paquete | Vigente | Licencia | Estado en el repo |
|---|---|---|---|
| `tesseract.js` | **7.0.0** | Apache-2.0 | `^7.0.0` ya en ambas apps |
| `onnxruntime-web` | **1.31.1** | MIT | fijado exacto `1.31.1` en `apps/tamiz/package.json` |
| `@zxing/library` | **0.23.0** | Apache-2.0 | no instalado (candidato) |
| `@zxing/browser` | 0.2.1 | Apache-2.0 | no instalado (candidato) |
| `opencv.js` | **1.2.1** (build huningxin) | Apache-2.0 | el repo usa loader stub `opencv-4.5.5.js` + core materializado (gitignored) |

---

## 2. Situaciones (heredadas de V2) y su métrica reina

| Situación | Pregunta operativa | Métrica reina para D1 |
|---|---|---|
| **S1 — rápido** | ¿Latencia mínima aceptable por documento en móvil? | ms/pág caliente p50/p95; heap pico |
| **S2 — preciso** | ¿Exactitud máxima de texto impreso? | recall por campo contra GT textual; CER |
| **S3 — con coordenadas** | ¿Cajas trazables (palabra/bloque/línea) para overlay y recortes? | coincidencia de bbox (IoU) + recall |
| **S4 — sin coordenadas** | ¿Texto plano suficiente para anclas textuales (M2)? | recall de anclas ≥2 por documento |
| **S6 — manuscritos (solo localizar)** | ¿Detectar presencia de tinta + bbox sin transcribir (contrato §1 del plan)? | acierto presencia de tinta ≥95% (firmas vacías vs. llenas); falsos ok = 0 |

Regla transversal del plan §1: **manuscritos nunca se transcriben** — todo
candidato de S6 se evalúa SOLO por `{ con_tinta, bbox }`.

---

## 3. Fichas de candidatos

Convención: cada ficha declara identificador, qué es, licencia, pesos, soporte
español, salida, viabilidad en navegador, riesgos e integración con el arnés
(`scripts/entrega/bench-ocr/entry.ts` + conductor CDP crudo, §8).

### S1 — rápido

**S1-a · Tesseract.js 7.0.0 + traineddata `4.0.0_fast` (spa)**
- Qué es: port WASM de Tesseract 5 (motor LSTM OEM=1) con el set *fast*.
- Pesos: core SIMD-LSTM **3.7 MB** + `spa.traineddata.gz` **2.0 MB** (ya
  servidos por `apps/molde-studio/public/tesseract/`).
- Español: nativo (traineddata spa).
- Salida: texto plano (+ hOCR/TSV opcionales); sin pesos de red propios.
- Viabilidad navegador: probada en producción del repo (worker SIMD).
- Riesgos: el *fast* sacrifica exactitud en campos pequeños (cifras de E-14).
- Arnés: cargador idéntico al de Tamiz; medir frío (descarga) vs. caliente.
- Nota §8: en logs históricos esta variante fue etiquetada «best» — V3 la
  llama SIEMPRE `4.0.0_fast` en resultados.

**S1-b · ZXing (`@zxing/library` 0.23.0) — línea base de códigos**
- Qué es: lector 1D/QR en JS puro, sin pesos externos; el plan §6 lo exige
  como línea base INDEPENDIENTE del OCR para los códigos del E-14.
- Pesos: bundle JS (~cientos de KB; se mide en D1 con `bun build`).
- Español: n/a (códigos de barras).
- Salida: contenido decodificado + esquinas del símbolo (4 puntos).
- Viabilidad navegador: total (es la capa 0 del scanner histórico del repo).
- Riesgos: códigos parcialmente ocluidos/recortados en fotos reales.
- Arnés: lectura directa sobre canvas; también valida paridad `Civ` del E-14.

**S1-c · RapidOCR PP-OCRv4 *mobile* (det+cls+rec ONNX)**
- Qué es: el motor de producción de Tamiz (cascada *rapid-first*), ONNX stock
  de SWHL/RapidOCR con URL+SHA-256 ya fijados en `assets.lock.json`.
- Pesos (stock v4): det **≈4.7 MB** + rec **≈10.8 MB** + cls **≈1.4 MB** +
  dict `ppocr_keys_v1.txt` (6623 líneas; SHA `a1c84d9b…6492`). Bytes exactos
  tras `bun run preparar` local.
- Español: el dict v1 es CJK+ASCII; los acentos del español requieren
  verificación D1 (el repo ya produce veredictos correctos en E-14 con este
  motor, pero hay que medir CER sobre el dataset V3, no asumirlo).
- Salida: texto + cajas por línea (polygon 4 puntos).
- Viabilidad navegador: probada (onnxruntime-web WASM SIMD en producción).
- Riesgos: heap WASM en móviles de gama baja con páginas 1600px+ (§6 calidad).
- Arnés: reusar el singleton de sesión del repo; medir frío vs. caliente.

### S2 — preciso

**S2-a · Tesseract.js 7.0.0 + traineddata `4.0.0_best` (spa) — el best REAL**
- Qué es: el set *best* de tessdata (LSTM float completo). Es la medición que
  V2 creyó hacer y no hizo (§8).
- Pesos: `spa.traineddata` best **≈15 MB** (≈12 MB gz; fijar URL+SHA-256 al
  materializar — lección ppocr_keys).
- Español: nativo.
- Salida: texto plano + hOCR/TSV.
- Viabilidad navegador: sí (mismo WASM core; solo cambia el traineddata).
- Riesgos: 2–4× latencia vs. *fast*; heap por página grande.
- Arnés: candidata a leer SOLO recortes por campo (M1) en vez de página
  completa, para acotar coste.

**S2-b · RapidOCR con rec *server* en recortes de campo**
- Qué es: mismo det/cls mobile + rec PP-OCRv4 *server* (mayor capacidad) solo
  sobre los recortes de campos obligatorios (híbrido barato-preciso).
- Pesos: rec server **≈22 MB** stock (por fijar con SHA-256 si entra en D1).
- Español: misma salvedad del dict que S1-c.
- Salida: texto + confianza por línea.
- Viabilidad navegador: sí; cargar el rec server perezosamente (solo M1).
- Riesgos: peso total offline-first; evaluar si la ganancia de CER lo justifica.
- Arnés: medir exactamente el trade-off latencia/recall por campo.

**S2-c · Respaldos cruzados del molde (estrategia C1, no motor nuevo)**
- Qué es: combinación según plan §1 — cifra↔letras del importe, DNI/CIF
  duplicados, fecha emisión↔pago, IBAN respalda forma de pago, teléfono como
  llave secundaria, CALLE↔NRO. Un motor *peor* con respaldos puede superar a
  uno *mejor* sin ellos.
- Pesos: 0 (usa los motores anteriores + reglas del `.molde.json`).
- Español: n/a (reglas sobre texto).
- Salida: campo verificado con evidencia (contrato de veredictos del repo).
- Viabilidad: es la filosofía del motor universal (`packages/scanner-core`).
- Riesgos: ninguno técnico; coste de configurar respaldos por molde — que es
  justamente la métrica de «mantenimiento» de la prueba M.
- Arnés: correr la cascada por campo y registrar qué respaldo salvó cada uno.

### S3 — con coordenadas

**S3-a · Tesseract.js hOCR/TSV (bbox por palabra y bloque)**
- Qué es: salida estructurada nativa de Tesseract; `words`/`blocks` con bbox.
- Pesos: los mismos del motor elegido (fast o best) — la coordenada es gratis.
- Español: nativo.
- Salida: hOCR (HTML microformat) o TSV; ideal para el convertidor → .md/.html
  del Agente 2 (frontera S5/S).
- Viabilidad: total.
- Riesgos: bboxes de LSTM a veces parten palabras mal en fuentes impresas
  comprimidas (típico en formularios); comparar contra GT estructural.
- Arnés: exportar TSV crudo por corrida (`resultados-motores.json`).

**S3-b · RapidOCR det (cajas por línea, polygon 4 puntos)**
- Qué es: la detección DB de PP-OCRv4 produce polygonos por línea; robusta a
  ligera rotación/perspectiva residual post-warp.
- Pesos: det ≈4.7 MB (mismo asset de S1-c).
- Español: n/a para det (es agnóstico al idioma).
- Salida: cajas por línea + score; el rec da el texto por caja.
- Viabilidad: probada en producción.
- Riesgos: cajas de LÍNEA, no de palabra — el overlay por campo del repo ya
  usa esta granularidad, pero el GT estructural de Chandra es por bloque.
- Arnés: guardar polygons crudos para la prueba de overlay (firma/bbox §1).

**S3-c · PP-DocLayout S (bloques semánticos, 4.9 MB)**
- Qué es: detector de layout ONNX ya investigado en el repo; clases
  (SectionHeader, Table, text, image…) con cajas; el plus-L (129.7 MB) queda
  como referencia de techo, no candidato móvil.
- Pesos: **4.9 MB** (S); plus-L 129.7 MB NO candidato para móvil.
- Español: agnóstico al idioma (layout).
- Salida: bloques semánticos + cajas; F1 0.914 en E-14 p1 con estructura SPIKE.
- Viabilidad: probada en el repo (banco de Chrome Android por CDP).
- Riesgos: clases diseñadas para papers/memorias — en recibos con logos y
  sellos puede sobre-segmentar; medir FP por clase.
- Arnés: misma vía ONNX de Tamiz; alimentar al convertidor del Agente 2.

### S4 — sin coordenadas

**S4-a · Tesseract.js texto plano (`data.text`)**
- Qué es: el modo mínimo: `recognize()` → string. Es el insumo del M2
  (extracción por anclas textuales y regex según especificación).
- Pesos: idem S1-a/S2-a.
- Español: nativo.
- Salida: string (con saltos de línea por bloque).
- Viabilidad: total.
- Riesgos: el orden de lectura en formularios con columnas (E-26 págs. 1–5)
  puede entremezclar columnas y romper regex de anclas.
- Arnés: guardar texto crudo por página y calidad/filtro (barrido §6).

**S4-b · RapidOCR rec-only concatenado**
- Qué es: texto concatenado de las líneas del det (sin persistir cajas) —
  el «texto plano» de producción del repo.
- Pesos: idem S1-c.
- Español: idem S1-c.
- Salida: string por página.
- Viabilidad: probada.
- Riesgos: mismo problema de orden de lectura; el det ordena por posición, lo
  que USUALMENTE respeta el orden visual del formulario.
- Arnés: comparar recall de anclas vs. S4-a por documento.

**S4-c · Texto derivado de la estructura .md/.html (puente al Agente 2)**
- Qué es: tomar el .md/.html que el Agente 2 produce (prueba S) y extraer el
  texto plano; evalúa si la estructura AYUDA a las anclas textuales (M2
  estructural §4 del plan).
- Pesos: 0 (consumidor de la salida del otro agente).
- Español: n/a.
- Salida: string derivado + contexto de bloque (título/tabla) por línea.
- Viabilidad: depende del merge/sincronización §5 (ARNÉS-READY → rebase).
- Riesgos: dependencia de rama ajena; se ejecuta en D2/E2, no bloquea D1.
- Arnés: solo lectura del resultado estructural; medir recall de anclas.

### S6 — localización de manuscritos (presencia de tinta, jamás transcripción)

**S6-a · Auditoría de trazos de `packages/scanner-core` (motor propio)**
- Qué es: el audit de tinta/rúbricas que el motor universal ya ejecuta sobre
  zonas del molde («auditando trazos físicos (rúbricas, sellos o tachaduras)»,
  AGENTS.md); overlay de firmas resaltadas ya existe en producción.
- Pesos: 0 (código propio sobre canvas).
- Español: n/a.
- Salida: por zona `{ con_tinta, bbox, densidad }` — exactamente el contrato §1.
- Viabilidad: probada (firmas del recibo y E-14 en producción).
- Riesgos: umbral de densidad vs. sombras del papel en fotos reales (el
  dataset trae tomas con sombras — banco ideal).
- Arnés: evaluar las 5 tomas del recibo (2 con firmas impresas + 3 variante A
  firmas VACÍAS) y las líneas C.C. de jurados del E-14.

**S6-b · OpenCV.js (contornos/área de tinta en el recorte)**
- Qué es: umbral local + `contours`/`countNonZero` sobre el recorte de firma;
  alternativa cuando la auditoría propia dude (sello sobre firma, tachaduras).
- Pesos: build core **≈8–10 MB** (el repo ya materializa
  `opencv-4.12.0-core.js`, gitignored; loader stub en el repo).
- Español: n/a.
- Salida: máscara binaria + bbox del contorno mayor + área de tinta.
- Viabilidad: WASM clásico; cargar perezosamente (solo si S6-a es dudosa).
- Riesgos: peso grande para poco uso; OOM móvil si se copia el canvas completo
  (§8: prohibido; usar recortes locales).
- Arnés: segunda opinión sobre las zonas marcadas por el molde.

**S6-c · PP-DocLayout S + umbral de tinta (localización estructural)**
- Qué es: usar los bloques del layout (clases tipo *signature*-like o
  regiones vacías detectadas) para PROponer zonas de firma sin molde, y
  aplicar el umbral de tinta encima; evalúa si un documento SIN molde puede
  autolocalizar sus firmas (insumo para M3, molde auto).
- Pesos: 4.9 MB (idem S3-c).
- Español: n/a.
- Salida: zonas candidatas + `{ con_tinta, bbox }` por zona.
- Viabilidad: la parte ONNX ya está probada; la propuesta de zonas de firma
  sin molde es hipótesis a medir.
- Riesgos: los bloques del layout no siempre aíslan la caja de firma (pueden
  fundirla con el pie de página); probablemente requiera heurística por molde.
- Arnés: comparar contra el GT de tinta marcado a mano (§1, luz verde del
  usuario antes de correr).

---

## 4. Compatibilidad `onnxruntime-web` 1.31.1 (versión vigente)

- El repo YA fija `onnxruntime-web 1.31.1` exacto en Tamiz y ejecuta
  RapidOCR + PP-DocLayout con él: **ningún candidato ONNX requiere nueva
  dependencia** (regla §8: sin dependencias pesadas nuevas durante la
  investigación).
- EPs usados en producción: WASM SIMD (multi-hilo según hardware). WebGPU se
  deja fuera del benchmark V3 (variabilidad móvil; queda como trabajo futuro).
- Todo peso nuevo que D1 necesite (rec *server*, `4.0.0_best`) entra por
  `assets.lock.json` con URL+SHA-256 — lección `ppocr-keys-404`.

## 5. Veredicto preliminar por situación (candidato recomendado para D1)

| Situación | Recomendado | Segundo | Descartado/pospuesto |
|---|---|---|---|
| S1 rápido | **S1-c RapidOCR v4 mobile** (producción, cadena caliente) | S1-a Tesseract fast | — |
| S2 preciso | **S2-a Tesseract `4.0.0_best` en recortes (M1)** | S2-b rec server | S2-c como capa superior, no candidato único |
| S3 coordenadas | **S3-a Tesseract TSV** (palabra) + **S3-b RapidOCR det** (línea) | S3-c para bloques | plus-L 129.7 MB jamás en móvil |
| S4 plano | **S4-b RapidOCR concatenado** (es el texto de producción) | S4-a Tesseract plano | S4-c tras ARNÉS-READY |
| S6 manuscritos | **S6-a trazos scanner-core** (cumple contrato exacto) | S6-b OpenCV.js como segunda opinión | S6-c como insumo de M3 |

Hipótesis a rebatir con datos (D1): «RapidOCR mobile mantiene recall ≥ 0.92 de
V2 con la mitad de latencia del Tesseract PSM3, y Tesseract best en recortes
supera a ambos en campos obligatorios del recibo».

## 6. Riesgos transversales registrados

1. **Orden de lectura** en E-26 (formularios a columnas): texto plano puede
   romper anclas — la prueba S del Agente 2 es el contrapunto natural.
2. **Heap móvil**: medir `performance.memory` en cada corrida (§6); prohibido
   duplicar canvas completo a alta resolución (§8) — recortes locales solo.
3. **Sombras del papel** en las tomas reales del recibo/comprobante: pueden
   confundir umbrales de tinta (S6) y binarización Otsu (filtro §6).
4. **Dict CJK vs. español** en RapidOCR: medir CER de acentos (Á É Í Ó Ú Ñ)
   explícitamente; si falla, candidatizar el dict/modelo *latin* en D1.
5. **Nomenclatura**: llamar a las variantes por su traineddata real
   (`4.0.0_fast` / `4.0.0_best`) — jamás «best» heredado de V2 (§8).

## 7. Integración con el arnés (fase C1, siguiente)

- `scripts/entrega/bench-ocr/entry.ts` (bundle `bun build` →
  `/public/_bench/`, gitignored) + conductor `bench-ocr.mjs` con **CDP crudo**
  (sin Playwright/Puppeteer/`onnxruntime-node`, §8) — mismo patrón del banco
  PP-DocLayout del repo (`bench-phone.js`/`bench-pc.js`).
- Salida cruda por corrida: `{ motor, variante, calidad, filtro, ms, heap,
  texto, tsv, polygons, bloques, tinta[] }` → `scripts/resultados/bench-ocr/
  motores/` (gitignored).
- Los pesos ONNX/Tesseract que D1 consuma se declaran con URL+SHA-256 antes
  de la primera corrida (lección `ppocr-keys-404`).

## 8. Fuentes

- Repo: `apps/molde-studio/scripts/benchmark-motores-r2.json` (V2),
  `apps/tamiz/src/lib/e14/ocr/{tesseract,rapidocr}.ts`,
  `apps/tamiz/scripts/assets.lock.json`,
  `docs/DECISION-rapidocr-fallback.md`,
  `docs/investigacion/2026-11-22-pp-doclayout-en-navegador.md`,
  `docs/investigacion/2026-11-22-spike-s-estructura.md`,
  `lessons/app_tamiz/2026-11-26-ppocr-keys-404.md`,
  `packages/scanner-core/AGENTS.md`/raíz `AGENTS.md`.
- Plan: `PLAN-BENCHMARK-V3.md` (§1 dataset, §3 prueba M, §5 A1, §6 barridos,
  §8 reglas).
- npm registry (2026-11-27): tesseract.js 7.0.0, onnxruntime-web 1.31.1,
  @zxing/library 0.23.0, @zxing/browser 0.2.1, opencv.js 1.2.1 (+ licencias).
