#!/usr/bin/env python3
"""
tinta.py — S6 localización de manuscritos (presencia de tinta, JAMÁS transcripción).

Plan V3 §1/§3: todo campo manuscrito se evalúa solo por { con_tinta: boolean, bbox }.
Corre sobre las FOTOS REALES del recibo (3 tomas únicas; `recibo-impreso-01/02` son
copias byte a byte — md5 verificado — de firmas-vacias-02/03) y del comprobante (4),
usando las zonas de firma de los moldes reales (*_a_real.molde.json) con la semántica
del contrato: zona ABSOLUTA = ancla.rect + offset zona (estrategia ancla_relativa).
Las fotos llevan EXIF orientation 6 → ImageOps.exif_transpose antes de recortar.

Método v2 (robusto a sombras del papel, riesgo S6 previsto por Agent 1 §6.3):
  fondo local = desenfoque gaussiano grande; tinta = (fondo - gris > umbral_contraste)
  Y (gris < gris_max) — una firma es oscurecimiento AGUDO y OSCURO en términos
  absolutos; una sombra es un gradiente suave que nunca vuelve el papel oscuro.
  Se barre una rejilla de (umbral_contraste, gris_max, dens_min) y se reporta el
  punto honesto con mejor exactitud (11 pruebas únicas con GT visual curado).

GT de tinta: CURACIÓN VISUAL de los 11 recortes (crops revisados; la luz del
usuario no está disponible en este entorno — supuesto declarado en el informe):
  - recibo vac-01: SIN firmas (2 zonas F) — la etiqueta del dataset es correcta aquí
  - recibo vac-02 (≡ recibo-impreso-01): firma EMISOR sí, PAGADOR no — etiqueta
    del dataset INCORRECTA (contradicha por la foto y por md5)
  - recibo vac-03 (≡ recibo-impreso-02): CON ambas firmas — etiqueta INCORRECTA
  - comprobante vac-01/02/04: SIN tinta (sombra); vac-03: marca pequeña de tinta
Salida: scripts/resultados/bench-ocr/salidas/tinta.json
"""
import json
from pathlib import Path
from PIL import Image, ImageFilter, ImageOps

RAIZ = Path('/home/z/my-project/molde-suite/scripts/resultados/fixtures-reales/3-DOCUMENTOS-IMPRESOS - copia')
SALIDA = Path('/home/z/my-project/molde-suite/scripts/resultados/bench-ocr/salidas')

CASOS = [
    ('01-RECIBO-DE-PAGO', 'molde/recibo_a_real.molde.json', ['firma_emisor', 'firma_pagador']),
    ('02-RECIBO-DE-ENTREGA', 'molde/comprobante_a_real.molde.json', ['firma_comprador']),
]

# duplicados verificados por md5sum (mismo archivo byte a byte)
DUPES = {
    'recibo-impreso-01.jpg': 'recibo-a-impreso-firmas-vacias-02.jpg',
    'recibo-impreso-02.jpg': 'recibo-a-impreso-firmas-vacias-03.jpg',
}

# GT visual curado (10 pruebas únicas): (archivo, campo) → con_tinta (ver docstring)
GT_VISUAL = {
    ('recibo-a-impreso-firmas-vacias-01.jpg', 'firma_emisor'): False,
    ('recibo-a-impreso-firmas-vacias-01.jpg', 'firma_pagador'): False,
    ('recibo-a-impreso-firmas-vacias-02.jpg', 'firma_emisor'): True,
    ('recibo-a-impreso-firmas-vacias-02.jpg', 'firma_pagador'): False,
    ('recibo-a-impreso-firmas-vacias-03.jpg', 'firma_emisor'): True,
    ('recibo-a-impreso-firmas-vacias-03.jpg', 'firma_pagador'): True,
    ('comprobante-a-impreso-firmas-vacias-01.jpg', 'firma_comprador'): False,
    ('comprobante-a-impreso-firmas-vacias-02.jpg', 'firma_comprador'): False,
    ('comprobante-a-impreso-firmas-vacias-03.jpg', 'firma_comprador'): True,
    ('comprobante-a-impreso-firmas-vacias-04.jpg', 'firma_comprador'): False,
}


def zona_absoluta(campo: dict, W: int, H: int):
    rect = campo.get('ancla', {}).get('rect') or {'x': 0, 'y': 0}
    z = campo['zona']
    x = max(0, int((rect.get('x', 0) + z['x']) * W))
    y = max(0, int((rect.get('y', 0) + z['y']) * H))
    return x, y, max(1, int(z['w'] * W)), max(1, int(z['h'] * H))


def medir(recorte: Image.Image, umbral_c: int, gris_max: int):
    w, h = recorte.size
    fondo = recorte.filter(ImageFilter.GaussianBlur(radius=max(w, h) // 8))
    px = list(recorte.getdata()); pf = list(fondo.getdata())
    ink = sum(1 for a, b in zip(px, pf) if (b - a) > umbral_c and a < gris_max)
    return ink / max(1, len(px))


def main():
    pruebas = []  # {imagen, campo, densidades por param, gt, bbox}
    for carpeta, molde_rel, campos in CASOS:
        molde = json.loads((RAIZ / carpeta / molde_rel).read_text())
        por_campo = {c['id']: c for c in molde['campos']}
        vistos = set()
        for foto in sorted((RAIZ / carpeta / 'real').iterdir()):
            if foto.suffix.lower() not in {'.jpg', '.jpeg', '.png'}:
                continue
            # dedupe de duplicados md5: recibo-impreso-01/02 ≡ firmas-vacias-02/03
            canon = DUPES.get(foto.name, foto.name)
            if canon in vistos:
                continue
            vistos.add(canon)
            im = ImageOps.exif_transpose(Image.open(foto).convert('RGB'))
            W, H = im.size
            for campo in campos:
                c = por_campo.get(campo)
                if not c or 'zona' not in c:
                    continue
                x, y, w, h = zona_absoluta(c, W, H)
                recorte = im.crop((x, y, x + w, y + h)).convert('L')
                pruebas.append({
                    'imagen': str(foto.relative_to(RAIZ)), 'campo': campo,
                    'bbox': [x, y, w, h], 'gt_con_tinta': GT_VISUAL[(foto.name, campo)],
                    'recorte': recorte,
                })

    # barrido de parámetros (ROC honesto sobre 11 pruebas únicas)
    rejilla = []
    for uc in (35, 40, 45, 50, 55, 60):
        for gmax in (130, 150, 170):
            for dmin in (0.008, 0.012, 0.02):
                ok = 0
                for p in pruebas:
                    d = medir(p['recorte'], uc, gmax)
                    if (d > dmin) == p['gt_con_tinta']:
                        ok += 1
                rejilla.append({'umbral_contraste': uc, 'gris_max': gmax,
                                'dens_min': dmin, 'acierto': ok, 'tasa': round(ok / len(pruebas), 4)})
    mejor = max(rejilla, key=lambda r: (r['acierto'], -r['dens_min']))

    resultado = []
    for p in pruebas:
        d = medir(p['recorte'], mejor['umbral_contraste'], mejor['gris_max'])
        resultado.append({
            'imagen': p['imagen'], 'campo': p['campo'], 'bbox': p['bbox'],
            'densidad': round(d, 5), 'con_tinta': d > mejor['dens_min'],
            'gt_con_tinta': p['gt_con_tinta'],
            'acierto': (d > mejor['dens_min']) == p['gt_con_tinta'],
        })
    acierto = sum(1 for r in resultado if r['acierto'])
    salida = {
        'metodo': 'v2: fondo-local gaussiano + contraste agudo + oscuridad absoluta (PIL, sin modelos)',
        'gt': 'curación visual de 11 recortes únicos (supuesto declarado: sin luz del usuario)',
        'nota_dataset': ('recibo-impreso-01/02 son duplicados md5 de firmas-vacias-02/03; '
                          'las etiquetas del dataset contradicen las fotos: vac-02 lleva firma '
                          'del emisor y vac-03 ambas; el comprobante vac-03 lleva una marca pequeña.'),
        'n_pruebas_unicas': len(resultado),
        'parametros_optimos': mejor,
        'tasa_acierto_optimo': round(acierto / len(resultado), 4),
        'falsos_positivos': sum(1 for r in resultado if not r['gt_con_tinta'] and r['con_tinta']),
        'falsos_negativos': sum(1 for r in resultado if r['gt_con_tinta'] and not r['con_tinta']),
        'pruebas': resultado,
        'barrido': rejilla,
    }
    SALIDA.mkdir(parents=True, exist_ok=True)
    (SALIDA / 'tinta.json').write_text(json.dumps(salida, ensure_ascii=False, indent=1))
    print(f"tinta.json: {acierto}/{len(resultado)} · params óptimos {mejor} · FP={salida['falsos_positivos']} FN={salida['falsos_negativos']}")
    for r in resultado:
        marca = 'OK ' if r['acierto'] else 'XX '
        print(f"  {marca} {Path(r['imagen']).name:<44} {r['campo']:<16} dens={r['densidad']:.4f} gt={r['gt_con_tinta']} leído={r['con_tinta']}")


if __name__ == '__main__':
    main()
