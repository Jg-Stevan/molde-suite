---
id: "recibo_pago-tamiz-2026-11-26"
plantilla: "recibo_real (A/B/C unificado)"
tipo_documento: "recibo_pago"
condicion: "foto celular de recibo impreso (firma pagador vacía) + variante C mixta, A56 y Chrome de escritorio"
herramientas_usadas: ["htr_conf_dictamen", "ancla_textual_fuzzy", "rescate_anti_tachon", "arnes_geometrico"]
version_motor: "feat-arnes-geometrico (2026-11-26)"
resultado: "exitoso"
campos_fallidos: ["fecha_pago", "concepto", "forma_pago", "firma_pagador"]
metrica: { veredictos_ok: "A: 8/12 ok · RECHAZADA con motivo; C: 4-5/12 · EN_REVISION_HUMANA", zonas_correctas: "10/12 (A), 7/12 (C)" }
---

## Problema observado

El molde unificado `recibo_real.molde.json` marca `htr: true` en los 10 campos de
datos y el motor trataba `htr && obligatorio` como `requiere_revision` SIEMPRE
(Fase 2.5 opción C). En el A56, el recibo impreso REC-2026-0157 leía fecha
(«02 de febrero de 2026»), número («REC-2026-0157»), emisor, pagador e importe
(«1.250,00») con conf 0.87–0.93, pero los 9 obligatorios quedaban a revisión por
ESTADO: score 25/100, 3/12 ok, sin enrutar → EN_REVISION_HUMANA. Un documento
completo y legible jamás llegaba a aceptarse, y el auto-envío (solo OPTIMA)
nunca se activaba.

## Causa raíz

Regla doctrinal de `evaluarCampo` (`packages/scanner-core/molde/universal-engine.ts`,
bloque final): `if (campo.htr && campo.obligatorio) { estado = 'requiere_revision' }`
sin mirar la confianza de la lectura ni si el valor ya cumple el patrón anclado
estricto del campo. El estado reflejaba la CONDICIÓN del campo (manuscrito), no la
CALIDAD de la lectura.

## Qué funcionó / qué no

- ✅ `dictaminarCampo` (función pura nueva) + opción `htrConfDictamen` (app:
  `flags.htrConfDictamen`, default **null** = kill-switch byte-idéntico).
  Con `0.8`, en el A56: `fecha_emision`, `numero_recibo`, `datos_emisor`,
  `datos_pagador` e `importe` pasan a `ok` con bandera `htr_conf_alta`
  (conservando `htr_manual` informativa). `relacion_ambigua` sigue forzando
  revisión aunque la conf sea alta (test cubierto).
  Resultado medido: la foto A sube de 3/12 a 8/12 ok y pasa de EN_REVISION_HUMANA
  a **RECHAZADA** con motivo explícito («CAMPOS OBLIGATORIOS FALTANTES: CONCEPTO,
  FORMA DE PAGO, FECHA DE PAGO, FIRMA PAGADOR») y captura archivada sola. Es la
  doctrina correcta: el documento no está completo (el pagador no firmó; la toma
  muestra la rúbrica del emisor y el recuadro del pagador vacío).
- ✅ `firma_emisor = ok` con `forma_sin_caja` NO es ok falso: la rúbrica existe en
  la imagen (la caja impresa queda tapada por el trazo; la bandera es informativa).
- ❌ Ninguna foto del banco da OPTIMA con `recibo_real`: la variante A no tiene la
  firma del pagador y su `fecha_pago` se lee sucia («_05/02/2026 A»); las tomas C
  (mixtas) dejan importe y fecha_pago en `ocr_vacio` (22–24s, 4-5/12). La demo de
  ENVIADA automática exige un recibo COMPLETO (ambas firmas) que hoy no está en fixtures.
- ❌ `pag-01.png` (el recibo «limpio» de bancos A13, 10/10 con `recibo_pago`) NO
  casa con `recibo_real`: no lee N.º RECIBO y baja a 6/12. Es otra estructura de papel.

## Recomendación para próximas plantillas

1. La puerta del dictamen es el BANCO, no el deseo: si aparece cualquier `ok` falso
   en variantes B/C, dejar `htrConfDictamen` en null (rollback total en 1 flag).
2. No bajar el umbral para «forzar» OPTIMA en documentos incompletos: la falta era
   contenido (firma pagador), no umbral. Un recibo con ambas firmas debe pasar el
   dictamen tal cual (conf medida 0.87–0.93 > 0.8).
3. Para demostrar aceptación automática, usar SIEMPRE un documento completo del
   mismo molde; los fixtures de otra plantilla enrutan, pero no puntúan.
