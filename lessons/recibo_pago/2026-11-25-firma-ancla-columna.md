# lessons/recibo_pago/2026-11-25-firma-ancla-columna.md — ficha de lección

---
id: "recibo_pago-escritorio-2026-11-25-firma-ancla-columna"
plantilla: "recibo_pago v1.4.0 (moldes-genericos y tamiz/public/moldes); motor feat/arnes-geometrico"
tipo_documento: "recibo_pago"
condicion: "foto celular RECORTADA (recorte-66pct-sin-firma.png: etiquetas «Firma» al pie y≈0.90 vs referencia del molde y≈0.622); comparación con recibo-datos-nuevos.png (sin recorte), rotada-12.png, recibo-tachado.png y recibo-sin-firmas.png"
herramientas_usadas: ["ancla_relativa", "buscarAncla", "ancla_solo_textual", "endurecerFallbackNoVerificado"]
version_motor: "scanner-core v1.4.1 (ANCLA_COLUMNA_DX_MAX) + Tamiz overlay de palabras"
resultado: "exitoso"
campos_fallidos: ["firma_emisor", "firma_pagador"]
metrica: { veredictos_ok: "recorte-66: 0/2 firmas (correcto: sin rúbrica); datos-nuevos/rotada/sin-firmas sin cambio", zonas_correctas: "2/2 firmas ahora en el pie (top 81.2-82.9%) en recorte-66 y tachado" }
---

## Problema observado
En el escritorio (Tamiz :3100) las palabras del overlay «Firma emisor
(receptor)» y «Firma pagador» aparecían a media página (top ≈ 54.8 %), sobre
la línea «En concepto del pago», mientras las etiquetas «Firma» impresas
estaban al pie (y ≈ 0.90 en `recorte-66pct-sin-firma.png`). Medido en el DOM:
`[data-testid="campo-palabra"]` con `top: 54.8%` exacto en ambas firmas =
`ancla.rect.y 0.622 − zona.y 0.074` (fallback de referencia del molde).

## Causa raíz
`buscarAncla` exige score posicional ≥ 0.72 y el bypass `solo_textual` solo se
concedía con UN match perfecto «Firma» en toda la página. El molde tiene DOS
etiquetas idénticas (izquierda y derecha) → `perfectos.length === 2` → bypass
denegado; con dy ≈ 0.27 el score `1/(1+3·(dx+dy))` ≈ 0.54 → ancla rechazada →
`fuente: 'referencia'` en la banda guardada (0.548). En un canvas recortado
esa banda cae a media página. La x esperada de cada campo (0.268 / 0.689)
desambigua perfectamente, pero el motor no la usaba con más de un perfecto.

## Qué funcionó / qué no
- ✅ Desambiguación por COLUMNA en `buscarAncla` (v1.4.1): con ≥2 perfectos y
  score posicional bajo el corte, se concede `ancla_solo_textual` si
  EXACTAMENTE UN perfecto cae en la columna esperada (`|dx| ≤ 0.1`,
  `ANCLA_COLUMNA_DX_MAX`) con `|dy| ≤ 0.3`. La unicidad se juzga por `dx`
  sobre TODOS los perfectos: dos copias en la misma columna siguen ambiguas
  (test guardián del falso positivo intacto).
- ✅ `endurecerFallbackNoVerificado` ya demuele `ancla_solo_textual` en campos
  de tinta (`ancla_sin_geometria` → `requiere_revision`): el bypass solo
  mejora la GEOMETRÍA del overlay/medición, jamás produce un `ok` falso.
- ✅ Re-verificado en escritorio con fotos reales: recorte-66 (81.2 %, rojo —
  sin rúbrica, ahora `no_encontrado`), tachado (82.9 %, ámbar, ancla directa
  en vez de arnés), datos-nuevos/rotada/sin-firmas sin cambio de posición.
- ❌ Tentación descartada: tocar `ancla.rect` del molde — la referencia
  (y 0.622) es correcta para el escaneo del molde; el desplazamiento es del
  recorte de la foto, no del molde.

## Recomendación para próximas plantillas
- Etiquetas repetidas («Firma» x2, «Firma del comprador» x2) en campos
  distintos: la desambiguación debe ser por columna esperada (`|dx| ≤ 0.1`)
  cuando el texto no distingue, nunca por "el más cercano" sin unicidad.
- Un overlay que muestre posiciones debe cruzar el `fuente` del campo: si es
  `referencia` + `ancla_no_encontrada`, la caja está en la banda guardada del
  molde — puede no coincidir con la foto recortada. La verdad geométrica es la
  ancla encontrada (o el arnés), no la referencia.
- Prueba rápida: importar un recorte vertical fuerte (66 %) y verificar que
  las firmas siguen al pie; comparar `top` de las palabras contra la etiqueta
  impresa en la foto.
