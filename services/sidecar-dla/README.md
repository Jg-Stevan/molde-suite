# Sidecar DLA — Nivel 3 (blueprint DLA)

Servicio **OPCIONAL** en Python (FastAPI) que acelera la **calibración desktop de moldes en Molde Studio**: OCR local, lectura de estructura documental y generación de **borradores** de MoldeUniversal v3.

> **Regla dura:** esto es solo una herramienta de calibración. **Tamiz JAMÁS depende de esto** — ningún flujo de producción de las apps cliente pasa por este sidecar. Molde Studio funciona al 100 % sin levantar este servicio.

## Para qué sirve (Fase C / Nivel 3)

1. **`/ocr`** evita calibrar a ciegas: devuelve el texto y la posición (`bbox`) de cada línea detectada con RapidOCR.
2. **`/estructura`** (opcional) obtiene la estructura del documento con el CLI `chandra-ocr`.
3. **`/borrador-molde`** convierte esa estructura en un **borrador** de molde universal v3 para importar y **recalibrar en el editor** de Molde Studio.

## Ejecución

```bash
cd services/sidecar-dla
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

Queda escuchando en **http://127.0.0.1:3070** (solo localhost).

## Endpoints

| Método | Ruta | Cuerpo | Devuelve | Requiere |
|--------|------|--------|----------|----------|
| GET | `/salud` | — | `{"estado":"ok","capacidades":{"rapidocr","chandra","pdf"}}` (bools reales del entorno) | nada |
| POST | `/ocr` | multipart `archivo` (imagen o PDF) | `{"texto": str, "lineas": [{"texto","bbox":[x0,y0,x1,y1],"conf"}]}` | `rapidocr-onnxruntime`; para PDF: `pdf2image` + poppler |
| POST | `/estructura` | multipart `archivo` (imagen) | `{"estructura": <JSON o texto crudo>, "origen":"chandra"}` | binario `chandra-ocr` en el PATH (timeout 120 s) |
| POST | `/borrador-molde` | JSON `{"estructura": {...} o "...", "nombre"?, "documento"?}` | `{"molde": MoldeUniversal v3, "resumen": {total, texto, checkbox, firma}}` | nada (no usa dependencias opcionales) |

Detalles del borrador (`/borrador-molde`):

- Acepta estructura estilo Chandra (`blocks` con `lines`), listas directas de `lineas`, o un string HTML/Markdown (regex simple sobre `<h1>`-`<h4>`, `<p>`, `<li>`, `<td>`).
- Cada línea se convierte en un campo `texto` con `estrategia: "zona_fija"`, `umbral: 0.02` y `obligatorio: false`.
- Clasificación por palabras clave: `casilla|checkbox|[ ]|[x]` → `checkbox`; `firma|signature` → `firma`.
- Si la estructura no trae `bbox` utilizable, la zona es un **placeholder** (`x:0.1, y:0.1, w:0.8, h:0.05`) que **debe recalibrarse en el editor**: no representa la posición real del texto.
- Tope de 120 campos: si se supera, el borrador queda recortado y se marca la bandera `truncada: true`.

## Sobre `chandra-ocr`

- `/estructura` invoca el **binario** `chandra-ocr` (subprocess con `--format json`, timeout de 120 s).
- Debe instalarse **por separado**; **el nombre exacto del paquete en PyPI debe verificarse** antes de confiar, por eso NO se declara en `requirements.txt`.
- `/salud` reporta `chandra` vía `importlib.util.find_spec("chandra_ocr")` (el módulo Python); puede diferir de la presencia del binario en el PATH, que es lo que `/estructura` usa con `shutil.which`. Se reporta tal cual, sin disimular la diferencia.

## Seguridad

- Escucha **SOLO en `127.0.0.1:3070`**: no exponer a la red, no abrir puertos, no colocar detrás de un proxy público.
- Es una herramienta local para el operador que calibra moldes; no implementa autenticación porque nunca debe salir de la máquina.

## Principios de honestidad

1. `/salud` reporta **solo** lo que realmente está instalado e importable en el entorno; nada de capacidades "teóricas".
2. Si falta una dependencia opcional, el endpoint responde **503 con un mensaje claro** de cómo instalarla; nunca se inventan resultados ni se simula éxito.
3. Las zonas sin bbox real son **placeholders** que **deben recalibrarse** en el editor de Molde Studio.
4. Los moldes generados son **BORRADORES**: `obligatorio: false` en todos los campos, clasificación gruesa por palabras clave y tope de 120 campos con bandera `truncada`. La decisión final siempre es humana, en el editor.
