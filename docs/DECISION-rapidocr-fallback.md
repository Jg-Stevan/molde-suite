# Decisión — tarea E del PLAN-AGENTE-EXTERNO (RapidOCR .onnx): mantener como fallback SIN pesos

- **Fecha:** 2025-11-25 (cierre de la entrega del plan completo en sandbox)
- **Tarea:** E. "RapidOCR `.onnx` — BLOQUEADO por el dueño": faltan URL + SHA-256 de los
  3 modelos en `apps/tamiz/scripts/assets.lock.json`.

## Decisión escrita (la opción 2 del criterio de terminado)

**Se mantiene RapidOCR como fallback SIN pesos.** No se inventan URLs ni hashes (regla
dura del plan: "si falta el par, se documenta, no se inventa"). Consecuencias vigentes:

1. El OCR base (Tesseract spa) se materializa con `bun run preparar` y NO bloquea el
   pipeline — es el motor efectivo en campo.
2. `packages/scanner-core/ocr/rapidocr.ts` y su integración en `db-postprocess` siguen
   compilando y pasando tests SIN modelos: la ausencia de pesos es un estado LEGAL del
   kill-switch (`configuracionLista()` devuelve false sin URL), no un fallo.
3. Cualquier agente futuro que reciba los URLs+SHA-256 del dueño puede completar
   `assets.lock.json` SIN tocar código: el lock y el descargador ya soportan el par
   (url, sha256).

## Qué NO se hizo a propósito

- NO se añadieron pesos ni URLs de terceros al repo (regla: nada de modelos en el repo).
- NO se tocó el umbral de rechazo ni el OCR base para "compensar" la ausencia.
