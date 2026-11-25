# §14A · Perfilado de memoria y tiempos — Galaxy A13 real (2026-11-25)

Solo lectura. No se modificó `detection-worker.js` (asset md5), umbrales, OCR ni la app.
Dispositivo: SM-A135M, Android 13, kernel 4.19.198, 3.8 GB RAM + ZRAM, Chrome 158.0.8127.42.
Serial `192.168.1.4:35543` (ADB WiFi), dev server host `:3100` por `adb reverse`, CDP `:9223`.

Evidencia (JSON crudos en `scripts/resultados/`):
- `perfil-a13-2026-11-25T17-16-05-181Z.json` — base 4 fotos, misma pestaña, sampler ON.
- `cpu-worker-2026-11-25T17-26-30-529Z.json` — Profiler CDP sobre el hilo del worker (250 µs).
- `encode-bw-2026-11-25T17-37-02-194Z.json` — encode sobre el bw real del worker.
- `encode-2026-11-25T17-35-24-598Z.json` — sensibilidad a resolución (proxy).
- `perfil-a13-2026-11-25T17-13-27-379Z.json` + logcat — crash por recarga (WASM OOM).

Harness: `scripts/entrega/verificar-perfil-reales.mjs` (Fase 1), `perfilar-cpu-worker.mjs` (Fase 2),
`experimento-encode-bw.mjs` / `experimento-encode.mjs` (Fase 3), `probar-cdp-worker.mjs` (sonda CDP).

---

## 1. Tiempos por etapa (base 4 fotos, misma pestaña, cámara neutralizada)

| foto | boot worker | fetch | decode | mini | detect | warp | enhance bw | dataURL | **total** |
|---|---|---|---|---|---|---|---|---|---|
| 201944 (fácil) | 13212 ms | 185 | 173 | 53 | 433 | 3560 | 5400 | 13 | **9817** |
| 202044 (fácil) | 22 ms | 102 | 126 | 52 | 213 | 2941 | 6294 | 28 | **9758** |
| 222555 (difícil) | 12811 ms* | 175 | 135 | 77 | 371 | 2724 | 4427 | 23 | **7933** |
| 223112 (difícil) | 19 ms | 120 | 116 | 53 | 186 | 2315 | 4330 | 12 | **7133** |

\* 222555: el primer intento en la misma pestaña se colgó 180 s (tope del harness); se recuperó
con página nueva y completó en 7.9 s. Ver §4.

Reparto del tiempo de pipeline (sin boot): **bw ≈ 55–65 %**, **warp ≈ 25–36 %**, detect < 5 %,
decode/fetch/mini/dataURL < 5 % combinado.

- **IPC despreciable:** enhance cliente 5399 ms vs `elapsedMs` interno del worker 5380 ms → ~20 ms
  de serialización/cola. `postMessage` con `Transferable` (bitmaps) no clona.
- **Boot frío 13.2 s; reuso del worker 19–30 ms.** El warm-up elimina ~13 s en el primer escaneo.
- **dataURL 12–28 ms:** convertir el PNG a dataURL no es cuello de botella.

## 2. CPU fino del worker (Fase 2, Profiler 250 µs, pipeline completo)

| foto | CPU worker total | WASM | JS | % WASM |
|---|---|---|---|---|
| 201944 | 11045 ms | 5747 ms | 5298 ms | 52 % |
| 223112 | 8586 ms | 4954 ms | 3634 ms | 58 % |

Top funciones (self-time):

| función | tipo | 201944 | 223112 | etapa |
|---|---|---|---|---|
| `handleWarp` | JS | 1495 ms | — | warp |
| `wasm-function[4303/4778/4770]` | WASM | ~3900 ms | ~3800 ms | warp/resize OpenCV |
| `getImageData` | JS/nativo | — | 833 ms | readback canvas (bw) |
| `slidingMinMax1D` | JS | 482 ms | 441 ms | filtro bw |
| `morphClose` | JS | 373 ms | 297 ms | filtro bw |
| `correctedGrayWithModel` | JS | 237 ms | 230 ms | iluminación bw |
| `handleEnhance` | JS | 227 ms | — | bw |
| `bradleyRoth` | JS | 218 ms | 190 ms | binarización bw |
| `integralImage` | JS | — | 138 ms | filtro bw |
| `(idle)` | — | 979 ms | 541 ms | espera IPC/cola |

**El encode PNG (libpng) es nativo del navegador y NO aparece en el profiler del worker.**
Se aisló aparte (§3).

## 3. El codificador PNG es el mayor costo del bw (Fase 3)

Salida bw real del worker: **1421×1767 px (~2.5 MP, recorte del documento, no 12 MP)**, blob 105 595 B.
`enhance` completo: 7177 ms (worker 6596 ms).

Re-encode del MISMO contenido bw (byte-idéntico, 105 595 B):

| operación | tiempo | bytes |
|---|---|---|
| `getImageData` | 63 ms | — |
| `convertToBlob('image/png')` | **4642 ms** | 105 595 (idéntico) |
| `convertToBlob('image/webp', 0.9)` | 1684 ms | 69 844 |

→ **El codificador PNG del navegador consume ~4.6 s de los ~6.6 s del enhance bw (~70 %).**
El filtro (WASM + JS) es ~1.5–2 s; `getImageData` ~0.8 s; el resto es encode.

Sensibilidad a resolución (proxy sobre foto, no bw): 4032→2400 px reduce `getImageData`
3941→1504 ms y PNG 16209→8428 ms. El encode escala con el número de píxeles.

Nota: binarizar una foto ruidosa (speckle) da PNG 14 s — peor caso, NO representativo del bw
limpio del worker. El dato válido es el re-encode del bw real (4.6 s).

**Restricción de paridad:** WebP es ~3× más rápido pero cambia los bytes → rompe la paridad
visual byte-a-byte exigida. Sustituir libpng por otro codificador (fpng/UPNG) tampoco produce
bytes idénticos. **Esta ganancia (~3 s) está BLOQUEADA por el requisito de salida byte-idéntica.**

## 4. Mapa de memoria y causa del crash (Fases 1 y 4)

- **El heap JS es ciego al costo real:** `performance.memory` se queda plano en ~13 MB durante
  todo el pipeline. Los 12 MP viven en WASM (`cv.HEAPU8` = 128 MB fijos) + `ImageBitmap` + Shmem,
  fuera de V8.
- **Shmem bajo (13–23 MB):** los bitmaps se transfieren, no residen en GPU.
- **Acumulación en la misma pestaña:** renderer RSS 466→689 MB (foto 1, +223 transitorio),
  727→831 MB (foto 2, **+38 MB retenidos** entre fotos). Tras 2 fotos el pipeline se colgó 180 s
  (PSI some avg10 8.3, zram 273 MB). Al recuperar con página nueva: RSS cae a 56 MB, zram salta a
  907 MB (el renderer viejo se swappeó) y las fotos difíciles vuelven a 7–8 s.
- **Presión:** PSI some avg10 pico 6.8–8.3, full 1.9–2.5; load1 ~25 (8 núcleos); freqs 1586 MHz
  estables; AP 42.9→40.5 °C, BAT 32.8→32.3 °C. **Sin throttling térmico** (cooldown 0 s siempre).
- **Crash por recarga entre fotos:** `WebAssembly.instantiate(): Out of memory` — al recargar,
  Chrome reinstancia OpenCV sobre el mismo proceso renderer que aún retiene el WASM anterior
  (128 MB por instancia). NO fue kill de lmkd (no hay `am_kill` del renderer en ese logcat).
- **Crash con cámara encendida (runs previos):** lmkd mata el renderer con `available` 214–249 MB
  (`am_proc_died`, `CAMERA OPEN`, camkillboostmode). Neutralizar `getUserMedia` en el harness
  eliminó esos kills y bajó los tiempos (bw 10.9 s con cámara → 4.3–6.3 s sin cámara).

## 5. Lista priorizada de optimizaciones candidatas

| # | candidata | ganancia estimada | paridad | riesgo | estado |
|---|---|---|---|---|---|
| 1 | **Warp compartido bw+original** (evitar el 2.º warp que hace la app para OCR) | ~2.3–3.6 s/import | SHA-256 del bitmap warp | medio | viable, plan de implementación separado |
| 2 | **Warm-up real con tope por tier** (worker caliente antes del 1.er escaneo) | ~13 s primer escaneo | ninguna (solo timing) | bajo-medio | aprobado-en-espera |
| 3 | **Reciclar worker / GC entre escaneos** (evitar acumulación 831 MB → stall 180 s) | evita stall catastrófico | ninguna | bajo | viable |
| 4 | **Codificador PNG más rápido** | ~3 s/import | **rompe bytes** | — | **BLOQUEADA** por paridad byte-idéntica |
| 5 | Micro-opts filtro JS (`slidingMinMax1D`, `morphClose`, `bradleyRoth`) | ~0.5–1 s | byte-idéntica obligatoria | alto | solo si el perfil muestra redundancia y SHA-256 coincide |
| 6 | dataURL vs Blob | ~0 (12–28 ms) | — | — | descartada |

Hallazgo de entorno (no implementar sin aprobación): cerrar la cámara durante el procesamiento
del import mejora tiempos y evita kills de lmkd, pero cambia el comportamiento de cámara respecto
a digielect14 → fuera de alcance por la restricción del owner.

## 6. Conclusión

El cuello de botella del bw es el **codificador PNG nativo del navegador (~4.6 s, 70 % del enhance)**,
no el filtro ni WASM. Esa ganancia está bloqueada por la paridad byte-idéntica. Las optimizaciones
accionables sin romper paridad son **warp compartido (~3 s)**, **warm-up (~13 s primer escaneo)** y
**reciclado de worker para evitar la acumulación de memoria que cuelga el pipeline a los 2 escaneos**.
El crash observado no es OOM del sistema sino reinstanciación WASM al recargar; la misma pestaña
con worker reusado es estable hasta que la memoria nativa acumulada (~831 MB) provoca un stall.