# Resultados del arnés de verificación (FASE 0b)

Corridas documentadas contra `apps/molde-studio/public/moldes-genericos/recibo_pago/pag-01.png`
(imagen de referencia limpia 1700×2200, la del molde calibrado), una copia
rotada 12° de la misma (sintética, `sharp().rotate(12, { background: '#fff' })`)
y **la imagen del diagnóstico** `recibo-completo tachado.png` (1700×1519,
recortada, con revelados negros sobre fecha / N.º recibo / importe).

| Archivo | Motor | Molde | Imagen | Score | requiere_revision |
|---|---|---|---|---|---|
| `baseline-main-limpia-pag01.json` | main (motor viejo) | v1.3.1 | limpia | **100** | false |
| `feat-nuevo-limpia-pag01.json` | feat/extraccion-relacional | v1.3.2 | limpia | **100** | false |
| `baseline-main-rotada12.json` | main (motor viejo) | v1.3.1 | rotada 12° | 75 | true |
| `feat-nuevo-rotada12.json` | feat/extraccion-relacional | v1.3.2 | rotada 12° | **75** | true |
| `entregado-tachado-1519.json` | feat SIN correcciones | v1.3.2 | tachado | **16.7** | true |
| `corregido-tachado-1519.json` | feat + correcciones | v1.3.2 | tachado | **50.0** | true |
| `corregido-limpia-pag01.json` | feat + correcciones | v1.3.2 | limpia | **100** | false |
| `corregido-rotada12.json` | feat + correcciones | v1.3.2 | rotada 12° | **75** | true |

## Veredictos

1. **No-regresión (criterio FASE 1 del plan):** score limpio 100 → 100 con
   valores idénticos campo por campo. El gate de validaciones nuevo
   (`fechas_coherentes`, regla `rango`) evaluó y pasó en la corrida feat.
2. **Mejora de valores en la rotada (FASE 1a — mapa OCR global):** el motor
   viejo leía `importe: "480,50 €"` (recorte encogido truncó la cifra); el
   nuevo lee `importe: "2.480,50 €"` (valor completo). Ídem `importe_texto`
   y `datos_pagador` (más completo).
3. **Rescate anti-tachón (FASE 4):** `fecha_emision` en la rotada salió
   `rescate_anti_tachon` (la limpieza morfológica recuperó la fecha → `ok`);
   los campos donde no mejoró llevan `rescate_fallido` (honesto, sin inventar).
4. **Firmas:** en la imagen limpia ambas firmas resuelven `fuente: 'ancla'`
   con rects DISTINTOS (el falso positivo del diagnóstico — dos firmas 'ok' en
   el MISMO rect de referencia — queda cubierto además por la regla
   `fallback_no_verificado` cuando el ancla no aparece).

## CORRECCIÓN post-verificación (recibo tachado — la imagen del diagnóstico)

La corrida del feat SIN correcciones contra la imagen del problema
(`recibo-completo tachado.png`, 1700×1519) daba **score 16.7** — peor que el
baseline 33.3: la Fase 1b hizo honestos los veredictos (firmas falsas `ok` →
`requiere_revision`) pero NINGÚN campo legible se recuperó. Causas raíz
medidas (evidencia en `lessons/recibo_pago/2026-11-24-tachado-posicion-ancla.md`):

1. `buscarAncla` rechazaba matches textuales PERFECTOS (d=0) de
   concepto/forma_pago/fecha_pago por la penalización de posición (dy 0.16-0.21
   del recorte → score 0.61-0.67 < 0.72). Corrección: bypass para match
   perfecto y ÚNICO (`ancla_solo_textual`) — la penalización solo desambigua.
2. El título "RECIBO DE PAGO" NO existía en el mapa OCR global (el revelado del
   importe rompe la segmentación de líneas de Tesseract). Corrección: mapa OCR
   de rescate PEREZOSO (P4 del diagnóstico) — 2ª pasada OCR sobre el canvas con
   limpieza anti-tachón, solo si un campo pierde su ancla/valor
   (`ancla_rescate_anti_tachon` / `valor_rescate_anti_tachon`). Documento
   limpio: 0 pasadas extra.
3. `ok: null` en validaciones degradaba `fecha_pago` (lectura correcta conf
   0.95) porque `fecha_emision` es ilegible (revelado). Corrección:
   `validacion_no_evaluable` NO degrada campos individuales; `ok: false` sí.

Resultado corregido en la imagen tachada: **score 50.0** — ok genuinos:
`titulo`, `datos_pagador`, `concepto`, `forma_pago`, `fecha_pago` (valores
EXACTOS); los fallos restantes son datos bajo revelado negro (ilegibles de
verdad) y limitaciones geométricas que la FASE 5 resolverá — todos con
banderas honestas (`fallback_no_verificado`, `validacion_no_evaluable`).

## Límite conocido documentado

Ninguno de los dos motores alcanza el score sin rotar con la imagen rotada 12°
(75 vs 100): el deskew por perfil de proyección corrige el ángulo pero el
residual geométrico desplaza los recortes. Es el caso de uso explícito de la
FASE 5 del plan (arnés geométrico con homografía), que requiere las URLs de
los modelos ONNX (las provee el dueño — FASE 0a).

## Cómo reproducir

```bash
# Studio en :3000 con el molde cargado + imagen de prueba
bun scripts/verificar-molde.ts "ruta/a/imagen.png" --url http://localhost:3000
# El JSON queda en scripts/resultados/<timestamp>.json con resumen impreso
```
