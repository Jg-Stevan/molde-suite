# RESUMEN DE IMPLEMENTACIÓN — molde-suite (Fases 1-2 del plan)

**Base:** commit `e6efe38` (feat(static): preinstalar molde E-14...) de `Jg-Stevan/molde-suite`.
**Método:** clon limpio → implementación de los 8 ítems P0/P1 de la conversación + sistema de conocimiento §10 → `tsc --noEmit` y `eslint` limpios → verificación E2E en vivo (servidor Next dev puerto 3101 + SQLite + Prisma; motor corrido en navegador real contra el acta de referencia E-14 incluida en `public/actas-e14/`).
**Archivos tocados:** 9 (3 nuevos, 6 modificados) + 8 documentos nuevos de conocimiento/gobierno.

---

## 1. Cambios de código (con referencia de línea aproximada en el archivo final)

### F2 — Ruta `/api/upload` (NUEVA, 2 archivos + fix .gitignore)

El hallazgo central de la auditoría: `repo.subirArchivo()` llama `POST /api/upload` y `docs/API.md` lo documenta, pero el handler **nunca existió** en el repo. **Causa raíz descubierta durante esta implementación:** el `.gitignore` raíz tenía el patrón suelto `upload/` (matchea CUALQUIER directorio llamado "upload", incluido `src/app/api/upload/`) — el commit 8dec868 del repo ANUNCIÓ la ruta en su mensaje pero `git add` la ignoró en silencio y solo entraron .gitignore/docs/db.ts. Este mismo patrón nos excluyó la ruta nueva durante el empaquetado inicial de este trabajo (verificado en vivo), y se corrigió anclando los patrones a la raíz (`/upload/`, `/db/`, `/download/`, `/skills/`, `/public/actas/`).

- **`src/app/api/upload/route.ts`** (nuevo): POST multipart → `req.formData()` → valida MIME (png/jpeg/webp/heic/heif/pdf) y 25 MB → guarda `uploads/<uuid>.<ext>` (disco local, decisión A de docs/API.md; `UPLOADS_DIR` configurable) → `{ url, bytes }` 201. Errores de contrato: 400 sin file, 415 tipo, 413 tamaño. Rate-limit + token vía `protegerEscritura` (Fase 6.2 existente).
- **`src/app/api/upload/[file]/route.ts`** (nuevo): GET sirve el documento con Content-Type y `Cache-Control: immutable`; 404 si no existe. Blindaje path-traversal: regex de nombre `[uuid].[ext]` + contención de ruta resuelta en el directorio de uploads.
- **`.gitignore`** (raíz): anclaje de patrones de datos runtime — sin esto, la ruta vuelve a perderse en el próximo commit.

### F1 — Matcher de anclas (motor, `universal-engine.ts`)

- **1.3 Levenshtein ponderado (causa raíz):** nueva `editDistancePonderada()` — sustituir dígito→dígito distinto cuesta **3**, insertar/borrar un dígito **2** (si no, la ruta insert+delete eludiría la penalización), letras 1 como siempre. `buscarAncla()` usa la versión ponderada (estricta y anagrama). `editDistance` original queda exportada intacta (la usan los scripts de calibración).
- **1.1 Dedupe de rects (defensa en profundidad):** `marcarColisiones()` tras resolver cada página — dos campos distintos con IoU > 0.8 (o rects idénticos) reciben bandera `ancla_colision` y jamás permanecen `ok` (→ `requiere_revision`). Atraparía tanto el falso positivo de Cairo (J4 midiendo la firma de J2) como la colisión de Frankfurt (J1≡J3 con crops idénticos).
- **1.2 Desambiguadores (opción de la conversación):** `CampoUniversal.desambiguadores?: string[]` — textos que deben aparecer por OCR a ≤0.3 (normalizado) del ancla encontrada para aceptar el hit; si no, se rechaza con bandera `desambiguacion_fallida` y cae a respaldo/referencia. Backward-compatible (opcional; validado en `esMoldeUniversal`/`erroresMolde`).

### N1/N3/N4 — Flujo "Probar Plantilla" (componentes)

- **N1 (`EditorTab.tsx`):** si no existe corrida con `fuenteUrl`, toast destructivo *"No hay ninguna corrida con archivo fuente guardado — Sube un documento en Verificación (botón +) al menos una vez..."* + navegación normal. Ya no hay no-op silencioso.
- **N2 (`studio-store.ts` + `EditorTab.tsx`):** `guardarMoldeActual()` ahora valida con `erroresMolde()` antes del PUT (UNA sola ruta de guardado para "Guardar Plantilla", "Probar Plantilla" y el banner de Verificación). Si el guardado falla, "Probar Plantilla" aborta (probar contra la versión vieja sería engañoso).
- **N3 (`VerificacionTab.tsx`):** la bandera one-shot se pasa como callback `{ consumirBandera }` a `reejecutarCorrida`, que la consume SOLO cuando el disparo ocurre. Guardas de ocupado devuelven sin consumir (el efecto reintenta — reintegro real, no bandera perdida).
- **N4 (`VerificacionTab.tsx`):** re-ejecución condicional — si la corrida YA refleja la última versión guardada del molde (`updated_at >= molde.updatedAt`), toast *"La corrida ya está al día... no se re-ejecuta"* y CPU ahorrada (10-40 s en tier medio-bajo). Decisión tomada en el efecto con el booleano derivado `corridaActualDesactualizada` (compiler-safe; el `useCallback` no depende de `tMolde`).
- **F5 menor:** placeholder de regex `Ej: \d{3}` con escape correcto (antes mostraba `\\d{3}`).

### F3/F4 — Telemetría y calibración (motor)

- **F3:** `evaluarDocumentoUniversal(..., renderMs?: number)` — opcional y backward-compatible; `tiempos.render_ms` ya no es un 0 fijo. Los 3 call sites de `VerificacionTab` (multi-página, por archivo, re-ejecución) pasan `doc.renderMsPorPagina` acumulado.
- **F4:** `sugerirUmbral()` exige **`max(sin tinta) < 0.5 × min(con tinta)`** antes de sugerir; si no hay separación de clases clara, devuelve `sugerido: null`. **Matiz F4-1 (post-verificación, corregido):** la frase original de este resumen («la zona vacía con flash 0.0139 ya no puede calibrar un umbral bajo el ruido») sobreafirmaba lo que la variante 4.1 logra — con `sinTinta` VACÍA la guarda no disparaba y se sugería 0.0097. Corregido en la ronda post-verificación (ver CORRECCIONES-POST-VERIFICACION.md): sin ninguna medición ≤ 0.002 el piso de ruido es desconocido y ahora NO se sugiere (`motivo: 'sin_celdas_vacias'`).

## 2. Sistema de conocimiento (§10 de la conversación — NUEVO)

`AGENTS.md` (reglas de entrada) · `MOLDE-SPEC.md` (manual maestro con tablas de decisión y criterios de aprobación) · `TEMPLATES.md` (índice; E-14 como primera validada) · `lessons/INDEX.md` (patrones P1-P4) · `lessons/TEMPLATE.md` · 2 lecciones reales de la auditoría (`acta_e14/2026-11-21-cairo-fp-jurado4.md`, `acta_e14/2026-11-21-frankfurt-colision-anclas.md`) · `PLAN-DESARROLLO.md` (fases 1-9).

## 3. Verificación ejecutada (evidencia)

**Estático:** `tsc --noEmit` ✅ 0 errores · `eslint .` ✅ 0 errores.

**API (curl, contrato de docs/API.md):**

| Prueba | Resultado |
|---|---|
| POST /api/upload (PNG 346 KB) | **201** `{url: "/api/upload/<uuid>.png", bytes: 346464}` |
| POST sin file | **400** con mensaje |
| POST tipo no soportado (text/plain) | **415** con mensaje |
| GET archivo subido | **200** · image/png · `immutable` · **bytes idénticos** (cmp) |
| GET inexistente / path traversal | **404 / 404** |

**E2E navegador real (Chrome headless + dev server puerto 3101, SQLite/Prisma, molde E-14 sembrado vía API):**

1. **N1:** "Probar Plantilla" con cero corridas → toast instructivo + navegación a Verificación. ✅
2. **Subida multi-página** (referencia-p1.png + referencia-p2.png, las actas de referencia incluidas en el repo): corrida única creada **con `fuenteUrl: /api/upload/<uuid>.png`** (F2 cerrando el circuito). ✅
3. **Lecturas correctas** (motor en navegador, Tesseract spa): divipol_consulado **88** (conf 0.93), país **515** (0.86), zona **05** (0.89), puesto **83** (0.84), mesa 001 (0.96, `requiere_revision` por patrón — caso de calibración del molde, no del motor), lugar **"MIERCOLES NAIROBI - CONSULADO"** (0.91); manuscritos HTR honestamente a `requiere_revision` (conf 0-0.33, jamás inventados). ✅
4. **F1-b en vivo:** firma_jurado_4 — la etiqueta "FIRMA JURADO 2" existía en el OCR (J2 ancló por `ancla`), pero el match difuso de J4 contra ella fue **rechazado** (penalización de dígitos) → J4 cayó a `referencia` (la zona correcta), midió 0.74% < umbral → `no_encontrado` — **el falso positivo de la auditoría ya no se produce**. J1/J2/J3: `ok` vía ancla con ratios 9-10%. ✅
5. **"Probar Plantilla" con molde sucio** (nota modificada): guardado validado (N2) → re-ejecución en sitio (PUT, misma identidad) → toast *"Corrida re-ejecutada con los cambios guardados... Score 33.3% · 7/21"* — nota: 33.3 porque la re-ejecución de una corrida multi-página solo recupera la página 1 persistida (comportamiento pre-existente del repo: `subirFuente(ordenados[0])`); los campos de pág. 2 quedaron honestamente marcados `pagina_faltante`. ✅
6. **N4:** "Probar Plantilla" sin cambios con corrida al día → toast *"La corrida ya está al día — ... no se re-ejecuta"* y **ninguna** re-ejecución (updatedAt intacto). ✅
7. **F3:** `tiempos.render_ms: 24` (corrida) y `7` (re-ejecución) — ya no hay 0 fijo. ✅

**Unitario F1 (bun, funciones puras del motor):**

```
objetivo "FIRMA JURADO 4" vs "FIRMA JURADO 2":
  editDistance original: 1      → score 0.765 (ACEPTADO > 0.72) — el bug de la auditoría
  editDistancePonderada: 3      → score 0.651 (RECHAZADO < 0.72) — corregido
  etiqueta correcta: score 0.999 (ACEPTADO) — no rompe matches buenos
  error de letra ("FIRNA"): score 0.927 (ACEPTADO) — tolerancia de letras intacta
```

## 4. Cómo aplicar al repo (SOLO con autorización)

Opciones equivalentes:
1. **Patch:** `git apply cambios.patch` (diff completo contra `e6efe38`).
2. **Archivos:** copiar la carpeta `molde-suite/` de este zip (fuente completa, sin node_modules/.git/db/uploads) y `bun install && bun run db:push && bun run dev`.
3. Revisar el diff archivo por archivo: los 3 nuevos (`api/upload/route.ts`, `api/upload/[file]/route.ts`, + docs de conocimiento) y los 6 modificados (`universal-engine.ts`, `universal-types.ts`, `EditorTab.tsx`, `VerificacionTab.tsx`, `studio-store.ts`, `.gitignore` — nota: el anclaje de `uploads/` quedó suelto en esta entrega y se corrigió post-verificación como O1).

**Verificación post-aplicación sugerida:** `bun run typecheck && bun run lint && curl -X POST localhost:3000/api/upload -F file=@cualquier.png` → 201.

## 5. No implementado en esta entrega (por tamaño — ver PLAN-DESARROLLO.md)

Fases 3-9: múltiples anclas con voto, grupos con restricciones espaciales (§7), UX-1 auto-propuesta de anclas, cartero en cascada (§8), ORB/SIFT (§9 3.2), clustering de umbrales (§9 4.1 completa), repetidores para tablas. Cada una con especificación lista en el plan.
