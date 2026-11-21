---
id: "acta-e14-frankfurt-2026-11-21"
plantilla: "acta_e_14_exterior_consul_embajado"
tipo_documento: "acta_e14"
condicion: "PDF escaneado limpio, 2 páginas, sin flash"
herramientas_usadas: ["ancla_texto_fuzzy"]
version_motor: "pre-F1-fix (auditoría)"
resultado: "fallo_robustez"
campos_fallidos: ["firma_jurado_1", "firma_jurado_3"]
metrica: { veredictos_ok: "11/12", zonas_correctas: "10/12" }
---

## Problema observado

`firma_jurado_1` y `firma_jurado_3` resolvieron el MISMO rect
`(0.043, 0.906)` — los dos crops guardados son idénticos pixel a pixel
("CAROLINA BUSTOS O", C.C. 52514788, la firma del jurado 3). J1 resultó "ok"
por coincidencia (la zona de J3 contenía una firma), no porque la zona
apuntara a J1.

## Causa raíz

El ancla "FIRMA JURADO 1" matcheó la etiqueta impresa "FIRMA JURADO 3"
(mismo mecanismo F1: 1 dígito de distancia de edición sobre 13 caracteres,
score 0.765 > 0.72). El motor NO tenía chequeo de coherencia entre campos:
dos campos distintos podían terminar midiendo el mismo rect sin que ninguna
bandera lo reportara.

## Qué funcionó / qué no

- ❌ Sin dedupe de rects: la colisión J1≡J3 era invisible para el sistema.
- ✅ `firma_jurado_2` y `firma_jurado_4`: ancla y referencia respectivamente,
  correctas.

## Recomendación para próximas plantillas

Dos campos que miden el mismo pedazo de papel es SIEMPRE un defecto del molde
o del matcher — hoy el motor lo detecta (`ancla_colision`, IoU > 0.8) y manda
ambos a `requiere_revision`. Al diseñar, verifica en el reporte JSON que
ningún par de campos comparte rect.
