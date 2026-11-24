# Diagnóstico actual — «recibo-sin-firma prueba mas facil.png»

**Fecha:** 2026-11-24 · **Build:** worktree `molde-suite-relacional` (`feat/extraccion-relacional`, HEAD `0bc85a8`) · **Molde:** «Recibo de pago» v1.3.2
**Artefactos:** `scripts/resultados/sin-firma-facil-2026-11-24T20-13-06-100Z.json` (corrida medida) y `sin-firma-facil-cap-2026-11-24T20-1*.json` (misma imagen, corrida para capturas)
**Pruebas persistidas en Studio:** `cmwv4t8os000fwavw5r7c3ns7` · `…` (ver `_meta` de cada artefacto). Reporte leído de `GET /api/pruebas/<id>`, no del diálogo.
**Imagen:** 1700 × 1447 · recorte del **66 % superior** de la referencia (1700 × 2200) y **fecha de pago tapada con rotulador negro**. Sin firmas.

> Sin cambios de código en el repo. Todo el andamiaje (conductor, capturas) vive en `_verificacion/scratch`, fuera de git.

---

## 1. Resultado

```
score motor = 50.0      score arnés = 50.0      score_genuino = 50.0      ok 6/12
pct_lectura = 60 %      requiere_revision = true     ocr_ms 9895 · motor_ms 16955 · ocr_conf 0.93
validación fechas_coherentes: ok=null — "No evaluable: fecha ilegible en fecha_pago"
```

**Las tres puntuaciones coinciden:** ninguno de los 6 `ok` tiene banderas de no-lectura ni valor vacío. Nada inflado.

| Campo | Estado | Fuente | Valor leído | Banderas |
|---|---|---|---|---|
| `titulo` | **ok** | ancla | `RECIBO DE PAGO` | ancla_solo_textual |
| `fecha_emision` | **ok** | ancla | `11 de noviembre de 2026` | validacion_no_evaluable |
| `numero_recibo` | requiere_revision | ancla | `DE PAGO` ← **colisión** | rescate_fallido, patron_no_cumple |
| `datos_emisor` | requiere_revision | **fija** | `o a …` conf 0.23 | ocr_vacio, realce_retry, conf_baja, rescate_fallido |
| `datos_pagador` | requiere_revision | **referencia** | `Pardo Nieves, con DNI 33.2…` ← **es la emisora** | ancla_no_encontrada, fallback_no_verificado |
| `importe` | **ok** | ancla | `3.150,00 €` | ancla_solo_textual |
| `importe_texto` | **ok** | ancla | `3.150,00 € (tres mil ciento cincuenta…` | ancla_solo_textual |
| `concepto` | **ok** | ancla | `Liquidación final de obra, según contrato…` | ancla_solo_textual |
| `forma_pago` | **ok** | ancla | `Transferencia bancaria — cuenta ES21 1465…` | ancla_solo_textual |
| `fecha_pago` | requiere_revision | ancla | `—` conf 0.18 ← **tachada** | ancla_rescate_anti_tachon, rescate_fallido, conf_baja, validacion_no_evaluable |
| `firma_emisor` | requiere_revision | referencia | `true` (no fiable) | ancla_no_encontrada, forma_sin_caja, fallback_no_verificado |
| `firma_pagador` | requiere_revision | referencia | `true` (no fiable) | ancla_no_encontrada, forma_sin_caja, fallback_no_verificado |

Datos que el molde nunca vio y que leyó bien: `11 de noviembre de 2026`, `3.150,00 €`, «Liquidación final de obra, según contrato C-2026-041», «ES21 1465 0800 1290 0032 7455». El documento es de **otra persona** (Gloria Pardo Nieves / Ricardo Vega Montes) y el motor no arrastró nada de la referencia.

## 2. Geometría: recorte del 66 % superior

Ancla resuelta → despejando la traslación vertical: `Y0` = 17, 22, 11, 11, 10 px en los cinco anclas medidas ⇒ **crop = referencia desplazada ≈15 px**, cortando a `15 + 1447 = 1462 px` (66.5 %) de la página.

```
dy(y) = (y·2200 − 15)/1447 − y = 0.520·y − 0.0104
cota 0.3 en y ≈ 0.596      punto fijo en y ≈ 0.02
```

Es el recorte más suave de los probados (las anclas del tercio medio apenas se mueven: 0.163–0.195), y aun así **las firmas quedan fuera por 0.316** (`(0.627·2200−15)/1447 = 0.943`).

## 3. Causa raíz de cada fallo

### 3.1 `numero_recibo` — el ancla «Recibo» choca con el título (defecto del MOLDE)

Evidencia numérica: `titulo` y `numero_recibo` resolvieron **al mismo rectángulo** (ancla en `y = 0.081` del recorte). La captura lo muestra: los chips verde «Título del doc» y naranja «N.º de recibo» están sobre **la misma línea** («RECIBO DE PAGO»). El valor leído, `"DE PAGO"`, es la cola del título.

Causa: `ancla.texto = "Recibo"` es **subcadena literal del título** «RECIBO DE PAGO». El título gana por posición en cuanto la geometría se desplaza y no hay match único que permita el bypass. **Es un defecto de declaración del molde**, no del motor: el ancla debería ser `"N.º Recibo"` (o llevar desambiguador hacia la derecha).

**Rectificación honesta:** aquí `numero_recibo` **no** debía salir `ok` y no salió; pero además el campo `titulo` ganó `ok` con un rectángulo que también es correcto. El único daño es el fallo de `numero_recibo`, declarado.

### 3.2 `datos_emisor` — la única `zona_fija` del molde, desalineada (defecto del MOLDE)

Banda absoluta `y = 0.16…0.184` de la página. En el recorte: `0.16·1447 = 231 px` ⇒ **px 246 de la referencia**, mientras la línea de la emisora está en px 352-405. La banda cae sobre el borde inferior de la línea «N.º Recibo»: valor `"o a …"` conf 0.23, `ocr_vacio`. La captura muestra la banda naranja sobre la línea equivocada. Es el mismo defecto ya visto en el recorte anterior; aquí se confirma por segunda vía.

### 3.3 `datos_pagador` — ancla no encontrada y fallback leyendo **la fila de la emisora**

El respaldo devolvió `"Pardo Nieves, con DNI 33.2…"`: los datos de **Gloria** (emisora), no de Ricardo (pagador). El rectángulo de respaldo se dibuja sobre la línea de Gloria (visible en la captura). Estado: `requiere_revision` con `fallback_no_verificado` — **bien degradado, mal leído**. Un motor que lo hubiera marcado `ok` habría cruzado dos personas del mismo documento.

¿Por qué no ancló «Recibí de»? El desplazamiento es solo `dy ≈ 0.12`, dentro de la cota 0.3. La explicación consistente con las demás corridas es que el match textual no es perfecto (ventana «Recibí de:» con dos puntos ⇒ `scoreTextual ≈ 0.89`) y la **cota efectiva** para un match imperfecto es `scoreTextual/(1+3d) ≥ 0.72` ⇒ `d ≤ 0.078`. Con `d = 0.12` cae a `0.65`. **Es hipótesis, no medición:** el reporte no expone `scoreTextual` ni `desplazamiento` del candidato rechazado. Instrumentarlo es cambio de código (pendiente de tu OK).

### 3.4 `fecha_pago` — está literalmente tachada (comportamiento correcto)

El valor está pintado con rotulador negro en el documento (visible en la captura). El rescate anti-tachón devuelve `"—"` con conf 0.18 y el gate de fechas **se niega a evaluar**: `validacion_no_evaluable`. El motor no inventó una fecha. Exactamente lo que un sistema honesto debe hacer.

### 3.5 `firma_emisor` / `firma_pagador` — etiquetas al 94 %, fuera de cota (correcto y conservador)

Etiquetas «Firma» a `y ≈ 0.943` del recorte ⇒ `dy = 0.316 > ANCLA_TEXUAL_DESPLAZAMIENTO_MAX = 0.3` **y** ambigüedad (dos «Firma» perfectas ⇒ la regla de §254-263 no concede bypass). Sin ancla, la medición de tinta se hace en la geometría nominal de la referencia (centro de la página) y se marca `fallback_no_verificado` ⇒ `requiere_revision`. **El documento no tiene firmas** (zona en blanco): el motor dice «revisa», no «no hay firma». Es conservador, pero honesto: en el sintético sin firmas —con ancla encontrada— sí declaró `firma_ausente`/`valor=false`.

## 4. Estado actual del motor (6 imágenes, mismo build)

| Imagen | Score | Lecturas genuinas | Comentario |
|---|---|---|---|
| Completa limpia (referencia) | 100.0 | 12/12 | firmas ancladas geométricamente |
| Sintético datos nuevos (completo) | 75.0 | 9/12 | fecha mutilada → gate no evaluable |
| Sintético datos nuevos **sin firmas** | 75.0 | 9/12 | ancla hallada + `firma_ausente` ← anti-trampa clave |
| Tachado real (entrega original, corregido) | 33.3 | 4/12 | falsos positivos de firma eliminados |
| Recorte 60 % + firmas (usuario) | 66.7 | 8/12 | recita la cota 0.3 en `y≈0.595` |
| Recorte 66 % + fecha tachada (esta) | **50.0** | 6/12 | colisión «Recibo» + `zona_fija` + ancla de pagador |
| Rotada 12° | 66.7 | 8/12 | deskew aguanta; 1 firma `ok` con `forma_sin_caja` (blando) |

**Patrón:** todo lo que el motor no puede leer cae en `requiere_revision`/`no_encontrado` con bandera. **Cero falsos `ok`** en las seis. Los defectos que quedan son **de declaración del molde** (`numero_recibo` colisiona, `datos_emisor` es fija) y **de calibración de la cota** (firmas/pagador en recortes), no de OCR.

## 5. Evidencia visual (capturas del Studio)

En `_verificacion/scratch/capturas/` (fuera del repo, no se commitean):

| Archivo | Qué muestra |
|---|---|
| `sin-firma-facil-cap-pagina.png` | página procesada con las cajas: **verde** = ancla exacta, **naranja** = offset/respaldo. Se ve el título con las DOS cajas (título y recibo) en la misma línea, la banda de emisor sobre la línea equivocada, el respaldo de pagador sobre la fila de Gloria y el rectángulo de firmas en el centro de la página. |
| `sin-firma-facil-cap-datos.png` | panel «Datos variables extraídos»: los 12 valores tal como salen, incluido `—` en fecha de pago y `o a …` en emisor. |
| `sin-firma-facil-cap-anclas.png` | panel «Anclas OCR y posicionadores»: recortes forenses por campo (se ve el rectángulo negro de la fecha tachada). |
| `sin-firma-facil-cap-verificacion.png` | pantallazo completo de la pestaña Verificación. |
| `sin-firma-facil-cap-editor.png` | el molde en el Editor Visual, con zonas y anclas declaradas. |

También dejé **Molde Studio abierto en una ventana visible** (Chrome, `http://localhost:3477`, pestaña Verificación con la última corrida). Ruta manual: **Biblioteca → tarjeta «Recibo de pago» → menú ⋯ → «Probar»**.

## 6. Qué corregiría (cuando autorices tocar código)

1. **Molde** `numero_recibo`: ancla `"Recibo"` → `"N.º Recibo"` (o desambiguador). Riesgo bajo, arregla un fallo reproducido en 2 de 2 recortes.
2. **Molde** `datos_emisor`: `zona_fija` → `ancla_relativa` con faro propio (p. ej. la línea del propio nombre via `"en calidad de"`), o relativa a `"Datos del pagador"` con `dy` positiva. Es el único campo no relativo del molde y el único que falla siempre que la proporción cambia.
3. **Motor** (calibración): decidir si la cota 0.3 del bypass debe depender de la calidad del match (`scoreTextual < 1` ⇒ cota proporcionalmente menor) o si `datos_pagador`/`firmas` necesitan `ancla_relacional` con faro. Requiere instrumentar `scoreTextual`/`desplazamiento` en el reporte forense para medir antes de tocar la constante.
4. **Arnés del repo**: sigue sin poder subir imágenes (navegación a Verificación solo en el nav móvil). Las 5 capturas y estos números salen del conductor externo con el flujo equivalente.

Nada de esto se aplicó: la ronda era medir y diagnosticar.
