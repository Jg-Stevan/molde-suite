# Ficha de lección — recibo tachado: penalización de posición rechazaba anclas perfectas

```markdown
---
id: "recibo_pago-local-2026-11-24-correccion-posicion"
plantilla: "recibo_de_pago (v1.3.2)"
tipo_documento: "generico/recibo_pago"
condicion: "PNG 1700x1519 recortado (ref 1700x2200) con revelados negros (fecha, N.º recibo, importe)"
herramientas_usadas: ["ancla_relativa", "buscarAncla fuzzy", "textoEnRect (mapa global)", "mapa OCR de rescate", "rescateAntiTachon", "endurecerFallbackNoVerificado"]
version_motor: "scanner-core feat/extraccion-relacional + correcciones post-verificación (commit 7)"
resultado: "exitoso"
campos_fallidos: ["fecha_emision", "numero_recibo", "datos_emisor", "importe"]  # datos BAJO revelado: ilegibles de verdad
metrica: { veredictos_ok: "6/12 (5 genuinos)", zonas_correctas: "11/12 ancladas o honestas" }
---

## Problema observado

Corrida real del feat entregado (Fases 0-4 del plan) contra `recibo-completo
tachado.png`: **score 16.7** (peor que el baseline 33.3 de main), con 5 campos
LEGIBLES fallando: `titulo` (no_encontrado), `concepto`, `forma_pago`,
`fecha_pago`, `datos_emisor`. El rescate anti-tachón local disparaba pero
fallaba (`rescate_fallido`) en todos.

## Causa raíz (verificada, dos capas)

1. **Penalización de posición en `buscarAncla`**: el OCR global (psm 4, a los
   1000 px del pipeline) SÍ lee "En concepto de:", "Forma de pago:" y "Fecha
   de pago:" con match textual PERFECTO (d=0). Pero el canvas es un recorte
   (894 px de alto vs 2200 de referencia): la geometría normalizada queda
   desplazada dy 0.16-0.21 → `1/(1+3*(dx+dy))` = 0.61-0.67 < `ANCLA_SCORE_MIN`
   0.72 → el motor RECHAZABA el match perfecto y caía al fallback de
   referencia (rect desplazado, lectura vacía o de la línea vecina). La
   penalización existe para DESAMBIGUAR; con un único candidato perfecto no
   hay nada que desambiguar.
2. **El título no existe en el mapa OCR global**: el revelado del importe rompe
   la segmentación de líneas de Tesseract (psm 4 no segmenta "RECIBO DE PAGO"
   ni en 1700 ni a 1000 px). Sin el ancla en el mapa, `titulo` caía a
   referencia y su recorte medio-corto leía vacío.

## Qué funcionó / qué no

- ✅ Bypass posicional por match perfecto único (`ancla_solo_textual`):
  concepto/forma_pago/fecha_pago → ok conf 0.95 con valores EXACTOS.
- ✅ Mapa OCR de rescate perezoso (binarizeNoLines + 2ª pasada): recupera el
  título "RECIBO DE PAGO" (conf 0.85-0.96) → `titulo` ok.
- ✅ En la imagen limpia el bypass dispara sin costo (0 pasadas extra, score
  100 intacto); en la rotada 12° el score 75 se mantiene con valores mejores.
- ❌ El rescate anti-tachón LOCAL (por campo) no puede resolver nada de esto:
  su recorte ya está mal puesto si el ancla falló. El rescate que funciona es
  el del MAPA (página completa, antes del anclaje).
- ❌ Los campos con datos bajo revelado negro (fecha_emision, numero_recibo,
  importe) son ilegibles de verdad — requiere_revision es el veredicto
  correcto y honesto (el bar negro borra la información, no la oculta del OCR).

## Resultado tras la corrección

| Caso | main | feat entregado | feat corregido |
|---|---|---|---|
| limpia pag-01.png | 100 | 100 | **100** (0 pasadas OCR extra) |
| rotada 12° | 75 | 75 | **75** (valores mejores) |
| tachado 1700×1519 | 33.3 | 16.7 | **50.0** (5 ok genuinos) |

## Recomendación para próximas plantillas

1. La penalización de posición de un ancla SOLO debe decidir entre candidatos
   AMBIGUOS; un match textual perfecto y único se acepta (con bandera) aunque
   la geometría normalizada discrepe — el canvas puede ser un recorte/escala
   distinta de la referencia.
2. Si el documento puede traer tachones/revelados, el mapa OCR global necesita
   un rescate con limpieza morfológica ANTES de descartar anclas: el daño del
   tachón es de SEGMENTACIÓN (líneas enteras desaparecen), no de lectura.
3. `ok: null` en validaciones NO debe degradar campos individuales: el gate
   global ya marca `requiere_revision`; degradar el campo que sí se leyó bien
   es castigar la lectura correcta por la ilegible.
```
