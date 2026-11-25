# ADR-0002 — Fase 7 del PLAN: alineación previa ORB/SIFT — DECISIÓN: no implementar en esta entrega

- **Estado:** Decidido (2026-11-25)
- **Contexto:** PLAN-DESARROLLO.md Fase 7 ("Alineación previa ORB/SIFT", opción 3.2 de la
  conversación de mejora) pide alinear la foto entrante contra la referencia ANTES de
  resolver zonas, para fotos de cámara en ángulo. ORB en celular; SIFT en masivo.
- **Restricciones del repo:** sin dependencias nuevas sin OK explícito del dueño
  (AGENTS.md). ORB/SIFT implican una librería CV nueva (opencv-js / ts-features) o una
  implementación propia de detección de keypoints — ambas fuera de las reglas actuales.

## Decisión

**NO se implementa ORB/SIFT en esta entrega.** La alineación que existe queda como
camino oficial:

1. **Detección de bordes + homografía real** (`packages/scanner-core/molde/homografia.ts`,
   `warpPerspectiva` en `core/image-processor.ts`) — corrige perspectiva con el quad.
2. **Deskew residual por perfil de proyección** (`anguloDeskew`/`corregirDeskew`, ≤25°)
   — corrección de rotación sin keypoints, ya validada (rotada-12 → 8/12 campos; el
   límite de ±10° se amplió a ±25° en la Fase 2 del plan de extracción relacional).
3. **Anclas difusas con bypass solo-textual** — el fallback correcto cuando la geometría
   no alcanza: si el dato está presente en el OCR global, el motor lo resuelve aunque la
   foto venga recortada, rotada o desplazada (regla 3 del criterio de verificación).

## Por qué no un stub de template matching

Un template matching del encabezado (opción 3.1) SIN corpus medido viola la doctrina del
repo: «los números del banco se reproducen, no se transcriben». Añadir una heurística de
alineación sin el banco de fotos difíciles para medirla crearía una segunda fuente de
geometría no auditada. Se prefiere la degradación honesta actual (ancla no encontrada →
referencia + bandera).

## Cuándo reabrir

- El dueño aprueba una dependencia CV y aporta el corpus de fotos en ángulo
  (≥20 capturas reales — mismo estándar que UMBRAL_RECHAZO_SCORE).
- Cuando la Fase 8 del PLAN-AGENTE-LAYOUT (endurecimiento) mida que la tasa de
  `ancla_no_encontrada` por geometría justifica la alineación visual.
- Nota UX-3 (§7 Fase 9, alineación multi-referencia): MISMA decisión — queda como
  propuesta en PLAN-DESARROLLO.md; sin corpus no se implementa.
