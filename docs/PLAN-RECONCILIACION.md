# Plan de Reconciliación — Fase 1 (migración `scanner-core`)

> Generado durante la ejecución de la misión de migración (rama
> `feat/scanner-core-absorption`, tag `pre-migracion`). Estado del inventario
> mecánico: `docs/INVENTARIO-EXPORTS.md` (generado con
> `bun run scripts/analyze-exports.ts`, AST con `ts.createProgram`).

## 1. Hallazgo central

La duplicación crítica NO está dentro de `apps/tamiz/src/lib/e14/` reimplementando
el motor (verificado con 18 símbolos del motor: 0 definiciones locales en tamiz).
La duplicación real son **6 bloques concretos** (D1–D6) entre tamiz/studio y
`packages/scanner-core`, más helpers de canvas triplicados dentro de tamiz.

## 2. Tabla de hallazgos

| # | Archivo A | Archivo B | Símbolos | ~Líneas | Categoría | Severidad | Esfuerzo |
|---|---|---|---|---|---|---|---|
| D1 | `apps/tamiz/src/lib/e14/bridge/captura.ts:8` | `packages/scanner-core/core/types.ts:26` | `QUAD_IDENTITY` vs `defaultQuad()` | 6/8 | Código duplicado | Media | S |
| D2 | `apps/tamiz/src/lib/e14/bridge/ocr.ts:48-89` (realce p5/p95) | `packages/scanner-core/core/image-processor.ts:216-259` | estiramiento de contraste | 40/43 | Código duplicado | Media | M |
| D3 | `apps/tamiz/src/lib/e14/molde/ocr-proveedor.ts:39-70` | `apps/molde-studio/src/lib/ocr/ocr-client.ts:146-199` | mapeo blocks→`LineaOcr` de Tesseract v7 | 55/66 | Código duplicado | Alta | M |
| D4 | `apps/molde-studio/src/lib/molde/types.ts:102-113` | `packages/scanner-core/molde/ocr-tipos.ts:10-20` | `PalabraOcr`, `LineaOcr` (byte-idénticos) | 12/11 | Código duplicado | Baja | S |
| D5 | `apps/molde-studio/src/components/studio/EditorTab.tsx:1513-1533` | `apps/tamiz/src/lib/e14/molde/importar.ts:36-56,107-142` | protocolo de sobre `.molde.json` con checksum SHA-256 | 25/45 | Tipo/contrato inseguro | Alta | M |
| D6 | `evaluacion.ts:51` + `ocr-dinamico.ts:64` + `estructura.ts:103` + `calidad.ts:7` (tamiz) | — (falta en scanner-core) | `fotoACanvas` / `fotoACanvasTope` / `dataUrlAGris` | 13-18 c/u | Código duplicado | Media | S |

## 3. Código muerto / a revisar

- Confirmado 0 export muerto en el alcance (tamiz consume 27 archivos del
  paquete; los 15 subpath del `exports` map de scanner-core tienen consumidores
  o uso interno del paquete).
- A revisar (fuera de alcance de esta migración): `herramientas/entry-replica.ts`
  importa `../packages/scanner-core/...` por ruta relativa — se mantiene
  compatible al añadir módulos nuevos (no se reubican módulos existentes).

## 4. Decisiones ejecutadas (D1–D4 del análisis de viabilidad)

| Decisión | Elección | Justificación |
|---|---|---|
| D1 historial | Copia limpia + `PROVENANCE.md` (equivalente: consolidación in-repo) | El repo externo no está disponible; `packages/scanner-core` ya existe y es la fuente viva. La absorción se hace desde `apps/tamiz` hacia el paquete |
| D2 ubicación del contrato | `packages/scanner-core/src/contract/` | Solo lo consumen scanner-core, tamiz y studio |
| D3 consumo | `"exports"` por subpath apuntando a `.ts` fuente | El monorepo ya consume fuente directa (sin build) |
| D4 validación | Type guards manuales (cero dependencias nuevas) | Regla inviolable: sin deps nuevas sin confirmar |

## 5. Alcance de absorción (Fase 2a)

**Absorbe a `packages/scanner-core/core/`:**
1. Scoring de calidad (`calidadDeActa`, `contrasteEfectivoDe`, `scoreDeCalidad`,
   `esquinasDeActa`) desde `bridge/calidad.ts` (103 líneas, canvas puro).
2. Helper `canvasDesdeDataUrl` (unifica `fotoACanvas`/`fotoACanvasTope` — D6) y
   `estirarContrasteEnCanvas` (D2) en `core/canvas-imagen.ts`.
3. `sha256HexDeDataUrl` (+`sha256HexDeTexto`, `sha256HexDeBytes`) desde
   `lib/e14/hash.ts` en `core/hash.ts`.

**NO absorbe (capa host de Tamiz, por diseño):** `store/`, `obs/`, `jornada.ts`,
`dla/plusl.ts`, `bridge/real-core-bridge.ts`, `flags.ts` (zustand/DOM/Next).

## 6. Contrato (Fase 2b)

`packages/scanner-core/src/contract/` centraliza: re-export del validador
`esMoldeUniversal`/`erroresMolde`/`MOLDE_UNIVERSAL_VERSION` (v3.2.0), guardas de
claves top-level (`tipo/version/nombre/descripcion/documento/idioma/campos/meta/
layout` + `paginasRef` opcional en Studio), protocolo del sobre con checksum
(D5) y fixtures golden reales (`moldes-finales/`).

## 7. Riesgos de la corrección y mitigación

- Cambiar `fotoACanvas` por helper compartido puede alterar el redondeo de
  dimensiones → se porta el algoritmo EXACTO (mismo `Math.round` y máximos).
- El sobre con checksum es protocolo criptográfico → se portan byte a byte
  `JSON.stringify(molde)` + `TextEncoder` + SHA-256 hex; tests golden con
  fixtures reales verifican round-trip y detección de alteración.
- Los re-exports en tamiz (`calidad.ts`, `hash.ts`, `QUAD_IDENTITY`) mantienen
  las rutas de importación existentes: cero cambios en consumidores.
