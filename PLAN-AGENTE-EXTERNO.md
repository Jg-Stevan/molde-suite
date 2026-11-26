# PLAN-AGENTE-EXTERNO — completar Tamiz sin teléfono

Documento de entrega para un agente que retoma el trabajo en una **sandbox sin
acceso a cámara ni al Galaxy A56**. Todo lo que aquí se pide se valida
**importando imágenes** por la UI (Archivo → Elegir imagen → pipeline real),
que es exactamente el camino que ya se usó para medir el §10 del reporte.

Leer primero: `AGENTS.md`, `apps/tamiz/REPORTE-DIAG-AUTO-CAPTURA-A56.md`
(§9 = lista histórica, **§10 = estado medido al cierre de esta jornada**).

---

## 0. Reglas duras (no negociables)

1. **Sin dependencias nuevas** sin OK explícito del dueño (hoy son 4 y están
   confirmadas por uso: framer-motion, jspdf, zxing-wasm, onnxruntime-web).
2. **Nada de pesos de modelo (.onnx) ni traineddata en el repo.** Se bajan por
   URL con SHA-256 en `assets.lock.json`; si falta el par, se documenta, no se
   inventa.
3. **Offline-first**: sin backend, sin login, sin subir documentos.
4. `packages/*` **jamás** importa de `apps/*`; las apps usan subrutas públicas
   de `scanner-core` (lo verifica el lint).
5. Doctrina del gate: **un documento completo y legible NUNCA se rechaza**;
   el rechazo es por CONTENIDO (falta/ilegible), nunca por geometría.
6. **No tocar `UMBRAL_RECHAZO_SCORE` (6.5)** sin ≥20 capturas reales. El §10
   demuestra que no es el factor discriminante.
7. Commits en español, conventional-commit. **No pushear sin autorización** del
   dueño (esta rama ya fue autorizada: los cambios de esta entrega van a main).

## 1. Puesta en marcha

```bash
bun install
cd apps/tamiz
bun run preparar        # materializa OCR, OpenCV, vendor y workers IIFE en public/
bun run dev             # http://localhost:3100
# otra terminal, desde la raíz del monorepo:
npm i -D playwright && npx playwright install chromium
node scripts/entrega/verificar-importacion.mjs
```

`verificar-importacion.mjs` deja la app sin service worker ni cachés, **activa
el molde real** (`apps/tamiz/public/moldes/recibo_pago.molde.json`) vía
localStorage, importa 7 imágenes una por una y escribe
`scripts/resultados/importacion-<ts>.json`. Sale 0 si el banco cumple.

### Pitfalls ya pagados (ahorran horas)

- El SW `public/sw.js` cachea el shell: sin desregistrarlo ves JS viejo aunque
  edites. El script lo hace; si lo haces a mano, también borra `caches`.
- La **auto-captura** de la cámara simulada se dispara sola y sobreescribe la
  importación: desactívala (aria-label `Captura automática`) si pruebas a mano.
- El botón del veredicto cambia de texto (`REPETIR CAPTURA…` vs
  `OBLIGATORIO REPETIR FOTO…`): usa regex `/REPETIR/i`.
- El importador vive en la pestaña **ARCHIVO** (`ELEGIR IMAGEN`); usar el
  *filechooser* de Playwright, no `setInputFiles` sobre un input oculto.
- Los «errores» de consola de Tesseract («Estimating resolution», «Total
  count=0», «SD= 0.00») son log normal, no fallos.

## 2. Estado verificado (no re-testear sin razón)

| Fixture | score | veredicto | verificación |
|---|---|---|---|
| recibo_pago/pag-01 (limpia) | 10.0 (bruto 7.5) | ÓPTIMA | 100 % OK, molde enrutado |
| recibo-tachado | 8.7 | REVISIÓN HUMANA | 18 % (0 lecturas) |
| recibo-datos-nuevos / -sin-firmas / recorte-60 / recorte-66 / rotada-12 | 7.5 | RECHAZADA | 75 % (9/12) |

Los 4 rechazos de 9/12 fallan siempre en **firmas (+ fecha/título)**: el OCR no
lee firmas. Es estructura de molde, no umbral (ver tarea C).

## 3. Backlog priorizado

### A. QR capa 0: 8 s muertos por documento sin QR — **P1**
- Evidencia (log en vivo): `qr-capa0-worker … ms=95xx fin=vencido` y el acta
  muestra «CÓDIGO QR NO CORRIÓ EN ESTA CAPTURA»; cada escaneo sin QR pierde
  ~9.5 s (`presupuesto=8000 + GRACIA_KILL_MS 1500`).
- Código: `packages/scanner-core/qr/capa0-qr.client.ts` (`presupuestoMs = 8_000`
  en `decodificarQrCapa0Camara`, `GRACIA_KILL_MS` arriba); worker
  `packages/scanner-core/workers/capa0-qr.worker.ts`.
- Caminos: (1) pre-chequeo barato de patrones localizadores (3 cuadrados de un
  QR) antes de arrancar el worker; (2) presupuesto adaptativo (2–3 s y rescate
  sólo si hay candidato); (3) paralelizar de verdad con el OCR y no bloquear el
  veredicto.
- Aceptación: escaneo de documento **sin** QR no espera 8 s (medir en el JSON
  `segundos` y el log `ms=`), y un fixture/imagen **con** QR sigue devolviendo
  payload — usar `scripts/resultados/fixtures/qr-test-capa0.png` (QR 400×400,
  texto `MOLDE-SUITE-QR-CAPA0-TEST-2026`; verificar que `decodificarQrCapa0Camara`
  o `decodificarQrDeCapture` devuelve ese payload exacto). Añadir test unitario
  del pre-chequeo.

### B. `rotada-12`: el visor cae a la foto original — **P2**
- Evidencia: el acta sale «SE MUESTRA LA FOTO ORIGINAL» (`ReviewView.tsx:354-358`,
  `fotoSinTinta = !acta.fotoProcesada || procesadaVacia`) con imagen 2120×2505
  (= original), aunque el OCR leyó 9/12 campos.
- Hipótesis: el paso de procesado devolvió data URL vacío y el pipeline siguió
  con el OCR de la vía cruda. Instrumentar `processImage`/`processImageViaFallbackWorker`
  para esta entrada (2120×2505, quad sesgado) y corregir la causa.
- Aceptación: con `rotada-12` el visor muestra la PROCESADA (§D4 sólo debe
  activarse con procesada realmente vacía); regresión en
  `tests/portados.test.ts` o el propio JSON del banco.

### C. Firmas: la estructura del molde, no el umbral — **P1 de producto**
- Evidencia: los 3 campos que faltan en los 4 rechazos son firmas (+ fecha o
  título). `recibo-sin-firmas` debe seguir RECHAZADA, pero un recibo **con**
  firmas visibles debería poder pasar.
- Propuesta: en `apps/tamiz/public/moldes/recibo_pago.molde.json` (y los de
  `apps/molde-studio/templates/genericos/`) marcar los campos de firma como
  `tipo: "firma"` con `min_trazos`/`firma_esperada` (ya existen en
  `universal-types.ts`) o dejar de exigirlos por texto. El motor ya distingue
  `firma_ausente` por trazos — úsalo; **jamás** un ok silencioso.
- Aceptación: `recibo-sin-firmas` sigue RECHAZADA con bandera `firma_ausente`;
  `recibo_pago/pag-01` sigue 100 % ✓; documentar el cambio en el reporte.
- Prohibido: bajar `UMBRAL_RECHAZO_SCORE` para «arreglarlo».

### D. Cablear `CameraFrameLoop` / `live.corners` — **P2, riesgo alto**
- `apps/tamiz/src/lib/e14/core/{frame-loop,motion-stabilizer}.ts` existen y
  **nadie los importa**; `useSesionCamara` corre su rAF propio de 250 ms.
- Sin cámara real sólo puedes validar con la cámara SIM del dev y con tests
  unitarios del estabilizador (k-de-n). Deja el cambio detrás de un flag y
  anota que la validación táctil queda pendiente en el A56.
- Aceptación: auto-captura sigue funcionando en sim; tests del estabilizador
  verdes; sin regresión en `useSesionCamara`.

### E. RapidOCR `.onnx` — **BLOQUEADO por el dueño**
- Faltan URL + SHA-256 de los 3 modelos en `apps/tamiz/scripts/assets.lock.json`.
  El OCR base (Tesseract spa) se materializa con `preparar` y no bloquea.
- No inventes URLs ni hashes. Pide la decisión y sigue con otra tarea.

### F. Higiene en cada entrega
```bash
cd apps/tamiz && bun test && bun run typecheck && bun run lint
cd packages/scanner-core && bun test
```
No versionar `public/scanner/*.worker.js` ni modelos (ya gitignorados). Regenera
workers con `bun scripts/construir-workers.mjs` si tocas
`packages/scanner-core/workers/*`.

## 4. Cómo medir sin celular

1. `bun run dev` y `node scripts/entrega/verificar-importacion.mjs`.
2. Para una captura concreta: abre la app, ESCANEAR → pestaña ARCHIVO →
   ELEGIR IMAGEN → espera veredicto → mira score, «VERIFICACIÓN DOCUMENTAL» y
   el banner del molde. El botón «Recortar/Rotar 90°» permite probar el editor.
3. Guarda siempre el JSON de resultados; el reporte lo cita por fecha.

## 5. Definición de terminado

- [ ] A: sin QR ya no cuesta 8 s; con QR sigue leyendo; test del pre-chequeo.
- [ ] B: `rotada-12` muestra la procesada; causa documentada.
- [ ] C: firmas evaluadas por trazos; sin-firmas rechazada honesta; limpia 100 %.
- [ ] D: loop portado cableado (o decisión escrita de no hacerlo) + tests.
- [ ] E: lock de modelos completo **o** decisión firmada de mantener RapidOCR
      como fallback sin pesos.
- [ ] Suites verdes (52 tamiz + 28 scanner-core) · typecheck 0 · lint 0.
- [ ] §10 del reporte actualizado con cada cierre y su evidencia.
- [ ] Pendiente real de dispositivo anotado: prueba táctil A56 + ≥20 capturas.

## 6. Mapa rápido

- Pipeline: `apps/tamiz/src/lib/e14/pipeline.ts` (molde corre ANTES de los
  rechazos del gate, ver §10).
- Enrutado: `apps/tamiz/src/lib/e14/molde/{enrutamiento,evaluacion}.ts`
  (`debeEnrutar` es la puerta; tests en `apps/tamiz/tests/portados.test.ts`).
- Filtros/imagen: `packages/scanner-core/core/image-processor.ts` y su gemelo
  `workers/fallback-canvas.ts` (misma matemática; corregir en el mismo commit).
- Calidad: `packages/scanner-core/core/calidad.ts` (medida sobre la imagen
  PROCESADA a propósito — §10).
- Veredicto UI: `apps/tamiz/src/components/e14/screens/ReviewView.tsx`.
- Molde activo: `apps/tamiz/src/lib/e14/molde/registry.ts`
  (clave `tamiz.moldeActivo.v1`).
