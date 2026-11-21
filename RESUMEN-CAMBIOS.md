# Resumen de cambios — Plan de Implementación molde-suite

**Fecha:** 2026-11-21 · **Base:** `main` @ `a95debc` · **Cabeza:** `b608324` (5 commits)
**Plan ejecutado:** `plan-implementacion-molde-suite.md` (6 fases)

> Nota previa importante: la rama `chore/auditoria-limpieza-v1` (base teórica
> del plan) NO está publicada en el remoto, así que el plan se aplicó sobre
> `main` replicando primero la limpieza v1 que el plan asumía (commit 1).

---

## Estado de verificación (evidencia ejecutada)

| Verificación | Resultado |
| --- | --- |
| `tsc --noEmit` molde-studio | ✓ 0 errores |
| `eslint` molde-studio | ✓ 0 errores (incluidos los 8 de React Compiler, F5.3) |
| `tsc --noEmit` Tamiz | ✓ 0 errores (antes: no compilaba) |
| `eslint` Tamiz | ✓ 0 errores |
| `BUILD_STATIC=1 next build` Tamiz | ✓ compila, 3/3 páginas estáticas |
| `next build` molde-studio (servidor) | ✓ 7 rutas API (incluidas /api/upload nuevas) |
| Build estático molde-studio (réplica exacta del CI de Pages) | ✓ |
| Smoke API end-to-end (crear molde → subir escaneo → corrida re-ejecutable → PUT re-ejecución) | ✓ 201/200/400/415 según lo esperado, header X-Total presente |
| `bun scripts/test-importar-e14.ts` (F5.1) | ✓ 12 checks |
| `bun scripts/test-motor-unit.ts` (corpus lógico F2/F5.2) | ✓ 44 checks (cierre 9=4+4+1 cierra, "2"≠17 rechazado, ventana centrada, umbral sugerido, penalización de anclas, validador N-4) |
| Workflow Pages YAML | ✓ válido, trigger `branches: [main]` |

## Hallazgo F4 (workflow): falso positivo de la auditoría

`branches: ain]` no existía en bytes reales: el archivo SIEMPRE tuvo
`branches: [main]` (verificado con `od -c` y parser YAML). El hallazgo de la
auditoría era un artefacto de renderizado de terminal (la secuencia `[m` se
oculta al mostrarla). Sin cambio necesario — documentado en el commit.

## Commits

1. `7e85ed3` — **Limpieza v1 (re-base del plan)**: traineddata 42 MB fuera (OCR
   por CDN), extract-ai y motor v2 muerto fuera, 39 dependencias sin uso fuera,
   ciclo repo↔repo-idb roto con `repo-types.ts`, typecheck en 0 para src/.
2. `8dec868` — **Fase 1**: `POST/GET /api/upload` (F2: antes 404) con
   validación de tipo/tamaño y storage en disco (decisión A documentada en
   `docs/API.md`), Prisma log condicional (N-15), .gitignore de runtime.
3. `feff923` — **Fases 2-5** (el corazón del plan):
   - **2.1** banda de indeterminación (0.6×-1.4× del umbral → revisión) +
     botón "Sugerir umbral" (trazo más fino × 0.7 sobre corridas reales)
   - **2.2** validaciones aritméticas de cierre (parser seguro; las lecturas
     falsas "2"≠17 quedan en `validacion_fallida` — test de auditoría en verde)
   - **2.3** confianza honesta: `conf` null cuando el OCR no reporta (antes
     0.5/0.6 fabricados); conf<0.5 en obligatorio → revisión
   - **2.4** patrones ANCLADOS `^(?:…)$` + `limpiar_valor` ("ZONA: 05" fuera)
   - **2.5** opción C para manuscritos: campo `htr` → siempre revisión humana
   - **2.6** penalización de posición suavizada 1/(1+3d) + render único 1000px
   - **3.1** `renderArchivos` cableado: 2 fotos → 1 corrida multi-página
   - **3.2** PDF como referencia del editor, HEIC con aviso, nada en silencio
   - **3.3** página equivocada + rotación 180 auto-corregida
   - **4.1** N-1/N-4/N-7 (score en Biblioteca estática, validador endurecido,
     paginación X-Total, blobs huérfanos, object URLs revocados, G-15)
   - **4.2** G-9/G-10/G-11 (aplicarJson validado, hatch "NO EVALUABLE",
     bloqueo de guardado, firmas sin etiqueta)
   - **4.3** G-1/G-2/G-5/G-6/G-7/G-13/N-6/N-10/N-11 (métricas coherentes)
   - **4.4** N-8 (errores visibles en toda operación fallida)
   - **5.1** importador E-14: geometría de ancla_zona prevalece sobre regex
   - **5.2** `opening1D` con ventana CENTRADA como cv2 (antes media ventana)
   - **5.3** React Compiler lint en 0
   - Assets: molde regenerado `acta_e_14_exterior_consul_embajado.molde.json`
     (votaciones y suma como HTR, cierre aritmético, umbrales 0.006, firmas
     recalibradas, sin meta.precision) + `docs/FORMATO-MOLDE.md`
4. `1f7d8c1` — **Fase 6**: Tamiz EJECUTABLE (decisión D8, opción B): paquete
   `packages/scanner-core` (contrato) + ~35 módulos de runtime implementados
   (pipeline real decode→detección→warp→calidad→OCR Tesseract→gate, captura
   con getUserMedia y anillo best-shot, política, obs, puente honesto,
   simulación sintética, store completo, hooks de cámara, QuadEditor…).
   Endurecimiento API 6.2 (`X_API_TOKEN` opcional + rate-limit 60/min por IP
   en todas las escrituras). Gate de versiones de molde (6.4).
5. `b608324` — READMEs honestos con el nuevo estado.

## Cómo subir al remoto

Opción A (recomendada — bundle con solo los commits nuevos):
```
git fetch /ruta/a/molde-suite-cambios.bundle main:plan-implementacion
git checkout main && git merge plan-implementacion && git push origin main
```

Opción B (patch):
```
git am cambios.patch   # sobre a95debc
```

Opción C (árbol completo): descomprimir `molde-suite/`, `git remote add origin
…`, commit y push.

## Límites documentados (lo que este envío NO trae)

- Corpus VISUAL de la auditoría (plantilla Nairobi + 2 actas El Cairo): las
  imágenes no están en el repo; el corpus entregado es LÓGICO (44 checks).
  Re-publicar las imágenes para el test de oro visual.
- Camino A de Tamiz (D8): detector sin perspectivas completas (bounding-rect
  por gradientes), OCR de bandas sin calibrar con corpus, puente sin hub real,
  Divipol de demostración (3 consulados).
- knip con más memoria y renombrado e14→neutro de Tamiz: pendientes (6.4).
