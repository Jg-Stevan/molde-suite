# Banco de verificación (fixtures)

Imágenes de prueba versionadas por decisión del dueño (2026-11-24) para poder
reproducir la verificación sin depender de archivos locales externos.

| Archivo | Tamaño | Qué prueba | Score medido (2026-11-24, v1.3.2) |
|---|---|---|---|
| `recibo-tachado.png` | 1700×2200 | Rúbricas tachadas con rotulador | 33.3 · 4/12 (firmas en revisión, sin falsos `ok`) |
| `recorte-60pct-usuario.png` | 1700×1227 | Recorte vertical fuerte (corte en el 65 %) | 66.7 · 8/12 (cota de desplazamiento) |
| `recorte-66pct-sin-firma.png` | 1700×1447 | Recorte + fecha de pago tachada, sin firmas | 50.0 · 6/12 (colisión de ancla + `zona_fija`) |
| `recibo-datos-nuevos.png` | 1700×2200 | Datos nuevos (no vistos por el molde) | 75.0 · 9/12 (fecha mutilada → no evaluable) |
| `recibo-sin-firmas.png` | 1700×2200 | Datos nuevos y zona de firmas en blanco | 75.0 · 9/12 (ancla hallada + `firma_ausente`) |
| `rotada-12.png` | 2120×2505 | Alabeo de 12° con deskew | 66.7 · 8/12 |

Los números son `score motor = score arnés = score_genuino` (el arnés recalcula
desde estados y banderas; ver `scripts/verificar-molde.ts`).

## Cómo medir

```bash
# Arnes del repo (ver nota de limitación abajo):
bun scripts/verificar-molde.ts scripts/resultados/fixtures/recibo-tachado.png --etiqueta tachado
```

Artefactos (con recortes) en `scripts/resultados/`; análisis por corrida en
`lessons/recibo_pago/` y en los `ANALISIS-*.md` de la raíz.

## Limitación conocida del arnés

`scripts/verificar-molde.ts` todavía no navega a la pestaña Verificación (su
conmutador de escritorio no existe; el nav es solo móvil), así que subir una
imagen nueva puede no arrancar el pipeline. Corrección pendiente en la Fase 4
del plan. Los números de la tabla se reprodujeron con un conductor externo que
usa el mismo flujo con la navegación corregida.
