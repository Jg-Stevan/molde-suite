# Tamiz — el digitalizador automático

**Tamiz** («el cedazo») es el digitalizador documental de la suite: captura documentos con cámara (o los importa como archivo), los analiza con un pipeline real de visión+OCR y decide, según el molde/plantilla, si el documento **pasa** (ÓPTIMA), **pasa con observaciones** (ADVERTENCIA) o **no pasa** (RECHAZADA). El nombre resume su función: solo los documentos que encajan con el molde atraviesan el tamiz.

> Nombre original del app en el monorepo privado: `digielect14`. Aquí se publica con su nombre público; los identificadores internos (`e14`) se conservan tal cual para no romper trazabilidad con la entrega original.

## Qué incluye esta capa

- **Shell responsivo** (`src/app/page.tsx`): vistas ESCANEAR / REVISIÓN / HISTORIAL / PLANTILLAS con store Zustand; nav inferior móvil (historial · obturador · plantillas) y SideNav en desktop (≥1024px); atajos de teclado 1/2/3 y «?»; code-splitting de las vistas pesadas con `next/dynamic`.
- **Visor de escaneo inmersivo** (`screens/ScanView.tsx`): pantalla limpia en modo cámara, botón VOLVER, píldora IA `[IA|cuadrícula|AUTO|?]`, selector `[CÁMARA|SIMULACIÓN|ARCHIVO]`, píldora de detección (rojo *NO DETECTADO* / verde *DOCUMENTO DETECTADO*), dock Importar/obturador/Flash.
- **Pipeline de análisis real** (`lib/e14/bridge/real-core-bridge.ts`): detección de bordes del documento (quad), procesado de imagen, evaluación de calidad (nitidez/brillo/contraste), OCR escalonado/cascada, clasificación de cabecera y **gate** que combina score + OCR para producir el estado del documento. Timeout global que resuelve un rechazo controlado (nunca congela la UI) y rescate tardío si el pipeline termina después del vencimiento.
- **Contratos del bridge** (`lib/e14/bridge/protocolo.ts`): tipos y copy canónico de rechazos (`ILEGIBLE`, `INCOMPLETA`, `SIN DATOS VISIBLES`, `TIMEOUT`…).
- **Verificación documental** (`screens/ReviewView.tsx`): campos obligatorios/opcionales, clasificación AUTO/SUGERIDA/MANUAL con panel de corrección, contingencia al agotar intentos.
- **Historial de escaneos** (`screens/ActasView.tsx`): filtros TODOS / ÓPTIMAS / ADVERTENCIA / RECHAZADAS.
- **Plantillas** (molde `.json` con plantilla base integrada): el punto donde el molde creado en **Molde Studio** gobierna la identificación y aceptación de documentos.
- **Cabecera `proxy.ts`**: COOP/COEP condicionales (convención `proxy` de Next.js 16) para permitir iframes de preview sin perder el OCR multihilo en navegación top-level.

## Estado de la entrega (importante)

Esta entrega es la **capa UI/puente** del digitalizador. Para compilar en solitario faltarían piezas del monorepo privado original, que **no se incluyen y no se han inventado**:

- El paquete de motor `@jg-stevan/scanner-core` (procesador de imágenes, tipos de dominio, clasificador, bridge).
- Módulos hermanos referenciados por los archivos incluidos: `pipeline`, `pipeline-recorte`, `captura`, `calidad`, `ocr`, `progreso`, `politica/umbrales`, `obs/captura`, `obs/dispositivo`, `adaptacion/plan`, `simulacion-imagenes`, `errores`, `get-bridge`, `hash`, `guion`, `completitud` (referenciado en comentarios), `primitives`, `dev/*`, `hooks/*` (cámara, anillo best-shot, destello, linterna…), `logger`, `store` (barrel), `GaleriaSimulacion`, `QuadEditor`, `PanelDev`, `TuercaResumen`.
- Los manifiestos del app (`package.json`, `tsconfig.json` con el alias `@/`).

Por eso este paquete **no es ejecutable por sí solo**: es la capa de interfaz y contratos del digitalizador, publicada para revisión/integración. El archivo [`CAMBIOS.txt`](CAMBIOS.txt) documenta la entrega acumulada original (nav según mock, universalización acta→documento, verificación documental, escaneo libre y limpio) con los commits de referencia.

## Stack

Next.js (App Router, convención `proxy`) · React · Zustand · TypeScript. OCR y visión viven en el paquete de motor privado (`@jg-stevan/scanner-core`, no incluido).
