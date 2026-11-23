#!/usr/bin/env python3
"""Verificación de calibración de los 5 moldes universales (modo genérico).

Reproduce, contra ground truth legible por máquina, lo que Molde Studio hace
en pantalla:

1. Estructura y conteos (campos/obligatorios/páginas/htr esperados por el plan).
2. Ancla: la frase del ancla se busca sobre las PALABRAS del PDF
   (palabras_pdf, bboxes normalizados) con la misma normalización del motor
   (mayúsculas, sin acentos) y la misma penalización de posición
   (1/(1+3*(dx+dy))). Se exige score >= 0.72 (ANCLA_SCORE_MIN del motor) y
   solapamiento alto con `ancla.rect`.
3. Zona: el rect resuelto (offset del ancla o zona_fija) se compara contra la
   zona objetivo de la especificación (IoU >= 0.80, tolerancia de borde).
4. Chandra: el texto del ancla debe existir (fuzzy) en el OCR interno —
   garantiza que un OCR real puede encontrarla.
5. Patrones: cada `patron` se busca como subcadena en las líneas Chandra de su
   página (mismo criterio de 01-plan/validar_patrones.py).

Salida: informe JSON + impresión legible. Código de salida 1 si hay fallos.
"""
from __future__ import annotations

import json
import re
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
GT = RAIZ / "ground-truth"
import os
BORRADORES = Path(os.environ.get("DIR_MOLDES", RAIZ / "plan" / "moldes-borrador"))
OBJETIVOS = RAIZ / "herramientas" / "objetivos-espec.json"

ANCLA_SCORE_MIN = 0.72  # mismo corte del motor (universal-engine.ts)
IOU_ZONA_MIN = 0.80

ESPERADO = {
    "comprobante_entrega": {"campos": 10, "oblig": 6, "pags": 1, "htr": 4},
    "recibo_pago": {"campos": 12, "oblig": 11, "pags": 1, "htr": 8},
    "e22_resolucion": {"campos": 10, "oblig": 9, "pags": 2, "htr": 0},
    "e24_cuadro": {"campos": 14, "oblig": 14, "pags": 2, "htr": 0},
    "e26_acta_parcial": {"campos": 42, "oblig": 38, "pags": 6, "htr": 0},
}

DOCS = list(ESPERADO.keys())


def norm(s: str) -> str:
    """Misma normalización que normTxt del motor (A-Z0-9, espacios)."""
    s = s.upper().normalize("NFD") if False else unicodedata.normalize("NFD", s.upper())
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^A-Z0-9]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def iou(a, b) -> float:
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    ix0, iy0 = max(ax0, bx0), max(ay0, by0)
    ix1, iy1 = min(ax1, bx1), min(ay1, by1)
    iw, ih = max(0.0, ix1 - ix0), max(0.0, iy1 - iy0)
    inter = iw * ih
    union = (ax1 - ax0) * (ay1 - ay0) + (bx1 - bx0) * (by1 - by0) - inter
    return inter / union if union > 0 else 0.0


def rect_de(r) -> tuple[float, float, float, float]:
    return (r["x"], r["y"], r["x"] + r["w"], r["y"] + r["h"])


def palabras(doc: str, pagina: int) -> list[dict]:
    data = json.loads((GT / "palabras_pdf" / f"{doc}.json").read_text(encoding="utf-8"))
    for p in data["paginas"]:
        if p["pagina"] == pagina:
            return p["palabras"]
    return []


def lineas_chandra(doc: str, pagina: int) -> list[str]:
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


def mejor_hit_ancla(texto: str, esperado, pags_palabras, ancho_px: float, alto_px: float):
    """Busca la frase del ancla sobre las palabras del PDF con ventana móvil,
    score textual del motor y penalización de posición (1/(1+3*(dx+dy)))."""
    objetivo = norm(texto)
    if not objetivo:
        return None
    pals_obj = objetivo.split(" ")
    mejor = None
    n = len(pags_palabras)
    for i in range(n):
        for j in range(i, min(n, i + len(pals_obj) + 1)):
            ventana = pags_palabras[i : j + 1]
            frase = norm(" ".join(w["texto"] for w in ventana))
            if not frase:
                continue
            d = _dist_ponderada(objetivo, frase)
            score = 1 - d / len(objetivo) if d <= max(1, int(len(objetivo) * 0.35)) else -1
            if score < 0:
                continue
            x0 = min(w["bbox"][0] for w in ventana)
            y0 = min(w["bbox"][1] for w in ventana)
            x1 = max(w["bbox"][2] for w in ventana)
            y1 = max(w["bbox"][3] for w in ventana)
            cx = (x0 + x1) / 2
            cy = (y0 + y1) / 2
            dx = abs(cx - (esperado[0] + esperado[2]) / 2)
            dy = abs(cy - (esperado[1] + esperado[3]) / 2)
            score *= 1 / (1 + 3 * (dx + dy))
            if mejor is None or score > mejor["score"]:
                mejor = {"score": score, "rect": (x0, y0, x1, y1), "texto": " ".join(w["texto"] for w in ventana)}
    return mejor


def _dist_ponderada(a: str, b: str) -> int:
    """Levenshtein ponderado: dígito distinto cuesta 3, indel de dígito 2."""
    m, n = len(a), len(b)
    if not m:
        return sum(2 if c.isdigit() else 1 for c in b)
    prev = list(range(n + 1))
    for i in range(1, m + 1):
        cur = [i] + [0] * n
        for j in range(1, n + 1):
            ca, cb = a[i - 1], b[j - 1]
            if ca == cb:
                coste = 0
            elif ca.isdigit() and cb.isdigit():
                coste = 3
            else:
                coste = 1
            cur[j] = min(prev[j] + (2 if ca.isdigit() else 1), cur[j - 1] + (2 if cb.isdigit() else 1), prev[j - 1] + coste)
        prev = cur
    return prev[n]


def ancla_en_chandra(texto: str, lineas: list[str]) -> tuple[bool, float]:
    objetivo = norm(texto)
    mejor = 0.0
    for ln in lineas:
        nln = norm(ln)
        # ventana de palabras dentro de la línea normalizada
        pals = nln.split(" ")
        k = len(objetivo.split(" "))
        for i in range(max(1, len(pals) - k + 1) if len(pals) >= k else 1):
            ventana = " ".join(pals[i : i + k])
            r = SequenceMatcher(None, objetivo, ventana).ratio()
            mejor = max(mejor, r)
        mejor = max(mejor, SequenceMatcher(None, objetivo, nln).ratio())
    return mejor >= 0.82, mejor


def main() -> None:
    objetivos = json.loads(OBJETIVOS.read_text(encoding="utf-8"))
    informe: dict = {}
    fallos_totales = 0

    for doc in DOCS:
        molde = json.loads((BORRADORES / f"{doc}.molde.json").read_text(encoding="utf-8"))
        esp = ESPERADO[doc]
        campos = molde["campos"]
        pags = sorted({c["pagina"] for c in campos})
        resumen = {
            "campos": len(campos),
            "obligatorios": sum(1 for c in campos if c.get("obligatorio")),
            "paginas": len(pags),
            "htr": sum(1 for c in campos if c.get("htr")),
        }
        filas = []
        fallos_doc = 0

        checks_estructura = {
            "tipo_universal": molde.get("tipo") == "universal",
            "documento_generico": str(molde.get("documento", "")).startswith("generico/"),
            "sin_paginasRef": "paginasRef" not in molde,
            "sin_layout": "layout" not in molde,
            "conteo_campos": resumen["campos"] == esp["campos"],
            "conteo_oblig": resumen["obligatorios"] == esp["oblig"],
            "conteo_pags": resumen["paginas"] == esp["pags"],
            "conteo_htr": resumen["htr"] == esp["htr"],
        }
        for k, v in checks_estructura.items():
            if not v:
                fallos_doc += 1

        for c in campos:
            cid = c["id"]
            fila = {"id": cid, "pagina": c["pagina"], "estado": "OK", "notas": []}
            objetivo = objetivos[doc].get(cid)
            if objetivo is None:
                fila["estado"] = "FALTA_EN_ESPEC"
                fallos_doc += 1
                filas.append(fila)
                continue

            # --- zona resuelta según la semántica del motor ---
            if c["estrategia"] == "zona_fija":
                resuelto = rect_de(c["zona"])
                fuente = "fija"
            else:
                an = c.get("ancla", {})
                ar = an.get("rect")
                if not ar:
                    fila["estado"] = "SIN_ANCLA_RECT"
                    fallos_doc += 1
                    filas.append(fila)
                    continue
                zx = c["zona"]["x"] + (0 if c.get("x_absoluto") else ar["x"])
                zy = c["zona"]["y"] + ar["y"]
                resuelto = (zx, zy, zx + c["zona"]["w"], zy + c["zona"]["h"])
                fuente = "ancla"

            fila["zona_resuelta"] = [round(v, 4) for v in resuelto]
            fila["zona_objetivo"] = objetivo
            fila["iou_zona"] = round(iou(resuelto, objetivo), 3)
            if fila["iou_zona"] < IOU_ZONA_MIN:
                fila["estado"] = "ZONA_FUERA"
                fila["notas"].append(f"IoU {fila['iou_zona']} < {IOU_ZONA_MIN}")
                fallos_doc += 1

            # --- ancla contra palabras del PDF ---
            if c["estrategia"] == "ancla_relativa":
                texto_ancla = c["ancla"]["texto"]
                ar_rect = rect_de(c["ancla"]["rect"])
                pw = palabras(doc, c["pagina"])
                data = json.loads((GT / "palabras_pdf" / f"{doc}.json").read_text(encoding="utf-8"))
                pg = next(p for p in data["paginas"] if p["pagina"] == c["pagina"])
                w_px, h_px = pg.get("tamano_pt", [612, 792])
                hit = mejor_hit_ancla(texto_ancla, ar_rect, pw, w_px, h_px)
                if hit is None or hit["score"] < ANCLA_SCORE_MIN:
                    fila["estado"] = "ANCLA_NO_MATCH"
                    fila["notas"].append(f"score {hit['score'] if hit else None}")
                    fallos_doc += 1
                else:
                    fila["ancla_score"] = round(hit["score"], 3)
                    fila["ancla_rect_pdf"] = [round(v, 4) for v in hit["rect"]]
                    fila["iou_ancla"] = round(iou(ar_rect, hit["rect"]), 3)
                    if fila["iou_ancla"] < 0.55:
                        fila["estado"] = "ANCLA_RECT_DESVIADA"
                        fila["notas"].append(f"IoU ancla {fila['iou_ancla']} < 0.55")
                        fallos_doc += 1
                ok_ch, r_ch = ancla_en_chandra(texto_ancla, lineas_chandra(doc, c["pagina"]))
                fila["chandra_ratio"] = round(r_ch, 3)
                if not ok_ch:
                    fila["estado"] = "ANCLA_NO_EN_CHANDRA"
                    fila["notas"].append(f"ratio chandra {r_ch}")
                    fallos_doc += 1

            # --- patrón contra líneas Chandra ---
            patron = c.get("patron")
            if patron:
                re_pat = re.compile(patron, re.IGNORECASE)
                lineas = lineas_chandra(doc, c["pagina"])
                hits = [ln for ln in lineas if re_pat.search(ln)]
                fila["patron_ok"] = bool(hits)
                if not hits:
                    fila["estado"] = "PATRON_SIN_LINEA"
                    fila["notas"].append(f"patron {patron}")
                    fallos_doc += 1
                else:
                    fila["patron_linea"] = hits[0][:80]

            if fila["estado"] != "OK":
                pass
            filas.append(fila)

        informe[doc] = {"resumen": resumen, "estructura": checks_estructura, "fallos": fallos_doc, "campos": filas}
        fallos_totales += fallos_doc
        print(f"\n== {doc}: {resumen} | fallos: {fallos_doc}")
        for f in filas:
            marca = "OK " if f["estado"] == "OK" else "!! "
            extra = f" iou_zona={f.get('iou_zona')} ancla={f.get('ancla_score')} chandra={f.get('chandra_ratio')} patr={'si' if f.get('patron_ok') else '-'}"
            print(f"  {marca}{f['id']:<22} {f['estado']}{extra if f['estado'] != 'OK' else ''}")
            for nt in f["notas"]:
                print(f"       -> {nt}")

    (RAIZ / "herramientas" / "informe-calibracion.json").write_text(
        json.dumps(informe, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\nTOTAL fallos: {fallos_totales}")
    raise SystemExit(1 if fallos_totales else 0)


if __name__ == "__main__":
    main()
