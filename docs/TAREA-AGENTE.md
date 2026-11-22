# TAREA-AGENTE — Integración de layout estructural en molde-suite

Fecha del encargo: 2026-11-22

## 0. Encargo en una frase

Clona `https://github.com/Jg-Stevan/molde-suite`, implementa el plan
`PLAN-AGENTE-LAYOUT.md` (detección de layout + reglas estructurales en el
navegador, autoría visual en Studio y gate offline en Tamiz) y devuelve un
ZIP con los cambios listo para aplicar y probar en PC y celular.

El repositorio es privado: el dueño debe darte acceso antes de empezar. Si
no lo tienes, pide acceso; no trabajes sobre una copia desactualizada.

## 1. Orden de lectura obligatorio

1. `AGENTS.md` y `MOLDE-SPEC.md` del repo (reglas del proyecto y contrato del
   molde).
2. `PLAN-AGENTE-LAYOUT.md` (este paquete; también va dentro del repo en la
   raíz).
3. `docs/investigacion/2026-11-22-pp-doclayout-en-navegador.md` (evidencia,
   contratos de los modelos y trampas de calibración).
4. `MODELOS-Y-DATOS.md` (qué modelos hay, hashes, qué NO se incluye).
5. `benchmark/README.md` (código de referencia que NO se importa tal cual).
6. `ENTREGA-Y-PRUEBAS.md` (formato exacto del ZIP de vuelta).

## 2. Decisiones ya cerradas por el dueño

| Tema | Decisión |
|---|---|
| Alcance del MVP | **Estructura + OCR**: el layout detecta zonas; el OCR actual lee y valida campos. |
| Distribución de moldes | **Archivo/QR local**: Studio exporta `.json`; Tamiz lo importa. Sin backend ni cuentas. |
| Entrega de Tamiz | **PWA offline-first**, instalable, con modelos y OCR cacheados. |
| Modelo | **S como candidato principal** (peso/velocidad); plus-L como precisión opcional. La Fase 0 decide con métricas, no por intuición. |
| Modelos | **Stock**. Prohibido reentrenar, cuantizar, recortar o modificar los ONNX. |
| Nube | Prohibido enviar documentos, fotos o moldes a servidores. Todo local. |

No reabras estas decisiones. Si una te bloquea, documenta el bloqueo y sigue
con la mejor opción compatible.

## 3. Alcance de esta entrega

Ejecuta las fases en este orden. La entrega mínima aceptable es **F0–F4**;
la entrega completa del MVP es **F0–F6**. F7 y F8 se hacen con el tiempo que
quede y se documenta lo que falte.

| Fase | Entregable | Prioridad |
|---|---|---|
| F0 | Spike S vs plus-L con estructura; reporte con decisión | Obligatoria, primero |
| F1 | `packages/molde-contract` con `layout` retrocompatible + tests | Obligatoria |
| F2 | `packages/layout-core` (ORT Web, preproceso, NMS, evaluador) + fixtures | Obligatoria |
| F3 | Asistente de layout en Studio (detectar, marcar obligatorio, partir, guardar) | Obligatoria |
| F4 | Etapa `LAYOUT` en Tamiz + gate + overlay + motivos | Obligatoria |
| F5 | PWA offline-first (manifest, SW, caché de S, descarga opcional plus-L) | MVP |
| F6 | Importación de molde por archivo y QR | MVP |
| F7 | Corpus, métricas automáticas y E2E documentado | Deseable |
| F8 | Endurecimiento (perfiles, memoria, mensajes, telemetría local) | Deseable |

### F0 — primera tarea, sin excepción

Antes de escribir código de producción, reproduce y amplía el spike:

- Parte el bloque de títulos fusionado de S (cortes relativos ≈ `[0.37,
  0.62]` dentro del contenedor).
- Acepta `text` como tabla en nivelación/votos con restricciones de ancho y
  alto.
- Parte el bloque `image` fusionado de E-14/logo/Registraduría con cortes de
  plantilla o recortes por zona.
- Mide contra `docs/investigacion/pp-doclayout/e14-p1-chandra-gt.json` con el
  mismo matcher (IoU ≥ 0.5 o contención ≥ 0.8) y cronometra en un celular
  real si tienes acceso; si no, en Chrome desktop y declara el equipo.

Criterio ya acordado:

- S **≥ 16/19 con ≤ 1 falso positivo** en E-14 p1 → S es el modelo por
  defecto del gate.
- Si no → S queda para pre-gate/autoría gruesa y plus-L es obligatorio para
  la validación fina (descarga opcional).

Escribe `docs/investigacion/2026-11-2x-spike-s-estructura.md` con la tabla,
los tiempos y la decisión. No sigas a F1 sin este reporte.

## 4. Qué construir (resumen operativo)

### F1 — Contrato

- Mueve los tipos y validadores actuales de
  `apps/molde-studio/src/lib/molde/universal-types.ts` a
  `packages/molde-contract`.
- Studio reexporta desde su ruta actual; no rompas imports internos.
- Agrega `MoldeUniversal.layout?: LayoutMolde` y `ReglaLayout` según
  `PLAN-AGENTE-LAYOUT.md` §4.1.
- Endurece `esMoldeUniversal` / `erroresMolde`: zonas finitas, cortes
  crecientes en (0,1), `minimo <= maximo`, `campoId` existente.
- Tamiz consume el paquete para validar el molde importado.
- Tests: molde válido sin layout, layout válido, cortes fuera de rango,
  `campoId` inexistente, `maximo < minimo`.

### F2 — Motor de layout

- `packages/layout-core`, sin React ni Next.
- Registro de modelos `s` y `plusL` con URL, tamaño, SHA-256 y contrato de
  preproceso (ver `MODELOS-Y-DATOS.md`).
- ORT Web WASM, hilos configurables; liberar sesión con `dispose()`.
- Preproceso y decodificación exactos según el dossier; NMS
  clase-agnóstico IoU 0.5 para plus-L; S ya trae NMS.
- Escalado a la página y clamp a bordes.
- `evaluarEstructura(detecciones, reglas, W, H)` con margen 2%, NMS interno
  en grupos, divisiones por cortes y conteos.
- Tests sin modelo con fixtures grabados de `benchmark/results.jsonl`; el
  evaluador debe reproducir el 19/19 de plus-L y el resultado del spike S.
- La lógica del prototipo está en
  `docs/investigacion/pp-doclayout/estructura-e14.js` y
  `benchmark/public/app.js` (`layoutE14`). **Extráela y tipála; no copies el
  archivo tal cual.**

### F3 — Studio

- `LayoutAssistant.tsx` integrado desde `EditorTab.tsx`.
- Detectar estructura sobre la página de referencia; overlay con clase y
  score.
- Por bloque: obligatorio/opcional, etiqueta, campo existente o nuevo,
  partir con guías, fusionar, descartar.
- Selector S/plus-L con advertencia de peso.
- "Probar molde": estructura + OCR con el motor actual; tabla
  regla → estado → caja.
- Guardar `layout` y exportarlo. Nada se guarda sin confirmación.
- Si el modelo no carga, el editor sigue funcionando manualmente.

### F4 — Tamiz

- Nueva etapa `LAYOUT` entre `CALIDAD` y `OCR` en `pipeline.ts` y
  `real-core-bridge.ts`.
- Molde sin `layout` → se salta la etapa (retrocompatible).
- Regla obligatoria faltante → corte temprano `RECHAZADA` con regla y motivo.
- Solo opcionales o baja confianza → continuar a OCR.
- Overlay de reglas/campos en `ReviewView` y `AnalyzingView`.
- Diagnóstico local: modelo, ms, reglas ok/faltantes, score.
- Reutiliza `protocolo.ts`; agrega motivos sin romper los existentes.
- Lema: un documento equivocado no debe gastar un OCR completo.

### F5 — PWA

- Manifest, iconos, `display: standalone`, enlace desde `layout.tsx`.
- Service worker propio o Workbox: precache del shell + S + ORT wasm +
  Tesseract core/`spa`; cache-first para modelos versionados por hash.
- **No cachear fotos de documentos.**
- plus-L: botón explícito, tamaño visible, progreso, checksum, borrar.
- `navigator.storage.estimate()` y aviso de cuota.
- COOP/COEP en `public/_headers`; fallback a 1 hilo sin aislamiento.
- Prueba real: primera carga con red → modo avión → escanear.

### F6 — Archivo/QR

- Exportar `.molde.json` con `schemaVersion` y checksum.
- Importar en Tamiz desde archivo con validación y vista previa.
- QR con payload comprimido si cabe; si no, URL de descarga en LAN servida
  por Studio. Documenta el límite.
- IndexedDB con versión y fecha; activar un molde.
- Cap de tamaño (2 MB), rechazo de JSON inválido, sin `eval`, sin URLs
  remotas arbitrarias.

## 5. Reglas duras

1. Rama `feat/layout-gate`. **No hagas push, PR, merge ni release.** El
   dueño aplica y prueba el ZIP.
2. No incluyas modelos ONNX, PDFs, fotos, `.env`, bases SQLite, uploads,
   `node_modules`, `.next` ni `out` en el ZIP de vuelta.
3. No cambies el comportamiento actual de moldes sin `layout`.
4. No introduzcas backend, login, multiusuario ni sincronización.
5. TypeScript estricto; reutiliza componentes shadcn/UI y estilos
   existentes; UI en español.
6. Cada fase termina con `typecheck`, `lint` y build en verde. Si algo no
   compila, no lo entregues como terminado: déjalo fuera o documentado.
7. Cada prueba real con documentos termina en una lección reproducible
   (`lessons/TEMPLATE.md` + índice si aplica).
8. Los fixtures y el GT viven en el repo; los modelos no.
9. Si una decisión cambia el contrato del molde, escribe un ADR corto en
   `docs/` y déjalo señalado en `CAMBIOS.md` para revisión.

## 6. Criterios de aceptación (mínimos)

- [ ] F0 documentado con tabla S/plus-L y decisión.
- [ ] `typecheck`, `lint` y build de Studio y Tamiz en verde.
- [ ] Molde existente sin `layout` carga y corre igual que antes.
- [ ] Molde con `layout` válido se exporta, importa y evalúa.
- [ ] E-14 correcto → `OPTIMA` (o el estado equivalente ya definido) con el
      OCR actual.
- [ ] Documento equivocado → `RECHAZADA` con la regla y el motivo exactos,
      sin OCR completo.
- [ ] plus-L reproduce F1 = 1.0 con fixtures; S cumple el criterio de F0 o
      queda documentado como pre-gate.
- [ ] Post-proceso estructural ≤ 20 ms/página en el equipo de prueba.
- [ ] Tamiz funciona offline tras la primera carga (si F5 se completó).
- [ ] `CAMBIOS.md` y `REPORTE-PRUEBAS.md` incluidos en el ZIP.

## 7. Supuestos y decisiones por defecto

Si no puedes consultar al dueño, usa estos valores y anótalos en
`CAMBIOS.md`:

- Modelo por defecto: el que salga de F0.
- Umbral de score de layout: 0.2 en pool; 0.15 solo en la franja de títulos.
- Margen de zona: 0.02.
- NMS interno: IoU 0.5.
- Modelos servidos desde `/models/` en dev; en producción, URL versionada
  con CORS y checksum.
- Sin WebGPU: el rendimiento medido fue WASM. No bloquees el MVP por WebGPU.
- Un campo OCR obligatorio dudoso va a `EN_REVISION_HUMANA`, no a
  `RECHAZADA`; una regla estructural obligatoria faltante sí rechaza.

## 8. Reporte final dentro del ZIP

`CAMBIOS.md` debe incluir:

- Estado por fase: hecha / parcial / no hecha, con una línea de evidencia.
- Decisiones tomadas y supuestos.
- Comandos ejecutados y su resultado (typecheck, lint, build, tests).
- Cómo probar el flujo completo en PC y en celular.
- Limitaciones conocidas y riesgos.
- `git diff --stat` y hash del commit base usado.

`REPORTE-PRUEBAS.md` debe incluir las tablas de F0 y cualquier medición
real, con equipo, navegador y versión.
