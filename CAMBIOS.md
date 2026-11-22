# Cambios — layout estructural en molde-suite

- Fecha: 2026-11-22
- Commit base (`git rev-parse HEAD` sobre `main`): `086a76a` (Merge pull request #8 — feature/dla-integracion)
- Rama: `feat/layout-gate` (4 commits sobre el base — sin push, sin PR, el dueño aplica y prueba)
- Ejecutado por: agente externo (sandbox aislado, sin acceso al PC del dueño)

## Estado por fase

| Fase | Estado | Evidencia |
|---|---|---|
| F0 Spike S vs plus-L | **hecha** | `docs/investigacion/2026-11-22-spike-s-estructura.md` — S + estructura SPIKE **16/19 con 0 FP → CUMPLE el criterio**; plus-L control 19/19 (F1 = 1.0); baseline S 8/19 reproducido exactamente. Script reproducible: `bun run spike-s` en `packages/layout-core` (corre sin modelo, con fixtures grabados). |
| F1 molde-contract | **hecha** (adaptada) | La extensión `layout` vive en `packages/scanner-core/molde/universal-types.ts` (v3.1.0) — el repo YA unificó el contrato en scanner-core (FASE 0 blueprint DLA), así que NO se duplicó en `packages/molde-contract`; ver ADR `docs/adr/0001-reglas-layout-aditivas.md`. Validadores `esMoldeUniversal`/`erroresMolde` endurecidos (zonas 0-1, cortes crecientes en (0,1), `minimo <= maximo`, clases canónicas, `campoId` existente). Studio reexporta por su ruta histórica (`universal-types.ts` shim) y Tamiz consume el mismo paquete. |
| F2 layout-core | **hecha** | `packages/layout-core` (sin React, sin Next, sin DOM para el evaluador): `evaluarEstructura`, NMS clase-agnóstico, matcher IoU/contención, normalización de alias de clases, registro declarativo S/plus-L (bytes + SHA-256 + contrato de preproceso). **Golden tests: plus-L 19/19 (P=R=F1=1.0), stock 0.5 → 12/19, 0.4+NMS → 16/19, S baseline → 8/19, post-proceso < 1 ms.** 14 tests en `packages/layout-core/tests/`. |
| F3 Studio | **hecha** | `apps/molde-studio/src/components/studio/LayoutAssistant.tsx` (nuevo) + 5ª pestaña "Layout" en `EditorTab.tsx`: detectar (dla-onnx), overlay con clase/score, obligatorio/opcional, etiqueta, campo existente/nuevo, partir (cortes validados), fusionar, descartar, "Probar molde" (tabla regla → estado → caja), guardar con confirmación explícita, quitar. Sin modelo configurado el editor sigue funcionando (autoría manual + reglas desde campos). |
| F4 Tamiz | **hecha** | Etapa `LAYOUT` entre CALIDAD y OCR (`pipeline.ts`): rechazo temprano `RECHAZADA`/`INCOMPLETA` con regla+motivo exactos ANTES del OCR ("un documento equivocado no debe gastar un OCR completo"); `EstructuraActa` aditiva en `Acta`; paso inyectado `evaluarEstructuraActa` (`bridge/estructura.ts`, patrón null-safe de `ocr-dinamico.ts`); tarjeta + overlay de reglas en `ReviewView`; `LAYOUT` en `EtapaAnalisis`/progreso/AnalyzingView. Molde sin `layout` → etapa saltada (comportamiento idéntico a v3.0.0). |
| F5 PWA | **hecha** | `manifest.webmanifest` + iconos SVG + `offline.html` + `sw.js` propio (network-first navegaciones; cache-first shell/tesseract/wasm; cache-first `tamiz-modelos-v1` para `/models/`; **jamás cachea fotos** — solo red para `/api/` y no-GET) + `_headers` COOP/COEP. plus-L: descarga opcional con progreso %, verificación SHA-256 contra el registro (`MODELOS_LAYOUT`), caché y borrado; `storage.estimate()` + `persist()`. Panel "Modelos" en PanelDev. |
| F6 Archivo/QR | **hecha** (QR de exportación en Studio pendiente — ver limitaciones) | Studio: export `.molde.json` con checksum SHA-256 (el exporte plano anterior queda intacto). Tamiz: importador con tope 2 MB, validación `esMoldeUniversal`/`erroresMolde`, verificación de checksum, rechazo de URLs remotas arbitrarias, sin `eval`; IndexedDB `tamiz-moldes-v1` (listar/guardar/borrar/activar + migración desde localStorage); UI PanelMoldes: archivo / pegar JSON / **QR vía BarcodeDetector nativo** (payload JSON directo o URL LAN con confirmación y filtro de IP privada). |
| F7 Corpus | no hecha | Corpus multi-página/multi-dispositivo y matriz de resultados: requiere los PDFs y el celular del dueño. Sembrado: fixtures + GT en el repo, matcher y `metricas` listos para F7. |
| F8 Endurecimiento | parcial | Perfiles por dispositivo y telemetría local no implementados. Memoria/sesiones: la sesión ORT vive en el worker de dla-onnx (ya existente, con `dispose` vía `cerrar()`). |

## Decisiones tomadas y supuestos

1. **Contrato en scanner-core, no `packages/molde-contract`**: el repo ya movió los tipos a scanner-core (decisión D8). Duplicar en un segundo paquete rompería la fuente única. Documentado en ADR-0001 (revisión pendiente del dueño).
2. **Campos aditivos en `ReglaLayout`** (ADR-0001): `pagina`, `minW/maxW/minH/maxH`, `estricto` — necesarios para expresar el E-14 validado; todos opcionales y retrocompatibles. `MOLDE_UNIVERSAL_VERSION` → `3.1.0`.
3. **Modelo por defecto (F0)**: S cumple el criterio acordado (16/19, ≤ 1 FP → 0 FP) → `s` es el default del gate; `plusL` queda como validación fina opcional. En el molde, `layout.modeloPreferido` es declarativo (hoy Tamiz evalúa con el modelo S configurado y lo reporta honesto; el preset plus-L de dla-onnx es trabajo futuro).
4. **Asignación codiciosa entre reglas**: una caja satisface UNA regla (en orden de declaración) y sus duplicados IoU ≥ 0.5 salen del pool. Hallazgo del spike: sin esto, el margen 2% deja que el número del código de barras robe el tercer título (lección en `lessons/acta_e14/2026-11-22-layout-e14-f0-spike.md`).
5. **Umbrales usados** (defaults del plan §7): pool minScore 0.2, margen 0.02, NMS interno 0.5, banda de baja confianza 0.05, matcher IoU ≥ 0.5 o contención ≥ 0.8.
6. **El motor no conoce el E-14**: las reglas viven en fixtures (`packages/layout-core/fixtures/*.json`) y serán reglas del molde; el evaluador es genérico.
7. La detección real usa el preset existente de dla-onnx (PP-DocLayout-S). Los contratos exactos de preproceso del dossier (estirado + scale_factor, im_shape) están DOCUMENTADOS en `packages/layout-core/src/modelos.ts` para cuando se integre la inferencia calibrada; el letterbox actual de dla-onnx difiere del contrato calibrado del dossier — señalado como trabajo de calibración con el banco (lessons/).

## Verificación (comandos y resultado)

```
apps/molde-studio:  bun run typecheck → 0 errores
                    bun run lint      → 0 errores
                    bun run build     → OK (rutas API + estáticas compiladas)
                    bun test          → 34 pass / 0 fail (regresiones fase8 + correcciones)
apps/tamiz:         bun run typecheck → 0 errores
                    bun run lint      → 0 errores
                    BUILD_STATIC=1 bun run build → OK (out/ con sw.js, _headers, manifest, offline.html)
packages/layout-core: bun test       → 14 pass / 0 fail (golden 19/19 y spike S)
```

## Cómo probar en PC

1. Aplicar el ZIP sobre la raíz del monorepo (ver `APLICAR-EN-REPO.md` del paquete), `bun install`.
2. Studio: `cd apps/molde-studio && bun run dev` → abrir un molde → pestaña **Layout** → "Crear reglas desde campos" (funciona sin modelo) → editar obligatorias/etiquetas → "Probar molde" → "Guardar en el molde" → exportar `.molde.json (con checksum)`.
3. Con modelo (opcional): poner los ONNX en `apps/molde-studio/public/models/` y definir `NEXT_PUBLIC_DLA_MODELO_LAYOUT=/models/pp_doclayout_s.onnx` → "Detectar estructura" habilitado.
4. Tamiz: `cd apps/tamiz && bun run dev` (puerto 3100) → PanelDev → "Moldes" → importar el `.molde.json` (archivo/pegar) → Activar → escanear/importar una foto: con molde con `layout` y modelo configurado, la etapa LAYOUT corre antes del OCR; un documento sin la estructura da `RECHAZADA — EL DOCUMENTO NO CORRESPONDE A LA PLANTILLA... — FALTA: <regla>` sin gastar OCR.

## Cómo probar en celular

1. `BUILD_STATIC=1 bun run build` en Tamiz → `out/` → servir con cabeceras COOP/COEP (Cloudflare Pages usa `public/_headers`; en LAN `python -m http.server` cae a 1 hilo).
2. PWA: primera carga con red → el SW cachea shell/modelos → modo avión → la app abre (`offline.html` de respaldo) y el flujo sigue.
3. QR: PanelDev → "Moldes" → "Escanear QR" (Chrome Android) → payload JSON o URL LAN de Studio.

## Limitaciones conocidas

- **Sin celular real en esta entrega**: toda la verificación es desktop (typecheck/lint/build/tests + el spike sobre fixtures grabados de corridas reales del celular del dueño). Los tiempos móviles NO se midieron de nuevo; los del dossier se citan como referencia.
- **Sin ONNX en el sandbox**: la detección en vivo no se ejecutó; los contratos están parametrizados por URL (`NEXT_PUBLIC_DLA_*`) y toda la lógica se verificó con fixtures golden. La calibración del preproceso (estirado vs letterbox) queda como paso obligatorio con el banco de pruebas.
- El preset plus-L de dla-onnx no existe todavía: `modeloPreferido: 'plusL'` es aspiracional en runtime (la descarga/caché sí está lista).
- QR de exportación desde Studio no implementado (Tamiz ya lo importa; falta generar el QR en Studio con el payload o URL LAN).
- F7 (corpus) y parte de F8 sin hacer; declarados arriba.
- `layout.reglas` de páginas ≠ 1 no se evalúan en Tamiz aún (solo `pagina: 1`).

## Nota de empaquetado

El ZIP incluye los overlays PNG de `docs/investigacion/pp-doclayout/previews/`
(evidencia visual 19/19 y baseline S citada por el dossier — son documentos de
prueba del dueño, sin terceros). El `results-banco.jsonl` (148 KB) es la fuente
de las fixtures golden. Si prefiere un ZIP mínimo, bórrenlos: no afectan código.

## Riesgos

- El orden de declaración de reglas es semántico (consumo codicioso): moldes futuros deben declarar las reglas unívocas primero (documentado en el asistente y en la lección).
- `estricto: true` en reglas obligatorias puede endurecer el gate más de lo deseado (default false = prototipo validado).
- COOP/COEP: sin cabeceras, ORT cae a 1 hilo (funciona, más lento) — probado en el diseño del SW/middleware, no en hosting real.
