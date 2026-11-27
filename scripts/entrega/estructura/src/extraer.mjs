/**
 * extraer.mjs — Extracción M2 sin molde (Agente 2, prueba S / plan V3 §4).
 *
 * Extracción por anclas textuales y regex sobre el documento estructurado
 * (.md aplanado, conservando saltos de línea) y sobre el texto plano del OCR,
 * siguiendo las especificaciones (§1 identificación por anclas, §2 datos
 * obligatorios, §3 respaldos cruzados cuando la toma recorta una etiqueta).
 * Consciente de líneas: los valores suelen vivir en la línea propia o en la
 * siguiente tras la etiqueta (típico en formularios con cajas).
 */

const limpiar = (s) => String(s ?? '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[ \t]+/g, ' ');

/** Líneas del documento ya limpias (sin acentos, sin pipes de tablas md). */
function lineas(textoPlano) {
  return limpiar(textoPlano)
    .split('\n')
    .map((l) => l.replace(/\|/g, ' ').replace(/[#*>_`]/g, ' ').replace(/ {2,}/g, ' ').trim())
    .filter((l) => l !== '' && !/^[-\s|]+$/i.test(l));
}

/**
 * resolverPorGeometria(arbol, definiciones) — asociación etiqueta↔valor por
 * PROXIMIDAD GEOMÉTRICA sobre el árbol estructurado (informe E2 §10.3): el
 * OCR puede INVERTIR la secuencia etiqueta/valor (toma vac-03 del recibo) y
 * la lectura por orden de texto falla. Prioridad:
 *   1. misma línea: el resto de la línea de la etiqueta (si cumple esValor).
 *   2. línea más cercana por distancia centro-a-centro de bbox (la vertical
 *      domina, como lee un humano un formulario: el valor vive debajo).
 * Excluye líneas dentro de tablas (celdas) y la propia línea de la etiqueta.
 * Devuelve { id: valor } solo con pares RESUELTOS — nunca inventa.
 */
export function resolverPorGeometria(arbol, definiciones) {
  const resueltos = {};
  if (!arbol || !Array.isArray(arbol.bloques)) return resueltos;

  const lineas = [];
  for (const b of arbol.bloques) {
    if (b.tipo === 'tabla') continue; // los valores de celdas no van por proximidad
    for (const l of b.lineas ?? []) {
      if (!l.texto || !Array.isArray(l.bbox)) continue;
      lineas.push({ texto: limpiar(l.texto), bbox: l.bbox });
    }
  }
  if (lineas.length === 0) return resueltos;

  const centro = (bbox) => ({
    x: (bbox[0] + bbox[2]) / 2,
    y: (bbox[1] + bbox[3]) / 2,
    h: bbox[3] - bbox[1],
  });

  for (const def of definiciones) {
    // línea de la etiqueta: la primera que matchea (etiquetas únicas por formulario)
    const iLabel = lineas.findIndex((l) => def.etiqueta.test(l.texto));
    if (iLabel < 0) continue;
    const etiqueta = lineas[iLabel];
    const cEti = centro(etiqueta.bbox);

    // 1) misma línea: lo que sigue al texto de la etiqueta
    const cruda = lineas[iLabel].texto;
    const coincidencia = cruda.match(def.etiqueta);
    const resto = cruda.slice(coincidencia ? coincidencia.index + coincidencia[0].length : 0)
      .replace(/^[:\s]+/, '').trim();
    if (resto && def.esValor(resto)) { resueltos[def.id] = resto; continue; }

    // 2) línea más cercana que parezca valor (vertical domina sobre horizontal)
    let mejor = null, mejorDist = Infinity, mejorFila = false;
    for (let i = 0; i < lineas.length; i++) {
      if (i === iLabel) continue;
      const l = lineas[i];
      if (!def.esValor(l.texto)) continue;
      const c = centro(l.bbox);
      const dy = Math.abs(c.y - cEti.y);
      const dx = Math.abs(c.x - cEti.x);
      // MISMA FILA (formulario a dos columnas): la cota vertical no aplica —
      // el valor vive al costado, no debajo (hallazgo vac-03, informe E2 §10.3).
      const mismaFila = dy <= Math.max(6, cEti.h * 0.8) && dx <= (arbol.ancho || 800) * 0.6;
      const dist = dy + dx * 0.5;
      if (dist < mejorDist) { mejorDist = dist; mejor = l; mejorFila = mismaFila; }
    }
    // cota honesta: a más de 6 alturas de línea (o fuera de la misma fila en
    // una página) la distancia no dice relación — se deja sin resolver.
    if (mejor && (mejorFila || mejorDist <= Math.max(60, cEti.h * 6))) {
      resueltos[def.id] = mejor.texto;
    }
  }
  return resueltos;
}

export function extraerCampos(textoPlano, tipoDoc, arbol = null) {
  const ls = lineas(textoPlano);
  const plano = ls.join('\n');
  const hallado = {};
  const poner = (id, v) => { if (v != null && String(v).trim() !== '') hallado[id] = String(v).trim(); };
  // V2: si el regex tiene grupo de captura, el valor es el GRUPO (m[1]) —
  // m[0] arrastraba la etiqueta al valor («nombre y apellido\njuan…», bug
  // preexistente que la prueba del cierre expuso). Sin grupo → match completo.
  const matchEn = (re, i = -1) => {
    const m = re.exec(plano);
    if (!m) return null;
    if (i >= 0) return m[i] ?? m[0];
    return m.length > 1 ? (m[1] ?? m[0]) : m[0];
  };

  // índice de la primera línea que cumple re; offset para tomar líneas siguientes
  const lineaCon = (re, desde = 0) => {
    for (let i = desde; i < ls.length; i++) if (re.test(ls[i])) return i;
    return -1;
  };

  // Etiqueta en línea propia (el OCR separó etiqueta y valor): busca el valor
  // en la misma línea y en las ±2 vecinas más cercanas.
  const valorTrasEtiquetaSola = (lineasArr, reEtiqueta, esValor) => {
    for (let i = 0; i < lineasArr.length; i++) {
      if (!reEtiqueta.test(lineasArr[i])) continue;
      const resto = lineasArr[i].replace(reEtiqueta, '').replace(/^[:\s]+/, '');
      if (esValor(resto) && resto.length >= 8) return resto;
      for (let d = 1; d <= 2; d++) {
        if (i + d < lineasArr.length && esValor(lineasArr[i + d])) return lineasArr[i + d];
        if (i - d >= 0 && esValor(lineasArr[i - d])) return lineasArr[i - d];
      }
    }
    return null;
  };

  // GEOMETRÍA PRIMERO (informe E2 §10.3): con árbol estructurado, los campos
  // definidos se asocian por proximidad de bbox (inmune a la inversión
  // etiqueta/valor del OCR); el camino textual queda como respaldo.
  if (arbol) {
    const definiciones = tipoDoc === 'recibo'
      ? [
          { id: 'forma_pago', etiqueta: /forma de pago/, esValor: (l) => /transferencia|efectivo|tarjeta|contado/.test(l) },
          { id: 'fecha_pago', etiqueta: /fecha de pago/, esValor: (l) => /\d{1,2}\s*[/ -]\s*\d{1,2}\s*[/ -]\s*\d{2,4}/.test(l) },
          { id: 'concepto', etiqueta: /en concepto de/, esValor: (l) => l.length >= 15 && !/:\s*$/.test(l) },
        ]
      : [
          { id: 'telefono', etiqueta: /telefono/, esValor: (l) => /\d[\d -]{6,}/.test(l) },
          { id: 'nombre_comprador', etiqueta: /nombre y apellido/, esValor: (l) => /^[a-z ]{6,50}$/.test(l.trim()) },
          { id: 'fecha_entrega', etiqueta: /fecha de entrega/, esValor: (l) => /\d{1,2}\s+de\s+[a-z]+\s+de\s+\d{4}/.test(l) },
        ];
    for (const [id, valor] of Object.entries(resolverPorGeometria(arbol, definiciones))) {
      poner(id, valor);
    }
  }

  if (tipoDoc === 'recibo') {
    poner('titulo', matchEn(/recibo de pago/));
    poner('numero_recibo', matchEn(/rec[- ]\d{4}[- ]\d{4}/));
    poner('fecha_emision', matchEn(/fecha:?\s*(\d{1,2} de [a-z]+ de \d{4})/));
    const todo = plano.replace(/\n/g, ' ');
    const dnis = [...todo.matchAll(/dni\s+([\d.]{7,12})/g)].map((m) => m[1]);
    if (dnis[0]) poner('emisor_dni', dnis[0]);
    if (dnis[1]) poner('pagador_dni', dnis[1]);
    const cifs = [...todo.matchAll(/cif\s+([a-z]\s?-?\d{7,9})/g)].map((m) => m[1]);
    if (cifs[0]) poner('emisor_cif', cifs[0]);
    if (cifs[1]) poner('pagador_cif', cifs[1]);
    const cargos = [...todo.matchAll(/en calidad de ([a-z ]{5,44}?)(?=,|\.|\sde la empresa)/g)].map((m) => m[1].trim());
    if (cargos[0]) poner('emisor_cargo', cargos[0]);
    if (cargos[1]) poner('pagador_cargo', cargos[1]);
    // nombres: 1º y 2º "D. <nombre>, con DNI" (tolera etiqueta recortada tipo "Je:")
    const nombres = [...todo.matchAll(/d\.\s*([a-z ]{6,50}?)\s*,\s*con dni/g)].map((m) => m[1].trim());
    if (nombres[0]) poner('emisor_nombre', nombres[0]);
    if (nombres[1]) poner('pagador_nombre', nombres[1]);
    const empresas = [...todo.matchAll(/de la empresa ([a-z0-9\s.,&-]{4,52}?)(?=,\s*con cif|\.\s|\scon cif|$)/g)]
      .map((m) => m[1].trim().replace(/[.,]\s*$/, ''));
    if (empresas[0]) poner('emisor_empresa', empresas[0]);
    if (empresas[1]) poner('pagador_empresa', empresas[1]);
    poner('importe', matchEn(/la suma de:?\s*([\d.,]+\s?€?)/));
    if (!hallado.importe) poner('importe', matchEn(/(\d{1,3}(?:\.\d{3})*,\d{2}\s?€)/)); // respaldo §3
    poner('importe_letras', matchEn(/\(\s*([^)]*euros?[^)]*)\s*\)/));
    let concepto = matchEn(/en concepto de:?\s*([\s\S]{10,130}?)(?=\s*forma de pago|\n\s*\n|$)/);
    if (!concepto) concepto = valorTrasEtiquetaSola(ls, /en concepto de/, (l) => l.length >= 15 && !/:\s*$/.test(l));
    poner('concepto', concepto);
    let forma = matchEn(/forma de pago:?\s*([a-z ]{4,40}?)(?=\s*[—-]|\s*cuenta|\n|$)/);
    if (!forma) forma = valorTrasEtiquetaSola(ls, /forma de pago/, (l) => /transferencia|efectivo|tarjeta|contado/.test(l));
    poner('forma_pago', forma);
    if (!hallado.iban) {
      const iFp = lineaCon(/forma de pago/);
      const trozo = ls.slice(Math.max(0, iFp - 1), iFp + 3).join(' ');
      const mi = /(es\d{2}(?: \d{4}){5})/.exec(trozo) || /(es\d{2}(?: \d{4}){5})/.exec(plano);
      if (mi) hallado.iban = mi[1];
    }
    poner('iban', matchEn(/(es\d{2}(?: \d{4}){5})/));
    poner('fecha_pago', matchEn(/fecha de pago:?\s*_?\s*(\d{2}[/ -]\d{2}[/ -]\d{2,4})/));
  } else {
    poner('titulo', matchEn(/comprobante de entrega del produc\w*/));
    const mDoc = /(?:^|\n|\s)(cc|c\.?c\.?|cedula)\s*:?\s*([\d.]{8,14})/.exec(plano);
    if (mDoc) poner('documento_comprador', `${mDoc[1].replace(/\./g, '')} ${mDoc[2]}`);
    poner('telefono', matchEn(/telefono:?\s*\n?\s*(\d{3}[ \d]{6,10})(?=\n|$)/));
    poner('numero_operacion', matchEn(/(op-\d{4}-\d{6})/));
    poner('nombre_comprador', matchEn(/nombre y apellido:?\s*\n?\s*([a-z ]{6,50})(?=\s*\n|\s*numero|\s*$)/));
    // dirección: fila CALLE | NRO | PISO | DPTO — línea con valores tras los rótulos
    let calle = matchEn(/calle[:\s]*([\d]{1,3}[\d\s#+.x*-]{2,14}\d{1,3}\s*-\s*\d{1,3})/);
    if (!calle) calle = matchEn(/(?:^|\n)\s*(\d{1,3}[\d\s#+.x*-]{2,14}\d{1,3}\s*-\s*\d{1,3})/); // respaldo: etiqueta recortada
    poner('calle', calle);
    const mDir = /nro\.?[\s\S]{0,40}?(\d{1,3}\s*-\s*\d{1,3})[\s\S]{0,8}?(\d{1,2})[\s\S]{0,8}?(\d{2,3})/.exec(plano);
    if (mDir) { poner('nro', mDir[1]); poner('piso', mDir[2]); poner('dpto', mDir[3]); }
    // artículo: valor en la propia línea o en la siguiente tras "Operación:"
    const iArt = lineaCon(/articulo/);
    if (iArt >= 0) {
      const resto = ls[iArt].replace(/.*articulo:?\s*/, '');
      if (resto.length >= 8 && !/operacion/.test(resto)) poner('articulo', resto.replace(/\s*op-\d{4}-\d{6}\s*$/, ''));
      else {
        const iOp = lineaCon(/operacion/, iArt);
        const linea = ls[(iOp >= 0 ? iOp : iArt) + 1] || ls[iArt + 1] || '';
        if (/^[a-z0-9]/.test(linea)) poner('articulo', linea.replace(/\s*op-\d{4}-\d{6}\s*$/, '').replace(/\s*\|\s*/g, ' '));
      }
    }
    const iDesc = lineaCon(/descripcion/);
    if (iDesc >= 0) {
      const trozo = ls.slice(iDesc, iDesc + 4).join('\n');
      const mDesc = /descripcion:?\s*\n?([\s\S]{20,240}?)(?=\n\s*(?:al firmar|importante)|$)/.exec(trozo);
      if (mDesc) poner('descripcion', mDesc[1].replace(/\n/g, ' '));
    }
    poner('fecha_entrega', matchEn(/fecha de entrega\s*:?\s*\n?\s*(\d{1,2} de [a-z]+ de \d{4})/));
  }
  return hallado;
}
