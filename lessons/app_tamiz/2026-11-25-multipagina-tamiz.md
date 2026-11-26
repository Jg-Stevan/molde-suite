---
id: "app_tamiz-multipagina-2026-11-25"
plantilla: "prueba_2paginas.molde.json (molde de prueba e2e)"
tipo_documento: "app_tamiz"
condicion: "fixture SIM a56-01 importado dos veces con molde de 2 páginas (Chrome aislado CDP :9224, dev :3100, 412 y 1440 px)"
herramientas_usadas: ["huella.paginas", "evaluarMoldeMultipagina", "veredictoDeResumen", "registrarEnvio"]
version_motor: "e4ef18b (Fase 3 plan rosy-meadow-swan)"
resultado: "exitoso"
campos_fallidos: []
metrica: { veredictos_ok: "2/2 páginas acumuladas → 10.0/10 ÓPTIMA batch", zonas_correctas: "n/a (molde de prueba: presencia de zona central por página)" }
---

## Problema observado

El store no tenía sesión multipágina: cada captura se evaluaba aislada. Al
activar un molde de 2 páginas, la evaluación POR PÁGINA del bridge corre el
molde COMPLETO sobre esa foto — la página 1 sola devuelve RECHAZADA tipo
MOLDE («faltan campos» de la página 2). Usar ese veredicto como criterio de
«página válida» hace el flujo INACUMULABLE: con a56-04 el documento no sumó
ninguna página (rechazo físico 0.0) y con a56-01 la sesión quedaba en 0/2.

## Causa raíz

Confundir VEREDICTO DEL DOCUMENTO con VALIDEZ FÍSICA DE LA PÁGINA. El
veredicto del molde pertenece al lote (`evaluarMoldeMultipagina` →
`veredictoDeResumen`); la decisión de acumular una captura solo puede mirar
lo físico: `fotoProcesada` presente, `!procesadaVacia` y ausencia de rechazo
INCOMPLETA/ILEGIBLE/SIN_VOTOS/BAJO/TIMEOUT. Un RECHAZADA tipo MOLDE (campos
de OTRAS páginas) NO descalifica la captura (store/index.ts, rama multipágina
de `analisisCompletado`).

## Qué funcionó / qué no

- ✅ Acumular por validez física y evaluar el lote al completar las
  `paginasEsperadas()` (huella.paginas o max campo.pagina). E2E: 1/2 con
  bloque ámbar PROGRESO + chips PÁG ✓ + CTA «ESCANEAR PÁGINA 2 (DE 2)»;
  al completar → 10.0/10 ÓPTIMA batch, sin bloque de progreso.
- ✅ UNA sola fila de historial por documento (registrarEnvio tras el set del
  acta final). Verificado con `data-testid="historial-fila"` en la MISMA
  sesión: numFilas = 1.
- ✅ Título del documento = `actaFinal.titulo || moldeNombre ||
  tituloPaginaActual`: el genérico «— · DOC — — DOC» no identifica nada.
- ❌ Veredicto por página como criterio de acumulación (ver causa raíz).
- ❌ Verificar el historial DESPUÉS de recargar/HMR: `historial` es memoria de
  sesión (igual que en Fase 2); la recarga de Turbopack por un edit vacía la
  lista. La comprobación tiene que hacerse en la misma corrida del e2e.

## Recomendación para próximas plantillas

Para documentos de N páginas: `paginasEsperadas()` del molde manda; acumular
solo páginas físicamente válidas; el veredicto se emite UNA vez sobre el lote
y el historial recibe UNA fila con el nombre del molde. En e2e, exponer
`data-testid` estables (progreso-documento, progreso-pagina-N,
btn-escanear-siguiente-pagina, historial-fila) y validar historial en sesión.
