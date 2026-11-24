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

### Visión de producto (texto del dueño — no reinterpretar)

> Totalmente claro: tu objetivo es construir un sistema autónomo de recepción y
> validación documental donde toda la lógica del negocio se configura una sola
> vez en plantillas, para que en la operación diaria el humano únicamente tenga
> que apuntar la cámara sobre la mesa.
>
> Lo que estás armando se divide en tres piezas que encajan con total coherencia:
>
> **Molde Studio (El cerebro configurador y laboratorio de estrés):** Es donde
> traduces la estructura de un documento físico a reglas deterministas que una
> máquina entiende sin adivinar. Ahí defines cuántas páginas tiene el formato,
> qué palabras únicas identifican cada página para poder ordenarlas solas, dónde
> van los datos y las firmas, cómo se respaldan los campos entre sí cuando alguno
> sale borroso (por ejemplo, apoyarse en otro dato del documento para no perder
> la lectura) y qué criterios hacen que el documento sea válido. Además,
> funciona como simulador para probar variaciones difíciles y garantizar que el
> sistema nunca rechace por error un documento válido y legible.
>
> **Tamiz (El operador automático en campo):** Es la herramienta ligera de
> captura con intervención humana mínima. El usuario solo apunta el documento
> sobre la mesa y Tamiz ejecuta toda la cadena en silencio: detecta la hoja,
> reconoce automáticamente a qué molde pertenece (recibo, factura, comprobante),
> organiza las páginas si el documento es multipágina, extrae los datos definidos
> y evalúa si cumple las reglas.
>
> **Filtro en vivo con retroalimentación visual:** Tal como lo planteas en el
> ejemplo de la entrega de un celular, Tamiz no solo escanea, sino que decide en
> el acto. Si el recibo tiene todos los datos y firmas requeridas, lo aprueba y
> lo guarda automáticamente; si falta una firma o un campo obligatorio, detiene
> el guardado y te señala directamente sobre la imagen qué campo faltó para
> corregirlo en el momento antes de que se vaya la persona.
>
> El objetivo de molde-suite es ser un ecosistema integral y offline-first para
> capturar, estructurar y verificar documentos físicos directamente en el
> navegador, combinando visión por computadora en tiempo real, diseño visual de
> plantillas y extracción híbrida (estructura clave-valor sobre OCR para texto
> impreso + detección visual de tinta para firmas, huellas y manuscritos).
>
> Dentro del monorepo, cada pieza cumple un rol específico hacia ese objetivo:
> **packages/scanner-core (El motor)** es el núcleo compartido de procesamiento:
> evalúa la calidad de cámara por frame, corrige perspectiva, ejecuta el OCR
> global y cruza la estructura lógica del documento —ubicando datos impresos por
> relación entre etiquetas y auditando trazos físicos (rúbricas, sellos o
> tachaduras) sin inventar valores cuando hay obstrucciones o recortes.
> **Molde Studio** es la interfaz web para crear plantillas documentales sin
> escribir código, declarar qué campos son fijos o variables, definir reglas de
> validación cruzada (como coherencia entre fechas) y verificar la extracción
> inspeccionando recortes visuales únicamente donde importa (firmas, huellas y
> manuscritos). **apps/tamiz** es la aplicación ligera orientada a dispositivos
> móviles que asiste el encuadre en vivo, dispara la captura automáticamente al
> detectar estabilidad y procesa los documentos en el dispositivo con mínima
> latencia y funcionamiento sin conexión.
>
> En pocas palabras, el repositorio busca transformar formatos físicos
> repetitivos (actas, recibos, formularios de control) en datos estructurados,
> validados y auditables en local, reemplazando plantillas rígidas basadas en
> coordenadas fijas por reglas estructurales tolerantes a recortes o
> inclinaciones reales de captura.

### Criterio de verificación autónoma (no negociable)

**Principio rector:** la verificación debe ser tan buena que **un documento con
todos los datos definidos y legibles NUNCA se rechaza**. Solo se detiene la
aprobación cuando un dato obligatorio o una firma **falta o no se entiende**; en
ese caso se entrega verificación humana con la evidencia del campo.

Reglas de obligado cumplimiento para cualquier cambio en motor, molde o UI:

1. **Orden de precedencia del veredicto:** `ok` (leído y dentro de reglas) →
   `requiere_revision` (no concluyente) → `no_encontrado` (obligatorio ausente).
   El veredicto global solo es negativo si el documento está incompleto o
   ilegible, nunca por geometría de captura.
2. **Prohibido el falso `ok`:** ningún campo se aprueba sin lectura verificada.
   Bandera de no-lectura (`fallback_no_verificado`, `ancla_no_encontrada`,
   `ocr_vacio`, `zona_vacia`, `lectura_degenerada`, `conf_baja`,
   `ancla_sin_geometria`) ⇒ nunca `ok`.
3. **Prohibido rechazar por coordenadas:** si el dato está presente en el OCR
   global, el motor debe resolverlo (etiqueta → valor) aunque la foto venga
   recortada, rotada o desplazada. La revisión se justifica por **contenido**
   (ilegible, ambiguo, ausente), no por desplazamiento.
4. **Toda revisión es explicable:** cada `requiere_revision`/`no_encontrado`
   lleva banderas y evidencia visual del campo, sin excepción.
5. **Definición de terminado de cualquier fase:** (a) 0 falsos `ok`;
   (b) 0 revisiones sobre documentos completos y legibles del banco de imágenes;
   (c) los números del banco se reproducen, no se transcriben.

El estado actual y las desviaciones conocidas se registran en
`lessons/recibo_pago/` y `scripts/resultados/README-VERIFICACION.md`; no se
reescriben aquí.

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
cd apps/tamiz      && bun run test && bun run typecheck && bun run lint
cd apps/molde-studio && bun run typecheck && bun run lint
# Build de studio (checkout fresco): ANTES corre `bun run db:generate` en
# apps/molde-studio — sin el cliente Prisma generado, `next build` falla al
# recolectar las rutas /api/* (Cannot find module '.prisma/client/default').
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
