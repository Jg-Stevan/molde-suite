# lessons/recibo_pago/2026-11-25-overlay-campos-escritorio.md — ficha de lección

---
id: "recibo_pago-escritorio-2026-11-25-overlay-campos"
plantilla: "recibo_pago v1.3.3 (localStorage de Tamiz escritorio); motor feat/arnes-geometrico"
tipo_documento: "recibo_pago"
condicion: "verificación de UI en Chrome escritorio (Tamiz :3100) con fixtures REALES importados uno a uno: recibo-tachado.png, recibo-sin-firmas.png, rotada-12.png, recorte-60pct-usuario.png, recibo-en-mesa.png, recorte-66pct-sin-firma.png"
herramientas_usadas: ["overlay_ancla_rect", "overlay_palabras", "zoomable_visor_overlay", "vista_procesada_en_rechazo"]
version_motor: "scanner-core ancla_rect (aditivo) + Tamiz ReviewView/ZoomableVisor"
resultado: "exitoso"
campos_fallidos: []
metrica: { veredictos_ok: "n/a (verificación de overlay, no de precisión)", zonas_correctas: "tachado 22 palabras (11 valores + 11 anclas), sin-firmas 24 (firmas en rojo), rotada 24, recorte-60 24, en-mesa 24, recorte-66 22 — todas alineadas sobre la foto PROCESADA e idénticas en el visor a 159-167%" }
---

## Problema observado
El overlay pedido por el mantenedor (azul = ancla, verde = `ok`, ámbar =
`requiere_revision`, rojo = faltante) no aparecía en el escritorio: con el
acta RECHAZADA el visor muestra la foto CRUDA (regla 2026-11-25: rechazo →
original sin recortar) y el overlay se desactiva porque sus rects están
normalizados sobre la foto PROCESADA. Además, el visor a pantalla completa no
aceptaba capa del consumidor: al ampliar, las cajas desaparecían.

## Causa raíz
Dos geometrías distintas convivían: `evaluarMoldeEnActa` mide sobre
`fotoProcesada` (warp + filtro), pero `mostrarCruda` prioriza `fotoOriginal`
en RECHAZADA. Los rects del molde sobre la original verificarían una posición
FALSA (la cruda no tiene el recorte/enderezado). Correcto: si hay rects que
pintar, la foto que se muestra debe ser la procesada (la que se evaluó).

## Qué funcionó / qué no
- ✅ `hayCamposOverlay = cajasCampos.length > 0 && !fotoSinTinta` fuerza la
  foto PROCESADA también en RECHAZADA — las palabras quedan sobre la misma
  geometría que el motor midió (captura desk-overlay-v3: 22 cajas sobre la
  binarizada de recibo-tachado).
- ✅ Cambio a PALABRAS (pedido del mantenedor): etiqueta del ancla en azul
  («Fecha») elevada `translateY(-100%)` sobre su línea + valor reconocido en
  verde/ámbar/rojo en el rect del valor; sin rectángulos. Legible sobre papel
  blanco y sobre la binarizada (fondo `rgba(2,6,12,0.78)`).
- ✅ `ZoomableVisor` gana prop aditiva `overlay` (ReactNode) + caja del `<img>`
  medida con `ResizeObserver`: la capa vive DENTRO del wrapper escalado, así
  que escala y panea con la foto (verificado a 159 % y 167 %) y se oculta
  sola al comparar el original (las coordenadas son de la procesada).
- ❌ Lección UX colateral: en RECHAZADA el panel VERIFICACIÓN DOCUMENTAL se
  despliega por diseño (2026-11-16) y cubre la foto — el overlay queda
  debajo hasta que el operador lo colapsa. El visor ampliado es la vista sin
  obstáculo; no se tocó el auto-despliegue del mantenedor.

## Recomendación para próximas plantillas
- Cualquier overlay con rects normalizados debe declarar SOBRE QUÉ foto se
  midieron y forzar esa foto en pantalla; jamás pintar coordenadas de la
  procesada sobre la cruda (ni al revés).
- Un overlay en visor con zoom debe montarse DENTRO del wrapper transformado,
  con la caja del `<img>` medida en layout (clientWidth/Height), no en
  porcentajes del contenedor (letterboxing de `object-contain`).
- Verificación rápida de contrato: contar `[data-testid="campo-palabra"]`
  por color (verde/ámbar/rojo/azul) y comparar card vs visor — deben ser el
  mismo conjunto.
