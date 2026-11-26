# REPORTE-AGENTE-C — molde-suite (2026-11-27)

> Plan ejecutado: `PLAN-AGENTE-V6-PRIVACIDAD-Y-PRUEBA-REC-A-2026-11-26.md` ·
> Base: `main` `b4f44c5` · Rama: `agent-c/v6-privacidad-prueba-rec-a` ·
> Commits: `c1502ce` (T1 privacidad) · `62b3e09` (T3 paridad multipágina) ·
> docs (T4). Objetivo: dejar el GO PLENO a A56.

## 1. Estado por tarea (hecha / parcial / no hecha — UNA línea de evidencia cada una)

| Tarea | Estado | Evidencia |
|---|---|---|
| **T1** privacidad V6 (Opción A) | **HECHA** | `git ls-files` sin NINGUNA imagen/JSON de documento real (check §1.3 = 31 coincidencias TODAS justificadas una a una en §3); 200 archivos fuera del índice, en disco (banco A56 usable); commit `c1502ce`; saneo de datos personales en `test-faro-relacional.ts` |
| **T2** prueba aceptación REC-A (C1-C5) | **HECHA con contingencia C6** | Matriz §4: C2/C3/C4/C5 en verde; C1 llega a veredicto del molde real REC-A enrutado (10/12, RECHAZADA honesta por firmas) — la ÓPTIMA con la foto real queda bloqueada por calidad de la toma (causa por campo documentada, §4-C6); el camino positivo ÓPTIMA→ENVIADO AUTOMÁTICAMENTE demostrado en navegador con el banco SIM (como §7 del cierre) |
| **T3** matiz V5 multipágina | **HECHA** | `procedeArchivadoAutomatico(status)` puro + guard en el lote fallido + reúso en una página (paridad estructural); +3 tests; tamiz 135/135; commit `62b3e09` |
| **T4** docs y cierre | **HECHA** | Este reporte + `CAMBIOS.md` + lección P13 (`lessons/recibo_pago/2026-11-27-gitignore-no-desrastrea.md` + INDEX) — PR/merge pendiente del dueño (sin credenciales de push en este entorno) |

## 2. Comandos ejecutados y resultado

| Comando | Resultado |
|---|---|
| `git clone https://github.com/Jg-Stevan/molde-suite` → `git rev-parse HEAD` | `b4f44c5` exacto (base del plan) |
| `git ls-files \| grep -iE '\.(png\|jpg\|jpeg\|webp)$'` (T1.1) | 157 imágenes; clasificación completa en §3 |
| `git ls-files -z \| xargs -0 grep -l 20261123` + marcadores (`REC-2026-0157`, DNIs, CIF, empresas, IBAN) | 43 archivos de contenido real-derived **que el diagnóstico §8 NO listaba** (13 JSON de métricas + 23 webp-* + 11 arneses) + 2 archivos de código con datos personales embebidos (`herramientas/informe-calibracion.json`, `apps/molde-studio/scripts/test-faro-relacional.ts`) |
| `git rm -r --cached …` (13 grupos) + `git rm --cached …` | **200 archivos retirados del índice, intactos en disco** |
| `git ls-files \| grep -cE '(reales-\|mra-\|a56-\|20261123\|recorte-app\|webp-app\|pantalla-)'` (T1.3) | **31** — TODAS sintéticas/genéricas justificadas una a una (§3) |
| `ls scripts/resultados/reales-recorte \| wc -l` / `reales-procesado` / `a56-*.png` | **14 / 4 / 73** — disco intacto ✓ |
| `git check-ignore dev-fixtures/rec-a/*.jpg` | `.gitignore:92 /dev-fixtures/` — banco de prueba NO versionable ✓ |
| `cd apps/tamiz && bun run preparar && bun run dev` | :3100 HTTP 200 (assets 26.9 MB + vendor + 4 workers) |
| `bun test` packages/scanner-core | **82 pass / 0 fail** (233 expect) |
| `bun test` apps/tamiz | **135 pass / 0 fail** (374 expect) = 132 + 3 nuevos T3 |
| `tsc --noEmit` tamiz | limpio |
| `tsc --noEmit` scanner-core (bunx) | TS2580 `process` en `dominio/entorno.ts` — **preexistente e idéntico en main puro** `b4f44c5` (verificado con worktree; no introducido por la rama) |
| `eslint .` tamiz | limpio |
| `BUILD_STATIC=1 bun run build` tamiz | exit 0 — export estático `/` y `/_not-found` |
| Verificación en navegador (PC 1280×800 y móvil 390×844) | Matriz §4 completa |

## 3. T1 — clasificación exacta y lista de retirados (200)

**Retirados del índice — derivados de documentos reales (permanecen en disco):**

| Grupo | Cant. | Motivo |
|---|---:|---|
| `scripts/resultados/reales-recorte/*.jpg` | 14 | recortes de fotos reales `20261123_*` (diagnóstico §8) |
| `scripts/resultados/reales-procesado/*.png` | 4 | procesadas B/N de las mismas |
| `scripts/resultados/reales-00-inicio.png`, `reales-hoja.png` | 2 | patrón `reales-*` |
| `scripts/resultados/mra-*.png` | 21 | capturas de dispositivo real |
| `scripts/resultados/a56-*.png` | 73 | banco A56 (incluye veredictos del app con el recibo real visible) |
| `scripts/resultados/moldes-reales-a56-*.png` | 1 | captura de inicio del banco real |
| `a56-app-reales-*.json` + `moldes-reales-a56-*.json` + `reales-procesado-*.json` + `reales-recorte-*.json` | 21 | lecturas/metadata de sesiones reales (17 del diagnóstico + 4 `reales-*.json` adicionales) |
| `a56-app-…356Z.json`, `cpu-worker-*.json`, `encode-*.json`, `encode-bw-*.json`, `perfil-a13-*.json` | 14 | JSON de métricas cuyo CONTENIDO referencia `20261123_*` (auditoría de contenido §1.1 — no listados en el diagnóstico) |
| `webp-ab-*` (2 json + 1 png + 1 webp) | 4 | A/B sobre foto real `20261123_201944` |
| `webp-app-*` (10 img + 9 json) | 19 | sesiones del experimento webp sobre fotos reales (JSONs referencian `20261123`) |
| `recorte-app-*.png` + `recorte-final-*.png` | 12 | recortes con timestamps reales `213831`/`214221` en el nombre |
| `pantalla-actual-usuario.png`, `pantalla-tras-reload.png` | 2 | capturas de pantalla del operador (conservador) |
| `herramientas/informe-calibracion.json` | 1 | **GENERADO** por `verificar_calibracion.py` a partir de documentos reales; contiene n° de recibo, DNI y nombre reales |
| `scripts/entrega/*.mjs` (11 con refs `20261123` + `verificar-moldes-reales-a56.mjs`) | 12 | arneses que SOLO existen para servir/procesar fotos reales; inútiles en un clon fresco (las fotos jamás se versionan) |
| **TOTAL** | **200** | 33.712 líneas fuera del índice |

**Sanear (mantenido en el repo):**
- `apps/molde-studio/scripts/test-faro-relacional.ts` — fixture HTML del test
  `faro-relacional` había copiado **nombres, DNIs, CIF y empresas del recibo
  real**. Reemplazados por valores sintéticos (María García Pons /
  Juan Pérez Soto / Suministros Alfa S.L. / DNIs y CIF ficticios). Hallazgo
  V6 fuera del inventario de imágenes/JSON del diagnóstico.

**`.gitignore` ampliado (patrones anclados/explícitos — lección FIX F2):**
`/dev-fixtures/` (banco REC-A), `/herramientas/informe-calibracion.json`
(generado), y los 12 arneses de `scripts/entrega/`. `scripts/resultados/` ya
estaba cubierto como directorio (no se duplican patrones).

**Quedan en el índice — justificación una a una del check §1.3 (31 coincidencias):**
- 26 JSONs de sesiones A56 **de métricas puras** (`a56-editor-*` ×4,
  `a56-importacion-*` ×8, `a56-velocidad-*` ×12, `a56-warp-*` ×2): claves
  verificadas por parseo completo (cdp/medidoEn/pasos/filas/flags/fixture/
  segundos/veredicto) — sin contenido de documento ni datos personales; cada
  uno además pasó el grep de marcadores (n° de recibo, DNIs, CIF, IBAN,
  nombres) con 0 coincidencias.
- `diag-a56-hit.json`: diagnóstico de UI/animaciones (viewport/estilos/
  animaciones), sin documento.
- 5 arneses genéricos A56 sin referencias a fotos reales:
  `a56-comun.mjs`, `captura-a56-cdp.mjs`, `diag-a56-hit.mjs`,
  `verificar-a56-editor.mjs`, `generar-moldes-reales-variantes.py`
  (este último y `generar-moldes-reales.py` solo mencionan la FECHA de
  calibración en comentarios; no leen fotos).
- Las 57 imágenes restantes en `git ls-files` son todas sintéticas:
  plantillas de Studio (`actas-e14`, `templates/e14`), catálogo
  `moldes-genericos` (16), icono del app, 8 fixtures SIM del banco y 28
  capturas de `verificacion-agente-b/` — **SIM confirmado visualmente**
  (muestra: `02-pc-optima-auto-guardado.png` muestra la E-14 sintética con
  «ENVIADO AUTOMÁTICAMENTE»).
- Nota menor: 2 lecciones (`lessons/recibo_pago/2026-11-26-*.md`) citan el
  n° de recibo real `REC-2026-0157` (sin nombres/DNI/CIF/IBAN). Se conservan
  por trazabilidad; el dueño puede genericizarlas si prefiere.
- **NO** se ejecutó reescritura de historial (Opción B) — sin orden explícita
  del dueño (los blobs antiguos siguen en el historial remoto hasta
  `git filter-repo` + force-push).

## 4. T2 — matriz REC-A C1-C5 (fotos reales, LOCAL, nada versionado)

**Preparación:** fotos copiadas a `dev-fixtures/rec-a/` (gitignored, verificado
con `git check-ignore`): `CASO-BUENO-214221.jpg` (REC-2026-0157, 2 firmas) y
`CASO-SIN-FIRMA-213831.jpg` (1 firma puesta, 1 caja vacía). Variantes
erecta/mejor-toma generadas localmente para la contingencia C6. Molde activo:
el del banco para el papel real, `public/moldes/variantes/recibo_a_real.molde.json`
(«Recibo de pago — A (impreso)»: 12 campos, firmas tipo `firma` obligatorias,
datos imprenta con patrón). Evidencia: capturas en
`dev-fixtures/rec-a/capturas/` (local).

| # | Caso | Resultado | Veredicto |
|---|---|---|---|
| **C1** | La buena (`214221`, 2 firmas) | 3 corridas documentadas: (a) molde SIM `recibo_pago` → EN_REVISION_HUMANA «CLASIFICACIÓN PENDIENTE» (zonas del papel sintético no calibran sobre el papel real, score 58 < umbral de ruta 65 → no enruta — comportamiento honesto); (b) molde REC-A real → **enruta** (score 66.7 ≥ 65): RECHAZADA «FALTA FECHA / FECHA DE PAGO / FIRMA EMISOR / FIRMA PAGADOR»; (c) **molde REC-A ajustado en local** (§2.1-3, sin versionar: `limpiar_valor` anti-subrayado en las 2 fechas + zonas de firma que cubren caja completa) → **10/12 OK, score 8.3/10 (83%), RECHAZADA «FALTA FIRMA EMISOR / FIRMA PAGADOR»** — sin auto-guardado (correcto: RECHAZADA) | **C6** |
| **C1+** | Camino positivo ÓPTIMA→ENVIADA | Banco SIM (E-14 nítida, 1 página, sin molde): **8.9/10 ÓPTIMA → «✓ ENVIADO AUTOMÁTICAMENTE» + «SEGUIR ESCANEANDO» SIN TOCAR NADA**; HISTORIAL: 1 fila «✓ OK · DOCUMENTO PROCESADO Y GUARDADO». Y con el recibo sintético `recibo-datos-nuevos` (firmas vacías por diseño) + molde SIM: RECHAZADA «FALTA FIRMA…» — la regla nunca auto-envía un documento sin firmas | ✓ |
| **C2** | Sin firma completa (`213831`) | **11/12 OK — «Firma pagador: SIN LECTURA»** (caja vacía) → **RECHAZADA «FALTA FIRMA PAGADOR»**, sin banner de envío; HISTORIAL: fila «**CAPTURA ARCHIVADA · RECHAZADA — … CAMPOS OBLIGATORIOS FALTANTES: FIRMA PAGADOR**» con «REQUIERE NUEVA TOMA» | ✓ |
| **C3** | Kill-switch `{"autoGuardado": false}` | ÓPTIMA 8.9/10 con veredicto intacto y **SIN banner ENVIADA** — flujo manual restaurado; flag corrupto apaga (conservador) | ✓ |
| **C4** | 2 rechazos consecutivos | Al 2° rechazo aparece **«GUARDAR CRUDA (SIN VERIFICAR)»** ámbar. Matiz documentado (comportamiento por diseño, sin «arreglar» sin orden): el botón solo se DESHABILITA sin tinta (`hasTinta = campos.some(tinta===true)` — «GUARDAR CRUDA — SIN TINTA DETECTADA»); en C2 hay tinta (firma presente + texto) → habilitado. **El lápiz de §5 NO aparece en campos firma** (manuscritos no editables: «CONFIRMAR» sin ✎; ✎ solo en campos de texto) | ✓ |
| **C5** | Móvil 390×844 | C1+ (positivo) y C2 (rechazo real) con el MISMO comportamiento; nav inferior correcta; **`scrollX=0`, `scrollWidth==clientWidth` (sin scroll horizontal)** en ambos | ✓ |

**Causa raíz de C1 (contingencia C6, documentada por campo con el log del
motor — NO es bug del app ni de la REGLA DE ORO):**
1. La foto `214221` es blanda (baja nitidez) y el borde inferior curvado: el
   OCR (RapidOCR) no produce la etiqueta «Firma» del recuadro derecho → el
   ancla de `Firma pagador` cae `ancla_no_encontrada` → `fallback_no_verificado`.
   La izquierda matchea textual pero bypass de etiqueta ambigua
   (`ancla_solo_textual`) → endurecimiento honesto `ancla_sin_geometria`
   (anti-falso-positivo documentado en el motor: «dos firmas ok conf 0.97 con
   forma_sin_caja» era el bug de fondo).
2. La geometría de la caja de firma no resuelve (`forma_borrosa` +
   `forma_sin_caja`): la TINTA sí se midió (ratio 0.060 y 0.043 ≥ piso 0.001),
   pero el veredicto de un campo de tinta es GEOMETRÍA (caja+rúbrica) — el
   motor jamás la inventa.
3. Remedios probados desde el lado de la ENTRADA (sin tocar el motor): foto
   erecta (EXIF aplicado) → mejor resultado (66.7); recorte de papel propio
   (OpenCV) y realce (CLAHE+sharpen) → EMPEORAN el OCR (0/12 y 50%) — el
   pipeline del propio app ya recorta el papel. **Conclusión C6: repetir con
   toma real mejorada** (más luz, papel plano, recuadros de firma nítidos).
   Ajuste local del molde REC-A (fechas con `limpiar_valor`, zonas de firma
   h 0.062→0.108) quedó en `dev-fixtures/rec-a/molde-rec-a-local.json` —
   los `limpiar_valor` sí deben incorporarse al molde versionado cuando el
   dueño apruebe (los datos de ancla/zona son del papel, sin fotos).
4. El molde SIM `recibo_pago` NO calibra sobre el papel real REC-A (zonas
   del catálogo sintético) → usar SIEMPRE el molde del banco
   `variantes/recibo_a_real` para este papel.

## 5. T3 — paridad multipágina↔una página (matiz V5)

- **Antes:** el lote multipágina fallido archivaba la captura SIN condición
  (store/index.ts:363); el flujo de UNA página excluía EN_REVISION_HUMANA
  (índice :421). Hallazgo §7 del diagnóstico confirmado en el código.
- **Ahora:** predicado puro `procedeArchivadoAutomatico(status)` en
  `politica/auto-guardado.ts` (EN_REVISION_HUMANA → NO archiva;
  RECHAZADA/ADVERTENCIA → sí, doctrina «aceptar y guardar imágenes»),
  cableado en AMBOS flujos (paridad estructural por construcción), +3 tests
  (T3-a/T3-b/T3-c). Sin cambios de tipos ni de contrato del motor (aditivo).
- La corrida del lote E-14 con página 2 idéntica (simulación) dio RECHAZADA
  1/21 y la captura SÍ quedó archivada — coherente con el guard (RECHAZADA sí
  archiva evidencia).

## 6. `git diff --stat` contra main y SHA base

```
Base: main b4f44c5
Rama: agent-c/v6-privacidad-prueba-rec-a
c1502ce privacy(v6): retira del índice material de documentos reales (decisión §9-1)
62b3e09 fix(v5-t3): paridad multipágina↔una página — EN_REVISION_HUMANA fuera del archivado del lote fallido
(+ commit docs T4)

205 files changed, 97 insertions(+), 33712 deletions(-)  [tras T3]
(+ CAMBIOS.md, docs/REPORTE-AGENTE-C.md, lessons ×2 en T4)
```

## 7. Decisiones tomadas y supuestos

1. **D1 — retirar también los 12 arneses de `scripts/entrega/`** (fuera del
   mínimo literal del plan): son código que SOLO procesa fotos reales; en un
   clon fresco son inoperantes (las fotos jamás se versionan); conservador
   §1.1; reversibles desde el historial. Deja el check §1.3 sin excepciones.
2. **D2 — no duplicar patrones de `.gitignore`** para rutas bajo
   `scripts/resultados/` (el directorio entero ya está ignorado; lo trackeado
   salió con `rm --cached`). Solo se añaden los patrones que faltaban.
3. **D3 — sanear en vez de retirar** `test-faro-relacional.ts`: es código
   vivo del Studio; los literales reales (nombres/DNI/CIF/empresas) pasan a
   sintéticos con la misma estructura del test.
4. **D4 — retirar `herramientas/informe-calibracion.json`**: es artefacto
   GENERADO (lo escribe `verificar_calibracion.py:289`) con datos personales
   reales dentro; regenerable en local.
5. **D5 — molde REC-A ajustado SOLO en local** (`dev-fixtures/`): el plan
   marca T2 como solo-lectura del repo; la mejora de `limpiar_valor` (anti
   subrayado `_`/`|`) está lista para versionarse cuando el dueño apruebe.
6. **D6 — camino positivo C1 demostrado con el banco SIM** (E-14 nítida y
   recibo sintético sin firmas): la foto real buena no alcanza ÓPTIMA por
   calidad de toma (C6); la REGLA DE ORO se demuestra end-to-end sin tocar
   el motor ni inventar resultados.
7. Supuesto: `PLAN-VERIFICACION-POST-AGENTES-2026-11-26.md` no está
   versionado en el repo (documento local de la conversación de diagnóstico)
   — su checklist V6 queda cubierta por este reporte (§1/§3).

## 8. Limitaciones conocidas y riesgos

1. **Push/PR pendientes**: este entorno no tiene credenciales de GitHub (y la
   regla del plan es NO reutilizar el token expuesto — revocar/rotar, hallazgo
   #1 del diagnóstico). La rama `agent-c/v6-privacidad-prueba-rec-a` quedó
   lista en local para `git push -u origin agent-c/v6-privacidad-prueba-rec-a`
   + PR (T1+T3+T4).
2. **Los blobs antiguos siguen en el historial** (Opción A). Hasta que el
   dueño decida la Opción B (`git filter-repo` + force-push, rompe forks/
   clones), las fotos/JSON reales siguen alcanzables por SHA en el repo
   remoto. Las 2 fotos del dueño NUNCA estuvieron en el repo (solo sus
   derivados de banco); los DNIs/nombres aparecían en 2 archivos saneados y
   en JSONs retirados.
3. **C1 con la foto real no llega a ÓPTIMA** hasta tener una toma nítida
   (causa por campo en §4). No es defecto del app: el endurecimiento evita el
   falso positivo histórico. Guion de retoma: papel plano, luz lateral
   difusa, recuadros de firma completos y nítidos, foto recta.
4. El app en el navegador de la sandbox tarda 20-270 s por corrida OCR
   (WASM, sin GPU): la latencia de esta verificación no es la del teléfono
   (el banco A56 midió ≤10 s).
5. `PLAN-VERIFICACION-POST-AGENTES-2026-11-26.md` no versionado (ver D7/§7-7).
6. El token de GitHub expuesto en el chat del diagnóstico debe rotarlo el
   dueño (fuera de alcance del agente).

## 9. Criterio de cierre (GO PLENO a A56)

- [x] T1 aplicada y verificada — 0 imágenes/JSON de documentos reales en
      `git ls-files` (31 coincidencias restantes sintéticas/genéricas
      justificadas una a una en §3); disco intacto.
- [x] T2 con C1-C5 ejercitados y evidencia local (C1 con contingencia C6
      documentada por campo; positivo demostrado en navegador; C2/C3/C4/C5 en
      verde). Sin issues abiertas del app: no se detectó defecto del motor ni
      de la REGLA DE ORO — los veredictos honestos son el diseño.
- [x] T3 resuelta — guard + 3 tests + paridad estructural.
- [x] T4 completa — reporte + CAMBIOS + lección P13 + INDEX. (PR: pendiente
      de push por el dueño.)

Con esto, el repo queda listo para **A56 en el teléfono real** con: flags
F2/F1 OFF, `autoGuardado` ON, fotos SOLO en el dispositivo (nunca en el repo),
molde REC-A del banco (`variantes/recibo_a_real`) activo y el guion C1-C5
como prueba de campo.
