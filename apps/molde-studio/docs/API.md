# API del servidor — Molde Studio

Rutas disponibles cuando la app corre en **modo servidor** (`bun run dev` /
`bun run build && bun run start`, sin `NEXT_PUBLIC_STATIC=1`). En el build
estático (GitHub Pages) no hay backend: la capa de datos se cambia por
IndexedDB (`src/lib/repo-idb.ts`) en tiempo de compilación.

## Moldes

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | `/api/moldes` | Lista de moldes con conteo de pruebas y score de la última corrida. |
| POST | `/api/moldes` | Crear molde. Body: `{ json: MoldeUniversal }`. Valida estructura con `esMoldeUniversal` (400 si es inválida). |
| GET | `/api/moldes/:id` | Molde individual. |
| PUT | `/api/moldes/:id` | Actualizar nombre/descripción/`json` (validado). |
| DELETE | `/api/moldes/:id` | Elimina el molde y sus pruebas (cascada). |

## Pruebas (corridas)

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | `/api/pruebas?moldeId=&take=&cursor=` | Historial sin resultados pesados. `take` por defecto 100 (máx. 500). Devuelve el header `X-Total` con el total real de corridas del filtro; si el cliente recibe `data.length < X-Total` debe avisar que la lista está truncada. `cursor` = `createdAt` del último ítem devuelto (paginación keyset). |
| POST | `/api/pruebas` | Guardar corrida. Body: `{ moldeId, archivo, fuenteUrl?, resultados, score, requiereRevision }`. |
| GET | `/api/pruebas/:id` | Reporte completo (incluye `resultados` parseados). |
| PUT | `/api/pruebas/:id` | Re-ejecución en sitio: refresca `resultados`, `score` y `updatedAt`. |
| DELETE | `/api/pruebas/:id` | Idempotente. |

## Upload de documentos

| Método | Ruta | Descripción |
| --- | --- | --- |
| POST | `/api/upload` | `multipart/form-data` con `file` (y `nombre` opcional, informativo). Acepta png/jpeg/webp/heic/heif/pdf hasta **25 MB**. Devuelve `{ url: "/api/upload/<uuid>.<ext>", bytes }` (201). Errores: 400 sin file, 415 tipo no soportado, 413 demasiado grande. |
| GET | `/api/upload/<file>` | Sirve el documento con su Content-Type y cache inmutable (los nombres son UUID únicos). 404 si no existe. |

`repo.subirArchivo()` (modo servidor) usa exactamente este contrato; la URL
devuelta se persiste en `Prueba.fuenteUrl` y habilita la re-ejecución de
corridas sin re-subir el archivo.

### Storage — decisión A: disco local (elegida)

Los bytes se guardan en `uploads/<uuid>.<ext>` (directorio **fuera de
`public/`**, así no se sirven sin pasar por la ruta API). El directorio se
configura con la variable `UPLOADS_DIR` (por defecto `<cwd>/uploads`) y debe
ser persistente entre reinicios del proceso.

Justificación: el despliegue objetivo del modo servidor es un VPS/sandbox con
el servidor standalone de Next + SQLite — disco disponible y sin límites de
sistema de archivos efímero.

### Alternativa B (no implementada): bytes en la base de datos

Para plataformas sin disco persistente (p. ej. Vercel), mover los bytes a una
tabla `Archivo { id, mime, bytes }` en SQLite/Postgres y servir
`/api/upload/:id` desde la BD. El contrato HTTP no cambia; solo el
`route.ts`. Migración: guardar también los archivos existentes de `uploads/`
al crear la tabla.

## Hardening (Fase 6.2 del plan)

El CRUD está abierto por diseño mientras el deploy público sea Pages (sin
API). Para un despliegue público del modo servidor, definir `X_API_TOKEN` en
`.env`: si está presente, TODAS las rutas de escritura (POST/PUT/DELETE)
exigen el header `X-API-Token` con el mismo valor, y hay rate-limit por IP
(ver `src/lib/api-guard.ts`).

## Air-gap OCR (opcional)

Por defecto Tesseract.js descarga `spa.traineddata` desde su CDN y pdf.js su
worker desde jsdelivr. Para un despliegue sin red: colocar `spa.traineddata`
en `public/models/`, definir `NEXT_PUBLIC_OCR_OFFLINE=1` y self-hostear
`pdf.worker.min.mjs` en `public/` (ver `src/lib/ocr/ocr-client.ts` y
`src/lib/ocr/pdf-client.ts`).
