# Molde Suite

Suite de herramientas para **digitalización documental guiada por moldes**: un editor para crear y calibrar el *molde* de cada tipo de documento, y un digitalizador automático que usa ese molde para identificar, verificar y aceptar (o rechazar) documentos capturados con cámara o importados como archivo.

## Las dos aplicaciones

| App | Carpeta | Qué es |
| --- | --- | --- |
| **Molde Studio** | `apps/molde-studio/` | Editor de moldes y plantillas de documentos: diseño visual sobre documentos escaneados, calibración asistida por OCR y generación del molde `.json` que describe cada tipo de documento. App completa (Next.js 16 + Prisma + SQLite). |
| **Tamiz** | `apps/tamiz/` | El **digitalizador automático**: escaneo inmersivo (cámara / importación / simulación), análisis con detección de bordes, calidad y OCR, verificación documental contra el molde e historial de escaneos con estados **ÓPTIMA / ADVERTENCIA / RECHAZADA**. Capa UI entregada (ver estado abajo). |

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
- **Tamiz** es la entrega de la **capa UI/puente** (24 archivos, incluye `CAMBIOS.txt` con el historial de la entrega). Depende de piezas del monorepo privado original que **no forman parte de esta entrega**: el paquete `@jg-stevan/scanner-core` y una veintena de módulos hermanos (`pipeline`, `captura`, `calidad`, `ocr`, `progreso`, `politica/umbrales`, etc.). Por eso **no es ejecutable por sí sola**; la lista exacta está en [`apps/tamiz/README.md`](apps/tamiz/README.md). No se ha inventado ningún módulo para "completarla".

## Ejecutar Molde Studio

```bash
bun install          # desde la raíz del monorepo (resuelve el workspace)
bun run studio:db    # crea la base de datos SQLite
bun run studio:dev   # arranca en http://localhost:3000
```

Requiere `DATABASE_URL` en `apps/molde-studio/.env` (SQLite local). El script `db:push` del app sincroniza el esquema de Prisma.
