#!/usr/bin/env python3
"""Matriz CP-01..CP-20 de /generico/ contra el build dev de Tamiz (:3100).

Ejecuta cada caso con las referencias/variantes de `insumos-cp/`:
  1. selecciona el molde
  2. sube las imágenes por el input de galería
  3. pulsa VERIFICAR y espera el veredicto (poll con timeout por caso)
  4. captura evidencia PNG (pantalla completa)
  5. intercepta el Blob del reporte y guarda el JSON exacto que descarga la app
  6. valida el veredicto contra lo esperado por la matriz

Salida: evidencias/CP-XX.png, reportes/CP-XX.json, reportes/resumen-cp.json
"""
from __future__ import annotations

import json
import re
import subprocess
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
INSUMOS = RAIZ / "insumos-cp"
EVID = RAIZ / "evidencias"
REPORTES = RAIZ / "reportes"
EVID.mkdir(exist_ok=True)
REPORTES.mkdir(exist_ok=True)

MOLDE_COMP = "Comprobante de entrega del producto"
MOLDE_REC = "Recibo de pago"
MOLDE_E22 = "E-22 Resolución de la Comisión Escrutadora"
MOLDE_E24 = "E-24 Cuadro de resultados del escrutinio"
MOLDE_E26 = "E-26 Acta parcial del escrutinio municipal"

CASOS = [
    ("CP-01", MOLDE_COMP, ["comprobante-a-firmado.png"], ["ADVERTENCIA"], 420),
    ("CP-02", MOLDE_COMP, ["comprobante-b-llenado.png"], ["ADVERTENCIA"], 420),
    ("CP-03", MOLDE_COMP, ["comprobante-c-completado.png"], ["ADVERTENCIA"], 420),
    ("CP-04", MOLDE_COMP, ["comprobante-a-sin-firmar.png"], ["RECHAZADA"], 420),
    ("CP-05", MOLDE_REC, ["recibo-a-firmado.png"], ["ADVERTENCIA"], 420),
    ("CP-06", MOLDE_REC, ["recibo-b-llenado.png"], ["ADVERTENCIA"], 420),
    ("CP-07", MOLDE_REC, ["recibo-c-completado.png"], ["ADVERTENCIA"], 420),
    ("CP-08", MOLDE_REC, ["recibo-c-sin-llenar.png"], ["RECHAZADA"], 420),
    ("CP-09", MOLDE_E22, ["e22-p1.png", "e22-p2.png"], ["OPTIMA", "ADVERTENCIA"], 600),
    ("CP-10", MOLDE_E22, ["e22-p1.png"], ["RECHAZADA"], 600),
    ("CP-11", MOLDE_E22, ["e22-slot1-p2.png", "e22-slot2-p1.png"], ["RECHAZADA"], 600),
    ("CP-12", MOLDE_E24, ["e24-p1.png", "e24-p2.png"], ["OPTIMA", "ADVERTENCIA"], 600),
    ("CP-13", MOLDE_E24, ["e24-slot1-p2.png", "e24-slot2-p1.png"], ["RECHAZADA"], 600),
    ("CP-14", MOLDE_E26, [f"e26-p{i}.png" for i in range(1, 7)], ["OPTIMA", "ADVERTENCIA"], 900),
    ("CP-15", MOLDE_E26, ["e26-p1.png", "e26-p2.png", "e26-p3.png", "e26-p5.png", "e26-p6.png"], ["RECHAZADA"], 900),
    ("CP-16", MOLDE_E26, ["e26-p1.png", "e26-p2.png", "e26-slot3-duplicado-p2.png", "e26-p4.png", "e26-p5.png", "e26-p6.png"], ["RECHAZADA"], 900),
    ("CP-17", MOLDE_E26, ["e26-slot-1.png", "e26-slot-3.png", "e26-slot-2.png", "e26-slot-4.png", "e26-slot-5.png", "e26-slot-6.png"], ["RECHAZADA"], 900),
    ("CP-18", MOLDE_E22, ["e17-ajeno.png"], ["RECHAZADA"], 600),
    ("CP-19", MOLDE_E26, [f"e26-p{i}.png" for i in range(1, 6)] + ["e26-p6-rotada180.png"], ["OPTIMA", "ADVERTENCIA"], 900),
    ("CP-20", MOLDE_E26, [f"e26-p{i}.png" for i in range(1, 7)], ["OPTIMA", "ADVERTENCIA", "RECHAZADA"], 900),
    ("CP-20b", MOLDE_E26, [f"e26-p{i}.png" for i in range(1, 7)], ["OPTIMA", "ADVERTENCIA", "RECHAZADA"], 900),
    ("CP-20c", MOLDE_E26, [f"e26-p{i}.png" for i in range(1, 7)], ["OPTIMA", "ADVERTENCIA", "RECHAZADA"], 900),
]


def ab(*args, timeout=60):
    return subprocess.run(
        ["agent-browser", *args], capture_output=True, text=True, timeout=timeout
    ).stdout


def ab_err(*args, timeout=60):
    return subprocess.run(
        ["agent-browser", *args], capture_output=True, text=True, timeout=timeout
    ).stdout + subprocess.run(["agent-browser", *args], capture_output=True, text=True, timeout=timeout).stderr


def eval_js(js, timeout=60):
    out = ab("eval", js, timeout=timeout)
    return out.strip()


def texto_pagina():
    return eval_js("document.body.innerText")


def limpiar_salida(s):
    """quita las comillas de la respuesta del eval"""
    s = s.strip()
    if s.startswith('"') and s.endswith('"'):
        s = s[1:-1]
    return s


def seleccionar_molde(nombre):
    js = f'''(() => {{
      const sel = document.getElementById('molde');
      if (!sel) return 'no-select';
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(sel, {json.dumps(nombre)});
      sel.dispatchEvent(new Event('change', {{ bubbles: true }}));
      return 'ok';
    }})()'''
    return limpiar_salida(eval_js(js))


def subir_fotos(archivos):
    """Descubre el input de galería, lo hace visible, sube y vuelve a ocultar."""
    eval_js('(()=>{const ins=document.querySelectorAll(\'input[type=file][accept="image/*"]\');const g=ins[1]||ins[0];g.classList.remove(\'hidden\');g.style.cssText=\'position:fixed;left:0;bottom:0;opacity:0.01;\';return \'ok\';})()')
    time.sleep(0.3)
    out = ab("snapshot", "-i", "--json")
    ref = None
    try:
        d = json.loads(out)
        refs = d.get("data", {}).get("refs", {})
        for rid, n in refs.items():
            if n.get("role") in ("button", "generic") and "Elegir de galería" in str(n.get("name", "")):
                continue
        # el input visible ahora debe aparecer como textbox/file; busca por nombre de archivo o role
        for rid, n in refs.items():
            if "galería" in str(n.get("name", "")).lower() or n.get("role") == "textbox":
                continue
    except Exception:
        pass
    # refs no expone el input oculto→visible a veces; usa búsqueda por label asociada
    ref = None
    m = re.search(r"input.*?ref=(e\d+)", out)
    if m:
        ref = m.group(1)
    if not ref:
        # el input file expuesto por aria suele llamarse "Choose File" (Chrome)
        d = json.loads(out)
        refs = d.get("data", {}).get("refs", {})
        for rid, n in refs.items():
            nombre = str(n.get("name", "")).strip().lower()
            if nombre in ("choose file", "choose files", "no file chosen") or (
                n.get("role") == "button" and nombre == ""
            ):
                ref = rid
                break
    if not ref:
        raise RuntimeError("no encontré el input de galería en el snapshot: " + out[:300])
    rutas = [str(INSUMOS / a) for a in archivos]
    r = subprocess.run(["agent-browser", "upload", f"@{ref}", *rutas], capture_output=True, text=True, timeout=120)
    salida = r.stdout + r.stderr
    time.sleep(0.8)
    eval_js('(()=>{const ins=document.querySelectorAll(\'input[type=file][accept="image/*"]\');const g=ins[1]||ins[0];g.classList.add(\'hidden\');g.style.cssText=\'\';return \'ok\';})()')
    if "✗" in salida:
        raise RuntimeError("upload fallo: " + salida[:300])
    return salida


def contar_fotos():
    return int(limpiar_salida(eval_js("(()=>{const m=document.body.innerText.match(/Hojas capturadas: (\\d+)/);return m?m[1]:'0';})()")) or 0)


def verificar():
    eval_js("(()=>{const bs=[...document.querySelectorAll('button')];const b=bs.find(x=>/Verificar \\d+ hoja/.test(x.textContent));if(!b)return 'no-btn';b.click();return 'ok';})()")


def esperar_veredicto(timeout_s):
    t0 = time.time()
    ultimo = ""
    while time.time() - t0 < timeout_s:
        t = texto_pagina()
        m = re.search(r"(ÓPTIMA|ADVERTENCIA|RECHAZADA)", t)
        if m:
            return m.group(1), t, time.time() - t0
        mprog = re.search(r"(Preparando página \d+/\d+|OCR página \d+/\d+|Página \d+: campo \d+/\d+|Leyendo documento\.{0,3}|Analizando documento)", t)
        if mprog:
            ultimo = mprog.group(1)
        time.sleep(2)
    raise TimeoutError(f"sin veredicto en {timeout_s}s (último: {ultimo})")


def descargar_reporte(destino: Path):
    eval_js("(()=>{window.__cap=null;const orig=URL.createObjectURL;URL.createObjectURL=function(b){try{b.text().then(t=>{window.__cap=t;}).catch(()=>{});}catch(e){}return orig(b);};return 'hook';})()")
    eval_js("(()=>{const bs=[...document.querySelectorAll('button')];const b=bs.find(x=>/Descargar reporte JSON/.test(x.textContent));if(!b)return 'no-btn';b.click();return 'ok';})()")
    for _ in range(20):
        contenido = limpiar_salida(eval_js("window.__cap===null||window.__cap===undefined?'':window.__cap"))
        if contenido:
            try:
                datos = json.loads(contenido)
                destino.write_text(json.dumps(datos, ensure_ascii=False, indent=2), encoding="utf-8")
                return datos
            except Exception:
                time.sleep(0.5)
        time.sleep(0.5)
    return None


def nueva_captura():
    eval_js("(()=>{const bs=[...document.querySelectorAll('button')];const b=bs.find(x=>/Nueva captura/.test(x.textContent));if(!b)return 'no-btn';b.click();return 'ok';})()")


def main():
    solo = sys.argv[1:] if len(sys.argv) > 1 else None
    casos = [c for c in CASOS if not solo or c[0] in solo]
    resumen = []
    ab("open", "http://localhost:3100/generico/")
    time.sleep(6)
    for cid, molde, archivos, esperado, timeout in casos:
        print(f"\n===== {cid} ({molde}) × {len(archivos)} img =====")
        try:
            sel = seleccionar_molde(molde)
            time.sleep(1)
            if sel != "ok":
                raise RuntimeError(f"selector molde: {sel}")
            subir_fotos(archivos)
            n = contar_fotos()
            if n != len(archivos):
                raise RuntimeError(f"fotos subidas {n} != {len(archivos)}")
            verificar()
            veredicto, texto, duracion = esperar_veredicto(timeout)
            rep = REPORTES / f"{cid}.json"
            datos = descargar_reporte(rep)
            ok = veredicto in esperado
            extras = {}
            if datos:
                extras = {
                    "faltantes_duros": datos.get("faltantes_duros"),
                    "por_revisar_n": len(datos.get("por_revisar", [])),
                    "paginas_faltantes": datos.get("paginas_faltantes"),
                    "score": datos.get("metricas", {}).get("score"),
                    "tiempos": datos.get("metricas", {}).get("tiempos"),
                }
            resumen.append({
                "id": cid, "molde": molde, "imagenes": len(archivos),
                "esperado": esperado, "obtenido": veredicto,
                "resultado": "PASS" if ok else "FAIL",
                "duracion_s": round(duracion, 1),
                "reporte_json": bool(datos), **extras,
            })
            ab("screenshot", str(EVID / f"{cid}.png"), "--full", timeout=90)
            nueva_captura()
            time.sleep(1.5)
            print(f"  -> {veredicto} (esperado {esperado}) {'PASS' if ok else 'FAIL'} en {duracion:.0f}s | reporte={'si' if datos else 'NO'}")
        except Exception as e:
            resumen.append({"id": cid, "molde": molde, "resultado": "ERROR", "error": str(e)[:300]})
            ab("screenshot", str(EVID / f"{cid}.png"), "--full", timeout=90)
            try:
                nueva_captura()
            except Exception:
                pass
            print(f"  -> ERROR: {str(e)[:200]}")
    (REPORTES / "resumen-cp.json").write_text(json.dumps(resumen, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\n==== RESUMEN ====")
    for r in resumen:
        print(f"  {r['id']:<7} {r.get('resultado')} {r.get('obtenido','')} {r.get('error','')[:80]}")


if __name__ == "__main__":
    import sys
    main()
