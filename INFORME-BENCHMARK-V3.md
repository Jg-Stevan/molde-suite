# INFORME-BENCHMARK-V3.md — Consolidado del Benchmark OCR V3

> **Fecha:** 2026-11-27 · **Plan:** [`PLAN-BENCHMARK-V3.md`](PLAN-BENCHMARK-V3.md)
> **Ejecución:** Agente 1 (`bench/agente-1-arnes-motores`, informe E1: `INFORME-MOTORES-MOLDES.md`) · Agente 2 (`bench/agente-2-salidas-estructura`, informe E2: `INFORME-SALIDAS-ESTRUCTURA.md`) · Integración y cierre: este documento.
> **Dataset:** real — 23 imágenes + 1 PDF, 4 tipos de documento (recibo de pago, comprobante de entrega, E-26 parcial de 6 págs., E-14 de 2 págs.), gitignored por doctrina de privacidad.

---

## 1. Estado de ejecución del plan

| Fase | Agente 1 | Agente 2 |
|---|---|---|
| A — Investigación | ✅ `INVESTIGACION-MOTORES.md` (S1–S4+S6) | ✅ `INVESTIGACION-CHANDRA-SALIDAS.md` (Chandra + alternativas + S5) |
| B — GT | ✅ inventario 23 imágenes + GT textual/tinta AUTO (pendiente luz verde del dueño, §8) | ✅ GT campos curado + GT visual tinta (10 recortes únicos) |
| C — Arnés | ✅ `scripts/entrega/bench-ocr/` (CDP crudo, reciclaje anti-OOM, 262 corridas) | ✅ arnés mínimo propio (tesseract.js + RapidOCR Python + tinta v2); el plan §5 lo prevé para B2 |
| D — Corridas | ✅ Prueba M completa (M1/M2/M3) + barridos calidad/filtros + S6 | ✅ Prueba S completa (fidelidad, campos M2, tablas, puertas, tinta) |
| E — Informe | ✅ `INFORME-MOTORES-MOLDES.md` | ✅ `INFORME-SALIDAS-ESTRUCTURA.md` |

**Desviaciones declaradas honestas** (detalladas en cada informe): matcher de anclas del arnés A1 simplificado frente al de producción (los FR son cota superior del error); A2 usó arnés propio en Node porque la sincronización llegó antes de ARNÉS-READY; el barrido calidad/filtros quedó en A1 (A2 corrió a resolución nativa); el dataset entregó etiquetas inconsistentes y duplicados (ver [`GOBERNANZA-DATASET.md`](docs/benchmark-v3/GOBERNANZA-DATASET.md)).

## 2. Respuestas a las preguntas del plan

| # | Pregunta | Respuesta con datos | Evidencia |
|---|---|---|---|
| **Q1** | ¿Qué motor por situación? | **Rápido:** Tesseract `4.0.0_fast` (p50 1,1 s, 3.7+2 MB) — el título cambia de manos en este hardware. **Preciso (recortes):** `4.0.0_best` (mayor tasa patrón-ok en M1). **Coordenadas:** RapidOCR det (polygon por línea) o Tesseract blocks. **Plano:** tess_fast mejor recall de anclas (0.733 vs 0.481). **Tinta:** el medidor scanner-core separa perfecto donde el molde está calibrado (recibo/e14 100 %). | E1 §3.1/§3.4/§4 |
| **Q2** | ¿Moldes o sin moldes? | **El molde se queda — por familia.** M1 con molde calibrado a la familia (a_real) es el mejor: 92 % comprobante, 77 % recibo, 83 % de anclas resueltas por OCR de la propia imagen. M2 (sin molde) identifica casi siempre (e14/e26 100 %) y extrae campos fuertes por regex, pero NO localiza manuscritos ni firmas. M3 (molde auto) NO es viable como única estrategia (6-42 %): sirve como PROPONENTE de zonas. | E1 §3.4 |
| **Q3** | ¿Lectura .md/.html viable offline-first? | **SÍ, viable y casi gratis**: convertidores JS puro sin dependencias, render estructura→MD/HTML < 1 ms por página (mediana 0.7-0.8 ms), 0 KB añadidos. **REFUERZA al molde, no lo sustituye** (extracción M2-estructural 0.512 vs 0.512 texto plano): aporta trazabilidad `data-bbox`, jerarquía tipográfica, clasificación sin molde 11/11 con **0 falsos rechazos** y el sustrato para tablas. Además, el módulo **chandra-convert** (paridad 100 % char-a-char contra el GT datalab para comprobante y E-26) queda declarado OFICIAL por el dueño (2026-11-27) e integrado en `packages/scanner-core/conversion/`. | E2 §1/§7 + sesión chandra-convert |
| **Q4** | ¿Calidad y filtros? | **La resolución es la variable reina:** 800 px degrada −20 pp; 1600 px es el techo práctico (heap 152 MB pico, sin tocar el límite móvil); JPEG Q60→92 aporta +3.8 pp a 1600. **Ningún filtro global supera al original a nivel página** (B/N Otsu −8 pp; CLAHE empata y es el único aceptable si se exige normalizar) — los filtros quedan para RECORTE (M1), no como paso global. | E1 §3.2/§3.3 |
| **Q5** | ¿Conviene combinar tecnologías? | **SÍ — la cascada con datos:** ZXing capa 0 (QR leído sin OCR donde el símbolo está completo: 1/6 en el banco) → OCR página para identificación (M2 100 % en e14/e26; rapid rescata la toma recortada 0.711 vs 0.237 y celdas de tablas en fotos; tess domina escaneados 0.789 vs 0.342) → molde por familia + best en recortes para campos → respaldos cruzados de la especificación. Fusionar por confianza/área (no por orden único) es la mejora sugerida. | E1 §4 + E2 §7 |

## 3. Matriz de decisión documento → pipeline

| Documento | Toma limpia (escaneado) | Foto real |
|---|---|---|
| **Recibo de pago** | Tesseract→estructura→molde por familia (campos 0.789; respaldos de la spec) | RapidOCR-first→estructura→molde; tinta v2 para firmas; recortes duros → revisión humana con evidencia |
| **Comprobante de entrega** | Tesseract→estructura→molde (0.792) | RapidOCR-first (celdas de tablas); teléfono/dirección desde cajas; firma por tinta |
| **E-26 (tablas + aritmética)** | Tesseract texto + **PP-DocLayout S para la rejilla** + validaciones matemáticas sobre la rejilla | sin fotos reales entregadas |
| **E-14 (manuscritos)** | estructura para rejilla + ZXing para códigos (1D leído: 712005322010102) | tinta v2 `{con_tinta, bbox}` — jamás transcribir votos |

## 4. Metas del plan §7 — estado final

- [x] **GT generado** (textual + tinta, AUTO en A1 / curado en A2) — luz verde del dueño sigue pendiente (§8).
- [x] **Arnés corre con un comando** sobre el dataset real y produce JSON crudo (`bun scripts/entrega/bench-ocr/bench-ocr.mjs`; 262 corridas).
- [x] **Veredicto Q2 con datos** — molde por familia + mapa OCR global (§2 de este informe).
- [x] **Veredicto Q3 con datos** — viable offline-first; refuerza; chandra-convert oficial e integrado (§2/§5).
- [x] **Veredicto Q1/Q5 actualizados** con dataset real.
- [x] **Meta p50 ≤ 15 s por documento: CUMPLIDA** (1,1-3,3 s calientes en navegador; 1,3-5,7 s en Node).
- [x] **Meta 0 % falsos rechazos en documentos legibles: CUMPLIDA por la vía sin molde** (clasificación por anclas 11/11, 0 FR en E2). La vía con molde del arnés A1 no la cumple con el molde genérico en fotos reales (18-29/54) — cota superior por el matcher simplificado; el re-test con el motor de producción queda como pendiente.
- [x] **Meta manuscritos ≥ 95 %: CUMPLIDA por el método v2** (10/10, 0 FP / 0 FN). El medidor del arnés A1 (port de producción) marcó 21/43 global por UMBRALES de 2 moldes, no por el medidor: recibo y E-14 = 100 % (ver §5).
- [x] **Informes por agente + informe consolidado** (este documento).

## 5. Hallazgos accionables y su estado (al cierre)

| # | Hallazgo | Acción | Estado |
|---|---|---|---|
| 1 | E-26: 18 zonas de firma con umbral 0.012 aceptan la textura impresa (0.0176-0.031 PIL) → 18/18 falsos «con tinta» en el arnés | **NO se aplicó el 0.04 sugerido**: la calibración v1.2.0 del propio molde documenta que la rendija de `firma_1` mide la firma REAL en 0.0238 («2x el umbral») — 0.04 la rechazaría. Resolución requiere los ratios por zona del crudo A1 (`bench-ocr.mjs --solo-analisis`) y actas firmadas | 📌 análisis completo en `GOBERNANZA-DATASET.md` §4 |
| 2 | Comprobante: NO existe umbral estático que separe fotos con texto impreso (0.052-0.089 en zona de 0.46 de ancho) de firmas reales (0.0087-0.0413 medidos en la calibración v1.3.1). Subir a 0.10 rechazaría TODAS las firmas reales (el error peligroso). | **No tocar el umbral 0.0035** (contrato correcto para el escaneado, verificado en 8 imágenes). Vías reales: (a) recalibrar zona a_real solo sobre la rúbrica con las fotos, (b) portar el método v2 de fondo local (10/10 en este banco) al medidor por recorte | 📌 documentado en `GOBERNANZA-DATASET.md`; pendiente trabajo con fotos |
| 3 | Dataset con etiquetas mentirosas y duplicados (`firmas-vacias-02/03` llevan firma; `recibo-impreso-01/02` duplicados md5; datalab del comprobante duplicado del recibo; GT Chandra desalineado con el escaneado vigente; EXIF orientation 6) | Correcciones y regeneración de GT — sin tocar el dataset físico desde aquí (gitignored) | 📌 `GOBERNANZA-DATASET.md` con el inventario completo |
| 4 | Rejilla de votos E-26: el .md actual no sostiene la puerta matemática de la cifra repartidora (175,5) — asociación fila↔columna degradada | Convertidor v2: delimitar tablas con PP-DocLayout S y reconstruir la rejilla dentro de la región; extractor v2: asociación etiqueta↔valor por geometría | 📌 segunda ola (fase 3-e del cierre): reglas tipográficas de actas + asociación geométrica implementadas; PP-DocLayout S queda por conectar (modelo ONNX, viable en WASM) |
| 5 | Chandra-convert (paridad 100 % char-a-char vs GT datalab) fuera del repo | Integración oficial declarada por el dueño: `src/` → `packages/scanner-core/conversion/` + exportación en el historial de Tamiz | ✅ integrado (PR chandra-conversion-tamiz) |
| 6 | Meta 0 % FR con molde genérico en fotos (matcher simplificado del arnés) | Re-test con el matcher completo de producción (`editDistancePonderada` + voto + desambiguadores) | 📌 pendiente (el dato de referencia queda en el informe E1) |
| 7 | GT tinta AUTO del Agente 1 roza umbrales en E-14 | Revisión del dueño antes de correr análisis de umbrales sobre él | ⏳ luz verde pendiente (no bloquea nada más) |

## 6. Lecciones candidatas (para `lessons/`)

1. **OOM-sandbox en arneses largos**: con cgroup 4 GB, la memoria WASM del renderer de Chrome NO retorna al OS tras `Page.reload` — el único reciclaje fiable es matar el proceso Chrome completo y reinyectar estado (plan determinista ⇒ checkpoint cada N corridas + `idx = nº resultados`). Sin esto el arnés muere a las ~30 corridas (medido).
2. **Matcher de anclas sobre texto RapidOCR suelda etiqueta+valor** («Fecha:02 defebrero de2026»): un matcher por tokens/espacios falla; hay que cortar sub-tokens por frontera no-alfanumérica + contención de línea — el motor de producción ya lo resuelve con `editDistancePonderada` por línea.
3. **Umbral de tinta por familia**: un umbral calibrado sobre el escaneado limpio es invisible para la textura del papel impreso en fotos. La regla de MOLDE-SPEC §3 (`max(sin) < 0.5×min(con)`) debe verificarse SIEMPRE sobre la toma real más «sucia», y con zonas que no incluyan texto impreso vecino.
4. **Nomenclatura de pesos confirmada en corrida**: `4.0.0_fast` (2.0 MB gz) vs `4.0.0_best` (11.7 MB gz) — el best pesa 5.9× y solo se justifica en recortes (M1).
5. **Manuscritos**: el método v2 (fondo local gaussiano + contraste agudo + oscuridad absoluta, umbral 0.02) logra 10/10 con 0 FP / 0 FN, pero el margen es estrecho (sombra 0.0197 vs firma más pequeña 0.0215) — para producción conviene combinar con contraste de borde sobre el recorte.
6. **Granularidad de bloques**: matching bloque-a-bloque contra el GT Chandra se penaliza a sí mismo cuando el convertidor agrupa párrafos (E-26 p6: 38 bloques vs 17 GT, cobertura 0.77 con CER bajo) — la métrica debe alinear por región o usar layout semántico.

## 7. Reproducibilidad

```bash
# Agente 1 (arnés CDP en navegador, 262 corridas)
cd scripts/entrega/bench-ocr && bun install
bun preparar.mjs                  # verifica SHA-256 de los 11 assets + bun build → public/_bench/
bun bench-ocr.mjs                 # arnés + conductor CDP → resultados-motores.json
bun bench-ocr.mjs --solo-analisis <crudo.json>   # solo fase análisis

# Agente 2 (arnés mínimo en Node + Python)
cd scripts/entrega/estructura
bun install && bun test tests/    # convertidores, 10/10
node harness/arnes-minimo.mjs     # OCR tesseract (texto+TSV+hOCR)
python3 harness/rapidocr-cajas.py # cajas RapidOCR (EXIF-safe)
python3 harness/tinta.py          # presencia de tinta S6 (método v2)
node src/evaluar.mjs              # regenera docs/benchmark-v3/salidas/resultados-salidas.json
```

El dataset real vive en `scripts/resultados/fixtures-reales/3-DOCUMENTOS-IMPRESOS - copia/` (gitignored; origen `upload/*.part{1,2}.rar`). Las reglas de privacidad (`PLAN-BENCHMARK-V3.md` §8) se respetaron en todo el benchmark.

## 8. Pendientes y siguientes pasos

1. **Luz verde del GT tinta** (Agente 1) — revisión de `gt-tinta.json` por el dueño (5 min).
2. **Re-test de falsos rechazos con el motor de producción** (matcher completo) sobre las mismas fotos — cierra la meta 0 % por la vía del molde.
3. **Recalibración a_real del comprobante** (zona solo sobre la rúbrica, con las fotos) y decisión sobre portar el método v2 de tinta al motor por recorte.
4. **Convertidor v2 completo**: conectar PP-DocLayout S (ONNX WASM, 4.9 MB, Apache-2.0) para la rejilla de votos E-26 y sostener las puertas matemáticas desde el .md/.html.
5. **Regenerar el GT Chandra** del banco escaneado vigente tras aplicar la gobernanza del dataset.
6. **GitHub Support** para GC de `refs/pull/*` heredado de la purga Opción B (ajeno al benchmark, ya documentado en `CAMBIOS.md`).

---

*Informe consolidado generado en el cierre del Benchmark OCR V3 (integración de E1 + E2 + decisión del dueño sobre chandra-convert). Los datos crudos versionados están en `docs/benchmark-v3/`; los crudos completos del arnés A1 quedan en `scripts/resultados/bench-ocr/` (gitignored, reproducibles con un comando).*
