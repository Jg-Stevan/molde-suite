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

TITULO_V   = {'x':0.106,'y':0.099,'w':0.483,'h':0.013}
NOMBRE_V   = {'x':0.112,'y':0.157,'w':0.129,'h':0.010}
DOCV       = {'x':0.112,'y':0.196,'w':0.163,'h':0.010}
TEL_V      = {'x':0.509,'y':0.197,'w':0.061,'h':0.009}
DIR_V      = {'x':0.113,'y':0.230,'w':0.145,'h':0.012}
ART_V      = {'x':0.115,'y':0.325,'w':0.058,'h':0.011}
OPE_V      = {'x':0.610,'y':0.329,'w':0.074,'h':0.010}
DESC_V     = {'x':0.113,'y':0.363,'w':0.088,'h':0.010}
FIRMA_V    = {'x':0.195,'y':0.526,'w':0.134,'h':0.011}
FENTREGA_V = {'x':0.637,'y':0.528,'w':0.109,'h':0.012}

def comprobante(variante, nombre, descripcion, htr_ids, oblig):
    def h(i):
        return {'htr': True} if i in htr_ids else {}
    campos = [
        campo('titulo','COMPROBANTE DE ENTREGA','COMPROBANTE DE ENTREGA',TITULO_V,
              {'x':-0.01,'y':-0.006,'w':0.52,'h':0.028},
              patron=r'.*COMPROBANTE\s+DE\s+ENTREGA.*', obligatorio=True, realce=True),
        campo('nombre_comprador','COMPRADOR (nombre)','Nombre y apellido',NOMBRE_V,
              {'x':0.0,'y':-0.004,'w':0.45,'h':0.026},
              **({} if 'nombre_comprador' in htr_ids else {'limpiar_valor':r'[Aa]pellido\s*:?\s*(.+)'}),
              **h('nombre_comprador'),
              obligatorio=('nombre_comprador' in oblig), realce=True),
        campo('documento_comprador','DOCUMENTO','Número de Documento',DOCV,
              {'x':0.0,'y':-0.004,'w':0.30,'h':0.026},
              **({} if 'documento_comprador' in htr_ids else {'limpiar_valor':r'[Dd]ocumento\s*:?\s*(.+)','patron':r'(CC|C\.?C\.?|DNI|C[eé]dula)?\s*\d{1,3}(\.\d{3}){1,3}'}),
              **h('documento_comprador'),
              obligatorio=('documento_comprador' in oblig), realce=True),
        campo('telefono','TELÉFONO','Teléfono',TEL_V,
              {'x':0.0,'y':-0.004,'w':0.24,'h':0.026},
              **({} if 'telefono' in htr_ids else {'limpiar_valor':r'[Tt]el[eé]fono\s*:?\s*(.+)','patron':r'(?:\d{3}[\s.-]?)?\d{3}[\s.-]?\d{4}'}),
              **h('telefono'),
              obligatorio=False),
        campo('direccion','DIRECCIÓN','Dirección de entrega',DIR_V,
              {'x':0.0,'y':0.014,'w':0.55,'h':0.032},
              **h('direccion'),
              obligatorio=False),
        campo('articulo','ARTÍCULO','Artículo',ART_V,
              {'x':0.0,'y':-0.004,'w':0.55,'h':0.032},
              **({} if 'articulo' in htr_ids else {'limpiar_valor':r'[Aa]rt[ií]culo\s*:?\s*(.+)'}),
              **h('articulo'),
              obligatorio=('articulo' in oblig)),
        campo('numero_operacion','N.º OPERACIÓN','Operación',OPE_V,
              {'x':0.0,'y':-0.004,'w':0.24,'h':0.026},
              **({} if 'numero_operacion' in htr_ids else {'limpiar_valor':r'[Oo]peraci[oó]n\s*:?\s*(.+)','patron':r'[IO0]P-\d{4}-\d{6}'}),
              **h('numero_operacion'),
              obligatorio=False),
        campo('descripcion','DESCRIPCIÓN','Descripción',DESC_V,
              {'x':0.0,'y':-0.004,'w':0.80,'h':0.046},
              **h('descripcion'),
              obligatorio=('descripcion' in oblig)),
        campo('firma_comprador','Firma comprador','Firma del comprador',FIRMA_V,
              {'x':-0.09,'y':-0.075,'w':0.46,'h':0.062}, tipo='firma',
              umbral=0.0035, obligatorio=('firma_comprador' in oblig)),
        campo('fecha_entrega','FECHA DE ENTREGA','Fecha de entrega',FENTREGA_V,
              {'x':-0.18,'y':-0.004,'w':0.18,'h':0.026},
              **({} if 'fecha_entrega' in htr_ids else {'patron':r'\d{1,2}[/-]\d{1,2}[/-]\d{2,4}'}),
              **h('fecha_entrega'),
              obligatorio=('fecha_entrega' in oblig)),
    ]
    m = {
        'tipo':'universal','version':'1.0.0','nombre':nombre,'descripcion':descripcion,
        'documento':'generico/comprobante_entrega','idioma':'es','campos':campos,
        'huella':{'frasesClave':['COMPROBANTE DE ENTREGA','Nombre y apellido','Número de Documento','Operación'],
                  'paginas':1,'franja':{'x':0,'y':0,'w':1,'h':0.5},'minFrases':2},
        'meta':{'orden':12,'estado':'activo','etiquetaCampos':'Campos mapeados'},
    }
    fn = os.path.join(OUT, 'comprobante_%s_real.molde.json' % variante)
    open(fn,'w',encoding='utf-8').write(json.dumps(m,ensure_ascii=False,indent=2))
    return fn, len(campos)

esc = []
esc.append(comprobante('a','Comprobante de entrega — A (impreso)',
  'Variante A del papel real: datos IMPRESOS y firmas vacías. Calibrado sobre fotos reales 2026-11-25. Sin htr.',
  set(), {'nombre_comprador','documento_comprador','articulo','firma_comprador'}))
esc.append(comprobante('b','Comprobante de entrega — B (todo a mano)',
  'Variante B del papel real: formulario en blanco; TODOS los datos a mano (htr). Calibrado sobre comprobante-b-todo-mano-01.',
  {'nombre_comprador','documento_comprador','telefono','direccion','articulo','numero_operacion','descripcion','fecha_entrega','firma_comprador'},
  {'nombre_comprador','documento_comprador','articulo','descripcion','firma_comprador','fecha_entrega'}))
esc.append(comprobante('c','Comprobante de entrega — C (mixto)',
  'Variante C del papel real: comprador IMPRESO; compra, descripción, firma y fecha a mano (htr). Calibrado sobre comprobante-c-mixto-01.',
  {'articulo','numero_operacion','descripcion','fecha_entrega','firma_comprador'},
  {'nombre_comprador','documento_comprador','articulo','firma_comprador','fecha_entrega'}))

for fn,n in esc:
    print(fn, n, 'campos')
