// Construye y guarda el molde universal v3 del ACTA E-14 EXTERIOR
// (Cónsul/Embajador y Transmisión) a partir del escaneo de referencia Nairobi.
//
// Requisitos de reconocimiento:
//  - OBLIGATORIOS: Divipol completo (consulado, país, zona, puesto, mesa, lugar),
//    firma del jurado 1 y valor manuscrito de la SUMA TOTAL de votos.
//  - OPCIONALES (variables): solo identificar presencia (firmas jurado 2-4,
//    demás manuscritos, constancias y marcaje de recuento).
//
// Coordenadas calibradas con Tesseract.js (spa+eng, psm 4) sobre
// public/actas/nairobi-p1.png (1000x3028) y nairobi-p2.png (1000x3017),
// y validadas contra fotos reales renderizadas a escala 3 (~816 px ancho):
// Frankfurt (Alemania) y El Cairo (Egipto).
//
// Uso: bun scripts/crear-molde-e14.ts  (requiere el dev server en :3000)

const API = 'http://localhost:3000/api/moldes';

interface Campo {
  id: string;
  etiqueta: string;
  pagina: number;
  tipo: 'texto' | 'presencia' | 'firma' | 'checkbox';
  estrategia: 'zona_fija' | 'ancla_relativa';
  zona: { x: number; y: number; w: number; h: number };
  ancla?: { texto: string; rect?: { x: number; y: number; w: number; h: number } };
  ancla_respaldo?: string;
  x_absoluto?: boolean;
  umbral: number;
  patron?: string;
  whitelist?: string;
  realce?: boolean;
  obligatorio: boolean;
  nota?: string;
}

// Helpers de ancla: rect esperado medido en el escaneo de referencia.
const A = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

const campos: Campo[] = [
  // ============ PÁGINA 1 — DIVIPOL (obligatorio) ============
  {
    id: 'divipol_consulado',
    etiqueta: 'Divipol · Consulado',
    pagina: 1,
    tipo: 'texto',
    estrategia: 'ancla_relativa',
    zona: { x: 0.198, y: 0.0005, w: 0.42, h: 0.011 },
    ancla: { texto: 'CONSULADO', rect: A(0.062, 0.1509, 0.187, 0.0073) },
    umbral: 0.02,
    patron: '\\d{2}',
    realce: true,
    obligatorio: true,
    nota: 'Valor impreso tras "CONSULADO:" (código + nombre). Zona relativa al ancla para adaptarse a fotos.',
  },
  {
    id: 'divipol_pais',
    etiqueta: 'Divipol · País',
    pagina: 1,
    tipo: 'texto',
    estrategia: 'ancla_relativa',
    zona: { x: 0.080, y: 0.001, w: 0.36, h: 0.011 },
    ancla: { texto: 'PAIS', rect: A(0.062, 0.1628, 0.069, 0.0093) },
    ancla_respaldo: 'PAÍS',
    umbral: 0.02,
    patron: '\\d{3}',
    realce: true,
    obligatorio: true,
    nota: 'Código (3 dígitos) + nombre del país tras "PAÍS:".',
  },
  {
    id: 'divipol_zona',
    etiqueta: 'Divipol · Zona',
    pagina: 1,
    tipo: 'texto',
    estrategia: 'ancla_relativa',
    zona: { x: 0.097, y: 0.0005, w: 0.052, h: 0.009 },
    ancla: { texto: 'ZONA', rect: A(0.06, 0.1787, 0.085, 0.0069) },
    ancla_respaldo: 'ZONA PUESTO',
    umbral: 0.02,
    patron: '\\d{2}',
    realce: true,
    obligatorio: true,
    nota: 'Dos dígitos tras "ZONA:". El respaldo cubre el caso en que la foto fusiona "ZONA: 05" en una sola palabra.',
  },
  {
    id: 'divipol_puesto',
    etiqueta: 'Divipol · Puesto',
    pagina: 1,
    tipo: 'texto',
    estrategia: 'ancla_relativa',
    zona: { x: 0.134, y: 0.0005, w: 0.05, h: 0.009 },
    ancla: { texto: 'PUESTO', rect: A(0.207, 0.1783, 0.122, 0.0073) },
    umbral: 0.02,
    patron: '\\d{2}',
    realce: true,
    obligatorio: true,
    nota: 'Dos dígitos tras "PUESTO:" (misma línea que ZONA y MESA).',
  },
  {
    id: 'divipol_mesa',
    etiqueta: 'Divipol · Mesa',
    pagina: 1,
    tipo: 'texto',
    estrategia: 'ancla_relativa',
    zona: { x: 0.096, y: 0.0005, w: 0.13, h: 0.009 },
    ancla: { texto: 'MESA', rect: A(0.391, 0.1783, 0.085, 0.0073) },
    umbral: 0.02,
    patron: '\\d{3}',
    realce: true,
    obligatorio: true,
    nota: 'Tres dígitos tras "MESA:". La proximidad al rect esperado evita confundirla con "NIVELACIÓN DE LA MESA".',
  },
  {
    id: 'divipol_lugar',
    etiqueta: 'Divipol · Lugar',
    pagina: 1,
    tipo: 'texto',
    estrategia: 'ancla_relativa',
    zona: { x: 0.113, y: 0.001, w: 0.62, h: 0.011 },
    ancla: { texto: 'LUGAR', rect: A(0.062, 0.1919, 0.103, 0.0076) },
    umbral: 0.02,
    realce: true,
    obligatorio: true,
    nota: 'Texto libre tras "LUGAR:" (ciudad / sede del consulado).',
  },

  // ============ PÁGINA 1 — SUMA TOTAL (manuscrito OBLIGATORIO) ============
  {
    id: 'suma_total',
    etiqueta: 'Suma total de votos (manuscrito)',
    pagina: 1,
    tipo: 'texto',
    estrategia: 'ancla_relativa',
    zona: { x: 0.815, y: -0.004, w: 0.165, h: 0.03 },
    ancla: { texto: 'SUMA TOTAL', rect: A(0.146, 0.8177, 0.199, 0.0069) },
    x_absoluto: true,
    umbral: 0.02,
    patron: '^[0-9]{1,3}( [0-9]{1,3})?$',
    whitelist: '0123456789',
    realce: true,
    obligatorio: true,
    nota: 'OBLIGATORIO leer el número manuscrito de la SUMA TOTAL. Columna fija (x absoluto), alto offset del ancla. Realce + whitelist de dígitos.',
  },

  // ============ PÁGINA 1 — demás manuscritos (presencia OPCIONAL) ============
  {
    id: 'total_votantes_e11',
    etiqueta: 'Total votantes formulario E-11',
    pagina: 1,
    tipo: 'presencia',
    estrategia: 'ancla_relativa',
    zona: { x: 0.66, y: -0.003, w: 0.3, h: 0.026 },
    ancla: { texto: 'TOTAL VOTANTES', rect: A(0.124, 0.2645, 0.232, 0.0066) },
    x_absoluto: true,
    umbral: 0.015,
    obligatorio: false,
    nota: 'Opcional: solo presencia de tinta manuscrita en la fila.',
  },
  {
    id: 'total_votos_urna',
    etiqueta: 'Total votos en la urna',
    pagina: 1,
    tipo: 'presencia',
    estrategia: 'ancla_relativa',
    zona: { x: 0.66, y: -0.004, w: 0.3, h: 0.026 },
    ancla: { texto: 'TOTAL VOTOS EN LA URNA', rect: A(0.187, 0.2969, 0.349, 0.0066) },
    x_absoluto: true,
    umbral: 0.015,
    obligatorio: false,
  },
  {
    id: 'total_votos_incinerados',
    etiqueta: 'Total votos incinerados',
    pagina: 1,
    tipo: 'presencia',
    estrategia: 'ancla_relativa',
    zona: { x: 0.66, y: -0.002, w: 0.3, h: 0.022 },
    ancla: { texto: 'TOTAL VOTOS INCINERADOS', rect: A(0.177, 0.3293, 0.368, 0.0062) },
    x_absoluto: true,
    umbral: 0.012,
    obligatorio: false,
  },
  {
    id: 'votos_candidato_1',
    etiqueta: 'Votación candidato 1 ( Iván Cepeda )',
    pagina: 1,
    tipo: 'presencia',
    estrategia: 'ancla_relativa',
    zona: { x: 0.66, y: -0.048, w: 0.3, h: 0.04 },
    ancla: { texto: 'IVAN CEPEDA CASTRO', rect: A(0.258, 0.5079, 0.263, 0.0089) },
    x_absoluto: true,
    umbral: 0.015,
    obligatorio: false,
    nota: 'Columna de votación arriba del nombre; offset negativo desde el ancla.',
  },
  {
    id: 'votos_candidato_2',
    etiqueta: 'Votación candidato 2 ( Abelardo )',
    pagina: 1,
    tipo: 'presencia',
    estrategia: 'ancla_relativa',
    zona: { x: 0.66, y: -0.06, w: 0.3, h: 0.045 },
    ancla: { texto: 'ABELARDO DE LA ESPRIELLA', rect: A(0.217, 0.6648, 0.34, 0.0073) },
    x_absoluto: true,
    umbral: 0.015,
    obligatorio: false,
  },
  {
    id: 'votos_en_blanco',
    etiqueta: 'Votos en blanco',
    pagina: 1,
    tipo: 'presencia',
    estrategia: 'ancla_relativa',
    zona: { x: 0.66, y: -0.003, w: 0.3, h: 0.026 },
    ancla: { texto: 'VOTOS EN BLANCO', rect: A(0.233, 0.7292, 0.248, 0.0066) },
    x_absoluto: true,
    umbral: 0.015,
    obligatorio: false,
  },
  {
    id: 'votos_nulos',
    etiqueta: 'Votos nulos',
    pagina: 1,
    tipo: 'presencia',
    estrategia: 'ancla_relativa',
    zona: { x: 0.66, y: -0.002, w: 0.3, h: 0.024 },
    ancla: { texto: 'VOTOS NULOS', rect: A(0.263, 0.7612, 0.186, 0.0066) },
    x_absoluto: true,
    umbral: 0.012,
    obligatorio: false,
  },
  {
    id: 'votos_no_marcados',
    etiqueta: 'Votos no marcados',
    pagina: 1,
    tipo: 'presencia',
    estrategia: 'ancla_relativa',
    zona: { x: 0.66, y: -0.002, w: 0.3, h: 0.024 },
    ancla: { texto: 'VOTOS NO MARCADOS', rect: A(0.209, 0.7919, 0.293, 0.0066) },
    x_absoluto: true,
    umbral: 0.012,
    obligatorio: false,
  },

  // ============ PÁGINA 2 — FIRMAS ============
  {
    id: 'firma_jurado_1',
    etiqueta: 'Firma jurado 1',
    pagina: 2,
    tipo: 'firma',
    estrategia: 'ancla_relativa',
    zona: { x: -0.145, y: -0.01, w: 0.45, h: 0.06 },
    ancla: { texto: 'FIRMA JURADO 1', rect: A(0.178, 0.8376, 0.157, 0.005) },
    ancla_respaldo: 'FIRMAS JURADO 1',
    umbral: 0.012,
    obligatorio: true,
    nota: 'OBLIGATORIO: casilla izquierda superior; la zona cubre la firma (incluso trazos que suben sobre la etiqueta).',
  },
  {
    id: 'firma_jurado_2',
    etiqueta: 'Firma jurado 2',
    pagina: 2,
    tipo: 'firma',
    estrategia: 'ancla_relativa',
    zona: { x: -0.145, y: -0.01, w: 0.45, h: 0.06 },
    ancla: { texto: 'FIRMA JURADO 2', rect: A(0.625, 0.8386, 0.159, 0.0046) },
    ancla_respaldo: 'FIRMAS JURADO 2',
    umbral: 0.012,
    obligatorio: false,
  },
  {
    id: 'firma_jurado_3',
    etiqueta: 'Firma jurado 3',
    pagina: 2,
    tipo: 'firma',
    estrategia: 'ancla_relativa',
    zona: { x: -0.145, y: -0.008, w: 0.45, h: 0.062 },
    ancla: { texto: 'FIRMA JURADO 3', rect: A(0.177, 0.9059, 0.159, 0.0049) },
    ancla_respaldo: 'FIRMAS JURADO 3',
    umbral: 0.012,
    obligatorio: false,
  },
  {
    id: 'firma_jurado_4',
    etiqueta: 'Firma jurado 4',
    pagina: 2,
    tipo: 'firma',
    estrategia: 'ancla_relativa',
    zona: { x: -0.145, y: -0.008, w: 0.45, h: 0.062 },
    ancla: { texto: 'FIRMA JURADO 4', rect: A(0.624, 0.9062, 0.163, 0.0053) },
    ancla_respaldo: 'FIRMAS JURADO 4',
    umbral: 0.012,
    obligatorio: false,
  },

  // ============ PÁGINA 2 — otros (OPCIONALES) ============
  {
    id: 'constancias_presencia',
    etiqueta: 'Constancias de los jurados (manuscrito)',
    pagina: 2,
    tipo: 'presencia',
    estrategia: 'ancla_relativa',
    zona: { x: 0.05, y: 0.01, w: 0.9, h: 0.39 },
    ancla: { texto: 'CONSTANCIAS DE LOS JURADOS', rect: A(0.191, 0.2393, 0.42, 0.007) },
    x_absoluto: true,
    umbral: 0.0015,
    obligatorio: false,
    nota: 'Presencia de escritura en el recuadro grande de constancias.',
  },
  {
    id: 'recuento_marca',
    etiqueta: 'Marca recuento de votos (SÍ/NO)',
    pagina: 2,
    tipo: 'checkbox',
    estrategia: 'ancla_relativa',
    zona: { x: 0.42, y: -0.005, w: 0.18, h: 0.022 },
    ancla: { texto: 'HUBO RECUENTO', rect: A(0.054, 0.6715, 0.21, 0.0057) },
    x_absoluto: true,
    umbral: 0.008,
    obligatorio: false,
    nota: 'Zona de las casillas SÍ/NO; detecta la X manuscrita.',
  },
];

const molde = {
  tipo: 'universal',
  version: '3.0.0',
  nombre: 'Acta E-14 Exterior (Cónsul/Embajador · Transmisión)',
  descripcion:
    'Molde construido sobre el escaneo de referencia (Nairobi 515) con Divipol completo obligatorio, firma del jurado 1 obligatoria y lectura manuscrita obligatoria de la SUMA TOTAL. Los demás manuscritos y firmas se evalúan solo por presencia (opcionales). Estrategia ancla_relativa + x_absoluto para adaptarse automáticamente a fotos.',
  documento: 'acta_e14',
  idioma: 'es',
  paginasRef: [
    { pagina: 1, imagen: '/actas/nairobi-p1.png' },
    { pagina: 2, imagen: '/actas/nairobi-p2.png' },
  ],
  campos,
  meta: {
    precision: 100,
    docs: 2,
    unidadDocs: 'actas de prueba',
    estado: 'validando' as const,
    validacion: 'Frankfurt + El Cairo',
    etiquetas: { texto: 'Divipol y suma', firma: 'Firmas', presencia: 'Presencia', checkbox: 'OMR' },
    etiquetaCampos: 'Campos Mapeados',
    orden: 0,
  },
};

async function main() {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: molde, imagenRef: '/actas/nairobi-p1.png' }),
  });
  const body = await res.json();
  if (!res.ok) {
    console.error('ERROR:', body);
    process.exit(1);
  }
  console.log('Molde creado con id:', body.id);
  console.log('Campos:', campos.length, '| obligatorios:', campos.filter((c) => c.obligatorio).length);
}
main();
