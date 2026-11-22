# Artefactos PP-DocLayout (referencia, 2026-11-22)

Copias de referencia del banco de pruebas, no código de producción. El
análisis completo está en
[`../2026-11-22-pp-doclayout-en-navegador.md`](../2026-11-22-pp-doclayout-en-navegador.md).

| Archivo | Qué es |
|---|---|
| `estructura-e14.js` | Prototipo de reglas E-14 + matching contra Chandra. Configurable por entorno (`RUN`, `POOL_T`, `MIN`, `STOCK_T`, `NMS_T`, `OUT`). |
| `bench-phone.js` | Lanzador de Chrome en Android por `adb` con `autorun`. Requiere `adb reverse tcp:8787`. |
| `bench-pc.js` | Lanzador de Chrome headless en PC. |
| `estructura-e14-result.json` | Salida plus-L + estructura (19/19). |
| `estructura-e14-s-result.json` | Salida S + estructura (8/19). |
| `e14-p1-chandra-gt.json` | 19 bloques GT de Chandra normalizados 0..1. |
| `e14-p1-plusL-19de19.png` | Overlay plus-L de la página 1. |
| `todas-reales-p5-plusL-19bloques.png` | Portada E-14 más completa de `Todas reales.pdf`. |

Los scripts esperan el banco de pruebas original (servidor, PDFs, modelos y
`results.jsonl`). Los modelos **no** se copian aquí por tamaño:

- S: `pp_doclayout_s.onnx` (4,9 MB)
- plus-L: `pp_doclayout_plus_l.onnx` (129,7 MB)

No modificar ni cuantizar los modelos: los resultados de este dossier son
con los ONNX stock.
