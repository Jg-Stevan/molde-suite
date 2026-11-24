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

