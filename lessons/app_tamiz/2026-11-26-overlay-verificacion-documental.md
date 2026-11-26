---
id: "app_tamiz-overlay-verificacion-2026-11-26"
plantilla: "prueba_2paginas.molde.json + a56-01-recibo-tachado.png"
tipo_documento: "app_tamiz"
condicion: "REVISIÓN con acta RECHAZADA/ALERTA; panel cerrado→abierto medido en el MISMO viewport; Chrome aislado CDP :9224 (412 y 1440 px) y Samsung A56 real por depuración inalámbrica (CDP :9223 + adb reverse, viewport natural 491×946)"
herramientas_usadas: ["createPortal", "FitScale", "grid-rows-[0fr]→[1fr]", "data-purpose=visor-documento", "Runtime.evaluate + getBoundingClientRect"]
version_motor: "e4ef18b + cambio de UI sin commitear (FASE 4 plan rosy-meadow-swan)"
resultado: "exitoso"
campos_fallidos: []
metrica: { delta_imagen_px: "dH 0 · dW 0 · dY 0 (PC y A56)", franja_panel_cerrado_px: "12 → 0" }
---

## Problema observado

El dueño pidió que «VERIFICACIÓN DOCUMENTAL» dejara de **empujar** la foto. El
primer intento montó la tarjeta ENTERA como overlay absoluto dentro del visor:
la foto ya no cambiaba de tamaño, pero el panel abierto tapaba la imagen y la
barra flotaba sobre ella — el dueño lo rechazó («debe ir fuera de la imagen»).

Durante la verificación, el e2e reportaba `DELTA imagen {dH:29, dW:31, ok:false}`
aunque el overlay era absoluto: la medición parecía desmentir el cambio.

## Causa raíz

Dos cosas distintas:

1. **El e2e comparaba dos pantallas.** Las capturas llaman
   `Emulation.setDeviceMetricsOverride` (1440 → 412) y FitScale re-escala la
   foto contra su contenedor. Medir «cerrado» antes de un `shot()` y «abierto»
   después deja el delta contaminado por el viewport, no por el acordeón. La
   comparación válida fija las métricas ANTES de medir y mueve los `shot()` al
   final: con eso `img` resultó idéntica (306×287 en PC, 388×364 en el cel).
2. **El padding del wrapper del acordeón no colapsa.** Con
   `grid-rows-[0fr]` el item mide 0, pero un `p-1.5` en el
   `overflow-hidden` sumaba 12 px visibles: asomaba una franja del borde del
   panel sobre la foto con la tarjeta cerrada. El inset debe ir en el
   contenedor portalizado (`absolute inset-1.5`), no como padding interno.

## Solución adoptada

`modo='overlay'` se redefine: la **fila-resumen sigue en el flujo** (su propia
fila arriba de la tarjeta — «fuera de la imagen») y **solo el panel** se
portaliza al visor con `createPortal`, resuelto en un effect sobre
`[data-purpose="visor-documento"]` (el visor se renderiza después que la barra;
mientras el host es `null` el acordeón está en `0fr`, así que no hay salto).
El panel abierto ocupa el visor (`h-full`, fondo `/95` + blur) y scrollea por
dentro; el wrapper portalizado es `pointer-events-none` y solo el panel abierto
recupera `auto`, de modo que el tap sobre la foto sigue abriendo el visor a
pantalla completa.

## Verificación real

- PC 412 y 1440 + A56 (491×946 natural): `dH/dW/dY = 0` entre cerrado y abierto.
- Barra fuera del visor y arriba de la foto; panel dentro del visor; raíz en la
  columna; pantalla sin scroll (603/603 PC, 687/687 cel); `rows: 0px` cerrado.
- Auto-despliegue a ~1 s intacto; `role="dialog"` de pantalla completa sigue
  alcanzable con la barra cerrada.

## Patrón para no repetir el error

En pruebas de layout con re-escalado (FitScale/`transform: scale`), **ninguna
métrica de tamaño puede cruzar un cambio de viewport**: fija las métricas, mide
los dos estados, y solo entonces toma capturas. Y para acordeones `0fr→1fr`, el
inset visual va en el contenedor ABSOLUTO, nunca como padding del item que
colapsa.
