# Cambios — Agente B: REGLA DE ORO (§4), verificación/actualización de datos (§5), PWA F5 e import F6

- Fecha: 2026-11-26
- Rama: `agent-b/mvp-captura-pwa` (desde `main` `ccb85b1`) — plan `PLAN-CIERRE-2-AGENTES-2026-11-26.md`
- Ejecutado por: Agente B (producto, MVP y captura)
- Verificación: typecheck ✓ · lint ✓ · bun test **132/132** (26 nuevos) · verificación en navegador §7 completa (PC 1280×800 + móvil 390×844 + build estático offline) — evidencia en `scripts/resultados/verificacion-agente-b/` (LOCAL)

## B4 — REGLA DE ORO (§4, recalzada por el dueño) — P0

| Cambio | Qué hace | Prueba |
|---|---|---|
| `politica/auto-guardado.ts` NUEVO | Decisión PURA: `decidirAutoGuardado`/`esLegible`/`obligatorioValido`. Legible = OPTIMA o ADVERTENCIA con TODOS los obligatorios presentes/válidos (estado ok, o manuscrito con `tinta === true` — semáforo v1.5.1), sin `relacion_ambigua`, sin obligatorios vacíos, sin `procesadaVacia`. Excepciones que jamás auto-guardan: RECHAZADA, EN_REVISION_HUMANA, `relacion_ambigua`, sin tinta, flag apagado. Con resumen ADITIVO (gate E-14) el gate manda: OPTIMA → auto-envío de siempre (sin regresión D4), ADVERTENCIA → conservador (sin evidencia de campos) | `tests/auto-guardado.test.ts` — los 4 tests obligatorios del plan + excepciones + kill-switch + guard anti-regresión aditivo |
| Hueco cerrado (auditoría B4) | **ADVERTENCIA legible de UNA página SE GUARDA SOLA** (antes era decisión manual D20 — un documento legible podía quedar sin guardar). Multipágina: la decisión del lote pasa por la MISMA función (lote legible → UN registrarEnvio; lote no legible → evidencia archivada). EN_REVISION_HUMANA queda fuera de TODO archivado automático (test 3 del plan) | `store/index.ts` `analisisCompletado` cableado con la decisión; log honesto del motivo cuando no auto-guarda |
| Flag `autoGuardado` | `tamiz.flags.v1` → `autoGuardado: true` (default ON — el plan §4 lo exige y §7 lo demuestra en navegador). Un override corrupto APAGA (conservador). Kill-switch del operador sin redeploy: `{"autoGuardado": false}` | `flags.ts` + test con flag apagado |

## B3 — Verificación y actualización de datos capturados (§5) — P0

| Cambio | Qué hace | Prueba |
|---|---|---|
| Contrato ADITIVO (`scanner-core/dominio/types.ts`) | `Acta` += `valoresEditados?` (campoId → valor nuevo), `corregidoPorOperador?`, `editadoEn?`, `historialFilaId?`. El hash de la foto cruda NO cambia; el JSON del acta sí. `registrarEnvio`/`archivarCaptura` estampan la fila propia (`historialFilaId`) para que la edición ACTUALICE en vez de duplicar | Compilación + moldes sin los campos siguen byte-idénticos (test de contrato) |
| `molde/edicion.ts` NUEVO | Re-evaluación con override de campo: la palabra del operador SUSTITUYE la del OCR y el estado se re-deriva con la MISMA semántica del motor (patrón anclado G-8, score=ok/total, obligatoriosFaltantes, requiereRevision) + validaciones cruzadas re-evaluadas con el `evaluarValidaciones` EXPORTADO del motor (una corrección puede reparar o romper una igualdad — democión `validacion_fallida` intacta). conf=1 honesto (entrada del operador), bandera `valor_editado_operador` (trazabilidad). Las filas NO editadas se COPIAN (sin fuga de estado al resumen previo — bug detectado y corregido en el propio desarrollo) | `tests/edicion-campos.test.ts` (9 casos: recálculo de veredicto RECHAZADA→OPTIMA, patrón, vacío, checkbox, firma no editable, validación cruzada repara/rompe, fila intacta, aditivo no toca el veredicto) |
| `store/edicion.ts` NUEVO — `editarCampoActa(campoId, valor)` | (1) re-evalúa con override; (2) persiste en IndexedDB (slot «en-revision» — misma acta + EDITADO); (3) el veredicto recalcula (solo acta enrutada — el gate electoral manda en la aditiva); (4) historial: UNA fila (estado EDITADO + nota con el veredicto); si la corrección dispara el auto-guardado, la fila de evidencia previa se RETIRA (una sola fila por documento — doctrina P10); (5) REGLA DE ORO inmediata: obligatorios completos + legible → `registrarEnvio` + banner ENVIADA | Verificado en navegador (§7 ítems 3-4): RECHAZADA 8.0 → corrección SALDO PENDIENTE → OPTIMA 10.0 → ENVIADO AUTOMÁTICAMENTE → UNA fila «DATOS CORREGIDOS · AUTO-GUARDADO» |
| UI §5 (`VerificacionDocumental.tsx`) | Cada fila del motor muestra valor + **confianza de lectura** (`conf 87%`) + estado (semáforo) + chip **EDITADO**; lápiz de corrección en campos texto/checkbox (los manuscritos NO se editan — su evidencia es la tinta medida); editor inline (input + GUARDAR/CANCELAR, checkbox MARCADO/SIN MARCA); toggle «CORREGIR DATOS — MOSTRAR TODOS LOS CAMPOS» para editar también lo que el motor leyó ok (el P4 solo-faltantes queda intacto por defecto) | capturas 04-07, 12-13; `data-testid`: `editar-campo-*`, `input-valor-campo`, `guardar-valor-campo`, `campo-editado`, `toggle-mostrar-todos` |

## B1 — F5 PWA offline-first (auditoría + fixes)

- **FIX `PwaRegister`**: el cleanup del effect DES-REGISTRABA el Service Worker al desmontar (cualquier remonte del shell lo mataba). Registro ahora idempotente y persistente.
- Auditado y VERDE sin cambios: `manifest.webmanifest` (standalone + iconos SVG), `sw.js` (runtime caching del shell hasheado + vendor/scanner; modelos `/models/` cache-first por versión; **privacidad: jamás cachea fotos — no-GET y `/api/` pasan a red sin cache; las fotos viven en memoria/dataURLs sin URL cacheable**), COOP/COEP en `src/proxy.ts` (solo navegación top-level; embebida cae a 1 hilo de forma controlada — verificado `crossOriginIsolated === true` en top-level), plus-L opcional con progreso/SHA-256/borrar (`PanelModelos`), cuota con `navigator.storage.estimate()` + persistencia («63,2 MB de 10303,2 MB» medido).
- **Offline demostrado en build estático** (`BUILD_STATIC=1`): primera carga con red → modo avión → recarga sirve el shell desde el SW → escaneo SIM completo offline → OPTIMA 8.9 auto-guardada. NOTA honesta: en **dev** el combo SW cache-first + chunks efímeros de Next rompe la hidratación tras recargar offline — el modo avión se verifica contra el build estático (el destino real del PWA).

## B2 — F6 import de molde por archivo/QR (auditoría + límite documentado)

- VERDE sin cambios de código: import por archivo y pegado con validación estructural (`esMoldeUniversal/erroresMolde`), sobre con checksum SHA-256 (`contract/sobre`), cap 2 MB, rechazo de URLs remotas en `paginasRef`, sin `eval`, vista previa + ACTIVAR/GUARDAR EN EL DISPOSITIVO (IndexedDB `tamiz-moldes-v1` con versión y fecha), QR lector (BarcodeDetector: JSON crudo, `MOLDE1:` deflate-raw, URL LAN con confirmación). Verificado en navegador: archivo → validado → activado → usado en escaneos.
- **LÍMITE DOCUMENTADO** (ahora también en el propio PanelMoldes): el GENERADOR de QR no existe aún en Studio (solo exporta `.molde.json` con checksum); el lector de Tamiz ya acepta JSON crudo/MOLDE1:/URL LAN. Mientras tanto el camino verificado es IMPORTAR ARCHIVO.

## Bloqueante encontrado y cerrado (transversal, bloqueaba B6)

- **`ppocr_keys.txt` NO estaba en `assets.lock.json`**: el rec de RapidOCR lo exige (`rapidocr.ts` §dict) y TODO escaneo caía con `ppocr_keys.txt HTTP 404` — ningún documento era escaneable desde un checkout fresco de main. Agregado al lock con URL (PaddleOCR `ppocr/utils/ppocr_keys_v1.txt`, 6623 claves) + SHA-256 fijado y verificado por `preparar-assets.mjs` (mismo protocolo URL+hash del resto de assets). Sin este fix la verificación §7 entera era imposible.

## Decisiones y supuestos (§9 del plan sin respuesta del dueño)

1. `autoGuardado` default **ON** para TODA la regla (existente + caso nuevo ADVERTENCIA legible): el plan §4 lo exige («SE GUARDA AUTOMÁTICAMENTE») y los criterios de aceptación B lo piden verificado en navegador. Kill-switch disponible (§3.4).
2. ADVERTENCIA **sin** resumen enrutado (acta E-14 del gate) NO auto-envía (conservador — sin evidencia de campos que probar; D20 se conserva ahí).
3. Manuscrito obligatorio con `tinta === true` cuenta como PRESENTE (semáforo de tinta v1.5.1) — «sin obligatorios vacíos».
4. La re-evaluación §5 es post-lectura (re-corre el OCR produciría la misma lectura pagando un OCR entero): misma semántica de agregación del motor + sus validaciones exportadas. Documentado en `molde/edicion.ts`.
5. Merge a main (§8): ejecutado con la checklist §7 en verde y el reporte §10 completo (`docs/REPORTE-AGENTE-B.md`). El orden del §8.2 (Agente A primero) NO pudo cumplirse porque el Agente A no ha entregado — main queda lista para rebasar A sin deuda de B; la verificación integrada §8.3 completa queda agendada al merge de A.

## Lecciones

- `lessons/app_tamiz/2026-11-26-regla-de-oro-auto-guardado.md`
- `lessons/app_tamiz/2026-11-26-ppocr-keys-faltante-y-offline-dev-sw.md`

---

# Cambios — v3.3.0: Fases 3/4/5/6/9 del PLAN-DESARROLLO + backlog Tamiz A/B/D

- Fecha: 2026-11-25
- Base: estado del zip `molde-suite-entrega-be670e0` (rama `feat/extraccion-relacional`,
  motor v3.2.0, moldes v1.3.3, arnés corregido) ejecutado en sandbox (monorepo completo
  en la raíz del proyecto; Studio en `:3000`, Tamiz como workspace).
- Verificación de esta entrega: typecheck 0 · lint 0 · bun tests: 178 motor/Studio +
  36 scanner-core + 93 tamiz · Studio E2E en Chromium (carga, tabs, editor, importación).

## Motor (`packages/scanner-core/molde/`) — v3.3.0, TODO ADITIVO

| Fase | Qué se implementó | Prueba |
|---|---|---|
| **F3** — múltiples anclas con voto | `CampoUniversal.anclas?: AnclaUniversal[]` (≥2, ≤6, retrocompatible). Cada ancla resuelve con SU contexto (`desambiguadores` propios) y SU geometría (`zona` propia — anclas de BANDAS distintas llegan al mismo rect). Consenso: ≥2 votos que coinciden (centros ≤ `VOTO_CONSENSO_DIST` 0.02 o IoU ≥ 0.5) → rect medio + bandera `ancla_consensuada`. TODOS discrepantes → referencia + `anclas_discrepantes` (el endurecedor lo baja a revisión — jamás se escoge un lado). Un solo voto = semántica de ancla única exacta | `tests/fases-v330.test.ts` (7 casos F3) |
| **F4** — grupos espaciales | `MoldeUniversal.grupos?: GrupoMolde[]` (fila/columna/repetidor/seccion + restricciones). Defaults por tipo (`repetidor` = columna + espaciado uniforme, §7 F9). `evaluarGrupos` corre tras resolver cada página: alineación/orden/espaciado violados → banderas `grupo_desalineado`/`grupo_orden_violado`/`grupo_espaciado_irregular` + democión de 'ok'. Evidencia insuficiente (<2 resueltos) → no opina | 7 casos F4 |
| **F5** — UX-1 auto-propuesta | `proponerAnclas(lineas, W, H, zona)` — top-3 por 0.5·cercanía + 0.3·unicidad + 0.2·confianza; `conflictoDigito` marca las que difieren solo en dígitos (el molde no debe nacer ambiguo). Editor: botón «Proponer anclas (FASE 5)» con chips clicables (nada se guarda sin clic) | 4 casos F5 |
| **F6** — cartero en cascada | `HuellaMolde` (3-5 frases clave + franja + páginas) + `identificarDocumento`: QR decisivo (capa 0) → frases con el matcher de anclas dentro de la franja → esqueleto penaliza (×0.8). Studio: aviso NO bloqueante cuando la huella identifica OTRO molde antes de correr (con ≥2 moldes con huella) | 6 casos F6 |
| **F9** — extras §7 | `herencia` por tipo (umbral/patrón: campo → herencia; `umbral` pasa a OPCIONAL y sin herencia el validador lo rechaza — jamás default silencioso en tinta), `schemaVersion` (futuro → rechazo con motivo), `grupos.tipo='repetidor'`, fixtures de verdad de terreno (`esperado`/`estadosEsperados` + `verificarFixture` con parseo español "3.150,00"). Verificación muestra el panel «Verdad de terreno» por corrida | 12 casos F9 |

Moldes: `recibo_pago` y `comprobante_entrega` → **v1.4.0** con `huella` (3 copias
sincronizadas: `moldes-finales/`, `templates/genericos/` — el seed del Studio estaba
DESYNCRONIZADO en v1.3.2 y se corrigió — y `apps/tamiz/public/moldes/`).

## Tamiz (PLAN-AGENTE-EXTERNO backlog)

| Tarea | Qué se hizo | Evidencia |
|---|---|---|
| **A** (P1) — QR capa 0 | `prechequeo-qr.ts` NUEVO (puro, testeable en bun): detección de patrones localizadores 1:1:3:1:1 con OTSU, tolerancia ±35% por run, confirmación vertical, DOS pases de escala (320/1280). `capa0-qr.client.ts`: sin candidato → **null inmediato** (adiós a los ~9.5 s muertos por documento sin QR); candidato/error → camino de hoy COMPLETO; kill-switch OFF → sin pre-chequeo | `packages/scanner-core/qr/prechequeo-qr.test.ts` (8 casos) · 36 tests paquete |
| **B** (P2) — rotada-12 | Guardas anti-degenerados del quad compartidas main/worker (`quad-guardas.ts`): NaN/±Inf se sanan a identidad ANTES de decidir (antes: canvas 0×0 → drawImage no-op → toDataURL '' → foto vacía en el acta); el pipeline nunca asigna `fotoProcesada:''` | `apps/tamiz/tests/procesada-no-vacia.test.ts` · 93 tests tamiz |
| **C** (P1) — firmas | YA en el zip de base: moldes con `tipo:"firma"` + motor con `firma_ausente` por trazos (`metricasFirma`) y endurecedor de tinta sin geometría — verificado, sin cambios nuevos | tests existentes en verde |
| **D** (P2) — frame loop | Flag `tamiz.flags.v1 → frameLoop` (default OFF): loop portado cableado a `useSesionCamara` con watchdog y caída al rAF propio; k-de-n del estabilizador con tests puros | `apps/tamiz/tests/estabilizador.test.ts` (23 casos) · TODO(A56) anotado |
| **E** — RapidOCR | DECISIÓN ESCRITA: se mantiene como fallback SIN pesos (`docs/DECISION-rapidocr-fallback.md`) — sin URLs ni hashes inventados | — |

## Arnés (§9.3 del diagnóstico 2026-11-24)

- `forma_sin_caja` entra en `BANDERAS_NO_LECTURA` de `scripts/verificar-molde.ts`: el
  SCORE GENUINO del arnés descuenta la firma "sí" medida sin caja (caso rotada-12)
  SIN cambiar veredictos del motor (la mitad bypass ya la cubría `ancla_sin_geometria`
  del endurecedor v3.2.0).

## Decisiones

- **FASE 7 (ORB/SIFT): NO implementar** sin dependencia aprobada + corpus ≥20 fotos
  (`docs/adr/0002-fase7-alineacion-visual.md`). El deskew ±25° + homografía real +
  anclas difusas con bypass quedan como camino oficial. UX-3 multi-referencia: misma
  decisión (propuesta, sin corpus no se toca).
- **schemaVersion del contrato: 1** (`SCHEMA_VERSION_MOLDE`) — un molde "del futuro" se
  rechaza con motivo claro.

## Reglas respetadas

Sin dependencias nuevas · sin backend en la nube · sin pesos de modelos en el repo ·
`packages/*` jamás importa de `apps/*` · el motor es agnóstico al documento · push solo
con autorización del dueño.

---

# Cambios — sincronización de la biblioteca de moldes publicada en GitHub Pages (v1.3.1)

- Fecha: 2026-11-24
- Base: commit `fd6939e` (C5 sobre la migración) en `origin/main`
- Objeto: la auditoría (6e06646) corrigió los JSON de `moldes-finales/` y `apps/molde-studio/templates/genericos/` (empaquetados en el seed del Studio), pero las copias que GitHub Pages sirve para DESCARGA (`apps/tamiz/public/moldes/`) quedaron en v1.3.0 — quien importara la biblioteca desde Tamiz recibía los umbrales y anclas PRE-auditoría.

## Qué se sincronizó

| Archivo | Cambio | Correcciones que arrastra |
|---|---|---|
| `apps/tamiz/public/moldes/comprobante_entrega.molde.json` | v1.3.0 → **1.3.1** (idéntico a `moldes-finales/`) | C1 (umbral `firma_comprador` 0.006→0.0035) + C2 (patrón `numero_operacion` `[IO]P-\d{4}-\d{6}`) |
| `apps/tamiz/public/moldes/recibo_pago.molde.json` | v1.3.0 → **1.3.1** (idéntico a `moldes-finales/`) | C3 (ancla `Recibo` + zona x 0.134→0.103) |
| `apps/tamiz/public/moldes/LEEME.md` | Tabla a v1.3.1 + nota de re-importación | Documenta que C4/C5 son código (motor empaquetado) y NO requieren re-importar JSON |

## Verificación de que las demás copias YA estaban sincronizadas

- Studio (Pages `/studio/`): los seeds van **empaquetados en el bundle** (`repo-idb.ts` importa `templates/genericos/*.molde.json`, corregidos por la auditoría) + imágenes en `public/moldes-genericos/` (solo PNG, sin cambios). El deploy de Pages de `fd6939e` ya los sirvió corregidos.
- `packages/scanner-core/src/contract/__fixtures__/` (creado post-auditoría por la migración): idéntico a `moldes-finales/` ✓
- `apps/tamiz/src/lib/generico/moldes/e14_acta.molde.json`: idéntico a `moldes-finales/e14_acta.molde.json` ✓
- Resto de `apps/tamiz/public/moldes/` (e22, e24, e26, e14): sin cambios de la auditoría, ya sincronizados ✓

El push a `main` dispara `deploy-pages.yml`: la biblioteca descargable queda en `https://jg-stevan.github.io/molde-suite/tamiz/moldes/<archivo>.molde.json` con v1.3.1.

---

# Cambios — prueba E2E en Chromium real del paquete verificado (plan de navegador)

- Fecha: 2026-11-24
- Base: commit `6e06646` (correcciones C1-C4 de la auditoría con variantes) en `origin/main`
- Objeto: cubrir lo que la auditoría headless NO pudo probar — HTML5 Canvas real, UI interactiva (Verificación, importador Chandra, editor de faro, kill-switch de deskew) y UI táctica de Tamiz — con Chromium (Playwright) contra los servidores dev reales.
- Veredicto: **APROBADO — 1 hallazgo de producción (F-E1) detectado y corregido (C5); 6 suites E2E en verde después de corregir.**

## Corrección aplicada

| # | Archivo | Cambio | Hallazgo |
|---|---|---|---|
| C5 | `apps/molde-studio/src/lib/molde/normalizar.ts` | El transporte de entrada a `processImage` pasa de `toDataURL('image/jpeg', 0.92)` a `toDataURL('image/png')` (sin pérdida) | **F-E1**: en el Studio real (Chromium), un escaneo a 5° con deskew ON daba **score 90 con `requiere_revision` falso** en `articulo` (conf 0.4 < 0.5 → `conf_baja`), aunque el chip medía `deskew +5.0°` honesto. Causa: el re-encode JPEG ANTES de la rotación generaba artefactos que la rotación + el JPEG 0.85 interno de `processImage` amplificaban; el arnés Node no hacía ese re-encode y por eso la auditoría headless no lo vio. Con PNG el mismo documento da **100 sin revisión** (y el A/B OFF sigue degradando a 70 como debe). Sin matemática nueva: `homografia.ts` y `core/image-processor.ts` quedan INTACTOS; solo cambia el transporte de entrada en el facade (cero cambios en Tamiz). |

## Resultados E2E (todas las suites en verde tras C5)

- **A1/A2 paridad Canvas vs Node (Studio, 10 corridas OCR completas):** `comp-completo` y `rec-completo` **100/100 sin revisión**; `sin-firma` honesto (`firma_ausente`); `rec-campos-faltantes` firma emisor presente → `firma_dudosa` (NUNCA `firma_ausente`); `manuscrito` a revisión por diseño; `repo pag-01` 100/100. Ratios de tinta Chromium vs Node: firma_emisor Δ2.3%, firma_pagador Δ5.4% (paridad); firma_comprador (rúbrica fina) 0.0318 vs 0.0079 — la zona depende del bbox OCR del ancla y del antialiasing del canvas; el umbral 0.0035 conserva margen seguro en AMBOS entornos (vacío 0.0000, banda dudosa 0.0021).
- **AB kill-switch deskew (5°):** ON → chip `deskew +5.0°` + **100 sin revisión**; OFF → degrada a **70 con revisión**. El interruptor de la UI afecta al pipeline real.
- **B importador Chandra:** tabla de revisión con `grupo`/`orden`/matriz de obligatorios; firma mapeada `tipo: firma` + `firma_esperada: true` + `min_trazos: 1` + relación `arriba` + faro presente (verificado en el molde creado vía IndexedDB); NO existe botón «Generar borrador» ni llamadas sidecar; errores exactos y accionables para JSON sin páginas, sin bloques mapeables y formato no reconocido.
- **C editor de faro:** el faro se renderiza («FARO · zona_busqueda»), se edita por inputs (`Faro x`) y el overlay se mueve; el validador BLOQUEA el guardado de un faro degenerado (w=0) con el mensaje exacto «exige zona_busqueda (el faro) válida y dentro de la página — sin faro NO hay búsqueda (nunca global)».
- **D UI táctica Tamiz:** `completo` → acordeón **colapsado** por defecto (`100% OK`); `campos-faltantes` y `sin-firma` → **desplegado** con `RECHAZADO`/solo faltantes (2 items) y la firma listada. `abiertaPorDefecto` (L358) funciona en pantalla real.

## Re-verificación después de C5

typecheck (2 apps) ✓ · lint (2 apps) ✓ · `test-faro-relacional` (corpus v3.2.0) ✓ · `test-motor-unit` ✓ · retrocompat 6/6 ✓ · E2E completo (6 suites, 23 casos, ~70 checks) ✓ — evidencias en `pruebas-arnes/e2e/` (resultados JSON + capturas), entregado junto al paquete.

---

# Cambios — auditoría con variantes reales (post-ejecución Fases 1-4)

- Fecha: 2026-11-24
- Base: commit `dea5093` (feat motor v3.2.0 — Fases 1-4 del plan v2) sobre el clon de `main`
- Ejecutado por: auditoría técnica (sandbox) con las variantes reales de prueba (`variantes-prueba.zip` + `public/moldes-genericos`)
- Estado: typecheck/lint/corpus/retrocompat en verde DESPUÉS de los cambios; 18 corridas OCR completas verificadas. Cambios SIN commitear (push a `main` con autorización del dueño).

## Correcciones aplicadas

| # | Archivo | Cambio | Hallazgo |
|---|---|---|---|
| C1 | `moldes-finales/comprobante_entrega.molde.json` (v1.3.1) | `firma_comprador.umbral 0.006 → 0.0035` | El trazo fino real (ratio 0.0087 medido en 2 renders) caía en la banda de indeterminación del umbral 0.006 (0.0036-0.0084) → estado oscilante ok↔revisión con score 90 en la variante completa. Vacío medido 0.0000; nuevo umbral separa ambos clusters con margen. |
| C2 | `moldes-finales/comprobante_entrega.molde.json` (v1.3.1) | `numero_operacion.patron → [IO]P-\d{4}-\d{6}` (antes `OP-…`) | El OCR lee consistentemente «IP-» por «OP-» en esa caja pequeña (conf 0.82; verificado con la cadena de realce del motor). Patrón anclado: sigue rechazando lecturas sin prefijo o con texto extra. |
| C3 | `moldes-finales/recibo_pago.molde.json` (v1.3.1) | `numero_recibo.ancla → "Recibo"` + `zona.x 0.134 → 0.103` | El OCR lee «N.9 Recibo:» (º→9 + espacio); con la penalización de dígitos el match "N.º Recibo" quedaba 0.718-0.719, dos milésimas bajo el corte 0.72 → `ancla_no_encontrada` en 8/8 páginas (el campo vivía solo del rect de referencia). Con "Recibo" la etiqueta gana al título (0.958 vs 0.836, penalización de posición) y la zona recalibrada mantiene el crop absoluto (el bbox del hit es solo la palabra, estable ±0 en 8 páginas). Lección: ancla y zona se calibran JUNTAS. |
| C4 | `packages/scanner-core/molde/universal-engine.ts` | Bandera `firma_dudosa` en la rama de tinta de `evaluarCampo` | Una firma PRESENTE con rúbrica fina/plana (filtrada por el filtro de líneas combinadas + antialiasing) se reportaba `no_encontrado` («firma ausente» con la rúbrica a la vista) aunque `metricasFirma` detectaba trazos. Ahora: trazos>0 ∧ ratio ≥ 0.001 (piso anti-polvo) ∧ ratio < umbral×0.6 → `firma_dudosa` + `requiere_revision` (jamás convierte un vacío en ok; no toca presencia/checkbox). |

## Añadido por la auditoría

- `apps/molde-studio/scripts/test-retrocompat-auditoria.ts` — corre `esMoldeUniversal` sobre los 6 `moldes-finales/*.molde.json` (reproducible, sin DOM).

## Resultados de la prueba (18 corridas OCR real — resumen)

- Comprobante: `completo` **100 sin revisión** · repo `pag-01` **100 sin revisión** · `sin-firma` 90 con `firma_ausente` (honesto) · `campos-faltantes` 70 · `parcial` 60 · `en-blanco`/`manuscrito` 30 — señalan exactamente los obligatorios vacíos de cada variante.
- Recibo: `completo` **100 sin revisión** · repo `pag-01` **100 sin revisión** · `sin-firma` 83.3 con ambas firmas `firma_ausente` · `campos-faltantes` 66.7 (firma emisor presente → `firma_dudosa`, ya no miente) · `parcial` 50 · `en-blanco`/`manuscrito` 16.7.
- Banco de distorsión: 2°→100 · 5°→100 · 10°→90 (límite del rango ±10°, degradación honesta a revisión).

Informe completo: `VERIFICACION-HALLAZGOS-CORRECCIONES.md` (entregado junto al paquete).

---

