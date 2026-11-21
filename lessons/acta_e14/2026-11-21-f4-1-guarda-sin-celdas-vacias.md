---
id: "acta_e14-f4-1-guarda-sin-celdas-vacias-2026-11-21"
plantilla: "acta_e_14_exterior_consul_embajado"
tipo_documento: "acta_e14"
condicion: "zona de firma vacía con flash (ratio 0.0139) usada para calibrar umbral"
herramientas_usadas: ["sugerirUmbral", "guarda_separacion_clases", "pruebas_unitarias_bun"]
version_motor: "post-verificación 2026-11-21 (sugerirUmbral con motivo)"
resultado: "fallo_precision"
campos_fallidos: ["sugerirUmbral (herramienta de calibración, no campo de corrida)"]
metrica: { veredictos_ok: "n/a", zonas_correctas: "n/a" }
---

## Problema observado

El informe de verificación (§6.1, severidad media) demostró con prueba unitaria
que la guarda 4.1 (`max(sinTinta) < 0.5 × min(conTinta)`) no cubre el caso que
motivó F4 en la auditoría: una zona vacía con flash mide **0.0139**, supera el
corte fijo 0.002 y queda clasificada como "con tinta". Con ratios
`[0.0139, 0.079, 0.138]` la función sugería **0.0097** — el valor exacto que el
informe de la auditoría señalaba como por debajo del ruido. La frase del
RESUMEN-IMPLEMENTACION («la zona vacía con flash 0.0139 ya no puede calibrar un
umbral bajo el ruido») sobreafirmaba lo que la variante 4.1 logra.

## Causa raíz

Matemática, verificada contra el código: `sinTinta` se define como ratios ≤
0.002, así que `maxSinTinta ≤ 0.002` siempre. Si TODAS las mediciones quedan
encima del corte (la vacía con flash entra como "con tinta"), `sinTinta` queda
VACÍA, `maxSinTinta` es `null`, la guarda relativa no dispara (se evaluaba solo
con `maxSinTinta !== null`) y la sugerencia salía con un piso de ruido
desconocido. La guarda 4.1 solo puede disparar con `min(conTinta) ≤ 0.004`.

## Qué funcionó / qué no

- ✅ Guarda relativa 4.1 para el caso entrelazado (0.002 / 0.0035) — intacta.
- ❌ Guarda relativa sola para el caso flash sin vacías medidas — sugería
  `minConTinta × 0.7` (0.0097 con 0.0139).

## Recomendación para próximas plantillas

Sin NINGUNA medición ≤ 0.002 en el historial del campo, el piso de ruido real
es desconocido: NO calibrar. `sugerirUmbral` ahora devuelve
`motivo: 'sin_celdas_vacias'` y la UI pide correr una verificación con la
casilla vacía. Residual honesto: una vacía limpia pegada al corte JUNTO a una
vacía con flash encima del corte (`[0.002, 0.0139, 0.079]`) aún pasa la guarda
relativa — solo el clustering multi-corrida (PLAN Fase 8, variante 4.2) lo
resuelve de fondo. Corrección y evidencia: CORRECCIONES-POST-VERIFICACION.md §2.2
y `tests/correcciones-post-verificacion.test.ts` (17/17).
