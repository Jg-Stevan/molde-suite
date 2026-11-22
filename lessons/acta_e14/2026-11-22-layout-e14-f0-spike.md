---
id: "acta_e14-layout-e14-f0-spike-2026-11-22"
plantilla: "e14 (reglas estructurales E-14 p1)"
tipo_documento: "acta_e14"
condicion: "PDF escaneado limpio 2 págs — detecciones GRABADAS del banco (phone-mwrf3lq0 plus-L / phone-mwrgw19y S), sin modelo en el agente"
herramientas_usadas: ["layout_estructural", "reglas_declarativas", "dividir_cortes", "nms_clase_agnostico", "asignacion_codiciosa"]
version_motor: "feat/layout-gate 02a6737 (packages/layout-core)"
resultado: "exitoso"
campos_fallidos: []
metrica: { veredictos_ok: "19/19 plus-L · 16/19 S", zonas_correctas: "14/14 reglas plus-L · 12/14 S" }
---

## Problema observado

Al portar el prototipo `estructura-e14.js` a un evaluador genérico de reglas
declarativas (`evaluarEstructura`), el golden plus-L daba **18/19** en vez de
19/19: con el margen de pertenencia del 2% (clave en `Todas reales` según el
dossier), la caja del número del código de barras (text 0.31, y94-111) cae
dentro de la franja de títulos (zona y0.055 + margen 41 px) y roba el tercer
título (CÓNSUL/EMBAJADOR, doc_title 0.305) por **0.005 de score**. El
prototipo JS lo evitaba por pura suerte geométrica: su zona era estricta
(sin margen) y la caja del número termina en y=112.5, 0.1 px por encima del
corte y0.055·2048=112.6.

## Causa raíz

El margen de 2% del dossier y la selección top-N por score SIN coordinación
entre reglas permiten que UNA caja física satisfaga DOS reglas. Verificado:
con zonas estrictas el golden da 19/19; con margen 2% sin coordinación, 18/19
de forma determinista (`packages/layout-core/src/evaluar.ts`, primera versión).

## Qué funcionó / qué no

- ✅ **Asignación codiciosa entre reglas**: procesar las reglas en orden de
  declaración y consumir la caja aceptada + sus duplicados (IoU ≥ 0.5) del
  pool → 19/19 estable con margen 2%. Es la solución de fondo, no la suerte.
- ✅ **Cortes relativos de plantilla** (`dividir.cortes`): el bloque de títulos
  fusionado de S (text y119-273) partido en [0.384, 0.61] produce IoU 0.81 /
  0.9 / 0.96 contra los 3 GT → S sube de 8/19 a 16/19 con 0 FP.
- ✅ **text como tabla** con restricciones de tamaño: nivelación (text y439-729,
  IoU 0.79) y votos (text y1459-1723, IoU 0.98) recuperadas para S.
- ✅ **Orden de declaración como desempate**: con scores empatados (0.22/0.22
  entre la caja del rótulo E-14 y la de la versión), el orden e14→version
  asigna correctamente; con version→e14 se cruzan (métrica idéntica, pero el
  regla→GT queda intercambiado).
- ❌ **Contenedor de página como fuente de candidatos**: el contenedor
  image 0.51 y-5..1744 de S nunca cae COMPLETO dentro de la zona de candidatos
  (contrato de contención completa) y el truco de partirlo produce 2 FP.
  Rechazado; `candidatos` queda opcional para S.

## Recomendación para próximas plantillas

1. Declarar las reglas en orden de **consumo deseado** (las cajas tempranas y
   unívocas primero: barcode/barcode_text antes que title; registraduria_text
   antes que logo cuando hay fusión logo+texto).
2. Ante empates de score entre reglas vecinas, ajustar `minW/maxW/minH/maxH`
   para desambiguar por TAMAÑO (la versión mide 25 px de alto; el rótulo E-14,
   35 px) en vez de agrandar/mover zonas.
3. Los cortes de `dividir` se calibran contra el GT de UNA página y quedan
   como REGLA DEL MOLDE (portable, auditable), jamás en el motor.
4. Con el margen 2% activo, desconfiar de zonas adyacentes separadas por menos
   del margen: la asignación codiciosa lo cubre, pero el orden importa.
