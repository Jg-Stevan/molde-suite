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

## Estado de la entrega

**Ejecutable (decisión D8, opción B — ver `docs/auditoria/03-informe-final.md` en la raíz del monorepo).** El paquete de motor `@jg-stevan/scanner-core` ahora existe como paquete mínimo dentro del repo (`packages/scanner-core`) y los módulos que faltaban (pipeline, captura, calidad, ocr, política, obs, puente, hooks de cámara…) están implementados en `src/lib/e14/`. La app compila (`bun run typecheck`/`lint` en 0) y construye estática (`BUILD_STATIC=1 bun run build`).

Lo que el núcleo mínimo NO trae todavía (camino A, por partes): detección de bordes con perspectivas completas (hoy bounding-rect por gradientes), OCR de bandas calibrado con el corpus Nairobi/El Cairo de la auditoría, hub de envío real para el puente (hoy honesto: "sin hub configurado") y PWA con service worker propio. Divipol de demostración.

## Stack

Next.js (App Router, convención `proxy`) · React · Zustand · TypeScript. OCR y visión viven en el paquete de motor privado (`@jg-stevan/scanner-core`, no incluido).
