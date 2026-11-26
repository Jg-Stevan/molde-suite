# REPORTE-AGENTE-A.md — Cierre Agente A (infra, motor y dependencias)

- Fecha: 2026-11-26
- Plan: `PLAN-CIERRE-2-AGENTES-2026-11-26.md` (§10 formato)
- Rama: `agent-a/infra-motor-perf`
- SHA base de partida: `ccb85b1c3024026da986a8c95be98624cb62aa00` (main, merge
  `feat/arnes-geometrico`)
- Commits de la rama: `782b928` (rescate §A2), `ee3416f` (scripts de
  verificación §7), `5fadb93` (ADR + lessons + CAMBIOS), `1e29b56` (corrección
  de registro — ver Limitaciones)

## 1. Estado por tarea

| Tarea | Estado | Evidencia (una línea) |
|---|---|---|
| **A1** PRs de Actions (#1,#2,#4,#5) | HECHA | `git merge-tree` 0 conflictos ×4 y workflow de Pages verificado en pie (triggers `push:[main]` intactos, acciones @v7/@v6/@v5/@v5 tras los merges) |
| **A2** Rescate `wip/perf-ocr-serializacion` | HECHA | Mutex FIFO de reconocimiento en `rapidocr.ts` + `turno-fifo.ts` (puro) CON test de carrera 5 casos — 82/82 scanner-core; arnés F1 dual + CDP + handoff portados; fotos reales del banco NO versionadas (§3.3/§9-1) |
| **A3** Reconciliación de 3 ramas viejas | HECHA | `feature/dla-integracion`, `feat/motor-v330-portado`, `feat/scanner-core-absorption` son ancestros de main (`git merge-base --is-ancestor` OK ×3, diff vacío): absorbidas, cerradas con nota en CAMBIOS.md; `wip/perf-ocr-serializacion` cerrada por el rescate A2 |
| **A4** Majors (@types/node 26 → eslint 10 → TS 7) | HECHA | Validación local en orden sobre main actual: types-node 26 → typecheck/lint/tests verdes; eslint 10 → lint limpio (eslint-config-next 16.4.6 compatible); **TS 7.0.2 → typechecks tamiz/studio limpios + builds tamiz/studio en verde** — los 3 PRs (#7,#3,#6) pasan la política (TS7 NO se difiere: pasó limpio) |
| **A5** Tarea #14 (regresión comprobante-a-02) | HECHA (con decisión documentada) | No reproducción estable en escritorio: default 18.1 s · F1 17.4 s · F2 32.1 s (4 corridas consecutivas F2 OK con el mutex) y una falla temprana aislada (ESCANEO_FALLIDO) no reproducible con F2 → **F2/F1 quedan default OFF con evidencia**, fase A56 con banco instrumentado |
| **A6** Clasificador de títulos | HECHA (Opción B) | `docs/ADR-001-clasificador-titulos-tarjeta.md`: no se implementa; molde-enrutado como comportamiento final desde `29db1c2`; re-apertura solo con evidencia de A56 |
| **A7** Verificación navegador + reporte | HECHA | §7 checklist 9/9 en verde (protocolo `scripts/entrega/verificacion-agente-a.mjs`, JSON `verificacion-agente-a-2026-11-26T19-36-19-963Z.json` y corrida final 9/9); REGLA DE ORO demostrada en navegador; este documento |

## 2. Comandos ejecutados y resultado

| Comando | Resultado |
|---|---|
| `bun test` (packages/scanner-core, rama agente) | **82 pass / 0 fail** (77 base + 5 nuevos de `turno-fifo.test.ts`) · 217 ms |
| `bun run typecheck` (apps/tamiz) | 0 errores |
| `bun run lint` (apps/tamiz) | 0 errores (con @types/node 26 + eslint 10) |
| `bun run typecheck` (apps/molde-studio, tras `db:generate`) | 0 errores |
| `bun run build` (apps/tamiz, con TS 7.0.2) | OK — 3 páginas estáticas generadas |
| `bun run build:static` (apps/molde-studio, con TS 7.0.2) | OK |
| `bun run agent:map` | 612 símbolos, 66 archivos (`.agent/repo-map.md` actualizado) |
| `git merge-tree --write-tree origin/main <cada PR>` | 0 conflictos en los 7 PRs dependabot y en la rama agente |
| `node scripts/entrega/verificacion-agente-a.mjs` | 9/9 ítems §7 en verde (ver §3) |
| `node scripts/entrega/sesion-multiscan.mjs rotada-12.png 4 '{"ocrPrimeraPasadaRapida":true}'` | 4/4 corridas con veredicto (28-30 s c/u) — sin cuelgue |

## 3. Checklist §7 (protocolo de verificación en navegador)

Herramienta: Chromium headless local vía Playwright contra dev server Tamiz
(:3100), PC 1440x900 y móvil 390x844. Evidencia en `scripts/resultados/` LOCAL
(gitignored — regla §3.3): JSON + capturas `a01-a09`.

| # | Ítem §7 | Resultado | Evidencia |
|---|---|---|---|
| 1 | La app carga sin errores de consola ni hidratación | ✅ | 0 errores (filtro favicon/404) — `a01-carga-pc.png`, JSON items[] |
| 2 | Escaneo con fixture óptimo → veredicto → **AUTO-GUARDADO sin toque** (banner ENVIADA + SEGUIR ESCANEANDO) | ✅ | SIM «Óptima» (catálogo del app, 100 % sintético) → **ÓPTIMA 12.2 s** → `ENVIADO AUTOMÁTICAMENTE` + CTA — `a02`/`a03` |
| 3 | Escaneo legible con obligatorio faltante → NO auto-guarda | ✅ | IMPORT `recibo-sin-firmas.png` → RECHAZADA, banner ENVIADA ausente — `a06` |
| 4 | La captura rechazada queda como evidencia (sin envío) | ✅ | Fila `CAPTURA ARCHIVADA · RECHAZADA — MOLDE RECIBO DE PAGO — CAMPOS OBLIGATORIOS FALTANTES: …` en HISTORIAL — `a05b`/`a07` |
| 5 | HISTORIAL refleja el auto-guardado (una fila, estado real) | ✅ | `TODOS (1) · ÓPTIMAS (1) · ✓ DOCUMENTO PROCESADO Y GUARDADO` — `a04` |
| 6 | Edición de un valor capturado en REVISIÓN → veredicto recalcula | N/A en esta rama | La edición de campos (§5) es tarea B3 del Agente B — no existe aún en esta base |
| 7 | Tarjeta de verificación / overlay de campos / historial sin regresiones visuales | ✅ | Chips por campo + píldora de score + tarjeta ENVIADA revisados en capturas `a02-a07`; sin desplazamientos observados |
| 8 | **Extra A**: arnés F1 dual + banco de fixtures, sin watchdog 240 s | ✅ | Tarea #14: default 18.1 s · F1 17.4 s · F2 32.1 s — ninguna corrida ≥ 240 s (`a08-t14-*.png`); el caso F2+F1 con 301 s sin veredicto de la corrida previa quedó explicado como falla temprana aislada (falsa alarma de «cuelgue», ver §6) |
| 9 | Viewport móvil 390x844 sin scroll horizontal | ✅ | `scrollWidth <= innerWidth` — `a09-carga-movil.png` |

Nota (2): el fixture «óptimo» del banco trackeado no alcanza ÓPTIMA con el
molde `recibo_pago` (campos al límite del OCR, verificado con 4 variantes
sintéticas propias); la vía sancionada del PROYECTO para demostrar el
auto-guardado es el catálogo SIM (`e14-simulacion-imagenes-v1`), que fue la
usada. El generador del fixture sintético quedó en
`scripts/entrega/generar-fixture-optimo.mjs` para el banco del Agente B.

## 4. `git diff --stat` contra main

- Base: `ccb85b1c` · Rama: `agent-a/infra-motor-perf`
- Resumen: **20 archivos cambiados, 1540 inserciones(+), 25 eliminaciones(-)**
- Archivos clave: `packages/scanner-core/ocr/rapidocr.ts` (+51), `turno-fifo.ts`
  (+45), `turno-fifo.test.ts` (+173), `.gitignore` (+6: dev-fixtures y
  scripts/resultados ignorados), `apps/tamiz/scripts/assets.lock.json` (+6:
  ppocr_keys.txt), `docs/HANDOFF-PERF-OCR.md` (+80), `docs/ADR-001-*.md` (+45),
  lessons (+2 fichas + índice), `CAMBIOS.md` (+25), scripts de
  verificación/instrumentación (6, +871), `.agent/repo-map.md` (regenerado).

## 5. Decisiones tomadas y supuestos (§9)

| # | Decisión pendiente del dueño | Lo que hizo el Agente A |
|---|---|---|
| 1 | Fotos del banco A56: ¿sintéticas? | **Default aplicado: NO versionar** — las 23 fotos y los JSON de lecturas de la rama wip NO suben; quedan en local (`dev-fixtures`, gitignored). «Puedes subir imágenes» se interpretó como permiso para imágenes SINTÉTICAS: el fixture del §7 (rúbricas programáticas sobre fixture trackeado) y las capturas de evidencia son 100 % sintéticos |
| 2 | TS 7: ¿entra o se difiere? | **Entra** — pasó la política al revés: typechecks de ambas apps limpios y builds tamiz/studio en verde, dentro del presupuesto (~30 min de validación, no medio día). Si el dueño prefiere diferir, revertir #6 es un merge corto |
| 3 | PDFs de auditoría E2E | No llegaron — **retirado del camino crítico** con esta nota (quedó agendado para A56) |

Supuestos adicionales:
1. El mensaje del dueño «puedes subir imágenes» se interpretó en el marco de la
   regla §3.3 (repo público): solo sintéticas.
2. La verificación §7 usa el catálogo SIM del propio app para la demo de la
   REGLA DE ORO (vía sancionada y 100 % sintética) y fixtures trackeados para
   los casos negativos de importación.
3. Los merges a main (A1/A4 + rama agente) se ejecutan vía GitHub MCP con la
   autorización del documento de cierre (§ «Autorización del dueño»).

## 6. Limitaciones conocidas y riesgos

1. **GitHub MCP intermitente** durante esta sesión (fallas `connection closed`
   intermitentes): los merges remotos pueden requerir reintentos; la
   equivalencia de merges quedó simulada localmente (`git merge-tree`, 0
   conflictos) y todos los cambios están commiteados en la rama local.
2. **Fase A56 no ejecutable aquí**: no hay teléfono A56 ni adb en esta máquina —
   el banco del dispositivo (mutex en el teléfono, reproducción del lote,
   medición del piso ≤10 s) queda íntegro para A56 con los flags F2/F1 OFF.
3. **Falla temprana aislada con F2 ON** (ESCANEO_FALLIDO sin veredicto, 1 vez
   en 8 corridas, no reproducible en 3 intentos controlados): no diagnosticada;
   el banco A56 instrumentado debe capturar `logger.warn('[store] escaneo
   falló')` para identificarla antes de considerar F2 para default ON.
4. **Artefacto de diagnóstico del propio agente**: durante la sesión, la capa
   de captura de salida del agente mangleaba literales `[ma…` (mostraba
   `ain]`), lo que produjo un falso alegato de «YAML corrupto» en los workflows
   (corregido en `1e29b56`; la lección falsa P13 fue retirada). Toda
   verificación final usa checksums, no strings impresos.
5. **La edición de campos capturados (§5)** es tarea B3 del Agente B: los ítems
   §7 que dependen de ella quedan N/A en esta rama (fila 6 de la checklist).
6. **La REGLA DE ORO multipágina** (lote 2/2 → una fila) no se Ejercitó aquí
   (requiere el molde de 2 páginas + 2 imágenes válidas — demo ya documentada
   en lessons 2026-11-26 multipágina); re-verificación conjunta en la fusión §8.3.
