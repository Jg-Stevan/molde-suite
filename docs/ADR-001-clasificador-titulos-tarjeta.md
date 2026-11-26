# ADR-001 — Clasificador de títulos de tarjeta: NO se implementa (Opción B)

- Fecha: 2026-11-26
- Estado: **Decidido** (tarea A6 del plan de cierre PLAN-CIERRE-2-AGENTES-2026-11-26, P2)
- Decidido por: Agente A con autorización del documento de cierre (§9: sin
  respuesta del dueño, aplica la política conservadora documentada)
- Alcance del contrato del molde: SIN cambios (decisión de producto/motor, no de
  esquema — `schemaVersion` intacto)

## Contexto

La tarea #14-adjacent «clasificador de títulos de tarjeta» quedaba abierta en el
plan de desarrollo: decidir si el motor implementa un clasificador que detecte
el TÍTULO del documento (p. ej. «RECIBO DE PAGO», «ACTA E-14») para enriquecer
las tarjetas de HISTORIAL/REVISIÓN, o si se cierra con un ADR corto dejando el
comportamiento final como está.

## Decisión (Opción B — no implementar, comportamiento final documentado)

1. **El molde enrutado ya resuelve el título.** Desde `29db1c2` (main,
   2026-11-26) el enrutamiento universal identifica el molde (QR capa 0 →
   huella de frases → esqueleto penalizado) y la fila de HISTORIAL usa el
   nombre del molde como título (`tituloPaginaActual` / `tituloDeArchivo`):
   para multipágina «una sola fila con el nombre del molde como título» está
   verificado en navegador (lesson 2026-11-26 multipágina; re-verificado hoy en
   la corrida §7 del Agente A: fila «DOC 001 — PRINCIPAL» + HISTORIAL con
   nombre de molde).
2. **Un clasificador de títulos en el motor añade superficie sin demanda
   medida.** Sería una tercera vía de identidad (QR, huella, título) con
   desacuerdos que el endurecedor tendría que arbitrar — exactamente la familia
   de colisiones documentada en lessons P1 (matcher difuso acepta la etiqueta
   vecina).
3. **Coste de re-visita bajo.** Si la fase A56 (dispositivo real) muestra
   titulares mal asignados en campo (moldes sin huella, QR ausente, varios
   moldes con la misma huella), el ADR se re-abre con esas evidencias; la vía
   barata primero es exigir `huella` en los moldes nuevos, no clasificar píxeles.

## Consecuencias

- El título de tarjeta en HISTORIAL/REVISIÓN queda definido como: nombre del
  molde enrutado (AUTO) o el título genérico del acta (sin clasificación).
- No se añaden flags ni kill-switches (no hay cambio de comportamiento: el
  molde-enrutado YA era el comportamiento desde `29db1c2`).
- La tarea «clasificador de títulos» se considera CERRADA en el plan de
  desarrollo; re-apertura solo con evidencia de campo de A56.
