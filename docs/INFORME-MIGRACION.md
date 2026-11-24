# Informe final — Migración de `scanner-core` y transformación Agent-Ready

> Rama: `feat/scanner-core-absorption` · Tag inicial: `pre-migracion` · Tags de
> fase: `pre-fase-2b`, `pre-fase-3`, `post-migracion`.
> Ejecución continua solicitada por el dueño («no pares hasta terminar»): las
> puertas de aprobación se aplicaron como VERIFICACIÓN AUTOMÁTICA por fase
> (lint/typecheck/test + commit atómico) en lugar de pausas humanas.

## 1. Resumen ejecutivo

- **Objetivo 1 (absorber/unificar)**: completado. Los 6 duplicados confirmados
  (D1–D6) viven ahora en `packages/scanner-core`; tamiz y studio consumen por
  subpaths públicos. El contrato `.molde.json` tiene fuente única en
  `src/contract/` con fixtures golden reales.
- **Objetivo 2 (agent-ready)**: completado. `AGENTS.md` fractal (raíz ≤ 120
  líneas + scanner-core + tamiz), mapa determinista versionado
  (`.agent/repo-map.md`, diff vacío entre ejecuciones), `ARCHITECTURE.md` y
  regla de lint que fija la frontera pública del paquete.
- **Desviación documentada**: el repo externo heredado de `scanner-core` no
  estaba disponible (sin URL/ruta). Conforme al plan B de la Fase 0, la
  absorción se ejecutó desde el código vivo del monorepo (`apps/tamiz` →
  paquete), que ya contenía el sucesor directo del motor legacy.

## 2. Fases ejecutadas y evidencia

| Fase | Contenido | Verificación | Commit |
|---|---|---|---|
| 0 | Rama + tags de rollback, decisiones D1–D4, clon e inventario | `git branch/tag`, exploración exhaustiva | — (preparación) |
| 1 | `scripts/analyze-exports.ts` (AST, sin deps nuevas) + Plan de Reconciliación + inventario (356 símbolos/68 archivos) | Script ejecutable, salida determinista | `dd82dd3` |
| 2a | Absorción: `core/calidad.ts`, `core/canvas-imagen.ts` (D6+D2), `core/hash.ts`; exports + `bun test`; versión 0.2.0→0.3.0 | `tsc --strict` en los 3 módulos | `ed2ba12` |
| 2b | Contrato centralizado: `src/contract/{contrato,sobre}.ts` + fixtures golden reales + 8 tests | `bun test` 8/8; typecheck | `6b38409` |
| 3 | Deduplicación D1–D6 (tamiz y studio re-cableados), absorción calidad/hash, `no-restricted-imports` en ambas apps | typecheck+lint verdes (tamiz y studio); scanner-core 8/8; layout-core 14/14 | `ece8307` |
| 4 | AGENTS.md fractal, `scripts/agent-map.ts` (`agent:map`), `.agent/repo-map.md` versionado, `ARCHITECTURE.md`, este informe | Determinismo verificado (diff vacío); docs completas | (este commit) |

## 3. Hallazgos resueltos

| # | Duplicado (antes) | Ahora |
|---|---|---|
| D1 | `QUAD_IDENTITY` en `bridge/captura.ts:8` | `defaultQuad()` del paquete (`const` evaluada, semántica idéntica) |
| D2 | realce p5-p95 inline en `bridge/ocr.ts:48-89` | `estirarContrasteEnCanvas` (`core/canvas-imagen`) |
| D3 | mapeo blocks→`LineaOcr` en tamiz y studio (~120 líneas total) | `lineasDesdeBlocksTesseract` (`molde/ocr-mapeo`), worker por app |
| D4 | `PalabraOcr`/`LineaOcr` byte-idénticas en studio | re-export desde `molde/ocr-tipos` |
| D5 | sobre con checksum espejado productor/consumidor | `contract/sobre`: `crearSobreMolde`/`verificarSobreMolde` (byte a byte) |
| D6 | `fotoACanvas`/`fotoACanvasTope`/`dataUrlAGris` ×4 en tamiz | `canvasDesdeDataUrl` + `grisesDesdeCanvas` |
| — | scoring de calidad y hash solo en tamiz | absorbidos (`core/calidad`, `core/hash`), tamiz re-exporta |

## 4. Comandos ejecutados y resultado

| Comando | Estado | Nota |
|---|---|---|
| `bun install` (raíz) | OK | lockfile del monorepo; `typescript` promovido a devDep raíz (ya existía en apps) |
| `bun run scripts/analyze-exports.ts` | OK | 356 símbolos / 68 archivos |
| `bunx tsc --strict` (módulos nuevos) | OK | Fase 2a y 2b |
| `bun test` (scanner-core) | OK | 8/8 golden del contrato |
| `bun test` (layout-core) | OK | 14/14 |
| `bun run typecheck` (tamiz) | OK | tras re-cableado |
| `bun run lint` (tamiz) | OK | incluye la nueva frontera `no-restricted-imports` |
| `bun run typecheck` (studio) | OK | error preexistente de `@prisma/client` resuelto con `prisma generate` (clon fresco, ajeno a la migración) |
| `bun run lint` (studio) | OK | idem |
| `bun run agent:map` | OK | 279 símbolos / 35 archivos; determinismo verificado |

## 5. Riesgos y mitigaciones aplicadas

- **Redondeo de canvas**: algoritmos portados EXACTOS (mismos `Math.round`,
  mismos máximos, mismas constantes p5/p95).
- **Protocolo criptográfico del sobre**: portaje byte a byte con tests golden
  de round-trip, case-insensitivity y detección de alteración.
- **Compatibilidad de consumidores**: `calidad.ts`, `hash.ts` y `QUAD_IDENTITY`
  se conservan como rutas re-export: cero cambios en sus importadores.
- **Contrato**: guardas ADITIVAS (semver + campos no vacío); fixtures v1.x y
  v3.x en verde demuestran retrocompatibilidad.

## 6. Checklist de éxito global

- [x] `packages/scanner-core` compila y pasa sus tests dentro del workspace
- [x] `apps/tamiz` ya no contiene la lógica duplicada D1–D6 (consume el paquete)
- [x] Comportamiento preservado: algoritmos portados byte a byte + tests golden
- [x] Lint impide imports profundos hacia `packages/scanner-core/src/*`
- [x] `typecheck` y `lint` verdes en tamiz y studio; tests de paquetes en verde
- [x] `.agent/repo-map.md` generado, versionado y estable (diff vacío)
- [x] `AGENTS.md` fractal en raíz (≤120 líneas), `packages/scanner-core` y `apps/tamiz`
- [x] Contrato versionado con fixtures golden en `__fixtures__/`
- [x] `ARCHITECTURE.md` con el flujo `.json` → contract → motor → apps
- [ ] (pendiente del dueño) merge a `main` vía PR y push — requiere autorización explícita

## 7. Texto sugerido para archivar el repositorio antiguo de `scanner-core`

> **Este repositorio fue absorbido por [molde-suite](https://github.com/Jg-Stevan/molde-suite).**
> El código vive ahora en `packages/scanner-core` dentro del monorepo (paquete
> `@molde-suite/scanner-core`), junto con el contrato tipado del molde
> (`packages/scanner-core/src/contract/`), las primitivas compartidas y los
> tests golden. No se aceptan issues ni PRs aquí. Para contribuir, abre un PR
> en molde-suite (rama + PR; ver su `AGENTS.md`). Este archivo se archiva como
> solo-lectura el 2026-11-24.
>
> Pasos: Settings → General → marcar «Archive this repository» y añadir la
> nota anterior al README antes de archivar.

## 8. Re-verificación independiente (sesión 2, 2026-11-24)

Cada fase fue re-verificada desde cero en una sesión posterior, con el árbol
limpio en `feat/scanner-core-absorption` (`8b1b2e7`). Resultados:

| # | Verificación (fase) | Resultado |
|---|---|---|
| 1 | `bun run scripts/analyze-exports.ts` ×2 (Fase 1) | OK — 377 símbolos / 73 archivos; diff vacío entre ejecuciones (determinista) |
| 2 | `bun test` en `packages/scanner-core` (Fase 2b) | OK — 8/8 golden del contrato y sobre |
| 3 | `bun test` en `packages/layout-core` | OK — 14/14 |
| 4 | `tsc -p packages/scanner-core/tsconfig.json` (Fase 2a/2b) | OK — 0 errores. Tsconfig estricto AÑADIDO en esta sesión (strict, noEmit; excluye `*.test.ts` porque Bun valida los tests en runtime; sin dependencias nuevas) |
| 5 | `bun run typecheck` en `apps/tamiz` (Fase 3) | OK — exit 0 |
| 6 | `bun run lint` en `apps/tamiz` (Fase 3) | OK — exit 0 |
| 7 | `bun run typecheck` en `apps/molde-studio` (Fase 3) | OK — exit 0 |
| 8 | `bun run lint` en `apps/molde-studio` (Fase 3) | OK — exit 0 |
| 9 | **Prueba negativa de la frontera** (Fase 3): sonda temporal en tamiz con `import ... from "@molde-suite/scanner-core/src/contract/contrato"` | OK — eslint marca exactamente 1 `no-restricted-imports`; sonda eliminada tras la prueba |
| 10 | `bun run agent:map` ×2 (Fase 4) | OK — `git status .agent/` vacío tras doble ejecución (mapa versionado al día y estable) |
| 11 | `AGENTS.md` raíz ≤ 120 líneas (Fase 4) | OK — 92 líneas |
| 12 | Cadena de rollback (Fase 0) | OK — 6 tags: `pre-migracion`, `pre-fase-2`, `pre-fase-2b`, `pre-fase-3`, `pre-fase-4`, `post-migracion` (se completaron `pre-fase-2` y `pre-fase-4`, ausentes de la sesión 1) |

Gaps corregidos en esta sesión: tsconfig del paquete (gap de verificación de
la Fase 2) y tags de rollback faltantes (Fase 0). Sin cambios de código de
producto: el trabajo de la sesión 1 era correcto.

## 9. Siguientes pasos recomendados (para el dueño)

1. Revisar el diff de la rama (`git log pre-migracion..HEAD --oneline`) y abrir PR a `main`.
2. Ejecutar una prueba real en Tamiz (acta E-14 del catálogo de simulación) y una exportación/importación Studio→Tamiz con checksum antes del merge.
3. Unificar `moldes-finales/` con `apps/tamiz/public/moldes/` (2 moldes divergen en versión: `comprobante_entrega` y `recibo_pago` v1.3.0 vs v1.3.1).
4. Considerar migrar las 3 herramientas de raíz (`herramientas/*.ts`) a subpaths públicos del paquete (hoy usan rutas relativas válidas).
5. Añadir CI (lint + typecheck + tests de paquetes) para fijar las fronteras nuevas.
