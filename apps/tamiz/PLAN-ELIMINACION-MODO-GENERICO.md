# PLAN — ELIMINACIÓN DEL MODO GENÉRICO · TAMIZ E-14

**Fecha:** sesión actual · **Decisión de producto:** el TAMIZ pasa a ser una app de un solo dominio — todo se maneja desde el flujo **E-14**. El modo documento genérico (`/generico/`) se elimina por completo.

---

## 0. DISTINCIÓN CRÍTICA (leer antes de borrar nada)

En el código hay **dos cosas distintas** que comparten la palabra "genérico":

| Concepto | Qué es | Destino |
|---|---|---|
| **MODO genérico** | Ruta `/generico/` + catálogo de moldes universales (comprobante de entrega, recibo de pago, E-22, E-24, E-26) — flujo guiado multipágina con veredicto propio | **SE ELIMINA** (este plan) |
| **Etiqueta `GENERICO` del motor** | Clasificación que emite `real-core-bridge.ts` cuando el OCR lee un documento pero NO reconoce ninguna plantilla E-14 (`tipo: "GENERICO"` + `DETALLE_GENERICO`) | **SE CONSERVA** — es el camino interno que produce la tarjeta «DOCUMENTO NO IDENTIFICADO — SIN PLANTILLA CONOCIDA» en la verificación documental (P4 del plan de ajustes visuales, recién portado) |

Borrar la etiqueta del motor rompería el 5.º estado del ciclo SIM y el rechazo con OCR válido. **No tocar.**

---

## 1. NÚCLEO A ELIMINAR — `apps/tamiz` (repo `molde-suite`)

| # | Ruta | Líneas | Contenido |
|---|---|---|---|
| 1.1 | `apps/tamiz/src/app/generico/page.tsx` | 1,628 | Toda la ruta: captura multipágina, análisis universal, veredicto, reporte JSON, simulación, historial local (`app: 'tamiz-generico'`) |
| 1.2 | `apps/tamiz/src/lib/generico/` (carpeta completa) | 1,274 TS + 5 JSON | `evaluar.ts` (71) · `historial.ts` (94, IndexedDB `tamiz-generico-v1`) · `huella.ts` (89) · `moldes-incluidos.ts` (35) · `procesar.ts` (208) · `reconocer.ts` (90) · `simulacion.ts` (213) · `tipos.ts` (42) · `veredicto.ts` (279) · `verificar-pagina.ts` (153) + `moldes/` con los 5 `.molde.json` (comprobante_entrega, recibo_pago, e22_resolucion, e24_cuadro, e26_acta_parcial) |

**Total núcleo: ~2,902 líneas TS + 5 JSON.**

Seguridad del borrado verificada: el ÚNICO importador de `@/lib/generico/*` dentro de `apps/tamiz/src` es `src/app/generico/page.tsx` (8 imports). Ningún módulo del flujo E-14 (store, fachada, bridge, puente, obs) lo referencia. Al borrar ambos juntos no queda ningún import roto dentro de la app.

---

## 2. ENTRADAS UI A EDITAR (3 enlaces — idénticos en repo y sandbox)

Los tres archivos están **idénticos** entre `molde-suite/apps/tamiz` y el sandbox; las mismas ediciones aplican a ambos lados.

| # | Archivo | Ubicación | Acción |
|---|---|---|---|
| 2.1 | `src/components/e14/SideNav.tsx` | bloque «Entrada al modo genérico (flujo guiado multipágina, 2026-11-23): enlace ADITIVO…» + `<Link href="/generico/">` («G · Modo genérico») | **Eliminar bloque completo** (Link + comentario + clase sobrante) |
| 2.2 | `src/components/e14/screens/ResumenView.tsx` | bloque con comentario idéntico + `<Link href="/generico/">` («Modo genérico — flujo guiado · Plantillas incluidas · multipágina con score») en la cabecera de PLANTILLAS | **Eliminar bloque completo** |
| 2.3 | `src/components/e14/PanelMoldes.tsx` | comentario «Modo documento genérico: catálogo empaquetado en el build…» + `<Link href="/generico/">` («Verificar con moldes incluidos») dentro de «MOLDES (UNIVERSAL v3)» | **Eliminar bloque completo** |

Notas de edición:
- Los tres usan `Link` de `next/link`: verificar si queda algún otro uso en cada archivo antes de limpiar el import (en `PanelMoldes.tsx` y `SideNav.tsx` puede quedar sin usos → quitar el import para no fallar lint `no-unused-vars`).
- En `ResumenView.tsx` el enlace es el primer hijo del contenedor de PLANTILLAS: al quitarlo, la tarjeta «CARGAR MOLDE .JSON» pasa a ser el primer elemento (layout intacto, no se toca nada más).
- **Mandato intacto:** no retocar cámaras, footer, P4 ni P5 — solo desaparece el enlace.

---

## 3. SERVICE WORKER — `apps/tamiz/public/sw.js`

| # | Ubicación | Acción |
|---|---|---|
| 3.1 | Lista de precache del shell (líneas ~44–46): `['/', '/offline.html', '/generico/']` + comentario «'/generico/' incluido: sin esto…» | Quitar `'/generico/'` de la lista y el comentario asociado → `['/', '/offline.html']` |

Sin esta edición, el SW intenta precachear una ruta 404 en cada install (`cache.add` falla silenciosamente con `Promise.allSettled`, pero ensucia la consola y el diff del cache).

---

## 4. DOCUMENTACIÓN

| # | Archivo | Acción |
|---|---|---|
| 4.1 | `apps/tamiz/README.md` — sección completa «## Modo documento genérico (`/generico/`)» (incluye 6 bullets del flujo y la nota del SW) | **Eliminar la sección entera** |
| 4.2 | `README.md` raíz — bullet «**Tamiz — modo genérico:** https://jg-stevan.github.io/molde-suite/tamiz/generico/» | **Eliminar el bullet** (dejar el del hub, Studio y Tamiz) |

Fuera de alcance documental (históricos, se conservan tal cual): `CAMBIOS.md`, `lessons/`, `docs/investigacion/*` — mencionan "genérico" como concepto del motor, no del modo.

---

## 5. COLATERAL FUERA DE `apps/tamiz` — ⚠️ DECISIÓN PENDIENTE (pregunta al usuario)

| # | Ruta | Por qué se ve afectado | Opciones |
|---|---|---|---|
| 5.1 | `herramientas/ejecutar_cp.js` + `herramientas/ejecutar_cp.py` | Matriz de pruebas CP-01..CP-20 que navega a `http://localhost:3100/generico/` — queda sin objetivo | **(a)** eliminar · **(b)** conservar como histórico (rompe al correrlo) |
| 5.2 | `herramientas/probar_veredicto.ts` | Importa `../apps/tamiz/src/lib/generico/veredicto` — **rompe en typecheck/lint de herramientas** | (a) eliminar · (b) conservar excluyéndolo del lint |
| 5.3 | `herramientas/verificar_calibracion.py` + `anclas-finales.json` + `informe-calibracion.json` | Calibración de los 5 moldes universales del catálogo — queda sin dominio | (a) eliminar · (b) conservar como registro histórico |
| 5.4 | `moldes-finales/` (raíz del repo) — los 5 `.molde.json` fuente | Son la fuente de los moldes del modo genérico; pero también nutren las semillas de **molde-studio** | (a) eliminar · (b) conservar (pertenece al mantenedor) |
| 5.5 | `apps/molde-studio/src/lib/repo-idb.ts` — semillas `templates/genericos/*.molde.json` | molde-studio (mantenedor) siembra los mismos moldes genéricos en su biblioteca | **(a) NO tocar** (app distinta; decisión: "todo se maneja desde e14" aplica a tamiz) · (b) limpiar también |

**Recomendación:** 5.4 y 5.5 se conservan (molde-studio es otra app y su dominio no cambia); 5.1–5.3 se eliminan junto con el modo (son herramientas de prueba/calibración específicas del catálogo eliminado). **Pendiente de confirmar por el usuario.**

---

## 6. DATOS LOCALES HUÉRFANOS (opcional, recomendación: NO escribir código nuevo)

- IndexedDB **`tamiz-generico-v1`** (historial local del modo) queda huérfana en dispositivos que ya usaron el modo. No interfiere con `tamiz-moldes-v1` ni `e14-jornada-v1` (nombres de DB distintos).
- Recomendación: **no agregar código de limpieza** — la DB muere sola, sin riesgo. Si el usuario prefiere limpieza activa, sería un micro-servicio en el arranque E-14 (fuera de alcance de este plan).

---

## 7. ORDEN DE EJECUCIÓN (sandbox y repo en paralelo, mismas ediciones)

1. **Borrar núcleo:** `src/app/generico/` + `src/lib/generico/` (§1).
2. **Editar 3 entradas UI** (§2) — limpiar imports de `next/link` si quedan sin uso.
3. **Editar `public/sw.js`** (§3).
4. **Docs:** README tamiz + bullet del README raíz (§4).
5. **Colateral** según decisión del usuario (§5).
6. **Verificación** (§8) en sandbox → commit/push al repo → CI.

---

## 8. VERIFICACIÓN POST-ELIMINACIÓN

| Check | Comando / Método | Esperado |
|---|---|---|
| Typecheck repo | `bun run typecheck` en `apps/tamiz` | 0 errores (sin imports rotos) |
| Lint repo | `bun run lint` en `apps/tamiz` | 0 errores (sin `Link` sin uso) |
| Build repo | `next build` | Ruta `/generico` desaparece del manifiesto de rutas; build verde |
| Preview sandbox | Abrir `/` en el panel de preview | Flujo E-14 completo intacto: escaneo → procesando → revisión (P4 acordeón + P5 overlay + «NO IDENTIFICADO») → actas → plantillas, **sin ningún enlace «Modo genérico»** |
| Consola del preview | DevTools | Sin 404 de `/generico/` ni errores de SW |
| CI del repo | push a `main` | 3 checks en verde (build / checks / deploy Cloudflare) |
| Regresión P4/P5 | Veredicto de los 5 fixtures SIM | «Óptima» colapsada · «Sombras/Color» desplegada solo faltantes · «Rechazada» zona fija · «No identificado» tarjeta sin plantilla — **sin cambios** respecto al estado actual |

---

## 9. NO TOCAR (lista explícita de intangibles)

- `src/lib/e14/bridge/protocolo.ts` — `DETALLE_GENERICO`.
- `src/lib/e14/bridge/real-core-bridge.ts` — clasificación `tipo: "GENERICO"` (dos emisiones, líneas ~495 y ~503).
- `src/lib/e14/checklist.ts`, `src/lib/e14/simulacion-imagenes.ts` — usos del concepto en comentarios/lógica del gate.
- `src/components/e14/VerificacionDocumental.tsx` — camino «DOCUMENTO NO IDENTIFICADO» (P4).
- `packages/scanner-core` (`universal-engine.ts`, `universal-types.ts`) — motor universal compartido con molde-studio.
- `apps/molde-studio` completo (§5.5 salvo decisión contraria).
- Todo lo del mandato original: ScanView, AnalyzingView, BottomNav/SideNav/TopBar (salvo el bloque §2.1 de SideNav), motor, store, backend, P4/P5 recién portados.
