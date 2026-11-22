# ADR-0001 — Campos aditivos en ReglaLayout y ubicación del contrato

Fecha: 2026-11-22 · Estado: aceptado (pendiente revisión del dueño) · Alcance: contrato del molde (v3.1.0)

## Contexto

El PLAN-AGENTE-LAYOUT §4.1 define `ReglaLayout` con: id, etiqueta, zona,
tolerancia, clases, minScore, minimo, maximo, obligatorio, campoId, dividir,
nota. El prototipo validado (docs/investigacion/pp-doclayout/estructura-e14.js)
necesita además restricciones que el contrato mínimo no expresa, y el repo ya
unificó los tipos del molde en `packages/scanner-core/molde/universal-types.ts`
(FASE 0 del blueprint DLA) ANTES de que el plan propusiera crear
`packages/molde-contract`.

## Decisión

1. **Ubicación del contrato**: la extensión `layout` vive en
   `packages/scanner-core/molde/universal-types.ts` (que Studio reexporta por
   su ruta histórica y Tamiz ya consume). NO se crea `packages/molde-contract`
   duplicando tipos: scanner-core YA es el paquete de contrato compartido de
   ambos apps (decisión D8/blueprint DLA del repo). El plan F1 se cumple en
   espíritu (un solo paquete de contrato + reexport retrocompatible) sin
   introducir un segundo paquete que habría que mantener sincronizado.

2. **Campos ADITIVOS en `ReglaLayout`** (todos opcionales, retrocompatibles):
   - `pagina?: number` (default 1): MoldeUniversal es multipágina; las reglas
     necesitan página. El plan omitió el campo.
   - `minW/maxW/minH/maxH?: number` (fracciones 0-1 de la página): el prototipo
     validado las usa en 8 de 14 reglas (barcode ≥0.3W, barcode_text alto
     ≤0.03H, títulos ≤0.04H, contenedor de candidatos ≥0.5W×0.25H...). Sin
     ellas, el E-14 validado no es expresable.
   - `estricto?: boolean` (default false): convierte los candidatos sobrantes
     (tras NMS interno) en estado 'sobrante'. Por defecto el evaluador IGNORA
     sobrantes y toma top-N por score — comportamiento del prototipo validado
     (19/19): las zonas de títulos contienen ruido extra que NO es fallo.

3. **Versionado**: `MOLDE_UNIVERSAL_VERSION` sube a `3.1.0`. Los moldes v3.0.0
   sin `layout` cargan y corren EXACTAMENTE igual (la validación de `layout`
   solo se aplica si el campo existe).

4. **Semántica de asignación entre reglas**: el evaluador consume cajas en
   orden de declaración (una caja satisface UNA regla; sus duplicados IoU ≥ 0.5
   también salen del pool). Con el margen de pertenencia de 2% del dossier es
   la única forma determinista de evitar que una caja satisfaga dos reglas
   (hallazgo del spike F0: el número del código de barras robaba el tercer
   título por 0.005 de score).

## Consecuencias

- Positivas: el E-14 validado es expresable 100% declarativamente; Studio y
  Tamiz comparten UNA definición; los moldes viejos no se tocan.
- Riesgos: el orden de declaración de reglas pasa a ser semántico (documentado
  en evaluar.ts y en la UI del asistente); `estricto` debe usarse con criterio
  (el default falso es el validado).
- Reversión: los campos son opcionales; eliminarlos no rompe moldes existentes.
