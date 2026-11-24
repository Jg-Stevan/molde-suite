# Ficha de lección — recibo: ancla de etiqueta única y offset intra-línea (molde 1.3.3)

```markdown
---
id: "recibo_pago-local-2026-11-24-ancla-unica-offset-intralinea"
plantilla: "recibo_de_pago (v1.3.3)"
tipo_documento: "generico/recibo_pago"
condicion: "banco de 6 imágenes: limpia 1700x2200, recortes al 60 % y 66 % de altura, sin firmas, datos nuevos, rotada 12°"
herramientas_usadas: ["ancla_relativa", "ancla_respaldo", "buscarAncla fuzzy", "bypass match perfecto único", "ancla_solo_textual"]
version_motor: "scanner-core v3.2.0 (sin cambios de motor)"
resultado: "exitoso"
campos_fallidos: ["numero_recibo (1.3.2, en recortes)", "datos_emisor (1.3.2, en recortes)"]
metrica: { limpia: "12/12 · 100", recorte_60: "9/12 · 75 (era 66.7)", recorte_66: "9/12 · 75 (era 50.0)", tachado: "6/12 · 50 (era 33.3)", sin_firmas: "9/12 · 75", datos_nuevos: "9/12 · 75", rotada_12: "11/12 · 91.7 (era 66.7)", falsos_ok: 0 }
---

## Problema observado

Con el molde v1.3.2, dos campos fallaban SOLO cuando la imagen se presentaba
recortada (el OCR seguía leyendo bien):

- `numero_recibo` → `requiere_revision`, valor basura (`"DE PAGO"`, `"PAGO"`,
  `"N.9 Recibo: REC-2026-0314"`). En la imagen limpia salía `ok`.
- `datos_emisor` → `requiere_revision`/`ocr_vacio` SIEMPRE que cambiaba la
  proporción: era la única `zona_fija` del molde, una banda absoluta que cae
  desplazada en cuanto la foto se recorta.

## Causa raíz (verificada, dos capas)

1. **`numero_recibo` — colisión de ancla con el título.** `ancla.texto =
   "Recibo"` es subcadena literal de «RECIBO DE PAGO». En la referencia la
   penalización posicional desempataba (etiqueta y=0.125 vs título y=0.060),
   pero en un recorte el título gana o ambos quedan empatados: hay DOS ventanas
   con match textual perfecto → el bypass `solo_textual` no se concede
   (`perfectos.length !== 1`) y la posición se mide sobre una geometría que el
   recorte ya distorsionó. Es un defecto de DECLARACIÓN del molde.
   El intento previo 1.3.1 («N.º Recibo») tampoco servía: el OCR real lee
   «N.9 Recibo» y la penalización de dígitos (3x) deja el match en 0.718-0.719,
   por debajo del corte 0.72.

2. **`datos_emisor` — el offset entre líneas no sobrevive a un recorte.** El
   primer intento de la Fase 1 fue colgarla de «Recibí de» (una línea más
   abajo) con `dy = -0.083`. En la imagen limpia funcionó; en el recorte al
   60 % leyó la SEGUNDA línea del bloque (`"Logística Ibérica S.L., con CIF
   ..."`) en vez de la primera (`"D. Fernando ..., con DNI ..."`). Causa: los
   offsets se declaran en unidades normalizadas de la PÁGINA DE REFERENCIA,
   pero al recortar, la altura normalizada cambia — el mismo dy físico en
   píxeles ocupa mucho más espacio normalizado. Medido: dy requerido
   -0.083 × (2200/1227) = -0.149. El motor no conoce la escala: cualquier
   offset entre líneas es frágil por diseño.

## Corrección (solo molde, 1.3.3; motor intacto)

- `numero_recibo`: ancla declarada con la lectura REAL del OCR — `"N.9
  Recibo"` (dos palabras: el título ya no matchea) + `ancla_respaldo:
  "N.º Recibo"` para el caso en que el OCR sí lee el ordinal. Zona x
  0.103→0.134 para conservar el crop absoluto en 0.550 desde el INICIO de la
  etiqueta.
- `datos_emisor`: `zona_fija` → `ancla_relativa` con ancla en SU PROPIA línea:
  la frase de dos palabras `"con DNI"` (misma línea que el valor), `x_absoluto`
  (la banda conserva x 0.07..0.93 y solo la y sigue al hit) y offset vertical
  ≈ 0. Hay dos «con DNI» (emisor y pagador) → dos matches perfectos → sin
  bypass; la posición esperada desempata. Al ser misma línea, recortar no
  altera el offset. La x de «con DNI» depende del ancho del nombre previo
  (medido con perfil de tinta: ref 0.3465, variantes 0.3194 y 0.3097), así que
  el centro esperado se declara en el punto medio (0.333 → rect 0.288..0.378):
  con el valor medido de la referencia (0.360) el recorte 66 % quedaba en
  score 0.719, a una milésima del corte 0.72, solo por dx.

## Banco de verificación (2026-11-24, molde 1.3.3, Studio en 3477)

Todos con `score motor = score arnés = score genuino` y **0 falsos `ok`**:

| Imagen | Score | ok | Fallos restantes (todos honestos) |
|---|---|---|---|
| limpia `pag-01.png` | **100** | 12/12 | — |
| `recorte-60pct-usuario.png` | **75** (era 66.7) | 9/12 | título cortado de la foto; las 2 firmas bajo la cota 0.3 |
| `recorte-66pct-sin-firma.png` | **75** (era 50.0) | 9/12 | fecha de pago tachada de verdad; firmas `fallback_no_verificado` |
| `recibo-tachado.png` | **50** (era 33.3) | 6/12 | fecha/N.º/importe bajo revelado negro (ilegibles) |
| `recibo-sin-firmas.png` | **75** | 9/12 | firma ausente → `firma_ausente` (correcto); fecha de emisión ilegible |
| `recibo-datos-nuevos.png` | **75** | 9/12 | fecha de emisión ilegible; firmas al borde del umbral |
| `rotada-12.png` | **91.7** (era 66.7) | 11/12 | solo `firma_pagador` `umbral_al_borde`; el resto resuelve por ancla |

## Qué aprendimos

- Una ancla que es SUBSTRING de otra etiqueta es una bomba de tiempo: funciona
  solo mientras la geometría de referencia se mantenga.
- Declarar la lectura real del OCR (incluidos sus errores, «N.9») convierte
  una colisión en un match único; el respaldo cubre la lectura correcta.
- Nunca colgar un campo de una ancla EN OTRA LÍNEA si debe soportar recortes:
  el offset entre líneas se distorsiona con la altura normalizada. Ancla en la
  misma línea + desambiguación posicional.
- La x esperada de una frase que va después de texto variable (un nombre) no es
  estable aunque la geometría de la página lo sea: declarar el centro medido en
  el rango del banco, no el de una sola imagen.
- Sigue pendiente la decisión de motor sobre la cota 0.3 para las firmas en
  recortes fuertes (bajo el 60 % de la página) — Fase 2/5.
