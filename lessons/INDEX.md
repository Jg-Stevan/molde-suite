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
