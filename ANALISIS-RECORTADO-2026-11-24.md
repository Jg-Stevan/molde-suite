# Análisis de la corrida «recibo-completo recortado prueba molde estudio.png»

**Fecha:** 2026-11-24 · **Rama verificada:** `feat/extraccion-relacional` (worktree `molde-suite-relacional`, commits `214c5b7`…`0bc85a8`)
**Artefacto:** `scripts/resultados/recortado-usuario-2026-11-24T19-57-06-581Z.json`
**Corrida persistida en Studio:** `prueba_id = cmwv48os10007wavwvxiqz4mq` (reporte leído de `GET /api/pruebas/<id>`, NO del diálogo)
**Molde:** «Recibo de pago» v1.3.2 · **URL:** `http://localhost:3477` (instancia de verificación; tu Studio de `:3000` no se tocó)

> Ronda sin cambios de código: solo medición y análisis. El único archivo modificado fue el conductor E2E **fuera del repo** (`_verificacion/scratch/conducir-e2e.ts`), que antes no sabía navegar a Verificación (ver §7).

---

## 1. Respuesta directa: ¿la reconoce?

**Sí, y es honesta al fallar.** 8 de 12 campos leídos y validados (`score 66.7`), **con datos que el molde no ha visto nunca**:

| Campo | Valor leído | ¿Estaba en el documento de referencia? |
|---|---|---|
| `datos_pagador` | `D. Carmen Ordóñez Vidal, con DNI 52.340.9…` | **No** |
| `importe` | `2.480,50 €` | **No** |
| `importe_texto` | `2.480,50 € (dos mil cuatrocientos ochenta…` | **No** |
| `numero_recibo` | `REC-2026-0314` | **No** |
| `fecha_emision` | `03 de diciembre de 2026` | **No** |
| `fecha_pago` | `05/12/2026` | **No** |
| `forma_pago` | `Transferencia bancaria — cuenta ES76 2077…` | **No** |
| `concepto` | `Pago del 50 % de la factura F-2026-092, p…` | **No** |

Validación cruzada evaluable con esos datos nuevos:

```
fechas_coherentes  ok=true   2026-12-05 >= 2026-12-03 — coherentes
```

Los 4 restantes están **degradados y declarados**, no inventados:

```
titulo         requiere_revision  fuente=referencia  banderas=[ancla_no_encontrada, rescate_fallido, patron_no_cumple]
datos_emisor   requiere_revision  fuente=fija        banderas=[ocr_vacio, zona_vacia, realce_retry, conf_baja, rescate_fallido]
firma_emisor   requiere_revision  fuente=referencia  banderas=[ancla_no_encontrada, forma_borrosa, forma_sin_caja, umbral_al_borde]
firma_pagador  no_encontrado      fuente=referencia  banderas=[ancla_no_encontrada, forma_borrosa, forma_sin_caja, firma_ausente]
obligatorios_faltantes = [Título del documento, Datos del receptor/emisor, Firma emisor, Firma pagador]
```

## 2. Anti-trampa: los tres scores coinciden

```
score motor  = 66.7
score arnés  = 66.7     (ok_count / total, recalculado desde los estados)
score_genuino= 66.7     (descartando 'ok' con banderas de no-lectura o valor vacío)
campos_no_genuinos = []
```

En la corrida de referencia limpia el motor daba **100** y aquí **66.7**: si el motor recordara valores o estuviera fijado a zonas memorizadas, recortar la imagen no cambiaría nada. Cambia exactamente en los campos que el recorte desalinea.

## 3. Geometría medida: el recorte es una traslación vertical de 210 px

Referencia del molde: **1700 × 2200**. Tu prueba: **1700 × 1227** (mismo ancho, misma escala de píxel). Para cada campo `ancla_relativa`, el reporte da el `rect` resuelto; despejando la posición del ancla en la imagen recortada:

| Campo | Centro ancla (ref, norm) | Centro ancla (medido en el recorte) | dy | Cómo se resolvió |
|---|---|---|---|---|
| `datos_pagador` | 0.248 | 0.276 | 0.027 | ancla geométrica |
| `numero_recibo` | 0.125 | 0.053 | 0.072 | bypass solo-texto |
| `fecha_emision` | 0.104 | 0.007 | 0.097 | ancla geométrica |
| `importe` / `importe_texto` | 0.329 | 0.420 | 0.091 | bypass solo-texto |
| `concepto` | 0.378 | 0.508 | 0.130 | bypass solo-texto |
| `forma_pago` | 0.462 | 0.657 | 0.195 | bypass solo-texto |
| `fecha_pago` | 0.487 | 0.699 | 0.212 | bypass solo-texto |
| `firma_emisor` / `firma_pagador` | 0.627 | **0.953** (esperable) | **0.326** | **rechazada** |
| `titulo` | 0.061 | — | — | ancla **fuera de la imagen** |

`Y0` implícita en los 7 anclas resueltas: **209, 210, 219, 208, 211, 213, 209 px** — idéntica en todos. Conclusión: el recorte no escala, **desplaza 210 px hacia arriba** y corta abajo a 1437 px de la referencia (`210 + 1227`). Es decir: se perdió todo lo que está por debajo del **65 %** de la página y la cabecera hasta el **9.5 %**.

La consecuencia es analítica, no empírica. Si `y` es la posición normalizada en la referencia, en el recorte esa misma línea cae en `(y·2200 − 210)/1227`, así que el desplazamiento es

```
dy(y) = 0.7929·y − 0.1712
```

* `dy = 0` en `y ≈ 0.216` (punto fijo de la transformación: ahí el recorte no engaña).
* **`dy` cruza la cota `ANCLA_TEXUAL_DESPLAZAMIENTO_MAX = 0.3` en `y ≈ 0.595`.**

Con esta proporción de recorte, **cualquier ancla por debajo del 60 % de la página es matemáticamente inviable** por la regla actual. `titulo` (0.054 → 134 px) y las `firma` (0.627 → 1379 px) son los dos casos límite, uno por arriba y otro por abajo.

## 4. Causa raíz de cada fallo

### 4.1 `titulo` — el ancla ya no existe en la imagen (correcto)

Ancla declarada `"RECIBO DE PAGO"` a `y = 0.054` (px 119-150 de la referencia). El recorte empieza en px 210: **el título está físicamente cortado**. El motor no lo encuentra → `ancla_no_encontrada` → `rescate_fallido` → `patron_no_cumple` → `requiere_revision`, y el valor que muestra (`"N.9 Recibo: REC-2026-0314"`) es el residuo del fallback `referencia` marcado como no fiable. **No lo vendió como ok.** Comportamiento esperado.

### 4.2 `datos_emisor` — defecto real del molde: es el único campo `zona_fija`

```
datos_emisor: estrategia=zona_fija, zona={x:0.07, y:0.16, w:0.86, h:0.024}
```

Una banda absoluta solo es correcta si la página tiene la proporción de la referencia. En el recorte, `y = 0.16` de 1227 px = px 196 → **px 406 de la referencia**, mientras que la línea de datos del emisor vive en px 352-405. La banda cae 50 px más abajo, sobre el blanco entre líneas:

```
crop_dims = [872, 21]  banderas=[ocr_vacio, zona_vacia, realce_retry, conf_baja, patron_no_cumple, rescate_fallido]
valor = "A"  conf = 0.00
```

Es decir: **OCR vacío, relleno degenerado de una letra, y declarado no fiable**. Este es el único fallo que no es "culpa del recorte" sino del molde: es el campo que quedó fuera de la conversión a anclas del FASE 1b. Convertirlo a `ancla_relativa` (faro propio, o relativo a `"Recibí de"` con `dy` negativo) lo haría recorte-tolerante igual que los otros seis. *No lo he tocado: pediste no modificar código.*

### 4.3 `firma_emisor` / `firma_pagador` — doble bloqueo en `buscarAncla`

Las dos etiquetas impresas `"Firma"` **sí están en la imagen** (px 1379 de la referencia → `y ≈ 0.953` del recorte, 58 px sobre el borde inferior). No se usan por dos motivos que se acumulan, ambos en `packages/scanner-core/molde/universal-engine.ts:248-269`:

1. **Regla de ambigüedad** (líneas 254-263): hay **dos** ventanas con match textual perfecto, así que `perfectos.length !== 1` y el bypass posicional no se concede — es la corrección que cerró el falso positivo de las firmas en la corrida tachada; aquí actúa en contra.
2. **Cota** (línea 261): aunque hubiera una sola, `desplazamiento = 0.326 > 0.3` → bypass rechazado igualmente.

Sin bypass entra la puntuación con penalización posicional `score *= 1/(1+3d)` → `1/(1+0.978) = 0.506 < ANCLA_SCORE_MIN = 0.72` → **ancla_no_encontrada**.

Y aquí está lo importante para leer el reporte: al no haber ancla, la medición de tinta se hace en la **zona nominal de la referencia** (`rect y = 0.548` del recorte = px 882 de la referencia, el centro de la página, sobre las líneas impresas de concepto/forma de pago). Por eso:

* `firma_emisor` → `valor=true` **pero** `forma_borrosa`, `forma_sin_caja`, `umbral_al_borde` → midió tinta de texto impreso, no una rúbrica.
* `firma_pagador` → `valor=false`, `firma_ausente` → tampoco fiable.

**Las banderas son correctas y el estado también** (`requiere_revision` / `no_encontrado`), pero el booleano `valor` de las firmas en un recorte fuerte es ruido: no debe interpretarse como "aquí no hay firma". La firma está; lo que falta es el ancla.

## 5. Diagnóstico en una frase

El motor **no falló por falta de OCR** (`ocr_conf = 0.93`, `ocr_ms = 9344`, `motor_ms = 8631`): falló por **geometría declarada**, y en 3 de los 4 casos lo hizo bien — degradó y declaró en vez de fingir. El único defecto neto es `datos_emisor` (`zona_fija`); el resto es el comportamiento esperado de la cota de 0.3, que con este recorte corta en `y ≈ 0.595`.

## 6. Qué probaría cada hipótesis (sin cambiar código aún)

| Prueba | Hipótesis | Qué esperaría ver |
|---|---|---|
| Recorte **horizontal** (mismo alto, ancho partido) | la cota penaliza `dx+dy`, no solo vertical | fallos desplazándose a los anclas de la derecha/izquierda |
| Recorte que conserve título y firmas, corte el centro | no hay memoria de valores | campos centrales `no_encontrado`, resto `ok` |
| Misma imagen **redimensionada** (escala ≠ 1, sin corte) | `zona_fija` falla por proporción; las anclas no | `datos_emisor` roto otra vez, anclas ok |
| Rotación pequeña (se está corriendo) | el deskew recupera anclas | si las anclas caen, el fallo es de orientación, no de recorte |
| Documento **sin firmas** (en cola) | `firma_ausente` con ancla presente | `ancla` encontrada + `forma_sin_caja` = señal limpia de ausencia real |

## 7. Hallazgo de método (esta ronda)

El arnés commiteado `scripts/verificar-molde.ts` **no puede subir una imagen nueva**: la pestaña Verificación se monta con `dynamic()` (`src/app/page.tsx:52`) y su botón vive solo en el nav móvil (`md:hidden`, `src/app/page.tsx:249`), así que `input[type="file"]` del Editor era el único visible y el pipeline nunca arrancaba (de ahí los "timeout" de tandas anteriores). Lo confirmé y lo esquivé en el conductor externo estrechando el viewport a 700 px, pulsando *Verificación* y seleccionando el input propio (`input[type="file"][multiple][accept*="heic"]`). **La misma corrección hace falta en el arnés del repo**, y eso es tocar código: queda pendiente de tu OK.

## 8. Veredicto

* ¿Reconoce tu recorte? **Sí, 8/12 campos con datos completamente nuevos y una validación de fechas evaluada sobre ellos.**
* ¿Hace trampa fijando zonas o recordando datos? **No**: el score cae 100 → 66.7 bajo recorte, los campos que salen son los nuevos, ningún valor sospechoso aparece en código ni en el molde, y todo lo no fiable está marcado con bandera y `requiere_revision` en lugar de `ok`.
* ¿Dónde falla realmente? **`datos_emisor`** (estrategia `zona_fija`, la única no relativa del molde) y **las dos firmas** (ancla a `dy = 0.326`, por encima de la cota 0.3 y además ambigua porque hay dos etiquetas "Firma").

---

## 9. Corridas de control del mismo build (hipótesis de §6 ejecutadas)

Cuatro artefactos nuevos, todos leídos de la corrida **persistida** (`GET /api/pruebas/<id>`), con `_meta` y score del arnés recalculado. En ninguno `score motor ≠ score arnés ≠ genuino`: **cero campos hinchados**.

| Imagen | Prueba | Score (motor=arnés=genuino) | Artefacto |
|---|---|---|---|
| Recorte del usuario (1700×1227) | `cmwv48os10007wavwvxiqz4mq` | 66.7 · 8/12 | `recortado-usuario-…T19-57-06.json` |
| Sintético con datos nuevos, **sin firmas** | `cmwv4e8pa0009wavwytdr4g74` | **75.0 · 9/12** | `sin-firmas-…T20-01-25.json` |
| Sintético con datos nuevos, completo | `cmwv4fock000dwavwjoodsbi0` | **75.0 · 9/12** | `sintetico-nuevos-…T20-02-32.json` |
| Recibo real **rotado 12°** | `cmwv4f583000bwavw5u5247bj` | 66.7 · 8/12 | `rotada-12-…T20-02-07.json` |

### 9.1 Sin firmas → el sistema dice «no hay firma» (la prueba anti-trampa decisiva)

Documento sintetizado con datos que el molde jamás vio (`D. Marcos Peña Soto`, `D. Lucía Fernández Ríos`, `REC-9999-1234`, `999,99 EUR`, `Bizum`, `01/07/2027`) y la zona de rúbricas **borrada en blanco**:

```
firma_emisor   no_encontrado  fuente=ancla  conf=0.97  banderas=[forma_borrosa, forma_sin_caja, firma_ausente]  valor=false
firma_pagador  no_encontrado  fuente=ancla  conf=0.97  banderas=[forma_borrosa, forma_sin_caja, firma_ausente]  valor=false
```

**El ancla se encontró (fuente `ancla`, conf 0.97) y aun así declaró `firma_ausente`.** Es exactamente el patrón que la corrida tachada de la entrega no producía (allí ambas firmas salían `ok` con conf 0.97 en el mismo rect: falso positivo). Aquí, con la tinta ausente, el booleano es `false` y el estado `no_encontrado`: mide, no memoriza.

Y refuerza §4.2: `datos_emisor` sale **`ok`** (`fuente=fija`, conf 0.96, sin banderas) en cuanto la imagen conserva la proporción de la referencia → su fallo en el recorte es **solo** la banda absoluta, no el OCR.

### 9.2 Fecha ilegible → la validación se niega a puntuar

En los dos sintéticos, `fecha_emision` se leyó mutilada (`"de 2027"`, sin día):

```
fecha_emision  requiere_revision  banderas=[rescate_fallido, patron_no_cumple, validacion_no_evaluable]
fecha_pago     ok                 banderas=[ancla_solo_textual, validacion_no_evaluable]
```

`fechas_coherentes` queda **`validacion_no_evaluable`** en vez de `ok`: sin una fecha parseable la regla no regala un aprobado. En el recorte del usuario, en cambio, sí se evaluó (`2026-12-05 >= 2026-12-03`, ok) con datos nuevos.

### 9.3 Rotación 12° → el deskew aguanta las anclas pero degrada 3 campos

```
titulo, fecha_emision (rescate_anti_tachon), importe, importe_texto, concepto, forma_pago, fecha_pago, firma_emisor → ok
numero_recibo    requiere_revision  [rescate_fallido, patron_no_cumple]  valor="PAGO"
datos_emisor     requiere_revision  [rescate_fallido, patron_no_cumple]  valor="N.9 Recibo: REC-2026-0314"
datos_pagador    requiere_revision  fuente=referencia  conf=0.35  valor="1D UA 10D UTA Uy DUI UU LS US"
```

Buena noticia: **7 de los 10 campos de texto se siguen anclando** con 12° de alabeo (deskew ON) y el valor recuperado de `fecha_emision` es correcto. Mala noticia honesta: `datos_pagador` se va a fallback con basura OCR (`ocr_vacio`) y **degradado a `requiere_revision`**, no colado como acierto.

**Residuo de severidad que sí deberías conocer:** `firma_emisor` en la rotada queda **`ok`** con banderas `[forma_borrosa, forma_sin_caja]` y `firma_pagador` `requiere_revision` con `umbral_al_borde`. `forma_sin_caja` no está en `BANDERAS_NO_LECTURA` del arnés, y `endurecerFallbackNoVerificado` solo anula la tinta sin geometría cuando `fuente === 'referencia'` (`universal-engine.ts:1696`). Con ancla encontrada, una firma "sí" medida sin caja sigue contando como acierto. Es blando, y en un documento rotado no puedo afirmar que la rúbrica estuviera ahí. Corrección candidata (una línea en `BANDERAS_NO_LECTURA` del arnés + extender el endurecedor a `fuente === 'ancla'` cuando falte la caja): **pendiente, no la apliqué por tu instrucción de no tocar código**.

### 9.4 Lo que NO queda probado

* Rotaciones mayores (20°, 45°) y documentos multi-página con este mismo recorte.
* Recorte **horizontal** (la hipótesis de `dx` en §6 sigue sin medir; el artefacto lo permite sin tocar motor).
* El arnés del repo sigue roto para subir imágenes nuevas (§7): los números de esta sección salen del conductor externo, que implementa el flujo equivalente pero con la navegación corregida.
