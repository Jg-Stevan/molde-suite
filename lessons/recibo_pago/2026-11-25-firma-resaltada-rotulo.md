# lessons/recibo_pago/2026-11-25-firma-resaltada-rotulo.md — ficha de lección

---
id: "recibo_pago-escritorio-2026-11-25-firma-resaltada"
plantilla: "recibo_pago v1.4.0 (moldes-genericos y tamiz/public/moldes); motor feat/arnes-geometrico"
tipo_documento: "recibo_pago"
condicion: "verificación de UI en Chrome escritorio (Tamiz :3100) con fixtures reales: recorte-66pct-sin-firma.png, recibo-datos-nuevos.png, recibo-sin-firmas.png"
herramientas_usadas: ["overlay_palabras", "overlay_firma_resaltada", "zoomable_visor_overlay"]
version_motor: "Tamiz ReviewView (CajasCampos) — campos tipo firma"
resultado: "exitoso"
campos_fallidos: []
metrica: { veredictos_ok: "n/a (verificación de overlay)", zonas_correctas: "2/2 firmas resaltadas y rotuladas debajo en los 3 fixtures" }
---

## Problema observado
Pedido del mantenedor: «me gustaría que las firmas o manuscritos se resalten y
abajo muestre de qué es ese manuscrito». Antes, las firmas se pintaban como
una palabra («Firma emisor (receptor)») dentro del rect — el mismo tratamiento
que un valor de texto, sin señalar visualmente la zona de la rúbrica.

## Causa raíz
`CajasCampos` trataba todos los campos igual: palabra coloreada en el rect del
valor. Para `tipo: "firma"` ese rect ES la zona de tinta (no un texto), así
que el tratamiento de «valor reconocido» no comunicaba «aquí va la firma».

## Qué funcionó / qué no
- ✅ Rama `esFirma` en `CajasCampos`: banda translúcida del color del estado
  (`ok` verde / `requiere_revision` ámbar / `no_encontrado` rojo) con borde y
  glow sobre el rect de la firma, y el rótulo de la etiqueta (`campo-firma-
  etiqueta`) DEBAJO de la banda — `bottom: 100%` si la banda está pegada al
  pie (y+h > 0.93) para no salirse de la foto.
- ✅ Mismo componente en tarjeta y visor: verificado a pantalla completa en
  recorte-66 (bandas rojas al pie, rótulo bajo cada una), datos-nuevos (bandas
  ámbar sobre las rúbricas) y sin-firmas (bandas rojas, sin tinta).
- ❌ El panel VERIFICACIÓN DOCUMENTAL desplegado en RECHAZADA sigue tapando la
  foto en la tarjeta; el visor ampliado es la vista limpia (diseño 2026-11-16,
  no se tocó).

## Recomendación para próximas plantillas
- Un campo de TINTA (firma/manuscrito) se comunica como ZONA resaltada, no
  como texto: el operador necesita ver dónde falta la rúbrica. El rótulo va
  fuera de la zona (debajo por defecto) para no tapar la tinta.
- Regla de borde: si el rect termina a < 7 % del pie de la foto, invertir el
  rótulo (arriba) — evita que el texto se salga del canvas.
