# Integración DLA — Blueprint implementado

> Cómo entró el pipeline de análisis de diseño de documentos (DLA) a molde-suite
> respetando su arquitectura: 100% TypeScript client-side para el producto,
> ONNX opcional en el navegador y un sidecar Python OPCIONAL solo para
> calibración desktop. Ramo de trabajo: `feature/dla-integracion`.

## Qué se implementó (Fases 0, A, B, C del blueprint)

| Fase | Qué | Archivos |
| --- | --- | --- |
| **0** | Motor universal v3 unificado en `packages/scanner-core/molde/` con **proveedor OCR inyectable** (`configurarProveedorOcr`); Tamiz ejecuta moldes tras el gate (paso `evaluarMolde` inyectado, `acta.evaluacionMolde`). | `packages/scanner-core/molde/*`, `apps/tamiz/src/lib/e14/molde/*`, `pipeline.ts`, `protocolo.ts`, `real-core-bridge.ts` |
| **A1** | **Port SPARTAN**: retícula de tablas desde la IMAGEN (aperturas H/V + proyección) con caída a la vía por palabras OCR. Las columnas OMR vacías se detectan. | `molde/tabla-imagen.ts`, `molde/tabla-detect.ts` (`detectarTablaCompleta`), `EditorTab.tsx` |
| **A2** | **Port checkbox-extractor**: marca por forma/topología (caja hueca + componente interior) + **SÍ/NO diferencial de la v2 recuperado en v3** (`campo.si_no`). Discordancia tinta↔forma → `forma_discrepa` + revisión. | `molde/marca.ts`, `universal-engine.ts`, `universal-types.ts` |
| **A3** | **Homografía real de 4 puntos** (Gauss 8x8) + `warpPerspectiva` bilineal + **deskew por perfil de proyección** (≤10°, kill-switch por flag). Fin del recorte por bounding box. | `molde/homografia.ts`, `core/image-processor.ts` (`processImage`) |
| **B1** | Paquete `@jg-stevan/dla-onnx`: worker dedicado + onnxruntime-web (fallback WebGPU→WASM) + caché Cache Storage. Decodificadores `yolo` (NMS) y `detr` (top-k). | `packages/dla-onnx/*` |
| **B2** | Segunda opinión ONNX en casillas dudosas (`requiere_revision` + rect) → bandera `onnx_segunda_opinion`. | `tamiz …/molde/evaluacion.ts`, `dla-onnx/src/casillas.ts` |
| **B3** | Bandas OCR **dinámicas** desde regiones de layout (PP-DocLayout-S) — reemplazan las fijas 16%/20% cuando hay modelo; degradación honesta si no. | `bridge/ocr-dinamico.ts`, `protocolo.ts`, `pipeline.ts`, `dla-onnx/src/regiones.ts` |
| **B4** | Presencia de manuscrito (D-FINE) → bandera agregada `region_manuscrita_N`. JAMÁS lectura de texto (HTR sigue en revisión humana). | `dla-onnx/src/manuscrito.ts`, `molde/evaluacion.ts` |
| **C** | Sidecar Python OPCIONAL (FastAPI :3070, RapidOCR + Chandra) para acelerar calibración de Molde Studio + script local de borradores. Tamiz JAMÁS depende de esto. | `services/sidecar-dla/*`, `apps/molde-studio/scripts/importar-borrador.ts` |

## Principios respetados (AGENTS.md / MOLDE-SPEC)

- **Honestidad primero**: los detectores aportan SEÑALES (confianza, banderas); el gate y el motor deciden. Nada inventa valores; todo dudoso → `requiere_revision`.
- **Backward-compatible**: los shims `@/lib/molde/*` del Studio re-exportan del package; los moldes v3 existentes no cambian (los campos nuevos son OPCIONALES); el pipeline sin molde activo se comporta EXACTAMENTE igual que antes.
- **Kill-switches** (flags de Tamiz, overridables en localStorage `tamiz.flags.v1`):
  `evaluacionMolde` (default ON — solo actúa con molde activo), `deskew` (default ON),
  `dlaOnnx` (default OFF — requiere modelos configurados).

## Cómo probar

1. **Fase 0/A en Tamiz**: Panel de diagnóstico (DEV) → «IMPORTAR MOLDE .JSON» → escanear: el acta lleva `evaluacionMolde` (score por molde, banderas).
2. **A1 en Studio**: Capa OCR → «Detectar tabla» sobre una zona con retícula: las celdas OMR vacías aparecen con texto vacío.
3. **A2**: campos checkbox declarados con `si_no` (ventanas) deciden por delta de tinta; la forma marca `marca_forma`/`forma_discrepa`.
4. **A3**: foto en ángulo → el quad sesgado dispara warp real; inclinación residual corregida por proyección (flag `deskew`).
5. **B (ONNX)**: definir env `NEXT_PUBLIC_DLA_MODELO_CASILLAS` / `_LAYOUT` / `_MANUSCRITO` (URLs de .onnx), activar flag `dlaOnnx` en Panel DEV. Sin modelos, todo sigue en Nivel 1 (los presets/decodificadores se calibran contra el banco `lessons/` antes de activar por defecto).
6. **C (sidecar)**: `services/sidecar-dla/README.md` — `python main.py` en :3070; borradores via `/borrador-molde` o script `importar-borrador.ts`.

## Riesgos mitigados

- Modelos ONNX fuera del repo (URLs env) → bundle móvil intacto sin configurar nada.
- COOP/COEP: Tamiz ya emite condicional (middleware) — el wasm cae a 1 hilo de forma controlada sin COEP.
- Licencias: los PESOS de Hugging Face se verifican caso por caso antes de referenciar URLs propias (las librerías citadas son Apache-2.0/MIT; el YOLO12n del checkbox-detector puede venir AGPL — revisar antes de redistribuir).
