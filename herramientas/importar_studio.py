#!/usr/bin/env python3
"""Importa los 5 moldes finales en Molde Studio (port 3001) con refs frescos."""
import json
import re
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DOCS = ["comprobante_entrega", "recibo_pago", "e22_resolucion", "e24_cuadro", "e26_acta_parcial"]


def ab(*args, timeout=30):
    r = subprocess.run(["agent-browser", *args], capture_output=True, text=True, timeout=timeout)
    return r.stdout + r.stderr


def eval_js(js):
    out = ab("eval", js)
    return out.strip()


def ref_textarea():
    out = ab("snapshot", "-i", "--json")
    try:
        d = json.loads(out)
        refs = d.get("data", {}).get("refs", {})
        for rid, nodo in refs.items():
            if nodo.get("role") == "textbox" and "Pega" in str(nodo.get("name", "")):
                return rid
        m = re.search(r"textarea.*?ref=(e\d+)", out)
        return m.group(1) if m else None
    except Exception:
        m = re.search(r"textarea.*?ref=(e\d+)", out)
        return m.group(1) if m else None


def conteo():
    js = "(()=>{const n=[...document.querySelectorAll('button')].find(b=>/Todos \\(/.test(b.textContent))?.textContent;return n||'?';})()"
    out = eval_js(js).strip()
    m = re.search(r"Todos \((\d+)\)", out)
    return int(m.group(1)) if m else -1


def main():
    print("conteo inicial:", conteo())
    for doc in DOCS:
        if conteo() > DOCS.index(doc):
            print(f"{doc}: ya está importado, salto")
            continue
        eval_js("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Importar JSON');if(b)b.click();return 'ok';})()")
        import time
        time.sleep(1.5)
        ref = ref_textarea()
        if not ref:
            print(f"{doc}: no encontré la textarea, fallo")
            sys.exit(1)
        contenido = (RAIZ / "moldes-finales" / f"{doc}.molde.json").read_text()
        r = ab("fill", f"@{ref}", contenido)
        if "✗" in r:
            print(f"{doc}: fill fallo: {r[:200]}")
            sys.exit(1)
        time.sleep(0.8)
        out = eval_js("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Importar');if(b){b.click();return 'clicked';}return 'no-btn';})()")
        time.sleep(2.5)
        n = conteo()
        err = eval_js("(()=>{const e=document.querySelector('[role=alert]');return e?e.textContent.slice(0,150):'';})()")
        print(f"{doc}: importado -> Todos({n}) {out} {err}")
    print("conteo final:", conteo())


if __name__ == "__main__":
    main()
