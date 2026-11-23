#!/usr/bin/env python3
"""Lint de los `patron` de anclas-sugeridas.json contra las líneas OCR de
ground truth (Chandra) de la misma página.

El motor ancla el patrón al texto del RECORTE de la zona, que es una
subcadena de la línea OCR completa. Por eso aquí se busca el patrón como
subcadena de cada línea (sin anclar): un patrón que no aparece en ninguna
línea de la página es imposible de cumplir y se reporta.

No sustituye la prueba real en Tamiz: el OCR de Tesseract sobre el recorte
puede diferir. Uso:  python validar_patrones.py
"""
from __future__ import annotations

import json
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
GT = RAIZ.parent / "ground-truth"


def lineas_de(doc: str, pagina: int) -> list[str]:
    data = json.loads((GT / f"{doc}.json").read_text(encoding="utf-8"))
    for p in data["paginas"]:
        if p["pagina"] == pagina:
            out = []
            for b in p["bloques"]:
                t = (b.get("texto_linea") or b.get("texto") or "").replace("|", " ")
                t = re.sub(r"\s+", " ", t).strip()
                if t:
                    out.append(t)
            return out
    return []


def main() -> None:
    datos = json.loads((RAIZ / "anclas-finales.json").read_text(encoding="utf-8"))
    fallos = 0
    for doc in datos["documentos"]:
        nombre = doc["documento"]
        print(f"\n== {nombre}")
        for c in doc["campos"]:
            if not c["patron"]:
                continue
            re_pat = re.compile(c["patron"], re.IGNORECASE)
            lineas = lineas_de(nombre, c["pagina"])
            hits = [ln for ln in lineas if re_pat.search(ln)]
            if hits:
                print(f"  OK   {c['id']}: «{hits[0][:90]}»")
            else:
                fallos += 1
                print(f"  FALLA {c['id']} (p{c['pagina']}) patrón={c['patron']!r}")
                for ln in lineas[:6]:
                    print(f"        línea: «{ln[:100]}»")
    print(f"\n{'OK: todos los patrones tienen al menos una línea compatible' if not fallos else f'{fallos} patrón(es) sin línea compatible'}")
    raise SystemExit(1 if fallos else 0)


if __name__ == "__main__":
    main()
