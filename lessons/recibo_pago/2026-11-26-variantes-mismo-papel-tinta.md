---
id: "recibo_pago-comprobante_entrega-2026-11-26"
plantilla: "recibo_real / comprobante_real"
tipo_documento: "recibo_pago y comprobante_entrega (variantes reales A/B/C)"
condicion: "fotos celular reales: A relleno impreso con firmas vacías, B formulario en blanco, C relleno mixto; recibos girados 90° sobre mesa oscura"
herramientas_usadas: ["ancla_relativa", "htr", "tinta (v1.5.1)", "enderezarFoto (Rotar 90°)", "SONDA atada al visor"]
version_motor: "feat/arnes-geometrico (universal-engine rescate zona_vacia + buscarAncla rect)"
resultado: "fallo_precision"
campos_fallidos: ["nombre_comprador", "documento_comprador", "telefono", "articulo", "numero_operacion", "descripcion", "fecha_entrega"]
metrica: { veredictos_ok: "12/21 enrutan al molde de familia correcto", zonas_correctas: "comprobante B: 0/8 (8 verdes falsos sobre tinta impresa)" }
---

## Problema observado

1. **Variantes no enrutables.** Los 6 moldes por variante (`*_a/b/c_real`)
   empatan en ratio de anclas: las tres variantes de cada familia son el MISMO
   papel impreso (mismas etiquetas y geometría); solo cambia el relleno. El
   router elegía a ciegas la primera fila de la biblioteca (todos los
   comprobantes salían «C (mixto)», log 2026-11-26T02:5x).
2. **Verde falso en formulario en blanco.** Con el molde unificado, la foto B
   (todo en blanco) pintaba verde 8 / rojo 1: las zonas `htr` con `zona.x = 0`
   empiezan ENCIMA de la etiqueta impresa («Nombre y apellido», «Artículo»…) y
   miden tinta de la impresión, no del relleno. Captura
   `scripts/resultados/mra-05-comprobante-b-todo-mano-01.png`: banda verde
   sobre «DATOS DEL COMPRADOR…».
3. **Recorte sello en fotos giradas.** Los recibos reales llegan girados 90°;
   el quad se cierra sobre un fragmento y la «foto procesada» queda como un
   sello diminuto (captura `mra-14-recibo-b-todo-mano-01.png`): overlay 0/0 y
   geometría inservible.
4. **Sonda leía actas viejas.** El walk global de la fibra React encontraba
   actas del historial mientras la foto nueva seguía analizando → scores y
   cajas de OTRA foto (filas 0/0 y scores repetidos).
5. **Pestaña en segundo plano congela el pipeline.** Chrome Android estrangula
   los timers de la pestaña que no está al frente: «DETECTANDO BORDES 18%»
   durante minutos con el teléfono sano (230% CPU en el sandbox al traerla al
   frente).

## Causa raíz

- (1) y (2) son de DATOS, no del motor: la discriminación por anclas/geometría
  no existe entre variantes del mismo papel, y una zona que incluye la
  etiqueta impresa mide tinta impresa. Verificado midiendo ratio de píxeles
  oscuros por zona sobre la foto procesada (probe
  `calibrar-zonas-reales.mjs`, negativo = B en blanco).
- (3) el pipeline no endereza solo fotos a 90°; el botón «Rotar 90°» del visor
  reprocesa y sí produce la página vertical completa.
- (4) el acta renderizada es la que cuelga del prop `acta` de ReviewView; el
  historial del store contiene actas viejas con la misma forma.
- (5) throttling de Chrome Android, no un cuelgue del motor.

## Qué funcionó / qué no

- ✅ Un molde por familia con unión de `htr`/`obligatorio` + semáforo por
  `tinta` (v1.5.1): enruta las 21 fotos al papel correcto y pinta rojo la
  firma vacía de A.
- ✅ Rescate omitido en `zona_vacia` (motor): B ya no inventa glifos («de»,
  «2024») con confianza fantasma.
- ✅ `enderezarFoto` (botón del operador) + `bringToFront` por poll + SONDA
  atada al img del visor: mediciones reproducibles.
- ❌ Moldes por variante publicados juntos: empate de anclas garantizado.
- ❌ Zonas `htr` calibradas solo sobre la variante llena: incluyen la etiqueta
  impresa y dan verde falso en el formulario en blanco.
- ❌ Walk global de fibra para leer el acta: lee el historial.

## Recomendación para próximas plantillas

1. Si varias «variantes» comparten papel impreso, NO publiques un molde por
   variante: publica UNO por familia con `htr` en la unión de campos que
   alguna variante rellena a mano, y deja el color del overlay a la tinta
   medida (`tinta`), nunca a la lectura.
2. Calibra toda zona de manuscrito contra un NEGATIVO en blanco del mismo
   papel: ratio ≈ 0 ahí es requisito duro; después verifica el positivo
   (relleno impreso o a mano). Desplazamiento mínimo que cumple ambos.
3. En bancos por CDP: despierta el teléfono y trae Chrome al frente antes de
   conectar; re-forza el frente en cada poll; ata la sonda al acta
   renderizada; endereza fotos giradas con el botón del visor antes de medir.