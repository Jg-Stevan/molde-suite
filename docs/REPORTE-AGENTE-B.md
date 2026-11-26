# REPORTE-AGENTE-B — molde-suite (2026-11-26)

**Agente:** B — Producto, MVP y captura · **Rama:** `agent-b/mvp-captura-pwa`
**Base de partida:** `main` `ccb85b1` (SHA indicado en el plan §1)
**Plan de gobierno:** `PLAN-CIERRE-2-AGENTES-2026-11-26.md` (§6-B, §7, §10)

---

## 1. Estado por tarea (hecha / parcial / no hecha — UNA línea de evidencia cada una)

| Tarea | Estado | Evidencia |
|---|---|---|
| **B1** F5 PWA offline-first | **HECHA** (auditoría + 1 fix) | Fix `PwaRegister` (des-registro al desmonte); manifest/SW/COOP-COEP/cuota/plus-L auditados en verde; offline real demostrado sobre `BUILD_STATIC=1`: recarga en avión sirve el shell desde el SW y el escaneo SIM offline auto-guarda OPTIMA (capturas 19-21) |
| **B2** F6 import archivo/QR | **HECHA** (auditoría + límite documentado) | Import por archivo validado/activado y usado en escaneos (captura 03); lector QR completo ya existía (JSON crudo/MOLDE1:/LAN); límite documentado en el propio panel: Studio aún NO genera QR — camino verificado: archivo |
| **B3** §5 verificación/actualización de datos | **HECHA** | Conf/estado por campo + lápiz + editor inline + EDITADO (capturas 04-07, 12-13); re-evaluación con override (`molde/edicion.ts`) + persistencia IDB + UNA fila EDITADO (`store/edicion.ts`); contrato aditivo en `Acta` |
| **B4** §4 REGLA DE ORO | **HECHA** — NO parcial | Flag `autoGuardado` (default ON, kill-switch); decisión pura `decidirAutoGuardado` con los 4 tests obligatorios del plan en verde; hueco cerrado (ADVERTENCIA legible ahora SE GUARDA SOLA); EN_REVISION_HUMANA fuera de todo auto-archivo; multipágina bajo la misma regla; sin regresión del auto-envío D4 del E-14 (guard aditivo) |
| **B5** docs e higiene | **HECHA** | `PLAN-DESARROLLO.md` §«Criterios verificables» marcados con medición; `CAMBIOS.md` y `REPORTE-PRUEBAS.md` actualizados; 2 lecciones nuevas con causa raíz (`lessons/app_tamiz/2026-11-26-*`) |
| **B6** verificación §7 + reporte | **HECHA** | Checklist §7 completa en verde (PC + móvil 390×844 + estático offline) — tabla en `REPORTE-PRUEBAS.md` y capturas/lecturas en `scripts/resultados/verificacion-agente-b/` |
| Transversal | **HECHA** | **Bloqueante encontrado y cerrado**: `ppocr_keys.txt` faltaba en `assets.lock.json` → TODO escaneo caía 404 desde checkout fresco de main. Agregado con URL+SHA-256 (protocolo `preparar-assets`) |

## 2. Comandos ejecutados y resultado

| Comando | Resultado |
|---|---|
| `cd packages/scanner-core && bun test` | ✓ **77/77** (batería golden conocida del plan §1) |
| `cd apps/tamiz && bun run test` | ✓ **132/132** (106 existentes + 26 nuevos: §4 y §5) |
| `cd apps/tamiz && bun run typecheck` | ✓ 0 errores |
| `cd apps/tamiz && bun run lint` | ✓ 0 errores |
| `cd apps/tamiz && BUILD_STATIC=1 bun run build` | ✓ export estático PWA (`out/`) |
| Verificación en navegador (CDP/Chrome 158) | ✓ checklist §7 ítems 1-6 + extras B (ver `REPORTE-PRUEBAS.md`) |

## 3. Checklist §7 — resultado por ítem

| Ítem | Resultado | Captura |
|---|---|---|
| Carga sin errores de consola/hidratación | ✓ PC y móvil | 01, 10 |
| Fixture óptimo → OPTIMA → AUTO-GUARDADO (banner + fila) | ✓ | 02, 11 |
| Legible con UN obligatorio faltante → NO auto-guarda (estado/motivo) | ✓ | 04 |
| Edición → veredicto recalcula; completa obligatorios → auto-guardado inmediato | ✓ PC y móvil | 05, 06, 07, 12 |
| Tarjeta verificación / overlay / historial sin regresiones (foto no desplazada, panel 0 px) | ✓ | 02, 13, 14 |
| Multipágina: lote válido → una sola fila | ✓ (2/2 «Prueba dos páginas» → score 100 → una fila de envío) | 16, 17, 18 |
| Extra B: modo avión → escaneo OK | ✓ **en build estático** (en dev el combo SW+chunks efímeros rompe la hidratación — límite documentado) | 19, 20, 21 |
| Extra B: import por archivo OK | ✓ | 03 |
| Extra B: cuota mostrada | ✓ «63,2 MB de 10303,2 MB» | 15 |
| Privacidad: fotos NO en caché del SW | ✓ por diseño (dataURLs + guardas no-GET/`/api/`) | `public/sw.js` |

JSON de lecturas de las corridas: `scripts/resultados/verificacion-agente-b/lecturas.json`.

## 4. `git diff --stat` contra main y SHA base

- Base: `ccb85b1` · Cabeza de la rama al merge: ver `CAMBIOS.md` (SHAs finales).
- `git diff --stat ccb85b1..HEAD` (resumen): **43 archivos, +1705/−85** — incluye 2 commits de la rama (`feat(b3+b4)` y `docs(b5)`), el molde de control y las capturas sintéticas de evidencia.
- Nota sobre evidencia versionada: las capturas son de la UI con **fixtures sintéticos SIM** (regla §3.3: NINGUNA foto de documento real se versiona; las corridas reales quedan en local).

## 5. Decisiones tomadas y supuestos (§9 sin respuesta del dueño)

1. **`autoGuardado` default ON para toda la regla** (existente + caso nuevo): el plan §4 lo ordena («SE GUARDA AUTOMÁTICAMENTE») y los criterios de aceptación B exigen demostrarlo en navegador. Kill-switch `{"autoGuardado": false}` disponible (§3.4; un override corrupto apaga).
2. **ADVERTENCIA del gate E-14 sin molde enrutado NO auto-envía** (conservador: sin evidencia de campos que probar; D20 se conserva ahí). Con resumen ADITIVO, los obligatorios del molde NO bloquean el auto-envío del gate (guard anti-regresión, test 1d).
3. **Manuscrito obligatorio con `tinta === true` = PRESENTE** (semáforo de tinta v1.5.1); su confirmación humana sigue siendo el veredicto del motor — no bloquea la regla de oro.
4. **Re-evaluación §5 post-lectura**: re-corre el OCR produciría la misma lectura pagando un OCR entero; el override re-deriva con la MISMA semántica del motor y sus validaciones exportadas (`evaluarValidaciones`). Bandera `valor_editado_operador` en toda fila editada; conf=1 (entrada del operador).
5. **Manuscritos NO editables** desde el panel (su evidencia es la tinta medida, no un texto tecleado).
6. **Merge a main (§8) ejecutado con §7 en verde + este reporte completo** (la autorización del encabezado del plan). El orden §8.2 (Agente A primero) NO se pudo cumplir porque A no ha entregado: main queda sin deuda de B y lista para rebasar A; la verificación integrada §8.3 completa (con el trabajo de A) queda agendada al merge de A.

## 6. Limitaciones conocidas y riesgos

1. **Sin celular real**: la fase A56 (mutex en el teléfono, piso ≤10 s, lote real, demo en campo) sigue pendiente — decisión A5 y criterios del plan dependen de ella.
2. **Offline en dev no es válido**: el SW cache-first + chunks efímeros de `next dev` rompe la hidratación tras recargar en avión (lección `2026-11-26-ppocr-keys-faltante-y-offline-dev-sw.md`). La prueba offline se hace contra el build estático. Si el dueño quiere offline usable en dev: no registrar el SW en dev (requiere su visto).
3. **Título del lote multipágina para actas con clasificación electoral AUTO**: el título electoral (DOC 001) gana al nombre del molde por doctrina de main (`tituloDeArchivo`); para documentos no-electorales el título ES el molde («RECIBO DE LUZ CONTROL»). Si el dueño quiere el molde arriba también en E-14, es un cambio de una línea en `tituloDeArchivo` — pendiente de su decisión.
4. **QR generador**: Studio aún no produce el payload QR (lector de Tamiz listo). Documentado en el panel (B2).
5. **`evaluarMoldeEnActa` con molde ACTIVO ignora el router** (comportamiento de main): el molde activo manda aunque otro molde matchee mejor. No se tocó (fuera de alcance B).
6. **Riesgo residual de la regla de oro**: un documento ADVERTENCIA con obligatorios «presentes» pero con lectura errónea que cumple patrón (falso ok de patrón) se auto-guardaría. Mitigado por §5: el operador ve conf + puede corregir, y el EDITADO queda trazado. El riesgo es el mismo que ya existía para OPTIMA enrutadas.
7. **`historialFilaId` solo cubre filas de la sesión actual** — el historial persistido (jornada) no re-liga la fila si la app se recarga entre el archivado y la edición; en ese caso la edición crea fila nueva en lugar de actualizar (mejora futura: ligar por `acta.id`).

## 7. Cómo probar el flujo completo (PC y celular)

1. `bun install` (raíz) → `cd apps/tamiz && bun run preparar && bun run dev` (:3100).
2. PLANTILLAS → «SELECCIONAR ARCHIVO LOCAL» → `scripts/resultados/verificacion-agente-b/molde-control.molde.json` → queda ACTIVO.
3. ESCANEAR → SIMULACIÓN → «Recibo de luz» → RECHAZADA «FALTA SALDO PENDIENTE» (NO auto-guarda).
4. En VERIFICACIÓN DOCUMENTAL → lápiz de «SALDO PENDIENTE» → 8500 → GUARDAR CORRECCIÓN → OPTIMA 10.0 → «ENVIADO AUTOMÁTICAMENTE» → HISTORIAL: UNA fila «DATOS CORREGIDOS · AUTO-GUARDADO».
5. SIMULACIÓN → «Óptima» → auto-guardado directo (REGLA DE ORO).
6. Offline real: `BUILD_STATIC=1 bun run build` + servir `out/` → primera carga con red → modo avión → escanear.

---

**Cierre del Agente B (§10):** tareas B1-B6 hechas con evidencia; REGLA DE ORO §4 demostrada en navegador (PC y móvil, con y sin red); §5 completo con edición, persistencia EDITADO y auto-guardado inmediato; bloqueante `ppocr_keys.txt` cerrado. Pendiente del plan: fase A56 (dispositivo real) y la verificación integrada §8.3 al merge del Agente A.
