# MOLDE-SPEC.md — Cómo construir un molde robusto

Manual maestro para agentes de IA (y humanos) que crean o modifican moldes de
`molde-suite`. Estable y corto por diseño: la memoria que crece vive en
`lessons/` (fichas de experimentos) y `TEMPLATES.md` (índice generado).

## 1. Antes de tocar el editor

- Identifica el tipo de documento y su variabilidad (¿todos los ejemplares
  comparten layout exacto? ¿hay variantes de plantilla/proveedor?).
- Recoge 3-5 ejemplos reales; al menos 1 debe ser "difícil" (foto de celular,
  escaneo torcido, iluminación variable).
- Decide qué campos son obligatorios y cuáles opcionales. Un campo
  obligatorio ausente manda TODA la corrida a revisión.

## 2. Herramientas disponibles y cuándo usarlas

| Herramienta | Úsala cuando | NO la uses cuando |
|---|---|---|
| Ancla de texto difusa (`ancla_relativa`) | Etiquetas legibles y únicas en el documento | Etiquetas se repiten o difieren en 1 dígito entre sí |
| Ancla + `desambiguadores` | Etiquetas vecinas parecidas ("JURADO 2"/"JURADO 4") — exige contexto cercano | No hay texto de contexto cerca de la etiqueta |
| `ancla_respaldo` | La etiqueta principal se pierde por OCR con frecuencia | — |
| Rect de referencia (`ancla.rect`) | Siempre (fallback cuando el OCR pierde la etiqueta) | Como estrategia única en documentos con variantes de layout |
| `zona_fija` | Documentos 100% rígidos (mismo layout exacto siempre) | Fotos de celular con desplazamientos |
| Grupo de campos con restricciones (pendiente — ver PLAN-DESARROLLO.md Fase 4) | Varios campos comparten banda/columna uniforme | Campos dispersos |
| Umbral por clustering (pendiente — Fase 8) | ≥3 corridas del mismo molde | Primera prueba |
| Dedupe de rects (`ancla_colision`) | AUTOMÁTICO — el motor marca colisiones | Nada que decidir: si aparece, revisa el molde |

## 3. Criterios de aprobación de un molde

- [ ] Ningún campo resuelve el mismo rect que otro (`ancla_colision` = 0 en corridas).
- [ ] Cada campo obligatorio tiene ancla + respaldo, o ancla + `desambiguadores`.
- [ ] Probado contra ≥3 ejemplos reales, incluido 1 "difícil".
- [ ] Tasa de `requiere_revision` explicable (no >20% sin causa documentada).
- [ ] Sin falsos positivos en campos críticos (firmas, totales).
- [ ] Umbral de tinta con separación clara: `max(sin tinta) < 0.5 × min(con tinta)`.

## 4. Flujo de trabajo

1. Lee `TEMPLATES.md` para ver si ya existe una plantilla similar.
2. Consulta `lessons/` por lecciones del mismo tipo de documento.
3. Diseña el molde con las herramientas de §2 (el JSON vive en
   `scripts/*.molde.json`; súbelo vía `POST /api/moldes` o el editor).
4. Ejecuta la prueba (sube el documento en Verificación o "Probar Plantilla").
5. Registra la corrida como ficha en `lessons/` (ver TEMPLATE.md).
6. Si falla un criterio de §3, vuelve con la lección como guía y repite.

## 5. Errores conocidos

Ver `lessons/INDEX.md` — sección "Patrones de fallo recurrentes". Lo más
importante: el matcher difuso solo confunde etiquetas que difieren en un
dígito (F1); para bloques numerados ("JURADO 1..4", "FILA 1..N") usa
`desambiguadores` y nunca confíes en el match difuso solo.

## 6. Notas del motor (lo que el molde puede exigir hoy)

- Estados de campo: `ok` / `no_encontrado` / `requiere_revision` — el motor
  NUNCA inventa lecturas (conf null ≠ 0.5; manuscritos `htr` siempre a revisión).
- Banderas relevantes al diseñar: `ancla_no_encontrada`, `ancla_colision`,
  `desambiguacion_fallida`, `umbral_al_borde`, `pagina_faltante`,
  `posible_pagina_equivocada`, `rotacion_180_corregida`.
- Las coordenadas son normalizadas 0-1; el motor renderiza a 1000 px de ancho.
- `desambiguadores: string[]` por campo: textos que deben aparecer por OCR a
  ≤0.3 (normalizado) del ancla para que el hit se acepte.
