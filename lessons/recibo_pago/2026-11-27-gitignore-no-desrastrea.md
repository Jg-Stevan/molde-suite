id: "repo-privacidad-2026-11-27-gitignore-no-desrastrea"
plantilla: "infraestructura repo"
tipo_documento: "privacidad del repo PÚBLICO (material de documentos reales)"
condicion: "auditoría V6 (plan PLAN-AGENTE-V6-PRIVACIDAD-Y-PRUEBA-REC-A-2026-11-26) sobre main b4f44c5: 200 archivos de fotos/JSON derivados de documentos reales seguían EN el índice pese a existir un .gitignore que cubría scripts/resultados/"
herramientas_usadas: ["git ls-files (verificación §1.3)", "git log -S (timeline)", "git rm -r --cached", "auditoría de contenido con grep -lF (marcadores, sin volcar datos)"]
version_motor: "sin cambios de motor"
resultado: "causa raíz documentada + limpieza aplicada (commit c1502ce)"
campos_fallidos: []
metrica: { retirados: "200 archivos · 33.712 líneas fuera del índice", verificacion: "git ls-files → 0 coincidencias de material real; disco intacto (14/4/73 muestras)" }
---

## Problema observado

`scripts/resultados/` llevaba días en `.gitignore`, y aun así `git ls-files`
mostraba ~200 imágenes y JSON derivados de documentos reales (recortes de las
fotos `20261123_*`, banco A56 con el recibo real visible en pantalla, lecturas
OCR con nombres/DNI, un informe de calibración generado con datos personales).
El equipo creía el repo limpio porque LEÍA el `.gitignore`, no porque midiera
el índice.

## Causa raíz (timeline verificado con git log -S)

1. **2026-11-25 (`f681da6`, `6be1bce`, `8cc997f`)** — el material real entra al
   índice con `git add` explícito: TODAVÍA no existía la regla
   `scripts/resultados/` en `.gitignore`. El commit `8cc997f` estrenó la
   regla `apps/tamiz/public/dev-fixtures/` y su comentario, y en el MISMO
   commit staged 23 archivos más de `scripts/resultados/` (staging anterior a
   la edición de la regla).
2. **2026-11-26 (`eee1e9c`, cierre Agente A)** — la regla `scripts/resultados/`
   LLEGA al `.gitignore`. Pero gitignore solo impide el tracking de archivos
   NUEVOS no trackeados: **jamás des-rastrea** los ~200 que ya estaban en el
   índice. Ningún `git rm --cached` acompañó la regla.
3. Resultado: regla presente + banco real completo versionado en un repo
   PÚBLICO, y una falsa sensación de privacidad durante ~1 día.

## Regla que se aprende

- **El estado de privacidad se verifica con `git ls-files`, nunca leyendo el
  `.gitignore`.** El `.gitignore` declara intención; el índice es la verdad.
- Añadir la regla NO basta: cada regla de privacidad nueva debe venir
  acompañada de su `git ls-files | grep <patrón>` inmediato y, si algo ya está
  trackeado, `git rm -r --cached` en el mismo commit.
- `git add` de una RUTA explícita que matchea un patrón ignorado no falla si
  el archivo ya estaba trackeado, y el staging puede preceder a la edición de
  la regla dentro del mismo commit — el orden add↔regla es invisible en el
  diff final.
- En auditoría de contenido, usar `grep -l`/`-c` (marcadores, conteos) —
  jamás volcar el contenido de documentos reales al transcript.

## Aplicación (este repo)

- `c1502ce`: 200 archivos fuera del índice (en disco: el banco A56 sigue
  usable localmente), `.gitignore` ampliado con patrones ANCLADOS para lo que
  faltaba fuera de `scripts/resultados/` (`/dev-fixtures/`,
  `/herramientas/informe-calibracion.json`, 12 arneses de
  `scripts/entrega/`), y saneado `test-faro-relacional.ts` (nombres/DNI/CIF
  reales → sintéticos). Verificación §1.3 en verde.
- NO se ejecutó reescritura de historial (Opción B): los blobs antiguos
  siguen en el historial remoto hasta que el dueño decida `git filter-repo`
  + force-push consciente.
