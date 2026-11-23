#!/usr/bin/env python3
"""Overlays de calibración: dibuja ancla (violeta) y zona resuelta (ámbar)
de cada campo del molde FINAL sobre la referencia PNG de 200 DPI.

La zona resuelta usa la semántica del motor: ancla.rect + offset zona
(ancla_relativa) o zona absoluta (zona_fija). Como las anclas fueron fijadas
al bbox real del PDF y los offsets recalculados, la zona resuelta debe caer
exactamente sobre la región objetivo.

Salida: calibracion/overlays/<doc>-p<N>.png (reducidas a 1100 px de ancho).
"""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw

RAIZ = Path(__file__).resolve().parent.parent
FINALES = RAIZ / "moldes-finales"
REFS = RAIZ / "referencias"
SALIDA = RAIZ / "calibracion" / "overlays"

DOCS = ["comprobante_entrega", "recibo_pago", "e22_resolucion", "e24_cuadro", "e26_acta_parcial"]

VIOLETA = (139, 43, 226)
AMBAR = (245, 158, 11)
VERDE = (16, 185, 129)


def caja(draw: ImageDraw.ImageDraw, rect, color, grosor, etiqueta="", relleno=None):
    x0, y0, x1, y1 = [int(v * dim) for v, dim in zip(rect, (W, H, W, H))]
    draw.rectangle([x0, y0, x1, y1], outline=color, width=grosor, fill=relleno)
    if etiqueta:
        ty = max(0, y0 - 11)
        draw.text((x0 + 2, ty), etiqueta, fill=color)


for doc in DOCS:
    molde = json.loads((FINALES / f"{doc}.molde.json").read_text(encoding="utf-8"))
    por_pagina: dict[int, list] = {}
    for c in molde["campos"]:
        por_pagina.setdefault(c["pagina"], []).append(c)

    for pg, campos in sorted(por_pagina.items()):
        src = REFS / doc / f"pag-{pg:02d}.png"
        img = Image.open(src).convert("RGB")
        global W, H
        W, H = img.size
        overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(overlay)
        for c in campos:
            if c["estrategia"] == "zona_fija":
                zx, zy = c["zona"]["x"], c["zona"]["y"]
                an = None
            else:
                ar = c["ancla"]["rect"]
                an = (ar["x"], ar["y"], ar["x"] + ar["w"], ar["y"] + ar["h"])
                zx = ar["x"] + c["zona"]["x"]
                zy = ar["y"] + c["zona"]["y"]
            zr = (zx, zy, zx + c["zona"]["w"], zy + c["zona"]["h"])
            if an:
                caja(d, an, VIOLETA, 2, "")
            relleno = (245, 158, 11, 28) if c["tipo"] == "texto" else (139, 43, 226, 28)
            caja(d, zr, AMBAR if c["tipo"] == "texto" else VIOLETA, 2, f"{c['id']}", relleno)
        comp = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
        escala = 1100 / W
        comp = comp.resize((1100, int(H * escala)))
        SALIDA.mkdir(parents=True, exist_ok=True)
        out = SALIDA / f"{doc}-p{pg:02d}.png"
        comp.save(out)
        print(f"ok {out}")
print("listo")
