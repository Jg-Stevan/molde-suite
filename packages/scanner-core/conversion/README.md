# conversion/ — serializador datalab-like (Chandra) 100 % on-device

Convierte la salida del pipeline Tamiz (regiones de layout + líneas OCR +
recortes) al **esquema exacto de datalab-convert** (Chandra OCR de Datalab),
con exports **JSON + MD + HTML**. Cero dependencias, TypeScript puro: corre en
el worker del navegador, en Node y en bun.

**Declarado OFICIAL por el dueño (2026-11-27)** — cierre del Benchmark OCR V3
(`PLAN-BENCHMARK-V3.md` / `INFORME-BENCHMARK-V3.md`). La decisión Q3 fue:
la lectura `.md`/`.html` estructurada es viable offline-first y **refuerza al
molde** (no lo sustituye).

## Resultado de la verificación de paridad (cierre 2026-11-27)

Comparador contra el GT datalab-convert real (11 chequeos por documento:
metadata, ids, secuencia block_type, bbox por bloque, section_hierarchy, html
por bloque, recortes, data-bbox de firmas, page.html, markdown char-a-char,
html export):

| Documento | Paridad |
|---|---|
| Comprobante de entrega (E-2) | **100 %** — markdown char-a-char idéntico |
| Acta E-26 (3 tablas de votos) | **100 %** — markdown char-a-char idéntico |

El banco de verificación (entradas espejo + GT) no se versiona aquí: las
imágenes del dataset real quedan gitignored por doctrina de privacidad. El
módulo es puro y sin estado: el comparador corre desde cualquier carpeta
importando `./index`.

## Qué es cada archivo

```
types.ts       Esquema de salida (BloqueChandra/PaginaChandra/ConversionChandra)
               + interfaces de entrada del pipeline (SalidaPipeline/RegionLayout/
               LineaOcr/Retricula/RecorteImagen)
serializar.ts  Orquestador: convertirAChandra(), pareceChandraPropio(),
               convertirTodo() (JSON+MD+HTML en una llamada, con autochequeo)
lectura.ts     Orden de lectura formalizado (molde explícito > geometría top-down;
               header/footer fuera de flujo)
html.ts        Emisores de HTML por bloque con las convenciones datalab
tablas.ts      Retícula SPARTAN + líneas OCR → <table> con colspan por bandas
               de fila, th por molde, negrita por fila (fila TOTAL)
md.ts          Export markdown (reglas calibradas char-a-char contra el GT)
exportHtml.ts  Export HTML (fragmento con sangría, data URIs inline)
recortes.ts    Crops firma/sello/imagen → JPEG base64 (OffscreenCanvas en
               worker, canvas 2d en main thread)
md5.ts         MD5 puro sin deps para los nombres `{hash}_img.jpg` + helpers base64
```

## Convenciones del formato datalab-convert (ingeniería inversa verificada)

- **Estructura**: `{ children: [Page], metadata: { page_stats, failed_pages } }`.
- **Ids**: `/page/{p}/{Tipo}/{n}` contador por página en orden de lectura.
- **Claves de bloque hoja en este orden**: id, block_type, html, page, polygon,
  bbox, section_hierarchy, images, markdown, inference_failed, metadata.
- **polygon**: [[x0,y0],[x1,y0],[x1,y1],[x0,y1]] enteros. **html** con `<br/>`
  y `<b>` compartido entre líneas consecutivas en negrita.
- **section_hierarchy**: mapa nivel→id de secciones abiertas; un SectionHeader
  lleva el mapa ANTES de abrirse él mismo.
- **page.html** y los exports MD/HTML excluyen PageHeader/PageFooter; el MD
  usa tablas pipe con **ancho = max(len del contenido CRUDO) + 2** (el
  `<b>...</b>` NO se convierte a `**` dentro de las celdas — quirk datalab).
- **Recortes**: `{md5-de-los-bytes}_img.jpg` en `images` del bloque; firma
  inline con `data-bbox="x0 y0 x1 y1"` + caption tras `<br/>`.
- El hash de datalab NO es derivable de los bytes: usamos md5 de los bytes
  (mismo formato, determinista, deduplica recortes idénticos).

## Consumo en Tamiz (integrado)

`apps/tamiz/src/lib/e14/conversion/chandra-bridge.ts` construye el
`SalidaPipeline` desde el acta real (OCR del proveedor Tamiz + regiones
sintetizadas: campos del molde con su rect medido + bandas de líneas restantes
+ recortes de firma) y llama `convertirTodo`. El botón **EXPORTAR CONVERSIÓN**
en la revisión descarga el JSON (consumible por `importar-chandra.ts` de Molde
Studio — el loop «escanear en el celular → recalibrar molde sin Datalab») y
opcionalmente `.md`/`.html`.

## Fases siguientes (documentadas, no implementadas aquí)

- **Cascada S→plus-L**: el serializador es agnóstico del modelo; las regiones
  llegan post-cascada (PP-DocLayout S via `dla-onnx` cuando el flag esté ON).
- **Manuscrito**: la bandera `manuscrito` (D-FINE) viaja en `RegionLayout`;
  la lectura de handwriting con calidad Chandra sigue sin ser viable en WASM
  (TrOCR ~334M fuera del heap del navegador) — honestidad declarada.
