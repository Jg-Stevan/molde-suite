# Fase 0 — Comparativo medido en A56 y recomendación de fases

Fecha: 2026-11-26 · Dispositivo: Galaxy A56 (Chrome, CDP) · 6 fotos reales × 5 configs (+run2 baseline) = 36 corridas.
Evidencia por corrida: `scripts/resultados/medir-fases/*.json` · Tabla cruda: `TABLA.md` · Log: `../medir-fases-a56.log`.

## 1. Medias por configuración (tiempo a veredicto)

| config | media | Δ vs baseline | qué aísla |
|---|---|---|---|
| baseline | **32.8 s** (12 runs) | — | flujo completo (defaults) |
| rapid (`ocrPrimeraPasadaRapida`) | 31.5 s | **−1.3 s** | quita Tesseract página completa del intento 1 |
| sincascada | 25.3 s (5 runs) | **−7.5 s** | quita toda la cascada OCR |
| sinmolde | 28.6 s | **−4.2 s** | quita router/molde + motor + sus rescates |
| suelo (rapid+sinmolde) | 27.4 s | −5.4 s | piso del pipeline de imagen + bandas Rapid |

Detalle por foto (suelo): recibo-a 24.3 s · recibo-b 14.5 s · recibo-c 27.7 s · comprobante-a **41.5 s** · comprobante-b 26.5 s · comprobante-c 29.7 s.

## 2. Lecturas clave (medidas, no estimadas)

1. **`rapid` solo aporta −1.3 s** (est. previa: 6-12 s). Razón: al quitar el Tesseract del intento 1, el hueco lo ocupa Rapid det1280 (~5.3 s medidos en recibo-a). El coste se mueve, no desaparece. La ganancia real exige **reutilizar esas líneas Rapid** en el router (F2), no solo cambiar el orden.
2. **La cascada completa cuesta ~7.5 s de media** (baseline−sincascada). En recibo-a: tess-best 7.0 s + Rapid1280 5.3 s + ROI 3.4 s + bandas 1.5+1.9 s ≈ 19 s de OCR de página/bandas. Pero quitarla entera (sincascada) arriesga el GATE y el rescate → doctrina prohibe aceptar ese camino sin sustituto. El sustituto medible es Rapid-first + reuso de líneas.
3. **El molde/router cuesta ~4.2 s de media** (baseline−sinmolde), con rescates por campo activos en 7/12 corridas baseline (`rescate=sí`). El A/B sobre original **no se ejecutó en ninguna corrida** (solo aplica a blancos con ok_count=0).
4. **El piso (suelo) es 27.4 s de media** — muy por encima del objetivo de 10 s. El grueso restante es el **pipeline de imagen**: doble warp `processImage` (bw+original) + fallback bw en main thread a resolución completa, probe de orientación (recibo-a: 4.8 s), y las bandas Rapid (sup det1280 + inf det1920, ~3.4 s en recibo-a). El caso extremo comprobante-a (suelo 41.5 s) es puro coste de imagen, sin OCR de molde.
5. **Calentamiento**: recibo-a baseline run1 32.4 s → run2 25.5 s (−7 s ya caliente). El arranque frío de workers (est. A13 ~13 s) sigue pesando en la 1.ª foto.
6. Anomalías de medición: recibo-c `sincascada` TIMEOUT (watchdog 420 s; corrida colgada, no reproducida) y canal `molde_ocr/motor/render` del IDB sigue devolviendo null (LEE_ACTA; el desglose del molde se infiere de consola y deltas de config).

## 3. Reparto medido del tiempo (baseline ≈ 32.8 s)

| bloque | coste medido | vía |
|---|---|---|
| Pipeline imagen (warps, bw, orientación, bandas) | **~27 s de media** (piso suelo) | config suelo |
| Cascada OCR sobre ese piso | +5.4 s | suelo−baseline |
| Router/molde + motor + rescates | +4.2 s | sinmolde−baseline |

## 4. Orden recomendado de fases (ganancia medida / riesgo)

| Orden | Fase | Ganancia esperada | Base de evidencia |
|---|---|---|---|
| 1 | **F4 — warm-up + reciclado + fallback bad_alloc** | −7 a −13 s en la 1.ª foto; evita cuelgue 2.º escaneo | run1−run2 = 7 s; perfil A13 |
| 2 | **F2 — Rapid-first + reuso de líneas Rapid en el router** | −6 a −10 s (elimina 2.º Tesseract de página + duplicación Rapid1280/ROI) | cascada −7.5 s + rapid solo −1.3 s ⇒ la ganancia está en el reuso |
| 3 | **F1 — warp compartido bw+original + off-main-thread** | −2.3 a −3.6 s (más en comprobante-a) | perfil A13; piso imagen 27 s |
| 4 | **F3 — skip A/B en blancos + presupuesto de rescates** | −2 a −4 s en fotos malas (rescate activo en 7/12 baseline) | rescate=sí medido |
| 5 | **F5 — hilos/SAB y resolución por tier** | solo si tras F1-F4 el piso sigue > 15 s | suelo 27.4 s ⇒ probablemente necesario para ≤ 10 s |

Nota honesta sobre el objetivo ≤ 10 s: con F1-F4 se proyecta ~15-18 s de media; el piso medido de imagen (27.4 s, y 41.5 s en comprobante-a) indica que **F5 (hilos/SAB y resolución de trabajo por tier) será necesario** para llegar a 10 s, con el banco de 21 fotos como puerta doctrinal.

## 5. Próximo paso (gated a aprobación del dueño)

Implementar por rama+PR en el orden F4 → F2 → F1 → F3 → F5, cada fase con kill-switch en `tamiz.flags.v1`, banco 21 + `bun test` + fixtures golden, ficha lessons, y `agent:map` si toca `packages/*`. La Fase 0 no tocó código de la app.
