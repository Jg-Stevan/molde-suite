# lessons/INDEX.md — Patrones de fallo recurrentes

Índice de las lecciones por patrón. Si un patrón aparece en ≥3 lecciones
verificadas, se sube a `MOLDE-SPEC.md` §5 como restricción dura.

## P1 — Matcher difuso acepta la etiqueta vecina (F1)

**Patrón:** bloques de etiquetas que difieren SOLO en un dígito ("FIRMA
JURADO 1..4", "FILA 1..N"). El OCR pierde la etiqueta correcta y el match
difuso (tolerancia 35% de la longitud + penalización de posición suave)
acepta la vecina con score 0.72-0.77, desplazando la zona en silencio.

**Síntomas:** campo con veredicto "ok" pero crop que muestra la etiqueta/valor
de OTRO campo; dos campos con crops idénticos.

**Mitigaciones (ya en el motor tras la conversación de mejora):**
- Penalización de dígitos ×3 en la distancia de edición (opción 1.3).
- Dedupe de rects IoU > 0.8 → bandera `ancla_colision` + `requiere_revision`
  (variante 1.1).
- `desambiguadores` por campo (opción 1.2) para exigir contexto cercano.

**Lecciones:** acta_e14/2026-11-21-cairo-fp-jurado4.md,
acta_e14/2026-11-21-frankfurt-colision-anclas.md

## P2 — Corrida sin archivo fuente (F2/N1)

**Patrón:** si la corrida se guarda sin `fuenteUrl` (ruta de upload faltante,
fallo de red), "Probar Plantilla" degrada a un no-op silencioso.

**Mitigaciones (ya implementadas):** ruta `/api/upload` POST+GET; toast
explícito cuando no hay corrida re-ejecutable; bandera one-shot que solo se
consume cuando el disparo ocurre.

## P3 — Umbral calibrado por debajo del ruido (F4/F4-1)

**Patrón:** zona vacía con ruido de papel/flash mide ratio 0.0139; si se
calibra con esa corrida, el umbral sugerido queda bajo el ruido y la firma
vacía pasa a "firmada". Dos sub-casos: (a) la vacía con flash queda ENCIMA del
corte 0.002 y el historial NO tiene ninguna vacía medida (ruido desconocido);
(b) hay vacía limpia pegada al corte JUNTO a la vacía con flash.

**Mitigaciones (ya en el motor):** `sugerirUmbral` exige
`max(sin tinta) < 0.5 × min(con tinta)` antes de sugerir (4.1) y, desde la
ronda post-verificación, NO sugiere tampoco cuando no hay NINGUNA medición ≤
0.002 (`motivo: 'sin_celdas_vacias'` — F4-1, caso (a)). El caso (b) quedó
RESUELTO por la Fase 8: `sugerirUmbralClustering` separa las clases por los
datos (k-means k=2 en log10 + brecha máxima log, ambos con las mismas
guardas y `TECHO_RUIDO = 0.02`) acumulando los ratios de TODAS las corridas
(≥ 3) — con menos corridas conserva el comportamiento anterior.

**Lecciones:** acta_e14/2026-11-21-f4-1-guarda-sin-celdas-vacias.md,
acta_e14/2026-11-21-fase8-clustering-umbral.md

## P4 — Manuscritos ilegibles (comportamiento correcto, no fallo)

Tesseract no lee escritura a mano: los campos `htr` quedan en
`requiere_revision` con conf 0-0.64. NO es un bug del molde: es la filosofía
anti-invención. No intentes "arreglarlo" bajando umbrales de confianza.

## P5 — Geometría normalizada ≠ referencia (canvas recortado/escala distinta)

**Patrón:** el documento prueba es un recorte o tiene proporción distinta de la
referencia del molde (recibo tachado: 1700×1519 vs 1700×2200). Las anclas con
match textual PERFECTO (d=0) se RECHAZAN por la penalización de posición
(`1/(1+3·(dx+dy))` con dy 0.16-0.21 → < 0.72) y el campo cae al fallback de
referencia silencioso; además, los tachones/revelados rompen la SEGMENTACIÓN
de líneas del OCR global (líneas enteras sin ancla posible).

**Síntomas:** ancla_no_encontrada con la etiqueta visiblemente impresa en la
página; 5 campos del mismo bloque central con el mismo desplazamiento;
`rescate_fallido` en todos los rescates locales.

**Mitigaciones (ya en el motor tras la corrección post-verificación):**
- Bypass posicional para match textual perfecto y único (`ancla_solo_textual`):
  la penalización solo decide entre candidatos ambiguos.
- Mapa OCR de rescate perezoso (`ancla_rescate_anti_tachon` /
  `valor_rescate_anti_tachon`): 2ª pasada OCR sobre el canvas con limpieza
  morfológica, solo si el mapa primario perdió anclas/valores.
- `ok: null` en validaciones no degrada campos individuales
  (`validacion_no_evaluable` ≠ `validacion_fallida`).

**Lecciones:** recibo_pago/2026-11-24-tachado-posicion-ancla.md

## P6 — Confianza geométrica medida con residual de modelo exacto (F5)

**Síntomas:** el arnés de proyección nunca dispara (`confProy` ≈ 0.3-0.4 pese a
anclas coherentes), 0 campos con `fuente: 'arnes'`; con 3-4 anclas el residuo
es 0 SIEMPRE (modelo exacto) y no discrimina un voto dellado de tres buenos.

**Mitigación (ya en el motor, FASE 5):** confianza = fracción de votos
soportados en leave-one-out (tolerancia `ARNES_VOTO_TOL` 0.02); el modelo
final se reajusta solo sobre votos soportados. Adopción `ok` además exige
patrón + conf OCR ≥ 0.7 (votación 2/3), nunca geometría sola.

**Lecciones:** recibo_pago/2026-11-25-arnes-loo-soporte.md

## P7 — Overlay con coordenadas de OTRA foto (procesada vs cruda)

**Síntomas:** las cajas/palabras del molde no aparecen o caen desplazadas; el
acta está RECHAZADA y el visor muestra la foto CRUDA mientras los rects fueron
normalizados sobre la PROCESADA (warp + filtro); al ampliar, el overlay
desaparece porque el visor modal no acepta capa del consumidor.

**Mitigación (Tamiz, 2026-11-25):** si hay rects que pintar
(`evaluacionMolde.campos` con `rect`/`ancla_rect`), se fuerza la foto
PROCESADA en pantalla; el visor gana la prop aditiva `overlay` montada DENTRO
del wrapper de zoom, con la caja del `<img>` medida por `ResizeObserver`
(escala/panea con la foto y se oculta al comparar el original).

**Lecciones:** recibo_pago/2026-11-25-overlay-campos-escritorio.md,
recibo_pago/2026-11-25-firma-resaltada-rotulo.md

## P8 — Ancla repetida (dos «Firma») rechazada por penalización posicional

**Patrón:** etiquetas idénticas para campos distintos (firma emisor/pagador).
En un canvas recortado verticalmente las dos etiquetas se desplazan (dy ≈
0.27); el score posicional cae < 0.72 y el bypass `solo_textual` no aplica
porque hay ≥2 matches perfectos → fallback a la banda de referencia, que en
el recorte queda a media página.

**Síntomas:** `firma_emisor`/`firma_pagador` con `fuente: 'referencia'` y rect
y ≈ 0.548 (la banda del molde) mientras las palabras «Firma» impresas están
al pie; el overlay pinta las etiquetas de firma a media página.

**Mitigación (motor v1.4.1, 2026-11-25):** desambiguación por COLUMNA — con
≥2 perfectos y score posicional bajo el corte, `ancla_solo_textual` se
concede si exactamente un perfecto cae en la columna esperada (`|dx| ≤ 0.1`)
y `|dy| ≤ 0.3`; unicidad juzgada por `dx` sobre todos los perfectos. El bypass
en campos de tinta sigue demolido a `requiere_revision`
(`ancla_sin_geometria`) — jamás un `ok` falso.

**Lecciones:** recibo_pago/2026-11-25-firma-ancla-columna.md

## P9 — Variantes del mismo papel impreso: empate de anclas y verde falso

**Patrón:** varias «variantes» (A impreso / B en blanco / C mixto) del MISMO
formulario impreso. Empatan en ratio de anclas y geometría → el router elige a
ciegas la primera fila de la biblioteca. Y las zonas `htr` calibradas solo
sobre la variante llena empiezan encima de la etiqueta impresa (`zona.x = 0`)
→ miden tinta de la impresión → VERDE falso en el formulario en blanco.

**Síntomas:** todas las fotos de una familia enrutan al mismo molde «vecino»;
formulario en blanco con bandas verdes; scores repetidos entre fotos
distintas (sonda leyendo el historial); overlay 0/0 en fotos giradas 90°
(recorte sello).

**Mitigaciones (2026-11-26):**
- Un molde por familia con unión de `htr`/`obligatorio`; semáforo de
  manuscritos por `tinta` medida (v1.5.1), nunca por lectura.
- Calibración de zonas con NEGATIVO en blanco del mismo papel (ratio ≈ 0
  requisito duro) + positivo con relleno; desplazamiento mínimo que cumple
  ambos (`scripts/entrega/validar-moldes.ts` + probe de calibración).
- Rescate con `realce` omitido en `zona_vacia` (motor): un vacío medido no
  inventa glifos.
- Banco CDP: despertar + Chrome al frente, `bringToFront` por poll, sonda
  atada al acta renderizada, enderezado con «Rotar 90°».

**Lecciones:** recibo_pago/2026-11-26-variantes-mismo-papel-tinta.md

## P10 — Multipágina: veredicto del documento como criterio de página

**Patrón:** con un molde de >1 páginas, la evaluación POR PÁGINA del bridge
corre el molde COMPLETO sobre esa foto y devuelve RECHAZADA tipo MOLDE
(faltan campos de otras páginas). Si esa señal decide si la captura se
acumula, ningún documento multipágina avanza (0/N para siempre).

**Síntomas:** progreso congelado en 0/N; «REPETIR» eterno; el lote nunca se
evalúa; una página casi vacía (rechazo físico 0.0) o un fixture válido dan
el mismo resultado.

**Mitigación (Fase 3, e4ef18b):** acumular por validez FÍSICA (foto presente,
con tinta, sin rechazo INCOMPLETA/ILEGIBLE/SIN_VOTOS/BAJO/TIMEOUT) y emitir
el veredicto UNA vez sobre el lote (`evaluarMoldeMultipagina` +
`veredictoDeResumen`). Historial: UNA fila por documento, título = nombre del
molde. Verificar historial en la MISMA sesión (es memoria de sesión; HMR lo
vacía).

**Lecciones:** app_tamiz/2026-11-25-multipagina-tamiz.md

## P11 — Layout re-escalado: medir sin cambiar el viewport

**Patrón:** cuando un componente escala su contenido para caber
(FitScale/`transform: scale`), cualquier `setDeviceMetricsOverride` entre dos
mediciones de `getBoundingClientRect()` invalida la comparación: el delta que
sale es del viewport, no del cambio de UI. Además, en un acordeón
`grid-rows-[0fr]→[1fr]` el padding del item que colapsa NO desaparece con el
`0fr` — deja una franja visible (12 px con `p-1.5`).

**Síntomas:** «no empuja la imagen» parece fallar en el e2e (`dH 29 / dW 31`)
con el bloque ya absoluto; raya del borde del panel asomando sobre la foto con
la tarjeta cerrada.

**Mitigación (FASE 4, plan rosy-meadow-swan):** fijar las métricas ANTES de
medir cerrado y abierto y mover las capturas al final; poner el inset en el
contenedor ABSOLUTO portalizado (`absolute inset-1.5`), nunca como padding del
item colapsable. Portal al visor resuelto en effect: mientras el host es `null`
el acordeón está en `0fr`, así que no hay salto de layout.

**Lecciones:** app_tamiz/2026-11-26-overlay-verificacion-documental.md

## P12 — Entorno fresco ≠ entorno probado: assets fetch() fuera del manifiesto

**Patrón:** `public/models/**` es gitignored a propósito; cualquier binario que
el motor trae con `fetch()` debe declararse en `apps/tamiz/scripts/assets.lock.json`
(URL + SHA-256). Si falta, el clon fresco degrada en silencio (cascada Tesseract)
hasta que una ruta solo-Rapid toca suelo.

**Síntomas:** `ESCANEO_FALLIDO` genérico en ~4 s con motivo real
`ppocr_keys.txt HTTP 404` en `logger.warn`; los IMPORT «sí» dan veredicto
(10-15 s vía Tesseract) — nadie se entera hasta el caso solo-Rapid.

**Mitigación (Agente A, 2026-11-26):** `ppocr_keys.txt` añadido al manifiesto
con SHA-256 fijado; la verificación de navegador §7 ahora incluye un caso SIM
solo-Rapid (detecta esta familia en 5 s).

**Lecciones:** app_tamiz/2026-11-26-ppocr-keys-404.md
