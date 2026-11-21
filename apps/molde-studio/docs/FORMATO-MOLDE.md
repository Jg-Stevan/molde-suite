# Formato de molde universal v3

Contrato entre Molde Studio (crea/calibra) y el motor de verificación (ejecuta).
Este documento describe el formato completo tras la Fase 2 del plan de
implementación (motor de lectura honesto) y define las métricas de salida.

## Estructura

```jsonc
{
  "tipo": "universal",
  "version": "3.0.0",
  "nombre": "…",
  "documento": "acta_e14",           // informativo
  "idioma": "es",
  "paginasRef": [                     // escaneos de referencia por página
    { "pagina": 1, "imagen": "/uploads/…o idb:… o ruta pública" }
  ],
  "campos": [ /* CampoUniversal[] */ ],
  "validaciones": [ /* ValidacionMolde[] — opcional, cierre aritmético */ ],
  "meta": {                           // SOLO presentación de la tarjeta
    "precision_declarada": 82,        // informativa: NUNCA sustituye el score real (G-1)
    "docs": 3, "unidadDocs": "actas de prueba",
    "estado": "validando",
    "etiquetas": { "texto": "…", "firma": "…" },
    "etiquetaCampos": "Campos Mapeados",
    "orden": 0
  }
}
```

## Campo

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | string | único dentro del molde |
| `etiqueta` | string | legible |
| `pagina` | int ≥ 1 | 1-indexada |
| `tipo` | `texto \| presencia \| firma \| checkbox` | texto = OCR; los demás = tinta |
| `estrategia` | `zona_fija \| ancla_relativa` | ancla_relativa exige `ancla.texto` no vacío (N-4) |
| `zona` | `{x,y,w,h}` 0–1 | zona_fija: absoluto; ancla_relativa: `{x,y}` = offset desde el ancla (`x_absoluto: true` → x absoluto) |
| `ancla` | `{texto, rect?, rectRespaldo?}` | `rect` = posición de referencia para dibujar/fallback. `rectRespaldo` lo escribe `alinearAnclas` cuando solo matcheó el respaldo — NUNCA sobrescribe `rect` (N-2) |
| `ancla_respaldo` | string? | texto alternativo |
| `umbral` | 0–1 | densidad de tinta; en campos de texto se usa para `zona_vacia` |
| `patron` | regex? | **se evalúa ANCLADO**: el motor lo envuelve con `^(?:…)$` si no trae `^…$` (G-8). "ZONA: 05" ya no pasa contra `\d{2}` |
| `limpiar_valor` | regex? | extracción previa a la validación: primer grupo de captura (ej. `(\d{2})` sobre "ZONA: 05" → "05") |
| `whitelist` | string? | caracteres permitidos en el OCR del recorte |
| `realce` | bool? | reintentos con realce (gris ampliado, contraste, Otsu, psm 8/13) |
| `htr` | bool? | campo MANUSCRITO: si es obligatorio, la lectura SIEMPRE queda en `requiere_revision` (opción C, Fase 2.5 — honestidad por encima de invención) |
| `destacado` | bool? | resalta el valor en Datos Variables (G-7; sustituye la heurística de facturas) |
| `obligatorio` | bool | falta → `requiere_revision` de la corrida |

## Validaciones de cierre (Fase 2.2)

```jsonc
"validaciones": [
  {
    "id": "cierre_suma",
    "regla": "igualdad",
    "expresion": "suma_total == votos_candidato_1 + votos_candidato_2 + votos_en_blanco + votos_nulos + votos_no_marcados",
    "tolerancia": 0,
    "descripcion": "La suma total debe cuadrar con sus componentes"
  }
]
```

- Parser **seguro**: solo IDs (`[a-z_][a-z0-9_]*`), números, `+` y `==`. No evalúa JS.
- Conversión a número: texto → se normalizan espacios/separadores de miles ("17 000", "1.234"); presencia/firma/checkbox → 1 con trazo, 0 sin trazo (útil para cierres por conteo de casillas).
- Si un operando no tiene lectura → validación `ok: null` ("no evaluable") y la corrida requiere revisión.
- Si la igualdad falla → bandera `validacion_fallida` en los campos implicados, estado `requiere_revision`, y la corrida NO puede ser «Aprobada». Es la defensa principal contra lecturas inventadas (las "2"≠17 de la auditoría mueren aquí).

## Estados de un campo

| estado | significado |
| --- | --- |
| `ok` | leído y dentro de todas las reglas |
| `no_encontrado` | sin lectura válida |
| `requiere_revision` | lectura dudosa: umbral al borde (banda 0.6×–1.4×), confianza baja/ausente en obligatorio, manuscrito (`htr`) obligatorio, o validación de cierre fallida |

Banderas: `ancla_no_encontrada`, `ancla_respaldo`, `sin_rect`, `zona_invalida` (molde malformado — la corrida sobrevive, N-4), `umbral_al_borde`, `ocr_vacio`, `zona_vacia`, `realce_retry`, `patron_no_cumple`, `patron_invalido`, `valor_limpiado`, `conf_baja`, `sin_confianza_ocr`, `htr_manual`, `validacion_fallida`, `pagina_faltante`, `posible_pagina_equivocada` (3.3), `rotacion_180_corregida` (3.3).

## Métricas de una corrida (G-2/G-5)

- `score` = campos en `ok` / total × 100. `requiere_revision` **no** cuenta como ok.
- `pct_diligenciado` = campos de tinta con trazo / total de campos de tinta.
- `pct_lectura` = campos de texto en `ok` / total de campos de texto.
- `ok_count` = número de `ok` — el mismo número que muestra el chip «GT OK» de la UI (criterio único).
- `requiere_revision` (corrida) = faltan obligatorios ∨ validación fallida/no evaluable ∨ algún campo en `requiere_revision` ∨ página equivocada.
- Umbral de aprobación: `UMBRAL_APROBADO = 98` (constante compartida, N-6). Una corrida que requiere revisión jamás se muestra como «Aprobada».

## Confianza (G-3/N-9)

`conf` puede ser `null` cuando el OCR no reporta confianza — la UI muestra
«sin confianza». Jamás se fabrica un 0.5/0.6. `conf < 0.5` en un campo
obligatorio → `requiere_revision`.

## Render y calibración (Matiz 2)

Toda página (foto o PDF) se renderiza a **1000 px de ancho** antes de evaluar
(`pdf-client.ts`); el editor calibra y alinea sobre ese MISMO render. Una foto
de 640 px se evalúa al mismo tamaño de calibración (antes el clamp `Math.min(1,…)`
la dejaba pequeña y las medidas no eran comparables).
