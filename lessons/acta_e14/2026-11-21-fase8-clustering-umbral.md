---
id: "motor-fase8-clustering-umbral"
plantilla: "motor (aplica a todas las plantillas con campos de presencia)"
tipo_documento: "acta_e14"
condicion: "celda vacía con flash encima del corte fijo 0.002 (caso Cairo: ratio 0.0139) junto a vacías limpias pegadas al corte"
herramientas_usadas: ["sugerirUmbralClustering", "kmeans1D", "brechaMaximaLog", "TECHO_RUIDO", "MIN_CORRIDAS_CLUSTERING"]
version_motor: "post 4d4c871 (Fase 8 del PLAN)"
resultado: "exitoso"
campos_fallidos: []
metrica: { veredictos_ok: "17/17 pruebas de Fase 8 + 17/17 de la ronda post-verificación", zonas_correctas: "—" }
---

## Problema observado

El matiz residual de F4-1 (CORRECCIONES-POST-VERIFICACION §2.2): con ratios
`[0.002, 0.0139, 0.079]` de UNA corrida, la vacía limpia pegada al corte y la
vacía con flash encima del corte pasan la guarda relativa — `minConTinta` es
el FLASH (0.0139, no un trazo) y la sugerencia 0.0097 queda POR DEBAJO del
ruido: en la próxima corrida la casilla vacía con flash pasaría a «firmada».
Simétricamente, cuando NINGUNA medición cae ≤ 0.002 el caso (a) bloquea la
calibración (`sin_celdas_vacias`) aunque el ruido real del papel SÍ haya sido
medido en otras corridas (vacías midiendo 0.003-0.006).

## Causa raíz

La clasificación de clases usaba el CORTE FIJO 0.002 como única frontera
ruido/tinta. Un corte constante no puede separar dos distribuciones cuando el
ruido real del papel cruza ese valor (flash 0.0139). La solución de fondo
(PLAN Fase 8, opción 4.1) es separar las clases POR LOS DATOS: clustering 1D
sobre los ratios acumulados de TODAS las corridas del molde.

Implementación en `universal-engine.ts` (`sugerirUmbralClustering`): dos
candidatos de corte (k-means k=2 determinista en log10 — el que prescribe el
PLAN — y brecha máxima log) pasan por LAS MISMAS guardas de honestidad
(`TECHO_RUIDO = 0.02` exportado, separación `max(bajos) < 0.5 × min(altos)`,
`sugerido > ruido máximo`). El defecto conocido de cada candidato lo atrapa
una guarda distinta: la varianza del k-means arrastra el flash a la clase de
tinta (la guarda del techo lo rechaza) y la brecha máxima partiría una tinta
bimodal sin vacías (el pre-gate y el techo lo rechazan). Si ningún candidato
pasa, NO se calibra — el rechazo total es siempre el camino seguro.

## Qué funcionó / qué no

- ✅ Caso residual exacto `[0.002, 0.0139, 0.079]` + 2 corridas más → corte
  0.0553 entre distribuciones, flash (0.0139) POR DEBAJO del umbral (prueba
  unitaria con la verificación clave explícita).
- ✅ Caso de la auditoría `[0.0139, 0.079, 0.138]` en 3 corridas → ANTES
  bloqueado por F4-1 (`sin_celdas_vacias`), AHORA calibra entre clases
  (0.0539) con el flash correctamente clasificado como ruido.
- ✅ Compatibilidad total: con < 3 corridas el comportamiento es EXACTAMENTE
  el anterior (primera corrida que sugiere gana, guardas F4/F4-1 intactas) —
  probado por regresión unitaria contra `sugerirUmbral`.
- ✅ Ratio 0 (celda totalmente limpia) entra a la clase de ruido sin romper
  el clustering (ε=1e-4 en el dominio log).
- ⚠️ Límite documentado (no defecto): campos con TODAS las mediciones por
  debajo del techo de ruido (2%) no calibran por clustering (`sin_tinta`) —
  el corpus de la auditoría no tiene trazos reales por debajo de 0.045
  (2.25× el techo); esos campos se calibran con el camino de pocas corridas
  o manualmente. `TECHO_RUIDO` es recalibrable con corpus propio.

## Recomendación para próximas plantillas

- Acumula al menos 3 corridas antes de calibrar con el botón «Sugerir
  umbral»: el toast indica el método usado (clustering con N corridas vs
  corte fijo con las que hay) y conviene calibrar con clustering.
- Si el toast de rechazo menciona el techo de ruido, el campo probablemente
  no tiene trazos reales en el corpus: verifica que la casilla esté
  diligenciada en al menos una corrida antes de calibrar.
- NO recalibres `TECHO_RUIDO` a la baja sin corpus que demuestre trazos
  legítimos por debajo de 0.02: el techo es la última barrera contra
  sugerir umbrales por debajo del ruido.
