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
| `crearDetectorCasillas` | function | 15 | `() => Promise<{ detectar: (canvas: HTMLCanvasElement, confMin?: number) => Promise<DeteccionCasilla[]>; }>` |
| `DeteccionCasilla` | interface | 9 | `any` |

### packages/dla-onnx/src/index.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `bandasDesdeRegiones` | function | 9 | `(regiones: Deteccion[]) => { sup: { y0: number; y1: number; }; inf: { y0: number; y1: number; }; }` |
| `Caja` | interface | 4 | `any` |
| `configuracionLista` | function | 9 | `(key: "casillas" \| "layout" \| "manuscrito") => boolean` |
| `configurarModelo` | function | 9 | `(key: "casillas" \| "layout" \| "manuscrito", url: string) => void` |
| `crearDetector` | function | 9 | `(key: "casillas" \| "layout" \| "manuscrito") => Promise<Detector>` |
| `crearDetectorCasillas` | function | 9 | `() => Promise<{ detectar: (canvas: HTMLCanvasElement, confMin?: number) => Promise<DeteccionCasilla[]>; }>` |
| `crearDetectorLayout` | function | 9 | `() => Promise<{ detectar: (canvas: HTMLCanvasElement, confMin?: number) => Promise<Deteccion[]>; }>` |
| `crearDetectorManuscrito` | function | 9 | `() => Promise<{ detectar: (canvas: HTMLCanvasElement, confMin?: number) => Promise<Deteccion[]>; }>` |
| `Deteccion` | interface | 9 | `any` |
| `DeteccionCasilla` | interface | 9 | `any` |
| `MensajeWorker` | typealias | 9 | `any` |
| `PresetKey` | typealias | 9 | `any` |
| `PresetOnnx` | interface | 9 | `any` |
| `PRESETS` | variable | 9 | `Record<"casillas" \| "layout" \| "manuscrito", PresetOnnx>` |
| `regionesManuscritas` | function | 9 | `(canvas: HTMLCanvasElement) => Promise<Deteccion[]>` |
| `RespuestaWorker` | typealias | 9 | `any` |
| `urlModelo` | function | 9 | `(key: "casillas" \| "layout" \| "manuscrito") => string` |

### packages/dla-onnx/src/manuscrito.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `crearDetectorManuscrito` | function | 10 | `() => Promise<{ detectar: (canvas: HTMLCanvasElement, confMin?: number) => Promise<Deteccion[]>; }>` |
| `regionesManuscritas` | function | 19 | `(canvas: HTMLCanvasElement) => Promise<Deteccion[]>` |

### packages/dla-onnx/src/regiones.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `bandasDesdeRegiones` | function | 24 | `(regiones: Deteccion[]) => { sup: { y0: number; y1: number; }; inf: { y0: number; y1: number; }; }` |
| `crearDetectorLayout` | function | 10 | `() => Promise<{ detectar: (canvas: HTMLCanvasElement, confMin?: number) => Promise<Deteccion[]>; }>` |

### packages/dla-onnx/src/runtime.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `configuracionLista` | function | 36 | `(key: "casillas" \| "layout" \| "manuscrito") => boolean` |
| `configurarModelo` | function | 13 | `(key: "casillas" \| "layout" \| "manuscrito", url: string) => void` |
| `crearDetector` | function | 48 | `(key: "casillas" \| "layout" \| "manuscrito") => Promise<Detector>` |
| `Deteccion` | exportspecifier | 108 | `any` |
| `PresetKey` | exportspecifier | 108 | `any` |
| `PRESETS` | exportspecifier | 107 | `Record<"casillas" \| "layout" \| "manuscrito", PresetOnnx>` |
| `urlModelo` | function | 18 | `(key: "casillas" \| "layout" \| "manuscrito") => string` |

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
| `CLASES_CANONICAS` | variable | 12 | `readonly ClaseLayout[]` |
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
| `evaluarEstructura` | function | 194 | `(detecciones: CajaLayout[], reglas: ReglaLayout[], W: number, H: number, opts?: OpcionesEstructura) => ResultadoEstructura` |
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
| `CLASES_CANONICAS` | exportspecifier | 7 | `readonly ClaseLayout[]` |
| `conModelo` | exportspecifier | 16 | `(res: ResultadoEstructura, modelo: ModeloLayout) => ResultadoEstructura` |
| `contencion` | function | 23 | `(a: RectXYXY, b: RectXYXY) => number` |
| `ContratoModeloLayout` | exportspecifier | 12 | `any` |
| `DEFAULT_MARGEN` | exportspecifier | 18 | `0.02` |
| `DEFAULT_MIN_SCORE` | exportspecifier | 19 | `0.2` |
| `DEFAULT_NMS_INTERNO` | exportspecifier | 20 | `0.5` |
| `DeteccionLayout` | interface | 23 | `any` |
| `esCanonica` | exportspecifier | 7 | `(c: string) => c is ClaseLayout` |
| `evaluarEstructura` | exportspecifier | 15 | `(detecciones: CajaLayout[], reglas: ReglaLayout[], W: number, H: number, opts?: OpcionesEstructura) => ResultadoEstructura` |
| `inter` | function | 11 | `(a: RectXYXY, b: RectXYXY) => number` |
| `iou` | function | 22 | `(a: RectXYXY, b: RectXYXY) => number` |
| `LayoutEngine` | interface | 23 | `any` |
| `matchVsGt` | exportspecifier | 22 | `<P extends RectXYXY & { score?: number; }, G extends RectXYXY>(preds: P[], gts: G[], minIou?: number, minCont?: number) => { tp: number; pairs: ParMatch<P, G>[]` |
| `metricas` | exportspecifier | 22 | `<P extends RectXYXY & { score?: number; }, G extends RectXYXY>(preds: P[], gts: G[], minIou?: number, minCont?: number) => MetricasMatch` |
| `MetricasMatch` | exportspecifier | 22 | `any` |
| `metricasVacias` | exportspecifier | 22 | `(gt: RectXYXY[]) => MetricasMatch` |
| `ModeloLayout` | typealias | 11 | `any` |
| `MODELOS_LAYOUT` | exportspecifier | 10 | `Record<ModeloLayout, ContratoModeloLayout>` |
| `nmsClaseAgnostico` | exportspecifier | 8 | `<T extends CajaConScore>(cajas: T[], iouUmbral: number) => T[]` |
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
| `matchVsGt` | function | 36 | `<P extends RectXYXY & { score?: number; }, G extends RectXYXY>(preds: P[], gts: G[], minIou?: number, minCont?: number) => { tp: number; pairs: ParMatch<P, G>[]` |
| `metricas` | function | 66 | `<P extends RectXYXY & { score?: number; }, G extends RectXYXY>(preds: P[], gts: G[], minIou?: number, minCont?: number) => MetricasMatch` |
| `MetricasMatch` | interface | 22 | `any` |
| `metricasVacias` | function | 87 | `(gt: RectXYXY[]) => MetricasMatch` |
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
| `nmsClaseAgnostico` | function | 19 | `<T extends CajaConScore>(cajas: T[], iouUmbral: number) => T[]` |

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
| `grisesDesdeCanvas` | function | 54 | `(c: HTMLCanvasElement) => { g: Float32Array<ArrayBufferLike>; w: number; h: number; }` |
| `OpcionesCanvasDesdeDataUrl` | typealias | 10 | `any` |

### packages/scanner-core/core/hash.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `sha256HexDeBytes` | function | 18 | `(bytes: Uint8Array<ArrayBuffer>) => Promise<string>` |
| `sha256HexDeDataUrl` | function | 34 | `(dataUrl: string) => Promise<string>` |
| `sha256HexDeTexto` | function | 29 | `(texto: string) => Promise<string>` |

### packages/scanner-core/core/image-processor.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `detectDocumentEdgesDetail` | function | 56 | `(foto: string) => Promise<{ quad: Quad; origen: OrigenQuad; }>` |
| `ErrorRescateHeic` | class | 23 | `typeof ErrorRescateHeic` |
| `OrigenQuad` | typealias | 15 | `any` |
| `processImage` | function | 157 | `(foto: string, quad: Quad, filtro: PageFilter, rotation: number, opts?: { manual?: boolean; deskew?: boolean; }) => Promise<{ processed: string; width: number; ` |

### packages/scanner-core/core/ocr.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `ocrTextIsValid` | function | 5 | `(texto: string) => boolean` |

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
| `E14Bridge` | interface | 41 | `any` |
| `OpcionesEscaneo` | interface | 23 | `any` |
| `OpcionesEscaneoExtendidas` | typealias | 34 | `any` |
| `PaginaObjetivo` | interface | 15 | `any` |

### packages/scanner-core/dominio/clasificador.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `ClasificacionE14` | interface | 15 | `any` |
| `clasificarDesdeOcr` | function | 105 | `(texto: string) => ClasificacionE14` |
| `claveDeMesa` | function | 71 | `(c: ClasificacionE14) => string` |
| `claveDePuesto` | function | 61 | `(c: ClasificacionE14) => string` |
| `DivipolRef` | interface | 8 | `any` |
| `PATRON_CABECERA` | variable | 42 | `RegExp` |
| `tipoDeBanda` | function | 45 | `(textoOcr: string) => "TRANSMISION" \| "DELEGADOS"` |
| `tipoPaginaDe` | function | 52 | `(tipo: string) => TipoPagina` |
| `tituloYUbicacionDe` | function | 78 | `(c: ClasificacionE14) => { titulo: string; ubicacion: { departamento: string; municipio: string; zona: string; puesto: string; mesa: string; }; }` |

### packages/scanner-core/dominio/types.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `Acta` | interface | 147 | `any` |
| `ActaFirma` | interface | 31 | `any` |
| `ActaStatus` | typealias | 10 | `any` |
| `DiagnosticoActa` | interface | 49 | `any` |
| `EstructuraActa` | interface | 129 | `any` |
| `EtapaAnalisis` | typealias | 210 | `any` |
| `FuenteCaptura` | typealias | 18 | `any` |
| `HistorialRow` | interface | 188 | `any` |
| `Mesa` | interface | 202 | `any` |
| `MesaPagina` | interface | 196 | `any` |
| `MetricasActa` | interface | 42 | `any` |
| `PaginaActa` | interface | 62 | `any` |
| `ProgresoAnalisis` | interface | 218 | `any` |
| `Quad` | exportspecifier | 8 | `any` |
| `RechazoActa` | interface | 37 | `any` |
| `ResumenMoldeActa` | interface | 73 | `any` |
| `ResumenMoldeCampo` | interface | 99 | `any` |
| `statusDeScore` | function | 230 | `(score: number) => ActaStatus` |
| `TipoPagina` | typealias | 21 | `any` |
| `UbicacionActa` | interface | 23 | `any` |
| `UMBRAL_ADMISIBLE_SCORE` | variable | 228 | `8.5` |

### packages/scanner-core/molde/homografia.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `anguloDeskew` | function | 188 | `(src: HTMLCanvasElement) => number` |
| `aplicarHomografia` | function | 79 | `(H: Matriz8, x: number, y: number) => { x: number; y: number; }` |
| `corregirDeskew` | function | 261 | `(src: HTMLCanvasElement, anguloCorrector: number) => HTMLCanvasElement` |
| `Matriz8` | typealias | 19 | `any` |
| `quadSesgado` | function | 89 | `(quad: Quad, eps?: number) => boolean` |
| `resolverHomografia` | function | 23 | `(src: { x: number; y: number; }[], dst: { x: number; y: number; }[]) => Matriz8` |
| `warpPerspectiva` | function | 111 | `(src: HTMLCanvasElement, quad: Quad, ancho: number) => HTMLCanvasElement` |

### packages/scanner-core/molde/imageproc.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `adaptiveThresholdInv` | function | 84 | `(gray: Uint8Array<ArrayBufferLike>, w: number, h: number, blockSize?: number, C?: number) => BinImage` |
| `binarizeNoLines` | function | 163 | `(gray: Uint8Array<ArrayBufferLike>, w: number, h: number, kernelLineaFrac?: number) => BinImage` |
| `BinImage` | interface | 7 | `any` |
| `canvasGrayscale` | function | 350 | `(src: HTMLCanvasElement) => HTMLCanvasElement` |
| `canvasOtsu` | function | 435 | `(src: HTMLCanvasElement) => HTMLCanvasElement` |
| `canvasRealce` | function | 372 | `(src: HTMLCanvasElement, escala?: number) => HTMLCanvasElement` |
| `CompStats` | interface | 13 | `any` |
| `connectedComponents` | function | 181 | `(bin: Uint8Array<ArrayBufferLike>, w: number, h: number) => { labels: Int32Array<ArrayBufferLike>; stats: CompStats[]; }` |
| `FiltroLinea` | interface | 228 | `any` |
| `grayFromImageData` | function | 21 | `(img: ImageData) => Uint8Array<ArrayBufferLike>` |
| `inkRatio` | function | 234 | `(bin: BinImage, zone: [number, number, number, number], filtro?: FiltroLinea) => number` |
| `medidaCelda` | function | 280 | `(bin: BinImage, zone: [number, number, number, number], cfg: MedidaComponentesCfg, filtro?: FiltroLinea) => { nBig: number; dens: number; }` |
| `MedidaComponentesCfg` | interface | 273 | `any` |
| `opening1D` | function | 114 | `(bin: BinImage, k: number, dir: "h" \| "v") => Uint8Array<ArrayBufferLike>` |
| `otsuThreshold` | function | 322 | `(gray: Uint8Array<ArrayBufferLike>) => number` |

### packages/scanner-core/molde/marca.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `cajasHuecasEnBin` | function | 247 | `(bin: BinImage) => { x: number; y: number; w: number; h: number; puntaje: number; }[]` |
| `clasificarMarcaBin` | function | 98 | `(bin: BinImage) => MetricaMarca` |
| `clasificarMarcaSobreCrop` | function | 196 | `(crop: HTMLCanvasElement) => MetricaMarca` |
| `detectarCajasHuecas` | function | 270 | `(canvas: HTMLCanvasElement, limite?: RectNorm) => RectNorm[]` |
| `diferencialSiNo` | function | 376 | `(crop: HTMLCanvasElement, ventanas: VentanasSiNo) => "si" \| "no"` |
| `EstadoMarca` | typealias | 23 | `any` |
| `MetricaMarca` | interface | 25 | `any` |
| `metricasFirma` | function | 318 | `(crop: HTMLCanvasElement) => MetricasFirma` |
| `MetricasFirma` | interface | 303 | `any` |
| `senalCajaHueca` | function | 224 | `(bin: BinImage, labels: Int32Array<ArrayBufferLike>, stats: CompStats[], i: number, zw: number, zh: number) => SenalCajaHueca` |
| `SenalCajaHueca` | interface | 209 | `any` |
| `VentanasSiNo` | interface | 342 | `any` |

### packages/scanner-core/molde/ocr-mapeo.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `lineasDesdeBlocksTesseract` | function | 37 | `(data: RespuestaBlocksTesseract) => { lines: LineaOcr[]; conf: number; }` |
| `RespuestaBlocksTesseract` | interface | 18 | `any` |

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
| `detectarTabla` | function | 150 | `(lines: LineaOcr[], zona: RectNorm, dims: { w: number; h: number; }, opts?: { maxFilas?: number; maxCols?: number; }) => TablaDetectada` |
| `detectarTablaCompleta` | function | 265 | `(lines: LineaOcr[], zona: RectNorm, dims: { w: number; h: number; }, canvas?: HTMLCanvasElement, opts?: { maxFilas?: number; maxCols?: number; }) => TablaDetect` |
| `TablaDetectada` | interface | 29 | `any` |

### packages/scanner-core/molde/tabla-imagen.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `Banda` | interface | 24 | `any` |
| `bandasAContenido` | function | 146 | `(reglas: Banda[], desde: number, hasta: number) => Banda[]` |
| `KERNEL_MIN` | exportspecifier | 169 | `24` |
| `reticulaDesdeImagen` | function | 96 | `(canvas: HTMLCanvasElement, zona: RectNorm) => ReticulaImagen` |
| `ReticulaImagen` | interface | 29 | `any` |

### packages/scanner-core/molde/universal-engine.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `alinearAnclas` | function | 1912 | `(molde: MoldeUniversal, canvas: HTMLCanvasElement, pagina?: number) => Promise<{ molde: MoldeUniversal; encontradas: number; total: number; detalles: Record<str` |
| `ANCLA_SCORE_MIN` | variable | 305 | `0.72` |
| `buscarAncla` | function | 174 | `(texto: string, lineas: LineaOcr[], canvasW: number, canvasH: number, rectEsperado?: RectNorm) => HitAncla` |
| `editDistance` | function | 60 | `(a: string, b: string) => number` |
| `editDistancePonderada` | function | 118 | `(a: string, b: string) => number` |
| `evaluarDocumentoUniversal` | function | 1684 | `(canvases: HTMLCanvasElement[], molde: MoldeUniversal, nombreArchivo: string, onProgreso?: (msg: string) => void, renderMs?: number, opts?: { previews?: boolean` |
| `FARO_MARGEN` | variable | 352 | `0.01` |
| `hexTipo` | exportspecifier | 2254 | `(tipo: string) => string` |
| `HitAncla` | interface | 145 | `any` |
| `lineasEnFaro` | function | 368 | `(lineas: LineaOcr[], canvasW: number, canvasH: number, faro: RectNorm) => LineaOcr[]` |
| `MIN_CORRIDAS_CLUSTERING` | variable | 2035 | `3` |
| `normTxt` | function | 50 | `(s: string) => string` |
| `parsearFechaTexto` | function | 1442 | `(valor: string) => number` |
| `parsearIgualdad` | function | 1398 | `(expresion: string) => { izq: string; der: { tipo: "id" \| "num"; valor: string; }[]; }` |
| `parsearRango` | function | 1421 | `(expresion: string) => { izq: string; op: ">=" \| "<="; der: string; }` |
| `RADIO_DESAMBIGUACION` | variable | 310 | `0.3` |
| `rectEditor` | function | 719 | `(campo: CampoUniversal) => RectNorm` |
| `RectResuelto` | interface | 263 | `any` |
| `resolverRectCampo` | function | 649 | `(campo: CampoUniversal, lineas: LineaOcr[], canvasW: number, canvasH: number, canvas?: HTMLCanvasElement) => RectResuelto` |
| `resolverRectRelacional` | function | 518 | `(campo: CampoUniversal, lineas: LineaOcr[], canvasW: number, canvasH: number, canvas?: HTMLCanvasElement) => RectResuelto` |
| `sugerirUmbral` | function | 1960 | `(resultados: ResultadoUniversal, campoId: string) => { sugerido: number; minConTinta: number; maxSinTinta: number; motivo?: "sin_mediciones" \| "sin_tinta" \| "si` |
| `sugerirUmbralClustering` | function | 2137 | `(corridas: ResultadoUniversal[], campoId: string) => { sugerido: number; minConTinta: number; maxSinTinta: number; metodo: "clustering" \| "corte_fijo"; corridas` |
| `TECHO_RUIDO` | variable | 2032 | `0.02` |
| `textoEnRect` | function | 935 | `(lineas: LineaOcr[], rect: RectNorm, canvasW: number, canvasH: number) => { texto: string; conf: number; palabras: number; }` |
| `valorNumerico` | function | 1377 | `(r: ResultadoCampoUniversal) => number` |

### packages/scanner-core/molde/universal-types.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `AnclaUniversal` | interface | 63 | `any` |
| `CampoUniversal` | interface | 76 | `any` |
| `ClaseLayout` | typealias | 238 | `any` |
| `COLOR_TIPO` | variable | 347 | `Record<TipoCampo, string>` |
| `erroresMolde` | function | 690 | `(obj: unknown) => string[]` |
| `esMoldeUniversal` | function | 639 | `(obj: unknown) => obj is MoldeUniversal` |
| `EstrategiaCampo` | typealias | 32 | `any` |
| `hexTipo` | function | 354 | `(tipo: string) => string` |
| `LayoutMolde` | interface | 297 | `any` |
| `MOLDE_UNIVERSAL_VERSION` | variable | 344 | `"3.2.0"` |
| `MoldeUniversal` | interface | 307 | `any` |
| `nuevoIdCampo` | function | 755 | `() => string` |
| `RectNorm` | interface | 22 | `any` |
| `ReglaLayout` | interface | 252 | `any` |
| `RelacionAncla` | interface | 39 | `any` |
| `ResultadoCampoUniversal` | interface | 369 | `any` |
| `ResultadoPaginaUniversal` | interface | 421 | `any` |
| `ResultadoUniversal` | interface | 440 | `any` |
| `ResultadoValidacion` | interface | 430 | `any` |
| `TipoCampo` | typealias | 29 | `any` |
| `UMBRAL_APROBADO` | variable | 760 | `98` |
| `ValidacionMolde` | interface | 198 | `any` |

### packages/scanner-core/obs-base/breadcrumbs.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `breadcrumb` | function | 17 | `(evento: string, datos?: Record<string, unknown>) => void` |
| `iniciarBreadcrumbs` | function | 30 | `() => void` |
| `onBreadcrumb` | function | 9 | `(escucha: Escucha) => () => void` |

### packages/scanner-core/src/contract/contrato.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `CLAVES_TOP_LEVEL` | variable | 24 | `readonly ["tipo", "version", "nombre", "descripcion", "documento", "idioma", "paginasRef", "campos", "validaciones", "layout", "meta"]` |
| `erroresContrato` | function | 45 | `(obj: unknown) => string[]` |
| `erroresMolde` | exportspecifier | 20 | `(obj: unknown) => string[]` |
| `esMoldeUniversal` | exportspecifier | 20 | `(obj: unknown) => obj is MoldeUniversal` |
| `MOLDE_UNIVERSAL_VERSION` | exportspecifier | 20 | `"3.2.0"` |
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
| `erroresContrato` | exportspecifier | 20 | `(obj: unknown) => string[]` |
| `erroresMolde` | exportspecifier | 19 | `(obj: unknown) => string[]` |
| `esMoldeUniversal` | exportspecifier | 18 | `(obj: unknown) => obj is MoldeUniversal` |
| `esSobreConMolde` | exportspecifier | 28 | `(p: unknown) => p is { checksum: string; molde: unknown; }` |
| `EstructuraActa` | exportspecifier | 45 | `any` |
| `EtapaAnalisis` | exportspecifier | 46 | `any` |
| `FuenteCaptura` | exportspecifier | 47 | `any` |
| `HistorialRow` | exportspecifier | 48 | `any` |
| `Mesa` | exportspecifier | 49 | `any` |
| `MesaPagina` | exportspecifier | 50 | `any` |
| `MetricasActa` | exportspecifier | 51 | `any` |
| `MOLDE_UNIVERSAL_VERSION` | exportspecifier | 21 | `"3.2.0"` |
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

---

Total: 315 símbolos en 36 archivos de 3 paquetes.
