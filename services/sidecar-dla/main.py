"""
Sidecar DLA — Nivel 3 (blueprint DLA) del plan de integración para Molde Suite.

Propósito
---------
Acelerar la CALIBRACIÓN de moldes en Molde Studio (herramienta desktop):

  * /ocr            -> OCR rápido local con RapidOCR (texto + líneas con bbox).
  * /estructura     -> estructura documental con el CLI `chandra-ocr` (opcional).
  * /borrador-molde -> convierte esa estructura en un BORRADOR MoldeUniversal v3.

Este servicio es OPCIONAL y SOLO para calibración desktop: Tamiz JAMÁS depende
de él (ningún flujo de producción pasa por aquí). Ver services/sidecar-dla/README.md.

Principio de honestidad
-----------------------
* /salud reporta ÚNICAMENTE las capacidades que realmente están instaladas.
* Si falta una dependencia opcional, el endpoint correspondiente responde 503
  con un mensaje claro; NUNCA se inventan resultados.
* Las zonas sin bbox real son PLACEHOLDERS que deben recalibrarse en el editor.

Ejecución: escucha SOLO en 127.0.0.1:3070 (herramienta local, no exponer a red).
"""

from __future__ import annotations

import html as html_mod
import importlib.util
import json
import os
import re
import secrets
import shutil
import subprocess
import tempfile
from typing import Any, Dict, List, Optional, Set, Tuple, Union

from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------

APP_HOST = "127.0.0.1"  # SOLO localhost: herramienta de calibración local.
APP_PORT = 3070

MAX_CAMPOS = 120          # tope de campos por borrador (bandera "truncada")
LIMITE_ETIQUETA = 80      # etiqueta <= 80 caracteres (esquema MoldeUniversal)
UMBRAL_DEFECTO = 0.02     # umbral de tinta por defecto del esquema v3
MIN_ZONA = 0.002          # tamaño mínimo de zona tras el clamp (garantiza w>0, h>0)
CHANDRA_TIMEOUT_S = 120   # timeout del CLI chandra-ocr

# Placeholder HONESTO para líneas sin bbox utilizable: NO representa la
# posición real del texto y DEBE recalibrarse en el editor de Molde Studio.
ZONA_PLACEHOLDER: Dict[str, float] = {"x": 0.1, "y": 0.1, "w": 0.8, "h": 0.05}

BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz"

RE_CHECKBOX = re.compile(r"casilla|checkbox|\[ \]|\[x\]", re.IGNORECASE)
RE_FIRMA = re.compile(r"firma|signature", re.IGNORECASE)

# HTML simple: <h1>-<h4>, <p>, <li>, <td> con etiqueta de cierre.
RE_BLOQUES_HTML = re.compile(
    r"<(h[1-4]|p|li|td)\b[^>]*>(.*?)</\1\s*>",
    re.IGNORECASE | re.DOTALL,
)

app = FastAPI(
    title="Sidecar DLA (Molde Studio)",
    version="0.1.0",
    description=(
        "Nivel 3 — blueprint DLA: OCR / estructura / borrador de molde para "
        "calibración desktop. OPCIONAL: Tamiz nunca depende de esto."
    ),
)


# ---------------------------------------------------------------------------
# Capacidades (honestidad: se reporta lo que REALMENTE está importable)
# ---------------------------------------------------------------------------


def _spec_disponible(nombre_modulo: str) -> bool:
    """True solo si el módulo existe en el entorno actual (find_spec)."""
    try:
        return importlib.util.find_spec(nombre_modulo) is not None
    except (ImportError, ValueError):
        return False


def _capacidad_pdf() -> bool:
    """True si pdf2image O pypdf se pueden importar (reporte honesto de /salud)."""
    for nombre in ("pdf2image", "pypdf"):
        try:
            importlib.import_module(nombre)
            return True
        except Exception:
            continue
    return False


# Motor RapidOCR con carga perezosa y cacheada (instanciar carga los modelos).
_motor_ocr: Optional[Any] = None
_motor_ocr_intentado: bool = False


def _obtener_motor_ocr() -> Optional[Any]:
    """Carga perezosa de RapidOCR. Devuelve None si no está disponible."""
    global _motor_ocr, _motor_ocr_intentado
    if _motor_ocr_intentado:
        return _motor_ocr
    _motor_ocr_intentado = True
    try:
        from rapidocr_onnxruntime import RapidOCR  # type: ignore

        _motor_ocr = RapidOCR()
    except Exception:
        # Honesto: sin RapidOCR no se simula nada; /ocr responderá 503.
        _motor_ocr = None
    return _motor_ocr


# ---------------------------------------------------------------------------
# Imagen / PDF (imports perezosos: el sidecar debe arrancar sin dependencias
# opcionales para que /salud y /borrador-molde sigan funcionando)
# ---------------------------------------------------------------------------


def _decodificar_imagen(datos: bytes) -> Any:
    """Decodifica bytes de imagen a ndarray (cv2 llega con RapidOCR)."""
    try:
        import cv2  # type: ignore
        import numpy as np  # type: ignore
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail={"error": "No se pudo cargar OpenCV/numpy (dependencias de RapidOCR). Instala el venv del sidecar con requirements.txt."},
        ) from exc
    arreglo = cv2.imdecode(np.frombuffer(datos, dtype=np.uint8), cv2.IMREAD_COLOR)
    if arreglo is None:
        raise HTTPException(
            status_code=400,
            detail={"error": "El archivo no es una imagen decodificable (y no se detectó como PDF)."},
        )
    return arreglo


def _pdf_primera_pagina_a_imagen(datos: bytes) -> Any:
    """Rasteriza la PRIMERA página de un PDF con pdf2image (requiere poppler)."""
    try:
        from pdf2image import convert_from_bytes  # type: ignore
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail={"error": "El archivo es PDF pero la rasterización no está disponible: se requiere 'pdf2image' (+ poppler instalado en el sistema). Instálala en el venv del sidecar o sube una imagen."},
        ) from exc
    try:
        paginas = convert_from_bytes(datos, dpi=200, first_page=1, last_page=1)
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail={"error": f"No se pudo rasterizar el PDF (¿poppler instalado?): {exc}"},
        ) from exc
    if not paginas:
        raise HTTPException(status_code=503, detail={"error": "El PDF no tiene páginas legibles."})
    try:
        import numpy as np  # type: ignore
    except Exception as exc:
        raise HTTPException(status_code=503, detail={"error": "Falta numpy para convertir la página del PDF a imagen."}) from exc
    return np.array(paginas[0].convert("RGB"))


def _preparar_imagen(nombre_archivo: str, datos: bytes) -> Any:
    """Devuelve un ndarray listo para RapidOCR; si es PDF, rasteriza la 1ª página."""
    es_pdf = nombre_archivo.lower().endswith(".pdf") or datos[:5] == b"%PDF-"
    if es_pdf:
        return _pdf_primera_pagina_a_imagen(datos)
    return _decodificar_imagen(datos)


# ---------------------------------------------------------------------------
# OCR
# ---------------------------------------------------------------------------


def _ejecutar_ocr(motor: Any, imagen: Any) -> List[Dict[str, Any]]:
    """Corre RapidOCR y normaliza su salida a [{texto, bbox, conf}]."""
    try:
        salida = motor(imagen)
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"error": f"RapidOCR falló al procesar la imagen: {exc}"}) from exc
    # Formato clásico de rapidocr-onnxruntime: (resultado, tiempos) con
    # resultado = [[caja(4 puntos), texto, score], ...] o None si no hay texto.
    resultado = salida[0] if isinstance(salida, tuple) and salida else salida
    lineas: List[Dict[str, Any]] = []
    if not resultado:
        return lineas
    for fila in resultado:
        try:
            caja, texto, score = fila[0], fila[1], fila[2]
            xs = [float(p[0]) for p in caja]
            ys = [float(p[1]) for p in caja]
            lineas.append(
                {
                    "texto": str(texto),
                    "bbox": [round(min(xs), 2), round(min(ys), 2), round(max(xs), 2), round(max(ys), 2)],
                    "conf": round(float(score), 4),
                }
            )
        except (TypeError, ValueError, IndexError):
            # Fila malformada: se omite (honestidad: no se inventa texto).
            continue
    return lineas


# ---------------------------------------------------------------------------
# Geometría: normalización de rects (función PURA, sin efectos secundarios)
# ---------------------------------------------------------------------------


def _clamp(valor: float, minimo: float, maximo: float) -> float:
    """Limita valor a [minimo, maximo]."""
    return max(minimo, min(maximo, valor))


def normalizar_rect(b: Any, ancho: float, alto: float) -> Dict[str, float]:
    """
    Convierte un bbox en zona normalizada {x, y, w, h} en 0-1 con clamp
    defensivo. Función PURA.

    Formas aceptadas de `b`:
      * [x0, y0, x1, y1] (lista/tupla de 4 números)
      * {"x0": .., "y0": .., "x1": .., "y1": ..}
      * {"x": .., "y": .., "w": .., "h": ..}

    Garantías: coordenadas en [0, 1], w > 0 y h > 0 (mínimo MIN_ZONA) y la zona
    queda dentro de la página (x + w <= 1, y + h <= 1).
    """
    if isinstance(b, dict):
        if all(k in b for k in ("x0", "y0", "x1", "y1")):
            x0, y0, x1, y1 = (float(b[k]) for k in ("x0", "y0", "x1", "y1"))
        elif all(k in b for k in ("x", "y", "w", "h")):
            x0, y0 = float(b["x"]), float(b["y"])
            x1, y1 = x0 + float(b["w"]), y0 + float(b["h"])
        else:
            raise ValueError("bbox dict sin claves reconocidas (x0/y0/x1/y1 o x/y/w/h)")
    else:
        valores = list(b)[:4]
        if len(valores) != 4:
            raise ValueError("bbox debe tener 4 valores")
        x0, y0, x1, y1 = (float(v) for v in valores)

    # Los OCR a veces entregan esquinas desordenadas: se ordenan.
    x0, x1 = min(x0, x1), max(x0, x1)
    y0, y1 = min(y0, y1), max(y0, y1)

    ancho_seg = float(ancho) if ancho and float(ancho) > 0 else 1.0
    alto_seg = float(alto) if alto and float(alto) > 0 else 1.0

    nx0 = _clamp(x0 / ancho_seg, 0.0, 1.0)
    ny0 = _clamp(y0 / alto_seg, 0.0, 1.0)
    nx1 = _clamp(x1 / ancho_seg, 0.0, 1.0)
    ny1 = _clamp(y1 / alto_seg, 0.0, 1.0)

    w = max(nx1 - nx0, MIN_ZONA)
    h = max(ny1 - ny0, MIN_ZONA)
    if nx0 + w > 1.0:
        nx0 = max(0.0, 1.0 - w)
    if ny0 + h > 1.0:
        ny0 = max(0.0, 1.0 - h)

    return {"x": round(nx0, 6), "y": round(ny0, 6), "w": round(w, 6), "h": round(h, 6)}


# ---------------------------------------------------------------------------
# Extracción de líneas desde la estructura (Chandra JSON / líneas / HTML-MD)
# ---------------------------------------------------------------------------


def _numeros_bbox(valor: Any) -> Optional[List[float]]:
    """Intenta leer [x0, y0, x1, y1] desde lista plana, polígono, pares o dict."""
    try:
        if isinstance(valor, dict):
            if all(k in valor for k in ("x0", "y0", "x1", "y1")):
                return [float(valor["x0"]), float(valor["y0"]), float(valor["x1"]), float(valor["y1"])]
            if all(k in valor for k in ("x", "y", "w", "h")):
                x, y, w, h = float(valor["x"]), float(valor["y"]), float(valor["w"]), float(valor["h"])
                return [x, y, x + w, y + h]
            return None
        if isinstance(valor, (list, tuple)):
            if len(valor) == 4 and all(isinstance(v, (int, float)) for v in valor):
                return [float(v) for v in valor]
            if len(valor) == 8 and all(isinstance(v, (int, float)) for v in valor):
                # Polígono plano [x0,y0, x1,y0, x1,y1, x0,y1] -> envolvente.
                xs = [float(valor[i]) for i in (0, 2, 4, 6)]
                ys = [float(valor[i]) for i in (1, 3, 5, 7)]
                return [min(xs), min(ys), max(xs), max(ys)]
            if valor and all(isinstance(p, (list, tuple)) and len(p) >= 2 for p in valor):
                # Lista de puntos [[x, y], ...] -> envolvente.
                xs = [float(p[0]) for p in valor]
                ys = [float(p[1]) for p in valor]
                return [min(xs), min(ys), max(xs), max(ys)]
    except (TypeError, ValueError):
        return None
    return None


def _bbox_de_nodo(nodo: Dict[str, Any]) -> Optional[List[float]]:
    """Busca un bbox utilizable en las claves habituales de un nodo OCR."""
    for clave in ("bbox", "caja", "box", "rect", "poly", "poligono"):
        numeros = _numeros_bbox(nodo.get(clave))
        if numeros:
            return numeros
    return None


def _item_linea(nodo: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Convierte un nodo OCR ({texto|text, bbox?}) en línea normalizada."""
    texto: Any = nodo.get("texto") or nodo.get("text") or ""
    if isinstance(texto, (list, tuple)):
        texto = " ".join(str(t) for t in texto if str(t).strip())
    if not isinstance(texto, str):
        texto = str(texto)
    texto = texto.strip()
    if not texto:
        return None
    return {"texto": texto, "bbox": _bbox_de_nodo(nodo)}


def _limpiar_html(fragmento: str) -> str:
    """Quita etiquetas internas, decodifica entidades y colapsa espacios."""
    sin_tags = re.sub(r"<[^>]+>", " ", fragmento)
    plano = html_mod.unescape(sin_tags)
    return re.sub(r"\s+", " ", plano).strip()


def _lineas_desde_texto_html(texto: str) -> List[Dict[str, Any]]:
    """
    Extrae líneas visibles de un string HTML/Markdown con una regex simple
    sobre <h1>-<h4>, <p>, <li> y <td>. Si no hay etiquetas (MD/texto plano),
    cae a líneas no vacías. Sin bbox (el texto no trae geometría).
    """
    lineas: List[Dict[str, Any]] = []
    for _etiqueta, contenido in RE_BLOQUES_HTML.findall(texto):
        limpio = _limpiar_html(contenido)
        if limpio:
            lineas.append({"texto": limpio, "bbox": None})
    if not lineas:
        # Fallback Markdown / texto plano: cada línea no vacía es una línea.
        for cruda in texto.splitlines():
            limpia = _limpiar_html(cruda)
            if limpia:
                lineas.append({"texto": limpia, "bbox": None})
    return lineas


def _dimensiones_pagina(estructura: Any) -> Optional[Tuple[float, float]]:
    """Busca (ancho, alto) de la página en claves comunes del JSON de OCR."""
    if not isinstance(estructura, dict):
        return None
    pares = (
        ("width", "height"),
        ("ancho", "alto"),
        ("page_width", "page_height"),
        ("ancho_pagina", "alto_pagina"),
    )
    for clave_a, clave_b in pares:
        valor_a, valor_b = estructura.get(clave_a), estructura.get(clave_b)
        try:
            if valor_a and valor_b and float(valor_a) > 0 and float(valor_b) > 0:
                return (float(valor_a), float(valor_b))
        except (TypeError, ValueError):
            continue
    for contenedor in (estructura.get("page"), estructura.get("pagina")):
        if isinstance(contenedor, dict):
            dims = _dimensiones_pagina(contenedor)
            if dims:
                return dims
    return None


def _extraer_lineas_estructura(
    estructura: Union[Dict[str, Any], str],
) -> Tuple[List[Dict[str, Any]], Optional[Tuple[float, float]]]:
    """
    Normaliza la entrada a una lista de líneas [{"texto": str, "bbox": ...}]
    más las dimensiones de página (ancho, alto) si el JSON las trae.

    Formatos aceptados:
      * dict con "blocks"/"bloques" (estilo Chandra): cada bloque trae "lines"
        (texto + bbox/poly) o texto/bbox propios.
      * dict con "lineas"/"lines": lista directa de líneas ({texto, bbox} o str).
      * str: se interpreta como HTML/Markdown (regex sobre h1-h4/p/li/td).
    """
    if isinstance(estructura, str):
        return _lineas_desde_texto_html(estructura), None
    if not isinstance(estructura, dict):
        raise HTTPException(
            status_code=400,
            detail={"error": "'estructura' debe ser un objeto JSON o un string (HTML/Markdown/texto)."},
        )

    dims = _dimensiones_pagina(estructura)
    lineas: List[Dict[str, Any]] = []

    # Estilo Chandra: bloques que contienen líneas (o texto/bbox propios).
    bloques = estructura.get("blocks") or estructura.get("bloques")
    if isinstance(bloques, list):
        for bloque in bloques:
            if not isinstance(bloque, dict):
                continue
            sublineas = bloque.get("lines") or bloque.get("lineas")
            if isinstance(sublineas, list) and sublineas:
                for linea in sublineas:
                    if isinstance(linea, dict):
                        item = _item_linea(linea)
                        if item:
                            lineas.append(item)
            else:
                item = _item_linea(bloque)
                if item:
                    lineas.append(item)

    # Lista directa de líneas.
    if not lineas:
        directas = estructura.get("lineas") or estructura.get("lines")
        if isinstance(directas, list):
            for linea in directas:
                if isinstance(linea, dict):
                    item = _item_linea(linea)
                    if item:
                        lineas.append(item)
                elif isinstance(linea, str) and linea.strip():
                    lineas.append({"texto": linea.strip(), "bbox": None})

    # Último recurso: texto plano dentro del dict ("texto"/"text").
    if not lineas:
        plano = estructura.get("texto") or estructura.get("text")
        if isinstance(plano, str) and plano.strip():
            lineas = _lineas_desde_texto_html(plano)

    return lineas, dims


# ---------------------------------------------------------------------------
# Construcción del borrador MoldeUniversal v3
# ---------------------------------------------------------------------------


def _nuevo_id_campo(ids_usados: Set[str]) -> str:
    """ID corto estilo 'campo_ab12cd' (6 caracteres base36, único por borrador)."""
    for _ in range(50):
        candidato = "campo_" + "".join(secrets.choice(BASE36) for _ in range(6))
        if candidato not in ids_usados:
            ids_usados.add(candidato)
            return candidato
    # Colisión persistente (prácticamente imposible con base36^6): alarga el id.
    candidato = "campo_" + "".join(secrets.choice(BASE36) for _ in range(7))
    ids_usados.add(candidato)
    return candidato


def _clasificar_tipo(texto: str) -> str:
    """
    Clasificación gruesa por palabras clave (el editor permite corregir):
    checkbox si menciona casilla/checkbox/[ ]/[x]; firma si menciona
    firma/signature; en otro caso texto.
    """
    if RE_CHECKBOX.search(texto):
        return "checkbox"
    if RE_FIRMA.search(texto):
        return "firma"
    return "texto"


def _zona_desde_bbox(bbox: Optional[List[float]], dims: Optional[Tuple[float, float]]) -> Dict[str, float]:
    """
    Convierte el bbox de una línea en zona normalizada.

    HONESTIDAD: si no hay bbox utilizable (o es px sin dimensiones de página),
    se devuelve el PLACEHOLDER ZONA_PLACEHOLDER, que DEBE recalibrarse en el
    editor de Molde Studio (no representa la posición real del texto).
    """
    if not bbox or len(bbox) != 4:
        return dict(ZONA_PLACEHOLDER)
    try:
        x0, y0, x1, y1 = (float(v) for v in bbox)
    except (TypeError, ValueError):
        return dict(ZONA_PLACEHOLDER)
    en_rango_unitario = all(0.0 <= v <= 1.0 for v in (x0, y0, x1, y1))
    if en_rango_unitario and x1 > x0 and y1 > y0:
        # Heurística: bbox ya viene normalizado en [0, 1] -> página de 1x1.
        return normalizar_rect([x0, y0, x1, y1], 1.0, 1.0)
    if dims and dims[0] > 0 and dims[1] > 0:
        # Bbox en píxeles + dimensiones de página declaradas por el OCR.
        return normalizar_rect([x0, y0, x1, y1], dims[0], dims[1])
    # Bbox en píxeles sin dimensiones de página: no se puede normalizar con
    # honestidad -> placeholder recalibrable en el editor.
    return dict(ZONA_PLACEHOLDER)


def _campos_desde_lineas(
    lineas: List[Dict[str, Any]],
    dims: Optional[Tuple[float, float]],
) -> Tuple[List[Dict[str, Any]], bool]:
    """
    Mapea líneas -> campos CampoUniversal del BORRADOR.

    Todos los campos son draft: estrategia 'zona_fija', umbral 0.02 y
    obligatorio False. Tope MAX_CAMPOS; si se supera, se recorta y se marca
    la bandera 'truncada'.
    """
    campos: List[Dict[str, Any]] = []
    ids_usados: Set[str] = set()
    truncada = False
    for linea in lineas:
        if len(campos) >= MAX_CAMPOS:
            truncada = True  # se recorta al tope y se avisa honestamente
            break
        texto = linea["texto"]
        campos.append(
            {
                "id": _nuevo_id_campo(ids_usados),
                "etiqueta": texto[:LIMITE_ETIQUETA],
                "pagina": 1,
                "tipo": _clasificar_tipo(texto),
                "estrategia": "zona_fija",
                "zona": _zona_desde_bbox(linea.get("bbox"), dims),
                "umbral": UMBRAL_DEFECTO,
                "obligatorio": False,
            }
        )
    return campos, truncada


# ---------------------------------------------------------------------------
# Modelos de cuerpo (Pydantic)
# ---------------------------------------------------------------------------


class CuerpoBorrador(BaseModel):
    """Cuerpo de POST /borrador-molde."""

    # Estructura Chandra-style (dict) o texto HTML/Markdown (str).
    estructura: Union[Dict[str, Any], str]
    # Opcionales informativos del molde.
    nombre: Optional[str] = None
    documento: Optional[str] = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/salud")
def salud() -> Dict[str, Any]:
    """Estado del sidecar + capacidades REALES (honestas) del entorno."""
    try:
        capacidades = {
            "rapidocr": _spec_disponible("rapidocr_onnxruntime"),
            "chandra": _spec_disponible("chandra_ocr"),
            "pdf": _capacidad_pdf(),
        }
        return {"estado": "ok", "capacidades": capacidades}
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"error": str(exc)}) from exc


@app.post("/ocr")
def ocr(archivo: UploadFile = File(...)) -> Dict[str, Any]:
    """
    OCR local con RapidOCR sobre una imagen (o la 1ª página de un PDF).

    Devuelve {"texto": str, "lineas": [{"texto", "bbox": [x0,y0,x1,y1], "conf"}]}
    con bboxes en píxeles de la imagen procesada.
    """
    try:
        motor = _obtener_motor_ocr()
        if motor is None:
            raise HTTPException(
                status_code=503,
                detail={
                    "error": "RapidOCR no está disponible en este entorno. Instala el venv del sidecar con 'pip install -r requirements.txt' (rapidocr-onnxruntime) y reinicia. Sin él, /ocr no puede correr y NO se inventan resultados."
                },
            )
        datos = archivo.file.read()
        if not datos:
            raise HTTPException(status_code=400, detail={"error": "El archivo subido está vacío."})
        imagen = _preparar_imagen(archivo.filename or "", datos)
        lineas = _ejecutar_ocr(motor, imagen)
        texto = "\n".join(linea["texto"] for linea in lineas)
        return {"texto": texto, "lineas": lineas}
    except HTTPException:
        raise
    except Exception as exc:  # defensa: error inesperado -> 500 honesto
        raise HTTPException(status_code=500, detail={"error": str(exc)}) from exc


@app.post("/estructura")
def estructura(archivo: UploadFile = File(...)) -> Dict[str, Any]:
    """
    Estructura documental con el CLI `chandra-ocr` (instalado por separado).

    Ejecuta ["chandra-ocr", ruta, "--format", "json"] con timeout de 120 s y
    devuelve {"estructura": <JSON parseado o texto crudo>, "origen": "chandra"}.
    """
    ruta_tmp = ""
    try:
        if shutil.which("chandra-ocr") is None:
            raise HTTPException(
                status_code=503,
                detail={
                    "error": "El binario 'chandra-ocr' no está en el PATH. Debe instalarse por separado (el nombre exacto del paquete en PyPI debe verificarse; ver README). Sin él, /estructura no corre y NO se inventa estructura."
                },
            )
        datos = archivo.file.read()
        if not datos:
            raise HTTPException(status_code=400, detail={"error": "El archivo subido está vacío."})

        sufijo = os.path.splitext(archivo.filename or "")[1].lower()
        if not re.fullmatch(r"\.[a-z0-9]{1,8}", sufijo):
            sufijo = ".png"

        with tempfile.NamedTemporaryFile(delete=False, suffix=sufijo) as tmp:
            tmp.write(datos)
            ruta_tmp = tmp.name

        proc = subprocess.run(
            ["chandra-ocr", ruta_tmp, "--format", "json"],
            capture_output=True,
            timeout=CHANDRA_TIMEOUT_S,
            check=False,
        )
    except HTTPException:
        raise
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(
            status_code=500,
            detail={"error": f"chandra-ocr excedió el timeout de {CHANDRA_TIMEOUT_S} s."},
        ) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"error": str(exc)}) from exc
    finally:
        if ruta_tmp and os.path.exists(ruta_tmp):
            try:
                os.unlink(ruta_tmp)
            except OSError:
                pass

    try:
        if proc.returncode != 0:
            stderr = (proc.stderr or b"").decode("utf-8", "replace").strip()
            raise HTTPException(
                status_code=500,
                detail={"error": f"chandra-ocr terminó con código {proc.returncode}: {stderr[:500]}"},
            )
        stdout = (proc.stdout or b"").decode("utf-8", "replace")
        try:
            parseado = json.loads(stdout)
            return {"estructura": parseado, "origen": "chandra"}
        except json.JSONDecodeError:
            # Honesto: si no es JSON válido, se entrega el texto crudo tal cual.
            return {"estructura": stdout, "origen": "chandra"}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"error": str(exc)}) from exc


@app.post("/borrador-molde")
def borrador_molde(cuerpo: CuerpoBorrador) -> Dict[str, Any]:
    """
    Convierte una estructura (Chandra-style JSON, lista de líneas o HTML/MD)
    en un BORRADOR MoldeUniversal v3.

    El borrador SIEMPRE requiere revisión y recalibración humana en el editor
    de Molde Studio: zonas placeholder, clasificación por palabras clave y
    tope de 120 campos con bandera 'truncada'.
    """
    try:
        lineas, dims = _extraer_lineas_estructura(cuerpo.estructura)
        campos, truncada = _campos_desde_lineas(lineas, dims)
        molde: Dict[str, Any] = {
            "tipo": "universal",
            "version": "3.0.0",
            "nombre": (cuerpo.nombre or "").strip() or "Borrador DLA",
            "documento": (cuerpo.documento or "").strip() or "sin_clasificar",
            "campos": campos,
            "validaciones": [],
            # Bandera informativa (clave extra tolerada por la validación del
            # Studio): el borrador superó MAX_CAMPOS y quedó recortado.
            "truncada": truncada,
        }
        resumen = {
            "total": len(campos),
            "texto": sum(1 for c in campos if c["tipo"] == "texto"),
            "checkbox": sum(1 for c in campos if c["tipo"] == "checkbox"),
            "firma": sum(1 for c in campos if c["tipo"] == "firma"),
        }
        return {"molde": molde, "resumen": resumen}
    except HTTPException:
        raise
    except Exception as exc:  # defensa: error inesperado -> 500 honesto
        raise HTTPException(status_code=500, detail={"error": str(exc)}) from exc


if __name__ == "__main__":
    import uvicorn

    # SOLO localhost: herramienta de calibración desktop, nunca expuesta a red.
    uvicorn.run(app, host=APP_HOST, port=APP_PORT)
