#!/usr/bin/env bash
# Importa los moldes finales en Studio via el input de archivo (upload nativo).
set -e
cd /home/z/molde-suite-work
for doc in comprobante_entrega recibo_pago e22_resolucion e24_cuadro e26_acta_parcial; do
  echo "=== importando $doc ==="
  agent-browser eval "(()=>{const bs=[...document.querySelectorAll('button')];const b=bs.find(x=>x.textContent.trim()==='Importar JSON');if(!b)return 'no-btn';b.click();return 'dialog-open'})()"
  sleep 1.5
  REF=$(agent-browser snapshot -i --json 2>/dev/null | python3 -c "
import json,sys,re
s=sys.stdin.read()
m=re.search(r'Cargar archivo JSON.*?ref=(e\d+)', s)
if not m:
    # busca en arbol json
    d=json.loads(s)
    import io
    out=[]
    def walk(n):
        if isinstance(n,dict):
            if 'Cargar archivo JSON' in str(n.get('name','')): out.append(n)
            for v in n.values(): walk(v)
        elif isinstance(n,list):
            for v in n: walk(v)
    walk(d)
    print(out[0].get('ref') or out[0].get('id') or 'NOREF' if out else 'NOREF')
else:
    print(m.group(1))
")
  echo "input ref: $REF"
  agent-browser upload "@$REF" "moldes-finales/$doc.molde.json" || echo "(upload fallo, sigo con pegado)"
  sleep 1
  agent-browser eval "(()=>{const bs=[...document.querySelectorAll('button')];const b=bs.find(x=>x.textContent.trim()==='Importar');if(!b)return 'no-btn';b.click();return 'clicked'})()"
  sleep 2.5
  agent-browser eval "(()=>{const n=[...document.querySelectorAll('button')].find(b=>/Todos \(/.test(b.textContent))?.textContent;const err=document.querySelector('[role=alert]')?.textContent?.slice(0,160);return JSON.stringify({n,err})})()"
done
