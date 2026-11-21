---
id: "acta-e14-consulado-elcairo-2026-11-21"
plantilla: "acta_e_14_exterior_consul_embajado"
tipo_documento: "acta_e14"
condicion: "PDF escaneado limpio, 2 páginas, con flash"
herramientas_usadas: ["ancla_texto_fuzzy"]
version_motor: "pre-F1-fix (auditoría)"
resultado: "fallo_precision"
campos_fallidos: ["firma_jurado_4"]
metrica: { veredictos_ok: "11/12", zonas_correctas: "10/12" }
---

## Problema observado

El campo `firma_jurado_4` reportó `True · ok · conf 0.97` cuando la zona real
del jurado 4 estaba VACÍA (sin firma). El rect resuelto fue `y=0.845`
(posición de la etiqueta del jurado 2) en vez de `y≈0.92`. El crop guardado
del "jurado 4" contiene literalmente la firma y el nombre del jurado 2
(verificado con inspección visual independiente).

## Causa raíz

El OCR no leyó la etiqueta "FIRMA JURADO 4" (las etiquetas "FIRMA JURADO N:"
se pierden con frecuencia). El matcher difuso aceptó la etiqueta vecina
"FIRMA JURADO 2":

```
score_textual = 1 - 1/13 = 0.923
penalización de posición (dy≈0.066) = 1/(1+3·0.067) ≈ 0.83
score final ≈ 0.765  >  0.72 (ANCLA_SCORE_MIN)  →  ACEPTADO
```

Nadie detectó que dos campos distintos podían terminar midiendo rects
distintos pero equivocados.

## Qué funcionó / qué no

- ❌ `ancla_texto_fuzzy` sola: confunde etiquetas que difieren en 1 dígito
  cuando el OCR pierde la correcta.
- ✅ El resto de firmas (J1-J3) midió bien al caer a `referencia` cuando su
  ancla falló: el rect de referencia del molde apunta a la zona correcta.
- ✅ Caso El Cairo Transmisión J4 (misma plantilla): la zona correcta midió
  ratio 1.39% vs umbral 1.8% y el motor marcó `requiere_revision` por
  `umbral_al_borde` — comportamiento honesto correcto.

## Recomendación para próximas plantillas

Para cualquier bloque de N etiquetas que solo difieren en un dígito:
declarar `desambiguadores` (contexto cercano exigido) y NO confiar en el
matcher difuso solo. Tras la conversación de mejora el motor ya penaliza la
sustitución dígito→dígito ×3 y detecta colisiones IoU > 0.8 — ese mismo
match hoy puntúa ~0.64 y cae al rect de referencia (zona correcta, sin falso
positivo).
