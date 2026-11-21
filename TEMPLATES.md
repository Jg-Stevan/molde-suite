# TEMPLATES.md — Índice de plantillas validadas

> Generado/actualizado desde las lecciones con `resultado: exitoso` en
> `lessons/`. Cada entrada resume la receta ganadora y los límites conocidos.
> Un agente nuevo DEBE empezar aquí antes de crear un molde nuevo.

| Plantilla | Tipo | Estado | Receta ganadora | Límites conocidos |
|---|---|---|---|---|
| `acta_e_14_exterior_consul_embajado` | acta_e14 | validada (auditoría 2026-11-21; post-verificación) | ancla difusa + respaldo + rect de referencia + **desambiguadores de columna en las 4 firmas** (`JURADO 3/4/1/2` — la etiqueta de la misma columna está a ~0.07 normalizado, la de la otra banda a ~0.45, fuera del radio 0.3); umbral de tinta calibrado 0.018; validación aritmética de cierre | El matcher difuso solo confundía "JURADO 2"/"JURADO 4" cuando el OCR perdía la etiqueta (F1); con la penalización de dígitos + dedupe de rects + desambiguadores el caso cae a referencia/revisión. Manuscritos (votos, suma) SIEMPRE requieren revisión humana (HTR). Calibrar umbral exige una corrida CON la casilla vacía medida (guarda F4-1: sin vacías medidas no se sugiere nada). |

## Receta de la plantilla acta_e14 (resumen de lecciones)

- 21 campos, 4 firmas, 15 en pág. 1 y 6 en pág. 2, todas `ancla_relativa`
  con `ancla.rect` de referencia.
- Firmas: umbral 0.018 con banda de indeterminación 0.6x–1.4x →
  `requiere_revision` en el borde (honesto por diseño). Post-verificación
  (O2): `desambiguadores` en las 4 firmas — el contexto es la etiqueta de la
  MISMA columna (J1↔J3, J2↔J4); un hit en la otra banda cae a
  respaldo/referencia con `desambiguacion_fallida`.
- Divipol (consul/país/zona/puesto/mesa): patrón anclado + `limpiar_valor`.
- Cierre aritmético: `suma_total == votos_*` — degrada a "no evaluable" si
  falta cualquier operando.

## Cómo agregar una entrada

Termina una lección con `resultado: exitoso` en `lessons/<tipo>/` y añade la
fila aquí con: plantilla, tipo, estado, receta (herramientas de MOLDE-SPEC §2
que funcionaron) y límites (dónde NO probarla).
