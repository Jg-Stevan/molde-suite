---
id: "recibo_pago-a56-2026-11-26-archivado"
plantilla: "recibo_real"
tipo_documento: "recibo_pago (variante A — datos impresos, firma vacía)"
condicion: "foto celular real del recibo REC-2026-0157 (girada sobre mesa oscura), captura de UNA página en Galaxy A56 por CDP"
herramientas_usadas: ["registrarEnvio (G.1)", "archivarCaptura (nueva, 2026-11-26)", "limpiarPwa borra tamiz.flags.v1", "banco --archivado (lee HISTORIAL por article)"]
version_motor: "feat-arnes-geometrico (sin cambios de motor)"
resultado: "exitoso"
campos_fallidos: []
metrica: { veredictos_ok: "2/2 capturas archivadas automáticamente", zonas_correctas: "firma vacía roja 1/2 tomas; molde enrutado 2/2" }
---

## Problema observado

1. **Nada se guardaba solo en el flujo de UNA página.** `analisisCompletado`
   (store) solo navegaba a REVISIÓN; `registrarEnvio` (G.1) se llamaba únicamente
   en multipágina o en el envío manual de ADVERTENCIA. Los comentarios D4/G4
   («la ÓPTIMA se auto-envía al capturar») no tenían implementación real y
   `acta.enviadoAutomaticamente` nunca se asignaba.
2. **La ÓPTIMA es inalcanzable con el molde real de recibos.** El molde
   unificado `recibo_real` (decisión deliberada de la lección
   `2026-11-26-variantes-mismo-papel-tinta`: UN molde por familia con la UNIÓN
   de `htr`) marca `htr: true` en los 10 campos de datos. En
   `universal-engine.ts` (regla Fase 2.5 opción C, líneas ~1667-1678)
   `htr && obligatorio` ⇒ `requiere_revision` SIEMPRE. Un recibo impreso leído
   con conf 0.87-0.89 y todos los valores correctos termina con 9
   «obligatoriosFaltantes» (FECHA, Nº RECIBO, DNI, IMPORTE…) por estado, no por
   lectura. Las fotos del recibo quedaban en REVISIÓN sin guardarse.
3. **Flags de experimento contaminaban corridas.** `limpiarPwa` no borraba
   `tamiz.flags.v1`: los overrides de F2 de una corrida anterior sobrevivían.

## Causa raíz

- (1) hueco de implementación, no del motor: la rama single-page de
  `analisisCompletado` no archivaba.
- (2) regla doctrinal del motor (manuscritos siempre al humano) aplicada a un
  molde que tipa como manuscritos campos que en la variante impresa son texto
  de máquina. El molde `variantes/recibo_a_real.molde.json` («A (impreso)», sin
  `htr`) existe y es el tipado correcto para ese caso, pero publicarlo junto al
  unificado garantiza empate de anclas (lección 2026-11-26).

## Qué funcionó / qué no

- ✅ `archivarCaptura` nueva (envio.ts): archiva TODA captura analizada
  (procesada u original si la procesada salió vacía) con su veredicto REAL
  (RECHAZADA / ADVERTENCIA / EN_REVISION_HUMANA / OPTIMA-página), nota
  «CAPTURA ARCHIVADA · <ESTADO> — <motivo>», hash SHA-256 y JPEG ≤1280 en el
  libro. No toca `completadas`, `mesas` ni `archivadas`; idempotente por acta
  (`acta.capturaArchivada`). Single-page, página multipágina y lote rechazado.
- ✅ ActasView pinta el veredicto archivado (ámbar «pendiente», rojo
  «requiere nueva toma») y muestra la nota con el motivo en `meta`.
- ✅ Título del historial por prioridad acta → molde enrutado
  (`evaluacionMolde.moldeNombre`) → molde activo → plantilla.
- ✅ ÓPTIMA (single-page) ⇒ `registrarEnvio` + status ENVIADA +
  `enviadoAutomaticamente` (banner «ENVIADO AUTOMÁTICAMENTE» + SEGUIR
  ESCANEANDO); si el registro fallara, ReviewCtas tiene salida OPTIMA.
- ✅ `limpiarPwa` borra `tamiz.flags.v1`; banco `--archivado` abre HISTORIAL y
  lee la primera tarjeta (verificado A56: «CAPTURA ARCHIVADA ·
  EN_REVISION_HUMANA» tras cada foto, sin interacción).
- ❌ Esperar OPTIMA en recibos mientras `recibo_real` tenga `htr` en campos
  impresos: la aceptación completa exige revisión humana por diseño.

## Recomendación para próximas plantillas

1. Un documento mixto (impreso + firmas a mano) NUNCA alcanza OPTIMA con
   `htr` en sus campos de datos — si el flujo necesita envío automático,
   decide explícitamente: variante impresa SIN `htr` (empate de anclas ⇒
   riesgo) o aceptar revisión humana.
2. El guardado de evidencia NO debe depender del veredicto: archiva la captura
   siempre y deja que el estado hable (2026-11-26, `archivarCaptura`).
3. En bancos CDP, verifica el guardado leyendo la tarjeta de HISTORIAL
   (`article`), no solo el acta renderizada.
