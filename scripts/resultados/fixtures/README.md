# Banco de verificación (fixtures)

Imágenes de prueba versionadas por decisión del dueño (2026-11-24) para poder
reproducir la verificación sin depender de archivos locales externos.

| Archivo | Tamaño | Qué prueba | Score medido (2026-11-24, molde 1.3.3) |
|---|---|---|---|
| `recibo-tachado.png` | 1700×2200 | Rúbricas tachadas con rotulador | **50.0** · 6/12 (era 33.3; ilegibles honestos) |
| `recorte-60pct-usuario.png` | 1700×1227 | Recorte vertical fuerte (corte en el 65 %) | **75.0** · 9/12 (era 66.7; título cortado + firmas fuera de cota) |
| `recorte-66pct-sin-firma.png` | 1700×1447 | Recorte + fecha de pago tachada, sin firmas | **75.0** · 9/12 (era 50.0) |
| `recibo-datos-nuevos.png` | 1700×2200 | Datos nuevos (no vistos por el molde) | **75.0** · 9/12 (fecha mutilada → no evaluable) |
| `recibo-sin-firmas.png` | 1700×2200 | Datos nuevos y zona de firmas en blanco | **75.0** · 9/12 (ancla hallada + `firma_ausente`) |
| `rotada-12.png` | 2120×2505 | Alabeo de 12° con deskew | **91.7** · 11/12 (era 66.7; solo `firma_pagador` al borde) |

Los números son `score motor = score arnés = score_genuino` (el arnés recalcula
desde estados y banderas; ver `scripts/verificar-molde.ts`).

## Cómo medir

```bash
# Arnes del repo (ver nota de limitación abajo):
bun scripts/verificar-molde.ts scripts/resultados/fixtures/recibo-tachado.png --etiqueta tachado
```

Artefactos (con recortes) en `scripts/resultados/`; análisis por corrida en
`lessons/recibo_pago/` y en los `ANALISIS-*.md` de la raíz.

## Arnés del repo (corregido — FASE 4)

`scripts/verificar-molde.ts` entra a la pestaña Verificación por el nav móvil
(estrecha el viewport y lo restaura) y sube la imagen por el input propio de
Verificación: antes tomaba el primer `input[type=file]` (el del Editor) y el
pipeline nunca arrancaba con una imagen nueva. Además cae al Chrome del
sistema si `playwright-core` no trae navegadores empaquetados. Validado
end-to-end contra `pag-01.png`: **100 · 12/12 · 0 errores de consola**
(`scripts/resultados/arnes-fase4-*.json`).
