#!/usr/bin/env python3
"""Genera los insumos de prueba CP-XX a partir de las referencias de 200 DPI.

Las variantes "firmadas/llenadas" usan tinta sintética (trazos con curva
aleatoria suave) SOLO dentro de las zonas de campo del molde: es el
equivalente digital de llenar el formulario de práctica con bolígrafo. Son
formularios sintéticos de práctica; no hay datos reales.

Salida: insumos-cp/<caso>/*.png
"""
from __future__ import annotations

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw

RAIZ = Path(__file__).resolve().parent.parent
REFS = RAIZ / "referencias"
SALIDA = RAIZ / "insumos-cp"
random.seed(11)


def garabato(draw, caja, grosor=15, amplitud=None, nvueltas=None):
    """Trazo tipo rúbrica dentro de la caja (x0,y0,x1,y1) normalizada."""
    x0, y0, x1, y1 = caja
    W, H = draw._image.size
    px0, py0, px1, py1 = x0 * W, y0 * H, x1 * W, y1 * H
    ancho = px1 - px0
    alto = py1 - py0
    amp = amplitud if amplitud is not None else alto * 0.28
    nv = nvueltas if nvueltas is not None else max(3, int(ancho / (alto * 1.6)))
    ycentro = py0 + alto * 0.52
    puntos = []
    fases = [random.uniform(0, math.pi * 2) for _ in range(3)]
    for i in range(0, 361, 4):
        t = i / 360
        x = px0 + t * ancho
        y = ycentro + amp * math.sin(2 * math.pi * nv * t + fases[0]) * 0.7 + amp * 0.3 * math.sin(2 * math.pi * (nv * 2) * t + fases[1])
        puntos.append((x, y))
    draw.line(puntos, fill=(25, 25, 30), width=grosor, joint="curve")
    # trazo de refuerzo
    puntos2 = [(x + random.uniform(-3, 3), y + random.uniform(-5, 5)) for (x, y) in puntos[::2]]
    draw.line(puntos2, fill=(25, 25, 30), width=max(6, grosor - 5), joint="curve")


def manuscrito_borroso(draw, caja, densidad=0.42, grosor=13):
    """Scribble denso tipo escritura a mano ilegible dentro de la caja."""
    x0, y0, x1, y1 = caja
    W, H = draw._image.size
    px0, py0, px1, py1 = x0 * W, y0 * H, x1 * W, y1 * H
    # varias "líneas" onduladas apiladas
    alto = (py1 - py0)
    nl = 2 if alto > 26 else 1
    for l in range(nl):
        ycentro = py0 + alto * (0.30 + 0.4 * l / max(1, nl - 1)) if nl > 1 else py0 + alto * 0.5
        puntos = []
        nv = random.uniform(6, 11)
        fases = [random.uniform(0, math.pi * 2) for _ in range(2)]
        for i in range(0, 361, 3):
            t = i / 360
            x = px0 + t * (px1 - px0) * densidad + (px1 - px0) * 0.02
            y = ycentro + (alto * 0.16) * math.sin(2 * math.pi * nv * t + fases[0]) + (alto * 0.08) * math.sin(2 * math.pi * nv * 2.3 * t + fases[1])
            puntos.append((x, y))
        draw.line(puntos, fill=(28, 28, 34), width=grosor, joint="curve")


def firmar(imagen, zonas, scribbles=None):
    img = imagen.copy()
    d = ImageDraw.Draw(img)
    for z in zonas:
        garabato(d, z)
    for z in (scribbles or []):
        manuscrito_borroso(d, z)
    return img


def guardar(img, caso, nombre):
    out = SALIDA / caso
    out.mkdir(parents=True, exist_ok=True)
    img.save(out / nombre)
    print("ok", out / nombre)


# ---------------- comprobante_entrega (variantes del mismo PDF) ----------------
compA = Image.open(REFS / "comprobante_entrega" / "pag-01.png").convert("RGB")
compB = Image.open(REFS / "comprobante_entrega" / "pag-02.png").convert("RGB")
compC = Image.open(REFS / "comprobante_entrega" / "pag-03.png").convert("RGB")

# zonas (normalizadas, del molde final)
FIRMA_COMP = (0.120, 0.480, 0.470, 0.518)
FECHA_COMP = (0.530, 0.490, 0.870, 0.518)

# CP-01: A impresa + firma y fecha a mano
img = firmar(compA, [FIRMA_COMP, FECHA_COMP])
guardar(img, "CP-01", "comprobante-a-firmado.png")

# CP-04: A sin firmar (referencia tal cual)
guardar(compA.copy(), "CP-04", "comprobante-a-sin-firmar.png")

# CP-02: B todo a mano: scribbles en líneas de valores + firma + fecha
img = compB.copy()
d = ImageDraw.Draw(img)
manuscrito_borroso(d, (0.103, 0.148, 0.500, 0.168))  # nombre
manuscrito_borroso(d, (0.103, 0.189, 0.300, 0.207))  # documento
manuscrito_borroso(d, (0.508, 0.189, 0.700, 0.207))  # telefono (opcional)
manuscrito_borroso(d, (0.100, 0.251, 0.900, 0.271))  # direccion
manuscrito_borroso(d, (0.103, 0.326, 0.580, 0.346))  # articulo
manuscrito_borroso(d, (0.589, 0.326, 0.750, 0.346))  # operacion (opcional)
manuscrito_borroso(d, (0.103, 0.365, 0.900, 0.401))  # descripcion
garabato(d, FIRMA_COMP)
garabato(d, FECHA_COMP)
guardar(img, "CP-02", "comprobante-b-llenado.png")

# CP-03: C mixta: artículo impreso vacío -> a mano; firma + fecha
img = compC.copy()
d = ImageDraw.Draw(img)
manuscrito_borroso(d, (0.103, 0.326, 0.580, 0.346))  # articulo vacío en C
garabato(d, FIRMA_COMP)
garabato(d, FECHA_COMP)
guardar(img, "CP-03", "comprobante-c-completado.png")

# ---------------- recibo_pago ----------------
recA = Image.open(REFS / "recibo_pago" / "pag-01.png").convert("RGB")
recB = Image.open(REFS / "recibo_pago" / "pag-02.png").convert("RGB")
recC = Image.open(REFS / "recibo_pago" / "pag-03.png").convert("RGB")

FIRMA_EMI = (0.120, 0.820, 0.450, 0.865)
FIRMA_PAG = (0.550, 0.820, 0.880, 0.865)

# CP-05: A impresa + dos firmas
img = firmar(recA, [FIRMA_EMI, FIRMA_PAG])
guardar(img, "CP-05", "recibo-a-firmado.png")

# CP-06: B todo a mano
img = recB.copy()
d = ImageDraw.Draw(img)
manuscrito_borroso(d, (0.718, 0.130, 0.900, 0.151))  # fecha emision
manuscrito_borroso(d, (0.755, 0.158, 0.900, 0.179))  # numero
manuscrito_borroso(d, (0.120, 0.201, 0.880, 0.251))  # emisor
manuscrito_borroso(d, (0.120, 0.264, 0.880, 0.321))  # pagador
manuscrito_borroso(d, (0.208, 0.329, 0.530, 0.351))  # importe + letras
manuscrito_borroso(d, (0.235, 0.365, 0.880, 0.389))  # concepto
manuscrito_borroso(d, (0.245, 0.756, 0.880, 0.779))  # forma pago
manuscrito_borroso(d, (0.240, 0.783, 0.400, 0.807))  # fecha pago
garabato(d, FIRMA_EMI)
garabato(d, FIRMA_PAG)
guardar(img, "CP-06", "recibo-b-llenado.png")

# CP-07: C mixto: pagador/importe/concepto/fecha pago a mano + firmas
img = recC.copy()
d = ImageDraw.Draw(img)
manuscrito_borroso(d, (0.120, 0.264, 0.880, 0.321))  # pagador
manuscrito_borroso(d, (0.208, 0.329, 0.530, 0.351))  # importe
manuscrito_borroso(d, (0.235, 0.365, 0.880, 0.389))  # concepto
manuscrito_borroso(d, (0.240, 0.783, 0.400, 0.807))  # fecha pago
garabato(d, FIRMA_EMI)
garabato(d, FIRMA_PAG)
guardar(img, "CP-07", "recibo-c-completado.png")

# CP-08: C sin llenar ni firmar (referencia tal cual)
guardar(recC.copy(), "CP-08", "recibo-c-sin-llenar.png")

# ---------------- E-22 ----------------
e22_1 = Image.open(REFS / "e22_resolucion" / "pag-01.png").convert("RGB")
e22_2 = Image.open(REFS / "e22_resolucion" / "pag-02.png").convert("RGB")
guardar(e22_1.copy(), "CP-09", "e22-p1.png")
guardar(e22_2.copy(), "CP-09", "e22-p2.png")
guardar(e22_1.copy(), "CP-10", "e22-p1.png")
guardar(e22_2.copy(), "CP-11", "e22-slot1-p2.png")
guardar(e22_1.copy(), "CP-11", "e22-slot2-p1.png")

# ---------------- E-24 ----------------
e24_1 = Image.open(REFS / "e24_cuadro" / "pag-01.png").convert("RGB")
e24_2 = Image.open(REFS / "e24_cuadro" / "pag-02.png").convert("RGB")
guardar(e24_1.copy(), "CP-12", "e24-p1.png")
guardar(e24_2.copy(), "CP-12", "e24-p2.png")
guardar(e24_2.copy(), "CP-13", "e24-slot1-p2.png")
guardar(e24_1.copy(), "CP-13", "e24-slot2-p1.png")

# ---------------- E-26 ----------------
e26 = [Image.open(REFS / "e26_acta_parcial" / f"pag-0{i}.png").convert("RGB") for i in range(1, 7)]
for i, img in enumerate(e26, 1):
    guardar(img.copy(), "CP-14", f"e26-p{i}.png")
for i in (1, 2, 3, 5, 6):
    guardar(e26[i - 1].copy(), "CP-15", f"e26-p{i}.png")
guardar(e26[0].copy(), "CP-16", "e26-p1.png")
guardar(e26[1].copy(), "CP-16", "e26-p2.png")
guardar(e26[1].copy(), "CP-16", "e26-slot3-duplicado-p2.png")
guardar(e26[3].copy(), "CP-16", "e26-p4.png")
guardar(e26[4].copy(), "CP-16", "e26-p5.png")
guardar(e26[5].copy(), "CP-16", "e26-p6.png")
for i in (1, 3, 2, 4, 5, 6):
    guardar(e26[i - 1].copy(), "CP-17", f"e26-slot-{i}.png")
# CP-19: p6 rotada 180°
guardar(e26[5].rotate(180).copy(), "CP-19", "e26-p6-rotada180.png")
for i in range(1, 6):
    guardar(e26[i - 1].copy(), "CP-19", f"e26-p{i}.png")
# CP-18: E-17 (documento ajeno) contra e22
e17 = Image.open(REFS / "e17_recibo" / "pag-01.png").convert("RGB")
guardar(e17.copy(), "CP-18", "e17-ajeno.png")
# CP-20: repeticiones de e26 completo
for suf, corrida in (("a", "r1"), ("b", "r2"), ("c", "r3")):
    for i, img in enumerate(e26, 1):
        guardar(img.copy(), f"CP-20{'' if suf=='a' else suf}", f"e26-p{i}.png")

print("insumos listos en", SALIDA)
