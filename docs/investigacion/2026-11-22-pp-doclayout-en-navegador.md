# PP-DocLayout en navegador — evidencia y decisiones (2026-11-22)

> Dossier de traspaso. Todo lo medido aquí se hizo con los modelos **stock**
> (sin cuantizar, sin reentrenar), inferencia **100% en el navegador** con
> ONNX Runtime Web (WASM), y comparación contra **Chandra/Datalab** como
> verdad de terreno de la página 1 del E-14.

## 1. Resumen ejecutivo

- PP-DocLayout corre entero en el navegador del celular (Chrome Android,
  SM-A566E) con WASM multihilo. **WebGPU no está disponible** ni en el PC ni
  en el celular para estos modelos; no planificar sobre WebGPU.
- **plus-L** (RT-DETR-L, 800 px, 129,7 MB) es preciso pero lento: 5–9 s de
  inferencia por página en el celular.
- **S** (PicoDet-S, 480 px, 4,9 MB) es ~15× más rápido (0,38 s/página en el
  celular) pero devuelve bloques **fusionados** y no clasifica tablas como
  `table`.
- Con las reglas estructurales E-14 sobre plus-L se alcanzó **19/19 bloques
  contra Chandra (P = R = F1 = 1.0)** en la página 1. El mismo modelo sin
  reglas queda en F1 0.75 (stock 0.5) y 0.842 (0.4 + NMS).
- La ganancia no viene de un modelo mejor: viene de **usar la estructura
  conocida** (zonas, conteos esperados, división de contenedores) para
  seleccionar detecciones de baja confianza y corregir fusiones.
- `Todas reales.pdf` confirma el patrón: las 3 portadas E-14 quedan con
  17/17/19 bloques; los 3 reversos (constancias/firmas) son otra plantilla y
  solo exponen la cabecera (12 bloques cada uno). No inventa tablas falsas.
- El post-proceso estructural cuesta **0,3–16,5 ms por página** en el
  celular: es gratis frente a la inferencia.

## 2. Entorno y modelos

| Elemento | Detalle |
|---|---|
| Runtime | ONNX Runtime Web 1.31.1, backend WASM, 8 hilos (`SharedArrayBuffer`) |
| Aislamiento | COOP/COEP en servidor local (`127.0.0.1:8787`) |
| Render | pdf.js 6.5.438, escala 2, lado máximo 2048 px |
| Celular | Samsung SM-A566E, Chrome Android, `adb reverse tcp:8787` |
| PC | Windows 10, Chrome headless, `--disable-*throttling` |
| Modelo S | `pp_doclayout_s.onnx`, 4.917.852 B, sha256 `33688dbee1c23e34b81777e97cb428eb40f24b242c02b5f623484959e830aec8` |
| Modelo plus-L | `pp_doclayout_plus_l.onnx`, 129.736.329 B, sha256 `77afb2caa74dd13240d087d2eced91d7fcd2caebd16006a0a66162fc8707ff0e` |

Clases canónicas usadas por las reglas (plus-L, 20):
`paragraph_title, image, text, number, abstract, content, figure_title,
formula, table, reference, doc_title, footnote, header, algorithm, footer,
seal, chart, formula_number, aside_text, reference_content`.

S tiene 23 clases (incluye `table_title`, `chart_title`, `header_image`,
`footer_image`). Los nombres que comparten semántica (`text`, `image`,
`table`, `doc_title`, `paragraph_title`, `figure_title`, `number`, `header`,
`footer`) son los que usan las reglas.

## 3. Contratos de inferencia (lo que costó calibrar)

### plus-L (RT-DETR)

Entradas:

```js
image      float32 [1,3,800,800]  RGB, valores 0..1 (/255)   // NO ImageNet mean/std
im_shape   float32 [1,2]         [800,800]                   // tamaño de entrada, NO [h,w] original
scale_factor float32 [1,2]       [800/h, 800/w]
```

Salidas:

- `fetch_name_0`: `[300,6]` filas `[cls, score, x1, y1, x2, y2]` ya en
  coordenadas de la imagen original.
- `fetch_name_1`: `[1]` = 300 (número de queries, **no** un conteo filtrado).
- **El ONNX exportado NO trae NMS**: hay que aplicarlo. Se usó NMS
  clase-agnóstico con IoU 0.5.

Regla observada de decodificación: `salida = caja_normalizada × im_shape /
scale_factor`.

Errores que se descartaron con evidencia:

| Intento | Resultado |
|---|---|
| Preprocesar 0–255 | max score 0.081; todo mal |
| `im_shape = [h,w]` original | coordenadas fuera de la página (y ≈ 5137 en lienzo de 2048) |
| Sin NMS | duplicados entre clases (0.2 → 73 cajas; 43 con NMS) |

Conteo de cajas en E-14 página 1 (plus-L, NMS 0.5):
`0.2 → 43`, `0.3 → 25`, `0.4 → 19`, `0.5 → 13`.

### S (PicoDet)

Entradas:

```js
image        float32 [1,3,480,480]  RGB con media/desvío ImageNet
scale_factor float32 [1,2]          [480/h, 480/w]
```

Salida `[100,6]` con NMS ya horneado y umbral interno 0.3. Devuelve como
máximo 100 cajas.

## 4. Rendimiento medido

| Escenario | Modelo | Equipo | Inferencia/página | Página completa |
|---|---|---|---|---|
| E-14 2 págs | plus-L | celular | ~5,8 s | 5,9 s/pág (11,86 s total) |
| `Todas reales` 6 págs | plus-L | celular | 5,0–9,3 s | 29,3 s total (4,56 s/pág) |
| E-14 2 págs | S | celular | 0,38 s | ~0,5 s/pág (incluye render) |
| `Todas reales` 6 págs | S | celular | ~0,75 s | 4,49 s total |
| E-14 2 págs | plus-L | PC | ~13,2 s | 27,7 s total |
| E-14 2 págs | S | PC | ~0,67 s | 1,34 s total |

Post-proceso estructural (reglas E-14): **0,3–16,5 ms** por página en el
celular.

Presupuesto de descarga offline: el runtime WASM de ORT pesa ~15 MB (el
paquete `dist` completo son 141 MB, pero solo se sirve un `.wasm`); S 4,9 MB;
Tesseract core + `spa` ~20 MB. Total app + S + OCR ≈ 45–60 MB. plus-L suma
129,7 MB y debe ser descarga opcional.

## 5. Precisión contra Chandra (E-14 página 1, 19 bloques GT)

Match uno-a-uno, codicioso por score, con IoU ≥ 0.5 **o** contención ≥ 0.8.

| Estrategia | Aciertos | Cajas | Precisión | Recall | F1 |
|---|---|---|---|---|---|
| plus-L stock 0.5 | 12/19 | 13 | 0.923 | 0.632 | 0.750 |
| plus-L 0.4 + NMS 0.5 | 16/19 | 19 | 0.842 | 0.842 | 0.842 |
| **plus-L + estructura E-14** | **19/19** | **19** | **1.000** | **1.000** | **1.000** |
| S 0.3 + NMS 0.5 | 11/19 | 16 | 0.688 | 0.579 | 0.629 |
| S + estructura (pool 0.1) | 8/19 | 8 | 1.000 | 0.421 | 0.593 |

Lo que recupera la estructura frente a 0.4 + NMS: `CÓNSUL/EMBAJADOR`
(0.30), `E-14` (0.33) y `REGISTRADURÍA` (0.23) caían bajo 0.5; con umbral
0.2 dentro de su zona entran sin falsos positivos. El contenedor único de
candidatos se parte en dos con el corte de plantilla `0.544·H` (IoU 0.95 y
0.97 contra las tablas reales).

## 6. Reglas estructurales E-14 (prototipo validado)

Implementación de referencia: `docs/investigacion/pp-doclayout/estructura-e14.js`
(prototipo) y `layoutE14()` en el banco de pruebas (ver §10).

Parámetros:

- Pool de detecciones: todas las queries de plus-L; score mínimo 0.2
  (0.15 solo en la franja de títulos).
- Pertenencia a zona: la caja debe caer dentro de la zona con **margen del
  2%** de ancho/alto. El margen fue clave en `Todas reales`: sin él se
  perdían candidatos, votos y consulado por 4–30 px.
- NMS interno de títulos y footers: IoU 0.5, hasta 3 cajas.
- `barcode_text`: texto pequeño (alto ≤ 2% de la página) bajo el código de
  barras y con IoU < 0.3 contra la caja del código (evita que el propio
  código se etiquete como número).
- Los títulos excluyen la caja del número de barras (identidad o IoU ≥ 0.5).
- Candidatos: se toma el contenedor más grande de la zona y se parte en
  `0.544·H`.

Zonas y resultado esperado (página 1):

| Zona | Regla | Clases | Esperado |
|---|---|---|---|
| footer | y ≥ 0.95H | footer | 3 |
| barcode | x 0.2–0.8W, y 0–0.045H, ancho ≥ 0.3W | header/image/paragraph_title | 1 |
| barcode_text | y 0.043–0.06H, alto ≤ 0.02H | text/header/paragraph_title/doc_title | 1 |
| version | x ≥ 0.7W, y 0–0.065H | text/header | 1 |
| qr | x 0–0.35W, y 0.05–0.15H | image | 1 |
| title | x 0.25–0.75W, y 0.055–0.14H | doc_title/paragraph_title/text | 3 |
| e14 | x 0.7–0.95W, y 0.055–0.09H | text/image/header/doc_title | 1 |
| registraduria_logo | x 0.72–0.88W, y 0.09–0.125H | image | 1 |
| registraduria_text | x 0.7–0.92W, y 0.118–0.14H | text/header | 1 |
| consulado | x 0.05–0.7W, y 0.14–0.205H | text | 1 |
| xline | x 0.25–0.75W, y 0.205–0.235H | figure_title/text/number | 1 |
| nivelacion | x 0.03–0.95W, y 0.23–0.36H, ancho ≥ 0.5W | table | 1 |
| candidato1/2 | x 0.03–0.95W, y 0.36–0.7H, contenedor ≥ 0.5W × 0.25H | image/table/content | 2 (split 0.544H) |
| votos | x 0.03–0.95W, y 0.7–0.86H, ancho ≥ 0.5W | table | 1 |

## 7. Generalización: `Todas reales.pdf` (6 páginas)

Corrida plus-L en el celular (`phone-mwrgbc5g`), 1.800 detecciones crudas:

| Página | Tipo | Bloques | Zonas |
|---|---|---|---|
| 1 | portada E-14 | 17 | todas menos logo/texto Registraduría |
| 2 | reverso (constancias) | 12 | solo cabecera + consulado + línea X |
| 3 | portada E-14 | 17 | todas menos logo/texto Registraduría |
| 4 | reverso | 12 | solo cabecera + consulado + línea X |
| 5 | portada E-14 | 19 | todas |
| 6 | reverso | 12 | solo cabecera + consulado + línea X |

Los reversos son otra plantilla: las reglas E-14 no aplican y **no producen
falsos positivos** (no inventan tablas). Necesitan su propio juego de zonas
si se quiere cobertura total.

Límites observados en portada:

- En páginas 1 y 5 la línea central del título se detecta como el sello
  `TRANSMISIÓN` (encima de `CÓNSUL/EMBAJADOR`); en la 3 sí se toma
  `CÓNSUL/EMBAJADOR`.
- El número de barras se confundía con el bloque del código; corregido con
  alto máximo + exclusión por IoU.

Regresión: el PDF original de 2 páginas sigue en **19/19** con las mismas
cajas (`phone-mwrgcwsx`).

## 8. Prueba específica de S con estructura

S **no** reproduce la estructura fina del E-14 con las reglas actuales:

- Detecta el contenido completo de la página como una sola `image` (score
  0.51, caja 26,−5 → 636,1744).
- El bloque de títulos es **una sola caja** `text` (y 119–273), no 3 líneas.
- Nivelación aparece como `text` (y 439–729); votos como `text` (y
  1459–1722); **no hay clase `table`**.
- E-14 + logo + texto Registraduría aparecen fusionados como una `image`
  (x 491–626, y 99–273).

Por eso las reglas (que buscan `table` y líneas de título) solo recuperan
8/19. Pero las detecciones fusionadas **sí contienen** la información: el
camino para S es partir contenedores por plantilla (título en 3 cortes
relativos; E-14/logo/texto en cortes conocidos) y aceptar `text` como tabla
con restricciones de tamaño. Ese experimento es la Fase 0 del plan; hoy S
queda como pre-gate rápido o propuesta gruesa, no como validador fino.

## 9. Implicaciones de producto

1. **La estructura conocida es la palanca de precisión.** El molde debe
   poder declarar reglas estructurales (zonas, conteos, divisiones), no solo
   campos OCR.
2. **S y plus-L tienen roles distintos.** S: gate rápido, autoría gruesa,
   dispositivos modestos. plus-L: validación fina opcional.
3. **La autoría visual debe permitir partir/fusionar bloques.** Los modelos
   fusionan títulos y tablas; el usuario necesita corregirlo una vez y que
   quede como regla del molde.
4. **Todo puede quedarse local.** Modelo, molde y foto en el celular; sin
   subir documentos.

## 10. Artefactos y reproducción

Banco de pruebas original:
`C:\Users\JG\Documents\PROYECTOS\pruebas\pp-doclayout-test`

Copias de referencia en este repo:
`docs/investigacion/pp-doclayout/`

- `estructura-e14.js` — reglas y métricas contra Chandra (configurable por
  variables `RUN`, `POOL_T`, `MIN`, `OUT`, etc.).
- `bench-phone.js`, `bench-pc.js` — lanzadores de Chrome con `autorun`.
- `estructura-e14-result.json` — salida plus-L (19/19).
- `estructura-e14-s-result.json` — salida S (8/19).
- `e14-p1-chandra-gt.json` — 19 bloques GT normalizados (0..1).
- `e14-p1-plusL-19de19.png` — overlay plus-L 19/19.
- `todas-reales-p5-plusL-19bloques.png` — portada más completa.

Comandos (desde el banco de pruebas, con el servidor y los modelos):

```bash
node server.js
node bench-phone.js "exterior delegados molde plantilla escaneada.pdf" wasm 1 1 plusL "layout=e14"
node bench-phone.js "Todas reales.pdf" wasm 1 0 plusL "layout=e14"
node bench-phone.js "exterior delegados molde plantilla escaneada.pdf" wasm 1 1 s "layout=e14"
```

Corridas clave en `results.jsonl` del banco: `phone-mwrgcwsx` (plus-L
19/19), `phone-mwrgbc5g` (Todas reales plus-L), `phone-mwrgvnap` (S layout),
`phone-mwrgw19y` (S barrido de umbral), `phone-mwrf3lq0` y `phone-mwrfakmk`
(plus-L sin/con NMS).

## 11. Límites del dossier

- Chandra solo cubre la página 1 del PDF fácil; `Todas reales` se evaluó por
  inspección visual, no con GT.
- Las reglas son de la plantilla E-14; los reversos y otros documentos
  requieren reglas propias.
- No se probó en iOS/Safari; WASM multihilo y COOP/COEP pueden variar.
- Licencia de los modelos: verificar y conservar atribución (PaddleOCR /
  PP-DocLayout) antes de redistribuirlos en la PWA.
