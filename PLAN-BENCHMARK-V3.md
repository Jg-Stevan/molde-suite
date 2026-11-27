# Misión V3 — Benchmark OCR con Dataset Real: Motores, Moldes vs. Sin Moldes y Salidas Estructuradas (.md/.html)

> **Supera a V2** (`PLAN-BENCHMARK-V2.md`). Tres cambios mayores:
> 1. Las fixtures sintéticas se **sustituyen por el dataset real** entregado (4 tipos de documento con sus moldes y especificaciones).
> 2. Se añade la prueba **M: moldes vs. sin moldes** (¿la lectura por plantilla `ancla_relativa` es buena idea o conviene leer página completa?).
> 3. Se añade la prueba **S: salidas estructuradas .md/.html** estilo **Chandra OCR** (¿es viable leer así offline-first en navegador?).
> La ejecución se divide en **2 agentes trabajando en ramas git separadas**.

---

## 1. Dataset Real Entregado (reemplaza fixtures sintéticas)

Origen: `upload/3-DOCUMENTOS-IMPRESOS - copia.part1.rar` + `.part2.rar`, extraído en
`scripts/resultados/fixtures-reales/3-DOCUMENTOS-IMPRESOS - copia/`.
**Regla de seguridad: esta carpeta y `upload/` están en `.gitignore` — el dataset nunca se sube a git.**

### Inventario

| Carpeta | Contenido | Escaneado | Fotos reales | Moldes | Requerimientos |
|---|---|---|---|---|---|
| `01-RECIBO-DE-PAGO` | Recibo de pago | `pag-01.png` | 5 JPG (2 tomas impresas + 3 variante A firmas vacías) | `recibo_pago.molde.json` v1.4.0 (12 campos) + `recibo_a_real.molde.json` | `especificaci_n_de_extracci_n_recibo_de_pago.md` |
| `02-RECIBO-DE-ENTREGA` | Comprobante de entrega | `pag-01.png` | 4 JPG (variante A firmas vacías) | `comprobante_entrega.molde.json` v1.4.0 (10 campos) + `comprobante_a_real.molde.json` | `especificaci_n_de_extracci_n_comprobante_de_entrega.md` (incluye contrato JSON de salida) |
| `03-E26-ACTA-PARCIAL-6PAG` | Acta parcial de escrutinio municipal (6 págs.) | `pag-01..06.png` | — (sin fotos reales) | `e26_acta_parcial.molde.json` v1.2.0 (42 campos) + HTML del formulario | `clasificaci_n_de_datos_formulario_e_26_con.md` (validaciones matemáticas y jurídicas) |
| `04-ACTA-E14-2PAG` | Acta de escrutinio E-14 (2 págs.) | `referencia-p1/p2.png` | 4 PNG (acta 1 transmisión + acta 2 cónsul/embajador, pág. 1 y 2) | `e14_acta.molde.json` | `especificaci_n_de_extracci_n_e_14.md` + `pdf/Todas reales.pdf` |
| `molde/datalab-convert-*.json` | Salidas **Chandra OCR (Datalab)** ya convertidas: árbol de bloques con `html`, `bbox`, `polygon`, `block_type` | | | | **GT estructural de referencia** para la prueba S |

Total: ~23 imágenes + 1 PDF. Dimensiones nativas se registran en el inventario del arnés.

### Reglas extraídas de las especificaciones (obligatorias para el benchmark)

- **Manuscritos nunca se transcriben**: todo campo manuscrito se evalúa solo por
  `presencia de tinta` → `{ con_tinta: boolean, bbox: [x,y,w,h] }` (firmas, votos,
  marcas SÍ/NO, constancias, líneas C.C. de jurados).
- **Identificación por anclas textuales** con *fuzzy match* (≥2 anclas) ante título
  borroso/recortado → el clasificador debe probarse con recortes de título.
- **Respaldos cruzados** que el pipeline debe intentar: cifra vs. letras del importe,
  DNI/CIF duplicados, fecha emisión vs. fecha pago, IBAN como respaldo de forma de pago,
  teléfono como llave secundaria, CALLE ↔ NRO. de dirección.
- **E-14**: cascada de clasificación de página (encabezado → anclas exclusivas →
  código de barras 1D/QR con ZXing → paridad `Civ`) y emparejamiento pág.1+pág.2
  (DIVIPOL/Código XX/QR/KIT+Civ).
- **E-26**: validaciones aritméticas exactas (cifra↔letras, suma por partido,
  válidos = partidos + blancos, cuociente 230, umbral 115, cifra repartidora 175,5,
  6+1 curules) → el informe debe medir si el OCR produce texto que **pasa o falla
  estas puertas matemáticas**.

### Ground truth (GT)

1. **GT textual por documento**: derivado de las especificaciones (valores ejemplo)
   + curación visual por imagen (asistido con VLM, validado por el usuario) →
   `scripts/resultados/bench-ocr/dataset/gt-recibo-pago.json`, `gt-comprobante-entrega.json`,
   `gt-e14.json`, `gt-e26.json`.
2. **GT de presencia de tinta**: bboxes de firmas/marcas marcados a mano por imagen
   (luz verde del usuario antes de correr).
3. **GT estructural**: los `datalab-convert-*.json` se toman como referencia de
   jerarquía/posiciones para la prueba S.

---

## 2. Preguntas que debe responder el benchmark V3

| # | Pregunta | Prueba |
|---|---|---|
| Q1 | ¿Qué motor es mejor por situación: rápido, preciso, con coordenadas, sin coordenadas, tablas, localización de manuscritos (sin entenderlos)? | Heredada de V2 (S1–S6) |
| Q2 | ¿Los moldes (`ancla_relativa`) son buena idea o es mejor leer sin moldes? | **Prueba M (nueva)** |
| Q3 | ¿Es viable leer como `.md`/`.html` (estilo Chandra OCR) offline-first en navegador, y esa lectura estructurada puede sustituir o reforzar el molde? | **Prueba S (nueva)** |
| Q4 | ¿Cómo afectan calidad de imagen (resolución/compresión) y filtros a cada motor y a cada estrategia? | Heredada (barrido Q×F) |
| Q5 | ¿Conviene combinar tecnologías? | Heredada (C1–C4), adaptada a dataset real |

---

## 3. Prueba M — Moldes vs. Sin Moldes (Q2)

Tres estrategias sobre los mismos documentos e imágenes:

| Estrategia | Definición |
|---|---|
| **M1 — Con molde** | Pipeline actual: zonas `ancla_relativa` del `.molde.json` (12/10/42 campos) → recorte por campo → OCR por recorte (con whitelist/realce según campo) |
| **M2 — Sin molde** | OCR de página completa (texto + coordenadas) → extracción por anclas textuales y regex siguiendo la especificación (§identificación + §datos obligatorios) |
| **M3 — Molde auto** | Sin zonas fijas: se detectan anclas por OCR → se recalculan zonas dinámicas por imagen (molde autocalibrado a la foto real) |

**Métricas comparativas:**
- Exactitud por campo contra GT (obligatorios vs. opcionales por separado).
- **Robustez a la toma**: las 5 fotos reales del recibo y 4 del comprobante (ángulos,
  distancias, sombras distintas) son el banco de pruebas natural; medir degradación
  por desplazamiento/rotación entre tomas.
- Tasa de falsos rechazos en documentos legibles (meta: 0%).
- Latencia p50/p95 y pico de heap por estrategia.
- **Coste de mantenimiento**: nº de zonas/anchors a configurar por tipo de documento,
  y tiempo de adaptación cuando cambia el layout (medible al comparar molde genérico
  vs. `*_a_real.molde.json`).

---

## 4. Prueba S — Salidas Estructuradas .md/.html estilo Chandra OCR (Q3)

1. **Investigación (sin instalar nada al inicio):** Chandra OCR de Datalab —
   arquitectura, pesos (MB), licencia, soporte español, y si puede correr en
   navegador (ONNX Runtime Web/WASM) o solo Python/servidor. Alternativas a documentar:
   Marker, Surya, olmOCR, PP-StructureV3, DocLayout-YOLO + reconocedor.
2. **Convertidores propios en el arnés:** salida de motores (hOCR/TSV de Tesseract.js,
   cajas de RapidOCR) → **Markdown** (títulos, párrafos, listas, tablas) y → **HTML**
   estructurado (con `data-bbox` opcional para trazabilidad de coordenadas).
3. **Evaluación:**
   - Fidelidad vs. `datalab-convert-*.json` (GT estructural): CER por bloque,
     coincidencia de `block_type` (SectionHeader, Table, etc.), orden de lectura.
   - **Extracción de campos directamente desde el .md/.html sin molde** (M2 estructural):
     los campos de la especificación se buscan en el documento estructurado.
     Comparar exactitud/latencia contra M1 (molde) y M2 (texto plano).
   - Tablas: E26 págs. 1–5 y E14 pág. 1 como fixtures de tablas → ¿el .md/.html
     conserva la rejilla de votos usable para las validaciones matemáticas?
4. **Veredicto:** ¿la lectura .md/.html es viable offline-first (peso/velocidad/memoria)?
   ¿Sustituye al molde, lo refuerza (molde sobre estructura) o no aporta?

---

## 5. Ejecución en 2 agentes y 2 ramas git

| | **Agente 1 — Arnés + Motores + Moldes** | **Agente 2 — Salidas Estructuradas + Tablas** |
|---|---|---|
| **Rama** | `bench/agente-1-arnes-motores` | `bench/agente-2-salidas-estructura` |
| **Fases** | A1: investigación motores S1–S4 + S6 (3 candidatos/situación, fichas). B1: inventario + dimensiones de imágenes + GT textual/tinta. C1: arnés `scripts/entrega/bench-ocr/entry.ts` + `bench-ocr.mjs` (CDP crudo, `bun build` → `public/_bench/`). D1: corridas motores × calidad × filtros + **Prueba M completa** (M1/M2/M3). E1: `INFORME-MOTORES-MOLDES.md` | A2: investigación Chandra OCR + alternativas de salida estructurada + S5 tablas. B2: convertidores hOCR/TSV/cajas → `.md`/`.html` en `scripts/entrega/estructura/` (probables con fixtures de prueba propias del arnés mínimo). D2: evaluación de salidas sobre imágenes del dataset con el arnés de Agente 1 + **Prueba S completa** + tablas E26/E14 + localización de manuscritos. E2: `INFORME-SALIDAS-ESTRUCTURA.md` |
| **Entregables** | `INVESTIGACION-MOTORES.md`, GT en `scripts/resultados/bench-ocr/dataset/`, `resultados-motores.json`, informe E1 | `INVESTIGACION-CHANDRA-SALIDAS.md`, convertidores, `resultados-salidas.json`, informe E2 |
| **Archivos que posee** (sin conflictos) | `scripts/entrega/bench-ocr/**`, `scripts/resultados/bench-ocr/{motores,dataset}/**` | `scripts/entrega/estructura/**`, `scripts/resultados/bench-ocr/salidas/**` |
| **Dependencias** | Ninguna (arranca primero) | Fases A2/B2 en paralelo sin dependencia; **D2/E2 requieren el arnés de Agente 1** → sincroniza rebasando sobre `bench/agente-1-arnes-motores` (o sobre `main` tras su merge) |
| **Solo lectura** (compartido) | dataset gitignored, moldes `.molde.json`, especificaciones, `PLAN-BENCHMARK-V3.md`, `datalab-convert-*.json` | idem |

**Protocolo de sincronización:**
1. Ambos agentes arrancan desde el commit base de `main` (plan V3 + gitignore del dataset).
2. Agente 1 publica el arnés funcional en su rama → punto de corte "ARNÉS-READY".
3. Agente 2 rebase sobre ese punto y ejecuta D2/E2.
4. Merge final a `main` + informe consolidado `INFORME-BENCHMARK-V3.md`
   (tabla Q1..Q5, veredicto moldes, veredicto .md/.html, matriz de decisión documento→pipeline).

---

## 6. Barridos transversales (Ambos agentes / ejecutados por Agente 1, consumidos por ambos)

- **Calidad:** cada imagen se prueba a resolución nativa y reescalada a 800/1200/1600 px
  × JPEG Q60/Q80/Q92 (el pico de `performance.memory` decide hasta dónde subir).
- **Filtros:** original, grises, B/N Otsu (pipeline actual), gris+CLAHE, híbrido con
  whitelist numérica `0123456789/-` para fechas/códigos.
- **Latencia fría vs. caliente:** frío = primera corrida (descarga modelos + workers);
  caliente p50/p95 sobre repeticiones.
- **ZXing:** códigos 1D/QR de E-14 se leen siempre como línea base independiente del OCR.

---

## 7. Criterios de éxito

- [ ] GT validado por el usuario antes de correr (textual + tinta).
- [ ] Arnés corre con **un comando** sobre el dataset real y produce JSON crudo.
- [ ] Veredicto Q2 con datos: ¿molde, sin molde o molde auto? (exactitud, robustez por toma, latencia, coste de mantenimiento).
- [ ] Veredicto Q3 con datos: ¿lectura .md/.html viable offline-first? ¿sustituye o refuerza el molde?
- [ ] Veredicto Q1/Q5 actualizados con dataset real (motores y combinaciones).
- [ ] Metas: p50 ≤ 15 s por documento, 0% falsos rechazos en documentos legibles,
      manuscritos localizados sin transcribir (presencia de tinta ≥ 95% de acierto en firmas vacías vs. llenas).
- [ ] Informes por agente + informe consolidado V3 con matriz de decisión.

## 8. Reglas técnicas (heredadas y nuevas)

- Sin Playwright/Puppeteer/`onnxruntime-node`; CDP crudo; `bun build` → `public/_bench/` (gitignored).
- **Dataset real y `upload/` NUNCA se suben a git** (`.gitignore` ya configurado).
- Sin nuevas dependencias pesadas durante investigación; evaluar compatibilidad con la
  versión vigente de `onnxruntime-web`.
- Prohibido duplicar canvas completo a alta resolución (OOM móvil); recortes locales sí.
- Manuscritos: solo presencia de tinta + bbox; jamás transcripción (contrato de las especificaciones).
- Corrección de nomenclatura: lo etiquetado `tess-best` en logs es realmente `4.0.0_fast`.
- Orden: A (investigación, paralelo) → B (GT) → C (arnés) → D (corridas M/S) → E (informes).
