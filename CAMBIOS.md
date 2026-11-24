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

