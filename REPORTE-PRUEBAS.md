# Reporte de pruebas

Fecha: 2026-11-22 · Rama: `feat/layout-gate` · Base: `086a76a`

## Equipos

| Equipo | SO | Navegador | Versión | Notas |
|---|---|---|---|---|
| Sandbox del agente (Linux x64) | Linux | bun test / bunx tsc | bun 1.3.14, TypeScript 5.x | Verificación estática y de evaluador; **sin celular real** |
| Samsung SM-A566E | Android 10 | Chrome Android | (dossier) | SOLO como fuente de las detecciones grabadas y tiempos del dossier — no disponible para pruebas nuevas |

**Declaración de honestidad**: no hubo celular real para esta entrega. Las
corridas del celular provienen de los fixtures grabados en el banco de pruebas
del dueño (`results-banco.jsonl` → `packages/layout-core/fixtures/`). Todo lo
demás se verificó en desktop.

## F0 — S vs plus-L con estructura (E-14 p1, GT Chandra 19 bloques)

| Modelo | Aciertos | Cajas | FP | P | R | F1 | msPost* |
|---|---|---|---|---|---|---|---|
| plus-L + estructura (control) | **19/19** | 19 | 0 | 1.000 | 1.000 | **1.000** | 0.131 |
| S baseline (reglas plus-L sin ajustar) | 8/19 | 8 | 0 | 1.000 | 0.421 | 0.593 | 0.069 |
| **S + estructura SPIKE** | **16/19** | 16 | **0** | 1.000 | 0.842 | 0.914 | 0.050 |

\* Mediana de 200 corridas del post-proceso estructural en bun/desktop, sin
inferencia. Referencia móvil del dossier: 0,3–16,5 ms/página — mismo orden.

**Decisión: S CUMPLE el criterio acordado (≥ 16/19 con ≤ 1 FP: 16/19, 0 FP) →
modelo por defecto del gate con las reglas ajustadas; plus-L queda como
validación fina opcional.** Reproducible: `cd packages/layout-core && bun run spike-s`.

Matcher: IoU ≥ 0.5 o contención ≥ 0.8, greedy por score, uno-a-uno (idéntico
al prototipo). La variante "contenedor de página dividido" para candidatos fue
**rechazada** (no pasa la contención completa de la zona; produce 2 FP).

## Golden tests del evaluador (bun test, `packages/layout-core`)

| Caso | Resultado |
|---|---|
| plus-L pool 0.2 (73 cajas, sin NMS de app) + reglas E-14 | **19/19, P=R=F1=1.0**, gate ok, ms < 20 |
| plus-L stock 0.5 | 12/19 (F1 0.750) — coincide con el dossier |
| plus-L 0.4 + NMS 0.5 | 16/19 (F1 0.842) — coincide con el dossier |
| S pool 0.2 + reglas E-14 | 8/19 (P 1.0, R 0.421) — coincide con `estructura-e14-s-result.json` |
| Sin detecciones | todas las obligatorias faltantes, `ok=false` |
| Margen 2% | caja desplazada 1.5% fuera de la zona cuenta (clave dossier) |
| Baja confianza | score 0.16 con minScore 0.2 → `baja_confianza`, obligatoria rechaza |
| Sobrante (`estricto`) | 2 bloques distintos con maximo 1 → `sobrante` |
| NMS interno | duplicado entre clases (IoU ≥ 0.5) suprimido |
| `dividir` | 1 corte → 2 partes, etiquetas mapeadas, continuidad y1/y2 |
| `pagina` | reglas de otra página se omiten |
| Alias de clases | Picture/Table/SectionHeader/PageFooter → canónicas (jamás índices) |

**14 pass / 0 fail.** Regresión del motor existente: `apps/molde-studio` bun
test → **34 pass / 0 fail** (fase8-clustering + correcciones post-verificación).

## Integración

| Caso | Resultado | Evidencia |
|---|---|---|
| E-14 correcto (plus-L fixtures) | 19/19, gate `ok`, todas las reglas `ok` | test golden + spike control |
| Regla obligatoria faltante (S baseline) | `ok=false`, `obligatorias_faltantes` = 6 reglas | test "S pool 0.2" |
| Molde sin `layout` | etapa LAYOUT saltada (`evaluarEstructuraDelActa` → null) — comportamiento v3.0.0 intacto | revisión de código + typecheck |
| Documento equivocado (gate) | rechazo temprano ANTES del OCR: `RECHAZADA`/`INCOMPLETA` con `DETALLE_ESTRUCTURA — FALTA: <etiqueta> (<motivo>)` | `pipeline.ts` etapa LAYOUT |
| Fallo del paso de layout | try/catch doble (función + pipeline) → null honesto, el escaneo continúa | `estructura.ts`, `pipeline.ts` |
| Molde corrupto / checksum mal | importador rechaza con mensaje en español, sin crash | `importar.ts` (verificado en runtime: OK/mutado/plano/URL remota/>2 MB) |
| Molde antiguo sin layout | carga y se activa igual (validadores retrocompatibles) | `esMoldeUniversal` con `layout` ausente |

Casos NO ejecutados (requieren equipo/modelo del dueño): foto torcida/flash
real, E-2E móvil con OCR completo, OCR después del gate con modelo real,
modo avión real.

## Offline (PWA)

- Primera carga: **no probada en dispositivo** — el SW está verificado
  sintácticamente (`node --check sw.js`) y el build estático produce
  `out/sw.js`, `out/_headers`, `out/manifest.webmanifest`, `out/offline.html`.
- Estrategia implementada: navegaciones network-first con fallback; shell/
  tesseract/wasm cache-first (`tamiz-shell-v1`); modelos `/models/` cache-first
  (`tamiz-modelos-v1`); fotos/API: nunca cacheadas (solo red).
- Fotos en caché (debe ser no): **no** — el SW solo escribe GET de recursos
  estáticos y `/models/`; las fotos viven en dataURLs en memoria.
- plus-L: descarga opcional con progreso + SHA-256 contra el registro
  (`77afb2ca…ff0e`), caché y borrado; **verificación de hash no ejecutada con
  el archivo real** (el ONNX no está en el sandbox).

## Rendimiento

| Etapa | PC (sandbox) | Celular |
|---|---|---|
| Post-proceso estructural (evaluarEstructura) | 0.05–0.13 ms/página (mediana, 200 corridas) | 0,3–16,5 ms/página (dossier, NO re-medido) |
| Inferencia S / plus-L | no medida (sin ONNX) | 0,38 s / 5–9 s por página (dossier) |
| Build estático Tamiz | ~15 s | — |
| Build Studio | OK | — |

## Limitaciones y siguiente paso

1. Calibrar el preproceso del preset layout de dla-onnx con el contrato del
   dossier (estirado + `scale_factor`; `im_shape=[lado,lado]` en plus-L) y
   añadir el preset plus-L — con el banco de pruebas y los ONNX del dueño.
2. F7: corpus (portadas + reversos de `Todas reales.pdf`, fotos difíciles),
   matriz P/R/F1 por página/modelo y E2E en celular real.
3. QR de exportación desde Studio (payload comprimido si cabe o URL LAN).
4. Multipágina: evaluar reglas por página en el gate de Tamiz (hoy solo p1).
5. Reglas de `layout` → campos OCR (`campoId`) ya viajan en `partes[].campoId`;
   conectar el OCR por zonas de regla es el paso natural del gate.
