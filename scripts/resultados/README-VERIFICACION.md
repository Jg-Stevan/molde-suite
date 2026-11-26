# Resultados del arnés de verificación (FASE 0b)

Corridas documentadas contra `apps/molde-studio/public/moldes-genericos/recibo_pago/pag-01.png`
(imagen de referencia limpia 1700×2200, la del molde calibrado), una copia
rotada 12° de la misma (sintética, `sharp().rotate(12, { background: '#fff' })`)
y **la imagen del diagnóstico** `recibo-completo tachado.png` (1700×1519,
recortada, con revelados negros sobre fecha / N.º recibo / importe).

| Archivo | Motor | Molde | Imagen | Score | requiere_revision |
|---|---|---|---|---|---|
| `baseline-main-limpia-pag01.json` | main (motor viejo) | v1.3.1 | limpia | **100** | false |
| `feat-nuevo-limpia-pag01.json` | feat/extraccion-relacional | v1.3.2 | limpia | **100** | false |
| `baseline-main-rotada12.json` | main (motor viejo) | v1.3.1 | rotada 12° | 75 | true |
| `feat-nuevo-rotada12.json` | feat/extraccion-relacional | v1.3.2 | rotada 12° | **75** | true |
| `entregado-tachado-1519.json` | feat SIN correcciones | v1.3.2 | tachado | **16.7** | true |
| `corregido-tachado-1519.json` | feat + correcciones | v1.3.2 | tachado | **50.0** | true |
| `corregido-limpia-pag01.json` | feat + correcciones | v1.3.2 | limpia | **100** | false |
| `corregido-rotada12.json` | feat + correcciones | v1.3.2 | rotada 12° | **75** | true |

## Veredictos

1. **No-regresión (criterio FASE 1 del plan):** score limpio 100 → 100 con
   valores idénticos campo por campo. El gate de validaciones nuevo
   (`fechas_coherentes`, regla `rango`) evaluó y pasó en la corrida feat.
2. **Mejora de valores en la rotada (FASE 1a — mapa OCR global):** el motor
   viejo leía `importe: "480,50 €"` (recorte encogido truncó la cifra); el
   nuevo lee `importe: "2.480,50 €"` (valor completo). Ídem `importe_texto`
   y `datos_pagador` (más completo).
3. **Rescate anti-tachón (FASE 4):** `fecha_emision` en la rotada salió
   `rescate_anti_tachon` (la limpieza morfológica recuperó la fecha → `ok`);
   los campos donde no mejoró llevan `rescate_fallido` (honesto, sin inventar).
4. **Firmas:** en la imagen limpia ambas firmas resuelven `fuente: 'ancla'`
   con rects DISTINTOS (el falso positivo del diagnóstico — dos firmas 'ok' en
   el MISMO rect de referencia — queda cubierto además por la regla
   `fallback_no_verificado` cuando el ancla no aparece).

## CORRECCIÓN post-verificación (recibo tachado — la imagen del diagnóstico)

La corrida del feat SIN correcciones contra la imagen del problema
(`recibo-completo tachado.png`, 1700×1519) daba **score 16.7** — peor que el
baseline 33.3: la Fase 1b hizo honestos los veredictos (firmas falsas `ok` →
`requiere_revision`) pero NINGÚN campo legible se recuperó. Causas raíz
medidas (evidencia en `lessons/recibo_pago/2026-11-24-tachado-posicion-ancla.md`):

1. `buscarAncla` rechazaba matches textuales PERFECTOS (d=0) de
   concepto/forma_pago/fecha_pago por la penalización de posición (dy 0.16-0.21
   del recorte → score 0.61-0.67 < 0.72). Corrección: bypass para match
   perfecto y ÚNICO (`ancla_solo_textual`) — la penalización solo desambigua.
2. El título "RECIBO DE PAGO" NO existía en el mapa OCR global (el revelado del
   importe rompe la segmentación de líneas de Tesseract). Corrección: mapa OCR
   de rescate PEREZOSO (P4 del diagnóstico) — 2ª pasada OCR sobre el canvas con
   limpieza anti-tachón, solo si un campo pierde su ancla/valor
   (`ancla_rescate_anti_tachon` / `valor_rescate_anti_tachon`). Documento
   limpio: 0 pasadas extra.
3. `ok: null` en validaciones degradaba `fecha_pago` (lectura correcta conf
   0.95) porque `fecha_emision` es ilegible (revelado). Corrección:
   `validacion_no_evaluable` NO degrada campos individuales; `ok: false` sí.

Resultado corregido en la imagen tachada: **score 50.0** del motor — **41.7
genuino** (uno de esos `ok` es `importe_texto` = "o" con conf 0.14, y las dos
firmas `ok` de esta corrida son falso positivo por `ancla_solo_textual`; ver la
sección de re-puntuación más abajo). `ok` legítimos:
`titulo`, `datos_pagador`, `concepto`, `forma_pago`, `fecha_pago` (valores
EXACTOS); los fallos restantes son datos bajo revelado negro (ilegibles de
verdad) y limitaciones geométricas que la FASE 5 resolverá — todos con
banderas honestas (`fallback_no_verificado`, `validacion_no_evaluable`).

## Límite conocido documentado

Ninguno de los dos motores alcanza el score sin rotar con la imagen rotada 12°
(75 vs 100): el deskew por perfil de proyección corrige el ángulo pero el
residual geométrico desplaza los recortes. Es el caso de uso explícito de la
FASE 5 del plan (arnés geométrico con homografía), que requiere las URLs de
los modelos ONNX (las provee el dueño — FASE 0a).

## Re-puntuación y procedencia de estos artefactos (2da sesión, 2026-11-24)

Los JSON de arriba reportan el `score` del propio motor (divide `ok/todos`), así
que un campo-promesa los infla. Re-puntuados con `metricas()` del arnés
corregido, que excluye los `ok` con bandera que anula la lectura y los valores
degenerados (< 2 alfanuméricos):

| Archivo | motor | arnés | genuino | `ok` no genuinos |
|---|---|---|---|---|
| `baseline-main-limpia-pag01.json` | 100 | 100 | **100** | — |
| `feat-nuevo-limpia-pag01.json` | 100 | 100 | **100** | — |
| `corregido-limpia-pag01.json` | 100 | 100 | **100** | — |
| `baseline-main-rotada12.json` | 75 | 75 | **75** | — |
| `feat-nuevo-rotada12.json` | 75 | 75 | **75** | — |
| `corregido-rotada12.json` | 75 | 75 | **75** | `datos_pagador` (ruido) |
| `entregado-tachado-1519.json` | 16.7 | 16.7 | **8.3** | `titulo` (fuera de banda) |
| `corregido-tachado-1519.json` | 50.0 | 50.0 | **41.7** | `importe_texto` = "o", conf 0.14 |

Procedencia verificable de los archivos (no todos salieron del mismo camino):

- **`baseline-main-*` y `feat-nuevo-*` llevan UTF-8 doblemente codificado**
  (`TÃ­tulo`: 44, 41, 28 y 10 ocurrencias respectivamente). `corregido-*` y
  `entregado-*` están limpios. Un texto que sale del DOM del diálogo no puede
  llegar doblemente codificado: esos cuatro no pasaron por el arnés ni por el
  diálogo, son JSON reensamblados a mano desde otra fuente. Sus dos familias
  **no son comparables entre sí con garantía** (molde declarado v1.3.1 frente a
  v1.3.2 y camino de extracción distinto).
- **Ningún archivo tiene `_meta`**: no identifican commit, rama ni imagen (el
  arnés commiteado tampoco la escribía; ahora sí, ver `--etiqueta`).
- **No existe artefacto del baseline 33.3** de la imagen tachada, aunque la
  narrativa lo cita como término de comparación.

Medición independiente (Studio real, mismo método end-to-end, misma imagen
`recibo-tachado.png` 1700×1519, rama tal como se entregó): main **33.3** ·
feat corrida 1 **41.7** · feat corridas 2 y 3 **50.0**. Es decir: el 33.3 citado
se reproduce, pero el número publicado no es reproducible y el score oscila
±8.3 entre corridas del mismo binario sobre la misma imagen — las dos firmas
vuelven a `ok` por `ancla_solo_textual`.

## Banco 1.3.3 (molde corregido, motor v3.2.0 intacto)

Medición end-to-end con el Studio real (conductor externo, corrida persistida
por la app como fuente de verdad). Todos con `_meta` (commit/rama/imagen),
`score motor = score arnés = score genuino` y **0 `ok` no genuinos**:

| Imagen | Artefacto | v1.3.2 | v1.3.3 |
|---|---|---|---|
| limpia `pag-01.png` | `v133d-limpia-2026-11-24T22-16-19-971Z.json` | 100 | **100** (12/12) |
| `recorte-60pct-usuario.png` | `v133d-recorte60-2026-11-24T22-19-25-157Z.json` | 66.7 | **75** (9/12) |
| `recorte-66pct-sin-firma.png` | `v133e-recorte66-2026-11-24T22-28-51-285Z.json` | 50.0 | **75** (9/12) |
| `recibo-tachado.png` | `v133d-tachado-2026-11-24T22-18-23-110Z.json` | 33.3 | **50** (6/12) |
| `recibo-sin-firmas.png` | `v133c-sinfirmas-2026-11-24T22-09-44-445Z.json` | 75 | **75** (9/12) |
| `recibo-datos-nuevos.png` | `v133c-nuevos-2026-11-24T22-10-50-637Z.json` | 75 | **75** (9/12) |
| `rotada-12.png` | `v133e-rotada-2026-11-24T22-30-12-387Z.json` | 66.7 | **91.7** (11/12) |

Correcciones declarativas (motor sin cambios; ver
`lessons/recibo_pago/2026-11-24-ancla-unica-offset-intralinea.md`):

- `numero_recibo`: ancla `"N.9 Recibo"` (lectura real del OCR) + respaldo
  `"N.º Recibo"` — deja de colisionar con el título.
- `datos_emisor`: `zona_fija` → `ancla_relativa` con ancla `"con DNI"` en su
  propia línea, `x_absoluto`; centro x 0.333 medido con perfil de tinta (la x
  de la frase depende del nombre previo).

Nota de procedencia: `v133d-*` se midieron con el rect anterior (x 0.315);
el paso a 0.288 deja el dx idéntico en esas tres imágenes (mismo documento,
ancho intacto → score idéntico) y por eso no se repitieron; `recorte66` y
`rotada-12` sí se repitieron con el valor final (`v133e-*`).
`v133c-nuevos/sinfirmas` se midieron con la misma declaración 1.3.3 salvo el
recentrado x (documentos completos, dy≈0, `datos_emisor` `ok` sin banderas
en ambos). Los `v133`/`v133b`/`v133c` intermedios no se versionan: son
iteraciones superadas.

## Banco 1.4.0 + arnés geométrico (FASE 5-6, 2026-11-25)

Molde v1.4.0 sincronizado en la BD de Studio (PUT `/api/moldes/<id>` con la
plantilla del repo — la BD traía un v1.3.1 rancio que falseaba las corridas:
`datos_emisor` caía a `fuente 'fija'` y el tachado marcaba 41.7 en vez del 50
reproducible). Motor con `proyectarPorArnes` (afín + soporte leave-one-out) y
votación 2/3 letras↔número. Conductor externo, corrida persistida como fuente
de verdad, `_meta` en todos los artefactos:

| Imagen | Artefacto | score motor | arnés | genuino | campos `arnes` |
|---|---|---|---|---|---|
| `recibo-tachado.png` | `arnes-tachado-loo-…T21-17-00-780Z.json` | **58.3** | 58.3 | 50 | 4 (`importe`, `importe_texto`, ambas firmas) |
| `pag-01.png` (limpia) | `arnes-limpia-loo-…T21-17-32-277Z.json` | **100** | 100 | 83.3 | 0 (no hay nada que rescatar) |
| `rotada-12.png` | `arnes-rotada-loo-…T21-18-13-686Z.json` | **91.7** | 91.7 | 83.3 | 0 |

- **No-regresión:** limpia y rotada idénticas a su baseline re-puntuado con las
  `metricas()` actuales (los 83.3/`firma_*` no genuinos vienen de
  `ancla_solo_textual`+`forma_sin_caja` en el arnés, presentes también en el
  baseline; el motor no cambió).
- **Tachado +8.3 sobre el baseline 50:** `importe_texto` rescatado por el arnés
  queda `ok` con valor EXACTO (conf 0.77, patrón validado); `importe` sigue en
  revisión (conf OCR 0.20 bajo el revelado — honesto).
- **Fin del «dos firmas mismo rect»:** con cajas `seal` del layout,
  `firma_emisor` y `firma_pagador` reciben rects DISTINTOS (y 0.931 / 0.758) y
  quedan `no_encontrado` con `forma_sin_caja` en esta imagen (sin tinta
  legible) — nunca un `ok` compartido.
- Causa del rediseño (residual → LOO) documentada en
  `lessons/recibo_pago/2026-11-25-arnes-loo-soporte.md`.

## Cómo reproducir

```bash
# Studio arrancado y el molde cargado (ver --url si no es :3000)
bun scripts/verificar-molde.ts "ruta/a/imagen.png" \
  --url http://localhost:3000 --molde "Recibo de pago" --etiqueta feat-fixa
# → scripts/resultados/feat-fixa-<timestamp>.json, con _meta (commit, rama,
#   imagen) y el resumen score motor / score arnés / genuino impreso
```

Los JSON ya guardados se re-puntúan importando `metricas()` y
`normalizarCampos()` desde `scripts/verificar-molde.ts` (el módulo no ejecuta
nada al importarse).

Nota FASE 4: el arnés commiteado ya entra a la pestaña Verificación por el nav
móvil (viewport 700px y de vuelta), usa el input propio de Verificación y cae
al Chrome del sistema si `playwright-core` no trae navegadores. Validado
end-to-end contra la referencia: 100 · 12/12 · 0 errores de consola
(`arnes-fase4-2026-11-24T22-34-27-056Z.json`). En un entorno sin Playwright
resoluble desde el repo, `NODE_PATH=<node_modules externo> bun
scripts/verificar-molde.ts …` funciona sin añadir dependencias.

