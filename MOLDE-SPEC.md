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
| Ancla relacional con faro (`ancla_relacional`, v3.2.0) | El texto del ancla aparece MÁS DE UNA VEZ en el documento (ej. DOS cajas «Firma», «FIRMA» vs el párrafo «El abajo firmante acepta…») y la posición aproximada es conocida: declaras `zona_busqueda` (EL FARO) y el motor busca SOLO dentro; la caja final se resuelve RELATIVAMENTE al contexto local (`relacion`: banda adyacente / línea / caja del faro) | No conoces la posición aproximada del ancla (sin faro el validador rechaza el molde — por diseño: nunca hay búsqueda global). Para cajas que CONTIENEN al ancla usa `que: "zona"` con el faro sobre la caja |
| Ancla + `desambiguadores` | Etiquetas vecinas parecidas ("JURADO 2"/"JURADO 4") — exige contexto cercano | No hay texto de contexto cerca de la etiqueta |
| Ancla + FARO (combinación recomendada en v3.2.0) | Dos etiquetas idénticas en páginas/columnas distintas: el faro IZQUIERDO halla la firma izquierda, el derecho la derecha — sin `desambiguadores` | — |
| `ancla_respaldo` | La etiqueta principal se pierde por OCR con frecuencia | — |
| Importador Chandra (datalab-convert → MoldeUniversal, v3.2.0) | El humano YA tiene la salida de Chandra del documento y su matriz de obligatorios: pégala en Biblioteca → «Importar JSON / Chandra» → revisa la tabla (tipo, obligatorio, grupo, orden) → crear | NO sustituye al editor: los rects ESTIMADOS (retícula de celdas) y las anchuras de lectura iniciales se ajustan en el editor con «Probar faro» antes de validar |
| Rect de referencia (`ancla.rect`) | Siempre (fallback cuando el OCR pierde la etiqueta) | Como estrategia única en documentos con variantes de layout |
| `zona_fija` | Documentos 100% rígidos (mismo layout exacto siempre) | Fotos de celular con desplazamientos |
| Anclas de voto (`anclas[]`, v3.3.0 — Fase 3) | El campo tiene DOS o más etiquetas estables en BANDAS distintas y no quieres depender de una sola (tachón/luz pueden borrar una): cada ancla declara su `zona` propia hasta el mismo rect; el motor acepta POR CONSENSO (≥2 coinciden) y con discrepancia va a revisión (jamás escoge) | El campo tiene una sola etiqueta (usa `ancla` normal — una lista de 1 la rechaza el validador) |
| Grupo de campos con restricciones (`grupos`, v3.3.0 — Fase 4) | Varios campos comparten banda (`fila`) / columna (`columna`) / celda repetida (`repetidor`, alineación + espaciado uniforme): una violación demueve los 'ok' con bandera `grupo_*` — hace imposible por construcción que J1 y J3 resuelvan el mismo rect | Campos dispersos sin relación espacial (usa `tipo: "seccion"`, que no opina) |
| Auto-propuesta de anclas (FASE 5 — editor) | Recién dibujaste la zona: el botón «Proponer anclas (FASE 5)» lista las 3 mejores candidatas por cercanía + unicidad + confianza; las que difieren solo en dígitos van en ROJO — añade `desambiguadores` antes de guardar | La capa OCR de la página aún no corrió |
| Umbral por clustering (IMPLEMENTADO — Fase 8) | ≥3 corridas del mismo molde | Primera prueba |
| Herencia por tipo (`herencia`, v3.3.0 — Fase 9) | El molde define MUCHOS campos del mismo tipo con el mismo umbral/patrón: decláralos UNA vez en `herencia[tipo]` (un campo sin `umbral` hereda; sin herencia el validador lo rechaza) | Cada campo necesita un umbral calibrado distinto (la calibración fina vive en el campo) |
| Fixtures de verdad de terreno (`fixtures`, v3.3.0 — Fase 9) | El molde YA tiene casos de prueba conocidos ('limpia', 'sin-firmas'): declara `esperado`/`estadosEsperados` y Verificación confronta cada corrida contra ellos con evidencia | No tienes la verdad de terreno medida (inventarla produce desvíos falsos) |
| Huella de cascada (`huella`, v3.3.0 — Fase 6) | Quieres que Verificación AVISE cuando el documento subido parece ser OTRO tipo (frases clave de cabecera + nº de páginas): identificación barata ANTES del análisis completo | Un solo molde cargado (no hay contra quién comparar) |
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
- **Overlay por campo (aditivo)**: cada `ResultadoCampoUniversal` trae `rect`
  (dónde se leyó el valor) y `ancla_rect` (dónde el OCR encontró el texto del
  ANCLA; `null` en `zona_fija`/`referencia`/`arnés`, donde no hubo hit real que
  señalar). La app Tamiz pinta sobre la foto procesada SOLO el valor
  reconocido como PALABRA coloreada (mantenedor 2026-11-25d): verde (`ok`),
  ámbar (`requiere_revision`) o rojo (`no_encontrado`/firma faltante). Las
  anclas NO se dibujan (queda `ancla_rect` como dato del contrato). También en
  el visor a pantalla completa: la capa vive dentro del wrapper de zoom y
  escala/panea con la foto (se oculta al comparar el original). Los rects son
  normalizados (0-1) sobre el canvas de la foto PROCESADA — el overlay solo
  se ofrece con esa foto (jamás sobre la original).
- Banderas relevantes al diseñar: `ancla_no_encontrada`, `ancla_colision`,
  `desambiguacion_fallida`, `umbral_al_borde`, `pagina_faltante`,
  `posible_pagina_equivocada`, `rotacion_180_corregida`.
- **Plan extracción relacional (FASE 1b — fin del falso positivo de firmas)**:
  `fallback_no_verificado` — ningún campo queda `ok` con `fuente: 'referencia'` +
  `ancla_no_encontrada`: la posición no fue verificada (el motor midió sobre la
  banda de referencia, no sobre la zona real). OBLIGATORIO → `requiere_revision`;
  OPCIONAL → `no_encontrado` (no es un error del documento, honestamente no se
  encontró). Aditivo.
- **Plan extracción relacional (FASE 1a — mapa OCR global)**: los campos de
  texto se leen del MAPA OCR GLOBAL de la página (1 pasada de `ocrLines` por
  página); el re-OCR del recorte queda SOLO como rescate para campos con
  `realce`. OCRs por página: 13+ → 1 (+ rescates).
- **Plan extracción relacional (FASE 4 — anti-tachón)**: `rescate_anti_tachon`
  (la limpieza morfológica local recuperó el texto bajo tachones) y
  `rescate_fallido` (se intentó el rescate y no mejoró — el resultado original
  se conserva). Solo campos obligatorios con tinta y lectura inválida; nunca
  global.
- **Plan extracción relacional (FASE 3 — validaciones)**: `regla: 'rango'`
  compara FECHAS entre dos campos (`"fecha_pago >= fecha_emision"`). Formatos
  parseados: ISO, dd/mm/aaaa, dd-mm-aaaa, «24 de noviembre de 2026». Un
  operando sin fecha legible deja la validación NO EVALUABLE (ok: null).
  La igualdad de sumas (`regla: 'igualdad'`) no cambia.
- **Cota del bypass posicional**: `ancla_solo_textual` solo se concede si el
  match perfecto es ÚNICO entre todos los perfectos de la página y su
  desplazamiento al rect esperado es `|dx|+|dy| ≤ 0.3`
  (`ANCLA_TEXUAL_DESPLAZAMIENTO_MAX`). Sin cota, una etiqueta que aparezca una
  sola vez en otra zona ancla el campo allí (medido: dos firmas `ok` con valor
  "true" y `forma_sin_caja`).
- **Campos de tinta**: `ancla_sin_geometria` — un campo `tipo !== 'texto'`
  (firma, presencia, checkbox) anclado SOLO por texto no puede quedar `ok`: su
  evidencia es la geometría (caja/rúbrica), que el bypass no verifica.
- **Lecturas degeneradas**: `lectura_degenerada` — campo de texto con lectura
  insuficiente (menos de 8 alfanuméricos, `core/ocr.ts`) y banda vacía o conf
  < 0.5 termina `no_encontrado` / `requiere_revision`, nunca `ok`. Corta el
  ruido contado como acierto (`importe_texto` = "o", conf 0.14).
- **CORRECCIÓN post-verificación (recibo tachado 1700×1519 — P4 + anclaje)**:
  - `ancla_solo_textual` — el ancla se aceptó por match textual PERFECTO y
    ÚNICO (d=0 en orden estricto en exactamente una ventana de la página),
    saltándose la penalización de posición. Dispara en documentos recortados o
    de escala distinta de la referencia (geometría normalizada desplazada, dy
    ≥ 0.16 → penalización < 0.72): antes el match perfecto se RECHAZABA por
    posición y el campo caía al fallback. Con ambigüedad (≥ 2 ventanas
    perfectas) la posición sigue mandando.
  - `ancla_rescate_anti_tachon` / `valor_rescate_anti_tachon` — ancla/valor
    recuperados desde el MAPA OCR DE RESCATE (2ª pasada OCR perezosa sobre el
    canvas con limpieza anti-tachón — la apertura 1D elimina los trazos largos
    que rompían la segmentación de líneas del OCR global). Solo se paga si un
    campo perdió su ancla o su valor en el mapa primario: documento limpio =
    1 pasada OCR (costo 0). El mapa primario siempre gana para valores.
  - `validacion_no_evaluable` — una validación con `ok: null` (operando
    ilegible) NO marca `validacion_fallida` NI degrada el campo que sí se leyó
    bien (caso real: fecha_pago correcto se degradaba porque fecha_emision
    estaba bajo un revelado). `ok: false` mantiene la democión (defensa
    principal). El gate global `requiere_revision` sigue encendido con null.
- **Plan extracción relacional (FASE 5 — arnés geométrico)**: `fuente: 'arnes'`
  — el campo perdió su ancla y el motor proyectó su rect desde ≥3 anclas de alta
  confianza (`ARNES_ANCLAS_MIN`) con un afín de mínimos cuadrados cuyo modelo se
  reajusta solo sobre los votos que se sustentan entre sí (leave-one-out:
  residual normalizado ≤ `ARNES_VOTO_TOL` = 0.02). `confProy` = fracción de votos
  soportados; se adopta con `conf ≥ ARNES_CONF_PROY_MIN` = 0.8. Bandera
  `ancla_inferida` (posición inferida, no medida) y aditivo `auto_reparado_numero`
  (ver FASE 6). Adopción texto exige lectura válida + conf ≥ 0.7 + patrón; sin
  eso queda `requiere_revision` — NUNCA un `ok` silencioso. Las firmas se
  separan por caja: con `cajasLayout` de clase `seal` (la inyecta la app; el
  motor no importa dla-onnx), cada firma recibe su propio rect y se acaba el
  «dos firmas en el mismo rect» por construcción.
- **Plan extracción relacional (FASE 6 — votación 2/3 y letras↔número)**: un
  campo rescatado por el arnés vale `ok` solo con dos de tres señales de acuerdo
  (geometría del arnés + patrón validado + conf OCR ≥ `ARNES_TEXTO_CONF_MIN`).
  `letrasANumero` convierte «dos mil cuatrocientos…» a número (español, 10-15/
  20-29, millone/billón, «con» decimales); devuelve null ante cualquier token
  desconocido — nunca inventa. `repararNumeroAmbiguo` solo mapea dígitos
  ambiguos (O→0 I/l→1 S→5 B→8 Z→2 G→6 T→7 q→9) y la reparación se acepta
  ÚNICAMENTE si el otro operando de la validación la cruza por letras al mismo
  valor (`auto_reparado_numero`); sin cruce, el valor queda intacto y la
  validación `ok: null`.
- **v3.2.0 — faro (ancla_relacional)**: `ancla_fuera_de_zona` (el texto existe
  PERO fuera del faro — el mapa está mal puesto o la variante es otra; cae a
  referencia), `relacion_sin_candidato` (nada en la dirección pedida →
  fallback), `relacion_ambigua` (empate a <10% → requiere_revision, jamás
  pick silencioso).
- **v3.2.0 — firmas**: `metricasFirma` (densidad + Nº de trazos + extensión)
  viaja en el resultado (`firma.trazos/densidad/extension`). Bandera
  `firma_ausente` (firma esperada sin NINGÚN trazo) y `trazos_insuficientes`
  (menos trazos que `min_trazos`) → el ok se degrada a revisión. Una firma
  obligatoria sin rúbrica cae en `obligatorios_faltantes` como siempre.
- **v3.2.0 — grupo/orden**: campos con `grupo`/`orden` (importador Chandra)
  se presentan agrupados y ordenados en Verificación (Datos Variables) y en el
  checklist de Tamiz (críticos arriba de cada grupo). Solo presentación.
- Las coordenadas son normalizadas 0-1; el motor renderiza a 1000 px de ancho.
- `desambiguadores: string[]` por campo: textos que deben aparecer por OCR a
  ≤0.3 (normalizado) del ancla para que el hit se acepte.

## 7. Flujo Chandra (v3.2.0 — el humano define el mapa)

1. El humano corre Chandra sobre el documento y export datalab-convert
   (un JSON con 1+ páginas/variantes).
2. Studio → Biblioteca → «Importar JSON / Chandra» → pegar/adjuntar el JSON →
   «Analizar Chandra».
3. Revisar la TABLA: tipo, zona (faro · rect), grupo, orden, nivel de la
   matriz (Crítico/Obligatorio/Operativo/Condicional/Opcional precargado con
   las matrices del dueño) y el toggle obligatorio — LA DECISIÓN FINAL ES DEL
   HUMANO.
4. «Crear molde (N campos)» → el molde queda en la Biblioteca y se ajusta en
   el editor (faro + «Probar faro») y se valida en Verificación contra TODAS
   las variantes (score ≥ 98 y sin requiere_revision).
5. Regla cruzada: los campos de TINTA nacen `ancla_relacional` con faro — la
   zona de densidad se MUEVE con la etiqueta. Los rects marcados «≈» son
   estimados (retícula uniforme de celdas de Form/Table) — el faro los corrige.
6. Cancelado definitivamente (corrección del dueño #3): el botón «Generar
   borrador», `borrador.ts` y `sidecar-client.ts`. Ningún flujo nuevo depende
   del sidecar Python (queda como está para quien lo use).

Reglas mínimas de rechazo (sin firma, sin fecha, sin trazabilidad) =
`obligatorio: true` en esos campos — el motor ya degrada la corrida a revisión
si falta un obligatorio. Límite documentado: la concordancia cifra↔letras del
importe (Recibo) NO es validable con el parser aritmético actual; queda como
mejora futura (`regla: "cifra_en_letras"`, fuera de alcance de v2).
