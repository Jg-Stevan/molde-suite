# AGENTS.md — packages/scanner-core

## Papel del paquete

`@molde-suite/scanner-core` es la **fuente compartida** de Molde Suite: el
contrato del molde `.json`, el motor universal v3 de evaluación, y las
primitivas de imagen/OCR/calidad/hash. Studio (autoria) y Tamiz (campo) lo
consumen por `workspace:*`. Sin React, sin Next, sin zustand: lógica pura o
canvas/WebCrypto estándar.

## API pública (exports map, la ÚNICA frontera)

Los consumidores solo pueden importar por subpath (el lint de las apps bloquea
`@molde-suite/scanner-core/src/*`):

| Subpath | Contenido |
|---|---|
| `./contract` | Contrato del molde: `esMoldeUniversal`, `erroresMolde`, `erroresContrato`, `MOLDE_UNIVERSAL_VERSION`, `CLAVES_TOP_LEVEL` |
| `./contract/sobre` | Sobre con checksum: `crearSobreMolde`, `verificarSobreMolde`, `esSobreConMolde`, `checksumDeMolde` |
| `./dominio/types` · `./dominio/bridge` · `./dominio/clasificador` | Tipos del documento (Acta), puente de análisis, clasificador E-14 |
| `./core/types` · `./core/image-processor` · `./core/ocr` | Quad/filtros/calidad, procesado y warp, validación de texto OCR |
| `./core/calidad` · `./core/canvas-imagen` · `./core/hash` | Scoring de calidad, primitivas de canvas (dataURL, grises, contraste p5-p95), SHA-256 |
| `./molde/universal-types` · `./molde/universal-engine` | MoldeUniversal + motor de evaluación v3 |
| `./molde/ocr-tipos` · `./molde/ocr-mapeo` | Proveedor OCR inyectable + mapeo compartido de Tesseract |
| `./molde/imageproc` · `./molde/tabla-detect` · `./molde/tabla-imagen` · `./molde/homografia` · `./molde/marca` | Primitivas de visión (retícula, deskew, marcas) |
| `./obs-base/breadcrumbs` | Trazas ligeras de breadcrumbs |

## Flujo de datos del contrato

```
Studio (EditorTab) ──crearSobreMolde──▶ .molde.json {sobre+checksum}
                                              │
Tamiz (molde/importar) ──verificarSobreMolde──▶ esMoldeUniversal/erroresContrato
                                              │
                              registry/almacen (host Tamiz)
                                              │
                    universal-engine + proveedor OCR inyectado ──▶ veredicto
```

- El motor NO sabe de dónde viene el texto: cada app registra su proveedor con
  `configurarProveedorOcr({ ocrLines, ocrTextoUnico })` (worker propio).
- El sobre con checksum es protocolo byte a byte: `JSON.stringify(molde)` +
  SHA-256. NO cambies la serialización sin migración de sobres existentes.

## Reglas de extensión

1. **Nueva primitiva compartida**: entra aquí solo si Studio y Tamiz la usan
   (o lo harán de inmediato). La política de producto se queda en la app.
2. **Cambio del contrato `.json`**: aditivo primero (v3.x retrocompatible),
   con fixtures golden actualizadas en `src/contract/__fixtures__/` y
   `MOLDE-SPEC.md` + `TEMPLATES.md` al día. Romper la retrocompatibilidad
   exige migración explícita y aprobación del dueño.
3. **Dependencias**: cero dependencias nuevas sin confirmar. El paquete corre
   como fuente TS directa (sin build): cada app lo compila con su tsconfig.
4. **Invariantes**: prohibido importar de `apps/*` o de la raíz; prohibido
   acoplarse a DOM específico de una app (canvas/WebCrypto estándar sí).

## Verificación

```bash
bun test          # en este directorio: tests golden del contrato (fixtures reales)
bun run agent:map # desde la raíz, para dejar .agent/repo-map.md al día
```
