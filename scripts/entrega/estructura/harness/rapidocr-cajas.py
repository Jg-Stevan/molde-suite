#!/usr/bin/env python3
"""
rapidocr-cajas.py — Segunda fuente de cajas para la prueba S (Agente 2, plan V3 §4).

Ejecuta RapidOCR (PP-OCRv4 det+rec, ONNX, el mismo stock que Tamiz usa vía
onnxruntime-web) sobre las imágenes del dataset real y guarda SOLO las cajas de
línea {texto, poly, score} en scripts/resultados/bench-ocr/salidas/bruto/<doc>/<img>.cajas.json.
Se corre localmente (pip install rapidocr-onnxruntime); es herramienta del
benchmark, no dependencia del repo.

Uso: python3 rapidocr-cajas.py [subset]
"""
import json
import sys
from pathlib import Path

RAIZ = Path('/home/z/my-project/molde-suite/scripts/resultados/fixtures-reales/3-DOCUMENTOS-IMPRESOS - copia')
SALIDA = Path('/home/z/my-project/molde-suite/scripts/resultados/bench-ocr/salidas/bruto')

SUBSETS = {
    'recibo-escaneado': ['01-RECIBO-DE-PAGO/escaneado'],
    'e26-p1': ['03-E26-ACTA-PARCIAL-6PAG/escaneado/pag-01.png'],
}


def imagenes(subset: str | None):
    if subset and subset in SUBSETS:
        carpetas = [RAIZ / c for c in SUBSETS[subset]]
    else:
        carpetas = [RAIZ / d for d in sorted(p.name for p in RAIZ.iterdir()) if (RAIZ / d).is_dir()]
    out = []
    for carpeta in carpetas:
        if carpeta.suffix.lower() in {'.png', '.jpg', '.jpeg'}:
            out.append(carpeta)
            continue
        if carpeta.exists():
            out += [p for p in sorted(carpeta.rglob('*')) if p.suffix.lower() in {'.png', '.jpg', '.jpeg'}]
    return out


def main():
    subset = sys.argv[1] if len(sys.argv) > 1 else None
    from rapidocr_onnxruntime import RapidOCR  # import tardío para --help rápido
    ocr = RapidOCR()
    rutas = imagenes(subset)
    print(f'RapidOCR · {len(rutas)} imágenes')
    for ruta in rutas:
        rel = ruta.relative_to(RAIZ)
        doc = rel.parts[0]
        destino = SALIDA / doc / (ruta.stem + '.cajas.json')
        destino.parent.mkdir(parents=True, exist_ok=True)
        if destino.exists():
            print('  ↷ ya existe', destino.name)
            continue
        # EXIF: las fotos reales llevan orientation 6 → transponer antes de OCR
        import time
        from PIL import Image, ImageOps
        tmp = destino.with_suffix('.tmp.jpg')
        ImageOps.exif_transpose(Image.open(ruta).convert('RGB')).save(tmp, quality=95)
        t0 = time.perf_counter()
        resultado, _ = ocr(str(tmp))
        tmp.unlink(missing_ok=True)
        ms = int((time.perf_counter() - t0) * 1000)
        cajas = []
        if resultado:
            for caja, texto, score in resultado:
                cajas.append({
                    'texto': texto,
                    'poly': [[round(p[0], 1), round(p[1], 1)] for p in caja],
                    'score': round(float(score), 4),
                })
        destino.write_text(json.dumps({
            'ruta': str(rel), 'motor': 'rapidocr-onnxruntime', 'ms': ms,
            'n_lineas': len(cajas), 'cajas': cajas,
        }, ensure_ascii=False))
        print(f'  ✓ {rel} · {ms} ms · {len(cajas)} líneas')


if __name__ == '__main__':
    main()
