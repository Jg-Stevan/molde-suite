# Plantilla Molde · Acta E-14 Exterior (Cónsul/Embajador · Transmisión)

Molde universal v3.0.0 exportado de Molde Studio para pruebas automatizadas con agentes.
Documento: `acta_e14` · Idioma: `es` · 21 campos mapeados.

## Archivos

| Archivo | Descripción |
|---|---|
| `molde-e14.json` | Definición completa del molde (campos, zonas, anclas, estrategias) |
| `referencia-p1.png` | Página 1 del escaneo de referencia (Nairobi 515) usado para calibrar |
| `referencia-p2.png` | Página 2 del escaneo de referencia (constancias + firmas de jurados) |

## Estructura del JSON

```jsonc
{
  "tipo": "universal",
  "version": "3.0.0",
  "documento": "acta_e14",
  "paginasRef": [{ "pagina": 1, "imagen": "..." }, { "pagina": 2, "imagen": "..." }],
  "campos": [
    {
      "id": "divipol_consulado",
      "pagina": 1,
      "tipo": "texto | presencia | firma | checkbox",
      "estrategia": "ancla_relativa",
      "zona":  { "x", "y", "w", "h" },   // relativa a la esquina del ANCLA (no de la página)
      "ancla": { "texto": "CONSULADO", "rect": { "x", "y", "w", "h" } },
      "ancla_respaldo": "PAÍS",           // texto alternativo si el OCR no lee el ancla principal
      "patron": "\\d{2}",                 // regex de validación del valor extraído
      "umbral": 0.02,                     // tolerancia de búsqueda alrededor del ancla
      "obligatorio": true,
      "nota": "..."
    }
  ]
}
```

### Convenciones clave

- **Todas las coordenadas están normalizadas (0–1)** respecto al ancho/alto de la página → funcionan igual en escaneos y fotos de cualquier resolución.
- **Estrategia `ancla_relativa`**: la zona del campo NO es absoluta; se calcula respecto al rectángulo del texto ancla detectado por OCR. Para reproducir la extracción, el agente debe: (1) correr OCR sobre la página, (2) localizar el rect del `ancla.texto`, (3) aplicar `zona` como offset relativo a ese rect.
- **Fallback orden-insensible**: si el documento viene rotado/fotografiado, el motor puede reorderar las anclas por coincidencia difusa (ver `meta.validacion`: probado con escaneo + foto con flash).
- **Tipos de campo**: `texto` (valor OCR validado con `patron`), `presencia` (detecta tinta/manuscrito en la zona), `firma` (presencia de trazo de firma), `checkbox` (OMR de marca SÍ/NO).

## Campos mapeados (21)

### Página 1

| Campo | Tipo | Obligatorio | Ancla |
|---|---|---|---|
| `divipol_consulado` | texto | Sí | CONSULADO |
| `divipol_pais` | texto | Sí | PAIS |
| `divipol_zona` | texto | Sí | ZONA |
| `divipol_puesto` | texto | Sí | PUESTO |
| `divipol_mesa` | texto | Sí | MESA |
| `divipol_lugar` | texto | Sí | LUGAR |
| `suma_total` | texto | Sí | SUMA TOTAL |
| `total_votantes_e11` | presencia | No | TOTAL VOTANTES |
| `total_votos_urna` | presencia | No | TOTAL VOTOS EN LA URNA |
| `total_votos_incinerados` | presencia | No | TOTAL VOTOS INCINERADOS |
| `votos_candidato_1` | presencia | No | IVAN CEPEDA CASTRO |
| `votos_candidato_2` | presencia | No | ABELARDO DE LA ESPRIELLA |
| `votos_en_blanco` | presencia | No | VOTOS EN BLANCO |
| `votos_nulos` | presencia | No | VOTOS NULOS |
| `votos_no_marcados` | presencia | No | VOTOS NO MARCADOS |

### Página 2

| Campo | Tipo | Obligatorio | Ancla |
|---|---|---|---|
| `constancias_presencia` | presencia | No | CONSTANCIAS DE LOS JURADOS |
| `recuento_marca` | checkbox | No | HUBO RECUENTO |
| `firma_jurado_1` | firma | Sí | FIRMA JURADO 1 |
| `firma_jurado_2` | firma | No | FIRMA JURADO 2 |
| `firma_jurado_3` | firma | No | FIRMA JURADO 3 |
| `firma_jurado_4` | firma | No | FIRMA JURADO 4 |

## Metadatos de validación (`meta`)

- `precision`: 82 · `docs`: 3 actas de prueba · `estado`: validando
- Validado contra: Nairobi (plantilla) + Barcelona (transmisión) + El Cairo (foto con flash)

## Nota: preinstalado en GitHub Pages

El sitio desplegado (https://jg-stevan.github.io/molde-suite/) siembra este molde
en la biblioteca en la primera visita (IndexedDB local), con las páginas de
referencia servidas del propio build. No hace falta importarlo a mano ahí.

## Uso sugerido para agentes

1. Cargar `molde-e14.json` y `referencia-p1.png` / `referencia-p2.png`.
2. Correr OCR (tesseract `spa+eng`) sobre la imagen de referencia para localizar los rects de anclas.
3. Verificar que cada ancla del JSON coincide con la detección (tolerancia recomendada: `umbral` = 0.02).
4. Aplicar cada `zona` relativa al rect del ancla para recortar y extraer el valor.
5. Validar campos `texto` contra su `patron` y marcar `obligatorio` vacío como fallo.
