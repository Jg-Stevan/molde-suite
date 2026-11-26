# lessons/app_tamiz/2026-11-26-workflow-trigger-corrupto.md — triggers de CI sin «[main]»

---
id: "app_tamiz-ci-trigger-corrupto-2026-11-26"
plantilla: "(CI — deploy-pages.yml y quality.yml)"
tipo_documento: "app_tamiz"
condicion: "push a main · workflows de GitHub Actions"
herramientas_usadas: ["deploy-pages.yml", "quality.yml"]
version_motor: "agent-a/infra-motor-perf @ ee3416f (base main ccb85b1)"
resultado: "fallo_robustez"
campos_fallidos: []
metrica: { veredictos_ok: "0 disparos en push a main (antes) / disparos normales (después)" }
---

## Problema observado

Ambos workflows (`deploy-pages.yml`, `quality.yml`) declaraban
`on.push.branches: ain]` — el literal `[ma` del YAML desapareció del repo.
Consecuencia: el Quality Gate NO corre en push a `main` (solo en PRs) y el
deploy de Pages NO se dispara por push a `main` (solo por `workflow_dispatch`
manual).

## Causa raíz

Corrupción silenciosa de los YAML al entrar al repo (commit 0f3a6b9 / 09e93c8
traen el mismo defecto): el contenido quedó como escalar `ain]`, que YAML
acepta como string — el workflow carga sin error de parseo y simplemente nunca
matchea la rama `main`. Nadie lo vio porque el gate SÍ corre en los PRs (ese
trigger no filtra por rama) y el deploy de Pages se venía disparando a mano.

## Qué funcionó / qué no

- ✅ Detectarlo al revisar los workflows como parte de A1 («verificar que el
  workflow de Pages sigue en pie») con grep + `od -c` para confirmar los bytes.
- ❌ Confiar en la UI de Actions para notar la ausencia: los runs a mano
  enmascaran el trigger roto.

## Recomendación para próximas plantillas

1. Al tocar un workflow, verificar el trigger con `od -c` (los corchetes del
   YAML se prestan a corrupciones que no rompen el parseo).
2. Un push «canario» a main tras cada cambio de CI (o revisar la pestaña
   Actions 5 min después) confirma que los triggers disparan.
