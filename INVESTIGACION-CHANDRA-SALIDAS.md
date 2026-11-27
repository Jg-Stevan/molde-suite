# INVESTIGACION-CHANDRA-SALIDAS.md — Benchmark V3 · fase A2 (Agente 2)

> **Fecha:** 2026-11-27 · **Rama:** `bench/agente-2-salidas-estructura` · **Plan:**
> [`PLAN-BENCHMARK-V3.md`](PLAN-BENCHMARK-V3.md) §4 (fase A2): Chandra OCR de
> Datalab y alternativas para **salidas estructuradas .md/.html**, más el análisis
> S5 de **tablas** (E-26 págs. 1–5 y E-14 pág. 1). Los datos empíricos de la
> prueba S corren en D2 con el arnés mínimo (`scripts/entrega/estructura/`) y se
> consolidan en [`INFORME-SALIDAS-ESTRUCTURA.md`](INFORME-SALIDAS-ESTRUCTURA.md).

---

## 1. Chandra OCR (Datalab): qué es y qué produce

| Atributo | Dato | Fuente |
|---|---|---|
| Producto | Chandra OCR (oct. 2025) y **Chandra OCR 2** (2026) — modelo OCR que convierte imágenes y PDF en **HTML/Markdown/JSON estructurados** conservando layout | [github.com/datalab-to/chandra](https://github.com/datalab-to/chandra), [blog de introducción](https://www.datalab.to/blog/introducing-chandra) |
| Arquitectura | VLM (modelo de visión-lenguaje) **transformer multimodal**, generación secuencial de marcado | [ficha del modelo](https://huggingface.co/datalab-to/chandra-ocr-2) |
| Tamaño | **4 000 M parámetros** (Chandra 2) → ≈ **8 GB en fp16** (estimación derivada: 4B × 2 bytes) | [análisis](https://www.towardsdeeplearning.com/rip-commercial-ocr-an-open-source-model-just-topped-every-benchmark-351bf9d6be10), [AlphaSignal](https://alphasignal.ai/repo/datalab-s-chandra-ocr-2-beats-gpt-4o-on-documents-at-half-the-size) |
| Licencia | **Apache 2.0** con estructura de doble licencia (pesos: opción comercial) | [análisis Towards AI](https://pub.towardsai.net/chandra-ocr-2-the-open-source-model-that-reads-what-others-cant-6a218faa0efd) |
| Español | **90+ idiomas**, escritura a mano, matemáticas, tablas, formularios | [reddit r/computervision (anuncio)](https://www.reddit.com/r/computervision/comments/1svx4zx/chandra_ocr_2_4b_opensource_model_hits_859_sota) |
| Benchmark | **85.9 % en olmOCR-bench**, por encima de GPT-4o, Gemini Flash y Mistral OCR | [AlphaSignal](https://alphasignal.ai/repo/datalab-s-chandra-ocr-2-beats-gpt-4o-on-documents-at-half-the-size) |
| Requisitos de cómputo | Servido con **vLLM sobre una NVIDIA H100 de 80 GB** (benchmark oficial); usuarios reportan también RTX 3090 | [README del modelo](https://huggingface.co/datalab-to/chandra-ocr-2/blob/808e4613421aad847f44b9383e49201fb8dd1175/README.md) |
| Salida del dataset entregado | El GT estructural `datalab-convert-*.json` es exactamente este formato: árbol de bloques con `html`, `bbox` (esquinas [x0,y0,x1,y1]), `polygon`, `block_type` (SectionHeader/Text/Table/Picture/PageFooter), `children`, `page` | dataset real V3 (verificado en D2) |

**Veredicto navegador (Q3, mitad de investigación):** un VLM de 4B parámetros NO
corre offline-first en navegador. `onnxruntime-web` (WASM/WebGPU) ejecuta
modelos convolucionales pequeños (PP-OCRv4 det ≈ 4.7 MB, PP-DocLayout-S ≈ 4.9 MB)
pero un decoder transformer de 4B necesita ~8 GB de pesos en memoria más el
KV-cache — fuera del heap WASM (límite práctico ~2–4 GB) y de cualquier móvil.
No existe export ONNX operativo de Chandra 2 para ORT-Web (los GGUF de HF son
para backends llama.cpp/GPU). **Conclusión: Chandra en el pipeline V3 es solo
(a) generador de GT estructural offline (como se hizo) o (b) servicio aparte
con GPU — jamás parte del bundle del navegador.** Lo que el navegador sí puede
es **imitar su SALIDA**: convertir las salidas de motores ligeros (TSV/hOCR de
Tesseract, cajas de RapidOCR) al mismo estilo de árbol .md/.html — que es
exactamente la prueba S.

## 2. Alternativas documentadas (misma lámina de salida estructurada)

| Modelo | Qué es | Tamaño | Licencia | Español | Navegador |
|---|---|---|---|---|---|
| **Surya OCR 2** (Datalab) | VLM de OCR + layout + orden de lectura + tablas | **650M** (≈1.3 GB fp16); el repo de Datalab lo lista como 689M | código Apache 2.0, pesos con restricciones | 90+ idiomas | No viable en WASM (decenas de GB de RAM de cómputo no, pero 1.3 GB de pesos + decoder exceden el presupuesto móvil; sin export ORT-Web operativo) |
| **Marker** (Datalab) | Conversor PDF→Markdown/HTML construido sobre Surya | depende de Surya | GPL/limitada (pesos) | sí | No (Python/servidor) |
| **olmOCR** (AllenAI) | VLM OCR basado en Qwen2-VL | ~7B | Apache 2.0 | sí | No (GPU) |
| **PP-StructureV3** (PaddleOCR 3.0) | Pipeline de parsing documental (layout+tabla+formula) | familia de módulos; PP-OCRv6 **Tiny 1.5 MB corre en navegador a ms** (jul. 2026) | **Apache 2.0** | sí | Parcialmente: los módulos ligeros sí (PP-OCRv6 Tiny), la parte VL no |
| **DocLayout-YOLO** | Detector de layout en tiempo real (YOLOv10/v12, PALA) | ~tens de MB en ONNX | AGPL-3.0 / comercial | agnóstico (solo layout) | **Sí** vía ORT-Web (≈ tamaño manejable); clases tipo paper — riesgo de sobre-segmentación en recibos |
| **PP-DocLayout S/plus-L** (ya en el repo) | Detector de layout ONNX con clases semánticas | **S 4.9 MB** / plus-L 129.7 MB | Apache 2.0 | agnóstico | **Sí** (ya probado en el repo, F1 0.914 en E-14 p1 con estructura SPIKE) |

Fuentes: [Surya 2 (blog)](https://www.datalab.to/blog/surya-2) y
[repo Surya](https://github.com/datalab-to/surya); [PaddleOCR 3.0 Technical Report](https://arxiv.org/html/2507.05595v1)
(Apache 2.0) y [PP-StructureV3](http://www.paddleocr.ai/main/en/version3.x/algorithm/PP-StructureV3/PP-StructureV3.html);
[DocLayout-YOLO](https://github.com/opendatalab/DocLayout-YOLO) y
[juliozhao/DocLayout-YOLO en HF](https://huggingface.co/juliozhao/DocLayout-YOLO);
[comparativa modal.com](https://www.modal.com/blog/8-top-open-source-ocr-models-compared).
Nota de licencia para este repo (público y offline): AGPL de DocLayout-YOLO es
incompatible con el uso comercial sin compra de licencia — PP-DocLayout S ya
investigado (Apache 2.0) es el candidato de layout en navegador sin fricción legal.

## 3. S5 — tablas en el dataset real (análisis previo a D2)

- **E-26 págs. 1–5**: el GT estructural (Chandra) marca 17 `Table` en 6 páginas:
  rejillas por partido (`CÓDIGO/NOMBRE/VOTOS/VOTOS EN LETRAS`), la tabla de
  **cifra repartidora** (`175.5`, pág. 5), el cuadro de curules y la declaratoria
  (pág. 6). Las puertas matemáticas del plan (§1) dependen de conservar
  `VOTOS` y `cifra repartidora` asociados a su partido — es decir, la **asociación
  fila↔columna**, no solo el texto.
- **E-14 pág. 1**: la rejilla relevante es `CANDIDATO/AGROPACIÓN/VOTACIÓN` +
  `NIVELACIÓN DE LA MESA` (E-11/urna/incinerados). Los **votos son manuscritos**:
  por contrato (§1) el .md/.html solo debe conservar la REJILLA y la localización
  de la tinta; jamás transcribir el valor. El código de barras 1D (712005322010102)
  y el texto impreso sí se evalúan.
- **Implicación de diseño para los convertidores** (verificado empíricamente en D2):
  reconstruir la rejilla desde líneas OCR requiere agrupar por columnas estables;
  las filas de un solo bloque de Tesseract y las celdas sueltas de RapidOCR
  fragmentan las tablas. La vía robusta en navegador es **layout semántico**
  (PP-DocLayout S ya en el repo) para delimitar la región `Table` y reconstruir
  la rejilla dentro de ella — la ruta geométrica pura sirve para tablas sencillas
  y degrada en formularios a columnas (E-26).

## 4. Frontera con el Agente 1

- El arnés definitivo (`scripts/entrega/bench-ocr/entry.ts`, CDP crudo) es de
  Agent 1; en su ausencia (rama con solo A1 al sincronizar), la prueba S corrió
  sobre el **arnés mínimo** propio (`scripts/entrega/estructura/harness/`), con
  el MISMO motor de producción (tesseract.js 7, `4.0.0_fast` spa, WASM) en Node.
  Los convertidores (`src/estructura.mjs`) son JS puro sin APIs de Node: se
  enganchan al arnés del navegador sin cambios.
- Agent 1 consume (S4-c): texto derivado del .md/.html para anclas textuales —
  disponible en `scripts/resultados/bench-ocr/salidas/md/**` (gitignored, local).

## 5. Riesgos registrados

1. **Licencia de pesos**: Chandra/Surya son Apache en el código pero los pesos
   llevan restricciones comerciales; para el repo (público) solo se usa el GT
   ya entregado, no los pesos.
2. **Estabilidad del GT**: el `datalab-convert` del recibo/comprobante corresponde
   a la variante A de FOTO REAL y viene duplicado byte a byte entre carpetas
   (md5 verificado) — el banco escaneado fue regenerado después. D2 mide CER
   contra el GT solo donde la correspondencia es real (E-26) y normaliza dígitos
   en el recibo real.
3. **Espacios perdidos en RapidOCR**: el rec de PP-OCRv4 con dict puede pegar
   palabras (`COMPROBANTEDEENTREGA...`) — afecta regex de anclas; D2 lo mide.
4. **EXIF orientation 6** en las fotos reales: cualquier runner que no aplique
   la transposición (PIL/canvas `imageOrientation`) lee el papel girado. El
   arnés mínimo y `tinta.py` lo aplican; quedó documentado como requisito del
   arnés del navegador (el decodificador de imágenes de Chrome ya lo aplica).
