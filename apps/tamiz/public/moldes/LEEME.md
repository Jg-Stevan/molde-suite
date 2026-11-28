# Moldes universales v3 — biblioteca de Tamiz

Aquí viven los `.molde.json` de referencia. Desde 2026-11-27 **Tamiz los siembra
solo**: al primer escaneo, `src/lib/e14/molde/catalogo.ts` carga esta carpeta en
IndexedDB (ver "Siembra automática" abajo). Importar a mano por **Panel MOLDES →
"IMPORTAR ARCHIVO (.molde.json / .json)"** sigue siendo el camino para una
plantilla recalibrada o para `variantes/`. El modo genérico se retiró (decisión
de producto, ver `PLAN-ELIMINACION-MODO-GENERICO.md`): todo documento se valida
ahora por el enrutamiento universal del flujo E-14, que consume la biblioteca.

## Siembra automática (2026-11-27)

· Lista sembrada = `CATALOGO_NOMBRES` en `catalogo.ts`: las 8 plantillas de esta
carpeta. **`prueba_2paginas` y `variantes/` NO se siembran** (fixture y respaldo).
· Un `nombre` ya presente en la biblioteca **nunca se pisa**: el molde calibrado
por el operador gana sobre el empaquetado.
· La marca `localStorage tamiz.catalogoMoldes.v1` guarda `CATALOGO_VERSION`. Si
cambias un `.molde.json` aquí, **sube `CATALOGO_VERSION`** en `catalogo.ts` o la
app no re-siembra. Si sin red la siembra falla, la marca no se escribe y se
reintenta al escaneo siguiente.
· `public/sw.js` sirve `/moldes/` cache-first con `?v=<CATALOGO_VERSION>`; la
query es lo que impide que el offline devuelva una plantilla recalibrada vieja.
· Son plantillas, no datos: no salen del dispositivo ni a un servidor.

| Archivo | Versión | Campos | Nota |
| --- | --- | --- | --- |
| `comprobante_entrega.molde.json` | **1.4.0** | 10 (6 obligatorios) | 1.3.1 (auditoría con variantes, C1/C2): umbral `firma_comprador` 0.006→0.0035 y patrón `numero_operacion` acepta la confusión I↔O del OCR (`[IO]P-AAAA-NNNNNN`); regresión 12/12 (VAR 1-6) |
| `recibo_pago.molde.json` | **1.4.0** | 12 (11 obligatorios) | 1.3.1 (auditoría con variantes, C3): ancla `numero_recibo` vuelve a `Recibo` (el OCR lee «N.º» como «N.9») y zona recalibrada x 0.134→0.103; regresión 12/12 (VAR 1-6) |
| `e22_resolucion.molde.json` | 1.2.0 | 10 (9 obligatorios) | Pendiente recalibración con variantes propias |
| `e24_cuadro.molde.json` | 1.2.0 | 14 (14 obligatorios) | Pendiente recalibración con variantes propias |
| `e26_acta_parcial.molde.json` | 1.2.0 | 42 (38 obligatorios), 6 páginas | Pendiente recalibración con variantes propias |
| `e14_acta.molde.json` | 3.0.0 | 21 (8 obligatorios), 2 páginas | Acta E-14 Exterior (Cónsul/Embajador · Transmisión). Único molde `documento: acta_e14`: es el que le cede el veredicto al gate electoral |
| `recibo_real.molde.json` | 1.0.0 | 12 (11 obligatorios) | Recibo de pago REAL (fotos 2026-11-25). UN molde para las variantes A/B/C: comparten la misma plantilla impresa y solo cambia el relleno, así que no son discriminables por anclas. Los campos de relleno variable van `htr: true`; el overlay pinta verde/rojo por tinta medida (`tinta`, v1.5.1) |
| `comprobante_real.molde.json` | 1.0.0 | 10 (7 obligatorios) | Comprobante de entrega REAL (fotos 2026-11-25). Misma regla que `recibo_real`: unión de `htr`/`obligatorio` de las tres variantes y color por tinta, no por lectura |

> **Empate dentro de la misma familia (medido, no especulado):** `recibo_pago` y
> `recibo_real` declaran el mismo `documento` y comparten rótulos impresos, así
> que **empatan en ratio de anclas**. Con la siembra automática los dos están en
> la biblioteca, y `elegirCandidato` compara con `>` estricto: gana el primero de
> `candidatosDeSesion`, es decir **el molde ACTIVO si lo hay** (el operador
> desempata desde el Panel MOLDES). Sin molde activo, el orden es el de la
> biblioteca (más reciente primero) y la elección es a ciegas — el log
> `[molde] ratio de anclas por molde` lo hace visible. Si en campo el empate
> resulta nocivo, se retira `*_real` de `CATALOGO_NOMBRES` (sigue importable).

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
> deskew del Studio) también es código.
>
> **Recalibrar una plantilla ya sembrada (2026-11-27):** la siembra automática
> filtra POR NOMBRE, así que subir `CATALOGO_VERSION` no pisa lo que el operador
> ya tiene. Para forzar la versión nueva hay dos caminos: borrar la fila vieja en
> Panel MOLDES y escanear de nuevo, o importar el `.molde.json` a mano — la
> importación crea su propia fila y, como la biblioteca está ordenada de la más
> nueva a la más vieja, gana sobre la sembrada (también en `moldePorNombre`).

URL pública de descarga (después del deploy a Pages):
`https://jg-stevan.github.io/molde-suite/tamiz/moldes/<archivo>.molde.json`
