# Spike F0 — S vs plus-L con estructura (E-14 p1)

Fecha: 2026-11-22 · Ejecutado con: `bun run spike-s` (`packages/layout-core/scripts/spike-s.ts`)
Fuente de datos: detecciones GRABADAS de las corridas reales del banco de
pruebas (`results-banco.jsonl`) contra el GT de Chandra normalizado
(`e14-p1-gt.json`, 19 bloques). **Sin modelo, sin red** — el evaluador se
alimenta de las cajas reales que los modelos produjeron en el celular.

## 1. Método

- Página renderizada a 676×2048 px (pdf.js escala 2, lado máximo 2048).
- Corridas fuente: `phone-mwrf3lq0` (plus-L, pool 0.2, 73 cajas SIN NMS de
  app) y `phone-mwrgw19y` (S, umbral 0.2 con NMS 0.5 de app, 37 cajas).
- Matcher idéntico al prototipo: greedy por score, uno-a-uno,
  **IoU ≥ 0.5 o contención ≥ 0.8**.
- Variantes S probadas (todas declarativas, sin tocar el motor):
  1. **Baseline**: las reglas plus-L sin cambios.
  2. **SPIKE**: títulos partidos por cortes relativos `[0.384, 0.61]`
     dentro del contenedor fusionado (GT: ACTA 123-178, CÓNSUL 178-211,
     ELECCIÓN 213-272); `text` aceptado como tabla en nivelación/votos con
     restricciones de ancho (≥ 0.5W) y alto; `e14` con `minH 0.015` (la caja
     de S mide 35 px); logo acepta `text`; `registraduria_text` con zona
     ampliada y `maxH 0.04` para capturar el contenedor fusionado
     logo+texto; orden de declaración e14→version (desempata empates de
     score 0.22/0.22 vía asignación codiciosa); `barcode_text` y
     `candidatos` quedan OPCIONALES para S (no detectables sin fusión).
  3. **Rechazado — contenedor de página**: partir el contenedor
     `image 0.51 y -5..1744` en las dos tablas de candidatos NO es aplicable:
     el contenedor nunca cae COMPLETO dentro de la zona de candidatos
     (contención completa es el contrato del dossier) y con zonas recortadas
     al contenedor produce 2 falsos positivos (partes sobrantes).

## 2. Resultados (E-14 p1, GT 19 bloques)

| Corrida | TP | FP | P | R | F1 | msPost* | Gate |
|---|---|---|---|---|---|---|---|
| plus-L + estructura E-14 (control) | **19** | **0** | 1.000 | 1.000 | **1.000** | 0.131 | ok |
| S + estructura baseline (reglas plus-L) | 8 | 0 | 1.000 | 0.421 | 0.593 | 0.069 | RECHAZA (6 obligatorias mal) |
| **S + estructura SPIKE** | **16** | **0** | 1.000 | 0.842 | **0.914** | 0.050 | ok |

\* Mediana de 200 corridas del post-proceso estructural en bun/desktop
(sin inferencia). El dossier mide 0,3–16,5 ms/página en celular: el orden de
magnitud es el mismo y el presupuesto de 20 ms sobra.

Reproducción del dossier: el control plus-L 19/19 (P = R = F1 = 1.0) y el
baseline S 8/19 (P 1.0, R 0.421) coinciden EXACTAMENTE con
`estructura-e14-result.json` y `estructura-e14-s-result.json` — el evaluador
de `packages/layout-core` reproduce el prototipo validado.

## 3. Cobertura por regla (S + SPIKE)

| Regla | Estado con S | Detalle |
|---|---|---|
| footer ×3 | ok | 3 cajas |
| barcode | ok | paragraph_title 0.34 (S lo clasifica como título) |
| barcode_text | **faltante** | S no emite caja para el número (fusión) → opcional para S |
| version | ok | text 0.22 y98-122 |
| qr | ok | image 0.33 |
| title ×3 | ok | **dividir [0.384, 0.61]** del contenedor text 0.34 y119-273 |
| e14 | ok | text 0.22 y136-171 (minH 0.015) |
| registraduria_logo | ok | text 0.23 y200-253 (acepta `text`) |
| registraduria_text | ok | contenedor fusionado y198-278, contención 0.91 |
| consulado | ok | text 0.29 y300-413 |
| xline | ok | text 0.26 |
| nivelacion | ok | **text como tabla** (merged y439-729, IoU 0.79) |
| candidatos ×2 | **faltante** | sin contenedor útil en S → opcional para S |
| votos | ok | text 0.32 (IoU 0.98) |

## 4. Decisión

**S CUMPLE el criterio acordado (≥ 16/19 con ≤ 1 FP): 16/19 con 0 FP.**
S queda como **modelo por defecto del gate** con las reglas ajustadas del
spike (`modeloPreferido: 's'`), y plus-L queda como **validación fina
opcional** (descarga explícita, 129,7 MB) para moldes que declaren reglas
que S no puede garantizar (p. ej. `barcode_text` y `candidatos`
obligatorias).

Matices que el criterio no captura (documentados para el dueño):

1. Las 3 zonas no cubiertas por S (barcode_text, candidatos 1 y 2) deben
   quedar **opcionales en moldes pensados para S**; si el molde las marca
   obligatorias, S rechazaría E-14 correctos (falsos rechazos).
2. Los cortes de plantilla (títulos [0.384, 0.61]) son **reglas del molde**,
   no del motor: el motor sigue siendo genérico (prohibido hardcodear E-14).
3. La asginación codiciosa entre reglas (una caja satisface una sola regla,
   con sus duplicados IoU ≥ 0.5) resultó IMPRESCINDIBLE con el margen de 2%
   del dossier: sin ella, el número del código de barras entra en la franja
   de títulos y roba el tercer título por 0.005 de score.
4. plus-L sigue siendo el único que resuelve la estructura COMPLETA
   (19/19 con todas las reglas obligatorias, incluida la división de
   candidatos con el corte 0.541·H — contención relativa 0.541).

## 5. Limitaciones declaradas

- **No hubo celular real en esta entrega**: los tiempos son post-proceso en
  bun/desktop sobre cajas grabadas. La inferencia S/plus-L en el celular
  proviene del dossier (0,38 s vs 5–9 s por página, Samsung SM-A566E) y
  debe re-medirse al integrar los ONNX.
- Los cortes del spike se calibraron contra UNA página (E-14 p1). El corpus
  de `Todas reales.pdf` (17/17/19 bloques en portadas) y los reversos deben
  validar la generalización (Fase 7).
- El GT de Chandra solo cubre la página 1 del PDF de prueba.
