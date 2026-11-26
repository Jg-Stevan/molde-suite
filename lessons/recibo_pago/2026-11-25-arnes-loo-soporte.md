# lessons/recibo_pago/2026-11-25-arnes-loo-soporte.md — ficha de lección

---
id: "recibo_pago-campo-2026-11-25-arnes-loo"
plantilla: "recibo_pago v1.4.0 (BD sincronizada vía PUT /api/moldes)"
tipo_documento: "recibo_pago"
condicion: "foto recortada con revelados (recibo-tachado.png 1700×1519), referencia limpia (pag-01.png) y rotada 12° — Studio real end-to-end, corrida persistida"
herramientas_usadas: ["ancla_texto_fuzzy", "ancla_solo_textual", "arnes_afin_LOO", "cajas_seal", "votacion_2de3", "letras_a_numero"]
version_motor: "scanner-core feat/arnes-geometrico (FASE 5-6: proyectarPorArnes + repararCruceNumeroLetras)"
resultado: "exitoso"
campos_fallidos: ["fecha_emision (revelado real)", "dni_emisor", "nombre_emisor? no — ok", "importe (conf 0.20 < 0.7 → revisión, honesto)"]
metrica: { veredictos_ok: "7/12 tachado · 12/12 limpia · 11/12 rotada", zonas_correctas: "4 campos fuente 'arnes' en tachado; rects de firmas DISTINTOS (y 0.931 vs 0.758)" }
---

## Problema observado
El arnés de FASE 5 (proyección afín desde ≥3 anclas) NUNCA disparaba en la
imagen del diagnóstico: la primera versión medía la confianza con la
DISPERSIÓN DEL RESIDUAL del ajuste y reportaba `confProy ≈ 0.382`
(< `ARNES_CONF_PROY_MIN` 0.8) sobre anclas perfectamente coherentes, así que
`proyectarPorArnes` devolvía 0 rescates y el tachado se quedaba en 50.

## Causa raíz
Con N pares de puntos y un modelo que tiene exactamente 6 grados de libertad
(afín completo) y N = 3, el ajuste es EXACTO por construcción: residual 0
siempre, incluso con un voto dellado (esquina intercambiada). La dispersión
de residuo no discrimina nada con el mínimo de votos y, con recortes a otra
escala, los residuos legítimos crecen y hunden la confianza de un arnés que
sí era correcto (medido en el artefacto real: dy proyectados 0.480 correctos
con conf 0.382).

## Qué funcionó / qué no
- ✅ Leave-one-out: predecir el rect de cada ancla con el modelo AJUSTADO SIN
  ELLA y contar como «soportado» el voto cuyo residual normalizado ≤ 0.02
  (`ARNES_VOTO_TOL`). `confProy = votos_soportados / votos`. En el tachado
  real: 0.833 → el arnés dispara. El modelo final se REAJUSTA solo sobre los
  votos soportados (un ancla delada no deforma la proyección).
- ✅ Adopción exigente: campo rescatado solo `ok` con geometría + patrón +
  conf OCR ≥ 0.7 (votación 2/3). `importe_texto` salió `ok` con valor EXACTO
  (conf 0.77); `importe` (tachado, conf 0.20) quedó `requiere_revision` con
  banderas honestas — ningún `ok` falso en la corrida.
- ✅ Cajas `seal`: firma_emisor/firma_pagador recibieron rects distintos
  (y 0.931 / 0.758) — el falso histórico «dos firmas ok en el mismo rect»
  queda imposible por construcción cuando el layout provee las cajas.
- ✅ No-regresión: limpia 100 (genuino 83.3, idéntico al baseline re-puntuado
  con `metricas()` actuales) y rotada-12 91.7 (igual al banco 1.3.3). El
  arnés no tocó ninguna de las dos (0 campos `arnes` en documentos con anclas).
- ❌ Intento previo con residuo del ajuste global: inválido para modelos exactos.
- ❌ `repararNumeroAmbiguo` sin cruce letras: rechazado por diseño (no se
  activó en estas corridas — sin falsos positivos).

## Recomendación para próximas plantillas
Nunca usar el residual de un ajuste como confianza cuando el modelo es exacto
para el número mínimo de puntos (afín con 3, homografía con 4): usar soporte
leave-one-out con tolerancia (0.02 del ancho/alto normalizado) y reajustar el
modelo sobre los votos soportados. Y mantener la cota dura: proyección
geométrica sola NO otorga `ok`; hacen falta patrón y conf de lectura.
