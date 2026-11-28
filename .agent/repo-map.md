# Mapa de repositorio (generado por scripts/agent-map.ts)

> Determinista: orden alfabético, rutas relativas al repo, sin timestamps.
> Dos ejecuciones seguidas sin cambios de código producen diff vacío.
> Regenerar con `bun run agent:map`. Índice limitado a packages/* (la API compartida).

## 1. Grafo de dependencias entre workspaces

| Workspace | Ruta | Depende de (workspace:*) |
|---|---|---|
| `@jg-stevan/dla-onnx` | `packages/dla-onnx` | — |
| `@jg-stevan/layout-core` | `packages/layout-core` | `@molde-suite/scanner-core` |
| `@molde-suite/scanner-core` | `packages/scanner-core` | — |
| `docutemplate-studio` | `apps/molde-studio` | `@jg-stevan/dla-onnx`, `@jg-stevan/layout-core`, `@molde-suite/scanner-core` |
| `tamiz` | `apps/tamiz` | `@jg-stevan/dla-onnx`, `@jg-stevan/layout-core`, `@molde-suite/scanner-core` |

## 2. Índice de símbolos exportados (packages/*)

### packages/dla-onnx/src/casillas.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `crearDetectorCasillas` | function | 15 | `() => Promise<{ detectar: (canvas: HTMLCanvasElement, confMin?: number) => Promise<{}>; }>` |
| `DeteccionCasilla` | interface | 9 | `any` |

### packages/dla-onnx/src/index.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `bandasDesdeRegiones` | function | 9 | `(regiones: {}) => { sup: { y0: number; y1: number; }; inf: { y0: number; y1: number; }; }` |
| `Caja` | interface | 4 | `any` |
| `configuracionLista` | function | 9 | `(key: string \| number \| symbol) => boolean` |
| `configurarModelo` | function | 9 | `(key: string \| number \| symbol, url: string) => void` |
| `crearDetector` | function | 9 | `(key: string \| number \| symbol) => Promise<Detector>` |
| `crearDetectorCasillas` | function | 9 | `() => Promise<{ detectar: (canvas: HTMLCanvasElement, confMin?: number) => Promise<{}>; }>` |
| `crearDetectorLayout` | function | 9 | `() => Promise<{ detectar: (canvas: HTMLCanvasElement, confMin?: number) => Promise<{}>; }>` |
| `crearDetectorManuscrito` | function | 9 | `() => Promise<{ detectar: (canvas: HTMLCanvasElement, confMin?: number) => Promise<{}>; }>` |
| `Deteccion` | interface | 9 | `any` |
| `DeteccionCasilla` | interface | 9 | `any` |
| `MensajeWorker` | typealias | 9 | `any` |
| `PresetKey` | typealias | 9 | `any` |
| `PresetOnnx` | interface | 9 | `any` |
| `PRESETS` | variable | 9 | `Record<"casillas" \| "layout" \| "manuscrito", PresetOnnx>` |
| `regionesManuscritas` | function | 9 | `(canvas: HTMLCanvasElement) => Promise<{}>` |
| `RespuestaWorker` | typealias | 9 | `any` |
| `urlModelo` | function | 9 | `(key: string \| number \| symbol) => string` |

### packages/dla-onnx/src/manuscrito.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `crearDetectorManuscrito` | function | 10 | `() => Promise<{ detectar: (canvas: HTMLCanvasElement, confMin?: number) => Promise<{}>; }>` |
| `regionesManuscritas` | function | 19 | `(canvas: HTMLCanvasElement) => Promise<{}>` |

### packages/dla-onnx/src/regiones.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `bandasDesdeRegiones` | function | 24 | `(regiones: {}) => { sup: { y0: number; y1: number; }; inf: { y0: number; y1: number; }; }` |
| `crearDetectorLayout` | function | 10 | `() => Promise<{ detectar: (canvas: HTMLCanvasElement, confMin?: number) => Promise<{}>; }>` |

### packages/dla-onnx/src/runtime.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `configuracionLista` | function | 36 | `(key: string \| number \| symbol) => boolean` |
| `configurarModelo` | function | 13 | `(key: string \| number \| symbol, url: string) => void` |
| `crearDetector` | function | 48 | `(key: string \| number \| symbol) => Promise<Detector>` |
| `Deteccion` | exportspecifier | 108 | `any` |
| `PresetKey` | exportspecifier | 108 | `any` |
| `PRESETS` | exportspecifier | 107 | `Record<"casillas" \| "layout" \| "manuscrito", PresetOnnx>` |
| `urlModelo` | function | 18 | `(key: string \| number \| symbol) => string` |

### packages/dla-onnx/src/tipos.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `Caja` | interface | 8 | `any` |
| `Deteccion` | interface | 17 | `any` |
| `MensajeWorker` | typealias | 75 | `any` |
| `PresetKey` | typealias | 71 | `any` |
| `PresetOnnx` | interface | 26 | `any` |
| `PRESETS` | variable | 43 | `Record<"casillas" \| "layout" \| "manuscrito", PresetOnnx>` |
| `RespuestaWorker` | typealias | 80 | `any` |

### packages/layout-core/src/clases.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `CLASES_CANONICAS` | variable | 12 | `{}` |
| `esCanonica` | function | 26 | `(c: string) => c is ClaseLayout` |
| `normalizarClase` | function | 86 | `(c: string) => string` |

### packages/layout-core/src/evaluar.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `BANDA_BAJA` | variable | 34 | `0.05` |
| `conModelo` | function | 263 | `(res: ResultadoEstructura, modelo: ModeloLayout) => ResultadoEstructura` |
| `DEFAULT_MARGEN` | variable | 31 | `0.02` |
| `DEFAULT_MIN_SCORE` | variable | 33 | `0.2` |
| `DEFAULT_NMS_INTERNO` | variable | 32 | `0.5` |
| `evaluarEstructura` | function | 194 | `(detecciones: {}, reglas: {}, W: number, H: number, opts?: OpcionesEstructura) => ResultadoEstructura` |
| `iou` | exportspecifier | 268 | `(a: RectXYXY, b: RectXYXY) => number` |

### packages/layout-core/src/geom.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `area` | function | 12 | `(a: RectXYXY) => number` |
| `clamp01` | function | 34 | `(v: number) => number` |
| `clampPagina` | function | 40 | `<T extends RectXYXY>(c: T, w: number, h: number) => T` |
| `contencion` | function | 29 | `(a: RectXYXY, b: RectXYXY) => number` |
| `inter` | function | 16 | `(a: RectXYXY, b: RectXYXY) => number` |
| `iou` | function | 22 | `(a: RectXYXY, b: RectXYXY) => number` |
| `RectXYXY` | interface | 5 | `any` |

### packages/layout-core/src/index.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `area` | function | 7 | `(a: RectXYXY) => number` |
| `BANDA_BAJA` | exportspecifier | 17 | `0.05` |
| `CajaConScore` | exportspecifier | 8 | `any` |
| `CajaLayout` | interface | 18 | `any` |
| `clamp01` | function | 23 | `(v: number) => number` |
| `clampPagina` | function | 23 | `<T extends RectXYXY>(c: T, w: number, h: number) => T` |
| `ClaseLayout` | exportspecifier | 10 | `any` |
| `CLASES_CANONICAS` | exportspecifier | 7 | `{}` |
| `conModelo` | exportspecifier | 16 | `(res: ResultadoEstructura, modelo: ModeloLayout) => ResultadoEstructura` |
| `contencion` | function | 23 | `(a: RectXYXY, b: RectXYXY) => number` |
| `ContratoModeloLayout` | exportspecifier | 12 | `any` |
| `DEFAULT_MARGEN` | exportspecifier | 18 | `0.02` |
| `DEFAULT_MIN_SCORE` | exportspecifier | 19 | `0.2` |
| `DEFAULT_NMS_INTERNO` | exportspecifier | 20 | `0.5` |
| `DeteccionLayout` | interface | 23 | `any` |
| `esCanonica` | exportspecifier | 7 | `(c: string) => c is ClaseLayout` |
| `evaluarEstructura` | exportspecifier | 15 | `(detecciones: {}, reglas: {}, W: number, H: number, opts?: OpcionesEstructura) => ResultadoEstructura` |
| `inter` | function | 11 | `(a: RectXYXY, b: RectXYXY) => number` |
| `iou` | function | 22 | `(a: RectXYXY, b: RectXYXY) => number` |
| `LayoutEngine` | interface | 23 | `any` |
| `matchVsGt` | exportspecifier | 22 | `<P extends RectXYXY & { score?: number; }, G extends RectXYXY>(preds: {}, gts: {}, minIou?: number, minCont?: number) => { tp: number; pairs: {}; }` |
| `metricas` | exportspecifier | 22 | `<P extends RectXYXY & { score?: number; }, G extends RectXYXY>(preds: {}, gts: {}, minIou?: number, minCont?: number) => MetricasMatch` |
| `MetricasMatch` | exportspecifier | 22 | `any` |
| `metricasVacias` | exportspecifier | 22 | `(gt: {}) => MetricasMatch` |
| `ModeloLayout` | typealias | 11 | `any` |
| `MODELOS_LAYOUT` | exportspecifier | 10 | `Record<ModeloLayout, ContratoModeloLayout>` |
| `nmsClaseAgnostico` | exportspecifier | 8 | `<T extends CajaConScore>(cajas: {}, iouUmbral: number) => {}` |
| `normalizarClase` | exportspecifier | 7 | `(c: string) => string` |
| `OpcionesEstructura` | interface | 23 | `any` |
| `ParteReglaLayout` | interface | 23 | `any` |
| `RectXYXY` | interface | 5 | `any` |
| `ReglaLayout` | exportspecifier | 11 | `any` |
| `ResultadoEstructura` | interface | 23 | `any` |
| `ResultadoReglaLayout` | interface | 23 | `any` |
| `verificarContratoModelo` | exportspecifier | 11 | `(id: ModeloLayout, bytesReales: number, sha256Real: string) => boolean` |

### packages/layout-core/src/matcher.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `CajaGT` | interface | 8 | `any` |
| `matchVsGt` | function | 36 | `<P extends RectXYXY & { score?: number; }, G extends RectXYXY>(preds: {}, gts: {}, minIou?: number, minCont?: number) => { tp: number; pairs: {}; }` |
| `metricas` | function | 66 | `<P extends RectXYXY & { score?: number; }, G extends RectXYXY>(preds: {}, gts: {}, minIou?: number, minCont?: number) => MetricasMatch` |
| `MetricasMatch` | interface | 22 | `any` |
| `metricasVacias` | function | 87 | `(gt: {}) => MetricasMatch` |
| `ParMatch` | interface | 15 | `any` |

### packages/layout-core/src/modelos.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `ContratoModeloLayout` | interface | 37 | `any` |
| `ContratoPreproceso` | interface | 11 | `any` |
| `ContratoSalida` | interface | 24 | `any` |
| `MODELOS_LAYOUT` | variable | 53 | `Record<ModeloLayout, ContratoModeloLayout>` |
| `verificarContratoModelo` | function | 110 | `(id: ModeloLayout, bytesReales: number, sha256Real: string) => boolean` |

### packages/layout-core/src/nms.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `CajaConScore` | interface | 10 | `any` |
| `nmsClaseAgnostico` | function | 19 | `<T extends CajaConScore>(cajas: {}, iouUmbral: number) => {}` |

### packages/layout-core/src/tipos.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `CajaLayout` | interface | 14 | `any` |
| `ClaseLayout` | exportspecifier | 8 | `any` |
| `DeteccionLayout` | interface | 25 | `any` |
| `LayoutEngine` | interface | 77 | `any` |
| `ModeloLayout` | typealias | 11 | `any` |
| `OpcionesEstructura` | interface | 83 | `any` |
| `ParteReglaLayout` | interface | 36 | `any` |
| `ReglaLayout` | exportspecifier | 8 | `any` |
| `ResultadoEstructura` | interface | 61 | `any` |
| `ResultadoReglaLayout` | interface | 43 | `any` |

### packages/scanner-core/conversion/exportHtml.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `exportarHtml` | function | 80 | `(conv: ConversionChandra) => string` |

### packages/scanner-core/conversion/html.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `escapar` | function | 15 | `(texto: string) => string` |
| `htmlFirmaInline` | function | 101 | `(recorte: RecorteImagen, filename: string, caption: string) => string` |
| `htmlPicture` | function | 89 | `(filename: string) => string` |
| `htmlPie` | function | 84 | `(lineas: {}) => string` |
| `htmlSeccion` | function | 74 | `(nivel: number, lineas: {}) => string` |
| `htmlTexto` | function | 53 | `(lineas: {}, opts?: OpcionesTexto) => string` |
| `OpcionesTexto` | interface | 47 | `any` |
| `unirLineas` | function | 27 | `(lineas: {}) => string` |

### packages/scanner-core/conversion/index.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `armarTabla` | exportspecifier | 15 | `(ret: Retricula, lineas: {}, bbox: BBox, opts?: OpcionesTabla) => { html: string; estructura: TablaEstructurada; }` |
| `base64ABytes` | exportspecifier | 33 | `(b64: string) => Uint8Array` |
| `BBox` | typealias | 36 | `any` |
| `bitmapDesdeBytes` | exportspecifier | 27 | `(bytes: Uint8Array, tipo?: string) => Promise<any>` |
| `BloqueChandra` | interface | 36 | `any` |
| `bytesABase64` | exportspecifier | 32 | `(bytes: Uint8Array) => string` |
| `CLASES_FOOTER` | exportspecifier | 21 | `{}` |
| `CLASES_HEADER` | exportspecifier | 20 | `{}` |
| `ConversionChandra` | interface | 36 | `any` |
| `convertirAChandra` | exportspecifier | 8 | `(pipeline: SalidaPipeline, opciones?: OpcionesConversion) => ConversionChandra` |
| `convertirTodo` | exportspecifier | 9 | `(pipeline: SalidaPipeline, opciones?: OpcionesConversion) => { json: ConversionChandra; jsonTexto: string; md: string; html: string; chequeo: ChequeoEsquema; }` |
| `escapar` | exportspecifier | 35 | `(texto: string) => string` |
| `esFooter` | exportspecifier | 18 | `(r: RegionLayout) => boolean` |
| `esHeader` | exportspecifier | 19 | `(r: RegionLayout) => boolean` |
| `exportarHtml` | exportspecifier | 14 | `(conv: ConversionChandra) => string` |
| `exportarMarkdown` | exportspecifier | 13 | `(conv: ConversionChandra) => string` |
| `htmlDeEstructura` | exportspecifier | 15 | `(estructura: TablaEstructurada) => string` |
| `htmlFirmaInline` | exportspecifier | 35 | `(recorte: RecorteImagen, filename: string, caption: string) => string` |
| `htmlPicture` | exportspecifier | 35 | `(filename: string) => string` |
| `htmlSeccion` | exportspecifier | 35 | `(nivel: number, lineas: {}) => string` |
| `htmlTexto` | exportspecifier | 35 | `(lineas: {}, opts?: OpcionesTexto) => string` |
| `LineaOcr` | interface | 36 | `any` |
| `MAPEO_CLASES` | exportspecifier | 11 | `Record<string, string>` |
| `md5Hex` | exportspecifier | 30 | `(bytes: Uint8Array) => string` |
| `nombreArchivoImagen` | exportspecifier | 31 | `(jpegBytes: Uint8Array) => string` |
| `OpcionesConversion` | interface | 36 | `any` |
| `ordenarRegiones` | exportspecifier | 17 | `(regiones: {}) => {}` |
| `PaginaChandra` | interface | 36 | `any` |
| `PaginaPipeline` | interface | 36 | `any` |
| `pareceChandraPropio` | exportspecifier | 10 | `(conv: ConversionChandra) => ChequeoEsquema` |
| `Punto` | typealias | 6 | `any` |
| `recortarConCanvas` | exportspecifier | 25 | `(fuente: CanvasImageSource, bbox: BBox, calidad?: number) => Promise<string>` |
| `recortarConOffscreen` | exportspecifier | 24 | `(fuente: CanvasImageSource, bbox: BBox, calidad?: number) => Promise<string>` |
| `recortarTodos` | exportspecifier | 26 | `(fuente: CanvasImageSource, regiones: {}, calidad?: number) => Promise<number>` |
| `RecorteImagen` | interface | 36 | `any` |
| `RegionLayout` | interface | 36 | `any` |
| `Retricula` | interface | 36 | `any` |
| `SalidaPipeline` | interface | 36 | `any` |
| `SegmentoV` | interface | 36 | `any` |

### packages/scanner-core/conversion/lectura.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `CLASES_FOOTER` | variable | 20 | `{}` |
| `CLASES_HEADER` | variable | 19 | `{}` |
| `esFooter` | function | 26 | `(r: RegionLayout) => boolean` |
| `esHeader` | function | 22 | `(r: RegionLayout) => boolean` |
| `ordenarRegiones` | function | 34 | `(regiones: {}) => {}` |

### packages/scanner-core/conversion/md.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `exportarMarkdown` | function | 124 | `(conv: ConversionChandra) => string` |
| `tablaAMd` | function | 61 | `(htmlTabla: string) => string` |

### packages/scanner-core/conversion/md5.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `base64ABytes` | function | 90 | `(b64: string) => Uint8Array` |
| `bytesABase64` | function | 80 | `(bytes: Uint8Array) => string` |
| `md5Hex` | function | 27 | `(bytes: Uint8Array) => string` |
| `nombreArchivoImagen` | function | 72 | `(jpegBytes: Uint8Array) => string` |

### packages/scanner-core/conversion/recortes.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `bitmapDesdeBytes` | function | 24 | `(bytes: Uint8Array, tipo?: string) => Promise<any>` |
| `FuenteImagen` | interface | 14 | `any` |
| `recortarConCanvas` | function | 89 | `(fuente: CanvasImageSource, bbox: BBox, calidad?: number) => Promise<string>` |
| `recortarConOffscreen` | function | 80 | `(fuente: CanvasImageSource, bbox: BBox, calidad?: number) => Promise<string>` |
| `recortarTodos` | function | 101 | `(fuente: CanvasImageSource, regiones: {}, calidad?: number) => Promise<number>` |

### packages/scanner-core/conversion/serializar.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `armarTabla` | exportspecifier | 32 | `(ret: Retricula, lineas: {}, bbox: BBox, opts?: OpcionesTabla) => { html: string; estructura: TablaEstructurada; }` |
| `base64ABytes` | exportspecifier | 36 | `(b64: string) => Uint8Array` |
| `BBox` | typealias | 31 | `any` |
| `bitmapDesdeBytes` | exportspecifier | 35 | `(bytes: Uint8Array, tipo?: string) => Promise<any>` |
| `BloqueChandra` | interface | 32 | `any` |
| `bytesABase64` | exportspecifier | 36 | `(bytes: Uint8Array) => string` |
| `ChequeoEsquema` | interface | 276 | `any` |
| `ConversionChandra` | interface | 48 | `any` |
| `convertirAChandra` | function | 251 | `(pipeline: SalidaPipeline, opciones?: OpcionesConversion) => ConversionChandra` |
| `convertirTodo` | function | 333 | `(pipeline: SalidaPipeline, opciones?: OpcionesConversion) => { json: ConversionChandra; jsonTexto: string; md: string; html: string; chequeo: ChequeoEsquema; }` |
| `escapar` | exportspecifier | 37 | `(texto: string) => string` |
| `esFooter` | exportspecifier | 31 | `(r: RegionLayout) => boolean` |
| `esHeader` | exportspecifier | 31 | `(r: RegionLayout) => boolean` |
| `exportarHtml` | exportspecifier | 34 | `(conv: ConversionChandra) => string` |
| `exportarMarkdown` | exportspecifier | 33 | `(conv: ConversionChandra) => string` |
| `htmlDeEstructura` | exportspecifier | 32 | `(estructura: TablaEstructurada) => string` |
| `htmlFirmaInline` | exportspecifier | 37 | `(recorte: RecorteImagen, filename: string, caption: string) => string` |
| `htmlPicture` | exportspecifier | 37 | `(filename: string) => string` |
| `htmlSeccion` | exportspecifier | 37 | `(nivel: number, lineas: {}) => string` |
| `htmlTexto` | exportspecifier | 37 | `(lineas: {}, opts?: OpcionesTexto) => string` |
| `LineaOcr` | interface | 60 | `any` |
| `MAPEO_CLASES` | variable | 40 | `Record<string, string>` |
| `md5Hex` | exportspecifier | 36 | `(bytes: Uint8Array) => string` |
| `nombreArchivoImagen` | exportspecifier | 36 | `(jpegBytes: Uint8Array) => string` |
| `OpcionesConversion` | interface | 165 | `any` |
| `ordenarRegiones` | exportspecifier | 31 | `(regiones: {}) => {}` |
| `PaginaChandra` | interface | 39 | `any` |
| `PaginaPipeline` | interface | 145 | `any` |
| `pareceChandraPropio` | function | 287 | `(conv: ConversionChandra) => ChequeoEsquema` |
| `Punto` | typealias | 12 | `any` |
| `recortarConCanvas` | exportspecifier | 35 | `(fuente: CanvasImageSource, bbox: BBox, calidad?: number) => Promise<string>` |
| `recortarConOffscreen` | exportspecifier | 35 | `(fuente: CanvasImageSource, bbox: BBox, calidad?: number) => Promise<string>` |
| `recortarTodos` | exportspecifier | 35 | `(fuente: CanvasImageSource, regiones: {}, calidad?: number) => Promise<number>` |
| `RecorteImagen` | interface | 94 | `any` |
| `RegionLayout` | interface | 110 | `any` |
| `Retricula` | interface | 75 | `any` |
| `SalidaPipeline` | interface | 163 | `any` |
| `SegmentoV` | interface | 93 | `any` |

### packages/scanner-core/conversion/tablas.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `armarTabla` | function | 56 | `(ret: Retricula, lineas: {}, bbox: BBox, opts?: OpcionesTabla) => { html: string; estructura: TablaEstructurada; }` |
| `CeldaTabla` | interface | 20 | `any` |
| `htmlDeEstructura` | function | 123 | `(estructura: TablaEstructurada) => string` |
| `OpcionesTabla` | interface | 33 | `any` |
| `TablaEstructurada` | interface | 27 | `any` |

### packages/scanner-core/conversion/types.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `BBox` | typealias | 19 | `any` |
| `BloqueChandra` | interface | 22 | `any` |
| `ConversionChandra` | interface | 49 | `any` |
| `LineaOcr` | interface | 63 | `any` |
| `OpcionesConversion` | interface | 159 | `any` |
| `PaginaChandra` | interface | 37 | `any` |
| `PaginaPipeline` | interface | 134 | `any` |
| `Punto` | typealias | 18 | `any` |
| `RecorteImagen` | interface | 92 | `any` |
| `RegionLayout` | interface | 106 | `any` |
| `Retricula` | interface | 72 | `any` |
| `SalidaPipeline` | interface | 151 | `any` |
| `SegmentoV` | interface | 85 | `any` |

### packages/scanner-core/core/calidad.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `calidadDeActa` | function | 19 | `(fotoProcesada: string) => Promise<PageQuality>` |
| `contrasteEfectivoDe` | function | 46 | `(q: PageQuality) => number` |
| `esquinasDeActa` | function | 67 | `(fotoProcesada: string) => Promise<{ completa: boolean; ladoEsquina: string; }>` |
| `scoreDeCalidad` | function | 54 | `(q: PageQuality) => number` |

### packages/scanner-core/core/canvas-imagen.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `canvasDesdeDataUrl` | function | 20 | `(dataUrl: string, opciones?: OpcionesCanvasDesdeDataUrl) => Promise<HTMLCanvasElement>` |
| `estirarContrasteEnCanvas` | function | 70 | `(c: HTMLCanvasElement) => void` |
| `grisesDesdeCanvas` | function | 54 | `(c: HTMLCanvasElement) => { g: Float32Array; w: number; h: number; }` |
| `OpcionesCanvasDesdeDataUrl` | typealias | 10 | `any` |
| `rotarDataUrl90` | function | 108 | `(dataUrl: string) => Promise<string>` |

### packages/scanner-core/core/detector-client.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `computeProcessDims` | function | 38 | `(videoW: number, videoH: number) => { w: number; h: number; }` |
| `DetectOutcome` | interface | 137 | `any` |
| `DocProfile` | typealias | 31 | `any` |
| `EnhanceMode` | typealias | 30 | `any` |
| `EnhanceOutcome` | interface | 154 | `any` |
| `getScannerWorker` | function | 532 | `() => ScannerWorkerClient` |
| `PROCESS_LONG_SIDE` | variable | 36 | `400` |
| `RawQualityInput` | interface | 52 | `any` |
| `ScannerWorkerClient` | class | 180 | `typeof ScannerWorkerClient` |
| `warmUpScannerWorker` | function | 551 | `() => void` |
| `WarpOutcome` | interface | 146 | `any` |

### packages/scanner-core/core/hash.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `sha256HexDeBytes` | function | 18 | `(bytes: Uint8Array<ArrayBuffer>) => Promise<string>` |
| `sha256HexDeDataUrl` | function | 34 | `(dataUrl: string) => Promise<string>` |
| `sha256HexDeTexto` | function | 29 | `(texto: string) => Promise<string>` |

### packages/scanner-core/core/image-modes.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `APPLY_FACTOR_MAX` | variable | 58 | `8` |
| `applyModelAndGainToRgba` | function | 653 | `(data: Uint8ClampedArray, model: ShadowModel, gain: Float32Array, w: number, h: number) => Uint8ClampedArray` |
| `bradleyRoth` | function | 145 | `(gray: Uint8ClampedArray, w: number, h: number, t?: number, windowRatio?: number) => Uint8ClampedArray` |
| `BW_DESPECKLE_PX` | variable | 35 | `3` |
| `BW_SAUVOLA_K` | variable | 32 | `0.34` |
| `BW_SAUVOLA_R` | variable | 33 | `128` |
| `BW_T` | variable | 31 | `0.15` |
| `BW_WINDOW_RATIO` | variable | 29 | `number` |
| `correctedGrayWithModel` | function | 605 | `(gray: Uint8ClampedArray, model: ShadowModel, w: number, h: number) => Uint8ClampedArray` |
| `despeckleBinary` | function | 219 | `(binary: Uint8ClampedArray, w: number, h: number, minPx?: number) => Uint8ClampedArray` |
| `edgeAwareSharpenGray` | function | 363 | `(src: Uint8ClampedArray, w: number, h: number) => Uint8ClampedArray` |
| `enhanceMime` | function | 813 | `(mode: EnhanceMode) => "image/jpeg" \| "image/png"` |
| `EnhanceMode` | typealias | 810 | `any` |
| `EnhanceOptions` | interface | 797 | `any` |
| `enhanceToRgba` | function | 834 | `(data: Uint8ClampedArray, w: number, h: number, mode: EnhanceMode, opts?: EnhanceOptions) => Uint8ClampedArray` |
| `estimateShadowModel` | function | 581 | `(gray: Uint8ClampedArray, w: number, h: number) => ShadowModel` |
| `FF_FLOOR_DEFAULT` | variable | 45 | `40` |
| `gaussianKernel1D` | function | 709 | `(k: number, sigma: number) => Float32Array` |
| `grayToRgba` | function | 74 | `(gray: Uint8ClampedArray, w: number, h: number) => Uint8ClampedArray` |
| `ILLUM_KERNEL` | variable | 40 | `any` |
| `ILLUM_MAP_LONG_SIDE` | variable | 38 | `800` |
| `rebuildRgbaWithChroma` | function | 430 | `(data: Uint8ClampedArray, gray: Uint8ClampedArray, targetLuma: Uint8ClampedArray, w: number, h: number) => Uint8ClampedArray` |
| `rgbaToGray` | function | 63 | `(data: Uint8ClampedArray, w: number, h: number) => Uint8ClampedArray` |
| `sauvola` | function | 178 | `(gray: Uint8ClampedArray, w: number, h: number, k?: number, r?: number, windowRatio?: number) => Uint8ClampedArray` |
| `ShadowModel` | interface | 573 | `any` |
| `TEXT_CHROMA_FADE_START` | variable | 407 | `200` |
| `TEXT_CHROMA_MAX_GAIN` | variable | 411 | `1.5` |
| `TEXT_CLARO_BLACK_POINT` | variable | 26 | `0.15` |
| `TEXT_CLARO_CONTRAST` | variable | 20 | `1.45` |
| `TEXT_CLARO_PIVOT` | variable | 23 | `0.82` |
| `TEXT_CLARO_WHITE_PCT` | variable | 17 | `0.95` |
| `TEXT_EDGE_AMOUNT` | variable | 353 | `0.75` |
| `TEXT_EDGE_GRADIENT` | variable | 351 | `25` |
| `TEXT_GAIN_MAX` | variable | 55 | `4` |
| `TEXT_NEUTRAL_INK` | variable | 402 | `45` |
| `TEXT_WHITE_TARGET` | variable | 400 | `253` |
| `textClaroContrast` | function | 297 | `(gray: Uint8ClampedArray, contrast?: number, pivot?: number) => Uint8ClampedArray` |
| `textTargetLumaLut` | function | 327 | `(contrast?: number, pivot?: number, bp?: number) => Uint8ClampedArray` |
| `UNSHARP_AMOUNT` | variable | 47 | `0.5` |
| `UNSHARP_KERNEL` | variable | 49 | `7` |
| `UNSHARP_RADIUS` | variable | 48 | `1.5` |
| `unsharpRgba` | function | 762 | `(data: Uint8ClampedArray, w: number, h: number, amount?: number, sigma?: number) => Uint8ClampedArray` |
| `whitePointStretchPct` | function | 267 | `(gray: Uint8ClampedArray, pct: number) => Uint8ClampedArray` |

### packages/scanner-core/core/image-processor.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `aplicarFiltroBw` | function | 557 | `(px: Uint8ClampedArray, w: number, h: number) => Uint8ClampedArray` |
| `detectDocumentEdgesDetail` | function | 167 | `(foto: string) => Promise<{ quad: Quad; origen: OrigenQuad; }>` |
| `detectDocumentEdgesSobel` | function | 178 | `(foto: string) => Promise<Quad>` |
| `ErrorRescateHeic` | class | 134 | `typeof ErrorRescateHeic` |
| `fileToCaptureDataUrl` | function | 102 | `(file: File, _opcionesRescate?: OpcionesRescateHeic) => Promise<string>` |
| `filterToEnhanceMode` | function | 25 | `(filter: PageFilter) => EnhanceMode` |
| `HEIC_LIMITE_MS_DEFECTO` | variable | 95 | `15000` |
| `HEIC_TOPE_MP_DEFECTO` | variable | 94 | `24` |
| `jpegDimensionsFromBlob` | function | 49 | `(blob: Blob) => Promise<{ w: number; h: number; }>` |
| `loadImage` | function | 37 | `(src: string) => Promise<HTMLImageElement>` |
| `OpcionesRescateHeic` | typealias | 96 | `any` |
| `OrigenQuad` | typealias | 126 | `any` |
| `PagePrecision` | interface | 565 | `any` |
| `PROCESSED_MAX_LONG_SIDE` | variable | 20 | `4032` |
| `processImage` | function | 929 | `(foto: string, quad: Quad, filtro: PageFilter, rotation: number, opts?: ProcessOptions) => Promise<ProcessResult>` |
| `processImageDual` | function | 1060 | `(foto: string, quad: Quad, rotation: number, opts?: ProcessOptions) => Promise<{ bw: ProcessResult; original: ProcessResult; }>` |
| `ProcessOptions` | interface | 586 | `any` |
| `ProcessResult` | interface | 575 | `any` |

### packages/scanner-core/core/ocr.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `ocrTextIsValid` | function | 5 | `(texto: string) => boolean` |

### packages/scanner-core/core/quad-guardas.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `anchoSalidaDeQuad` | function | 54 | `(quad: Quad, w: number, h: number, maxLongSide: number) => number` |
| `sanearQuad` | function | 25 | `(quad: Quad) => { quad: Quad; saneado: boolean; }` |
| `sanearQuadPlano` | function | 35 | `(plano: {}) => { plano: {}; saneado: boolean; }` |

### packages/scanner-core/core/types.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `defaultQuad` | function | 26 | `() => Quad` |
| `esQuadIdentidad` | function | 36 | `(q: Quad, eps?: number) => boolean` |
| `PageFilter` | typealias | 13 | `any` |
| `PageQuality` | interface | 16 | `any` |
| `Punto` | interface | 4 | `any` |
| `Quad` | typealias | 10 | `any` |

### packages/scanner-core/dominio/bridge.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `E14Bridge` | interface | 46 | `any` |
| `OpcionesEscaneo` | interface | 23 | `any` |
| `OpcionesEscaneoExtendidas` | typealias | 39 | `any` |
| `PaginaObjetivo` | interface | 15 | `any` |

### packages/scanner-core/dominio/clasificador.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `ClasificacionE14` | interface | 15 | `any` |
| `clasificarDesdeOcr` | function | 105 | `(texto: string) => ClasificacionE14` |
| `claveDeMesa` | function | 71 | `(c: ClasificacionE14) => string` |
| `claveDePuesto` | function | 61 | `(c: ClasificacionE14) => string` |
| `DivipolRef` | interface | 8 | `any` |
| `PATRON_CABECERA` | variable | 42 | `{}` |
| `tipoDeBanda` | function | 45 | `(textoOcr: string) => "TRANSMISION" \| "DELEGADOS"` |
| `tipoPaginaDe` | function | 52 | `(tipo: string) => TipoPagina` |
| `tituloYUbicacionDe` | function | 78 | `(c: ClasificacionE14) => { titulo: string; ubicacion: { departamento: string; municipio: string; zona: string; puesto: string; mesa: string; }; }` |

### packages/scanner-core/dominio/entorno.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `configurarPublicBase` | function | 23 | `(base: string) => void` |
| `publicBaseEfectivo` | function | 28 | `() => string` |
| `restablecerPublicBaseParaTest` | function | 42 | `() => void` |
| `urlAssetPublico` | function | 34 | `(rutaRelativa: string) => string` |

### packages/scanner-core/dominio/image-utils.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `canvasCon` | function | 199 | `(ancho: number, alto: number) => HTMLCanvasElement` |
| `decodeImagenLru` | function | 136 | `(url: string, opciones?: { maxDim?: number; }) => Promise<CanvasImageSource>` |
| `decodeImagenLruDeBlob` | function | 177 | `(blob: Blob, opciones?: { maxDim?: number; }) => Promise<CanvasImageSource>` |
| `loadImageMemo` | function | 48 | `(url: string) => Promise<HTMLImageElement>` |
| `procesadaVaciaDataUrl` | function | 225 | `(url: string) => Promise<boolean>` |
| `rotateProcessedDataUrl` | function | 254 | `(url: string, deg: number) => Promise<{ url: string; thumb: string; w: number; h: number; }>` |

### packages/scanner-core/dominio/logger.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `logger` | variable | 99 | `{ debug(...args: {}): void; info(...args: {}): void; warn(...args: {}): void; error(...args: {}): void; }` |

### packages/scanner-core/dominio/ocr-escalonado.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `anclasDe` | function | 26 | `(texto: string) => number` |
| `elegirMejor` | function | 54 | `<T extends PasadaOcr>(a: T, b: T) => T` |
| `necesitaSegunda` | function | 40 | `(texto: string) => boolean` |
| `PasadaOcr` | interface | 19 | `any` |
| `rescateAporta` | function | 76 | `(textoBase: string, textoRescate: string) => boolean` |

### packages/scanner-core/dominio/plan.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `configurarPlan` | function | 66 | `(parcial: Partial<OpcionesPlan>) => void` |
| `opcionesPlan` | variable | 63 | `OpcionesPlan` |
| `OpcionesPlan` | interface | 17 | `any` |

### packages/scanner-core/dominio/senal-lectura.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `ANCLAS_LECTURA` | variable | 32 | `{}` |
| `lazoPerdonadoPorLectura` | function | 83 | `(esquinas: { tl: boolean; tr: boolean; bl: boolean; br: boolean; }, texto: string, faltaSeccion: boolean) => boolean` |
| `NivelLectura` | typealias | 13 | `any` |
| `norm` | function | 47 | `(s: string) => string` |
| `PISO_LECTURA_FUERTE` | variable | 24 | `8.5` |
| `senalDeLectura` | function | 60 | `(texto: string, parciales?: { folio?: number; cabecera?: boolean; }) => SenalLectura` |
| `SenalLectura` | interface | 15 | `any` |
| `TECHO_LECTURA_DEBIL` | variable | 28 | `5.9` |

### packages/scanner-core/dominio/types.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `Acta` | interface | 189 | `any` |
| `ActaFirma` | interface | 31 | `any` |
| `ActaStatus` | typealias | 10 | `any` |
| `DiagnosticoActa` | interface | 49 | `any` |
| `EstructuraActa` | interface | 171 | `any` |
| `EtapaAnalisis` | typealias | 294 | `any` |
| `FuenteCaptura` | typealias | 18 | `any` |
| `HistorialRow` | interface | 267 | `any` |
| `Mesa` | interface | 286 | `any` |
| `MesaPagina` | interface | 280 | `any` |
| `MetricasActa` | interface | 42 | `any` |
| `PaginaActa` | interface | 62 | `any` |
| `ProgresoAnalisis` | interface | 302 | `any` |
| `Quad` | exportspecifier | 8 | `any` |
| `RechazoActa` | interface | 37 | `any` |
| `ResumenMoldeActa` | interface | 73 | `any` |
| `ResumenMoldeCampo` | interface | 110 | `any` |
| `statusDeScore` | function | 314 | `(score: number) => ActaStatus` |
| `TipoPagina` | typealias | 21 | `any` |
| `UbicacionActa` | interface | 23 | `any` |
| `UMBRAL_ADMISIBLE_SCORE` | variable | 312 | `8.5` |

### packages/scanner-core/geom/orientacion.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `anilloGanadorRegistrar` | function | 300 | `(rot: Rotacion) => void` |
| `ganadorPersistente` | function | 265 | `() => Rotacion` |
| `OpcionesProbeOrientacion` | interface | 151 | `any` |
| `probeOrientacion` | function | 606 | `(fotoOcr: string, opciones?: OpcionesProbeOrientacion) => Promise<ProbeOrientacion>` |
| `ProbeOrientacion` | interface | 114 | `any` |
| `rotarDataUrl` | function | 357 | `(dataUrl: string, rot: Rotacion) => Promise<string>` |

### packages/scanner-core/molde/homografia.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `Afin6` | typealias | 286 | `any` |
| `ajustarAfin` | function | 291 | `(src: {}, dst: {}) => Afin6` |
| `anguloDeskew` | function | 188 | `(src: HTMLCanvasElement) => number` |
| `aplicarAfin` | function | 319 | `(A: Afin6, x: number, y: number) => { x: number; y: number; }` |
| `aplicarHomografia` | function | 79 | `(H: Matriz8, x: number, y: number) => { x: number; y: number; }` |
| `corregirDeskew` | function | 261 | `(src: HTMLCanvasElement, anguloCorrector: number) => HTMLCanvasElement` |
| `Matriz8` | typealias | 19 | `any` |
| `quadSesgado` | function | 89 | `(quad: Quad, eps?: number) => boolean` |
| `resolverHomografia` | function | 23 | `(src: {}, dst: {}) => Matriz8` |
| `warpPerspectiva` | function | 111 | `(src: HTMLCanvasElement, quad: Quad, ancho: number) => HTMLCanvasElement` |

### packages/scanner-core/molde/imageproc.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `adaptiveThresholdInv` | function | 84 | `(gray: Uint8Array, w: number, h: number, blockSize?: number, C?: number) => BinImage` |
| `binarizeNoLines` | function | 163 | `(gray: Uint8Array, w: number, h: number, kernelLineaFrac?: number) => BinImage` |
| `BinImage` | interface | 7 | `any` |
| `canvasGrayscale` | function | 350 | `(src: HTMLCanvasElement) => HTMLCanvasElement` |
| `canvasOtsu` | function | 435 | `(src: HTMLCanvasElement) => HTMLCanvasElement` |
| `canvasRealce` | function | 372 | `(src: HTMLCanvasElement, escala?: number) => HTMLCanvasElement` |
| `CompStats` | interface | 13 | `any` |
| `connectedComponents` | function | 181 | `(bin: Uint8Array, w: number, h: number) => { labels: Int32Array; stats: {}; }` |
| `FiltroLinea` | interface | 228 | `any` |
| `grayFromImageData` | function | 21 | `(img: ImageData) => Uint8Array` |
| `inkRatio` | function | 234 | `(bin: BinImage, zone: [number, number, number, number], filtro?: FiltroLinea) => number` |
| `medidaCelda` | function | 280 | `(bin: BinImage, zone: [number, number, number, number], cfg: MedidaComponentesCfg, filtro?: FiltroLinea) => { nBig: number; dens: number; }` |
| `MedidaComponentesCfg` | interface | 273 | `any` |
| `opening1D` | function | 114 | `(bin: BinImage, k: number, dir: "h" \| "v") => Uint8Array` |
| `otsuThreshold` | function | 322 | `(gray: Uint8Array) => number` |

### packages/scanner-core/molde/letras-numero.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `DIGITOS_AMBIGUOS` | variable | 128 | `Record<string, string>` |
| `letrasANumero` | function | 54 | `(texto: string) => number` |
| `repararNumeroAmbiguo` | function | 139 | `(s: string) => { texto: string; valor: number; }` |

### packages/scanner-core/molde/marca.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `cajasHuecasEnBin` | function | 247 | `(bin: BinImage) => {}` |
| `clasificarMarcaBin` | function | 98 | `(bin: BinImage) => MetricaMarca` |
| `clasificarMarcaSobreCrop` | function | 196 | `(crop: HTMLCanvasElement) => MetricaMarca` |
| `detectarCajasHuecas` | function | 270 | `(canvas: HTMLCanvasElement, limite?: RectNorm) => {}` |
| `diferencialSiNo` | function | 376 | `(crop: HTMLCanvasElement, ventanas: VentanasSiNo) => "si" \| "no"` |
| `EstadoMarca` | typealias | 23 | `any` |
| `MetricaMarca` | interface | 25 | `any` |
| `metricasFirma` | function | 318 | `(crop: HTMLCanvasElement) => MetricasFirma` |
| `MetricasFirma` | interface | 303 | `any` |
| `senalCajaHueca` | function | 224 | `(bin: BinImage, labels: Int32Array, stats: {}, i: number, zw: number, zh: number) => SenalCajaHueca` |
| `SenalCajaHueca` | interface | 209 | `any` |
| `VentanasSiNo` | interface | 342 | `any` |

### packages/scanner-core/molde/ocr-mapeo.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `lineasDesdeBlocksTesseract` | function | 38 | `(data: RespuestaBlocksTesseract) => { lines: {}; conf: number; }` |
| `lineasDesdeRapid` | function | 82 | `(rapidLineas: {}, factorEscala: number) => { lines: {}; conf: number; }` |
| `RespuestaBlocksTesseract` | interface | 19 | `any` |

### packages/scanner-core/molde/ocr-tipos.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `canvasJpeg` | function | 59 | `(canvas: HTMLCanvasElement, maxW?: number, q?: number) => string` |
| `configurarProveedorOcr` | function | 36 | `(p: ProveedorOcr) => void` |
| `hayProveedorOcr` | function | 52 | `() => boolean` |
| `LineaOcr` | interface | 16 | `any` |
| `PalabraOcr` | interface | 10 | `any` |
| `proveedorOcr` | function | 41 | `() => ProveedorOcr` |
| `ProveedorOcr` | interface | 23 | `any` |

### packages/scanner-core/molde/tabla-detect.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `CeldaTabla` | interface | 22 | `any` |
| `detectarTabla` | function | 150 | `(lines: {}, zona: RectNorm, dims: { w: number; h: number; }, opts?: { maxFilas?: number; maxCols?: number; }) => TablaDetectada` |
| `detectarTablaCompleta` | function | 265 | `(lines: {}, zona: RectNorm, dims: { w: number; h: number; }, canvas?: HTMLCanvasElement, opts?: { maxFilas?: number; maxCols?: number; }) => TablaDetectada` |
| `TablaDetectada` | interface | 29 | `any` |

### packages/scanner-core/molde/tabla-imagen.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `Banda` | interface | 24 | `any` |
| `bandasAContenido` | function | 146 | `(reglas: {}, desde: number, hasta: number) => {}` |
| `KERNEL_MIN` | exportspecifier | 169 | `24` |
| `reticulaDesdeImagen` | function | 96 | `(canvas: HTMLCanvasElement, zona: RectNorm) => ReticulaImagen` |
| `ReticulaImagen` | interface | 29 | `any` |

### packages/scanner-core/molde/universal-engine.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `alinearAnclas` | function | 3043 | `(molde: MoldeUniversal, canvas: HTMLCanvasElement, pagina?: number) => Promise<{ molde: MoldeUniversal; encontradas: number; total: number; detalles: Record<str` |
| `ANCLA_COLUMNA_DX_MAX` | variable | 388 | `0.1` |
| `ANCLA_SCORE_MIN` | variable | 366 | `0.72` |
| `ANCLA_TEXUAL_DESPLAZAMIENTO_MAX` | variable | 378 | `0.3` |
| `ARNES_ANCLAS_MIN` | variable | 2134 | `3` |
| `ARNES_CONF_PROY_MIN` | variable | 2139 | `0.8` |
| `ARNES_TEXTO_CONF_MIN` | variable | 2141 | `0.7` |
| `ARNES_VOTO_TOL` | variable | 2137 | `0.02` |
| `buscarAncla` | function | 183 | `(texto: string, lineas: {}, canvasW: number, canvasH: number, rectEsperado?: RectNorm) => HitAncla` |
| `CajaLayout` | interface | 2128 | `any` |
| `CandidatoHuella` | interface | 2473 | `any` |
| `dictaminarCampo` | function | 1338 | `(htr: boolean, obligatorio: boolean, confFinal: number, banderas: {}, htrConfDictamen?: number) => { estado: "ok" \| "requiere_revision"; bandera?: "htr_conf_alt` |
| `editDistance` | function | 69 | `(a: string, b: string) => number` |
| `editDistancePonderada` | function | 127 | `(a: string, b: string) => number` |
| `endurecerFallbackNoVerificado` | function | 2076 | `(campo: CampoUniversal, r: ResultadoCampoUniversal) => void` |
| `evaluarDocumentoUniversal` | function | 2767 | `(canvases: {}, molde: MoldeUniversal, nombreArchivo: string, onProgreso?: (msg: string) => void, renderMs?: number, opts?: { previews?: boolean; lineas?: {}; oc` |
| `evaluarGrupos` | function | 2412 | `(grupos: {}, campos: {}, resultados: {}) => void` |
| `evaluarValidaciones` | function | 1902 | `(molde: MoldeUniversal, porId: Map<string, ResultadoCampoUniversal>) => {}` |
| `FARO_MARGEN` | variable | 613 | `0.01` |
| `hexTipo` | exportspecifier | 3385 | `(tipo: string) => string` |
| `HitAncla` | interface | 154 | `any` |
| `IdentificacionCascada` | interface | 2486 | `any` |
| `identificarDocumento` | function | 2516 | `(lineas: {}, canvasW: number, canvasH: number, totalPaginas: number, candidatos: {}) => IdentificacionCascada` |
| `lineasEnFaro` | function | 629 | `(lineas: {}, canvasW: number, canvasH: number, faro: RectNorm) => {}` |
| `MIN_CORRIDAS_CLUSTERING` | variable | 3166 | `3` |
| `normTxt` | function | 59 | `(s: string) => string` |
| `parsearFechaTexto` | function | 1860 | `(valor: string) => number` |
| `parsearIgualdad` | function | 1816 | `(expresion: string) => { izq: string; der: Array<{ tipo: "id" \| "num"; valor: string; }>; }` |
| `parsearRango` | function | 1839 | `(expresion: string) => { izq: string; op: ">=" \| "<="; der: string; }` |
| `patronEfectivo` | function | 1326 | `(campo: CampoUniversal, herencia?: Partial<Record<TipoCampo, { umbral?: number; patron?: string; }>>) => string` |
| `proponerAnclas` | function | 2621 | `(lineas: {}, canvasW: number, canvasH: number, zona: RectNorm, maximo?: number) => {}` |
| `PropuestaAncla` | interface | 2577 | `any` |
| `proyectarPorArnes` | function | 2160 | `(campos: {}, resultados: {}, lineas: {}, canvasW: number, canvasH: number, opts?: { canvas?: HTMLCanvasElement; cajasLayout?: {}; herencia?: Partial<Record<Tipo` |
| `RADIO_DESAMBIGUACION` | variable | 393 | `0.3` |
| `rectEditor` | function | 996 | `(campo: CampoUniversal) => RectNorm` |
| `RectResuelto` | interface | 307 | `any` |
| `resolverRectCampo` | function | 913 | `(campo: CampoUniversal, lineas: {}, canvasW: number, canvasH: number, canvas?: HTMLCanvasElement) => RectResuelto` |
| `resolverRectRelacional` | function | 779 | `(campo: CampoUniversal, lineas: {}, canvasW: number, canvasH: number, canvas?: HTMLCanvasElement) => RectResuelto` |
| `ResultadoArn` | interface | 2148 | `any` |
| `ResultadoFixture` | interface | 2679 | `any` |
| `sugerirUmbral` | function | 3091 | `(resultados: ResultadoUniversal, campoId: string) => { sugerido: number; minConTinta: number; maxSinTinta: number; motivo?: "sin_mediciones" \| "sin_tinta" \| "si` |
| `sugerirUmbralClustering` | function | 3268 | `(corridas: {}, campoId: string) => { sugerido: number; minConTinta: number; maxSinTinta: number; metodo: "clustering" \| "corte_fijo"; corridasConMediciones: num` |
| `TECHO_RUIDO` | variable | 3163 | `0.02` |
| `textoEnRect` | function | 1215 | `(lineas: {}, rect: RectNorm, canvasW: number, canvasH: number) => { texto: string; conf: number; palabras: number; }` |
| `umbralEfectivo` | function | 1318 | `(campo: CampoUniversal, herencia?: Partial<Record<TipoCampo, { umbral?: number; patron?: string; }>>) => number` |
| `valorNumerico` | function | 1729 | `(r: ResultadoCampoUniversal) => number` |
| `verificarFixture` | function | 2705 | `(resultado: ResultadoUniversal, fixture: FixtureMolde) => ResultadoFixture` |

### packages/scanner-core/molde/universal-types.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `AnclaUniversal` | interface | 63 | `any` |
| `CampoUniversal` | interface | 103 | `any` |
| `ClaseLayout` | typealias | 391 | `any` |
| `COLOR_TIPO` | variable | 517 | `Record<TipoCampo, string>` |
| `erroresMolde` | function | 901 | `(obj: unknown) => {}` |
| `esMoldeUniversal` | function | 814 | `(obj: unknown) => obj is MoldeUniversal` |
| `EstrategiaCampo` | typealias | 32 | `any` |
| `FixtureMolde` | interface | 363 | `any` |
| `GrupoMolde` | interface | 297 | `any` |
| `HerenciaMolde` | typealias | 348 | `any` |
| `hexTipo` | function | 524 | `(tipo: string) => string` |
| `HuellaMolde` | interface | 329 | `any` |
| `LayoutMolde` | interface | 450 | `any` |
| `MAX_ANCLAS_VOTO` | variable | 101 | `6` |
| `MOLDE_UNIVERSAL_VERSION` | variable | 514 | `"3.3.0"` |
| `MoldeUniversal` | interface | 460 | `any` |
| `nuevoIdCampo` | function | 1217 | `() => string` |
| `RectNorm` | interface | 22 | `any` |
| `ReglaLayout` | interface | 405 | `any` |
| `RelacionAncla` | interface | 39 | `any` |
| `RestriccionesGrupo` | interface | 282 | `any` |
| `ResultadoCampoUniversal` | interface | 539 | `any` |
| `ResultadoPaginaUniversal` | interface | 596 | `any` |
| `ResultadoUniversal` | interface | 615 | `any` |
| `ResultadoValidacion` | interface | 605 | `any` |
| `SCHEMA_VERSION_MOLDE` | variable | 356 | `1` |
| `TipoCampo` | typealias | 29 | `any` |
| `TOLERANCIA_GRUPO_DEFAULT` | variable | 321 | `0.02` |
| `UMBRAL_APROBADO` | variable | 1222 | `98` |
| `ValidacionMolde` | interface | 246 | `any` |
| `VOTO_CONSENSO_DIST` | variable | 97 | `0.02` |

### packages/scanner-core/obs-base/breadcrumbs.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `breadcrumb` | function | 81 | `(tipo: string, datos?: Record<string, unknown>) => void` |
| `detalleDeTarget` | function | 48 | `(target: { closest: (sel: string) => { getAttribute(n: string): string; }; }) => string` |
| `iniciarBreadcrumbs` | function | 65 | `() => void` |
| `obtenerBreadcrumbs` | function | 42 | `() => {}` |
| `registrarBreadcrumb` | function | 26 | `(b: Omit<Breadcrumb, "t">) => void` |
| `registrarVista` | function | 37 | `(vista: string) => void` |

### packages/scanner-core/obs-base/buffer.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `abrirBuffer` | function | 189 | `() => Promise<void>` |
| `appendEvento` | function | 197 | `(e: Omit<EventoObs, "id">) => Promise<void>` |
| `contarEventos` | function | 319 | `() => Promise<number>` |
| `CUOTA_HANG_MS` | variable | 32 | `5000` |
| `descartesDeBuffer` | function | 180 | `() => Record<string, number>` |
| `eventosPorDigest` | function | 347 | `() => Promise<{}>` |
| `leerEventos` | function | 301 | `(f?: (e: EventoObs) => boolean) => Promise<{}>` |
| `mantenimientoBuffer` | function | 95 | `(eventos: {}, ahora: number) => { conservar: {}; borrar: {}; }` |
| `purgarBuffer` | function | 334 | `() => Promise<void>` |
| `registrarDescarteBuffer` | function | 150 | `(motivo: string) => void` |
| `TOPE_EVENTOS` | variable | 26 | `500` |
| `TTL_MS` | variable | 27 | `number` |

### packages/scanner-core/obs-base/config.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `configObsBase` | variable | 18 | `ConfigObsBase` |
| `ConfigObsBase` | interface | 9 | `any` |
| `configurarObsBase` | function | 25 | `(parcial: Partial<ConfigObsBase>) => void` |

### packages/scanner-core/obs-base/digest.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `agregarErrores` | function | 57 | `(eventos: {}) => {}` |
| `archivoDeStack` | function | 38 | `(stack: string) => string` |
| `digestDe` | function | 47 | `(mensaje: string, tipo: string, stack: string) => string` |
| `normalizarMensaje` | function | 27 | `(s: string) => string` |

### packages/scanner-core/obs-base/eventos-lectura.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `AgregadoLectura` | interface | 57 | `any` |
| `AgregadoLecturaAceptante` | interface | 46 | `any` |
| `agregarLecturas` | function | 67 | `(resumenes: {}) => AgregadoLectura` |
| `colectorLectura` | function | 104 | `() => { sink: SinkLectura; eventos: {}; resumen: () => ResumenLectura; }` |
| `EventoLectura` | interface | 15 | `any` |
| `PasoLectura` | typealias | 13 | `any` |
| `ResumenLectura` | interface | 32 | `any` |
| `SinkLectura` | typealias | 26 | `any` |

### packages/scanner-core/obs-base/identidad.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `appVersion` | function | 83 | `() => string` |
| `fnv1a8` | function | 91 | `(s: string) => string` |
| `idDispositivo` | function | 69 | `() => string` |
| `idSesion` | function | 61 | `() => string` |
| `nuevoUuid` | function | 30 | `() => string` |

### packages/scanner-core/obs-base/tipos.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `Breadcrumb` | interface | 20 | `any` |
| `ErroresAgrupados` | interface | 149 | `any` |
| `ErrorEvento` | interface | 26 | `any` |
| `EventoObs` | interface | 139 | `any` |
| `HangEvento` | interface | 100 | `any` |
| `PerfActa` | interface | 35 | `any` |
| `PoliticaDatos` | interface | 132 | `any` |
| `SaludSnapshot` | interface | 73 | `any` |
| `Tier` | typealias | 18 | `any` |
| `TipoEvento` | typealias | 17 | `any` |
| `TramosOcr` | interface | 66 | `any` |
| `UsoContador` | interface | 89 | `any` |

### packages/scanner-core/ocr/crop-geometria.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `medidasDeCaja` | function | 17 | `(box: {}) => { w: number; h: number; }` |
| `PuntoCaja` | interface | 12 | `any` |

### packages/scanner-core/ocr/db-postprocess-client.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `dbPostprocessEnWorkerHabilitado` | function | 72 | `() => boolean` |
| `dbPostprocessRemoto` | function | 129 | `(pred: Float32Array, pw: number, ph: number, ops: OpsDet, srcW: number, srcH: number, tiempoMaxMs?: number) => Promise<ResultadoDbPost>` |
| `ResultadoDbPost` | interface | 33 | `any` |

### packages/scanner-core/ocr/db-postprocess.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `boxScoreFast` | function | 163 | `(pred: Float32Array, w: number, h: number, box: {}) => number` |
| `convexHull` | function | 93 | `(pts: {}) => {}` |
| `DB_BOX_THRESH` | variable | 77 | `0.5` |
| `DB_MAX_CANDIDATES` | variable | 78 | `1000` |
| `DB_THRESH` | variable | 76 | `0.3` |
| `DB_UNCLIP_RATIO` | variable | 79 | `1.6` |
| `dbPostprocess` | function | 273 | `(pred: Float32Array, pw: number, ph: number, ops: OpsDet, srcW: number, srcH: number) => { boxesFuente: {}; nBoxes: number; }` |
| `esquinasRect` | function | 208 | `(r: Rect) => {}` |
| `mapearAFuente` | function | 55 | `(p: { x: number; y: number; }, ops: OpsDet, srcW: number, srcH: number) => { x: number; y: number; }` |
| `MIN_SIDE_DESCARTAR` | variable | 80 | `3` |
| `MIN_SIDE_TRAS_UNCLIP` | variable | 81 | `5` |
| `minAreaRect` | function | 118 | `(hull: {}) => Rect` |
| `OpsDet` | interface | 40 | `any` |
| `ordenarCajas` | function | 245 | `(boxes: {}) => {}` |

### packages/scanner-core/ocr/rapidocr.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `asegurarRapidOcr` | function | 1301 | `() => Promise<RapidRuntime>` |
| `configurarColaGlobalOcr` | function | 291 | `(activa: () => boolean) => void` |
| `DET_CAP_PROD` | variable | 404 | `1920` |
| `DET_CAP_RAPIDO` | variable | 405 | `1280` |
| `EsperaOcrSink` | interface | 248 | `any` |
| `ocrEnVuelo` | function | 233 | `() => boolean` |
| `rapidOcrCropsOrientacion` | function | 1157 | `(rt: RapidRuntime, dataUrl: string, k: number, esperaSink?: EsperaOcrSink) => Promise<{ crops: {}; w: number; h: number; msDet: number; }>` |
| `rapidOcrInit` | function | 114 | `() => Promise<RapidRuntime>` |
| `RapidOcrLinea` | interface | 75 | `any` |
| `rapidOcrPrecalentar` | function | 132 | `() => Promise<boolean>` |
| `rapidOcrRecLote` | function | 1222 | `(rt: RapidRuntime, canvases: {}, esperaSink?: EsperaOcrSink) => Promise<{}>` |
| `rapidOcrReconocer` | function | 821 | `(rt: RapidRuntime, dataUrl: string, onProgress?: (p: number) => void, opts?: { detCap?: number; omitirCls?: boolean; sinRescateBordes?: boolean; esperaSink?: Es` |
| `rapidOcrReiniciar` | function | 321 | `() => Promise<void>` |
| `RapidOcrResultado` | interface | 81 | `any` |
| `RapidRuntime` | interface | 102 | `any` |
| `recKnobs` | function | 443 | `() => { anchoMax: number; alto: number; lote: number; suave: boolean; wFija: boolean; cabecera: number; pie: number; bordesRescate: number; }` |
| `reiniciarMotorOcrSiInactivo` | function | 340 | `() => Promise<boolean>` |

### packages/scanner-core/ocr/turno-fifo.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `crearTurnoFifo` | function | 27 | `() => TurnoFifo` |
| `TurnoFifo` | interface | 22 | `any` |

### packages/scanner-core/orquestacion/cascada.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `cascadaActiva` | function | 85 | `(ocrCascada: boolean, simular: boolean) => boolean` |
| `correrCascadaOcr` | function | 234 | `(foto: string, deps: DepsOcrCascada) => Promise<SalidaCascada>` |
| `DepsOcrCascada` | interface | 119 | `any` |
| `EventoCascada` | interface | 60 | `any` |
| `PasadaCascada` | interface | 36 | `any` |
| `pasadaRoiCompuesta` | function | 103 | `(top: PasadaCascada, bottom: PasadaCascada) => PasadaCascada` |
| `RESCATE_COSTE_ESPERADO_MS` | variable | 81 | `13000` |
| `ROI_FRACCIONES` | variable | 72 | `{ readonly top: readonly [0, 0.25]; readonly bottom: readonly [0.75, 1]; }` |

### packages/scanner-core/qr/capa0-qr.client.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `configurarCapa0` | function | 71 | `(o: OpcionesCapa0) => void` |
| `decodificarQrCapa0Camara` | function | 335 | `(dataUrl: string) => Promise<{ payload: string; }>` |
| `decodificarQrCapa0Worker` | function | 231 | `(blob: Blob, opcionesCadena: OpcionesCapa0Worker) => Promise<ResultadoCapa0Worker>` |
| `FasesCapa0` | exportspecifier | 42 | `any` |
| `FinCapa0` | exportspecifier | 42 | `any` |
| `hardKillsQrWorker` | function | 96 | `() => number` |
| `OpcionesCapa0` | interface | 63 | `any` |
| `OpcionesCapa0Worker` | typealias | 56 | `any` |
| `PeticionCapa0` | exportspecifier | 42 | `any` |
| `ResultadoCapa0Worker` | typealias | 45 | `any` |

### packages/scanner-core/qr/identidad-qr.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `BANDA_A` | exportspecifier | 110 | `any` |
| `BARRIDO_VENTANAS` | exportspecifier | 111 | `{}` |
| `barridoQrDePixeles` | exportspecifier | 109 | `(pix: PixelesQr) => string` |
| `binarizadaQrDePixeles` | exportspecifier | 115 | `(pix: PixelesQr) => PixelesQr` |
| `decodificarQrDeCapture` | function | 489 | `(dataUrl: string, opciones?: { tiers?: "completos" \| "base"; ladoLargo?: number; rescate4096?: boolean; presupuestoMs?: number; }) => Promise<{ payload: string;` |
| `intentoSobrePixeles` | exportspecifier | 116 | `(cv: PixelesQr, esp: EspecieBanda) => string` |
| `ladderBaseDePixeles` | exportspecifier | 117 | `(pix: PixelesQr) => string` |
| `moduloZxingDe` | function | 197 | `() => Promise<typeof import("C:/Users/JG/Documents/Ya casi lo tenemos/molde-suite/node_modules/.bun/zxing-wasm@3.1.8/node_modules/zxing-wasm/dist/es/reader/inde` |
| `nitidezQrDePixeles` | exportspecifier | 118 | `(pix: PixelesQr) => PixelesQr` |
| `PixelesQr` | exportspecifier | 122 | `any` |
| `QR_RECORTE_LADO` | exportspecifier | 119 | `600` |
| `qrCorto` | function | 556 | `(payload: string) => string` |
| `rotarPixeles` | exportspecifier | 120 | `(src: PixelesQr, grados: number) => PixelesQr` |

### packages/scanner-core/qr/prechequeo-qr.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `detectarPatronesLocalizador` | function | 122 | `(img: ImagenAnalizable) => ResultadoPrechequeo` |
| `ImagenAnalizable` | interface | 57 | `any` |
| `PRECHEQUEO_LADO_LARGO` | variable | 77 | `320` |
| `PRECHEQUEO_RESCATE_LADO` | variable | 81 | `1280` |
| `prechequeoDesdeCanvas` | function | 393 | `(canvas: HTMLCanvasElement) => ResultadoPrechequeo` |
| `ResultadoPrechequeo` | interface | 64 | `any` |

### packages/scanner-core/qr/qr-pixeles.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `activarGuardBarrido` | function | 294 | `(vencido: () => boolean) => void` |
| `BANDA_A` | variable | 51 | `any` |
| `BANDAS_BASE` | variable | 44 | `{}` |
| `BARRIDO_VENTANAS` | variable | 180 | `{}` |
| `barridoQrDePixeles` | function | 321 | `(pix: PixelesQr) => string` |
| `BINARIZADA_DELTA` | variable | 400 | `12` |
| `BINARIZADA_VENTANA` | variable | 399 | `0.025` |
| `binarizadaQrDePixeles` | function | 402 | `(pix: PixelesQr) => PixelesQr` |
| `Cuadrante` | interface | 198 | `any` |
| `CUADRANTES` | variable | 205 | `{}` |
| `EspecieBanda` | interface | 35 | `any` |
| `intentoSobrePixeles` | function | 61 | `(cv: PixelesQr, esp: EspecieBanda) => string` |
| `jsQrDeVentana` | function | 254 | `(win: PixelesQr) => string` |
| `ladderBaseDePixeles` | function | 156 | `(pix: PixelesQr) => string` |
| `ladoDeVentana` | function | 269 | `(pix: PixelesQr, fraccion: number) => number` |
| `limitesDeCuadrante` | function | 214 | `(pix: PixelesQr, q: Cuadrante) => { x0: number; y0: number; x1: number; y1: number; }` |
| `NITIDEZ_K` | variable | 367 | `0.6` |
| `nitidezQrDePixeles` | function | 369 | `(pix: PixelesQr) => PixelesQr` |
| `PixelesQr` | interface | 28 | `any` |
| `QR_PREVIO_LADO_LARGO` | variable | 193 | `1600` |
| `QR_RECORTE_LADO` | variable | 188 | `600` |
| `QR_ROTACIONES` | variable | 148 | `{}` |
| `rotarPixeles` | function | 134 | `(src: PixelesQr, grados: number) => PixelesQr` |
| `ventanaDePixeles` | function | 230 | `(pix: PixelesQr, x: number, y: number, lado: number) => PixelesQr` |

### packages/scanner-core/src/captura/reescalo-worker.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `reescalarImportEnWorker` | function | 92 | `(blob: Blob, dims: { w: number; h: number; }, cap: number, calidad: "medium" \| "high", tiempoMaxMs?: number) => Promise<ResultadoReescalo>` |
| `reescaloImportEnWorkerHabilitado` | function | 42 | `() => boolean` |
| `ResultadoReescalo` | interface | 13 | `any` |

### packages/scanner-core/src/contract/contrato.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `CLAVES_TOP_LEVEL` | variable | 24 | `readonly ["tipo", "version", "nombre", "descripcion", "documento", "idioma", "paginasRef", "campos", "validaciones", "layout", "meta"]` |
| `erroresContrato` | function | 45 | `(obj: unknown) => {}` |
| `erroresMolde` | exportspecifier | 20 | `(obj: unknown) => {}` |
| `esMoldeUniversal` | exportspecifier | 20 | `(obj: unknown) => obj is MoldeUniversal` |
| `MOLDE_UNIVERSAL_VERSION` | exportspecifier | 20 | `"3.3.0"` |
| `MoldeUniversal` | exportspecifier | 21 | `any` |

### packages/scanner-core/src/contract/sobre.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `checksumDeMolde` | function | 37 | `(molde: unknown) => Promise<string>` |
| `crearSobreMolde` | function | 42 | `(molde: MoldeUniversal) => Promise<SobreMolde>` |
| `esSobreConMolde` | function | 25 | `(p: unknown) => p is { checksum: string; molde: unknown; }` |
| `SobreMolde` | interface | 15 | `any` |
| `VerificacionSobre` | typealias | 54 | `any` |
| `verificarSobreMolde` | function | 59 | `(sobre: { checksum: string; molde: unknown; }) => Promise<VerificacionSobre>` |

### packages/scanner-core/src/index.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `Acta` | exportspecifier | 41 | `any` |
| `ActaFirma` | exportspecifier | 43 | `any` |
| `ActaStatus` | exportspecifier | 42 | `any` |
| `checksumDeMolde` | exportspecifier | 29 | `(molde: unknown) => Promise<string>` |
| `CLAVES_TOP_LEVEL` | exportspecifier | 22 | `readonly ["tipo", "version", "nombre", "descripcion", "documento", "idioma", "paginasRef", "campos", "validaciones", "layout", "meta"]` |
| `crearSobreMolde` | exportspecifier | 30 | `(molde: MoldeUniversal) => Promise<SobreMolde>` |
| `DiagnosticoActa` | exportspecifier | 44 | `any` |
| `erroresContrato` | exportspecifier | 20 | `(obj: unknown) => {}` |
| `erroresMolde` | exportspecifier | 19 | `(obj: unknown) => {}` |
| `esMoldeUniversal` | exportspecifier | 18 | `(obj: unknown) => obj is MoldeUniversal` |
| `esSobreConMolde` | exportspecifier | 28 | `(p: unknown) => p is { checksum: string; molde: unknown; }` |
| `EstructuraActa` | exportspecifier | 45 | `any` |
| `EtapaAnalisis` | exportspecifier | 46 | `any` |
| `FuenteCaptura` | exportspecifier | 47 | `any` |
| `HistorialRow` | exportspecifier | 48 | `any` |
| `Mesa` | exportspecifier | 49 | `any` |
| `MesaPagina` | exportspecifier | 50 | `any` |
| `MetricasActa` | exportspecifier | 51 | `any` |
| `MOLDE_UNIVERSAL_VERSION` | exportspecifier | 21 | `"3.3.0"` |
| `MoldeUniversal` | exportspecifier | 24 | `any` |
| `PaginaActa` | exportspecifier | 52 | `any` |
| `ProgresoAnalisis` | exportspecifier | 53 | `any` |
| `Quad` | exportspecifier | 59 | `any` |
| `RechazoActa` | exportspecifier | 54 | `any` |
| `ResumenMoldeActa` | exportspecifier | 55 | `any` |
| `ResumenMoldeCampo` | exportspecifier | 56 | `any` |
| `SobreMolde` | exportspecifier | 33 | `any` |
| `statusDeScore` | exportspecifier | 38 | `(score: number) => ActaStatus` |
| `TipoPagina` | exportspecifier | 57 | `any` |
| `UbicacionActa` | exportspecifier | 58 | `any` |
| `UMBRAL_ADMISIBLE_SCORE` | exportspecifier | 37 | `8.5` |
| `VerificacionSobre` | exportspecifier | 33 | `any` |
| `verificarSobreMolde` | exportspecifier | 31 | `(sobre: { checksum: string; molde: unknown; }) => Promise<VerificacionSobre>` |

### packages/scanner-core/workers/capa0-qr.worker.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `FasesCapa0` | typealias | 127 | `any` |
| `FinCapa0` | typealias | 152 | `any` |
| `PeticionCapa0` | typealias | 155 | `any` |
| `RespuestaCapa0` | typealias | 170 | `any` |

### packages/scanner-core/workers/fallback-canvas.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `aplicarFiltroForkAPixeles` | function | 71 | `(px: Uint8ClampedArray, w: number, h: number, filtro: string) => void` |

---

Total: 732 símbolos en 76 archivos de 3 paquetes.
