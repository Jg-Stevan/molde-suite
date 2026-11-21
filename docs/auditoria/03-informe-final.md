# Informe final de auditoría — registro de decisiones

Este archivo lleva el registro de decisiones (Dn) del proyecto. Actualizado tras
la ejecución del **Plan de Implementación de molde-suite** (2026-11-20) sobre
la rama `main` del monorepo.

---

## D8 — Estrategia para Tamiz (Fase 6.1 del plan)

**Fecha:** 2026-11-21 · **Estado:** EJECUTADA (opción B)

**Contexto:** Tamiz (el digitalizador automático) se publicó como capa
UI/puente sin el paquete de motor `@jg-stevan/scanner-core` ni ~35 módulos
hermanos del monorepo privado original: no compilaba y el README raíz lo
prometía como app completa.

**Opciones evaluadas** (plan §6.1):
- **A — Motor propio completo** (~2-3 semanas): re-implementar captura,
  calidad, OCR escalonado, política y observabilidad reutilizando el motor de
  Molde Studio.
- **B — Extraer el contrato (elegida):** paquete `packages/scanner-core`
  mínimo con el contrato de tipos + gate de calidad + delegación del análisis,
  para que Tamiz compile y consuma el mismo motor de OCR que Molde Studio.
- **C — Congelar Tamiz:** marcarlo "no incluido" y retirarlo del README.

**Decisión: B** (la recomendación del plan), con estos límites documentados:

1. `packages/scanner-core` exporta el contrato: `dominio/types` (Acta y
   familiares), `dominio/bridge` (E14Bridge/OpcionesEscaneo),
   `dominio/clasificador` (Clasificación + parseo Divipol del OCR),
   `core/types` (Quad/PageFilter/PageQuality), `core/image-processor`
   (detección de bordes + warp en canvas puro, sin OpenCV), `core/ocr`,
   `obs-base/breadcrumbs`.
2. Los módulos de runtime de Tamiz se implementaron mínimos pero REALES:
   `pipeline.ts`/`pipeline-recorte.ts` (decode → detección → warp → calidad →
   OCR Tesseract spa → clasificación → gate), captura (getUserMedia + anillo
   best-shot), política de umbrales, observabilidad (consola), puente (sin
   hub: honesto), simulación (documentos sintéticos dibujados en canvas).
3. Verificado: `bun run typecheck` y `bun run lint` en 0, y
   `BUILD_STATIC=1 bun run build` compila la app completa (export estático).
4. Lo que queda del camino A (próximas iteraciones): detector de bordes con
   perspectivas completas (hoy bounding-rect), OCR de bandas calibrado con el
   corpus Nairobi/El Cairo, hub de envío real para el puente, y PWA con SW
   propio. El E-14 de simulación usa un catálogo Divipol de demostración (3
   consulados) — reemplazar por el Divipol oficial al conectar producción.

**Puente con Molde Studio:** Tamiz usa el mismo motor de OCR (Tesseract.js
spa) y la clasificación de cabecera produce campos compatibles con el formato
de molde v3 (`patron`/`limpiar_valor` del mismo dominio Divipol), dejando el
camino abierto para que el acta escaneada se verifique contra el molde creado
en Molde Studio (el contrato declarado entre las dos apps).

---

## Registro histórico de decisiones previas

- **D7** — Landing/README honestos (limpieza v1): el README ya no promete
  piezas no incluidas. Re-afirmada tras D8: el README raíz ahora describe
  Tamiz como ejecutable con su alcance real.
- Otras decisiones D1-D6 y D9+ viven en el informe de auditoría original del
  repo privado (no publicado).
