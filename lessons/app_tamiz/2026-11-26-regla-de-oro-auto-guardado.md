---
id: "app_tamiz-regla-de-oro-2026-11-26"
plantilla: "(política de guardado — no es un molde)"
tipo_documento: "app_tamiz"
condicion: "flujo REGLA DE ORO §4 + edición §5 sobre fixtures SIM sintéticos (óptima, rechazada, recibo con obligatorio faltante)"
herramientas_usadas: ["decidirAutoGuardado", "esLegible", "obligatorioValido", "reevaluarResumenConEdiciones", "historialFilaId", "flag autoGuardado"]
version_motor: "agent-b/mvp-captura-pwa (base main ccb85b1)"
resultado: "exitoso"
campos_fallidos: []
metrica: { veredictos_ok: "26/26 tests + 6/6 ítems §7 en navegador", zonas_correctas: "n/a" }
---

## Problema observado

Dos huecos del auto-guardado y una ausencia de edición:

1. **ADVERTENCIA legible de una página no se guardaba sola** (D20 la dejaba a
   decisión manual): un documento legible con TODOS los obligatorios podía
   quedar sin archivar — exactamente el hueco que la REGLA DE ORO §4 prohibe.
2. **EN_REVISION_HUMANA quedaba dentro del archivado automático de evidencia**
   (`archivarCaptura` la tocaba) — el plan exige «NO guarda solo».
3. **§5 no existía**: el operador no podía verificar ni corregir un valor
   capturado; una lectura errónea del OCR que pasaba el patrón era incurrible
   desde la UI.

## Causa raíz

- La decisión del auto-guardado vivía INLINE en `analisisCompletado`
  (`if (actaActual.status === 'OPTIMA')`) — sin función pura no había ni
  test ni un solo criterio de «legible».
- El resumen ADITIVO (gate E-14) comparte el campo `evaluacionMolde` con el
  ENRUTADO: usar sus `obligatoriosFaltantes` para decidir habría REGRESADO el
  auto-envío D4 del E-14 (sus obligatorios no son los del veredicto). La
  decisión debe mirar `enrutado === true` antes de exigir obligatorios.
- El motor universal lee la foto por OCR: la corrección §5 no puede «re-OCR»
  (produciría la misma lectura) — el override es POST-lectura con la MISMA
  semántica de agregación (score=ok/total, obligatorios por etiqueta,
  validaciones con `evaluarValidaciones` exportado).

## Qué funcionó / qué no

- ✅ Decisión PURA (`politica/auto-guardado.ts`): los 4 tests obligatorios del
  plan §4 corren en bun sin navegador y la MISMA función decide en captura,
  en lote multipágina y tras la edición (§5).
- ✅ Manuscrito con `tinta === true` (semáforo v1.5.1) como PRESENTE: una
  firma con trazo medido no bloquea el auto-guardado.
- ✅ `historialFilaId` estampado por `registrarEnvio`/`archivarCaptura`: la
  edición ACTUALIZA la fila (una sola, EDITADO) — verificado en navegador
  (RECHAZADAS 0 tras el auto-guardado post-edición).
- ✅ Re-evaluación con override: RECHAZADA 8.0 → editar «SALDO PENDIENTE
  8500» → OPTIMA 10.0 → auto-guardado inmediato (banner ENVIADA).
- ❌ Mutación de filas compartidas (detectada EN el desarrollo): el bucle de
  validaciones demovía filas NO editadas del resumen PREVIO por referencia —
  corregido copiando cada fila (`{...fila}`) antes del bucle.
- ❌ Fila duplicada tras el auto-guardado post-edición (la evidencia previa +
  el nuevo envío): corregido retirando la fila sustituida y su entrada del
  libro de PDF.

## Recomendación para próximas plantillas / fases

- Toda decisión de guardado pasa por `decidirAutoGuardado` — no volver a
  abrir `if (status === 'OPTIMA')` inline en el store.
- Si A56 trae el lote real de 2 páginas del E-14, re-verificar el ítem §7.6
  con fixtures que matcheen el molde de 2 páginas (en esta entrega el lote
  válido se demostró con «Prueba dos páginas» 2/2 → una fila).
- El kill-switch `{"autoGuardado": false}` devuelve el comportamiento
  histórico completo (documentado en el panel DEV si se expone al operador).

## Evidencia

- Tests: `apps/tamiz/tests/auto-guardado.test.ts` (15), `apps/tamiz/tests/edicion-campos.test.ts` (11).
- Navegador (§7): capturas 02-07, 11-13, 18 en
  `scripts/resultados/verificacion-agente-b/capturas/` (LOCAL, fixtures
  sintéticos — regla §3.3).
