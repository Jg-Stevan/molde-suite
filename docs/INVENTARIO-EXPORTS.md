# Inventario de exports (generado por scripts/analyze-exports.ts)

> Determinista: orden alfabético por archivo y símbolo; sin timestamps ni rutas absolutas. Dos ejecuciones seguidas sin cambios de código producen diff vacío.

## apps/tamiz/src/lib/e14/adaptacion/plan.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `presupuestoEscaneoEfectivo` | function | 19 | `() => number` |
| `tierDelDispositivo` | function | 9 | `() => TierDispositivo` |
| `TierDispositivo` | typealias | 7 | `any` |
| `topeLadoLargoPx` | function | 31 | `() => number` |

## apps/tamiz/src/lib/e14/bridge/calidad.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `calidadDeActa` | function | 27 | `(fotoProcesada: string) => Promise<PageQuality>` |
| `contrasteEfectivoDe` | function | 54 | `(q: PageQuality) => number` |
| `esquinasDeActa` | function | 75 | `(fotoProcesada: string) => Promise<{ completa: boolean; ladoEsquina: string; }>` |
| `scoreDeCalidad` | function | 62 | `(q: PageQuality) => number` |

## apps/tamiz/src/lib/e14/bridge/captura.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `capturarFrame` | function | 19 | `(video: HTMLVideoElement) => string` |
| `decodeArchivoMemo` | function | 31 | `(archivo: File) => Promise<string>` |
| `EntradaPipeline` | typealias | 16 | `any` |
| `entradaSimDeImagen` | function | 46 | `(id: ImagenSimuladaId) => Promise<{ archivo: File; }>` |
| `esperarWorkerCaliente` | function | 56 | `() => Promise<void>` |
| `QUAD_IDENTITY` | variable | 8 | `Quad` |

## apps/tamiz/src/lib/e14/bridge/estructura.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `evaluarEstructuraDelActa` | function | 32 | `(fotoProcesada: string) => Promise<EstructuraActa>` |

## apps/tamiz/src/lib/e14/bridge/ocr-dinamico.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `ocrBandaDinamicaSiDisponible` | function | 15 | `(fotoProcesada: string, parte: "sup" \| "inf") => Promise<string>` |

## apps/tamiz/src/lib/e14/bridge/ocr-worker.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `getWorker` | function | 18 | `() => Promise<TesseractWorkerLike>` |
| `TesseractWorkerLike` | typealias | 9 | `any` |

## apps/tamiz/src/lib/e14/bridge/ocr.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `ocrBanda` | function | 92 | `(dataUrl: string) => Promise<string>` |
| `ocrBandaInferior` | function | 104 | `(dataUrl: string) => Promise<string>` |
| `reconocerRapidOcr` | function | 30 | `(dataUrl: string) => Promise<string>` |
| `reconocerRapidOcrCascada` | function | 44 | `(dataUrl: string) => Promise<string>` |
| `reconocerRapidOcrEscalonado` | function | 36 | `(dataUrl: string) => Promise<string>` |

## apps/tamiz/src/lib/e14/bridge/pipeline-recorte.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `correrPipelineRecorte` | function | 40 | `(deps: DepsRecorte, acta: Acta, fotoOriginal: string, quad: Quad, rotacion: number, emitir: (p: ProgresoAnalisis) => void, _quadOrigen?: OrigenQuad \| "pagina-completa", manual?: boolean, parcial?: Par` |
| `DepsRecorte` | interface | 29 | `any` |
| `ParcialRecorte` | interface | 20 | `any` |
| `RECORTE_TIMEOUT_MS` | variable | 17 | `15000` |

## apps/tamiz/src/lib/e14/bridge/progreso.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `conRampa` | function | 43 | `(etapa: EtapaAnalisis, fraccion: number) => ProgresoAnalisis` |
| `ORDEN_ETAPAS` | variable | 19 | `{}` |
| `PESOS` | variable | 7 | `Record<EtapaAnalisis, number>` |

## apps/tamiz/src/lib/e14/bridge/protocolo.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `CamposActa` | typealias | 167 | `any` |
| `DETALLE_BAJO` | variable | 60 | `"NO SE RECONOCE INFORMACIÓN DEL DOCUMENTO — REPITA LA FOTO"` |
| `DETALLE_ESTRUCTURA` | variable | 63 | `"EL DOCUMENTO NO CORRESPONDE A LA PLANTILLA DEL MOLDE ACTIVO"` |
| `DETALLE_GENERICO` | variable | 45 | `"SCORE INSUFICIENTE PARA ENVIAR"` |
| `DETALLE_ILEGIBLE` | variable | 43 | `"CÓDIGO DE BARRAS Y CABECERA NO DETECTADOS"` |
| `DETALLE_INCOMPLETA` | variable | 48 | `"EL DOCUMENTO ESTÁ CORTADO EN EL ENCUADRE — ALÉJATE UN POCO Y CAPTURA EL DOCUMENTO COMPLETO"` |
| `DETALLE_SIN_VOTOS` | variable | 56 | `"DOCUMENTO SIN DATOS VISIBLES"` |
| `DETALLE_TIMEOUT` | variable | 44 | `"TIEMPO DE PROCESADO EXCEDIDO"` |
| `EstructuraActa` | exportspecifier | 306 | `any` |
| `fmtClasif` | function | 124 | `(c: ClasificacionE14) => string` |
| `OpcionesEscaneoConTimeout` | typealias | 95 | `any` |
| `ParcialPipeline` | interface | 148 | `any` |
| `PasosCalidad` | typealias | 223 | `any` |
| `PasosCaptura` | typealias | 214 | `any` |
| `PasosEstructura` | typealias | 290 | `any` |
| `PasosGate` | typealias | 246 | `any` |
| `PasosMolde` | typealias | 279 | `any` |
| `PasosOcr` | typealias | 229 | `any` |
| `PasosPipelineL2` | typealias | 294 | `any` |
| `ResultadoGate` | interface | 117 | `any` |
| `senalDeContenido` | function | 73 | `(texto: string, clasificacion: ClasificacionE14) => boolean` |

## apps/tamiz/src/lib/e14/bridge/real-core-bridge.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `RealCoreBridge` | class | 131 | `typeof RealCoreBridge` |

## apps/tamiz/src/lib/e14/checklist.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `construirChecklist` | function | 280 | `(acta: Acta, plantilla?: DefinicionPlantilla) => PlantillaChecklist` |
| `conteoDeGrupo` | function | 288 | `(g: GrupoChecklist) => { pasados: number; total: number; }` |
| `DefinicionPlantilla` | interface | 55 | `any` |
| `EstadoChecklist` | typealias | 29 | `any` |
| `etiquetaFormulario` | function | 87 | `(t: string) => string` |
| `GrupoChecklist` | interface | 42 | `any` |
| `ItemChecklist` | interface | 34 | `any` |
| `PLANTILLA_E14` | variable | 264 | `DefinicionPlantilla` |
| `PlantillaChecklist` | interface | 48 | `any` |
| `resumenDe` | function | 295 | `(pl: PlantillaChecklist) => { pasados: number; total: number; }` |
| `TonoChecklist` | typealias | 32 | `any` |
| `tonoDeGrupo` | function | 305 | `(g: GrupoChecklist) => TonoChecklist` |
| `tonoDeStatus` | function | 312 | `(status: ActaStatus) => TonoChecklist` |

## apps/tamiz/src/lib/e14/core/pdf-export.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `downloadBlob` | function | 3 | `(blob: Blob, nombre: string) => void` |

## apps/tamiz/src/lib/e14/core/quality.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `SHUTTER_SCORE` | variable | 4 | `0.55` |

## apps/tamiz/src/lib/e14/core/sensor-profiler.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `archivoDentroDeTope` | function | 31 | `(archivo: File, perfil: SensorProfile) => { ok: boolean; razon?: string; }` |
| `profileActiveSensor` | function | 16 | `(stream: MediaStream) => SensorProfile` |
| `SensorProfile` | interface | 7 | `any` |

## apps/tamiz/src/lib/e14/core/wake-lock.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `useWakeLock` | function | 8 | `(activo: boolean) => void` |

## apps/tamiz/src/lib/e14/dla/plusl.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `borrarPlusL` | function | 175 | `() => Promise<boolean>` |
| `descargarPlusL` | function | 77 | `(onProgreso?: (p: ProgresoPlusL) => void) => Promise<ResultadoDescarga>` |
| `estadoPlusL` | function | 162 | `() => Promise<{ presente: boolean; bytes: number; }>` |
| `formatearMB` | function | 216 | `(bytes: number) => string` |
| `pedirPersistencia` | function | 206 | `() => Promise<boolean>` |
| `persistenciaActiva` | function | 196 | `() => Promise<boolean>` |
| `ProgresoPlusL` | interface | 39 | `any` |
| `ResultadoDescarga` | typealias | 45 | `any` |
| `urlPlusL` | function | 33 | `() => string` |
| `usoAlmacenamiento` | function | 186 | `() => Promise<{ uso: number; cuota: number; }>` |

## apps/tamiz/src/lib/e14/errores.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `AvisoOperador` | interface | 14 | `any` |
| `MotivoOperador` | typealias | 4 | `any` |
| `TEXTO_MOTIVO` | variable | 21 | `Record<MotivoOperador, string>` |

## apps/tamiz/src/lib/e14/fachada.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `Acta` | exportspecifier | 11 | `any` |
| `ActaStatus` | exportspecifier | 11 | `any` |
| `cargarDivipol` | function | 110 | `() => Promise<DivipolBase>` |
| `ClasificacionE14` | exportspecifier | 11 | `any` |
| `defaultQuad` | exportspecifier | 15 | `() => Quad` |
| `departamentosDe` | function | 121 | `(base: DivipolBase) => {}` |
| `DivipolBase` | interface | 35 | `any` |
| `estadoDivipol` | function | 117 | `() => "no-cargado" \| "listo" \| "fallo"` |
| `EtapaAnalisis` | exportspecifier | 11 | `any` |
| `FuenteCaptura` | exportspecifier | 11 | `any` |
| `getBridge` | exportspecifier | 15 | `() => E14Bridge` |
| `HistorialRow` | exportspecifier | 11 | `any` |
| `municipiosDe` | function | 125 | `(base: DivipolBase, dep: string) => {}` |
| `nombreExportacion` | function | 23 | `(c: ClasificacionE14) => string` |
| `ProgresoAnalisis` | exportspecifier | 11 | `any` |
| `puestosDe` | function | 137 | `(base: DivipolBase, dep: string, mun: string, zon: string) => Array<DivipolRef & { mesas: number; }>` |
| `Quad` | exportspecifier | 11 | `any` |
| `TipoCopia` | typealias | 13 | `any` |
| `warmUpScannerWorker` | function | 18 | `() => void` |
| `zonasDe` | function | 131 | `(base: DivipolBase, dep: string, mun: string) => {}` |

## apps/tamiz/src/lib/e14/flags.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `Flags` | interface | 4 | `any` |
| `leerFlags` | function | 49 | `() => Flags` |
| `refrescarFlags` | function | 38 | `() => void` |

## apps/tamiz/src/lib/e14/get-bridge.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `getBridge` | function | 8 | `() => E14Bridge` |

## apps/tamiz/src/lib/e14/hash.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `sha256HexDeDataUrl` | function | 4 | `(dataUrl: string) => Promise<string>` |

## apps/tamiz/src/lib/e14/jornada.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `cargarJornada` | function | 161 | `() => Promise<EstadoJornada>` |
| `enFalloEscrituraJornada` | function | 138 | `(receptor: (fallo: FalloEscrituraJornada) => void) => void` |
| `FalloEscrituraJornada` | typealias | 125 | `any` |
| `guardarActaEnRevision` | function | 348 | `(acta: Acta) => Promise<void>` |
| `guardarJornada` | function | 175 | `(estado: EstadoJornada) => Promise<void>` |
| `leerActaEnRevision` | function | 365 | `() => Promise<Acta>` |
| `mesasRealesDe` | function | 398 | `(archivadas: Record<string, ActaArchivada>, puesto: PuestoActual, total: number) => {}` |
| `TOPE_HISTORIAL` | variable | 45 | `200` |

## apps/tamiz/src/lib/e14/molde/almacen.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `activarGuardado` | function | 105 | `(id: string) => Promise<{ ok: boolean; errores: {}; nombre?: string; }>` |
| `borrarMolde` | function | 97 | `(id: string) => Promise<void>` |
| `GuardadoMolde` | interface | 22 | `any` |
| `guardarMolde` | function | 81 | `(molde: MoldeUniversal, checksum?: string) => Promise<GuardadoMolde>` |
| `listarMoldes` | function | 69 | `() => Promise<{}>` |
| `migrarDesdeLocalStorage` | function | 118 | `() => Promise<void>` |

## apps/tamiz/src/lib/e14/molde/enrutamiento.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `CandidatoMolde` | interface | 179 | `any` |
| `candidatosDeSesion` | function | 244 | `() => Promise<{}>` |
| `ContextoE14Acta` | interface | 40 | `any` |
| `elegirCandidato` | function | 185 | `(moldes: {}, lineas: {}, canvasW: number, canvasH: number) => CandidatoMolde` |
| `MOLDE_DEMO_RECIBO` | variable | 50 | `MoldeUniversal` |
| `ratioAnclasDe` | function | 163 | `(molde: MoldeUniversal, lineas: {}, canvasW: number, canvasH: number) => number` |
| `sembrarMoldeDemo` | function | 128 | `() => Promise<void>` |
| `UMBRAL_HIT_ANCLA` | variable | 36 | `0.6` |
| `UMBRAL_RUTA_ANCLAS` | variable | 34 | `0.5` |
| `UMBRAL_RUTA_SCORE` | variable | 32 | `65` |
| `veredictoDeResumen` | function | 217 | `(r: ResumenMoldeActa) => VeredictoMolde` |
| `VeredictoMolde` | interface | 205 | `any` |

## apps/tamiz/src/lib/e14/molde/evaluacion.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `evaluarMoldeEnActa` | function | 175 | `(fotoProcesada: string, contexto?: ContextoE14Acta) => Promise<ResumenMoldeActa>` |

## apps/tamiz/src/lib/e14/molde/importar.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `importarMoldeDesdeTexto` | function | 78 | `(texto: string) => Promise<ResultadoImportacion>` |
| `ResultadoImportacion` | typealias | 30 | `any` |

## apps/tamiz/src/lib/e14/molde/ocr-proveedor.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `ocrLines` | function | 16 | `(canvas: HTMLCanvasElement) => Promise<{ lines: {}; conf: number; }>` |
| `ocrTextoUnico` | function | 73 | `(canvas: HTMLCanvasElement, opts?: { whitelist?: string; psm?: "6" \| "7" \| "8" \| "13"; }) => Promise<{ texto: string; conf: number; }>` |
| `proveedorOcrTamiz` | variable | 108 | `ProveedorOcr` |

## apps/tamiz/src/lib/e14/molde/registry.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `activarMolde` | function | 36 | `(json: unknown) => { ok: boolean; errores: {}; nombre?: string; }` |
| `desactivarMolde` | function | 50 | `() => void` |
| `moldeActivo` | function | 18 | `() => MoldeUniversal` |

## apps/tamiz/src/lib/e14/obs/captura.tsx

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `emitirPerfDeActa` | function | 37 | `(m: MuestraPerfActa) => void` |
| `ErrorBoundaryObs` | class | 50 | `typeof ErrorBoundaryObs` |
| `instalarCaptura` | function | 25 | `() => void` |
| `MuestraPerfActa` | interface | 8 | `any` |

## apps/tamiz/src/lib/e14/obs/dispositivo.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `iniciarMuestreoSalud` | function | 21 | `() => void` |
| `redActual` | function | 9 | `() => RedInfo` |
| `RedInfo` | interface | 3 | `any` |

## apps/tamiz/src/lib/e14/obs/hang.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `iniciarDetectorHang` | function | 6 | `() => void` |

## apps/tamiz/src/lib/e14/obs/heartbeat.client.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `iniciarSensorHangEnCurso` | function | 7 | `() => void` |

## apps/tamiz/src/lib/e14/obs/lcp-cls.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `instalarObserverLcpCls` | function | 24 | `() => void` |
| `SCRIPT_LCP_CLS` | variable | 5 | `"(function(){try{\nvar lcp=0,cls=0,po;\nif(window.PerformanceObserver){\npo=new PerformanceObserver(function(list){\nfor(var i=0;i<list.getEntries().length;i++){\nvar e=list.getEntries()[i];\nif(e.ent` |

## apps/tamiz/src/lib/e14/obs/transporte.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `iniciarTransporte` | function | 9 | `() => void` |

## apps/tamiz/src/lib/e14/obs/uso.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `iniciarUso` | function | 8 | `() => void` |

## apps/tamiz/src/lib/e14/ocr/rapidocr.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `rapidOcrPrecalentar` | function | 8 | `() => Promise<void>` |

## apps/tamiz/src/lib/e14/ocr/tesseract.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `tessPrecalentar` | function | 7 | `() => void` |

## apps/tamiz/src/lib/e14/pipeline.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `correrPipelineL2` | function | 51 | `(opciones: OpcionesEscaneoConTimeout, entrada: EntradaPipeline, parcial: ParcialPipeline, emitir: (p: ProgresoAnalisis) => void, pasos: PasosPipelineL2) => Promise<Acta>` |

## apps/tamiz/src/lib/e14/politica/umbrales.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `SHUTTER_SCORE_VISOR` | variable | 8 | `0.55` |
| `TECHO_ESCUDO_FONDO` | variable | 14 | `7.2` |
| `TECHO_SEGUNDO_INTENTO` | variable | 17 | `8.9` |
| `TECHO_SIN_SENAL` | variable | 11 | `6.9` |
| `TIMEOUT_ALTO_MS` | variable | 20 | `120000` |
| `TIMEOUT_BAJO_MS` | variable | 22 | `480000` |
| `TIMEOUT_MEDIO_MS` | variable | 21 | `240000` |
| `UMBRAL_RECHAZO_SCORE` | variable | 5 | `6.5` |

## apps/tamiz/src/lib/e14/puente/cola.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `contarPendientes` | function | 3 | `() => Promise<number>` |

## apps/tamiz/src/lib/e14/puente/enganche.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `iniciarPuenteSupervision` | function | 3 | `() => void` |

## apps/tamiz/src/lib/e14/puente/envio.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `esOrigenLocal` | function | 33 | `() => boolean` |
| `estadoPuente` | function | 22 | `() => EstadoPuente` |
| `EstadoPuente` | interface | 5 | `any` |
| `fijarHubLocal` | function | 41 | `(apuntarALocal: boolean) => string` |
| `hubEnUso` | function | 27 | `() => string` |
| `iniciarPuenteSupervision` | function | 74 | `() => void` |
| `sincronizarAhora` | function | 56 | `() => Promise<{ detalle: string; enviadas: number; }>` |

## apps/tamiz/src/lib/e14/puente/tipos.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `EstadoPuente` | exportspecifier | 3 | `any` |

## apps/tamiz/src/lib/e14/rastreo/motor.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `iniciarRastreo` | function | 7 | `() => void` |
| `sesionActual` | function | 14 | `() => string` |

## apps/tamiz/src/lib/e14/simulacion-imagenes.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `dibujarImagenSimulada` | function | 46 | `(id: ImagenSimuladaId) => string` |
| `IMAGENES_SIMULADAS` | variable | 32 | `{}` |
| `ImagenSimulada` | interface | 19 | `any` |
| `ImagenSimuladaId` | typealias | 7 | `any` |

## apps/tamiz/src/lib/e14/store/envio.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `crearEnvio` | function | 243 | `(set: { (partial: any, replace?: false): void; (state: E14Store \| ((state: E14Store) => E14Store), replace: true): void; }, get: () => E14Store) => Pick<E14Store, "completadas" \| "historial" \| "colaOf` |
| `idHistorial` | function | 32 | `() => string` |
| `registrarEnvio` | function | 125 | `(set: { (partial: any, replace?: false): void; (state: E14Store \| ((state: E14Store) => E14Store), replace: true): void; }, get: () => E14Store, tituloPagina: string) => Promise<{ online: boolean; hor` |
| `tituloPaginaActual` | function | 226 | `(get: () => E14Store) => string` |

## apps/tamiz/src/lib/e14/store/guion.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `marcarPaginaOK` | function | 9 | `(mesas: {}, pagina: PaginaObjetivo) => {}` |
| `refrescarMesasDeArchivo` | function | 27 | `(set: { (partial: any, replace?: false): void; (state: E14Store \| ((state: E14Store) => E14Store), replace: true): void; }, get: () => E14Store) => void` |

## apps/tamiz/src/lib/e14/store/index.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `ActaArchivada` | exportspecifier | 24 | `any` |
| `AvisoOperador` | exportspecifier | 379 | `any` |
| `E14Store` | exportspecifier | 24 | `any` |
| `HuecoArchivado` | exportspecifier | 24 | `any` |
| `ImagenSimuladaId` | exportspecifier | 379 | `any` |
| `MotivoOperador` | exportspecifier | 379 | `any` |
| `PuestoActual` | exportspecifier | 24 | `any` |
| `TEXTO_MOTIVO` | exportspecifier | 378 | `Record<MotivoOperador, string>` |
| `useE14Store` | variable | 341 | `UseBoundStore<StoreApi<E14Store>>` |
| `Vista` | exportspecifier | 24 | `any` |

## apps/tamiz/src/lib/e14/store/navegacion.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `crearNavegacion` | function | 12 | `(set: { (partial: any, replace?: false): void; (state: E14Store \| ((state: E14Store) => E14Store), replace: true): void; }, get: () => E14Store) => Pick<E14Store, "vista" \| "vistaPrevia" \| "destelloKe` |

## apps/tamiz/src/lib/e14/store/tipos.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `ActaArchivada` | interface | 284 | `any` |
| `E14Get` | typealias | 312 | `any` |
| `E14Set` | typealias | 310 | `any` |
| `E14Store` | interface | 35 | `any` |
| `E14StoreApi` | typealias | 314 | `any` |
| `HuecoArchivado` | interface | 278 | `any` |
| `PuestoActual` | interface | 292 | `any` |
| `Vista` | typealias | 24 | `any` |

## apps/tamiz/src/lib/e14/ui/ZoomableVisor.tsx

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `ZoomableVisor` | function | 23 | `(props: PropsCard \| PropsFull) => Element` |

## packages/scanner-core/core/calidad.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `calidadDeActa` | function | 19 | `(fotoProcesada: string) => Promise<PageQuality>` |
| `contrasteEfectivoDe` | function | 46 | `(q: PageQuality) => number` |
| `esquinasDeActa` | function | 67 | `(fotoProcesada: string) => Promise<{ completa: boolean; ladoEsquina: string; }>` |
| `scoreDeCalidad` | function | 54 | `(q: PageQuality) => number` |

## packages/scanner-core/core/image-processor.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `detectDocumentEdgesDetail` | function | 56 | `(foto: string) => Promise<{ quad: Quad; origen: OrigenQuad; }>` |
| `ErrorRescateHeic` | class | 23 | `typeof ErrorRescateHeic` |
| `OrigenQuad` | typealias | 15 | `any` |
| `processImage` | function | 156 | `(foto: string, quad: Quad, filtro: PageFilter, rotation: number, opts?: { manual?: boolean; deskew?: boolean; }) => Promise<{ processed: string; width: number; height: number; }>` |

## packages/scanner-core/core/ocr.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `ocrTextIsValid` | function | 5 | `(texto: string) => boolean` |

## packages/scanner-core/core/types.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `defaultQuad` | function | 26 | `() => Quad` |
| `esQuadIdentidad` | function | 36 | `(q: Quad, eps?: number) => boolean` |
| `PageFilter` | typealias | 13 | `any` |
| `PageQuality` | interface | 16 | `any` |
| `Punto` | interface | 4 | `any` |
| `Quad` | typealias | 10 | `any` |

## packages/scanner-core/dominio/bridge.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `E14Bridge` | interface | 41 | `any` |
| `OpcionesEscaneo` | interface | 23 | `any` |
| `OpcionesEscaneoExtendidas` | typealias | 34 | `any` |
| `PaginaObjetivo` | interface | 15 | `any` |

## packages/scanner-core/dominio/clasificador.ts

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

## packages/scanner-core/dominio/types.ts

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

## packages/scanner-core/molde/homografia.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `anguloDeskew` | function | 179 | `(src: HTMLCanvasElement) => number` |
| `aplicarHomografia` | function | 79 | `(H: Matriz8, x: number, y: number) => { x: number; y: number; }` |
| `corregirDeskew` | function | 251 | `(src: HTMLCanvasElement, anguloCorrector: number) => HTMLCanvasElement` |
| `Matriz8` | typealias | 19 | `any` |
| `quadSesgado` | function | 89 | `(quad: Quad, eps?: number) => boolean` |
| `resolverHomografia` | function | 23 | `(src: {}, dst: {}) => Matriz8` |
| `warpPerspectiva` | function | 111 | `(src: HTMLCanvasElement, quad: Quad, ancho: number) => HTMLCanvasElement` |

## packages/scanner-core/molde/imageproc.ts

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

## packages/scanner-core/molde/marca.ts

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

## packages/scanner-core/molde/ocr-tipos.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `canvasJpeg` | function | 59 | `(canvas: HTMLCanvasElement, maxW?: number, q?: number) => string` |
| `configurarProveedorOcr` | function | 36 | `(p: ProveedorOcr) => void` |
| `hayProveedorOcr` | function | 52 | `() => boolean` |
| `LineaOcr` | interface | 16 | `any` |
| `PalabraOcr` | interface | 10 | `any` |
| `proveedorOcr` | function | 41 | `() => ProveedorOcr` |
| `ProveedorOcr` | interface | 23 | `any` |

## packages/scanner-core/molde/tabla-detect.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `CeldaTabla` | interface | 22 | `any` |
| `detectarTabla` | function | 150 | `(lines: {}, zona: RectNorm, dims: { w: number; h: number; }, opts?: { maxFilas?: number; maxCols?: number; }) => TablaDetectada` |
| `detectarTablaCompleta` | function | 265 | `(lines: {}, zona: RectNorm, dims: { w: number; h: number; }, canvas?: HTMLCanvasElement, opts?: { maxFilas?: number; maxCols?: number; }) => TablaDetectada` |
| `TablaDetectada` | interface | 29 | `any` |

## packages/scanner-core/molde/tabla-imagen.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `Banda` | interface | 24 | `any` |
| `bandasAContenido` | function | 146 | `(reglas: {}, desde: number, hasta: number) => {}` |
| `KERNEL_MIN` | exportspecifier | 169 | `24` |
| `reticulaDesdeImagen` | function | 96 | `(canvas: HTMLCanvasElement, zona: RectNorm) => ReticulaImagen` |
| `ReticulaImagen` | interface | 29 | `any` |

## packages/scanner-core/molde/universal-engine.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `alinearAnclas` | function | 1419 | `(molde: MoldeUniversal, canvas: HTMLCanvasElement, pagina?: number) => Promise<{ molde: MoldeUniversal; encontradas: number; total: number; detalles: Record<string, "no" \| "ancla" \| "respaldo">; }>` |
| `ANCLA_SCORE_MIN` | variable | 255 | `0.72` |
| `buscarAncla` | function | 153 | `(texto: string, lineas: {}, canvasW: number, canvasH: number, rectEsperado?: RectNorm) => HitAncla` |
| `editDistance` | function | 52 | `(a: string, b: string) => number` |
| `editDistancePonderada` | function | 110 | `(a: string, b: string) => number` |
| `evaluarDocumentoUniversal` | function | 1220 | `(canvases: {}, molde: MoldeUniversal, nombreArchivo: string, onProgreso?: (msg: string) => void, renderMs?: number, opts?: { previews?: boolean; }) => Promise<ResultadoUniversal>` |
| `FARO_MARGEN` | variable | 302 | `0.01` |
| `hexTipo` | exportspecifier | 1761 | `(tipo: string) => string` |
| `HitAncla` | interface | 137 | `any` |
| `lineasEnFaro` | function | 318 | `(lineas: {}, canvasW: number, canvasH: number, faro: RectNorm) => {}` |
| `MIN_CORRIDAS_CLUSTERING` | variable | 1542 | `3` |
| `normTxt` | function | 42 | `(s: string) => string` |
| `parsearIgualdad` | function | 1088 | `(expresion: string) => { izq: string; der: Array<{ tipo: "id" \| "num"; valor: string; }>; }` |
| `RADIO_DESAMBIGUACION` | variable | 260 | `0.3` |
| `rectEditor` | function | 657 | `(campo: CampoUniversal) => RectNorm` |
| `RectResuelto` | interface | 220 | `any` |
| `resolverRectCampo` | function | 599 | `(campo: CampoUniversal, lineas: {}, canvasW: number, canvasH: number, canvas?: HTMLCanvasElement) => RectResuelto` |
| `resolverRectRelacional` | function | 468 | `(campo: CampoUniversal, lineas: {}, canvasW: number, canvasH: number, canvas?: HTMLCanvasElement) => RectResuelto` |
| `sugerirUmbral` | function | 1467 | `(resultados: ResultadoUniversal, campoId: string) => { sugerido: number; minConTinta: number; maxSinTinta: number; motivo?: "sin_mediciones" \| "sin_tinta" \| "sin_celdas_vacias" \| "clases_entrelazadas"` |
| `sugerirUmbralClustering` | function | 1644 | `(corridas: {}, campoId: string) => { sugerido: number; minConTinta: number; maxSinTinta: number; metodo: "clustering" \| "corte_fijo"; corridasConMediciones: number; motivo?: "sin_mediciones" \| "sin_ti` |
| `TECHO_RUIDO` | variable | 1539 | `0.02` |
| `valorNumerico` | function | 1067 | `(r: ResultadoCampoUniversal) => number` |

## packages/scanner-core/molde/universal-types.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `AnclaUniversal` | interface | 63 | `any` |
| `CampoUniversal` | interface | 76 | `any` |
| `ClaseLayout` | typealias | 229 | `any` |
| `COLOR_TIPO` | variable | 338 | `Record<TipoCampo, string>` |
| `erroresMolde` | function | 681 | `(obj: unknown) => {}` |
| `esMoldeUniversal` | function | 630 | `(obj: unknown) => obj is MoldeUniversal` |
| `EstrategiaCampo` | typealias | 32 | `any` |
| `hexTipo` | function | 345 | `(tipo: string) => string` |
| `LayoutMolde` | interface | 288 | `any` |
| `MOLDE_UNIVERSAL_VERSION` | variable | 335 | `"3.2.0"` |
| `MoldeUniversal` | interface | 298 | `any` |
| `nuevoIdCampo` | function | 746 | `() => string` |
| `RectNorm` | interface | 22 | `any` |
| `ReglaLayout` | interface | 243 | `any` |
| `RelacionAncla` | interface | 39 | `any` |
| `ResultadoCampoUniversal` | interface | 360 | `any` |
| `ResultadoPaginaUniversal` | interface | 412 | `any` |
| `ResultadoUniversal` | interface | 431 | `any` |
| `ResultadoValidacion` | interface | 421 | `any` |
| `TipoCampo` | typealias | 29 | `any` |
| `UMBRAL_APROBADO` | variable | 751 | `98` |
| `ValidacionMolde` | interface | 197 | `any` |

## packages/scanner-core/obs-base/breadcrumbs.ts

| Símbolo | Clase | Línea | Firma |
|---|---|---|---|
| `breadcrumb` | function | 17 | `(evento: string, datos?: Record<string, unknown>) => void` |
| `iniciarBreadcrumbs` | function | 30 | `() => void` |
| `onBreadcrumb` | function | 9 | `(escucha: Escucha) => () => void` |

---

Total: 356 símbolos en 68 archivos.
