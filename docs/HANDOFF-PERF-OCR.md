# Handoff — rendimiento OCR y cierre del auto-envío

Fecha: 2026-11-26 · Rama: `wip/perf-ocr-serializacion` · Base: `main` `ccb85b1`

## Dónde quedó el trabajo

- **En `main` (publicado)**: regla de dictamen HTR por confianza
  (`htrConfDictamen`, default `null` = OFF) y guardado automático de capturas.
  Banco 21 en A56 con `--flags '{"htrConfDictamen":0.8}' --archivado`: A (impreso
  sin firma pagador) → RECHAZADA con motivo explicable; B (en blanco) → 0 lecturas;
  C (mixto) → verdes solo donde hay trazo. Sin `ok` falsos.
- **Pendiente (paso 5 del plan)**: demo OPTIMA → ENVIADA automática de punta a
  punta. Requiere una foto de recibo **completa y limpia** (ambas firmas, sin
  texto superpuesto). La foto de las 17:19 que está en local tiene texto
  duplicado y rompe el OCR de emisor/pagador/forma de pago (score 58.3 → no
  enruta con `UMBRAL_RUTA_SCORE = 65`).

## Qué trae esta rama

- `packages/scanner-core/ocr/rapidocr.ts`: **turno FIFO de reconocimiento
  completo** (`conTurnoReconocimiento`) — candidato anti-cuelgue de F2. Serializa
  det/cls/rec del singleton proxy (warm-up F4 ↔ primer escaneo rapid-first).
  **No verificado aún en A56**: serializar no cambia resultados, pero hay que
  medir latencia y confirmar que desaparece el cuelgue con `ocrPrimeraPasadaRapida`.
- `scripts/entrega/f1-dual-harness.ts` + `f1-equivalencia-dual.mjs`: equivalencia
  pixel a pixel entre `processImage('bw')` y `processImageDual` (warp compartido),
  con Chromium local y dev server en :3100.
- `scripts/entrega/captura-a56-cdp.mjs`: captura por CDP del teléfono.

## Tareas abiertas (F1–F5)

- **#14** aislar el culpable del cuelgue: con solo F1, con solo F2.
- **F1** warp compartido + off-main-thread (línea «warp compartido», paquetes
  `scanner-core/core/image-processor`).
- **F2** Rapid-first + reuso de líneas en router (mutex de esta rama).
- **F4** warm-up + reciclado + fallback `bad_alloc`.
- **F5** hilos/SAB por tier (condicional; `apps/tamiz/src/lib/e14/adaptacion/plan.ts`).

## Runbook en el otro equipo

```bash
bun install
cd apps/tamiz && bun run preparar      # assets + workers
bun run dev                            # :3100
```

A56 por adb inalámbrico:

```bash
adb mdns services                                   # descubrir _adb-tls-connect
adb connect <ip>:<puerto>
adb forward tcp:9223 localabstract:chrome_devtools_remote
```

Banco E2E (desde la raíz):

```bash
node scripts/entrega/verificar-moldes-reales-a56.mjs \
  --cdp http://127.0.0.1:9223 \
  --flags '{"htrConfDictamen":0.8}' --archivado
```

Aviso: con Playwright conectado por CDP **nunca** `browser.close()` — cierra el
Chrome del teléfono; salir con `process.exit(0)`.

Flags relevantes (`apps/tamiz/src/lib/e14/flags.ts`): `htrConfDictamen`
(`null` = OFF, 0.5–1.0), `ocrPrimeraPasadaRapida`, `adaptacionDispositivo`.

## Privacidad y reglas

- **Fotos y evidencia incluidas en la rama**: las 23 fotos del banco están
  versionadas en `apps/tamiz/public/dev-fixtures/reales-variantes/` (plantillas
  de prueba) y las capturas/lecturas de las corridas en `scripts/resultados/`.
  El repo es público: antes de añadir documentos nuevos, confirmar que son
  plantillas de prueba y no documentos de personas reales.
- Push a `main` solo con autorización del dueño; sin dependencias nuevas; no
  modificar los ONNX; offline-first; tras tocar `packages/*` correr
  `bun run agent:map`; ficha en `lessons/` cuando haya hallazgo.
- Doctrina: ningún `ok` falso, jamás rechazar un documento completo y legible,
  toda negación explicable.
