# CORRECCIONES POST-VERIFICACIÓN — molde-suite

**Origen:** informe "Verificación — molde-suite-mejoras.zip" (2026-11-21), sección 6 (hallazgos) y sección 7 (recomendaciones).
**Base:** mismo árbol del zip verificado (upstream `e6efe38` + `cambios.patch`), con las correcciones aplicadas encima.
**Método de esta ronda:** `tsc --noEmit` y `eslint .` limpios · 17/17 pruebas unitarias nuevas (`bun test tests/correcciones-post-verificacion.test.ts`) · contrato HTTP de `/api/upload` y `/api/pruebas` contra servidor real · E2E en navegador (Chrome headless) de la re-ejecución multi-página.

---

## 1. Qué se corrigió (y qué NO, y por qué)

| Ítem del informe | Severidad | Estado | Corrección aplicada |
|---|---|---|---|
| **D1** — re-ejecución multi-página solo recupera la página 1 (§6.2) | P0 | **CORREGIDO** | La corrida multi-página sube **todas** las páginas (`fuenteUrls`, set completo obligatorio) y la re-ejecución las descarga y reconstruye enteras (`renderArchivos`). Corridas antiguas de 1 fuente: aviso honesto de faltantes en el toast. |
| **F4-1** — la guarda 4.1 no cubre el caso flash 0.0139 (§6.1) | Media | **CORREGIDO (mitigación a + c)** | `sugerirUmbral` devuelve `null` con `motivo: 'sin_celdas_vacias'` cuando no hay NINGUNA medición ≤ 0.002 (piso de ruido desconocido → no se calibra). El caso de la auditoría `[0.0139, 0.079, 0.138]` ya no sugiere 0.0097. La UI del editor explica el motivo real en vez del genérico "no tiene mediciones". |
| **O1** — `uploads/` suelto en `.gitignore` (§6.3) | Menor | **CORREGIDO** | Anclado a `/uploads/` con la causa raíz documentada (misma clase de defecto que el FIX F2). |
| **O2** — el molde E-14 no usa desambiguadores (§6.3) | Opcional | **IMPLEMENTADO** | Las 4 `firma_jurado_*` exigen la etiqueta de la MISMA columna (`JURADO 3/4/1/2` según el campo) a ≤ 0.3 normalizado — verificable con la geometría del propio molde (ver §3). |
| **O3** — `next-env.d.ts` dentro del zip (§6.3) | Inofensivo | **LIMPIADO** | El árbol corregido no incluye `next-env.d.ts` ni `tsconfig.tsbuildinfo` (ambos generados y `.gitignore`-ados). |
| Rec. 6 del informe — E2E contra los 3 PDFs originales (El Cairo, Frankfurt, Transmisión) | Pendiente externa | **NO EJECUTABLE** | Los PDFs de la auditoría no están disponibles en este entorno. La defensa contra J4↔J2 está cubierta por pruebas unitarias de la geometría de la auditoría; queda pendiente la corrida en vivo contra los PDFs reales. |

## 2. Detalle técnico de cada corrección

### 2.1 D1 — re-ejecución multi-página completa (P0)

**Causa raíz (confirmada por el informe):** `correrArchivos` renderizaba TODAS las páginas pero solo persistía `subirFuente(ordenados[0])`; `reejecutarCorrida` reconstruía el documento desde esa única página → campos de páginas 2+ con `pagina_faltante`, score 33.3 % con el molde E-14.

**Diseño (sin romper el contrato existente):**

- **Esquema Prisma** (`Prueba`): nueva columna opcional `fuenteUrls String?` — JSON array de URLs `/uploads/...` ordenadas por página. `fuenteUrl` se conserva con la página 1 como marcador de "es re-ejecutable" (compatibilidad con corridas y consultas existentes).
- **API**: `POST /api/pruebas` acepta `fuenteUrls` (solo lo persiste si el set es completo: ≥2 URLs válidas — un set parcial reproduciría D1 en silencio). `GET /api/pruebas` y `GET /api/pruebas/:id` exponen `fuente_urls` ya parseado.
- **Cliente (`VerificacionTab.tsx`)**:
  - Corrida multi-página: sube las páginas en orden (`Guardando página fuente i/N`); solo declara la corrida re-ejecutable si TODAS subieron; el toast lo advierte si no.
  - `reejecutarCorrida`: si hay `fuente_urls` (≥2), descarga cada página, reconstruye el `File[]` ordenado y renderiza con `renderArchivos` (el mismo pipeline de la corrida original). Si una página no se puede recuperar, error explícito con el número de página.
  - Toast de re-ejecución con aviso de `pagina_faltante` (corridas antiguas pre-corrección).
- **Modo estático (`repo-idb.ts`)**: mismo campo en el registro IndexedDB, con revocación de TODAS las páginas al eliminar corrida/molde.
- **Migración:** `prisma db push` (el proyecto no usa migraciones versionadas). En deploy: `bun run db:push`.

### 2.2 F4-1 — guarda de calibración endurecida (mitigación a del informe)

`sugerirUmbral` ahora distingue CUATRO motivos de no sugerir (`motivo` en el retorno, aditivo y backward-compatible):

| Caso | Antes | Ahora |
|---|---|---|
| Sin mediciones del campo | null (sin motivo) | null + `sin_mediciones` |
| Todo ≤ 0.002 (sin tinta) | null (sin motivo) | null + `sin_tinta` |
| Vacías entrelazadas con trazos (`max(sinTinta) ≥ 0.5 × min(conTinta)`) | null (guarda 4.1) | null + `clases_entrelazadas` |
| **Sin NINGUNA medición ≤ 0.002 (ruido desconocido — caso flash 0.0139)** | **sugería `minConTinta × 0.7` (peligroso)** | **null + `sin_celdas_vacias`** |

**Matiz residual documentado en el código y en la lección nueva:** una vacía limpia pegada al corte JUNTO a una vacía con flash encima del corte (p. ej. `[0.002, 0.0139, 0.079]`) aún pasa la guarda relativa — la solución de fondo es el clustering sobre varias corridas (PLAN Fase 8, variante 4.2), que sigue pendiente según el plan acordado.

La UI (`EditorTab.sugerirUmbralClick`) muestra ahora el motivo real: "No se puede verificar la separación contra el ruido" (con la instrucción de correr una verificación con la casilla vacía) o "Ruido y tinta entrelazados", en vez del genérico "Este campo no tiene mediciones".

### 2.3 O2 — desambiguadores en las firmas del molde E-14

Elección basada en la geometría del acta (verificada, no inventada): las cajas de firma son una rejilla 2×2; la única etiqueta estable dentro del radio 0.3 del centro de cada hit es la de la **misma columna** (dy ≈ 0.068) — la de la misma fila queda a dx ≈ 0.45 (fuera del radio).

| Campo | Contexto exigido | Compañero de columna |
|---|---|---|
| `firma_jurado_1` | `JURADO 3` | abajo (misma columna izquierda) |
| `firma_jurado_2` | `JURADO 4` | abajo (misma columna derecha) |
| `firma_jurado_3` | `JURADO 1` | arriba |
| `firma_jurado_4` | `JURADO 2` | arriba |

Comportamiento: si el match difuso cae en la otra banda (p. ej. J1→etiqueta de J2), el contexto no aparece y el hit se rechaza con `desambiguacion_fallida`, cayendo a respaldo/referencia (posición correcta, veredicto honesto). La confusión misma-columna (J1↔J3) sigue bloqueada por la penalización de dígitos + penalización de posición (score 0.62 < 0.72) y el dedupe de colisiones — las capas se apilan. `RADIO_DESAMBIGUACION` quedó exportado para que las pruebas usen el MISMO valor que el motor.

## 3. Verificación ejecutada (esta ronda)

**Estático:** `tsc --noEmit` ✅ 0 errores · `eslint .` ✅ 0 errores/0 advertencias (apps/molde-studio).

**Unitario (`bun test tests/correcciones-post-verificacion.test.ts`) — 17/17 ✅:**

- F4-1: caso exacto de la auditoría `[0.0139, 0.079, 0.138]` → null + `sin_celdas_vacias` (antes 0.0097); caso sano `[0.001, 0.079, 0.138]` → sugiere `trazo × 0.7` sin regresión; guardas 4.1 y motivos.
- F1 (regresión): distancia plana=1 vs ponderada=3 en el par J4/J2; geometría de la auditoría rechazada (< 0.72); etiqueta correcta aceptada; "FIRNA" tolerada.
- O2: molde válido con `desambiguadores`; los 4 contextos dentro del radio respecto de su propio rect y FUERA del radio de la banda contraria; `resolverRectCampo` acepta el hit legítimo con contexto, rechaza sin contexto (`referencia` + bandera) y no exige contexto en campos sin desambiguadores.

**API en vivo (servidor Next dev + SQLite/Prisma):**

| Prueba | Resultado |
|---|---|
| POST /api/upload (PNG 346 KB) | **201** `{url, bytes: 346464}` |
| POST sin body / sin campo file | **400 / 400** |
| POST text/plain / POST 26 MB | **415 / 413** |
| GET del archivo subido | **200** · image/png · cache immutable · bytes idénticos (`cmp`) |
| GET inexistente / path traversal | **404 / 404** |
| POST /api/pruebas con `fuenteUrls` completas (2 páginas) | **201** · GET detalle y lista devuelven `fuente_urls` con las 2 URLs ordenadas |
| POST /api/pruebas con set incompleto (1 URL) | **201** · `fuente_urls: null` (no se declara re-ejecutable) |
| POST /api/pruebas sin `fuenteUrls` | **201** · `fuente_urls: null` (compatibilidad) |

**E2E navegador real (Chrome headless, molde E-14 sembrado por API, 2 páginas de referencia del repo):**

1. **D1 corregido en vivo:** la corrida multi-página guardada con `fuente_urls` (páginas 1+2) se re-ejecutó en sitio tras guardar una versión nueva del molde → el documento se reconstruyó COMPLETO: OCR de ambas páginas, `pagina_faltante: 0` (antes: 1, con score 33.3 %) · score **42.9 %** · misma identidad de corrida (PUT, `updated_at` refrescado) · `tiempos.render_ms: 46` (F3 intacto).
2. **O2 validado contra el OCR real:** `firma_jurado_1` y `firma_jurado_3` resolvieron por `ancla` con sus desambiguadores de columna (el contexto «JURADO 3»/«JURADO 1» apareció cerca del hit en el escaneo real) · `firma_jurado_2` no encontró su etiqueta y cayó honestamente a `referencia` con banderas `ancla_no_encontrada` + `desambiguacion_fallida` (posición correcta, lectura ok) · `firma_jurado_4` (casilla vacía en el acta de referencia) quedó en `no_encontrado` — **sin falso positivo**.
3. **Corridas antiguas de 1 fuente (pre-corrección):** la re-ejecución sigue funcionando (camino de compatibilidad) y el toast nuevo advierte: *"ATENCIÓN: 6 campos de páginas no recuperables (fuente incompleta de una corrida anterior)"*.
4. **N4 tras correcciones:** "Probar Plantilla" con corridas al día no re-corre nada (`updated_at` intacto); el predicado de re-ejecutabilidad ampliado (fuente_url **o** set completo `fuente_urls`) selecciona la corrida correcta.

## 4. Cómo aplicar al repo (SOLO con autorización del dueño)

Opciones equivalentes:
1. **Patch:** `git apply cambios-corregidos.patch` (diff completo contra `e6efe38`, incluye las correcciones de esta ronda).
2. **Archivos:** copiar el árbol `molde-suite/` de este zip (fuente completa, sin node_modules/.git/db/uploads/next-env.d.ts) y `bun install && bun run db:push && bun run dev`. **Importante:** la columna `fuenteUrls` exige un `db:push` (o `prisma migrate dev`) tras actualizar.
3. Verificación post-aplicación sugerida:
   - `bun run typecheck && bun run lint`
   - `bun test tests/correcciones-post-verificacion.test.ts` (17 pruebas)
   - `curl -X POST localhost:3000/api/upload -F file=@cualquier.png` → 201

## 5. Pendiente (inalcanzable desde este entorno)

1. **E2E contra los 3 PDFs originales de la auditoría** (El Cairo, Frankfurt, El Cairo Transmisión) antes de declarar F1 cerrado por completo (recomendación 6 del informe).
2. **Fase 8 (clustering 4.2)** — resuelve el matiz residual de F4 (vacía limpia al corte + flash encima del corte).
3. La re-ejecución de corridas PREVIAS a esta corrección sigue limitada a su única fuente persistida (página 1); el toast lo advierte explícitamente. Subir de nuevo el documento crea la corrida nueva ya con el set completo.
