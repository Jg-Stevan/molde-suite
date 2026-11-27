# Resultados — Benchmark V3 · Agente 2 (prueba S, salidas estructuradas)

Rama: `bench/agente-2-salidas-estructura` (commit 5be1f61 sobre el de Agente 1).

Este directorio es una **copia versionada de la corrida** que originalmente
vivió en `scripts/resultados/bench-ocr/salidas/` (que sigue gitignored por la
regla de privacidad del repo: ahí nunca van fotos de documentos reales). Se
subió por pedido explícito del dueño del repo (2026-11-27) para poder revisar
los resultados `.md`/`.html` directamente en GitHub. Contiene únicamente
TEXTO: transcripciones OCR estructuradas y métricas JSON — ninguna imagen.

Contenido:

- `salidas/resultados-salidas.json` — métricas completas D2 (fidelidad vs GT
  Chandra, campos M2 por variante y motor, tablas E26/E14 + puertas
  matemáticas, clasificación por anclas, latencia, meta con notas de GT).
- `salidas/tinta.json` — S6 presencia de tinta: método v2, barrido de
  parámetros, GT visual curado y hallazgos de etiquetas del dataset.
- `salidas/md/**` — el `.md`/`.html` estructurado de cada imagen (consumible
  por el Agente 1 en S4-c y por el arnés del navegador). Cuatro juegos de
  documentos del dataset real: recibo de pago, comprobante de entrega, acta
  E26 parcial de 6 páginas y acta E14 de 2 páginas.
- `salidas/bruto/**` — salida cruda por motor: tesseract (texto + TSV + hOCR
  por imagen), rapidocr (cajas de línea), resúmenes de corrida.

Ver en GitHub:

- Los `.md` se renderizan al abrirlos. Para ver los `.html` renderizados,
  abrir el archivo y pulsar el botón «Raw» (o usar cualquier visor HTML sobre
  la URL raw).
- Informes de la fase: `INFORME-SALIDAS-ESTRUCTURA.md` (veredictos) y
  `INVESTIGACION-CHANDRA-SALIDAS.md`, en la raíz del repo.

Reproducir la corrida:

```bash
cd molde-suite/scripts/entrega/estructura
bun install && bun test tests/        # convertidores, 10/10
node harness/arnes-minimo.mjs         # OCR tesseract sobre el dataset
python3 harness/rapidocr-cajas.py     # cajas RapidOCR (pip rapidocr-onnxruntime)
python3 harness/tinta.py              # presencia de tinta S6
node src/evaluar.mjs                  # regenera resultados-salidas.json
```

El dataset debe estar extraído en
`molde-suite/scripts/resultados/fixtures-reales/3-DOCUMENTOS-IMPRESOS - copia/`
(NUNCA se sube a git; solo estas salidas de texto están versionadas aquí).
