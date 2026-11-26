id: "repo-privacidad-2026-11-27-filter-repo-invert-paths"
plantilla: "infraestructura repo"
tipo_documento: "reescritura de historial git (purga de blobs de documentos reales)"
condicion: "orden explícita del dueño de eliminar los blobs antiguos del historial tras la Opción A (c1502ce); main protegida contra force-push"
herramientas_usadas: ["git filter-repo --invert-paths --paths-from-file --replace-text", "git rev-list --all --count -- <paths>", "escaneo de blobs con cat-file --batch (sin volcar valores)", "comparación contra clon pre-purge", "API branch protection (PUT/restore verificado)"]
version_motor: "sin cambios de motor"
resultado: "historia reescrita: 0 commits con los 200 paths · árbol de HEAD byte-idéntico · tag reescrito · rama agent remota eliminada · protección restaurada idéntica"
campos_fallidos: []
metrica: { paths_purgados: "200 (0 commits en historia; antes 10)", blobs_escaneados: "1413 de texto · DNI 0 · CIF 0 · IBAN-patrón 2 valores sintéticos", proteccion: "restaurada idéntica tras force-push" }
---

## Problema observado

Primer intento de la purga: `git filter-repo --paths-from-file <lista de los
200 paths>` **SIN `--invert-paths`**. La semántica por defecto de filter-repo
es INCLUSIVA: los paths dados son lo ÚNICO que se conserva. El historial quedó
reducido a SOLO los 200 archivos de documentos reales y el árbol de HEAD pasó
al árbol vacío (`4b825dc`) — el objetivo exacto inverso al buscado.

## Causa raíz

`--paths-from-file` significa «deja SOLO estos paths» salvo que se pase
`--invert-paths` («deja todo EXCEPTO estos»). La trampa clásica de
filter-repo: sin la flag, la "purga" es en realidad una extracción.

## Regla que se aprende

- **Toda purga con filter-repo lleva `--invert-paths`** cuando la lista es lo
  que se ELIMINA. Fijar ANTES del rewrite el SHA del árbol esperado de HEAD
  (`git rev-parse main^{tree}`) y verificarlo justo después: debe ser
  byte-idéntico si el contenido actual no cambia.
- Snapshot pre-rewrite (SHAs de todas las refs, árbol, conteos de disco de los
  materiales) para detectar y revertir en caliente. El remoto intacto es la
  copia maestra: si el clon local se corrompe, se descarta `.git`, se re-clona
  y se repite el rewrite con la flag correcta (aquí: sin pérdida, 0 diffs).
- Verificación post-rewrite en 3 capas:
  1. **Paths:** `git rev-list --all --count -- <paths>` = 0.
  2. **Contenido:** escaneo de todos los blobs de texto con marcadores,
     comparando contra los blobs del material purgado conservados en un clon
     PRE-purge — un valor que existía solo en material purgado y sigue vivo en
     la historia reescrita = filtración.
  3. **SHAs viejos:** `git cat-file -t <sha>` debe fallar para todos.
- Con `--replace-text`, validar las reglas con simulación previa: aplicar las
  reglas al blob viejo y exigir sha idéntico al blob saneado actual.
- Branch protection: guardar la config original por API, `allow_force_pushes`
  temporal, push, y restaurar comparando JSON campo a campo.

## Aplicación (este repo)

- Reescritura ejecutada con `--invert-paths` + `--replace-text`: `main`
  `bb43c08` (árbol idéntico `3a26734d`), tag `post-auditoria-remediacion`
  `2d531f4`, rama remota `agent-c/v6-…` eliminada (PR #11 mergeado).
- Escaneo de 1.413 blobs: DNI=0 · CIF=0 · IBAN-patrón solo 2 valores
  sintéticos nunca presentes en el material purgado.
- Pendiente: `refs/pull/*/head` de GitHub conservan la historia vieja hasta
  GC de GitHub Support; forks/clones deben re-clonar.
