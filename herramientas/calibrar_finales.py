#!/usr/bin/env python3
"""Calibración fina: genera los moldes FINALES desde los borradores.

Operación por campo (equivalente a lo que el agente haría en Molde Studio al
verificar ancla y zona sobre la referencia de 200 DPI):

1. ancla_relativa: se busca la frase EXACTA del ancla como ventana contigua de
   palabras del PDF (palabras_pdf, verdad vectorial). Si existe, `ancla.rect`
   se fija al bbox real de la frase; si no, se conserva la del borrador.
2. El offset `zona` se recalcula para que el rect RESUELTO sea exactamente la
   zona objetivo de `ESPECIFICACION-MOLDES.md` (objetivos-espec.json).
3. zona_fija: `zona` pasa a ser la zona objetivo.
4. version 1.0.0 -> 1.1.0. Sin `paginasRef`, sin `layout` (se eliminan por si
   acaso los borradores los trajeran).

Salida: moldes-finales/<doc>.molde.json + registro de cambios (JSON).
"""
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
GT = RAIZ / "ground-truth" / "palabras_pdf"
BORRADORES = RAIZ / "plan" / "moldes-borrador"
FINALES = RAIZ / "moldes-finales"
OBJETIVOS = RAIZ / "herramientas" / "objetivos-espec.json"

DOCS = ["comprobante_entrega", "recibo_pago", "e22_resolucion", "e24_cuadro", "e26_acta_parcial"]


def norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s.upper())
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^A-Z0-9]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def r4(v: float) -> float:
    return round(v + 0.0, 4)


def bbox_frase(palabras: list[dict], texto: str):
    objetivo = norm(texto)
    if not objetivo:
        return None
    n = len(palabras)
    pals = objetivo.split(" ")
    for i in range(n):
        for j in range(i, min(n, i + len(pals) + 1)):
            ventana = palabras[i : j + 1]
            if norm(" ".join(w["texto"] for w in ventana)) == objetivo:
                x0 = min(w["bbox"][0] for w in ventana)
                y0 = min(w["bbox"][1] for w in ventana)
                x1 = max(w["bbox"][2] for w in ventana)
                y1 = max(w["bbox"][3] for w in ventana)
                return {"x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0}
    return None


def main() -> None:
    objetivos = json.loads(OBJETIVOS.read_text(encoding="utf-8"))
    FINALES.mkdir(exist_ok=True)
    cambios: dict[str, list[dict]] = {}

    for doc in DOCS:
        molde = json.loads((BORRADORES / f"{doc}.molde.json").read_text(encoding="utf-8"))
        paginas = sorted({c["pagina"] for c in molde["campos"]})
        palabras_por_pag = {}
        for pg in paginas:
            data = json.loads((GT / f"{doc}.json").read_text(encoding="utf-8"))
            for p in data["paginas"]:
                if p["pagina"] == pg:
                    palabras_por_pag[pg] = p["palabras"]

        cambios[doc] = []
        for c in molde["campos"]:
            cid = c["id"]
            objetivo = objetivos[doc][cid]
            ox0, oy0, ox1, oy1 = objetivo
            tw, th = r4(ox1 - ox0), r4(oy1 - oy0)
            antes = {"ancla_rect": dict(c["ancla"]["rect"]) if c.get("ancla") else None,
                     "zona": dict(c["zona"])}

            if c["estrategia"] == "zona_fija":
                c["zona"] = {"x": r4(ox0), "y": r4(oy0), "w": tw, "h": th}
            else:
                hallado = bbox_frase(palabras_por_pag[c["pagina"]], c["ancla"]["texto"])
                if hallado:
                    nuevo = {"x": r4(hallado["x"]), "y": r4(hallado["y"]),
                             "w": r4(hallado["w"]), "h": r4(hallado["h"])}
                    if nuevo != c["ancla"]["rect"]:
                        cambios[doc].append({
                            "campo": cid, "tipo": "ancla.rect",
                            "antes": [r4(antes["ancla_rect"]["x"]), r4(antes["ancla_rect"]["y"]),
                                      r4(antes["ancla_rect"]["x"] + antes["ancla_rect"]["w"]),
                                      r4(antes["ancla_rect"]["y"] + antes["ancla_rect"]["h"])],
                            "despues": [nuevo["x"], nuevo["y"], r4(nuevo["x"] + nuevo["w"]),
                                        r4(nuevo["y"] + nuevo["h"])],
                            "motivo": "rect fijado al bbox real de la frase en el PDF (palabras_pdf)",
                        })
                    c["ancla"]["rect"] = nuevo
                base = c["ancla"]["rect"]
                zona_nueva = {
                    "x": r4((ox0 - base["x"]) if not c.get("x_absoluto") else ox0),
                    "y": r4(oy0 - base["y"]),
                    "w": tw,
                    "h": th,
                }
                if zona_nueva != c["zona"]:
                    cambios[doc].append({
                        "campo": cid, "tipo": "zona",
                        "antes": [antes["zona"]["x"], antes["zona"]["y"], antes["zona"]["w"], antes["zona"]["h"]],
                        "despues": [zona_nueva["x"], zona_nueva["y"], zona_nueva["w"], zona_nueva["h"]],
                        "motivo": "offset recalculado para que el rect resuelto sea la zona objetivo",
                    })
                c["zona"] = zona_nueva

        molde["version"] = "1.1.0"
        molde.pop("paginasRef", None)
        molde.pop("layout", None)
        (FINALES / f"{doc}.molde.json").write_text(
            json.dumps(molde, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(f"{doc}: {len(cambios[doc])} cambios -> moldes-finales/{doc}.molde.json")

    (RAIZ / "herramientas" / "cambios-calibracion.json").write_text(
        json.dumps(cambios, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    total = sum(len(v) for v in cambios.values())
    print(f"\nTotal de ajustes registrados: {total}")


if __name__ == "__main__":
    main()
