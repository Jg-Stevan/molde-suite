# GOBERNANZA-DATASET.md — correcciones pendientes del dataset real (Benchmark V3)

> **Fecha:** 2026-11-27 · **Origen de los hallazgos:** informes E1 (§2 inventario/GT) y E2 (§5/§10.4 gobernanza) del `PLAN-BENCHMARK-V3.md`.
> **Regla:** el dataset físico vive en `scripts/resultados/fixtures-reales/3-DOCUMENTOS-IMPRESOS - copia/` (gitignored; origen `upload/*.part{1,2}.rar`). **Nunca se sube a git.** Este documento registra qué corregir cuando se toque el dataset en local.

---

## 1. Correcciones de etiquetas (las etiquetas contradicen las fotos)

| Archivo | Etiqueta actual | Realidad medida (GT visual curado en `docs/benchmark-v3/salidas/tinta.json`) | Acción |
|---|---|---|---|
| `recibo-a-impreso-firmas-vacias-02.jpg` | «firmas vacías» | **SÍ lleva firma del emisor** (densidad 0.08293 con método v2) | renombrar a `recibo-a-impreso-firma-emisor-02.jpg` o corregir el GT |
| `recibo-a-impreso-firmas-vacias-03.jpg` | «firmas vacías» | **Lleva ambas firmas** | renombrar a `recibo-a-impreso-firmas-llenas-03.jpg` |
| `recibo-impreso-01.jpg` / `recibo-impreso-02.jpg` | «2 tomas impresas» | **Duplicados byte-a-byte (md5)** de `firmas-vacias-02/03` — no son tomas nuevas | eliminar del banco (el banco efectivo del recibo son 3 fotos únicas); los informes ya no promedian dos veces la misma imagen en métricas por-molde |
| `Comprobante de entrega/...-vacias-03` | «firmas vacías» | lleva una **marca pequeña de tinta** | registrar en el GT como con-tinta-parcial |

## 2. Duplicados y desalineación del GT Chandra (datalab-convert)

1. **El `datalab-convert` del comprobante es un duplicado byte-idéntico del del recibo** — el GT estructural del comprobante NO existe realmente. Regenerarlo con Chandra/Datalab sobre `Digitalización 7-página-2.png`.
2. **El datalab del recibo corresponde al render antiguo (1624×2100)** mientras el escaneado vigente es 1700×2200 (y el banco escaneado dice `REC-2026-0314` mientras el GT histórico dice `REC-2026-0157`) — regenerar el GT Chandra sobre el escaneado vigente (`pag-01.png`).
3. **`molde/datalab-convert-e26-pag-01`** es el único GT estructural alineado — usable tal cual.

## 3. Rotación EXIF

Las fotos reales llevan **EXIF orientation 6**: cualquier runner que no la aplique produce coordenadas transpuestas (el arnés del Agente 2 la aplica; el port de producción debe mantenerla — lección registrada).

## 4. Umbrales de tinta — análisis numérico del cierre (no aplicar el «0.10» del informe E1)

Datos medidos (calibración v1.3.1 del molde + arnés A1 §3.5 + tinta v2 de E2):

| Magnitud | Valor |
|---|---|
| Con tinta (escaneado, trazo fino real `firma_comprador`) | **0.0087** |
| Con tinta (variante completa, VAR 3) | **0.0413** |
| Sin firma (escaneado, zona correcta) | **0.0000** |
| Textura del papel impreso en FOTOS (zona 0.46 de ancho) | **0.052-0.089** |

**Conclusión: NO existe umbral estático que separe** la textura-en-fotos (0.052+) del trazo fino real (0.0087): se solapan. Subir el umbral del molde genérico a ≥0.10 (sugerencia literal del informe E1 §3.5) **rechazaría TODAS las firmas reales** — el error peligroso («sin tinta» en documento firmado), violando la doctrina «un documento completo y legible NUNCA se rechaza».

**Vías correctas** (pendientes, requieren las fotos):
1. **Recalibrar la zona a_real** para que sea SOLO sobre la rúbrica (sin texto impreso vecino) y verificar la regla MOLDE-SPEC §3 `max(sin) < 0.5×min(con)` sobre la toma más sucia.
2. **Portar el método v2** (fondo local gaussiano + contraste agudo + oscuridad absoluta; 10/10 con 0 FP / 0 FN en este banco) al medidor por recorte del motor — es el cambio robusto porque normaliza el fondo por zona.

**E-26 (NO aplicado — conflicto de datos resuelto por doctrina):** el informe E1 sugiere «umbral ≥ 0.04 lo arregla» (textura PIL 0.0176-0.031), PERO la calibración v1.2.0 del propio molde registra en la nota de `firma_1`: «Ratio medido **0.0238** constante en las 6 páginas (2x el umbral)» — es decir, la firma REAL mide 0.0238 en esa rendija de 14 px. Con umbral 0.04 esa firma real pasaría a «sin tinta» (el error peligroso). Los dos datos provienen de métodos distintos (PIL cruda vs `medirTinta` del motor con apertura H/V + filtro de líneas) y no son comparables.

**Resolución (aplicada):** se MANTIENE 0.012 (nunca rechaza la firma real) y la re-calibración exige:
1. Extraer del crudo A1 (`bun bench-ocr.mjs --solo-analisis`) los ratios `medirTinta` por zona (las 18) sobre las actas en blanco → techo real de la textura bajo el contrato del motor.
2. Conseguir ≥1 acta E-26 FIRMADA → medir `min(con)` por zona y aplicar MOLDE-SPEC §3 (`max(sin) < 0.5×min(con)`).
3. Mientras tanto, el veredicto del E-26 debe tratar «18 falsos con tinta» como **limitación documentada del molde v1.2.0**, no como bug del medidor (recibo y E-14 = 100 % con el mismo medidor).

## 5. Inconsistencias molde ↔ especificación detectadas por el GT

1. El molde del recibo v1.4.0 marca `importe_texto` como **opcional**, pero la clasificación §4 de su especificación lo exige — decidir: subir a obligatorio o documentar la excepción.
2. El molde E-26 exige **18 firmas obligatorias** que el acta escaneada no tiene (folios parcialmente en blanco) — el veredicto del acta vigente será siempre RECHAZADA por firmas: marcar las zonas de firma del E-26 como opcionales-con-informe o ajustar el molde al tipo de acta real.
3. **GT tinta del Agente 1 (`gt-tinta.json`) pendiente de luz verde del dueño** — los booleanos del E-14 rozan umbrales (§2.4 de `INFORME-MOTORES-MOLDES.md`); cualquier corrección regenera `resumen-motores.json` con `bun bench-ocr.mjs --solo-analisis`.

## 6. Checklist de regeneración (cuando se ejecute en local)

```bash
# 1. Renombrar/eliminar duplicados (§1) — mantener el md5 en el registro
# 2. Regenerar GT Chandra del escaneado vigente (§2) con Datalab/Chandra
# 3. Re-correr tinta.py para actualizar tinta.json (GT visual)
# 4. Re-generar gt-recibo-pago.json / gt-comprobante-entrega.json si cambian valores
# 5. Anotar por toma qué campos caen fuera del recorte físico (toma 1 del recibo pierde título y cabecera)
# 6. bun bench-ocr.mjs --solo-analisis <crudo.json>  (regenera resumen sin re-correr OCR)
```
