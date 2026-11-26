# Moldes universales v3 — biblioteca descargable de Tamiz

Aquí viven los `.molde.json` de referencia para **importar desde Tamiz → Panel
MOLDES → "IMPORTAR ARCHIVO (.molde.json / .json)"**. El modo genérico se retiró
(decisión de producto, ver `PLAN-ELIMINACION-MODO-GENERICO.md`): todo documento
se valida ahora por el enrutamiento universal del flujo E-14, que consume la
biblioteca importada. Estos archivos son la fuente oficial para poblarla.

| Archivo | Versión | Campos | Nota |
| --- | --- | --- | --- |
| `comprobante_entrega.molde.json` | **1.3.1** | 10 (6 obligatorios) | 1.3.1 (auditoría con variantes, C1/C2): umbral `firma_comprador` 0.006→0.0035 y patrón `numero_operacion` acepta la confusión I↔O del OCR (`[IO]P-AAAA-NNNNNN`); regresión 12/12 (VAR 1-6) |
| `recibo_pago.molde.json` | **1.3.1** | 12 (11 obligatorios) | 1.3.1 (auditoría con variantes, C3): ancla `numero_recibo` vuelve a `Recibo` (el OCR lee «N.º» como «N.9») y zona recalibrada x 0.134→0.103; regresión 12/12 (VAR 1-6) |
| `e22_resolucion.molde.json` | 1.2.0 | — | Pendiente recalibración con variantes propias |
| `e24_cuadro.molde.json` | 1.2.0 | — | Pendiente recalibración con variantes propias |
| `e26_acta_parcial.molde.json` | 1.2.0 | 6 páginas | Pendiente recalibración con variantes propias |
| `e14_acta.molde.json` | 3.0.0 | 21, 2 páginas | Acta E-14 Exterior (Cónsul/Embajador · Transmisión) |
| `recibo_real.molde.json` | 1.0.0 | 12 (11 obligatorios) | Recibo de pago REAL (fotos 2026-11-25). UN molde para las variantes A/B/C: comparten la misma plantilla impresa y solo cambia el relleno, así que no son discriminables por anclas. Los campos de relleno variable van `htr: true`; el overlay pinta verde/rojo por tinta medida (`tinta`, v1.5.1) |
| `comprobante_real.molde.json` | 1.0.0 | 10 (7 obligatorios) | Comprobante de entrega REAL (fotos 2026-11-25). Misma regla que `recibo_real`: unión de `htr`/`obligatorio` de las tres variantes y color por tinta, no por lectura |

> **`variantes/` (NO publicar ni importar por defecto):** los 6 moldes
> `*_a_real / *_b_real / *_c_real` quedaron ahí como respaldo de la calibración
> por variante. Medido en el A56 (2026-11-26): las variantes A/B/C de cada
> familia empatan en ratio de anclas (mismo papel impreso) y el router elegía
> a ciegas la primera de la biblioteca; además las zonas `htr` calibradas sobre
> C capturaban etiquetas impresas y producían lecturas basura en B (formulario
> en blanco). Por eso se consolidó a un molde por familia con `htr` en la unión
> de campos manuscritos y el semáforo por tinta. Importarlos juntos reintroduce
> el empate: si se usan, que sea uno solo y como molde ACTIVO explícito.

Las mismas plantillas están sembradas en **Molde Studio** (biblioteca, v1.3.1
con `paginasRef`); si se calibra desde el Studio, el JSON exportado entra en
Tamiz por el mismo camino y sobrevive en la biblioteca (IndexedDB).

> **Nota v1.3.1:** la corrección C4 (`firma_dudosa` honesta en
> `evaluarCampo`) vive en el motor `@molde-suite/scanner-core` empaquetado en
> cada app — NO requiere re-importar estos JSON. C5 (transporte PNG en el
> deskew del Studio) también es código. Solo estos dos JSON cambian respecto
> a v1.3.0: si ya importaste la biblioteca antes de esta fecha, vuelve a
> importar `comprobante_entrega` y `recibo_pago` (o borra los moldes v1.3.0
> del Panel MOLDES y reimporta) para que el enrutamiento use los umbrales y
> anclas recalibrados.

URL pública de descarga (después del deploy a Pages):
`https://jg-stevan.github.io/molde-suite/tamiz/moldes/<archivo>.molde.json`
