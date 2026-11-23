# PLAN — AJUSTES VISUALES v2 · ADAPTACIÓN E-14

**Fecha:** sesión actual · **Rev:** v2-adaptada-E14 — port del parche `cambios-revisor-main.zip` (escrito para el TAMIZ táctico `src/components/tactico/`) a la arquitectura real de destino **`molde-suite/apps/tamiz` (TAMIZ E-14)**.

**Regla que manda (intacta del plan original):** lo visual decide. Cámara y footer quedan EXACTOS como están en el código actual.

---

## 0. MAPA DE EQUIVALENCIA TÁCTICO → E-14

| Archivo del zip (táctico) | Equivalente E-14 (aplicado aquí) | Acción |
|---|---|---|
| `resultado-view.tsx` (P4+P5) | `src/components/e14/VerificacionDocumental.tsx` + `src/components/e14/screens/ReviewView.tsx` | **P4 + P5 adaptados** |
| `fit-scale.tsx` (nuevo) | `src/components/e14/fit-scale.tsx` (nuevo) | **Portado** |
| `page.tsx` (raíz `h-dvh` + `overflow-hidden`) | `src/app/page.tsx` — el shell E-14 YA lo tiene (D38: `h-dvh ... overflow-hidden`) | **Ya existía — sin cambio** |
| `demo-data.ts` (5.º demo «NO IDENTIFICADO») | `src/lib/e14/simulacion-imagenes.ts` — caso `no-identificado` en el ciclo SIM | **Adaptado (pipeline real)** |
| `historial-view.tsx` | `screens/ActasView.tsx` — el historial E-14 ya registra cada acta con contadores | **Sin cambio (ya cumplía)** |
| `plantillas-view.tsx` (fix bug de sintaxis) | `PanelMoldes.tsx` — **el bug (`ICONO_TIPO.tipo]`) no existe en E-14** | **Nada que corregir** |
| `escaneo-view.tsx` / `procesando-view.tsx` / `bottom-nav.tsx` (NO TOCAR) | `ScanView.tsx` / `AnalyzingView.tsx` / `BottomNav.tsx` + `SideNav` | **Sin cambios (mandato respetado)** |

**Puerto de la app completa:** el sandbox recibe el TAMIZ E-14 standalone (ruta `/`): `src/components/e14/**`, `src/lib/e14/**`, paquetes locales `packages/scanner-core`, `packages/layout-core`, `packages/dla-onnx` (señales OFF sin modelos, como en producción sin URLs), OCR tesseract.js vía CDN, `proxy.ts` con COOP/COEP condicionales. Único ajuste de sandbox: `PwaRegister` no registra SW (no se despliega `sw.js` — guard con HEAD para evitar 404 en consola).

---

## 1. P4 — COMPORTAMIENTO DE LA «VERIFICACIÓN DOCUMENTAL» (E-14)

**Archivos:** `VerificacionDocumental.tsx` (overlay) + `ReviewView.tsx` (posicionamiento).

| Estado del gate | Apertura por defecto | Contenido del panel desplegado |
|---|---|---|
| **OK / ENVIADA** (todo pasa) | **COLAPSADA** | Si se abre manualmente: detalle completo (todos los items) |
| **ADVERTENCIA** | Desplegada | **Solo los campos con problema** (los OK no se listan); badge conserva conteo completo `[pasados/total]` |
| **RECHAZADA con OCR válido** (GENERICO — E-14 de mala calidad) | Desplegada | **Solo los campos con problema** (mismo camino que advertencia) |
| **RECHAZADA sin clasificación legible** (ILEGIBLE / sin plantilla conocida) | Desplegada | Mensaje **«DOCUMENTO NO IDENTIFICADO — SIN PLANTILLA CONOCIDA — NO VERIFICADO»** + chip «SIN PLANTILLA» |

- La fila-resumen (icono del gate + «VERIFICACIÓN DOCUMENTAL» + badge % + chevron) siempre visible y clicable.
- EN_REVISION_HUMANA conserva su doctrina (banner «CLASIFICACIÓN PENDIENTE» + panel al agotar intentos) — no se confunde con el no identificado.
- **Mapa de fixtures SIM del ciclo** (verificado end-to-end en el sandbox; el veredicto SIEMPRE sale del pipeline real — detección + OCR + gate, sin scores fijos):

  | Fixture | Veredicto medido | Vista en REVISIÓN |
  |---|---|---|
  | Óptima (E-14 nítida) | 8.9/10 ÓPTIMA | Acordeón **COLAPSADO** + detalle completo al abrir (P4) |
  | Sombras / Completa | 8.6 ÓPTIMA / 7.6 ADVERTENCIA | Colapsado / desplegado solo faltantes |
  | Color / Recortada | 7.8 / 7.5 ADVERTENCIA | Desplegado **solo faltantes** + badge completo |
  | Rechazada (E-14 borrosa) | 5.9/10 RECHAZADA | Zona fija de rechazo (pill + herramientas + «OBLIGATORIO REPETIR FOTO») + panel por doctrina del gate |
  | No identificado (recibo ilegible) | 5.9/10 RECHAZADA ILEGIBLE | **«DOCUMENTO NO IDENTIFICADO — SIN PLANTILLA CONOCIDA»** (P4) |

  Nota honesta: el combo «RECHAZADA + OCR válido + checklist solo faltantes» (banda estrecha GENERICO entre 6.5 y el corte de legibilidad del OCR) es dificil de calibrar con fixtures sintéticas de canvas; el camino está verificado en código (idéntico al de ADVERTENCIA) y con fotos reales del motor produce el checklist esperado.

---

## 2. P5 — REVISIÓN SIN SCROLL, TODO CABE EN PANTALLA (E-14)

```
┌──────────────────────────────────┐
│ TopBar (score pill)        fijo  │
│ Banner de ubicación        fijo  │
│ ┌──────────────────────────────┐ │
│ │  FOTO DEL DOCUMENTO          │ │ ← ÚNICO elemento flexible:
│ │  (FitScale: escala completa, │ │    ocupa el espacio restante
│ │   sin recortes ni scroll)    │ │    y se ESCALA para caber
│ │  [overlay VERIFICACIÓN]      │ │ ← al desplegarse queda SOBRE
│ │  [píldora del motivo]        │ │    la imagen, sin empujar nada
│ └──────────────────────────────┘ │
│ Zona fija (motivo + acciones)    │
│ CTAs (ReviewCtas / BottomNav)    │
└──────────────────────────────────┘
```

1. **Shell** (`page.tsx`): ya era `h-dvh` + `overflow-hidden` (D38) — la raíz no se toca.
2. **Foto del acta**: el visor pasa de `max-h-[46vh]` a **`FitScale` (ResizeObserver + transform:scale)** dentro de un contenedor `flex-1 min-h-0` — la imagen se escala con `k = min(ancho, alto disponibles, 1)`, sin recortes ni deformación.
3. **Verificación como overlay:** fila-resumen + panel absoluto (`absolute inset-0 z-20`) sobre el área de la foto; desplegada = panel con `bg-[#0d131a]/85 backdrop-blur-md` que llena el área y scrollea por dentro. Colapsada ocupa solo la barra y la foto queda tocable (visor fullscreen intacto).
4. **Zona fija inferior intacta:** píldora del motivo + Recortar/Rotar/Imagen + CTAs (ReviewCtas en desktop / BottomNav+CTAs en móvil).
5. El scroll de la columna queda SOLO como válvula de seguridad (panel de clasificación RH, pantallas muy bajas); el contenido cabe por diseño.
6. El ojo «Zonas» (cajas del gate estructural) sigue alineado: las cajas viajan dentro del mismo contenedor escalado por FitScale.

---

## 3. FIX BUG PLANTILLAS

El bug del táctico (`const Icono = ICONO_TIPO.tipo] ?? FileText`) **no existe en la arquitectura E-14** (`PanelMoldes.tsx` no usa un mapa de iconos por tipo). Verificado en el código portado: sin acción.

---

## 4. ARCHIVOS DEL PORT (S sandbox)

| Archivo | Acción |
|---|---|
| `src/app/page.tsx` + `layout.tsx` + `globals.css` | Shell E-14 portado (sin cambios de piel) |
| `src/components/e14/**` | Portado íntegro |
| `src/lib/e14/**` + `logger.ts` + `rutas.ts` | Portado íntegro |
| `src/proxy.ts` | COOP/COEP condicionales (no rompe el iframe del preview) |
| `packages/scanner-core` / `layout-core` / `dla-onnx` | Paquetes del motor como módulos locales (tsconfig paths) |
| `src/components/e14/fit-scale.tsx` | **Nuevo** — helper de escala (P5) |
| `src/components/e14/VerificacionDocumental.tsx` | **P4 + overlay** |
| `src/components/e14/screens/ReviewView.tsx` | **P5 (visor flexible + overlay)** |
| `src/lib/e14/simulacion-imagenes.ts` | **3 casos SIM nuevos**: «Óptima» (nitidez alta → auto-envío), «Rechazada» (E-14 borrosa) y «No identificado» (P4) |
| `src/components/e14/PwaRegister.tsx` | Guard de sandbox (sin sw.js en el preview) |
| `public/manifest.webmanifest`, `icon-192/512.svg`, `offline.html` | Assets PWA portados (sin `sw.js`) |

**Fuera de alcance (mandato respetado):** ScanView (cámara), AnalyzingView (carga), BottomNav/SideNav/TopBar, motor, store, backend.
