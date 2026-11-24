# ARCHITECTURE.md — Arquitectura de datos de Molde Suite

> Compañero del `AGENTS.md` raíz. Describe el flujo del contrato `.json` del
> molde desde su autoría hasta el veredicto, y las fronteras entre workspaces.

## 1. Piezas

```
apps/molde-studio   (autoria y calibración de moldes)
apps/tamiz          (aplicación de campo: captura → validación)
packages/scanner-core   (contrato + motor universal v3 + primitivas)
packages/layout-core    (evaluador de reglas estructurales de layout)
packages/dla-onnx       (señales ONNX en navegador, modelos por URL)
```

Grafo de dependencias (workspace:*): studio y tamiz dependen de los tres
paquetes; layout-core depende de scanner-core (tipos de reglas). Ver
`.agent/repo-map.md` para el índice completo de símbolos.

## 2. Flujo del contrato `.molde.json`

```
        ┌───────────────────────── AUTORÍA (Studio) ─────────────────────────┐
        │  EditorTab: editor visual de campos/zonas/anclas/layout           │
        │      │                                                             │
        │      │  descargarJsonConChecksum()                                 │
        │      │    └─ crearSobreMolde(molde)      [scanner-core/contract]   │
        │      │         SHA-256(JSON.stringify(molde)) → sobre firmado      │
        ▼      ▼                                                             │
   .molde.json  =  { tipo:'universal', version, nombre, checksum, molde }   │
        │      o el molde plano (retrocompatible, sin checksum)             │
        └──────────────────────────────┬────────────────────────────────────┘
                                       ▼
        ┌────────────────────────── CAMPO (Tamiz) ───────────────────────────┐
        │  molde/importar.ts: importarMoldeDesdeTexto()                      │
        │      ├─ límite 2 MB, JSON.parse                                   │
        │      ├─ verificarSobreMolde()           [scanner-core/contract]   │
        │      │     recalcula SHA-256 del cuerpo; rechaza si difiere       │
        │      ├─ guardas de contrato: esMoldeUniversal + erroresContrato   │
        │      └─ paginasRef con URL remota → rechazo duro (offline)        │
        │                                                                   │
        │  registry (localStorage) / almacen (IndexedDB): moldes instalados │
        │  enrutamiento.ts: elige el molde por ratio de anclas (score)      │
        │                                                                   │
        │  bridge/real-core-bridge.ts (E14Bridge, host):                    │
        │      captura → processImage (warp/filtros, scanner-core)          │
        │      → calidad (core/calidad) → gate estructural (layout-core     │
        │      + dla-onnx) → OCR (worker Tesseract de la app)               │
        │      → evaluarDocumentoUniversal (motor v3, scanner-core)         │
        │           + proveedor OCR inyectado (configurarProveedorOcr)      │
        │      → veredicto: ÓPTIMA / ADVERTENCIA / RECHAZADA                │
        └───────────────────────────────────────────────────────────────────┘
```

## 3. Contrato del molde (resumen)

- Claves top-level: `tipo, version, nombre, descripcion?, documento?, idioma?,
  paginasRef?, campos, validaciones?, layout?, meta?` — documentación viva en
  `packages/scanner-core/src/contract/contrato.ts` (`CLAVES_TOP_LEVEL`).
- `version` del motor: `MOLDE_UNIVERSAL_VERSION = '3.2.0'` (ancla_relacional
  con faro). Los moldes vivos van v3.0.0 (e14) y v1.3.x (genéricos): el
  validador es retrocompatible.
- `campos[]`: `{ id, etiqueta, pagina, tipo, estrategia (ancla_relativa |
  ancla_relacional | x_absoluto), zona, ancla?, patron?, umbral, ... }`.
- `layout`: reglas estructurales evaluadas por `layout-core` (v3.1+, opcional).
- Especificación completa: `MOLDE-SPEC.md`; plantillas: `TEMPLATES.md`;
  moldes calibrados: `moldes-finales/` (espejo en `apps/tamiz/public/moldes/`).

## 4. Fronteras (invariantes)

1. `packages/*` nunca importa `apps/*`; las apps solo consumen subpaths
   públicos (`@molde-suite/scanner-core/...`), nunca `src/**` interno.
2. El motor es agnóstico del documento y del proveedor de OCR: lo que cambia
   entre documentos es el molde; lo que cambia entre apps es el proveedor.
3. La capa host de Tamiz (store/obs/dla/bridge de producto) no se absorbe al
   paquete: solo lógica UI-agnóstica compartida.
4. Offline-first: nada del flujo requiere red (los modelos ONNX se cargan por
   URL si el operador los configura; sin URL, Nivel 1 intacto).

## 5. Migración scanner-core (2026-11)

La consolidación de la lógica duplicada y la centralización del contrato se
ejecutaron en la rama `feat/scanner-core-absorption` (Fases 0-4). Informe
completo con evidencia: `docs/INFORME-MIGRACION.md`.
