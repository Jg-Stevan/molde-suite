import json, os

OUT = 'apps/tamiz/public/moldes'

def campo(cid, etiqueta, ancla, arect, zona, tipo='texto', **kw):
    c = {
        'id': cid, 'etiqueta': etiqueta, 'pagina': 1, 'tipo': tipo,
        'estrategia': 'ancla_relativa',
        'zona': zona,
        'ancla': {'texto': ancla, 'rect': arect},
        'umbral': 0.02,
    }
    c.update(kw)
    return c

TITULO_R  = {'x':0.409,'y':0.088,'w':0.179,'h':0.012}
RECIBI_R  = {'x':0.135,'y':0.281,'w':0.067,'h':0.010}
SUMA_R    = {'x':0.135,'y':0.343,'w':0.080,'h':0.010}
CONCEPTO_R= {'x':0.135,'y':0.373,'w':0.107,'h':0.010}
FORMA_R   = {'x':0.136,'y':0.751,'w':0.112,'h':0.013}
FPAGO_R   = {'x':0.135,'y':0.780,'w':0.108,'h':0.012}
FIRMA_IZQ = {'x':0.288,'y':0.851,'w':0.047,'h':0.010}
FIRMA_DER = {'x':0.652,'y':0.861,'w':0.045,'h':0.010}
FECHA_A   = {'x':0.664,'y':0.154,'w':0.043,'h':0.010}
FECHA_B   = {'x':0.366,'y':0.144,'w':0.041,'h':0.020}
FECHA_C   = {'x':0.673,'y':0.157,'w':0.043,'h':0.010}
NREC_C    = {'x':0.671,'y':0.183,'w':0.075,'h':0.010}
NREC_B    = {'x':0.522,'y':0.179,'w':0.076,'h':0.012}
DNI_A     = {'x':0.313,'y':0.223,'w':0.057,'h':0.006}
DNI_B     = {'x':0.443,'y':0.225,'w':0.063,'h':0.007}
DNI_C     = {'x':0.302,'y':0.229,'w':0.056,'h':0.006}

def recibo(variante, nombre, descripcion, htr_ids, fecha_r, nrec_r, dni_r, oblig):
    def h(i):
        return {'htr': True} if i in htr_ids else {}
    campos = [
        campo('titulo','RECIBO DE PAGO','RECIBO DE PAGO',TITULO_R,
              {'x':-0.01,'y':-0.006,'w':0.26,'h':0.028},
              patron=r'.*RECIBO\s+DE\s+PAGO.*', obligatorio=True, realce=True),
        campo('fecha_emision','FECHA','Fecha',fecha_r,
              {'x':0.05,'y':-0.004,'w':0.30,'h':0.028},
              **({} if 'fecha_emision' in htr_ids else {'patron':r'\d{1,2}\s+de\s+[A-Za-zÁÉÍÓÚáéíóúñ]+\s+de\s+\d{4}'}),
              **h('fecha_emision'),
              obligatorio=('fecha_emision' in oblig), realce=True),
        campo('numero_recibo','N.º RECIBO','Recibo',nrec_r,
              {'x':0.078,'y':-0.004,'w':0.17,'h':0.026},
              **({} if 'numero_recibo' in htr_ids else {'patron':r'REC-\d{4}-\d{4}','limpiar_valor':r'((?:REC|RE)-?\d{4}-?\d{4})'}),
              **h('numero_recibo'),
              obligatorio=('numero_recibo' in oblig)),
        campo('datos_emisor','DNI EMISOR','con DNI',dni_r,
              {'x':-0.035,'y':-0.006,'w':0.30,'h':0.022},
              **({} if 'datos_emisor' in htr_ids else {'patron':r'.*DNI\s*\d{1,3}(\.\d{3}){1,3}.*'}),
              **h('datos_emisor'),
              obligatorio=('datos_emisor' in oblig)),
        campo('datos_pagador','PAGADOR (nombre y DNI)','Recibí de',RECIBI_R,
              {'x':0.09,'y':-0.004,'w':0.62,'h':0.032},
              **({} if 'datos_pagador' in htr_ids else {'patron':r'.*DNI\s*\d{1,3}(\.\d{3}){1,3}.*'}),
              **h('datos_pagador'),
              obligatorio=('datos_pagador' in oblig)),
        campo('importe','IMPORTE (€)','La suma de',SUMA_R,
              {'x':0.108,'y':-0.004,'w':0.12,'h':0.026},
              **({} if 'importe' in htr_ids else {'patron':r'.*\d{1,3}(\.\d{3})*,\d{2}.*','limpiar_valor':r'(\d{1,3}(?:\.\d{3})*,\d{2})'}),
              **h('importe'),
              obligatorio=('importe' in oblig), destacado=True, realce=True),
        campo('importe_texto','IMPORTE EN LETRAS','La suma de',SUMA_R,
              {'x':0.24,'y':-0.004,'w':0.52,'h':0.026},
              **h('importe_texto'),
              obligatorio=False),
        campo('concepto','CONCEPTO','En concepto de',CONCEPTO_R,
              {'x':0.14,'y':-0.004,'w':0.64,'h':0.032},
              **h('concepto'),
              obligatorio=('concepto' in oblig)),
        campo('forma_pago','FORMA DE PAGO','Forma de pago',FORMA_R,
              {'x':0.14,'y':-0.004,'w':0.62,'h':0.028},
              **h('forma_pago'),
              obligatorio=('forma_pago' in oblig)),
        campo('fecha_pago','FECHA DE PAGO','Fecha de pago',FPAGO_R,
              {'x':0.138,'y':-0.004,'w':0.18,'h':0.026},
              **({} if 'fecha_pago' in htr_ids else {'patron':r'\d{1,2}[/-]\d{1,2}[/-]\d{2,4}'}),
              **h('fecha_pago'),
              obligatorio=('fecha_pago' in oblig)),
        campo('firma_emisor','Firma emisor','Firma',FIRMA_IZQ,
              {'x':-0.168,'y':-0.074,'w':0.34,'h':0.062}, tipo='firma',
              umbral=0.02, obligatorio=('firma_emisor' in oblig)),
        campo('firma_pagador','Firma pagador','Firma',FIRMA_DER,
              {'x':-0.161,'y':-0.074,'w':0.34,'h':0.062}, tipo='firma',
              umbral=0.02, obligatorio=('firma_pagador' in oblig)),
    ]
    m = {
        'tipo':'universal','version':'1.0.0','nombre':nombre,'descripcion':descripcion,
        'documento':'generico/recibo_pago','idioma':'es','campos':campos,
        'huella':{'frasesClave':['RECIBO DE PAGO','La suma de','En concepto de','Forma de pago'],
                  'paginas':1,'franja':{'x':0,'y':0,'w':1,'h':0.85},'minFrases':2},
        'meta':{'orden':11,'estado':'activo','etiquetaCampos':'Campos mapeados'},
    }
    fn = os.path.join(OUT, 'recibo_%s_real.molde.json' % variante)
    open(fn,'w',encoding='utf-8').write(json.dumps(m,ensure_ascii=False,indent=2))
    return fn, len(campos)

esc = []
esc.append(recibo('a','Recibo de pago — A (impreso)',
  'Variante A del papel real: datos IMPRESOS y firmas vacías. Calibrado sobre fotos reales 2026-11-25 (sonda de anclas). Sin htr: todo dato es imprenta y se exige patrón.',
  set(), FECHA_A, NREC_C, DNI_A,
  {'fecha_emision','numero_recibo','datos_emisor','datos_pagador','importe','concepto','forma_pago','fecha_pago','firma_emisor','firma_pagador'}))
esc.append(recibo('b','Recibo de pago — B (todo a mano)',
  'Variante B del papel real: formulario con líneas en blanco; TODOS los datos a mano (htr). Solo título y etiquetas son impresos. Calibrado sobre recibo-b-todo-mano-01.',
  {'fecha_emision','numero_recibo','datos_emisor','datos_pagador','importe','importe_texto','concepto','forma_pago','fecha_pago'},
  FECHA_B, NREC_B, DNI_B,
  {'datos_pagador','importe','concepto','firma_emisor','firma_pagador'}))
esc.append(recibo('c','Recibo de pago — C (mixto)',
  'Variante C del papel real: cabecera/emisor IMPRESOS; importe, concepto, forma y fecha de pago a mano (htr). Calibrado sobre recibo-c-mixto-01.',
  {'importe','importe_texto','concepto','forma_pago','fecha_pago'},
  FECHA_C, NREC_C, DNI_C,
  {'fecha_emision','numero_recibo','datos_emisor','importe','concepto','firma_emisor','firma_pagador'}))

for fn,n in esc:
    print(fn, n, 'campos')
