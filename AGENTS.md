# AGENTS.md — reglas y contexto para agentes de IA

## Objetivo del proyecto (léelo antes que nada)

Molde Suite es una **plataforma genérica de validación documental**, no una app
de actas E-14 ni de un formulario concreto:

- Un **molde** (`.json`) declara los **requisitos de validez** de un tipo de
  documento: datos obligatorios y opcionales, dónde están (anclas/zonas), cómo
  se reconocen (patrones, tipo, HTR), qué reglas estructurales de layout debe
  cumplir y qué validaciones semánticas/aritméticas aplican.
- **Molde Studio** crea y calibra moldes visualmente. **Tamiz** aplica el molde
  en campo: captura, detecta/endereza, hace OCR + layout y decide si el
  documento **cumple** (ÓPTIMA / ADVERTENCIA / RECHAZADA), mostrando qué falta.
- El motor (captura, warp, calidad, OCR, layout ONNX, gate) es **agnóstico al
  tipo de documento**. Cambiar de documento = cambiar de molde, no de motor.
- Todo es **offline-first**: sin backend propio, sin cuentas, sin nube y sin
  subir documentos, fotos ni moldes.
- El **E-14 es el banco de pruebas** del sistema (multipágina, manuscritos,
  firmas, aritmética, 28 reglas de layout). No es el alcance del producto.
- En este repo, «entrenar» significa **calibrar moldes**, nunca reentrenar
  modelos.

## Estructura del monorepo

| Workspace | Papel |
|---|---|
| `packages/scanner-core` | Contrato del molde + motor universal v3 + primitivas (imagen, OCR, calidad, hash). Fuente compartida Studio↔Tamiz |
| `packages/layout-core` | Evaluador de reglas estructurales de layout (PP-DocLayout, NMS, matcher) |
| `packages/dla-onnx` | Señales ONNX en navegador (casillas, layout, manuscrito); modelos por URL, nunca en el repo |
| `apps/molde-studio` | Editor + calibración visual de moldes (produce el `.molde.json`) |
| `apps/tamiz` | App de campo: captura → análisis → validación contra el molde |

Ver también `ARCHITECTURE.md` (flujo de datos), `.agent/repo-map.md` (mapa
determinista generado) y el `AGENTS.md` fractal de cada workspace.

## Comandos verificados (usa EXACTAMENTE estos)

```bash
bun install                    # desde la raíz (workspaces Bun)
bun run agent:map              # regenera .agent/repo-map.md (raíz)
cd packages/scanner-core && bun test            # tests golden del contrato
cd packages/layout-core  && bun test            # tests del evaluador layout
cd apps/tamiz      && bun run typecheck && bun run lint
cd apps/molde-studio && bun run typecheck && bun run lint
```

No hay `test`/`build` a nivel raíz: ejecuta por workspace. No inventes scripts:
revisa el `package.json` de cada workspace antes de llamar.

## Invariantes de arquitectura (no reabrir)

1. **Dependencias de workspaces**: `packages/*` NUNCA importa de `apps/*` ni
   de la raíz. `apps/*` consume los paquetes SOLO por sus subpaths públicos
   (`@molde-suite/scanner-core/...`), nunca rutas internas `src/**` — el lint
   (`no-restricted-imports`) lo bloquea en tamiz y studio.
2. **Contrato del molde**: fuente única en
   `packages/scanner-core/src/contract/` (`./contract` y `./contract/sobre`).
   Studio produce el sobre con checksum; Tamiz lo verifica. Cualquier cambio
   del esquema: actualiza `MOLDE-SPEC.md`, `TEMPLATES.md`, las guardas de
   `src/contract/` y añade/actualiza fixtures golden en `__fixtures__/`
   (`bun test` en scanner-core debe pasar).
3. **Capa host vs paquete**: zustand, IndexedDB, `window`/`navigator`,
   Next.js y la política de producto (watchdog, observabilidad) viven en la
   app. Al paquete solo entra lógica UI-agnóstica reutilizable por ambas apps.

## Restricciones duras (no reabrir)

- **Modelos stock**: prohibido reentrenar, cuantizar, recortar o modificar los
  ONNX. `PP-DocLayout-S` es el candidato principal; plus-L es opcional.
- **Local y offline**: prohibido enviar documentos, fotos o moldes a
  servidores, y prohibido añadir backend, login, multiusuario o sincronización
  en la nube.
- **Nada de datos pesados/sensibles al repo**: nunca commitear ONNX, PDFs,
  fotos de documentos ni bytes de modelos. Ver `.gitignore`.
- **Push a `main` solo con autorización explícita del dueño.** El flujo por
  defecto es rama + PR.
- **Sin dependencias nuevas** sin confirmación explícita del dueño.
- **No romper el contrato del molde** (ver invariante 2).

## Antes y después de trabajar

1. Antes de crear o modificar un molde: lee `MOLDE-SPEC.md`.
2. Antes de probar un documento: busca en `lessons/` por tipo de documento.
3. Después de cada prueba real: registra una ficha con `lessons/TEMPLATE.md` y
   haz commit. Nunca subas una lección sin causa raíz verificable.
4. `TEMPLATES.md` es el índice de plantillas validadas y se regenera desde las
   lecciones con `resultado: exitoso`.
5. Molde único calibrado de referencia: `moldes-finales/e14_acta.molde.json`
   (v3.0.0, 28 reglas de layout; el motor corre v3.2.0 — cambio aditivo).
6. Tras cambiar código de `packages/*`: corre `bun run agent:map` para dejar
   el mapa del repo al día y los tests de los paquetes afectados.
