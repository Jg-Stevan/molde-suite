# Ficha de lección — recibo tachado: penalización de posición rechazaba anclas perfectas

```markdown
---
id: "recibo_pago-local-2026-11-24-correccion-posicion"
plantilla: "recibo_de_pago (v1.3.2)"
tipo_documento: "generico/recibo_pago"
condicion: "PNG 1700x1519 recortado (ref 1700x2200) con revelados negros (fecha, N.º recibo, importe)"
herramientas_usadas: ["ancla_relativa", "buscarAncla fuzzy", "textoEnRect (mapa global)", "mapa OCR de rescate", "rescateAntiTachon", "endurecerFallbackNoVerificado"]
version_motor: "scanner-core feat/extraccion-relacional + correcciones post-verificación (commit 7)"
resultado: "fallo_precision"
campos_fallidos: ["fecha_emision", "numero_recibo", "datos_emisor", "importe", "datos_pagador", "firma_emisor", "firma_pagador"]  # los 4 primeros: datos BAJO revelado (ilegibles de verdad); datos_pagador y las firmas: veredicto inestable entre corridas
metrica: { veredictos_ok: "5/12 (4 genuinos) en corrida limpia · 6/12 con 2 firmas falso positivo en corrida de control", zonas_correctas: "11/12 ancladas o honestas" }
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
| tachado 1700×1519 | 33.3 | 16.7 | **41.7** re-medido (50.0 contaba `importe_texto`="o") |

## Re-verificación independiente (2da sesión, 2026-11-24)

Corridas propias en Studio real (rama entregada, molde v1.3.2 importado por
`POST /api/moldes`, misma imagen `recibo-tachado.png` 1700×1519):

| Corrida | Score motor | Detalle |
|---|---|---|
| `main` (f57586e) | **33.3** | 4 ok: `datos_pagador` correcto + `importe_texto`="o" + **2 firmas falso positivo** (fuente referencia, conf 0.97, mismo rect) |
| feat, corrida 1 | **41.7** | 5 ok: 4 lecturas exactas (`titulo`, `concepto`, `forma_pago`, `fecha_pago`) + `importe_texto`="o". Firmas demolidas ✅ |
| feat, corridas 2 y 3 | **50.0** | Mismo código y misma imagen: las 2 firmas vuelven a `ok` por `ancla_solo_textual` (valor "true", `forma_sin_caja`) |

Hallazgos:

1. **La mejora de calidad es real**: `main` acierta 1 campo de 4 "ok"; la rama
   acierta 4 de 5 y elimina los falsos positivos de firmas. Pero el número
   publicado (50.0) no es reproducible ni honesto: incluye ruido contado.
2. **El score no es determinista** entre corridas del mismo binario (±8.3). El
   `score` del motor divide `ok/todos`, así que un campo que oscila mueve la
   métrica sin que cambie nada en el papel.
3. **`ancla_solo_textual` reabría la Fase 1b**: al promover `fuente` de
   `referencia` a `ancla`, el campo quedaba inmune a `endurecerFallbackNoVerificado`
   y el falso positivo de las firmas regresaba por ahí.

Correcciones aplicadas en esta ficha de lección (todas aditivas):

- `ANCLA_TEXUAL_DESPLAZAMIENTO_MAX = 0.3`: el bypass exige que el ancla esté
  cerca del rect esperado (0.30 cubre el recorte medido y rechaza la esquina
  opuesta). La ambigüedad se cuenta sobre TODOS los perfectos, no sobre los
  filtrados por cota — filtrar antes convertía un caso ambiguo en «único».
- `endurecerFallbackNoVerificado` cubre también campos OPCIONALES (pasan a
  `no_encontrado`) y lecturas degeneradas (`lectura_degenerada`).
- Campos de **tinta** (`tipo !== 'texto'`): un ancla solo-textual no prueba
  caja ni rúbrica → `requiere_revision` con `ancla_sin_geometria`.
- Arnés: acepta la forma real del reporte de Studio, recalcula el score por su
  cuenta (`score` y `score_genuino`) y firma cada artefacto con commit, rama,
  imagen y etiqueta (`--etiqueta`).
- Tests unitarios de `buscarAncla`, `parsearRango`, `parsearFechaTexto`,
  `textoEnRect` y `endurecerFallbackNoVerificado` (20 nuevos).

## Recomendación para próximas plantillas

1. La penalización de posición de un ancla SOLO debe decidir entre candidatos
   AMBIGUOS; un match textual perfecto y único se acepta (con bandera) aunque la
   geometría normalizada discrepe **dentro de una cota** — el canvas puede ser un
   recorte/escala distinta de la referencia. Sin cota, una etiqueta que aparezca
   una sola vez en otra zona ancla el campo allí y produce datos falsos con
   aspecto de verificados (y para campos de tinta, el ancla textual no dice nada:
   su evidencia ES la geometría).
2. Si el documento puede traer tachones/revelados, el mapa OCR global necesita
   un rescate con limpieza morfológica ANTES de descartar anclas: el daño del
   tachón es de SEGMENTACIÓN (líneas enteras desaparecen), no de lectura.
3. `ok: null` en validaciones NO debe degradar campos individuales: el gate
   global ya marca `requiere_revision`; degradar el campo que sí se leyó bien
   es castigar la lectura correcta por la ilegible.
```
