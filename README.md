# Molde Suite

Suite de herramientas para **digitalización documental guiada por moldes**: un editor para crear y calibrar el *molde* de cada tipo de documento, y un digitalizador automático que usa ese molde para identificar, verificar y aceptar (o rechazar) documentos capturados con cámara o importados como archivo.

## Las dos aplicaciones

| App | Carpeta | Qué es |
| --- | --- | --- |
| **Molde Studio** | `apps/molde-studio/` | Editor de moldes y plantillas de documentos: diseño visual sobre documentos escaneados, calibración asistida por OCR y generación del molde `.json` que describe cada tipo de documento. App completa (Next.js 16 + Prisma + SQLite). |
| **Tamiz** | `apps/tamiz/` | El **digitalizador automático**: escaneo inmersivo (cámara / importación / simulación), análisis con detección de bordes, calidad y OCR, verificación documental contra el molde e historial de escaneos con estados **ÓPTIMA / ADVERTENCIA / RECHAZADA**. Ejecutable (decisión D8-B: núcleo mínimo `packages/scanner-core` + módulos de runtime propios). |

## Flujo entre las apps

El molde `.json` es el contrato entre las dos aplicaciones:

```
Molde Studio                       Tamiz
┌─────────────────────┐            ┌─────────────────────────────┐
│ editor de moldes    │   molde    │ ESCANEAR → ANALIZANDO →     │
│ diseño + calibración│  .json     │ REVISIÓN → HISTORIAL/ENVÍO  │
│ OCR + campos        │ ─────────▶ │ (ÓPTIMA/ADVERTENCIA/        │
└─────────────────────┘            │  RECHAZADA)                 │
                                   └─────────────────────────────┘
```

Molde Studio crea y calibra el molde de cada tipo de documento (zonas, campos, anclas). Tamiz lo consume en su vista **PLANTILLAS** (con plantilla base integrada) y lo usa para decidir si un documento escaneado encaja: identificación de cabecera, campos obligatorios y opcionales, y el *gate* de calidad/OCR que produce el estado del documento en el historial.

## Estructura del monorepo

```
molde-suite/
├── apps/
│   ├── molde-studio/   ← editor de moldes (app completa, ejecutable)
│   └── tamiz/          ← digitalizador automático (capa UI)
├── index.html          ← landing del proyecto (GitHub Pages)
├── package.json        ← manifiesto de workspaces (bun/npm)
└── README.md
```

## Estado de las entregas (léelo antes de clonar)

- **Molde Studio** está completo: se instala y ejecuta como cualquier app Next.js (instrucciones en [`apps/molde-studio/README.md`](apps/molde-studio/README.md)). Los documentos escaneados de prueba, la base de datos local y los entornos (`.env`) no se publican en este repositorio.
- **Tamiz** es **ejecutable** desde el plan de implementación de 2026-11 (decisión D8, opción B): el contrato vive en `packages/scanner-core` y los módulos de runtime (`pipeline`, `captura`, `calidad`, `ocr`, `politica/umbrales`, observabilidad, puente, hooks de cámara…) están implementados en `apps/tamiz/src/lib/e14/`. `typecheck`, `lint` y el build estático están en verde. Los límites del núcleo mínimo (detector sin perspectivas completas, OCR de bandas sin calibrar con el corpus, puente sin hub) están documentados en [`docs/auditoria/03-informe-final.md`](docs/auditoria/03-informe-final.md) y [`apps/tamiz/README.md`](apps/tamiz/README.md).

## Motor universal compartido + DLA (rama feature/dla-integracion)

El motor universal v3 vive en `packages/scanner-core/molde/` y lo ejecutan las
DOS apps (proveedor OCR inyectable). Tamiz evalúa el molde activo tras el gate
(`acta.evaluacionMolde`); tablas por retícula de imagen (port SPARTAN), marcas
de casilla por forma (port checkbox-extractor + SÍ/NO diferencial v2), homografía
real + deskew, y señales ONNX opcionales (`@jg-stevan/dla-onnx`) con kill-switch.
Detalles: [`docs/DLA-INTEGRACION.md`](docs/DLA-INTEGRACION.md). Sidecar Python
OPCIONAL de calibración: [`services/sidecar-dla/`](services/sidecar-dla/).

## Ejecutar Molde Studio

```bash
bun install          # desde la raíz del monorepo (resuelve el workspace)
bun run studio:db    # crea la base de datos SQLite
bun run studio:dev   # arranca en http://localhost:3000
```

Requiere `DATABASE_URL` en `apps/molde-studio/.env` (SQLite local). El script `db:push` del app sincroniza el esquema de Prisma.
