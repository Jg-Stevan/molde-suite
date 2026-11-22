# PLAN-AGENTE-LAYOUT.md — Detección de layout y validación estructural

> **Para el agente que ejecuta:** este documento es el contrato de trabajo.
> Léelo completo antes de tocar código. La evidencia que lo sustenta está en
> [`docs/investigacion/2026-11-22-pp-doclayout-en-navegador.md`](docs/investigacion/2026-11-22-pp-doclayout-en-navegador.md)
> y los artefactos en [`docs/investigacion/pp-doclayout/`](docs/investigacion/pp-doclayout/).
>
> **Trabajo pesado:** integrar PP-DocLayout (stock, en navegador) en Molde
> Studio y Tamiz, con reglas estructurales declarativas, autoría visual y
> validación offline en el celular.

## 0. Decisiones cerradas por el dueño

| Tema | Decisión |
|---|---|
| Alcance del MVP | **Estructura + OCR**: layout detecta zonas y el OCR actual lee/valida campos. |
| Distribución de moldes | **Archivo/QR local**: Studio exporta `.json`; Tamiz lo importa. Sin backend ni cuentas. |
| Entrega de Tamiz | **PWA offline-first**: instalable, cachea modelos y OCR, funciona sin red tras la primera carga. |
| Modelo | **Probar S con estructura** como opción principal por peso/velocidad; plus-L queda como precisión opcional. La Fase 0 decide con métricas. |

## 1. Contexto actual del repo

| Pieza | Ruta | Estado |
|---|---|---|
| Editor de moldes | `apps/molde-studio/src/components/studio/EditorTab.tsx` (3.235 líneas) | Dibujo de campos, OCR, verificación, exportación |
| Motor universal v3 | `apps/molde-studio/src/lib/molde/universal-engine.ts` (1.304 líneas) | Resuelve anclas, zonas, presencia, firmas, validaciones |
| Tipos del molde | `apps/molde-studio/src/lib/molde/universal-types.ts` | `MoldeUniversal`, campos, validadores |
| APIs Studio | `apps/molde-studio/src/app/api/moldes/`, `/api/pruebas/`, `/api/upload/` | CRUD + corridas |
| Tamiz pipeline | `apps/tamiz/src/lib/e14/pipeline.ts` (180 líneas) | Orquesta captura/calidad/OCR/gate |
| Puente real | `apps/tamiz/src/lib/e14/bridge/real-core-bridge.ts` (680 líneas) | Bordes, calidad, OCR, clasificación, gate |
| Pantallas | `apps/tamiz/src/components/e14/screens/{ScanView,ReviewView,AnalyzingView,ResumenView}.tsx` | Captura, revisión, estados |
| Store | `apps/tamiz/src/lib/e14/store/index.ts` | Zustand |
| PWA | `apps/tamiz/src/components/e14/PwaRegister.tsx` | Registro parcial; falta SW/manifest real |
| Build estático | `apps/tamiz/next.config.ts` (`output: "export"` con `BUILD_STATIC`) | Ya soportado |
| Cabeceras | `apps/tamiz/src/proxy.ts`, `apps/tamiz/public/_headers` | COOP/COEP condicionales |

Bang del banco de pruebas (fuera del repo):
`C:\Users\JG\Documents\PROYECTOS\pruebas\pp-doclayout-test`.

## 2. Objetivo y no-objetivos

### Objetivo

1. Studio permite crear un molde **visualmente**: detecta bloques sobre el
   documento de referencia, el usuario marca cuáles son obligatorios, los
   asigna a campos y corrige fusiones/divisiones.
2. El molde exportado incluye reglas estructurales declarativas (zonas,
   clases, conteos, tolerancias, divisiones).
3. Tamiz, 100% local en el celular, captura → detecta layout → valida
   estructura → lee campos con OCR → decide **ÓPTIMA / ADVERTENCIA /
   RECHAZADA** con motivos por regla/campo.
4. Funciona offline en PWA; S por defecto si la Fase 0 lo valida; plus-L
   opcional descargable.

### No-objetivos (no hacer sin autorización)

- Reentrenar, cuantizar o modificar los ONNX.
- Backend, autenticación, multiusuario o sincronización en nube.
- App nativa/Capacitor.
- Enviar fotos o documentos a servidores.
- Reemplazar el motor OCR existente: se integra, no se reescribe.

## 3. Arquitectura propuesta

```
┌──────────────────────────┐         ┌───────────────────────────────┐
│ Molde Studio (PC/Next)   │         │ Tamiz (PWA, celular)          │
│                          │         │                               │
│ LayoutAssistant          │  molde  │ Captura/archivo → quad        │
│  ├─ detectar (S / plusL) │  .json  │   → calidad                   │
│  ├─ overlay de bloques   │ ──────▶ │   → LAYOUT (S; plusL opc.)    │
│  ├─ marcar obligatorios  │ archivo │   → estructura (reglas molde) │
│  ├─ partir/fusionar      │  o QR   │   → OCR campos (motor actual) │
│  └─ probar y exportar    │         │   → gate y revisión           │
└──────────────────────────┘         └───────────────────────────────┘
             │                                      │
             └───────── packages/molde-contract ────┘
                       packages/layout-core
```

### Paquetes nuevos

1. **`packages/molde-contract`** — tipos y validadores compartidos:
   `MoldeUniversal`, `CampoUniversal` y la extensión `layout`.
   Studio reexporta desde su ruta actual para no romper imports; Tamiz lo
   consume para importar/validar moldes.
2. **`packages/layout-core`** — motor de detección agnóstico de UI:
   - Registro de modelos S/plus-L (URL, tamaño, contrato de preproceso).
   - Sesión ORT Web (WASM, hilos, `wasmPaths` configurables).
   - Preproceso, decodificación, NMS clase-agnóstico y post-proceso.
   - Evaluador de reglas estructurales (`evaluarEstructura`).
   - Caché de modelos (Cache API/IndexedDB) y perfiles por dispositivo.
   - Sin React, sin Next.

## 4. Contratos de datos

### 4.1 Extensión del molde (retrocompatible)

En `packages/molde-contract` (y reexportado por Studio):

```ts
export type ClaseLayout =
  | 'text' | 'image' | 'table' | 'doc_title' | 'paragraph_title'
  | 'figure_title' | 'number' | 'header' | 'footer' | 'seal' | 'formula';

export interface ReglaLayout {
  id: string;
  etiqueta: string;
  zona: RectNorm;                 // 0..1 sobre la página
  tolerancia?: number;            // margen de pertenencia; default 0.02
  clases: ClaseLayout[];          // clases aceptadas (alias normalizados)
  minScore?: number;              // default 0.2
  minimo?: number;                // default 1
  maximo?: number;                // default 1
  obligatorio: boolean;
  campoId?: string;               // enlaza con CampoUniversal para OCR
  dividir?: {                     // parte un contenedor fusionado
    eje: 'y';
    cortes: number[];             // fracciones 0..1 dentro de la zona/contenedor
    etiquetas?: string[];         // una por parte (opcional)
    campoIds?: string[];          // una por parte (opcional)
  };
  nota?: string;
}

export interface LayoutMolde {
  version: 1;
  modeloPreferido: 's' | 'plusL';
  reglas: ReglaLayout[];
  // Opcional: huellas para identificación rápida (Fase 6 del plan viejo)
  firma?: { clases: ClaseLayout[]; minCoincidencias: number };
}

export interface MoldeUniversal {
  tipo: 'universal';
  version: string;                // subir a 3.1.0; layout es opcional
  // ...
  layout?: LayoutMolde;
}
```

Reglas de compatibilidad:

- Moldes sin `layout` se comportan como hoy (Tamiz salta la etapa).
- `esMoldeUniversal` valida también `layout` si existe (zonas finitas,
  cortes crecientes en (0,1), `minimo <= maximo`, `campoId` existente).
- No meter imágenes de referencia dentro del `.json` exportado (peso).

### 4.2 Motor de layout

```ts
export interface CajaLayout {
  clase: ClaseLayout | string;
  score: number;
  x1: number; y1: number; x2: number; y2: number; // px de la página
}

export interface DeteccionLayout {
  modelo: 's' | 'plusL';
  ms: number;
  boxes: CajaLayout[];
  debug?: { raw: number; maxScore: number; byClass: Record<string, number> };
}

export interface LayoutEngine {
  detect(canvas: HTMLCanvasElement, opts?: { poolMinScore?: number }): Promise<DeteccionLayout>;
  dispose(): Promise<void>;
}
```

### 4.3 Resultado estructural

```ts
export interface ResultadoReglaLayout {
  reglaId: string;
  etiqueta: string;
  estado: 'ok' | 'faltante' | 'sobrante' | 'baja_confianza';
  cajas: CajaLayout[];
  score: number | null;
  motivo?: string;
}

export interface ResultadoEstructura {
  modelo: 's' | 'plusL';
  ms: number;
  reglas: ResultadoReglaLayout[];
  obligatorias_faltantes: string[];
  ok: boolean;
  requiere_revision: boolean;
}
```

### 4.4 Gate (mapeo a estados existentes de Tamiz)

| Condición | Estado |
|---|---|
| Todas las reglas obligatorias `ok` + campos OCR obligatorios `ok` | `OPTIMA` |
| Regla obligatoria `faltante` / `baja_confianza` | `RECHAZADA` (`INCOMPLETA`) |
| OCR obligatorio dudoso, HTR o validación aritmética no evaluable | `EN_REVISION_HUMANA` |
| Solo reglas/campos opcionales con problemas o score bajo | `ADVERTENCIA` |
| Cuadro no detectado / ilegible / timeout | `RECHAZADA` (`ILEGIBLE`/`TIMEOUT`) |

> Esta tabla es la propuesta por defecto. El dueño puede cambiarla; dejar el
> mapeo en un solo módulo (`politica/umbrales` o equivalente) para ajustarlo.

## 5. Fases de ejecución

> Estimaciones en días de ingeniería, no calendario. Cada fase termina con
> `typecheck`, `lint`, build y una nota en `docs/` o `lessons/` si hubo
> prueba real.

### Fase 0 — Spike S vs plus-L con estructura (1–2 días)

Objetivo: responder con datos si S puede ser el modelo por defecto.

Tareas:

1. Partir el bloque de títulos fusionado de S en 3 líneas usando cortes
   relativos dentro del contenedor (referencia: contenedor y 119–273,
   cortes ≈ `[0.37, 0.62]`).
2. Aceptar `text` como tabla en las zonas de nivelación/votos con
   restricciones de ancho (≥ 0.5 W) y alto.
3. Partir el bloque `image` fusionado de E-14/logo/Registraduría con cortes
   de plantilla (y/o recortes por zona ya definidos).
4. Medir contra `e14-p1-chandra-gt.json` con el mismo matcher (IoU ≥ 0.5 o
   contención ≥ 0.8) y cronometrar en el celular.

Criterio de decisión:

- Si S alcanza **≥ 16/19 con ≤ 1 falso positivo** en E-14 p1 → S es default
  para el gate estructural.
- Si no → S queda para pre-gate/autoría gruesa; plus-L es obligatorio para
  validación fina (descarga opcional).

Entregable: `docs/investigacion/2026-11-2x-spike-s-estructura.md` con tabla
S/plus-L, tiempos y decisión.

### Fase 1 — Paquete de contrato (3–4 días)

1. Crear `packages/molde-contract` con los tipos actuales de
   `universal-types.ts` y los validadores (`esMoldeUniversal`,
   `erroresMolde`, `nuevoIdCampo`, `UMBRAL_APROBADO`).
2. Agregar `layout` y sus validaciones.
3. Hacer que
   `apps/molde-studio/src/lib/molde/universal-types.ts` reexporte el paquete
   (sin cambiar imports internos).
4. Consumir el paquete en Tamiz para importar/validar moldes.
5. Tests de validación: moldes válidos, layout inválido, cortes fuera de
   rango, `campoId` inexistente.

Aceptación: build de ambos apps en verde; moldes existentes cargan sin
cambios.

### Fase 2 — `packages/layout-core` (4–5 días)

Extraer del banco de pruebas:

- Registro de modelos (`s`, `plusL`) con URL, tamaño, input y contrato.
- Preproceso:
  - S: RGB, ImageNet mean/std, `scale_factor=[480/h,480/w]`.
  - plus-L: RGB 0..1, `im_shape=[800,800]`, `scale_factor=[800/h,800/w]`.
- Decodificación de `[N,6]` y NMS clase-agnóstico (plus-L no trae NMS).
- Escalado a la página y clamp a bordes.
- `evaluarEstructura(detecciones, reglas, W, H)` con:
  - margen por regla (default 0.02),
  - NMS interno en grupos (títulos/footers),
  - división por cortes,
  - conteos mínimo/máximo,
  - resultado por regla.
- Perfil de dispositivo (hilos, timeout) y liberación de sesión.

Pruebas:

- Unitarias sin modelo: fixtures de cajas grabadas de E-14 (S y plus-L) +
  GT. Debe reproducir F1 = 1.0 con plus-L y el resultado del spike con S.
- Integración con modelos descargados: tiempos y cajas estables.

Aceptación: el paquete reproduce el 19/19 de plus-L y no requiere DOM para
el evaluador.

### Fase 3 — Asistente de layout en Studio (7–10 días)

UI (nuevo `apps/molde-studio/src/components/studio/LayoutAssistant.tsx`,
integrado desde `EditorTab.tsx`):

1. Botón **Detectar estructura** sobre la página de referencia.
2. Overlay de bloques con clase y score; colores por tipo.
3. Acciones por bloque:
   - marcar como **obligatorio/opcional**,
   - asignar **etiqueta** y **campo** (existente o nuevo),
   - **partir** (guías de corte) y **fusionar**,
   - descartar.
4. Selector de modelo (`S` rápido / `plusL` preciso) con advertencia de peso.
5. Botón **Probar molde** que ejecuta estructura + OCR con el motor actual y
   muestra una tabla regla → estado → caja.
6. Guardar `layout` en el molde y en la exportación.

Reglas de UX:

- La detección es una **propuesta**; nada se guarda sin confirmación.
- Mostrar siempre la caja y el score; advertir bloques fusionados.
- No bloquear el editor si el modelo no carga (fallback manual).

Aceptación: crear un molde E-14 completo sin editar JSON; exportarlo y
validarlo con el evaluador y con Tamiz.

### Fase 4 — Runtime de Tamiz (7–10 días)

1. Nueva etapa `LAYOUT` en `EtapaAnalisis` y en el pipeline
   (`pipeline.ts`, `real-core-bridge.ts`), entre `CALIDAD` y `OCR`.
2. Cargar el molde activo (ver Fase 6) y ejecutar `evaluarEstructura` antes
   del OCR:
   - Si falla una regla obligatoria → cortar temprano y devolver
     `RECHAZADA` con motivo y regla.
   - Si solo hay opcionales/confianza baja → continuar a OCR.
3. Overlay de reglas y campos en `ReviewView` y `AnalyzingView` (estados
   por regla, caja resaltada, motivo).
4. Diagnóstico: modelo, ms, reglas ok/faltantes, score.
5. Copy canónico: reutilizar `protocolo.ts` (`INCOMPLETA`, `ILEGIBLE`, etc.)
   y agregar motivos de layout sin romper los existentes.
6. Compatibilidad: moldes sin `layout` no ejecutan la etapa.

Aceptación:

- E-14 correcto → `OPTIMA` con 19/19 y OCR actual.
- Documento equivocado → `RECHAZADA` con motivo de estructura, sin OCR
  completo.
- Tiempo de la etapa ≤ 20 ms (post) + inferencia del modelo elegido.

### Fase 5 — PWA offline-first (4–5 días)

1. `manifest.webmanifest` + iconos + `display: standalone`; enlazar desde
   `layout.tsx`.
2. Service worker propio (o Workbox) con:
   - precache del app shell y de S + `ort-wasm` + core/`spa` de Tesseract,
   - estrategia cache-first para modelos versionados por hash,
   - **no** cachear fotos de documentos (privacidad).
3. Descarga opcional de plus-L:
   - botón explícito, tamaño visible, progreso, checksum,
   - almacenar en Cache API; permitir borrar.
4. Cuota/almacenamiento: `navigator.storage.estimate()` y aviso si no cabe.
5. Cabeceras COOP/COEP correctas en estático (`public/_headers`) y fallback a
   1 hilo si no hay aislamiento (SharedArrayBuffer).
6. Prueba real: primera carga con red → modo avión → escanear y validar.

Aceptación: flujo completo sin red tras la primera carga; actualización de
modelo invalidando caché por hash.

### Fase 6 — Moldes por archivo/QR (2–3 días)

1. Exportar `.molde.json` desde Studio con checksum y `schemaVersion`.
2. Importar en Tamiz desde archivo (input file + validación + vista previa).
3. QR:
   - si el JSON comprimido cabe (~2–3 KB), QR con payload;
   - si no, QR con URL de descarga en LAN servida por Studio;
   - documentar el límite y validar tamaño antes de generar.
4. Guardar moldes en IndexedDB con versión y fecha; permitir activar uno.
5. Seguridad: cap de tamaño (p. ej. 2 MB), rechazo de JSON inválido, sin
   `eval`, sin URLs remotas arbitrarias en el molde.

Aceptación: exportar en Studio → importar en el cel → validar el mismo
documento con el mismo resultado.

### Fase 7 — Corpus y validación (5 días)

1. Corpus por tipo: 3–5 ejemplos, al menos 1 difícil (foto torcida, flash).
2. Fixtures de GT por página (bloques esperados) en
   `docs/investigacion/pp-doclayout/fixtures/` o similar.
3. Métricas automáticas: P/R/F1 por bloque, tasa de veredicto correcto.
4. Pruebas E2E (Playwright o script manual reproducible) en desktop y un
   celular real; registrar dispositivo y versión de Chrome.
5. Registrar lecciones siguiendo `lessons/TEMPLATE.md` después de cada
   prueba real; actualizar `lessons/INDEX.md` si aparece un patrón.

Aceptación: matriz de resultados por documento/modelo/dispositivo publicada
en `docs/`.

### Fase 8 — Endurecimiento (continuo)

- Perfiles por dispositivo (S en gama baja; plus-L en gama alta/opcional).
- Presupuesto de memoria y liberación de sesiones ORT.
- Reintentos y mensajes de captura (p. ej. "acerca el documento", "no se
  detectó el QR").
- Telemetría **local** (tiempos, modelo, resultado) sin datos personales.
- Documentar límites: perspectiva, iOS/Safari, licencia de modelos.

## 6. Plan de pruebas mínimo

| Nivel | Qué | Cómo |
|---|---|---|
| Unitario | preproceso, decodificación, NMS, validador de molde, evaluador | `bun test`/runner del repo, sin red |
| Golden | E-14 p1 con cajas grabadas (S y plus-L) | Fixtures + GT Chandra; F1 esperado |
| Integración | modelo real en navegador | Banco de pruebas o Playwright |
| E2E móvil | captura → layout → OCR → gate | Celular real + `adb` |
| Rendimiento | ms por etapa y memoria | Medición en dispositivo; tabla por tier |

Umbrales de aceptación iniciales:

- plus-L estructura E-14 p1: **F1 ≥ 0.95** (hoy 1.0).
- S estructura (si se adopta): **F1 ≥ 0.84** o decisión documentada.
- Post-proceso estructural: **≤ 20 ms/página** en celular.
- Gate: 0 falsos positivos en campos críticos del corpus.

## 7. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| S fusiona títulos/tablas | Partir por plantilla en F0; si no alcanza, S solo pre-gate |
| plus-L 130 MB | Descarga opcional explícita, checksum, borrar caché |
| Memoria en gama baja | S por defecto; liberar sesión; límite de resolución |
| Reglas sobreajustadas al E-14 | Molde declara reglas; prohibido hardcodear E-14 en el motor |
| Duplicación Studio/Tamiz | `molde-contract` + `layout-core` como única fuente |
| COOP/COEP en hosting estático | `_headers` + fallback 1 hilo; probar Cloudflare Pages |
| Licencia de modelos | Verificar Apache-2.0 de PP-DocLayout y conservar avisos |
| Fotos con perspectiva | Layout corre sobre la página rectificada por el quad de Tamiz |
| Importar molde malicioso | Validación estricta, tamaño máximo, sin ejecución de código |

## 8. Reglas para el agente

1. Leer `AGENTS.md` y `MOLDE-SPEC.md` antes de empezar.
2. Rama de trabajo `feat/layout-gate`; **no hacer push ni PR sin
   autorización del dueño**.
3. No modificar ni reexportar los ONNX; no agregar cuantización.
4. No introducir backend, login ni subida de documentos.
5. TypeScript estricto; reutilizar componentes shadcn/UI y estilos
   existentes. UI en español.
6. Mantener retrocompatibilidad de moldes (`layout` opcional) y del contrato
   `MoldeUniversal`.
7. Cada fase termina con `typecheck`, `lint`, build y documentación.
8. Cada prueba real con documentos termina en una lección reproducible.
9. Los fixtures y GT viven en el repo; los modelos no (por tamaño).
10. Si una decisión cambia el contrato del molde, escribir un ADR corto en
    `docs/` y pedir revisión antes de implementarlo.

## 9. Preguntas abiertas (no bloquean la Fase 0)

1. **Modelo final:** depende del spike S.
2. **QR:** ¿payload comprimido o URL de Studio en LAN? Depende del tamaño
   real de los moldes y del hosting de Studio.
3. **Política de estados:** ¿un campo OCR obligatorio dudoso va a
   `EN_REVISION_HUMANA` o directo a `RECHAZADA`?
4. **Alcance documental:** ¿solo E-14 o se prioriza un segundo tipo
   (factura, certificado) para evitar sobreajuste?
5. **Dispositivo mínimo:** ¿qué gama debe garantizar el flujo (RAM/CPU)?
6. **Hosting de Tamiz:** Cloudflare Pages u otro; afecta cabeceras, SW y
   actualizaciones.

## 10. Definición de terminado (MVP)

- [ ] Un usuario crea un molde E-14 visualmente en Studio, sin editar JSON.
- [ ] El molde exportado incluye reglas estructurales y campos OCR.
- [ ] Tamiz importa el molde por archivo o QR.
- [ ] Tamiz valida offline en el celular: layout → estructura → OCR → gate.
- [ ] Un E-14 correcto da `OPTIMA`; uno incompleto da `RECHAZADA` con el
      motivo y la regla exacta; un caso dudoso va a revisión humana.
- [ ] S y plus-L conviven según la decisión de F0; plus-L es opcional.
- [ ] Tests unitarios/golden verdes; E2E móvil documentado.
- [ ] Documentación de uso, límites y lecciones actualizada.
