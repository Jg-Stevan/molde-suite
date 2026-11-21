# PLAN DE DESARROLLO — molde-suite (de la conversación de mejora)

**Origen:** análisis de la conversación DeepSeek (sesión 2026-11-21) sobre la auditoría técnica de `Jg-Stevan/molde-suite`.
**Estado de este documento:** FASES 1-2 IMPLEMENTADAS y verificadas E2E (ver RESUMEN-IMPLEMENTACION.md). RONDA POST-VERIFICACIÓN aplicada (D1, F4-1, O1-O3 — ver CORRECCIONES-POST-VERIFICACION.md). FASES 3-9 son propuestas pendientes de autorización.
**Regla de subida:** ningún cambio se sube al repo sin autorización explícita del dueño.

---

## Fase 1 — P0/P1 de la tabla de priorización (IMPLEMENTADO ✅)

La conversación priorizó 8 ítems de corrección inmediata. Todos implementados:

| # | Problema | Variante | Estado | Evidencia |
|---|---|---|---|---|
| 1 | **N1** no-op silencioso de "Probar Plantilla" | Toast cuando no hay re-ejecutable | ✅ | E2E: toast "No hay ninguna corrida con archivo fuente guardado" + navegación |
| 2 | **F2** ruta `/api/upload` ausente | 2.1 Route Handler (formData → disco) | ✅ | E2E: POST→201+URL, GET→200 bytes idénticos, 400/415/404 según contrato |
| 3 | **F1** colisión de anclas | 1.1 dedupe de rects (IoU > 0.8 → `ancla_colision`) | ✅ | Motor: `marcarColisiones()` por página; unitario del mecanismo en RESUMEN |
| 4 | **N4** re-ejecución incondicional | comparar `updatedAt` antes de disparar | ✅ | E2E: toast "La corrida ya está al día" + corrida sin re-correr |
| 5 | **N3** bandera consumida al abortar | consumir SOLO cuando el disparo ocurre | ✅ | `reejecutarCorrida(corrida, { consumirBandera })`; guardas no consumen |
| 6 | **F1** causa raíz | 1.2/1.3 Levenshtein ponderado con dígitos | ✅ | Unitario: caso auditoría 0.765→0.651 (< 0.72 RECHAZADO); vivo: J4→referencia |
| 7 | **N2** `erroresMolde` en guardado implícito | unificar rutas de guardado | ✅ | `guardarMoldeActual` valida antes del PUT; "Probar" aborta si falla |
| 8 | **F3/F4** telemetría y calibración | 3.1 propagación render_ms / 4.1 separación de clases | ✅ | E2E: `render_ms: 24/7` en corridas reales; `sugerirUmbral` exige `maxSinTinta < 0.5·minConTinta` |

Extra incluido (F5 cosmético de la auditoría): placeholder de regex `\d{3}` con escape correcto.

## Fase 2 — Sistema de conocimiento para agentes (IMPLEMENTADO ✅)

Estructura §10 de la conversación, en la raíz del repo:

```
AGENTS.md          # ~8 líneas: reglas de entrada para cualquier agente
MOLDE-SPEC.md      # manual maestro (~100 líneas): herramientas, criterios de aprobación, flujo
TEMPLATES.md       # índice de plantillas validadas (E-14 como primera entrada)
lessons/
  INDEX.md         # patrones de fallo recurrentes (P1-P4)
  TEMPLATE.md      # ficha de lección (frontmatter + causa raíz + evidencia)
  acta_e14/        # 2 lecciones reales de la auditoría (Cairo FP J4, Frankfurt colisión)
```

## Fase 3 — Opción 1.1 de la conversación: múltiples anclas con voto (PENDIENTE)

`Ancla[]` con prioridad por campo; el motor resuelve por consenso (2 anclas coinciden → acepta; discrepan → `requiere_revision`). Requiere: extensión de tipo `ancla` → `anclas[]` (backward-compatible), editor multi-ancla, motor con votación.

## Fase 4 — Grupos de campos con restricciones espaciales (PENDIENTE — la más potente)

Modelo §7 de la conversación:
```ts
Grupo { id, tipo: 'fila'|'columna'|'repetidor'|'seccion', miembros: string[],
        restricciones: { alineacion?, orden?, espaciado?: 'uniforme'|'libre' } }
```
Hace imposible por construcción que J1 y J3 resuelvan el mismo rect (columna vertical uniforme). Requiere: `Molde.grupos` opcional, resolución en dos pasadas (bandas primero — TWIX), editor de grupos. ~1 semana según la conversación.

## Fase 5 — UX-1: auto-propuesta de anclas al dibujar (PENDIENTE)

El editor propone las 3 mejores candidatas de ancla con score; si dos difieren en un dígito, lo marca en rojo y pide desambiguador. El molde no puede nacer ambiguo. Los `desambiguadores` (ya soportados por el motor en esta entrega) se configuran aquí. 3-4 días.

## Fase 6 — "Cartero en cascada": identificación de documentos (PENDIENTE)

§8 de la conversación. Huella por plantilla (3-5 señales: frases clave siempre presentes, nº páginas, imagen de encabezado) + cascada de identificación barata antes del análisis completo:
1. ¿Código QR/barras? (0.1 s) → 2. ¿frases clave del encabezado? (1 s, OCR de franja) → 3. ¿imagen del encabezado? (0.5 s) → 4. ¿esqueleto (nº páginas, forma)? → 5. duda → preguntar al usuario con miniaturas.
Costo típico 1-2 s vs 10-40 s de análisis completo. Editor: proponer la huella automáticamente.

## Fase 7 — Alineación previa ORB/SIFT (PENDIENTE)

Opción 3.2 de la conversación: alinear la foto entrante contra la referencia antes de resolver zonas (fotos de cámara en ángulo). ORB en celular; SIFT en masivo. Complemento cuando el OCR falla por borrosidad: template matching del encabezado (3.1).

## Fase 8 — Umbral adaptativo por clustering (PENDIENTE)

Opción 4.1 completa: acumular ratios de TODAS las corridas y calibrar con Otsu/K-means 1D (k=2) en vez del corte fijo 0.002. La validación de separación (F4) ya quedó sembrada en `sugerirUmbral`; la evolución es clustering con ≥3-5 corridas.

**Matiz F4-1 (post-verificación):** la guarda relativa no cubre el caso «vacía limpia pegada al corte + vacía con flash encima del corte» (p. ej. `[0.002, 0.0139, 0.079]`); el caso sin NINGUNA vacía medida ya devuelve null (`sin_celdas_vacias`). El clustering de esta fase es la solución de fondo del matiz residual.

## Ronda post-verificación (APLICADA — 2026-11-21)

Correcciones sobre el informe de verificación del zip de mejoras (detalles y evidencia en CORRECCIONES-POST-VERIFICACION.md):

| Ítem | Severidad | Estado |
|---|---|---|
| D1 re-ejecución multi-página (todas las páginas en `fuenteUrls`) | P0 | ✅ |
| F4-1 guarda `sin_celdas_vacias` + UI con motivo real | Media | ✅ |
| O1 `/uploads/` anclado en `.gitignore` | Menor | ✅ |
| O2 desambiguadores en `firma_jurado_*` del molde E-14 | Opcional | ✅ |
| O3 `next-env.d.ts` fuera del árbol | Inofensivo | ✅ |
| E2E contra los 3 PDFs de la auditoría | Pendiente externa | ⏳ sin PDFs disponibles |

## Fase 9 — Extras del modelo (§7 completo) (PENDIENTE)

`schemaVersion` + herencia por tipo (`herencia: { [tipo]: { umbral, patron } }`), `grupos.tipo='repetidor'` para tablas/facturas, fixtures embebidos ("Probar Plantilla" con verdad de terreno), UX-3 alineación multi-referencia.

---

## Criterios de aceptación (de MOLDE-SPEC.md)

- [ ] Ningún campo resuelve el mismo rect que otro (colisión = 0)
- [ ] Cada campo obligatorio tiene ancla + respaldo, o ancla + desambiguadores
- [ ] Probado contra ≥3 ejemplos, incluido 1 difícil
- [ ] `requiere_revision` explicable (no >20% sin causa)
- [ ] Sin falsos positivos en campos críticos
- [ ] Umbral con separación clara de clases

## Reglas de gobierno

- Cada cambio se registra como lección en `lessons/` tras probar.
- 3 lecciones con el mismo patrón → restricción dura en MOLDE-SPEC.md.
- Subida al repo: SOLO con autorización del dueño (este .zip es para análisis).
