# lessons/TEMPLATE.md — Ficha de lección

> Copia esta plantilla a `lessons/<tipo_documento>/<YYYY-MM-DD>-<slug>.md`,
> llénala con evidencia REPRODUCIBLE y haz commit. El paso de revisión (hub)
> valida causa raíz antes de que la lección cuente para TEMPLATES.md.

```markdown
---
id: "<tipo>-<lugar/sede>-<fecha>"
plantilla: "<id del molde>"
tipo_documento: "<acta_e14 | factura | certificado | ...>"
condicion: "<PDF limpio 2 págs | foto celular torcida | escaneo con flash ...>"
herramientas_usadas: ["ancla_texto_fuzzy", "ancla_respaldo", "desambiguadores", "zona_fija", ...]
version_motor: "<commit del motor>"
resultado: "exitoso | fallo_precision | fallo_robustez"
campos_fallidos: ["<id_campo>", ...]
metrica: { veredictos_ok: "n/m", zonas_correctas: "n/m" }
---

## Problema observado
<Qué campo hizo qué. Con rect/crop/bandera exactos del reporte JSON de la corrida.>

## Causa raíz
<La explicación verificada — no la hipótesis. Referencia a la función/línea si es del motor.>

## Qué funcionó / qué no
- ✅ <herramienta que ayudó, con evidencia>
- ❌ <herramienta que falló, con evidencia>

## Recomendación para próximas plantillas
<Regla accionable que otro agente puede aplicar sin volver a fallar.>
```
