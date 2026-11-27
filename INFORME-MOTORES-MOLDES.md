# INFORME-MOTORES-MOLDES.md — Benchmark OCR V3 · fases B1+C1+D1+E1 (Agente 1)

> **Fecha:** 2026-11-27 · **Rama:** `bench/agente-1-arnes-motores` · **Plan:**
> [`PLAN-BENCHMARK-V3.md`](PLAN-BENCHMARK-V3.md) §5 (Agente 1) sobre el dataset
> real (4 tipos de documento, 23 imágenes). Fase A1 de investigación vive en
> [`INVESTIGACION-MOTORES.md`](INVESTIGACION-MOTORES.md). **Territorio del
> Agente 2 no tocado** (salidas .md/.html, tablas S5).
> **Estado del GT:** AUTOGENERADO (asistido por medición PIL + datalab-convert),
> pendiente de la luz verde del usuario (plan §1) — ver §2.4.

---

## 1. Qué se construyó (C1 — el arnés)

**Archivos que posee este agente** (sin conflictos con el Agente 2):

| Archivo | Qué es |
|---|---|
| `scripts/entrega/bench-ocr/entry.ts` | Bundle browser del arnés (Tesseract.js 7.0.0 fast+best, RapidOCR PP-OCRv4 sobre `onnxruntime-web` 1.31.1, ZXing 0.23.0, filtros §6, motor de moldes M1/M3, medición de tinta S6) |
| `scripts/entrega/bench-ocr/bench-ocr.mjs` → `bench-ocr.ts` | Conductor **CDP crudo** (WebSocket nativo de página, patrón `captura-a56-cdp.mjs`; sin Playwright/Puppeteer/`onnxruntime-node`, §8) + fase de análisis contra GT |
| `scripts/entrega/bench-ocr/preparar.mjs` | Materializa y verifica los 11 assets con URL+SHA-256 (lección `ppocr-keys-404`); compila `bun build` → `public/_bench/` (gitignored, anclado por la lección FIX F2) |
| `scripts/resultados/bench-ocr/dataset/*.json` | GT: `inventario.json` (23 imágenes con dimensiones nativas), `gt-recibo-pago.json`, `gt-comprobante-entrega.json`, `gt-e14.json`, `gt-e26.json`, `gt-tinta.json` |
| `scripts/resultados/bench-ocr/motores/resultados-motores.json` | Crudo de las **262 corridas** (texto, cajas, ms, heap, campos, tinta, zxing) |
| `scripts/resultados/bench-ocr/motores/resumen-motores.json` | Agregados de este informe |

**Reglas §8 cumplidas:** CDP crudo · `bun build` → `public/_bench/` · dataset
real y `upload/` jamás en git · sin duplicar canvas completo a alta resolución
(recortes locales para M1/M3/S6) · manuscritos solo `{con_tinta, bbox}` ·
pesos declarados con URL+SHA-256 (`preparar.mjs`, verificados contra el lock
de Tamiz; `4.0.0_best/spa.traineddata.gz` SHA `724c20ba…` registrado) ·
nomenclatura correcta: `4.0.0_fast` / `4.0.0_best` (jamás «best» de V2).

**Port del pipeline de producción** (cités origen línea a línea en la cabecera
de `entry.ts`): `db-postprocess.ts` LITERAL (módulo puro), `preDet` main.py 4 ops
(cap 1920 producción / 1280 en barridos §6), `cropQuad` con transform inverso,
`tensorDeCanvases` con knobs default (`anchoMax 480 · alto 40 · lote 6`),
`ctcDecode` con dict 6.623 y conf = media de probs crudas, tinta con
`adaptiveThresholdInv(31,12)` + apertura H/V (k=8.3% del ancho) + filtro de
líneas combadas (`inkRatio`) — el mismo contrato de `medirTinta` del
`universal-engine`. Fórmula `ancla_relativa` fiel: `x = x_absoluto ? zona.x :
base.x + zona.x` (universal-engine L925-930), umbral de ancla 0.72.

**Infra OOM-sandbox:** el entorno limita 4 GB y la memoria WASM del renderer no
retorna al OS: el conductor recicla Chrome completo cada 12 corridas con
reinyección de resultados (plan determinista ⇒ `idx = nº resultados`), con
checkpoint JSON cada 6 corridas y reintento automático ante muerte de Chrome.
Sin este mecanismo el arnés muere a las ~30 corridas (medido).

## 2. El dataset y su GT (B1)

### 2.1 Inventario

23 imágenes · 1 escaneado/recibo y comprobante (1700×2200) · 5 fotos reales del
recibo (2005×1504 aprox) · 1 escaneado comprobante + 4 fotos reales · E-26: 6
páginas escaneadas (1700×2200) · E-14: 2 escaneos de referencia (1000×3028) + 4
fotos reales (1185×3664 aprox, ~5.7 MB PNG). Dimensiones exactas y bytes en
`inventario.json`.

**Hallazgo del inventario:** `recibo-impreso-01/02.jpg` son byte-idénticos a
`recibo-a-impreso-firmas-vacias-02/03.jpg` (mismo tamaño en bytes) — las «2
tomas impresas» del plan son duplicados de 2 de las 3 fotos variante A. El
banco efectivo de tomas del recibo es 3 fotos únicas (el informe no promedia
dos veces la misma imagen en las métricas por-molde; sí en latencia, donde es
irrelevante).

### 2.2 GT textual (por especificación + datalab-convert)

Campos por documento: recibo 10 + 2 firmas · comprobante 9 + 1 firma · E-14 13
impresos + 17 manuscritos · E-26 42 campos + 7 validaciones matemáticas
(cuociente 230, umbral 115, cifra repartidora 175,5, 6+1 curules — aritmética
verificada por código al generar el GT). `respaldos_cruzados` de la spec
(cifra↔letras, fecha emisión↔pago, IBAN↔forma de pago, CALLE↔NRO) incluidos.

Discrepancias documentadas en los GT (valiosas para el dueño): el datalab del
comprobante es un duplicado byte-idéntico del del recibo; el datalab del recibo
corresponde al render antiguo (1624×2100) y el escaneado vigente es 1700×2200;
el molde v1.4.0 marca `importe_texto` opcional que la clasificación §4 exige; el
molde e26 exige 18 firmas obligatorias que el acta escaneada no tiene.

### 2.3 GT de tinta

Por imagen y zona (23 imágenes). Origen: nombre de archivo (variante A «firmas
vacías») + medición PIL de densidad + datalab-convert del escaneado. Los
escaneados de recibo/comprobante tienen rúbricas (tinta real ≈ 0.048-0.060);
las 9 fotos reales de recibo/comprobante están SIN firmas; E-14: jurados 1-3
firmados y jurado 4 en blanco (referencia y fotos); E-26: 18 zonas en blanco en
los 6 folios.

### 2.4 Pendiente del usuario

El plan §1 exige «GT validado por el usuario (luz verde) antes de correr». El
dueño dio la instrucción de no parar; el GT se generó AUTO y los corridas se
ejecutaron igual. **Acción pendiente:** revisar `gt-tinta.json` (los booleanos
de E-14 rozan umbrales) y `valores_por_imagen` del recibo — cualquier corrección
regenera `resumen-motores.json` con `bun bench-ocr.mjs --solo-analisis`.

## 3. Resultados de la fase D1

### 3.1 Latencia (meta §7: p50 ≤ 15 s por documento) — CUMPLE

| Motor | frío (1.ª corrida) | p50 caliente | p95 caliente | heap pico |
|---|---|---|---|---|
| **Tesseract `4.0.0_fast`** | 1 518 ms | **1 097 ms** | 1 787 ms | 85 MB |
| **RapidOCR PP-OCRv4** | 4 304 ms | **3 271 ms** | 5 618 ms | 128 MB |

24 corridas calientes por motor (23 imágenes base + 1 rep). En ESTE entorno
(Chrome headless x64, ORT WASM con 2 hilos por el techo de 4 GB) RapidOCR queda
~3× más lento que Tesseract fast: el det a 1920 es el costo dominante (el banco
B3 del repo ya medía que bajar a 1280 recorta el det ~56 %). La hipótesis de
A1 («RapidOCR mantiene recall ≥ 0.92 con la mitad de latencia») NO se sostiene
aquí en latencia; en exactitud ver §3.2 — el ranking de V2 queda REVERTIDO para
este hardware, y el `4.0.0_fast` de producción (3.7 MB de pesos) es la opción
rápida real. Heap pico de barridos: hasta 152 MB (w1600q60 rapid) — sin tocar
el techo móvil.

### 3.2 Barrido calidad §6 (ancla-recall media del subset de 6 imágenes)

| Combo | ms medio | heap pico | recall total | tess_fast | rapidocr |
|---|---|---|---|---|---|
| nativo original (línea base) | — | — | — | **0.733** | **0.481** |
| w800q60 | 1 836 | 9 MB | 0.403 | 0.581 | 0.224 |
| w800q92 | 1 983 | 12 MB | 0.460 | 0.578 | 0.341 |
| w1200q92 | 2 271 | 76 MB | 0.509 | 0.630 | 0.389 |
| w1600q60 | 2 231 | 152 MB | 0.532 | 0.706 | 0.357 |
| w1600q92 | 2 193 | 139 MB | 0.570 | **0.706** | 0.433 |

Lecturas: (1) **800 px degrada fuerte** (−20 pp vs nativo) — la resolución es
la variable reina, como sospechaba V2; (2) el JPEG Q apenas castiga entre 60 y
92 a 1600 px (+3.8 pp del 60→92); (3) el recall de RapidOCR en el barrido va
con `detCap 1280` (1.ª pasada del escalonado del repo, §6) — a 1920 nativo su
ancla-recall de línea base es 0.481; (4) el subset mezcla escaneados limpios y
fotos reales con sombra: el techo 0.73 de Tesseract refleja las páginas
difíciles, no una limitación del escaneado (en el recibo escaneado solo, el
texto sale completo: «RECIBO DE PAGO / Fecha: 03 de diciembre de 2026 / N.º
Recibo: REC-2026-0314…»).

### 3.3 Barrido filtros §6 (nativo, subset de 6)

| Filtro | ms | recall total | tess_fast | rapidocr |
|---|---|---|---|---|
| **original** (línea base) | — | — | **0.733** | **0.481** |
| gris | 2 185 | 0.552 | 0.679 | 0.426 |
| B/N Otsu (pipeline actual) | 2 090 | 0.536 | 0.651 | 0.421 |
| gris+CLAHE | 2 227 | 0.593 | 0.733 | 0.453 |

**A nivel de PÁGINA COMPLETA, ninguno de los filtros supera al original** en
este dataset (el CLAHE empata al original en tess y pierde 3 pp en rapid; Otsu
degrada 8 pp). Esto CONTRADICE la presunción del pipeline actual (B/N Otsu) y
confirma la lección del repo (N-12/Fase 5.2): la binarización global borra
información en fotos con sombra. Los filtros siguen siendo útiles a nivel
RECORTE (M1, donde el `realce` es opcional por campo), no como paso global.

### 3.4 PRUEBA M — moldes vs. sin moldes (Q2)

Agregado por estrategia·molde·motor (todas las tomas del documento; «res» =
campos leídos con texto no vacío; FR = falsos rechazos de obligatorios;
hit = % de campos cuyo ancla se halló por OCR en la propia imagen):

| Estrategia | Molde·motor | resolución | patrón ok | FR | hit ancla | ms/corrida |
|---|---|---|---|---|---|---|
| **M1** | recibo genérico · tess_best | 42/60 (70 %) | 9/42 | 18/54 | 12 % | 4 193 |
| **M1** | recibo genérico · rapid-rec | 26/60 (43 %) | 7/42 | 29/54 | 12 % | 3 408 |
| **M1** | recibo a_real · tess_best | 23/30 (77 %) | 3/21 | 5/27 | 47 % | 2 816 |
| **M1** | comprobante genérico · tess_best | 39/45 (87 %) | 9/20 | 5/25 | 67 % | 4 098 |
| **M1** | comprobante a_real · tess_best | **33/36 (92 %)** | 0/20 | 3/16 | **83 %** | 3 793 |
| **M1** | e26 p1 escaneado · tess_best | 17/24 (71 %) | 4/24 | 4/20 | 38 % | 10 442 |
| **M1** | e14 p1 escaneado · tess_best | 4/17 (24 %) | 2/6 | 5/7 | 71 % | 4 334 |
| **M3** | recibo · tess_best | 4/70 (6 %) | 0/6 | 60/64 | 10 % | 2 469 |
| **M3** | comprobante · tess_best | 19/49 (39 %) | 1/9 | 19/29 | 61 % | 3 727 |
| **M3** | e26 p1 · tess_best | 10/24 (42 %) | 0/11 | 11/20 | 38 % | 9 111 |
| **M3** | e14 p1 · tess_best | 2/21 (10 %) | 1/4 | 7/8 | 57 % | 3 255 |
| **M2** (sin molde, regex sobre página) | identificación del documento | recibo 6/6 · comp 3/5 (tess) y 5/5 (rapid) · **e14 6/6 · e26 6/6** | — | — | — | 0 (reusa base) |

**Veredicto Q2 con datos (en el alcance del arnés):**

1. **El molde gana en resolución de campos**: M1 con el molde calibrado a la
   familia (a_real) es el mejor de todos (92 % comprobante, 77 % recibo) — y su
   ancla se resuelve por OCR de la propia imagen en 47-83 % de los campos
   (el resto usa el rect de referencia del molde: el «cinturón» que el plan
   §3 pedía medir).
2. **El molde genérico sufre las fotos reales** (recibo: 70 % con FR 18/54 —
   un 33 % de rechazos falsos de obligatorios en documentos legibles: **la meta
   de 0 % NO se cumple con el molde genérico en tomas reales**). El costo de
   mantenimiento medido es concreto: pasar del genérico al `a_real` = 1 molde
   de 12 campos, misma estructura de anclas, 3 realces en vez de 9, sin
   respaldos (tabla §3.7). La adaptación por familia es la respuesta correcta
   al desplazamiento/rotación entre tomas — exactamente lo que V3 quería
   medir.
3. **M3 (molde auto) NO es viable como única estrategia** en este arnés: sin el
   rect de referencia, 6-42 % de resolución. La auto-calibración sirve como
   PROPUESTA de zonas (M1 sigue siendo quien lee), no como sustituto.
4. **M2 identifica el documento sin molde casi siempre** (e14/e26 100 %) y
   extrae los campos fuertes por regex (fechas, REC-XXXX, importe €, IBAN,
   DNI/CIF, KIT/XX/Civ), pero NO puede localizar manuscritos ni firmas (sin
   zonas no hay `{con_tinta, bbox}`) y no resuelve los campos débiles del
   comprobante (3/5 con tess). **Conclusión: M2 refuerza, no sustituye** — es
   la capa de identificación + respaldo cruzado ideal, y el insumo natural del
   molde (M1 sobre mapa OCR global es literalmente cómo trabaja el motor de
   producción desde la Fase 1a).

**Limitación honesta que matiza todo lo anterior:** el matcher de anclas del
arnés es una SIMPLIFICACIÓN de 2 pasos (contención de línea + ventanas de
sub-tokens con Levenshtein y penalización de posición, umbral 0.72) frente al
de producción (`editDistancePonderada` con costo por dígito 3, desambiguadores
con radio 0.3, voto de ≥2 anclas con consenso 0.02, ancla relacional con faro).
Por eso los FR y el M3 de este informe SUBESTIMAN al motor universal real; la
comparación RELATIVA entre estrategias y el ranking de motores por campo son
válidos; los valores absolutos de rechazo hay que leerlos como cota superior
del error.

### 3.5 S6 — presencia de tinta (manuscritos jamás transcritos)

| Documento | zonas evaluadas vs GT | resultado |
|---|---|---|
| recibo (escaneado con rúbricas + 3 fotos únicas sin firmas) | 12 | **12/12 (100 %)** |
| comprobante (escaneado con rúbrica + 4 fotos sin firmas) | 5 | 1/5 — **4 falsos «con tinta»** |
| e14 (p2: jurados 1-3 firmados, jurado 4 blanco) | 8 comparables | **8/8 (100 %)** |
| e26 (6 folios × 3 zonas en blanco) | 18 | **0/18 — 18 falsos «con tinta»** |
| **Total** | 43 | **21/43 (49 %) — meta ≥95 % NO cumplida** |

**La causa no es el medidor sino los UMBRALES de los moldes**, y es el hallazgo
más accionable del benchmark: el medidor (port fiel de `medirTinta`) separa
perfectamente el papel en el recibo (umbral 0.02 vs ratios medidos 0.046-0.054
con tinta / ≤0.014 sin) y en el E-14 (0.02 vs firmas visibles). En cambio:
- **comprobante**: umbral del molde genérico **0.0035** — la textura del papel
  impreso en las fotos reales mide 0.052-0.089 (la zona a_real de 0.46 de
  ancho incluye texto impreso) ⇒ 4/4 falsos ok. Un umbral ≥ 0.10 (o zona solo
  sobre la rúbrica) separaría de nuevo.
- **e26**: umbral **0.012** sobre el ESCANEADO (¡el caso fácil!) — la textura
  impresa de los nombres bajo las líneas de firma mide 0.022-0.031 ⇒ 18/18
  falsos ok. El propio GT lo midió independientemente con PIL (0.0176/0.0222/
  0.0273 «sin tinta manuscrita; nombres impresos»). Umbral ≥ 0.04 lo arregla.
- Falsos «sin tinta» (el error peligroso, rechazar documento válido): **0** en
  todo el dataset. El medidor es conservador y correcto; lo que falta es la
  calibración por familia (que es la filosofía del repo: «umbral de tinta con
  separación clara: max(sin tinta) < 0.5 × min(con tinta)», MOLDE-SPEC §3).

### 3.6 ZXing — línea base de códigos del E-14 (plan §6)

1/6 imágenes: **QR del acta 2 (cónsul/embajador) pág. 1 leído** (contenido
base64 completo, 157 ms). Los códigos 1D y los QR de las otras tomas no
decodifican (códigos parciales/ocluidos en fotos reales y en los escaneos de
referencia de baja resolución). La línea base independiente del OCR existe y
funciona donde el símbolo está completo; para el resto, el fallback OCR del
pipeline (paridad `Civ`) sigue siendo imprescindible — igual que en producción.

### 3.7 Coste de mantenimiento (métrica §3 de la prueba M)

| Molde | campos | anclas | respaldos | umbrales | patrones | realces |
|---|---|---|---|---|---|---|
| recibo genérico v1.4.0 | 12 | 12 | 1 | 12 | 7 | 9 |
| recibo a_real v1.0.0 | 12 | 12 | 0 | 12 | 7 | 3 |
| comprobante genérico v1.4.0 | 10 | 10 | 0 | 10 | 4 | 7 |
| comprobante a_real v1.0.0 | 10 | 10 | 0 | 10 | 5 | 3 |

La adaptación genérico→real NO añade zonas ni anclas (misma estructura) —
solo recalibra realces y, en el caso pendiente del comprobante, el umbral de
firma. Eso es el «coste de mantenimiento» concreto que la prueba M pedía
medir: **una variante por familia, sin cambiar la topología del molde**.

## 4. Respuestas a las preguntas del plan (Q1, Q2, Q4, Q5 — porción del Agente 1)

| # | Pregunta | Respuesta con datos de D1 |
|---|---|---|
| Q1 | ¿Qué motor por situación? | **S1 rápido:** `tesseract 4.0.0_fast` (p50 1.1 s, 3.7+2 MB) — el título de «rápido» cambia de manos en este hardware (V2 lo tenía RapidOCR). **S2 preciso:** tess_best en recortes (M1) — mayor tasa de patrón-ok que rapid-rec (9/42 vs 7/42 en recibo genérico; 9/20 vs — en comprobante). **S3 coordenadas:** RapidOCR det da polygon por línea con el postproceso JS puro (sin opencv); Tesseract da bbox por palabra vía blocks — ambos exportados al crudo. **S4 plano:** tess_fast texto completo con mejor recall de anclas (0.733 vs 0.481 nativo); RapidOCR suelda etiqueta+valor y exige el matcher con sub-tokens. **S6 tinta:** el medidor scanner-core (port imageproc) separa tinta/papel perfectamente donde el molde está calibrado (recibo 100 %, e14 100 %) — el umbral del molde es el factor, no el medidor. |
| Q2 | ¿Moldes `ancla_relativa` o sin moldes? | **Molde por familia (a_real) + mapa OCR global**: 92 % de resolución con 83 % de anclas reales por imagen. Sin molde (M2) identifica y extrae los campos fuertes pero no puede con manuscritos ni campos débiles. Molde auto (M3) solo como proponente de zonas. |
| Q4 | ¿Calidad y filtros? | Resolución reina: 800 px −20 pp; 1600 px = techo práctico (heap 152 MB pico). JPEG Q60→92 aporta +3.8 pp a 1600. Filtros globales: NINGUNO supera al original a nivel página (Otsu −8 pp); CLAHE empata al original y es el único aceptable si se exige normalizar. |
| Q5 | ¿Combinar tecnologías? | Sí — la cascada que ya usa producción es la correcta con datos: **ZXing capa 0** (QR leído sin OCR donde el símbolo está completo) → **RapidOCR/tess-fast página** para identificación (M2 100 % en e14/e26) → **molde por familia + tess_best en recortes** para campos → **respaldos cruzados** de la spec (implementados en el GT, evaluados como patrón-ok por campo). |

(Q3 — salidas .md/.html — es la prueba S del **Agente 2**; el arnés ya exporta
lo que su convertidor necesita: TSV/blocks de Tesseract y polygons de RapidOCR
en `resultados-motores.json`.)

## 5. Criterios de éxito del plan §7 — estado

- [x] Arnés corre con **un comando** (`bun scripts/entrega/bench-ocr/bench-ocr.mjs`) sobre el dataset real y produce JSON crudo (262 corridas).
- [x] Veredicto Q2 con datos (§3.4) — con la salvedad del matcher simplificado.
- [ ] Veredicto Q3 con datos — **Agente 2** (el arnés ya sirve sus insumos).
- [x] Veredicto Q1/Q5 actualizados con dataset real (§4).
- [x] Meta p50 ≤ 15 s por documento: **cumplida** (1.1-3.3 s calientes).
- [ ] Meta 0 % falsos rechazos en documentos legibles: **no cumplida en el arnés** (18-29/54 con el molde genérico en fotos reales; 3-6/25 con los a_real). El matcher simplificado infla el rechazo — el motor de producción (matcher completo + voto) es la vía para cerrar la meta; el benchmark deja el dato de referencia para el re-test con el motor real.
- [ ] Meta manuscritos ≥ 95 %: **no cumplida globalmente** (49 %) — pero el fallo está en los umbrales de 2 moldes (comprobante 0.0035, e26 0.012), no en el medidor: recibo y e14 = 100 %. Recalibrar umbral (≥0.04 e26 / ≥0.10 comprobante en fotos) es la acción de una línea por molde.
- [x] Informe por agente (este documento) — el consolidado V3 queda para el merge con el Agente 2.

## 6. Lecciones para `lessons/` (candidatas)

1. **OOM-sandbox en arneses largos**: en un entorno con cgroup 4 GB, la memoria
   WASM del renderer de Chrome NO retorna al OS tras `Page.reload` — el único
   reciclaje fiable es matar el proceso Chrome completo y reinyectar estado
   (plan determinista ⇒ checkpoint cada N corridas + `idx = nº resultados`).
2. **Matcher de anclas sobre texto RapidOCR suelda etiqueta+valor**
   («Fecha:02 defebrero de2026»): un matcher por tokens/espacios falla; hay que
   cortar sub-tokens por frontera no-alfanumérica + contención de línea — el
   motor de producción ya lo resuelve con `editDistancePonderada` por línea.
3. **Umbral de tinta por familia**: un umbral calibrado sobre el escaneado
   limpio (0.0035/0.012) es invisible para la textura del papel impreso en
   fotos (0.02-0.09). La regla de MOLDE-SPEC §3 (max(sin) < 0.5×min(con))
   debe verificarse SIEMPRE sobre la toma real más «sucia».
4. **Nomenclatura confirmada en corrida**: `4.0.0_fast` (2.0 MB gz) vs
   `4.0.0_best` (11.7 MB gz, SHA `724c20ba…`): el best real es 5.9× el peso del
   fast y solo se justifica en recortes (M1) — los números de §3.1/§3.4 son la
   base de la decisión.

## 7. Cómo reproducir

```bash
cd scripts/entrega/bench-ocr
bun install
bun preparar.mjs          # verifica SHA-256 de los 11 assets + bun build
bun bench-ocr.mjs         # arnés + conductor CDP → resultados-motores.json + resumen
bun bench-ocr.mjs --reanudar <parcial.json>   # reanuda tras corte
bun bench-ocr.mjs --solo-analisis <crudo.json> # solo fase análisis
```

El dataset real vive en `scripts/resultados/fixtures-reales/3-DOCUMENTOS-
IMPRESOS - copia/` (gitignored; origen `upload/*.part{1,2}.rar`, extraído con
unrar). Los assets del arnés viven en `public/_bench/` (gitignored).

---

*Informe generado por el Agente 1 del benchmark V3. Los JSON crudos y el
resumen completo acompañan a este archivo en
`scripts/resultados/bench-ocr/motores/`.*
