# PROVENANCE.md — origen del código de `packages/scanner-core`

> Requerido por la auditoría post-migración (bloque 2): documento de
> procedencia del paquete absorbido. Método de absorción: **copia limpia +
> este documento** (decisión D1b del análisis de viabilidad), NO `git subtree`
> — el historial fino de cada módulo vive en el repo y aquí se registran los
> commits exactos.

## Identidad del paquete

| Campo | Valor |
|---|---|
| Nombre | `@molde-suite/scanner-core` (antes `@jg-stevan/scanner-core`; renombrado por criterio del bloque 2 de la auditoría, commit `refactor(scanner-core): renombra el paquete`) |
| Versión | `0.3.0` (private, workspace `packages/scanner-core`) |
| Rol | Fuente compartida Studio↔Tamiz: contrato del molde `.json`, motor universal v3, primitivas imagen/OCR/calidad/hash |

## Línea de origen (commits verificables con `git log -- packages/scanner-core`)

1. **Creación del paquete** — commit `1f7d8c16027b011bd40a44d19d9b0255c2883ae8`
   («Fase 6: Tamiz ejecutable (D8 opción B) + endurecimiento API»,
   2026-11-21): nace como decisión D8 opción B — el motor compartido sale de
   `apps/tamiz` hacia un paquete de workspace consumido por Studio y Tamiz.

2. **Fase 2a de la migración scanner-core** — commit
   `ed2ba12557fc61fb2d6138fbd627761d2d998513` («Fase 2a — absorcion de
   calidad, canvas-imagen y hash desde tamiz», 2026-11-24): absorción
   verbatim desde `apps/tamiz/src/lib/e14/`:
   - `core/calidad.ts` ← `apps/tamiz/src/lib/e14/bridge/calidad.ts`
   - `core/canvas-imagen.ts` ← `apps/tamiz/src/lib/e14/bridge/captura.ts`
   - `core/hash.ts` ← `apps/tamiz/src/lib/e14/hash.ts`

3. **Fase 2b — centralización del contrato** — commit
   `6b384094489725c50054269fd02f02adc533896f` («Fase 2b — contrato del molde
   centralizado con fixtures golden», 2026-11-24): `src/contract/`
   (`contrato.ts` + `sobre.ts`) y fixtures golden copiados de los moldes
   vivos (`moldes-finales/e14_acta.molde.json` v3.0.0 y el molde de
   comprobante de entrega v1.3.1).

4. **Fase 3 — deduplicación y re-cableado** — commit `ece8307` («Fase 3 —
   deduplicacion y re-cableado de apps hacia scanner-core», 2026-11-24):
   `molde/ocr-mapeo.ts` absorbido; `apps/tamiz` queda consumiendo solo los
   subpaths públicos (shims de re-export en `hash.ts`, `bridge/calidad.ts`,
   `bridge/ocr.ts`, `molde/importar.ts`, `molde/ocr-proveedor.ts`, etc.);
   reglas `no-restricted-imports` añadidas en las dos apps.

5. **Auditoría post-migración** — renombrado a `@molde-suite/scanner-core` y
   barrel público `src/index.ts` (entrada `.` del exports map).

## Invariantes de procedencia que se conservan

- El paquete **no importa de `apps/*` ni de la raíz** (frontera inversa R7).
- Las rutas históricas de Tamiz (`src/lib/e14/hash.ts`,
  `src/lib/e14/bridge/calidad.ts`, …) se conservan como **shims de
  re-export** hacia el paquete: los consumidores viejos no cambian.
- El sobre con checksum es protocolo **byte a byte**
  (`JSON.stringify(molde)` + SHA-256): la serialización absorbida no cambió.
