# AGENTS.md — reglas y contexto para agentes de IA

## Objetivo del proyecto (léelo antes que nada)

Molde Suite es una **plataforma genérica de validación documental**, no una app
de actas E-14 ni de un formulario concreto:

- Un **molde** (`.json`) declara los **requisitos de validez** de un tipo de
  documento: datos obligatorios y opcionales, dónde están (anclas/zonas), cómo
  se reconocen (patrones, tipo, HTR), qué reglas estructurales de layout debe
  cumplir y qué validaciones semánticas/aritméticas aplican.
- **Molde Studio** crea y calibra moldes visualmente sobre documentos de
  referencia. **Tamiz** aplica el molde en campo: captura, detecta/endereza,
  hace OCR + layout y decide si el documento **cumple los requisitos**
  (ÓPTIMA / ADVERTENCIA / RECHAZADA), mostrando exactamente qué falta.
- El motor (captura, warp, calidad, OCR, layout ONNX, gate) es **agnóstico al
  tipo de documento**. Cambiar de documento = cambiar de molde, no de motor.
- Todo es **offline-first**: sin backend propio, sin cuentas, sin nube y sin
  subir documentos, fotos ni moldes.
- El **E-14 es el banco de pruebas** del sistema: su complejidad (multipágina,
  manuscritos, firmas, aritmética, 28 reglas de layout) calibra y estresa el
  motor. No es el alcance del producto.
- En este repo, «entrenar» significa **calibrar moldes**, nunca reentrenar
  modelos.

## Flujo entre las apps

```
Molde Studio (editor + calibración) ──molde .json──▶ Tamiz (captura →
análisis → validación contra el molde → revisión → historial)
```

El molde es el contrato y la **especificación de validez** del documento. Si un
documento nuevo no pasa, primero se corrige el molde; el motor solo cambia si
falla la mecánica (detección, OCR, layout).

## Restricciones duras (no reabrir)

- **Modelos stock**: prohibido reentrenar, cuantizar, recortar o modificar los
  ONNX. `PP-DocLayout-S` es el candidato principal; plus-L es opcional.
- **Local y offline**: prohibido enviar documentos, fotos o moldes a
  servidores, y prohibido añadir backend, login, multiusuario o sincronización
  en la nube.
- **Nada de datos pesados/sensibles al repo**: nunca commitear ONNX, PDFs,
  fotos de documentos ni bytes de modelos. Ver `.gitignore` (`*.onnx`,
  `docs/investigacion/**/previews/`).
- **Push a `main` solo con autorización explícita del dueño.** El flujo por
  defecto es rama + PR.
- **No romper el contrato del molde**: cualquier cambio de esquema debe
  actualizar `MOLDE-SPEC.md`, `TEMPLATES.md` y las lecciones afectadas.

## Antes y después de trabajar

1. Antes de crear o modificar un molde: lee `MOLDE-SPEC.md`.
2. Antes de probar un documento: busca en `lessons/` por tipo de documento.
3. Después de cada prueba real: registra una ficha con `lessons/TEMPLATE.md` y
   haz commit. Nunca subas una lección sin causa raíz verificable.
4. `TEMPLATES.md` es el índice de plantillas validadas y se regenera desde las
   lecciones con `resultado: exitoso`.
5. Molde único del repo hoy: `apps/molde-studio/templates/e14/molde-e14.json`
   (cuerpo calibrado + bloque `layout` v1 con 28 reglas). El E-14 es el caso de
   referencia; los documentos nuevos se añaden como moldes adicionales, no
   reemplazan este banco de pruebas.
