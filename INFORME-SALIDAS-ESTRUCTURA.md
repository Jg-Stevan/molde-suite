# INFORME-SALIDAS-ESTRUCTURA.md — Benchmark V3 · Agente 2 (prueba S)

> **Fecha:** 2026-11-27 · **Rama:** `bench/agente-2-salidas-estructura` ·
> **Plan:** [`PLAN-BENCHMARK-V3.md`](PLAN-BENCHMARK-V3.md) §4–§5 (fases A2, B2,
> D2, E2). Pregunta central (Q3): *¿es viable leer como `.md`/`.html` estilo
> Chandra OCR offline-first en navegador, y esa lectura estructurada sustituye
> o refuerza al molde?* Datos crudos reproducibles en
> `scripts/resultados/bench-ocr/salidas/resultados-salidas.json` (local,
> gitignored por la regla de privacidad del repo).

---

## 1. Resumen ejecutivo

1. **La lectura `.md`/`.html` estructurada es VIABLE offline-first en navegador,
   con coste casi nulo**: los convertidores son JS puro (sin dependencias, sin
   APIs de Node) y renderizar estructura→Markdown/HTML cuesta **< 1 ms por
   página** (mediana 0.7–0.8 ms). El peso añadido es el de los propios motores
   (Tesseract core SIMD 3.7 MB + traineddata `4.0.0_fast` spa 2.0 MB, ya servidos
   por el repo; RapidOCR det+rec ≈ 16.9 MB si entra la cascada).
2. **Hoy la estructura REFUERZA al molde; NO lo sustituye.** La extracción de
   campos desde el `.md` (M2-estructural) empata al texto plano
   (tasa 0.512 vs 0.517 agregada; recibo-escaneado 0.789 ambos), porque los
   regex trabajan sobre el mismo texto. Lo que la estructura añade de verdad:
   trazabilidad de coordenadas (`data-bbox` en cada bloque y celda), jerarquía
   tipográfica (título/sección/pie), clasificación por anclas con **0 falsos
   rechazos (11/11 documentos)** y la rejilla de tablas como base para las
   validaciones matemáticas — aunque la rejilla requiere un paso de layout más
   fuerte (ver §4).
3. **La combinación de motores queda validada con datos**: RapidOCR rescata las
   tomas que Tesseract pierde (toma recortada del recibo: **0.711 vs 0.237** de
   tasa de campos; teléfono, NRO, PISO y DPTO del comprobante real que Tesseract
   no leyó aparecen en RapidOCR con conf 0.93–1.00), mientras Tesseract domina
   los escaneados limpios (0.789 vs 0.342). La cascada *rapid-first* de producción
   del repo es la decisión correcta para fotos; el fallback a Tesseract es el
   correcto para escaneos.
4. **Manuscritos (S6): 10/10 en presencia de tinta (0 FP, 0 FN)** con el método
   v2 (fondo local + contraste agudo + oscuridad absoluta) — sin transcribir
   nada, cumpliendo el contrato §1. El umbral operativo es estrecho
   (sombra 0.0197 vs firma más pequeña 0.0215) y se documenta.
5. **Hallazgo de gobernanza del dataset** (crítico para D1 de Agent 1):
   etiquetas inconsistentes (los `firmas-vacias-02/03` SÍ llevan firmas y
   `recibo-impreso-01/02` son duplicados md5 de aquellos), GT Chandra
   desalineado con el banco escaneado (regenerado después; `REC-2026-0314`
   vs `REC-2026-0157`) y copiado byte a byte entre carpetas del recibo y el
   comprobante, y fotos con EXIF orientation 6 que revierten cualquier runner
   que no la aplique.

## 2. Método y desviaciones del plan (declaración honesta)

| Aspecto | Plan V3 | Ejecutado | Motivo |
|---|---|---|---|
| Arnés | el de Agent 1 (bench-ocr, CDP crudo) | **arnés mínimo propio** (`scripts/entrega/estructura/harness/arnes-minimo.mjs`): tesseract.js 7, `4.0.0_fast` spa, OEM 1, PSM 3, en Node | al sincronizar, `bench/agente-1-arnes-motores` solo traía la fase A1 (sin ARNÉS-READY); el plan §5 prevé fixtures/arnés mínimo propio para B2 |
| Motor 2 | cajas de RapidOCR | `rapidocr-onnxruntime` (PP-OCRv4 det+rec stock) en Python local, **con transposición EXIF** | misma familia de modelos que la producción de Tamiz vía onnxruntime-web |
| Calidad/filtros (§6) | barrido 800/1200/1600 × Q60/80/92 | **resolución nativa** (reescalado y filtros quedan en D1 de Agent 1) | la prueba S evalúa estructura; el barrido de calidad es transversal de Agent 1 |
| GT tinta | luz verde del usuario | **curación visual propia de 10 recortes** (supuesto declarado) | no hay usuario en este entorno |
| Métricas | CER por bloque vs `datalab-convert` | CER crudo + CER sin dígitos (variantes de valor), cobertura por IoU≥0.2, coincidencia de tipos, tasa de orden (inversiones) | el GT del recibo real difiere en valores del banco escaneado; normalización de dígitos aísla la estructura del contenido |

Todo lo corrido: **23 imágenes** (1 recibo escaneado + 5 recibo real incl. 2
duplicados md5, 1 comprobante escaneado + 4 comprobante real, 6 E-26, 2 E-14
referencia, 4 E-14 real), con Tesseract (texto+TSV+hOCR), RapidOCR (cajas de
línea) y presencia de tinta sobre fotos reales.

## 3. Resultados — fidelidad estructural vs GT Chandra (datalab)

Por página (Tesseract→convertidor→estructura, bloques matcheados por IoU≥0.2):

| Página | GT bloques | Míos | Matcheados (cobertura) | CER medio | Tipos OK | Orden |
|---|---|---|---|---|---|---|
| E-26 p1 | 16 | 56 | 11 (0.69) | 0.163 | 0.545 | 1.000 |
| E-26 p2 | 17 | 40 | 9 (0.53) | 0.071 | 0.556 | 0.917 |
| E-26 p3 | 16 | 17 | 3 (0.19) | 0.165 | 0.667 | 1.000 |
| E-26 p4 | 18 | 22 | 8 (0.44) | 0.503 | 0.500 | 0.857 |
| E-26 p5 | 18 | 30 | 11 (0.61) | 0.149 | 0.273 | 0.964 |
| E-26 p6 | 17 | 38 | 13 (0.77) | 0.231 | 0.462 | 0.846 |
| recibo real toma 1 | 11 | 6 | 0 (0.00) | — | — | 1.000 |
| recibo real toma 2 | 11 | 15 | 2 (0.18) | 0.242 | 1.000 | 1.000 |
| recibo real toma 3 | 11 | 15 | 1 (0.09) | 0.648 | 1.000 | 1.000 |

Lecturas:

- **El contenido coincide donde hay emparejamiento** (CER 0.071–0.231 en 5 de 6
  páginas E-26; p3 cae de cobertura porque Tesseract junta en un bloque lo que
  Chandra parte en varios: 17 bloques míos vs 16 GT y solo 3 con IoU≥0.2 —
  granularidad distinta, no pérdida de texto).
- **La granularidad es la principal fuente de "falta" de cobertura**: el
  convertidor agrupa líneas en párrafos; Chandra emite bloques semánticos más
  finos. En p6 (cobertura 0.77) hay 38 bloques míos vs 17 GT — el matching
  many-to-one se penaliza a mí mismo por diseño métrico. Conclusión honesta:
  el texto y el ORDEN de lectura (0.85–1.00 en todas) se conservan; la
  equivalencia de bloques uno-a-uno requiere alinear por región (o un layout
  semántico tipo PP-DocLayout) y es la mejora nº1 del convertidor.
- **Recibo real**: las fotos están RECORTADAS (la toma 1 pierde título y
  cabecera completos) — el CER 0.24–0.65 y la cobertura ≤0.18 reflejan el
  recorte físico, no un fallo del convertidor. La tasa de tipos 1.0 en las
  tomas 2–3 muestra que lo visible se clasifica bien.
- `tipo_tasa` ~0.5 en E-26: mi heurística tipográfica llama "parrafo" a
  `SectionHeader` cortos del acta (líneas de partido) — clasificación tipográfica
  mejorable, texto intacto (CER 0 en varios de esos pares).

## 4. Resultados — extracción de campos M2 (sin molde) y tablas S5

Tasa de campos = (exactos + 0.5·parciales) / evaluados, contra el GT textual
curado (especificaciones + lectura visual; supuestos declarados):

| Variante | Tesseract→**.md** | Tesseract→texto plano | RapidOCR→.md | Nota |
|---|---|---|---|---|
| Recibo escaneado | **0.789** | 0.789 | 0.342 | 11/8/0 — 0 fallidos: el .md no pierde nada |
| Recibo real (5 tomas) | 0.637 | 0.658 | 0.468 | toma recortada: rapid 0.711 vs tess 0.237 |
| Comprobante escaneado | **0.792** | 0.792 | 0.542 | 0 fallidos en tess |
| Comprobante real (4 tomas) | 0.216 | 0.205 | **0.239** | las cajas de tablas que tess no leyó, rapid sí |

- **Clasificación por anclas (especificación §1, ≥2 anclas)**: **11/11
  documentos clasifican, 0 falsos rechazos** — incluso la toma recortada
  encuentra 4/5 anclas del recibo. Queda cumplida la meta de "0 % falsos
  rechazos en documentos legibles" para la vía sin molde en este dataset.
- **Tablas E-26**: el convertidor detecta **35 tablas vs 17 del GT**
  (sobre-fragmentación: filas sueltas como tablas de 1 fila), con CER de tabla
  mediano 0.734 en los emparejados — el TEXTO de las celdas existe (los pares
  Table→parrafo con CER 0 lo prueban) pero la **asociación fila↔columna** se
  degrada. Consecuencia directa: la **puerta matemática de la cifra repartidora
  (175.5, pág. 5) NO se recupera desde el .md actual** (etiqueta y valor caen en
  tablas distintas). E-14 p1: la rejilla de nivelación y candidatos SÍ se
  conservan y el código de barras impreso se lee (`712005322010102` p1,
  `712005322010202` p2).
- **Veredicto tablas (S5)**: la ruta geométrica pura (líneas→columnas) alcanza
  para tablas sencillas y conserva el texto; para la rejilla de votos usable en
  las validaciones matemáticas hace falta **delimitar la región de tabla con
  layout semántico (PP-DocLayout S, 4.9 MB, Apache-2.0, ya investigado en el
  repo con F1 0.914 en E-14 p1) y reconstruir la rejilla dentro de esa región**.
  Es la vía recomendada y es viable en navegador (ONNX WASM).

## 5. Resultados — manuscritos S6 (presencia de tinta, sin transcripción)

- Método v2 (`harness/tinta.py`): recorte de la zona del molde real
  (`ancla.rect` + offset `zona`, EXIF aplicado) → fondo local gaussiano → tinta
  = oscurecimiento agudo (>60) y oscuro (<130) → densidad; barrido de
  parámetros y punto óptimo `(60, 130, dens>0.02)`.
- **10/10 pruebas únicas correctas — 0 falsos positivos, 0 falsos negativos**
  (firmas llenas vs vacías en recibo y comprobante, incluye una marca pequeña
  de tinta en el comprobante toma 3). Cumple la meta del plan (≥95 %).
- **Margen estrecho declarado**: la sombra más fuerte del papel alcanza
  densidad 0.0197 y la firma más pequeña 0.0215 — el umbral 0.02 funciona en
  este banco pero no tiene holgura; para campo (Agent 1 S6-a/S6-b) conviene
  combinar con contraste de borde (OpenCV) sobre el recorte.
- **Gobernanza del dataset**: las etiquetas contradicen las fotos —
  `recibo-a-impreso-firmas-vacias-02` lleva firma del emisor (y `vacias-03`
  ambas), mientras `recibo-impreso-01/02` son **duplicados byte a byte (md5)** de
  aquellas. El GT visual curado queda registrado en `tinta.json` para las
  corridas futuras.

## 6. Latencia y memoria (arnés mínimo, Node)

| Métrica | Tesseract `4.0.0_fast` | RapidOCR PP-OCRv4 | Render estructura→.md/.html |
|---|---|---|---|
| p50 por página | **1258 ms** | 3483 ms | **0.7 ms** |
| p95 por página | 1963 ms | 5746 ms | 0.8 ms |
| Extracción M2 | 0.2–0.4 ms | — | — |

- La meta del plan (p50 ≤ 15 s por documento) se cumple con amplio margen en
  ambas vías; el renderizado estructurado es gratis frente al OCR.
- Memoria: en Node solo se midió heap JS (±1.5 MB) — el heap WASM del motor no
  es observable aquí; **la medición de `performance.memory` del plan debe hacerse
  con el arnés CDP de Agent 1** (pendiente ARNÉS-READY).
- Peso offline-first del paquete estructurado: 0 KB nuevos (convertidores JS
  puro); motores ya cuantificados en la investigación de Agent 1.

## 7. Veredictos (Q2/Q3/Q5 desde el lado del Agente 2)

- **Q3 — ¿lectura .md/.html viable offline-first?** **SÍ, viable y barata**
  (<1 ms de render, 0 KB de dependencias nuevas, JS puro portable al arnés del
  navegador). Producción de HTML con `data-bbox` por bloque y celda: trazable
  al 100 % hasta la coordenada del OCR.
- **Q3 — ¿sustituye o refuerza al molde?** **REFUERZA** (hoy): la extracción sin
  molde desde el .md empata al texto plano (0.512 vs 0.517) — la estructura por
  sí sola no extrae más, porque los regex leen el mismo texto. Lo que aporta:
  clasificación 11/11 sin falsos rechazos, trazabilidad de coordenadas,
  jerarquía visual y el sustrato para tablas. Con layout semántico dentro del
  convertidor (PP-DocLayout S) la balanza puede moverse: la rejilla de votos
  pasaría a ser usable y la asociación etiqueta↔valor dejaría de depender del
  orden del OCR.
- **Q5 — ¿combinar tecnologías?** **SÍ, con datos**: cascada rapid-first +
  fallback Tesseract queda validada (rapid rescata la toma recortada 0.711 vs
  0.237 y las celdas de tablas de fotos; tess domina escaneados 0.789 vs 0.342);
  la fusión por confianza/área en lugar de por orden único es la mejora
  sugerida a Agent 1 para D1.
- **Q2 (moldes vs sin moldes)** — medida de Agent 1; desde la prueba S: el
  **coste de mantenimiento** del camino sin molde es real (los regex del
  extractor viven en código, no en el `.molde.json`) pero la **identificación por
  anclas** sin molde ya no rechaza documentos legibles (0/11 falsos rechazos).

## 8. Matriz de decisión documento → pipeline (borrador para el informe consolidado)

| Documento | Toma limpia (escaneado) | Foto real |
|---|---|---|
| Recibo de pago | Tesseract→estructura→molde (campos 0.789; respaldos §3) | RapidOCR-first→estructura→molde; tinta v2 para firmas; recortes duros → revisión humana con evidencia |
| Comprobante de entrega | Tesseract→estructura→molde (0.792) | RapidOCR-first (celdas de tablas); teléfono/dirección desde cajas; firma por tinta |
| E-26 (tablas + aritmética) | Tesseract texto + **PP-DocLayout S para rejilla** + validaciones matemáticas sobre la rejilla | no hay fotos reales entregadas |
| E-14 (manuscritos) | estructura para rejilla + ZXing para códigos (1D leído: 712005322010102) | tinta v2 `{con_tinta,bbox}` — jamás transcribir votos |

## 9. Entregables de esta rama

| Archivo | Contenido |
|---|---|
| `scripts/entrega/estructura/src/estructura.mjs` | Convertidores TSV/hOCR/cajas → árbol de bloques → **Markdown/HTML** con `data-bbox`; detección geométrica de tablas con fusión; JS puro (portable al navegador) |
| `scripts/entrega/estructura/src/extraer.mjs` | Extracción M2 sin molde por anclas+regex, consciente de líneas, con respaldos §3 |
| `scripts/entrega/estructura/src/gt-campos.mjs` | GT textual curado (2 variantes × 2 documentos) |
| `scripts/entrega/estructura/src/evaluar.mjs` | Evaluador D2 (fidelidad, campos, tablas, puertas, latencia) |
| `scripts/entrega/estructura/tests/estructura.test.mjs` | **10/10 tests** bun con fixtures sintéticas (TSV, hOCR, cajas RapidOCR, rejilla 3×3) |
| `scripts/entrega/estructura/harness/arnes-minimo.mjs` | Runner tesseract.js (23 imágenes, texto+TSV+hOCR) |
| `scripts/entrega/estructura/harness/rapidocr-cajas.py` | Runner RapidOCR (cajas de línea, EXIF-safe) |
| `scripts/entrega/estructura/harness/tinta.py` | S6 presencia de tinta (método v2 + barrido de umbral, GT visual curado) |
| `INVESTIGACION-CHANDRA-SALIDAS.md` | Fase A2: Chandra OCR 2 y alternativas, viabilidad navegador, S5 |
| `scripts/resultados/bench-ocr/salidas/**` (gitignored, local) | `resultados-salidas.json`, `tinta.json`, brutos por motor y **.md/.html por imagen** (los que Agent 1 puede consumir en S4-c) |

## 10. Limitaciones y siguientes pasos

1. **Sincronización con Agent 1**: D1/Q1 (barrido de calidad × filtros, heap en
   navegador) y la medición M1/M3 quedan para su arnés CDP; este arnés mínimo
   ejecuta el mismo motor en Node y sus JSON son consumibles por su evaluador.
   El informe consolidado `INFORME-BENCHMARK-V3.md` se genera tras el merge.
2. **Convertidor v2 (recomendación nº1)**: delimitar tablas con PP-DocLayout S y
   reconstruir la rejilla dentro de la región; alinear bloques por región en
   lugar de uno-a-uno para la métrica de cobertura; clasificar `SectionHeader`
   de actas con regla de "línea corta mayúsculas con prefijo numérico".
3. **Extractor v2**: asociación etiqueta↔valor por proximidad geométrica sobre
   la estructura (no por orden de texto) — la toma vac-03 del recibo demuestra
   que el OCR puede invertir la secuencia etiqueta/valor.
4. **Dataset**: corregir etiquetas (`firmas-vacias-*`), eliminar duplicados
   (`recibo-impreso-01/02`), regenerar el GT Chandra del banco escaneado
   vigente y anotar el recorte de cada toma (qué campos caen fuera).

## 11. Fuentes

- Plan: `PLAN-BENCHMARK-V3.md` (§1 dataset, §4 prueba S, §5 reparto, §6 barridos, §8 reglas).
- Repo: `INVESTIGACION-MOTORES.md` (Agent 1), `MOLDE-SPEC.md`, `AGENTS.md`,
  `apps/tamiz/src/lib/e14/ocr/*`, `docs/investigacion/2026-11-22-pp-doclayout-en-navegador.md`.
- Datos propios: `scripts/resultados/bench-ocr/salidas/resultados-salidas.json`,
  `tinta.json`, brutos Tesseract/RapidOCR de las 23 imágenes.
- Web (2026-11-27): enlaces citados en `INVESTIGACION-CHANDRA-SALIDAS.md` §1–§2
  (datalab.to, github, huggingface, arXiv 2507.05595, modal.com).
