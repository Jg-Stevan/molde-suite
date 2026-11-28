---
id: "recibo_pago-a56-2026-11-27"
plantilla: "recibo_pago (v1.4.0) vs recibo_real (v1.0.0) — mismo papel"
tipo_documento: "recibo de pago IMPRISO fotografiado con el celular"
condicion: "Galaxy A56, build de producción en :3100, fixture recibo-real-01.jpg (A: relleno impreso, firmas: una vacía), biblioteca sembrada con el catálogo completo (8 plantillas)"
herramientas_usadas: ["ancla_relativa", "ancla_solo_textual", "htr_manual", "ratioAnclasDe", "elegirCandidato", "sembrarCatalogo"]
version_motor: "feat/auto-molde (entregas 6-7)"
resultado: "fallo_precision"
campos_fallidos: ["FECHA", "N.º RECIBO", "DNI EMISOR", "PAGADOR (nombre y DNI)", "IMPORTE (€)", "CONCEPTO", "FORMA DE PAGO", "FECHA DE PAGO", "Firma pagador"]
metrica: { veredictos_ok: "recibo_real 3/12 (score 25) · recibo_pago 5/12 (score 41.7)", zonas_correctas: "ratio de anclas: recibo_real 1.0 · recibo_pago 0.6" }
---

## Problema observado

Con el AUTO de la entrega 6, la misma foto de un recibo IMPRISO se evalúa contra
`Recibo de pago — real (A/B/C)` — la variante pensada para relleno A MANO — y el
resultado es peor que contra la plantilla calibrada:

| Plantilla elegida | ratio de anclas | score | ok/total | qué pasa en pantalla |
|---|---|---|---|---|
| `recibo_real` (gana hoy) | **1.0** | 25 | **3/12** | 8 filas `CONFIRMAR` (el motor leyó el valor con conf 95 % pero el campo es `htr_manual` → exige revisión humana) |
| `recibo_pago` | 0.6 | 41.7 | **5/12** | lee importe, concepto y pagador como `ok`; 4 campos `SIN LECTURA` |

Medido con `scripts/entrega/auto-molde-a56.mjs`:
`TAMIZ_SIN_LIMPIEZA=1 TAMIZ_BIBLIOTECA_SIN="real" node … recibo` borra las filas
`*_real` de la biblioteca y re-mide la MISMA foto (líneas `ratio de anclas por
molde` y `resumen del motor universal` de `consola-molde.txt`).

## Causa raíz

`ratioAnclasDe` mide si las ANCLAS del molde aparecen en el OCR, no si el molde
EXTRAE. Las anclas de `recibo_real` son las etiquetas impresas («Fecha:»,
«N.º Recibo:», «Forma de pago:»…), que están presentes en TODAS las variantes
del papel → ratio 1.0 garantizado. Sus campos, en cambio, son `htr_manual`:
piden tinta manuscrita donde hay impresión, así que el dictamen es
`requiere_revision` y el score se hunde. `recibo_pago` tiene anclas más
específicas (y geometría calibrada) que solo baten al 0.6, pero sus campos
sí leen impresión.

Es exactamente la recomendación 1 de
`2026-11-26-variantes-mismo-papel-tinta.md` incumplida por el catálogo
empaquetado: **dos plantillas del mismo papel en la misma biblioteca**, y el
router elige la que puntúa anclas, no la que extrae.

## Qué funcionó / qué no

- ✅ AUTO sin molde activo + catálogo sembrado: la foto SÍ se identifica sola y
  el banner nombra la plantilla (`Recibo de pago — real (A/B/C)`), 12 filas en
  el desplegable, 26-33 s por escaneo en el A56.
- ✅ La medición es reproducible desde el banco (flag de recorte de biblioteca),
  no a mano.
- ❌ Sembrar `recibo_pago` Y `recibo_real`: el desempate por ratio premia a la
  variante `*_real` y el operador ve 9 «faltan» en un recibo perfectamente
  legible.
- ❌ Confiar en el molde activo como escape hatch: a 1.0 vs 0.6 el activo
  (`recibo_pago`) PIERDE, porque `elegirCandidato` compara con `>` estricto y
  solo desempata empates.

## Recomendación para próximas plantillas

1. **Una plantilla sembrada por familia de papel.** Cuando dos moldes comparten
   etiquetas impresas, el que gana el ratio es el que tiene anclas más
   textuales, no el que extrae. Deja en el catálogo la plantilla calibrada y
   mantén las variantes (`*_real`, `variantes/`) como importables a mano.
2. Si se quieren conservar las dos, la comparación debe hacerse por **campos
   extraídos** (ok/total sobre un corpus de fotos reales), no por ratio de
   anclas — el ratio es un pre-filtro de «¿esto es ese papel?», no un ranking de
   calidad.
3. Reportar `requiere_revision` como «FALTA» en el banner es engañoso: el motor
   LEYÓ el valor (conf 95 %) y pide confirmación humana. Con la edición manual
   retirada (entrega 7), esos campos sin salida son ruido: o se recalibra el
   campo a impresión, o el banner debe decir «POR CONFIRMAR», no «FALTA».
