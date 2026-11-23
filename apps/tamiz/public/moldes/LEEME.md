# Moldes universales v3 — biblioteca descargable de Tamiz

Aquí viven los `.molde.json` de referencia para **importar desde Tamiz → Panel
MOLDES → "IMPORTAR ARCHIVO (.molde.json / .json)"**. El modo genérico se retiró
(decisión de producto, ver `PLAN-ELIMINACION-MODO-GENERICO.md`): todo documento
se valida ahora por el enrutamiento universal del flujo E-14, que consume la
biblioteca importada. Estos archivos son la fuente oficial para poblarla.

| Archivo | Versión | Campos | Nota |
| --- | --- | --- | --- |
| `comprobante_entrega.molde.json` | **1.3.0** | 10 (6 obligatorios) | Recalibrado contra la plantilla HTML vigente; regresión 12/12 (VAR 1-6) |
| `recibo_pago.molde.json` | **1.3.0** | 12 (11 obligatorios) | Recalibrado contra la plantilla HTML vigente; regresión 12/12 (VAR 1-6) |
| `e22_resolucion.molde.json` | 1.2.0 | — | Pendiente recalibración con variantes propias |
| `e24_cuadro.molde.json` | 1.2.0 | — | Pendiente recalibración con variantes propias |
| `e26_acta_parcial.molde.json` | 1.2.0 | 6 páginas | Pendiente recalibración con variantes propias |
| `e14_acta.molde.json` | 3.0.0 | 21, 2 páginas | Acta E-14 Exterior (Cónsul/Embajador · Transmisión) |

Las mismas plantillas están sembradas en **Molde Studio** (biblioteca, v1.3.0
con `paginasRef`); si se calibra desde el Studio, el JSON exportado entra en
Tamiz por el mismo camino y sobrevive en la biblioteca (IndexedDB).

URL pública de descarga (después del deploy a Pages):
`https://jg-stevan.github.io/molde-suite/tamiz/moldes/<archivo>.molde.json`
