# AGENTS.md — apps/tamiz

## Papel de la app

Tamiz aplica el molde en campo: captura (cámara o archivo) → detección y
enderezado → OCR + layout → validación contra el molde activo → veredicto
(ÓPTIMA / ADVERTENCIA / RECHAZADA) → revisión e historial. Offline-first,
sin backend propio.

## Capas (qué vive dónde)

| Capa | Ruta | Contenido |
|---|---|---|
| Bridge (host del paquete) | `src/lib/e14/bridge/` | `real-core-bridge.ts` implementa `E14Bridge` (watchdog, rescate, política de producto); OCR Tesseract (worker compartido `ocr-worker.ts`); gate estructural delega en `@jg-stevan/layout-core` |
| Molde | `src/lib/e14/molde/` | Importación/verificación del `.molde.json` (usa `contract/sobre`), registry (localStorage), almacén (IndexedDB), enrutamiento universal, evaluación (registra el proveedor OCR y llama al motor universal) |
| Store | `src/lib/e14/store/` | Zustand: sesiones, navegación, envío (capa host — NUNCA al paquete) |
| Observabilidad | `src/lib/e14/obs/` | Breadcrumbs (consume `obs-base/breadcrumbs` del paquete), LCP/CLS, hang, dispositivo |
| DLA | `src/lib/e14/dla/` | Integración ONNX (`@jg-stevan/dla-onnx`), bandas dinámicas |
| UI | `src/components/e14/` | React: panel de moldes, verificación documental, visor |

## Cómo se consume scanner-core (frontera pública)

- SIEMPRE por subpath del exports map: `@molde-suite/scanner-core/dominio/types`,
  `./core/image-processor`, `./molde/universal-engine`, `./contract/sobre`,
  `./core/calidad`, `./core/canvas-imagen`, `./core/hash`, etc.
- PROHIBIDO `@molde-suite/scanner-core/src/**` (el lint lo bloquea con
  `no-restricted-imports` en `eslint.config.mjs`).
- El proveedor OCR de la app (`molde/ocr-proveedor.ts`) se registra en el
  motor con `configurarProveedorOcr` reutilizando el MISMO worker del puente
  (`bridge/ocr-worker.ts`): un solo worker caliente por sesión.
- El MAPEO de Tesseract y las primitivas de canvas/calidad/hash viven en el
  paquete: aquí solo se llama; no reimplementes normalizaciones.

## Qué NO se absorbe al paquete (capa host, por diseño)

`store/`, `obs/`, `jornada.ts`, `dla/plusl.ts`, `bridge/real-core-bridge.ts`,
`flags.ts`: contienen zustand, IndexedDB, `window`/`navigator`, Next.js o
política de producto de Tamiz. Extraer lógica pura de ahí al paquete solo si
Studio la necesita también.

## Verificación (comandos exactos)

```bash
bun run typecheck   # tsc --noEmit
bun run lint        # eslint .
cd packages/scanner-core && bun test   # si tocaste el contrato o el motor
```

Después de cambios en `packages/*`: `bun run agent:map` desde la raíz.

## Restricciones duras

- Sin backend, sin cuentas, sin nube: los datos (moldes, actas, historial)
  viven en el dispositivo (IndexedDB/localStorage).
- Los modelos ONNX no van en el repo ni se modifican; se configuran por URL
  (`NEXT_PUBLIC_DLA_*`) y sin URL el Nivel 1 sigue funcionando igual.
- Push a `main` solo con autorización del dueño (rama + PR por defecto).
