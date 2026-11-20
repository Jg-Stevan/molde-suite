# Molde Studio

Editor de plantillas y moldes de documentos: diseño visual de moldes sobre documentos escaneados, extracción de datos con OCR (Tesseract) y generación de documentos a partir de las plantillas. Es la app de la suite que **crea el molde `.json`** que el digitalizador **Tamiz** (`apps/tamiz`) usa para identificar y aceptar documentos.

## Stack

- **Next.js 16** (App Router) + **React 19**
- **Prisma** + **SQLite** (archivo local `db/custom.db`)
- **Tailwind CSS 4** + componentes shadcn/ui (Radix)
- **Tesseract.js** (OCR en el navegador), **pdfjs-dist** (procesado de PDF)
- **z-ai-web-dev-sdk** (extracción de datos asistida por IA)

## Requisito importante: necesita servidor

La aplicación usa **rutas de API** (`src/app/api`), **base de datos** y autenticación, por lo que **no puede ejecutarse en GitHub Pages** (que solo sirve archivos estáticos). Para usar la aplicación hay que ejecutarla en un servidor (local, VPS, Vercel, etc.).

## Desarrollo local

```bash
# 1. Instalar dependencias (bun o npm)
bun install

# 2. Configurar la base de datos
echo 'DATABASE_URL="file:./db/custom.db"' > .env
bun run db:push

# 3. Arrancar en desarrollo
bun run dev
# → http://localhost:3000
```

Producción: `bun run build` y luego `bun run start` (servidor standalone de Next).

## Estructura

| Carpeta | Contenido |
| --- | --- |
| `src/app` | Páginas y rutas de API (`/api/moldes`, `/api/pruebas`, `/api/upload`, `/api/extract-ai`, …) |
| `src/components` | Componentes de interfaz (editor de moldes, visor de documentos) |
| `src/lib` | Utilidades y clientes (Prisma, OCR, IA) |
| `scripts/` | Utilidades de calibración de OCR y creación de moldes de prueba |
| `prisma/` | Esquema de la base de datos |
| `public/` | Recursos estáticos y documentación del proyecto (`plan-creador-editor-moldes.md`) |

## Notas

- Los archivos de trabajo (documentos escaneados de prueba y base de datos local) no se incluyen en el repositorio.
- Los modelos de lenguaje de Tesseract (`eng.traineddata`, `spa.traineddata`) se incluyen en esta carpeta para que el OCR funcione sin descargas adicionales.
