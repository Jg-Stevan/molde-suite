# Resultados del arnés de verificación (FASE 0b)

Corridas documentadas contra `apps/molde-studio/public/moldes-genericos/recibo_pago/pag-01.png`
(imagen de referencia limpia 1700×2200, la del molde calibrado) y una copia
rotada 12° de la misma (sintética, `sharp().rotate(12, { background: '#fff' })`).

| Archivo | Motor | Molde | Imagen | Score | requiere_revision |
|---|---|---|---|---|---|
| `baseline-main-limpia-pag01.json` | main (motor viejo) | v1.3.1 | limpia | **100** | false |
| `feat-nuevo-limpia-pag01.json` | feat/extraccion-relacional | v1.3.2 | limpia | **100** | false |
| `baseline-main-rotada12.json` | main (motor viejo) | v1.3.1 | rotada 12° | 75 | true |
| `feat-nuevo-rotada12.json` | feat/extraccion-relacional | v1.3.2 | rotada 12° | **75** | true |

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

## Límite conocido documentado

Ninguno de los dos motores alcanza el score sin rotar con la imagen rotada 12°
(75 vs 100): el deskew por perfil de proyección corrige el ángulo pero el
residual geométrico desplaza los recortes. Es el caso de uso explícito de la
FASE 5 del plan (arnés geométrico con homografía), que requiere las URLs de
los modelos ONNX (las provee el dueño — FASE 0a).

## Cómo reproducir

```bash
# Studio en :3000 con el molde cargado + imagen de prueba
bun scripts/verificar-molde.ts "ruta/a/imagen.png" --url http://localhost:3000
# El JSON queda en scripts/resultados/<timestamp>.json con resumen impreso
```
