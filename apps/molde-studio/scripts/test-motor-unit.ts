// Corpus de regresión LÓGICO del motor universal v3 (Fases 2 y 5.2).
// Cubre todo lo verificable sin DOM/OCR real: imageproc (ventana centrada de
// opening1D), parser de validaciones, conversión numérica, sugerencia de
// umbrales, búsqueda de anclas (incluida la penalización suavizada del Matiz 1)
// y validador de moldes endurecido (N-4).
//
// Los documentos VISUALES de la auditoría (plantilla Nairobi + 2 actas El
// Cairo, 63 decisiones de campo) no están en el repo: ese test de oro requiere
// re-publicar las imágenes (ver docs/auditoria). Este corpus protege la lógica.
//
// Ejecutar: bun scripts/test-motor-unit.ts

import { binarizeNoLines, inkRatio } from '../src/lib/molde/imageproc';
import {
  buscarAncla,
  normTxt,
  editDistance,
  parsearIgualdad,
  sugerirUmbral,
  valorNumerico,
} from '../src/lib/molde/universal-engine';
import type { LineaOcr } from '../src/lib/molde/types';
import { erroresMolde, esMoldeUniversal, type ResultadoCampoUniversal, type ResultadoUniversal } from '../src/lib/molde/universal-types';

let fallos = 0;
function check(nombre: string, cond: boolean, detalle?: string) {
  if (cond) console.log(`  ✓ ${nombre}`);
  else {
    fallos++;
    console.error(`  ✗ ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  }
}

// ---------- imageproc: opening con ventana centrada (N-12 / Fase 5.2) ----------
console.log('imageproc — apertura con ventana centrada (N-12)');

/** Imagen gris uniforme con trazos horizontales de tinta en una fila. */
function filaConTrazos(w: number, trazos: Array<[number, number, number]>): { gray: Uint8Array; w: number; h: number } {
  const h = 20;
  const gray = new Uint8Array(w * h).fill(240);
  const fila = 10;
  for (const [x0, x1, grosor] of trazos) {
    for (let y = fila; y < fila + grosor; y++) {
      for (let x = x0; x < x1; x++) gray[y * w + x] = 40;
    }
  }
  return { gray, w, h };
}

const W = 240;
// kernel de línea: 8.3% del ancho → k=20 (r=9). Con ventana completa, la
// apertura elimina trazos de longitud ≥ 20 y conserva los < 20.
const K = Math.max(20, Math.floor(W * 0.083)) | 1;

{
  // Trazo manuscrito CORTO (subrayado de 12 px < k=20): debe SOBREVIVIR
  // (con la media ventana vieja, ~k/2=10, un trazo de 12 moría).
  const { gray, w, h } = filaConTrazos(W, [[100, 112, 3]]);
  const bin = binarizeNoLines(gray, w, h, 0.083);
  const ratio = inkRatio(bin, [0, 0, w, h], undefined);
  check(`trazo corto (12px < k=${K}) sobrevive al filtro de líneas`, ratio > 0, `ratio=${ratio}`);
}
{
  // Trazo medio (entre k/2 y k): sobrevive con ventana completa.
  const { gray, w, h } = filaConTrazos(W, [[80, 80 + K - 2, 3]]);
  const bin = binarizeNoLines(gray, w, h, 0.083);
  const ratio = inkRatio(bin, [0, 0, w, h], undefined);
  check(`trazo medio (k-2=${K - 2}px) sobrevive al filtro de líneas`, ratio > 0, `ratio=${ratio}`);
}
{
  // Línea impresa de ANCHO COMPLETO: debe ELIMINARSE (es una línea).
  const { gray, w, h } = filaConTrazos(W, [[0, W, 2]]);
  const bin = binarizeNoLines(gray, w, h, 0.083);
  const ratio = inkRatio(bin, [0, 0, w, h], undefined);
  check(`línea de ancho completo (${W}px) se elimina`, ratio === 0, `ratio=${ratio}`);
}
{
  // Línea larga (>k) pero no completa: también se elimina (es línea impresa).
  const { gray, w, h } = filaConTrazos(W, [[10, 10 + K + 30, 2]]);
  const bin = binarizeNoLines(gray, w, h, 0.083);
  const ratio = inkRatio(bin, [0, 0, w, h], undefined);
  check(`línea larga (k+30 px) se elimina`, ratio === 0, `ratio=${ratio}`);
}

// ---------- validaciones aritméticas (Fase 2.2) ----------
console.log('validaciones — parser seguro de igualdades');

check('parsea "a == b + c + 1"', JSON.stringify(parsearIgualdad('a == b + c + 1')) === JSON.stringify({ izq: 'a', der: [{ tipo: 'id', valor: 'b' }, { tipo: 'id', valor: 'c' }, { tipo: 'num', valor: '1' }] }));
check('rechaza expresiones con tokens raros', parsearIgualdad('a == b + process.exit(1)') === null);
check('rechaza sin igualdad', parsearIgualdad('a + b') === null);
check('rechaza operador de resta', parsearIgualdad('a == b - c') === null);

function resCampo(id: string, valor: string | boolean | null, estado: ResultadoCampoUniversal['estado'] = 'ok'): ResultadoCampoUniversal {
  return { id, etiqueta: id, tipo: typeof valor === 'string' ? 'texto' : 'presencia', pagina: 1, estado, valor, conf: 0.9, rect: null, banderas: [] };
}

check('valorNumerico: "17" → 17', valorNumerico(resCampo('x', '17')) === 17);
check('valorNumerico: "17 000" (miles con espacio) → 17000', valorNumerico(resCampo('x', '17 000')) === 17000);
check('valorNumerico: "1.234" (miles con punto) → 1234', valorNumerico(resCampo('x', '1.234')) === 1234);
check('valorNumerico: true → 1 (conteo de casillas)', valorNumerico(resCampo('x', true)) === 1);
check('valorNumerico: basura → null', valorNumerico(resCampo('x', 'ZONA: 05')) === null);
check('valorNumerico: sin lectura → null', valorNumerico(resCampo('x', null, 'no_encontrado')) === null);

// Los casos de la auditoría: cierre 9 = 4+4+1 cierra; "2"≠17 y "9"≠17 no cierran.
{
  const porId = new Map<string, ResultadoCampoUniversal>();
  [resCampo('suma_total', '9'), resCampo('c1', '4'), resCampo('c2', '4'), resCampo('blanco', '1'), resCampo('nulos', '0'), resCampo('nm', '0')].forEach((r) => porId.set(r.id, r));
  const parse = parsearIgualdad('suma_total == c1 + c2 + blanco + nulos + nm');
  const izq = valorNumerico(porId.get('suma_total')!);
  const der = parse!.der.reduce((acc, t) => acc + (t.tipo === 'num' ? Number(t.valor) : (valorNumerico(porId.get(t.valor)!) ?? NaN)), 0);
  check('cierre de la auditoría: 9 == 4+4+1+0+0 → cierra', izq === der && izq === 9, `izq=${izq} der=${der}`);
}
{
  // Lectura falsa "2" de SUMA TOTAL (17 real): la defensa la rechaza.
  const porId = new Map<string, ResultadoCampoUniversal>();
  [resCampo('suma_total', '2'), resCampo('c1', '9'), resCampo('c2', '7'), resCampo('blanco', '1'), resCampo('nulos', '0'), resCampo('nm', '0')].forEach((r) => porId.set(r.id, r));
  const parse = parsearIgualdad('suma_total == c1 + c2 + blanco + nulos + nm');
  const izq = valorNumerico(porId.get('suma_total')!);
  const der = parse!.der.reduce((acc, t) => acc + (t.tipo === 'num' ? Number(t.valor) : (valorNumerico(porId.get(t.valor)!) ?? NaN)), 0);
  check('lectura falsa "2"≠17 → NO cierra (queda en revisión)', izq !== der, `izq=${izq} der=${der}`);
}

// ---------- sugerencia de umbral (Fase 2.1) ----------
console.log('umbral — sugeridor sobre ratios medidos');

{
  const resultados = {
    paginas: [
      { pagina: 1, ocr_conf: 0.9, campos: [resCampo('v1', true), resCampo('v1', true)] },
      { pagina: -1, ocr_conf: 0, campos: [{ ...resCampo('v1', false, 'no_encontrado') }] },
    ],
  } as unknown as ResultadoUniversal;
  // ratios: 0.009 (presente), 0.011 (presente), 0.0004 (vacío)
  (resultados.paginas[0].campos[0] as ResultadoCampoUniversal).ratio = 0.011;
  (resultados.paginas[0].campos[1] as ResultadoCampoUniversal).ratio = 0.009;
  (resultados.paginas[1].campos[0] as ResultadoCampoUniversal).ratio = 0.0004;
  const s = sugerirUmbral(resultados, 'v1');
  check('sugiere trazo más fino × 0.7', s.sugerido !== null && Math.abs(s.sugerido - 0.009 * 0.7) < 1e-6, JSON.stringify(s));
  check('maxSinTinta detectado', s.maxSinTinta === 0.0004);
  const sSinDatos = sugerirUmbral(resultados, 'otro');
  check('campo sin mediciones → sugerido null', sSinDatos.sugerido === null);
}

// ---------- anclas: penalización de posición suavizada (Matiz 1) ----------
console.log('anclas — penalización de posición (Matiz 1)');

const lineas: LineaOcr[] = [
  {
    texto: 'HUBO RECUENTO',
    bbox: [300, 500, 700, 540],
    palabras: [
      { texto: 'HUBO', conf: 95, bbox: [300, 500, 480, 540] },
      { texto: 'RECUENTO', conf: 95, bbox: [490, 500, 700, 540] },
    ],
  },
];
// Canvas 1000x3000. Rect esperado desplazado 0.077 (caso Transmisión pág. 2):
// centro real (0.5, 0.18); esperado (0.5-0.0, 0.18-0.077) → dx+dy = 0.077.
{
  const hit = buscarAncla('HUBO RECUENTO', lineas, 1000, 3000, { x: 0.35, y: 0.18, w: 0.3, h: 0.014 });
  // Centro del hit: x=(300+700)/2/1000=0.5, y=(500+540)/2/3000=0.173.
  // Esperado centro: (0.35+0.15, 0.18+0.007)=(0.5, 0.187) → dy≈0.0137 → penalización leve.
  check('match textual 1.0 con desplazamiento pequeño ≥ 0.72 (ancla por OCR, no fallback)', hit !== null && hit.score >= 0.72, `score=${hit?.score}`);
}
{
  // Desplazamiento GRANDE (0.25): etiqueta de otra parte del documento → penalizada.
  const hit = buscarAncla('HUBO RECUENTO', lineas, 1000, 3000, { x: 0.1, y: 0.55, w: 0.3, h: 0.014 });
  check('etiqueta lejana (d≈0.25) queda bajo el corte 0.72', hit === null || hit.score < 0.72, `score=${hit?.score}`);
}
{
  // Fotos rotadas: orden de palabras invertido ("RECUENTO HUBO") → fallback anagrama.
  const rotadas: LineaOcr[] = [
    {
      texto: 'RECUENTO HUBO',
      bbox: [300, 500, 700, 540],
      palabras: [
        { texto: 'RECUENTO', conf: 95, bbox: [300, 500, 510, 540] },
        { texto: 'HUBO', conf: 95, bbox: [520, 500, 700, 540] },
      ],
    },
  ];
  const hit = buscarAncla('HUBO RECUENTO', rotadas, 1000, 3000);
  check('orden invertido (foto rotada) matchea por anagrama con penalización leve', hit !== null && hit.score >= 0.72, `score=${hit?.score}`);
}

check('normTxt normaliza acentos/case', normTxt('País ZONA: 05') === 'PAIS ZONA 05');
check('editDistance básico', editDistance('HUBO', 'HUBA') === 1);

// ---------- validador de moldes endurecido (N-4) ----------
console.log('validador — esMoldeUniversal endurecido (N-4)');

const moldeBueno = {
  tipo: 'universal',
  version: '3.0.0',
  nombre: 'X',
  campos: [
    { id: 'a', etiqueta: 'A', pagina: 1, tipo: 'texto', estrategia: 'zona_fija', zona: { x: 0.1, y: 0.1, w: 0.2, h: 0.03 }, umbral: 0.02, obligatorio: true },
    { id: 'b', etiqueta: 'B', pagina: 2, tipo: 'presencia', estrategia: 'ancla_relativa', zona: { x: 0.01, y: 0.02, w: 0.1, h: 0.02 }, ancla: { texto: 'ZONA' }, umbral: 0.006, obligatorio: false },
  ],
};
check('molde bien formado pasa', esMoldeUniversal(moldeBueno));

const sinZona = { tipo: 'universal', nombre: 'X', campos: [{ id: 'a', etiqueta: 'A', pagina: 1, tipo: 'texto', estrategia: 'zona_fija', umbral: 0.02, obligatorio: true }] };
check('molde sin zona NO pasa (G-9: antes reventaba el editor)', !esMoldeUniversal(sinZona) && erroresMolde(sinZona).some((e) => e.includes('zona')));

const zonaNaN = { tipo: 'universal', nombre: 'X', campos: [{ id: 'a', etiqueta: 'A', pagina: 1, tipo: 'texto', estrategia: 'zona_fija', zona: { x: NaN, y: 0, w: 0.2, h: 0.03 }, umbral: 0.02, obligatorio: true }] };
check('zona con NaN NO pasa (N-4: tumbaba la corrida con IndexSizeError)', !esMoldeUniversal(zonaNaN));

const anclaVacia = { tipo: 'universal', nombre: 'X', campos: [{ id: 'a', etiqueta: 'A', pagina: 1, tipo: 'texto', estrategia: 'ancla_relativa', zona: { x: 0, y: 0, w: 0.2, h: 0.03 }, ancla: { texto: '  ' }, umbral: 0.02, obligatorio: true }] };
check('ancla_relativa con ancla vacía NO pasa (G-10)', !esMoldeUniversal(anclaVacia) && erroresMolde(anclaVacia).some((e) => e.includes('ancla')));

const paginaCero = { tipo: 'universal', nombre: 'X', campos: [{ id: 'a', etiqueta: 'A', pagina: 0, tipo: 'texto', estrategia: 'zona_fija', zona: { x: 0.1, y: 0.1, w: 0.2, h: 0.03 }, umbral: 0.02, obligatorio: true }] };
check('pagina 0 NO pasa', !esMoldeUniversal(paginaCero));

const umbralFuera = { tipo: 'universal', nombre: 'X', campos: [{ id: 'a', etiqueta: 'A', pagina: 1, tipo: 'presencia', estrategia: 'zona_fija', zona: { x: 0.1, y: 0.1, w: 0.2, h: 0.03 }, umbral: 1.4, obligatorio: true }] };
check('umbral fuera de [0,1] NO pasa', !esMoldeUniversal(umbralFuera));

// ---------- molde regenerado ----------
console.log('molde regenerado — sanidad');

{
  const molde = (await import('./acta_e_14_exterior_consul_embajado.molde.json')).default;
  check('el molde regenerado pasa el validador endurecido', esMoldeUniversal(molde));
  check('sin meta.precision (G-1)', molde.meta === undefined || !('precision' in (molde.meta as Record<string, unknown>)));
  check('paginasRef explícito vacío', Array.isArray(molde.paginasRef) && molde.paginasRef.length === 0);
  check('validación de cierre presente', (molde.validaciones ?? []).some((v) => v.id === 'cierre_suma'));
  const suma = molde.campos.find((c) => c.id === 'suma_total');
  check('suma_total es HTR (Fase 2.5 opción C)', suma?.htr === true);
  const zona = molde.campos.find((c) => c.id === 'divipol_zona');
  check('patrón de zona anclado (G-8)', zona?.patron === '^\\d{2}$');
  const v1 = molde.campos.find((c) => c.id === 'votos_candidato_1');
  check('votos_candidato_1 con umbral 0.006 (Fase 2.1)', v1?.umbral === 0.006);
  const firma = molde.campos.find((c) => c.id === 'firma_jurado_1');
  check('firma sin etiqueta impresa: umbral 0.018 (G-11)', firma?.umbral === 0.018);
  check('la expresión del cierre parsea con el parser seguro', parsearIgualdad(molde.validaciones![0].expresion) !== null);
}

if (fallos > 0) {
  console.error(`\n✗ ${fallos} comprobaciones fallaron`);
  process.exit(1);
}
console.log('\n✓ Corpus lógico del motor en verde');
