# TEMPLATES.md — Índice de plantillas validadas

> Generado/actualizado desde las lecciones con `resultado: exitoso` en
> `lessons/`. Cada entrada resume la receta ganadora y los límites conocidos.
> Un agente nuevo DEBE empezar aquí antes de crear un molde nuevo.
>
> **Molde único del repo:** `apps/molde-studio/templates/e14/molde-e14.json`
> (seed que carga Studio). Incluye el cuerpo calibrado histórico **y** el
> bloque `layout` v1 (28 reglas con cajas normalizadas) que alimenta el gate
> estructural de Tamiz. Las copias previas de `scripts/` se retiraron.

| Plantilla | Tipo | Estado | Receta ganadora | Límites conocidos |
|---|---|---|---|---|
| `acta_e_14_exterior_consul_embajado` | acta_e14 | validada (auditoría 2026-11-21; post-verificación) + layout v1 (2026-11-22) | ancla difusa + respaldo + rect de referencia + **desambiguadores de columna en las 4 firmas** (`JURADO 3/4/1/2` — la etiqueta de la misma columna está a ~0.07 normalizado, la de la otra banda a ~0.45, fuera del radio 0.3); umbral de tinta calibrado 0.018; validación aritmética de cierre; reglas de layout PP-DocLayout-S/plusL con clave `cajas` por regla | El matcher difuso solo confundía "JURADO 2"/"JURADO 4" cuando el OCR perdía la etiqueta (F1); con la penalización de dígitos + dedupe de rects + desambiguadores el caso cae a referencia/revisión. Manuscritos (votos, suma) SIEMPRE requieren revisión humana (HTR). Calibrar umbral exige una corrida CON la casilla vacía medida (guarda F4-1: sin vacías medidas no se sugiere nada). |

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

## Nueva vía de entrada (v3.2.0): importador Chandra

Los moldes NUEVOS ya no parten de cero: el humano entrega la SALIDA de Chandra
(datalab-convert) del documento + su matriz de obligatorios, y el importador
(Studio → Biblioteca → «Importar JSON / Chandra») la traduce a MoldeUniversal
v3.2.0 con faros (`zona_busqueda`), relaciones (`relacion`), `grupo`/`orden` y
obligatorios precargados. Esos moldes entran al índice con estado
**validando** — solo pasan a «validada» cuando Verificación ≥ 98 contra TODAS
las variantes (los pilotos actuales: `comprobante_entrega`, `recibo_pago`,
imágenes `pag-01..03` en `apps/molde-studio/public/moldes-genericos/`).
Reglas del dueño: sin botón generador, sin auto-calibración, sin búsqueda
global — el faro manda (MOLDE-SPEC §7).
