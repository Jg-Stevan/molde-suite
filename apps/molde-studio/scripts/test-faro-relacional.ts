// Corpus de regresión v3.2.0 — FASES 1-4 del plan «Anclas Relacionales y
// Deskew». Cubre todo lo verificable SIN DOM/OCR real:
//
//   FASE 2 — EL FARO (ancla_relacional + zona_busqueda):
//     · lineasEnFaro filtra por centro (+margen) — nunca búsqueda global.
//     · resolverRectRelacional: banda adyacente (zona), línea vecina (linea),
//       orden mas_cercano/indice, empate ambiguo → bandera, ancla fuera del
//       faro → bandera + fallback de referencia, sin candidato → fallback.
//     · rectEditor resuelve la banda de referencia sin OCR.
//   FASE 2/3/4 — VALIDADORES: ancla_relacional SIN faro = molde inválido;
//     min_trazos/firma_esperada/grupo/orden aceptados; v3.0/3.1 retrocompatible.
//   FASE 4 — IMPORTADOR CHANDRA (funciones puras): bloques → campos con faro
//     y relación, grupos/orden, matriz de obligatorios, PageFooter ignorado,
//     bloques no reconocidos listados, failed_pages → aviso, y ROUND-TRIP
//     por el validador esMoldeUniversal.
//
// Ejecutar: bun scripts/test-faro-relacional.ts

import {
  FARO_MARGEN,
  lineasEnFaro,
  rectEditor,
  resolverRectRelacional,
} from '../src/lib/molde/universal-engine';
import {
  detectarTipoDoc,
  importarChandra,
  pareceChandra,
  parsearTablaHtml,
  reiniciarIdsChandra,
  sugerirObligatorio,
  textoPlano,
  type ChandraConvert,
} from '../src/lib/molde/importar-chandra';
import {
  erroresMolde,
  esMoldeUniversal,
  MOLDE_UNIVERSAL_VERSION,
  type CampoUniversal,
} from '../src/lib/molde/universal-types';
import type { LineaOcr } from '../src/lib/molde/types';

let fallos = 0;
function check(nombre: string, cond: boolean, detalle?: string) {
  if (cond) console.log(`  ✓ ${nombre}`);
  else {
    fallos++;
    console.error(`  ✗ ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  }
}

// ---------- Fixtures OCR (LineaOcr mínima, sin DOM) ----------
// Página canónica 1000 x 1000 px (1 px = 0.001 normalizado).

type PalabraOcrLike = { texto: string; conf: number; bbox: [number, number, number, number] };

function linea(
  texto: string,
  bbox: [number, number, number, number],
): LineaOcr {
  const palabras: PalabraOcrLike[] = texto.split(/\s+/).filter(Boolean).map((t, i, arr) => {
    const w = (bbox[2] - bbox[0]) / arr.length;
    return { texto: t, conf: 0.9, bbox: [bbox[0] + i * w, bbox[1], bbox[0] + (i + 1) * w, bbox[3]] };
  });
  return { texto, bbox, palabras };
}

const W = 1000;
const H = 1000;

// Escenario Recibo: etiqueta «FIRMA» abajo-izquierda; párrafo legal con
// «firmante» arriba-derecha (el falso positivo que el faro mata).
const lineasPagina: LineaOcr[] = [
  linea('El abajo firmante acepta las condiciones', [100, 80, 900, 100]), // FUERA del faro
  linea('FIRMA', [120, 900, 200, 930]), // dentro del faro izquierdo
  linea('FIRMA', [800, 900, 880, 930]), // dentro del faro derecho (variante 2 firmas)
  linea('La suma de: 1.250,00 €', [120, 700, 400, 730]),
];

const FARO_IZQ = { x: 0.08, y: 0.85, w: 0.35, h: 0.13 };
const campoFirmaBandaArriba: CampoUniversal = {
  id: 'firma_izq',
  etiqueta: 'Firma (izquierda)',
  pagina: 1,
  tipo: 'firma',
  estrategia: 'ancla_relacional',
  zona: { x: 0, y: 0, w: 0, h: 0 },
  ancla: { texto: 'FIRMA', rect: { x: 0.12, y: 0.9, w: 0.08, h: 0.03 } },
  zona_busqueda: FARO_IZQ,
  relacion: { direccion: 'arriba', que: 'zona', orden: 'mas_cercano' },
  umbral: 0.03,
  obligatorio: true,
};

// ---------- FASE 2 — EL FARO ----------
console.log('FASE 2 — el faro (ancla_relacional + zona_busqueda)');

check(
  'MOLDE_UNIVERSAL_VERSION es 3.2.0',
  MOLDE_UNIVERSAL_VERSION === '3.2.0',
  MOLDE_UNIVERSAL_VERSION,
);

{
  const enFaro = lineasEnFaro(lineasPagina, W, H, FARO_IZQ);
  check(
    'lineasEnFaro: solo la línea del ancla dentro del faro (el párrafo legal NO existe)',
    enFaro.length === 1 && enFaro[0].texto === 'FIRMA',
    `filtradas=${enFaro.map((l) => l.texto).join('|')}`,
  );

  // Margen del faro: un centro al borde ±1% cuenta como dentro.
  const borde = linea('BORDE', [FARO_IZQ.x * W - FARO_MARGEN * W - 5, FARO_IZQ.y * H + 10, FARO_IZQ.x * W - FARO_MARGEN * W + 5, FARO_IZQ.y * H + 30]);
  const conBorde = lineasEnFaro([borde], W, H, FARO_IZQ);
  check('lineasEnFaro: margen ±1% tolera el edge', conBorde.length === 1);
}

{
  // Banda ARRIBA de la etiqueta dentro del faro: del borde superior del ancla
  // al borde superior del faro (el espacio de firma).
  const r = resolverRectRelacional(campoFirmaBandaArriba, lineasPagina, W, H);
  check('resolverRectRelacional: resuelve rect para que=zona', r !== null);
  if (r) {
    const a = campoFirmaBandaArriba.ancla!.rect!;
    check(
      'banda arriba: tope = tope del faro, fondo = tope del ancla',
      Math.abs(r.rect.y - FARO_IZQ.y) < 1e-9 && Math.abs(r.rect.y + r.rect.h - a.y) < 1e-9,
      `rect=${JSON.stringify(r.rect)}`,
    );
    check(
      'banda arriba: fuente ancla, sin banderas, ancla_encontrada',
      r.fuente === 'ancla' && r.ancla_encontrada === true && !(r.banderasRelacionales?.length),
      `fuente=${r.fuente} banderas=${(r.banderasRelacionales ?? []).join(',')}`,
    );
    check(
      'banda arriba: la banda NO incluye al párrafo legal (queda fuera)',
      r.rect.y + r.rect.h <= 0.9,
    );
  }
}

{
  // Dos FIRMA en la página pero el faro IZQUIERDO halla SOLO la izquierda:
  // el faro desambigua por posición sin desambiguadores (§3.1 del plan).
  const r = resolverRectRelacional(campoFirmaBandaArriba, lineasPagina, W, H);
  check('faro desambigua: la banda usa el ancla IZQUIERDA (x del faro)', r !== null && r.rect.x >= FARO_IZQ.x - 0.001);
}

{
  // Ancla que NO está dentro del faro pero SÍ existe en la página: bandera
  // honesta + fallback de referencia (la búsqueda global NO resuelve).
  const campoFaroMalPuesto: CampoUniversal = {
    ...campoFirmaBandaArriba,
    id: 'faro_mal',
    zona_busqueda: { x: 0.6, y: 0.1, w: 0.3, h: 0.1 }, // esquina sin ancla
  };
  const r = resolverRectRelacional(campoFaroMalPuesto, lineasPagina, W, H);
  check('faro mal puesto: cae a referencia', r !== null && r.fuente === 'referencia');
  check(
    'faro mal puesto: bandera ancla_fuera_de_zona',
    r?.banderasRelacionales?.includes('ancla_fuera_de_zona') === true,
    `banderas=${(r?.banderasRelacionales ?? []).join(',')}`,
  );
}

{
  // que=linea, direccion=abajo, mas_cercano: la línea vecina dentro del faro.
  const campoLinea: CampoUniversal = {
    ...campoFirmaBandaArriba,
    id: 'linea_abajo',
    tipo: 'texto',
    ancla: { texto: 'La suma de', rect: { x: 0.12, y: 0.7, w: 0.15, h: 0.03 } },
    zona_busqueda: { x: 0.08, y: 0.62, w: 0.4, h: 0.3 },
    relacion: { direccion: 'abajo', que: 'linea', orden: 'mas_cercano' },
    zona: { x: 0, y: 0, w: 0, h: 0 },
  };
  const lineasLocales: LineaOcr[] = [
    linea('La suma de: 1.250,00 €', [120, 700, 400, 730]),
    linea('vencimiento 2026-03-01', [120, 750, 360, 775]),
    linea('linea lejana', [120, 850, 300, 875]),
  ];
  const r = resolverRectRelacional(campoLinea, lineasLocales, W, H);
  check('que=linea abajo: resuelve la línea vecina', r !== null && r.fuente === 'ancla');
  if (r) {
    check(
      'que=linea abajo: el rect es la línea de ABAJO (no la propia del ancla)',
      Math.abs(r.rect.y - 0.75) < 1e-9,
      `rect.y=${r.rect.y}`,
    );
  }

  // orden='indice' 2 → la segunda más cercana; índice que excede → sin candidato.
  const campoIndice: CampoUniversal = {
    ...campoLinea,
    id: 'indice_2',
    relacion: { direccion: 'abajo', que: 'linea', orden: 'indice', indice: 2 },
  };
  const r2 = resolverRectRelacional(campoIndice, lineasLocales, W, H);
  check('orden=indice 2: toma la segunda línea', r2 !== null && Math.abs(r2.rect.y - 0.85) < 1e-9, r2 ? `y=${r2.rect.y}` : 'null');
  const campoIndiceFuera: CampoUniversal = {
    ...campoIndice,
    relacion: { direccion: 'abajo', que: 'linea', orden: 'indice', indice: 9 },
  };
  const r3 = resolverRectRelacional(campoIndiceFuera, lineasLocales, W, H);
  check(
    'orden=indice que excede: relacion_sin_candidato + fallback (no el último)',
    r3?.fuente === 'referencia' && r3.banderasRelacionales?.includes('relacion_sin_candidato') === true,
  );
}

{
  // Empate ambiguo: dos líneas a la MISMA distancia → bandera (el motor
  // jamás escoge en silencio).
  const campoAmbiguo: CampoUniversal = {
    ...campoFirmaBandaArriba,
    id: 'ambiguo',
    tipo: 'texto',
    ancla: { texto: 'La suma de', rect: { x: 0.12, y: 0.7, w: 0.15, h: 0.03 } },
    zona_busqueda: { x: 0.08, y: 0.6, w: 0.4, h: 0.2 },
    relacion: { direccion: 'abajo', que: 'linea', orden: 'mas_cercano' },
  };
  const empate: LineaOcr[] = [
    linea('La suma de: 1.250,00 €', [120, 700, 400, 730]),
    linea('candidato A', [120, 750, 360, 770]),
    linea('candidato B', [120, 750, 360, 770]), // misma distancia exacta
  ];
  const r = resolverRectRelacional(campoAmbiguo, empate, W, H);
  check(
    'empate a distancia idéntica: bandera relacion_ambigua',
    r?.ambiguo === true,
    `ambiguo=${r?.ambiguo}`,
  );
}

{
  // Sin ancla en ninguna parte (ni fuera) → fallback de referencia, sin bandera de fuera.
  const campoVacio: CampoUniversal = {
    ...campoFirmaBandaArriba,
    id: 'sin_ancla',
    ancla: { texto: 'NOEXISTE', rect: { x: 0.12, y: 0.9, w: 0.08, h: 0.03 } },
  };
  const r = resolverRectRelacional(campoVacio, lineasPagina, W, H);
  check(
    'ancla inexistente: fallback de referencia SIN ancla_fuera_de_zona',
    r?.fuente === 'referencia' && !(r.banderasRelacionales?.includes('ancla_fuera_de_zona')),
  );
}

{
  // rectEditor (sin OCR): la banda de referencia es geometría del mapa.
  const e = rectEditor(campoFirmaBandaArriba);
  const a = campoFirmaBandaArriba.ancla!.rect!;
  check(
    'rectEditor relacional: banda arriba de referencia (faro → ancla)',
    e !== null && Math.abs(e.y - FARO_IZQ.y) < 1e-9 && Math.abs(e.y + e.h - a.y) < 1e-9,
  );
  // Sin ancla.rect y sin faro → null (el lienzo marca NO EVALUABLE).
  const sinRef = rectEditor({ ...campoFirmaBandaArriba, id: 'sin_ref', ancla: { texto: 'FIRMA' } });
  check('rectEditor sin referencia: null (no inventa)', sinRef === null);
}

// ---------- Validadores (FASES 2/3/4) ----------
console.log('Validadores — sin faro no hay estrategia; campos nuevos aceptados');

{
  const sinFaro: CampoUniversal = {
    ...campoFirmaBandaArriba,
    id: 'sin_faro',
    zona_busqueda: undefined,
  };
  const molde = {
    tipo: 'universal' as const,
    version: '3.2.0',
    nombre: 'sin faro',
    campos: [sinFaro],
  };
  check('esMoldeUniversal RECHAZA ancla_relacional sin zona_busqueda', esMoldeUniversal(molde) === false);
  check(
    'erroresMolde exige el faro con la regla del dueño',
    erroresMolde(molde).some((e) => e.includes('zona_busqueda')),
    erroresMolde(molde).join(' | '),
  );
}

{
  const conTodo: CampoUniversal = {
    ...campoFirmaBandaArriba,
    id: 'con_todo',
    min_trazos: 2,
    firma_esperada: true,
    grupo: 'Cierre / Firmas',
    orden: 9,
  };
  const molde = {
    tipo: 'universal' as const,
    version: '3.2.0',
    nombre: 'con todo',
    campos: [conTodo],
  };
  check('esMoldeUniversal ACEPTA min_trazos/firma_esperada/grupo/orden', esMoldeUniversal(molde) === true, erroresMolde(molde).join(' | '));
}

{
  // Retrocompatibilidad: molde estilo v3.0 (zona_fija + ancla_relativa) intacto.
  const retro: CampoUniversal = {
    id: 'retro',
    etiqueta: 'Campo clásico',
    pagina: 1,
    tipo: 'texto',
    estrategia: 'ancla_relativa',
    zona: { x: 0.02, y: 0.01, w: 0.2, h: 0.04 },
    ancla: { texto: 'ETIQUETA CLASICA', rect: { x: 0.1, y: 0.5, w: 0.3, h: 0.03 } },
    umbral: 0.03,
    obligatorio: false,
  };
  const molde = {
    tipo: 'universal' as const,
    version: '3.0.0',
    nombre: 'retro',
    campos: [
      retro,
      { ...retro, id: 'fija', estrategia: 'zona_fija' as const, ancla: undefined, zona: { x: 0.2, y: 0.2, w: 0.3, h: 0.04 } },
    ],
  };
  check('retrocompatibilidad v3.0: zona_fija + ancla_relativa siguen validando', esMoldeUniversal(molde) === true);
}

// ---------- FASE 4 — IMPORTADOR CHANDRA ----------
console.log('FASE 4 — importador Chandra (datalab-convert → MoldeUniversal)');

check(
  'sugerirObligatorio: matriz del Comprobante (Documento crítico, Teléfono opcional)',
  sugerirObligatorio('comprobante', 'Número de Documento').obligatorio === true &&
    sugerirObligatorio('comprobante', 'Teléfono').obligatorio === false &&
    sugerirObligatorio('comprobante', 'Fecha de entrega').nivel === 'Crítico',
);
check(
  'sugerirObligatorio: matriz del Recibo (Fecha crítico, Fecha de pago operativo, CIF condicional)',
  sugerirObligatorio('recibo', 'Fecha').nivel === 'Crítico' &&
    sugerirObligatorio('recibo', 'Fecha de pago').nivel === 'Operativo' &&
    sugerirObligatorio('recibo', 'CIF').obligatorio === false &&
    sugerirObligatorio('recibo', 'Firma').obligatorio === true,
);

check(
  'textoPlano: quita etiquetas y entidades',
  textoPlano('<p>D. <b>María</b>, &amp; hijos</p>') === 'D. María, & hijos',
);

{
  const filas = parsearTablaHtml(
    '<table><tr><th colspan="2">DATOS DEL COMPRADOR</th></tr><tr><td colspan="2"><b>Nombre y apellido:</b><br/>María López</td></tr><tr><td><b>CALLE</b><br/>Calle 45</td><td><b>NRO.</b><br/>12-34</td></tr></table>',
  );
  check('parsearTablaHtml: 3 filas', filas !== null && filas.length === 3);
  check(
    'parsearTablaHtml: th detectado + negrilla + resto separados',
    filas?.[0].esHeader === true &&
      filas?.[1].celdas[0].negrilla === 'Nombre y apellido:' &&
      filas?.[1].celdas[0].resto === 'María López',
  );
}

// Fixture inspirado 1:1 en los anexos reales (Comprobante VAR A).
const fixture: ChandraConvert = {
  children: [
    {
      block_type: 'Page',
      bbox: [0, 0, 1624, 2100],
      children: [
        { id: '/page/0/SectionHeader/0', block_type: 'SectionHeader', bbox: [151, 161, 964, 201], html: '<h1>COMPROBANTE DE ENTREGA DEL PRODUCTO</h1>' },
        {
          id: '/page/0/Form/1',
          block_type: 'Form',
          bbox: [151, 233, 1468, 577],
          html: '<table><tr><th colspan="4">DATOS DEL COMPRADOR</th></tr><tr><td colspan="4"><b>Nombre y apellido:</b><br/>María López</td></tr><tr><td colspan="2"><b>Número de Documento:</b><br/>CC 1.023.456.789</td><td colspan="2"><b>Teléfono:</b><br/>310 555 0198</td></tr><tr><td colspan="4"><b>Dirección de entrega</b></td></tr><tr><td><b>CALLE</b><br/>Calle 45 # 12-34</td><td><b>NRO.</b><br/>12-34</td></tr></table>',
        },
        { id: '/page/0/Text/1', block_type: 'Text', bbox: [207, 1096, 756, 1138], html: '<p>_____<br/><b>Firma del comprador o autorizado</b></p>' },
        { id: '/page/0/Text/2', block_type: 'Text', bbox: [863, 1096, 1416, 1138], html: '<p>_____<br/><b>Fecha de entrega</b></p>' },
        { id: '/page/0/PageFooter/1', block_type: 'PageFooter', bbox: [1135, 1997, 1468, 2020], html: '<p>VAR A — datos impresos · firmas vacías</p>' },
        { id: '/page/0/Raro/99', block_type: 'BloqueDesconocido', bbox: [100, 1300, 400, 1350], html: '<p>estructura no prevista</p>' },
      ],
    },
  ],
  metadata: { failed_pages: [1] },
};

{
  reiniciarIdsChandra();
  check('pareceChandra: detecta el formato datalab-convert', pareceChandra(fixture) === true);
  const r = importarChandra(fixture, { pagina: 0 });
  const campos = r.campos.map((c) => c.campo);

  check(`importador: título detectado (recibido: "${r.titulo}")`, r.titulo === 'COMPROBANTE DE ENTREGA DEL PRODUCTO');
  check(`importador: PageFooter en ignorados (no en campos)`, r.ignorados.some((i) => i.blockType === 'PageFooter') && !campos.some((c) => c.etiqueta.includes('VAR A')));
  check(
    'importador: bloque desconocido listado como NO mapeado (honesto, §8)',
    r.noMapeados.some((b) => b.blockType === 'BloqueDesconocido'),
  );
  check('importador: failed_pages genera aviso', r.paginasFallidas.includes(1) && r.avisos.some((a) => a.mensaje.includes('inferencia')));

  // Título → zona_fija (cabecera rígida).
  const titulo = campos.find((c) => c.estrategia === 'zona_fija');
  check('importador: SectionHeader → zona_fija (Encabezado)', titulo !== undefined && titulo?.grupo === 'Encabezado');

  // Form → campos ancla_relacional con faro y relación ABAJO (etiqueta arriba, valor <br/> abajo).
  const nombre = campos.find((c) => c.etiqueta === 'Nombre y apellido');
  check(
    'importador: Form/celda → ancla_relacional + faro + relacion abajo',
    nombre !== undefined &&
      nombre?.estrategia === 'ancla_relacional' &&
      nombre?.relacion?.direccion === 'abajo' &&
      nombre?.zona_busqueda !== undefined,
  );
  check(
    'importador: grupo deriva del th (DATOS DEL COMPRADOR)',
    nombre?.grupo === 'DATOS DEL COMPRADOR',
    `grupo=${nombre?.grupo}`,
  );
  check(
    'importador: matriz Comprobante precarga — N.º Documento obligatorio, Teléfono no',
    campos.find((c) => c.etiqueta === 'Número de Documento')?.obligatorio === true &&
      campos.find((c) => c.etiqueta === 'Teléfono')?.obligatorio === false,
  );
  check(
    'importador: subgrupo «Dirección de entrega» alimenta CALLE/NRO.',
    campos.find((c) => c.etiqueta === 'CALLE')?.grupo === 'Dirección de entrega',
    `grupo=${campos.find((c) => c.etiqueta === 'CALLE')?.grupo}`,
  );
  check(
    'importador: celdas Form marcadas ESTIMADAS (retícula uniforme)',
    r.campos.find((c) => c.campo.etiqueta === 'CALLE')?.estimado === true,
  );

  // Firma/fecha «_____ + etiqueta» → banda ARRIBA; firma lleva firma_esperada + min_trazos.
  const firma = campos.find((c) => c.etiqueta === 'Firma del comprador o autorizado');
  check(
    'importador: firma → tipo firma + relacion arriba + firma_esperada + min_trazos 1',
    firma?.tipo === 'firma' &&
      firma?.relacion?.direccion === 'arriba' &&
      firma?.firma_esperada === true &&
      firma?.min_trazos === 1 &&
      firma?.obligatorio === true,
  );
  const fecha = campos.find((c) => c.etiqueta === 'Fecha de entrega');
  check(
    'importador: fecha de entrega → texto, banda ARRIBA, obligatoria',
    fecha?.tipo === 'texto' && fecha?.relacion?.direccion === 'arriba' && fecha?.obligatorio === true,
  );

  check('importador: orden de lectura creciente (orden 1-based)', campos.every((c) => (c.orden ?? 0) >= 1));

  // ROUND-TRIP: el molde generado pasa el validador del motor v3.2.0.
  check(
    'ROUND-TRIP: el molde importado pasa esMoldeUniversal v3.2.0',
    esMoldeUniversal(r.molde) === true,
    erroresMolde(r.molde).join(' | '),
  );
}

{
  // Recibo: tabla de firmas → DOS campos con faros separados (sin ambigüedad).
  const recibo: ChandraConvert = {
    children: [
      {
        block_type: 'Page',
        bbox: [0, 0, 1624, 2100],
        children: [
          { id: '/p0/h1', block_type: 'SectionHeader', bbox: [659, 132, 964, 168], html: '<h1>RECIBO DE PAGO</h1>' },
          { id: '/p0/t1', block_type: 'Text', bbox: [1089, 279, 1422, 310], html: '<p>Fecha: <b>02 de febrero de 2026</b></p>' },
          {
            id: '/p0/t2',
            block_type: 'Text',
            bbox: [198, 428, 1404, 518],
            html: '<p>D. <b>María García Pons</b>, con DNI <b>45.678.123</b>, en calidad de <b>Administradora</b>, de la empresa <b>Suministros Alfa S.L.</b>, con CIF <b>B-98765432</b>.</p>',
          },
          {
            id: '/p0/t3',
            block_type: 'Text',
            bbox: [198, 562, 1349, 653],
            html: '<p>Recibí de: D. <b>Juan Pérez Soto</b>, con DNI <b>12.345.678</b>.</p>',
          },
          { id: '/p0/tbl', block_type: 'Table', bbox: [198, 1696, 1422, 1879], html: '<table><tr><td><b>Firma</b></td><td><b>Firma</b></td></tr></table>' },
        ],
      },
    ],
    metadata: { failed_pages: [] },
  };
  reiniciarIdsChandra();
  const r = importarChandra(recibo, { pagina: 0 });
  const campos = r.campos.map((c) => c.campo);
  check(`Recibo: título y tipo de documento (${r.molde.documento})`, r.molde.documento === 'recibo');

  const fecha = campos.find((c) => c.etiqueta === 'Fecha');
  check(
    'Recibo: «Fecha:» → ancla=Fecha, banda DERECHA, crítico',
    fecha?.ancla?.texto === 'Fecha' && fecha?.relacion?.direccion === 'derecha' && fecha?.obligatorio === true,
  );

  const receptorNombre = campos.find((c) => c.etiqueta === 'Receptor · Nombre');
  const receptorDni = campos.find((c) => c.etiqueta === 'Receptor · DNI');
  const pagadorNombre = campos.find((c) => c.etiqueta === 'Pagador · Nombre');
  const receptorCif = campos.find((c) => c.etiqueta === 'Receptor · CIF');
  check(
    'Recibo: párrafo multi-valor → nombres semánticos de la matriz',
    receptorNombre !== undefined && receptorDni !== undefined && pagadorNombre !== undefined && receptorCif !== undefined,
    `campos=${campos.map((c) => c.etiqueta).join(' | ')}`,
  );
  check(
    'Recibo: anclas de los segmentos (última palabra significativa, única EN EL FARO)',
    receptorNombre?.ancla?.texto === 'D.' && receptorDni?.ancla?.texto === 'DNI' && receptorCif?.ancla?.texto === 'CIF',
  );
  check(
    'Recibo: DNI receptor crítico, CIF condicional (B2B)',
    receptorDni?.obligatorio === true && receptorCif?.obligatorio === false,
  );

  const firmas = campos.filter((c) => c.tipo === 'firma');
  // La propiedad que importa: el FARO de cada firma contiene su PROPIA
  // referencia (ancla.rect) y NO la de la otra firma — así el faro
  // desambigua por posición sin desambiguadores (§5.3 del plan). El margen
  // expandido puede rozar al vecino (es generoso), pero nunca engloba su ancla.
  const centro = (r: { x: number; y: number; w: number; h: number }) => ({
    cx: r.x + r.w / 2,
    cy: r.y + r.h / 2,
  });
  check(
    'Recibo: DOS firmas, cada faro contiene SOLO su propia etiqueta',
    firmas.length === 2 &&
      firmas[0].etiqueta !== firmas[1].etiqueta &&
      (() => {
        const enFaro = (f: CampoUniversal, centroP: { cx: number; cy: number }) => {
          const z = f.zona_busqueda!;
          return centroP.cx >= z.x && centroP.cx <= z.x + z.w && centroP.cy >= z.y && centroP.cy <= z.y + z.h;
        };
        const c0 = centro(firmas[0].ancla!.rect!);
        const c1 = centro(firmas[1].ancla!.rect!);
        return enFaro(firmas[0], c0) && !enFaro(firmas[0], c1) && enFaro(firmas[1], c1) && !enFaro(firmas[1], c0);
      })(),
    `firmas=${firmas.map((f) => `${f.etiqueta}@${f.zona_busqueda!.x.toFixed(2)}+${f.zona_busqueda!.w.toFixed(2)}`).join(' | ')}`,
  );
  check(
    'Recibo: ROUND-TRIP por el validador',
    esMoldeUniversal(r.molde) === true,
    erroresMolde(r.molde).join(' | '),
  );
}

{
  // JSON basura: error claro, nunca un molde medio masticado.
  let lanzo = false;
  try {
    importarChandra({ children: [] });
  } catch {
    lanzo = true;
  }
  check('importador: sin páginas → error claro', lanzo);
}

// ---------- Resumen ----------
console.log('');
if (fallos === 0) {
  console.log('OK — corpus v3.2.0 completo en verde (faro + validadores + Chandra).');
} else {
  console.error(`FALLOS: ${fallos} check(s) en rojo.`);
  process.exit(1);
}
