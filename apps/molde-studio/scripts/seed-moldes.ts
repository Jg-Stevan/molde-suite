// Seed de la Biblioteca — replica las 4 tarjetas del diseño Stitch
// (biblioteca_de_plantillas_docutemplate_studio/screen.png).
// Borra los moldes existentes y crea los del diseño con meta de presentación.

import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';

const db = new PrismaClient();

interface CampoSeed {
  id?: string;
  etiqueta: string;
  tipo: 'texto' | 'presencia' | 'firma' | 'checkbox';
  /** Zona explícita (normalizada). Si no, se distribuye en grilla. */
  zona?: { x: number; y: number; w: number; h: number };
  pagina?: number;
  estrategia?: 'zona_fija' | 'ancla_relativa';
  ancla?: string | { texto: string; rect?: { x: number; y: number; w: number; h: number } };
  x_absoluto?: boolean;
  umbral?: number;
  obligatorio?: boolean;
}

function camposDesde(seeds: CampoSeed[]) {
  return seeds.map((c, i) => {
    const col = i % 6;
    const fila = Math.floor(i / 6);
    return {
      id: c.id ?? `campo_${String(i + 1).padStart(2, '0')}`,
      etiqueta: c.etiqueta,
      pagina: c.pagina ?? 1,
      tipo: c.tipo,
      estrategia: c.estrategia ?? ('zona_fija' as const),
      zona: c.zona ?? {
        x: 0.06 + col * 0.155,
        y: 0.08 + fila * 0.115,
        w: 0.14,
        h: 0.045,
      },
      ...(c.ancla
        ? { ancla: typeof c.ancla === 'string' ? { texto: c.ancla } : c.ancla }
        : {}),
      ...(c.x_absoluto ? { x_absoluto: true } : {}),
      umbral: c.umbral ?? 0.12,
      obligatorio: c.obligatorio ?? true,
      nota: 'Zona semilla del diseño Stitch — reajustar en el Editor Visual.',
    };
  });
}

const MOLDES: {
  nombre: string;
  documento: string;
  version: string;
  descripcion: string;
  fecha: { y: number; m: number; d: number; hh: number; mm: number };
  imagenRef?: string;
  paginasRef?: { pagina: number; imagen: string }[];
  meta: {
    precision: number;
    docs: number;
    estado: 'activo' | 'validando' | 'ninguno';
    validacion: string;
    unidadDocs: string;
    etiquetas: Record<string, string>;
    etiquetaCampos?: string;
    orden: number;
  };
  campos: CampoSeed[];
}[] = [
  {
    nombre: 'Factura Electrónica & Recibo Fiscal (OCR DIAN)',
    documento: 'Fiscal & Comercial',
    version: '2.4.0',
    descripcion:
      'Esquema de facturación electrónica con segmentación de cuadrículas de impuestos, código QR CUFE, resolución DIAN y totalización contable.',
    fecha: (() => {
      const d = new Date();
      return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate(), hh: 16, mm: 10 };
    })(),
    meta: {
      precision: 99.7,
      docs: 3240,
      estado: 'activo',
      validacion: 'Validación DIAN OK',
      unidadDocs: 'docs validados',
      etiquetas: { presencia: 'Fiscales', firma: 'Firmas', texto: 'Tablas' },
      etiquetaCampos: 'Campos Mapeados',
      orden: 1,
    },
    campos: [
      { etiqueta: 'NIT Emisor', tipo: 'presencia' },
      { etiqueta: 'Razón Social Emisor', tipo: 'presencia' },
      { etiqueta: 'NIT Adquiriente', tipo: 'presencia' },
      { etiqueta: 'Razón Social Adquiriente', tipo: 'presencia' },
      { etiqueta: 'Número de Factura', tipo: 'presencia' },
      { etiqueta: 'Fecha de Expedición', tipo: 'presencia' },
      { etiqueta: 'CUFE', tipo: 'presencia' },
      { etiqueta: 'Subtotal', tipo: 'presencia' },
      { etiqueta: 'IVA 19%', tipo: 'presencia' },
      { etiqueta: 'Total a Pagar', tipo: 'presencia' },
      { etiqueta: 'Medios de Pago', tipo: 'presencia' },
      { etiqueta: 'Resolución DIAN', tipo: 'presencia' },
      { etiqueta: 'Código QR', tipo: 'presencia' },
      { etiqueta: 'Régimen', tipo: 'presencia' },
      { etiqueta: 'Firma Representante Legal', tipo: 'firma' },
      { etiqueta: 'Firma Contador', tipo: 'firma' },
      { etiqueta: 'Sello Seco Emisor', tipo: 'firma' },
      { etiqueta: 'Firma Adquiriente', tipo: 'firma' },
      { etiqueta: 'Sello de Habilitación', tipo: 'firma' },
      { etiqueta: 'Firma Revisor Fiscal', tipo: 'firma' },
      { etiqueta: 'Firma Transportador', tipo: 'firma' },
      { etiqueta: 'Descripción del Servicio', tipo: 'texto' },
      { etiqueta: 'Cantidad', tipo: 'texto' },
      { etiqueta: 'Valor Unitario', tipo: 'texto' },
      { etiqueta: 'Subtotal Línea', tipo: 'texto' },
      { etiqueta: 'Descuento Línea', tipo: 'texto' },
      { etiqueta: 'Impuestos Línea', tipo: 'texto' },
      { etiqueta: 'Total Línea', tipo: 'texto' },
    ],
  },
  {
    nombre: 'Pagaré & Declaración Juramentada Notarial',
    documento: 'Legal & Notarial',
    version: '1.8.0',
    descripcion:
      'Detección de firmas manuscritas biométricas, sellos secos notariales, huella dactilar dactiloscópica y código de barras de radicación ministerial.',
    fecha: (() => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate(), hh: 11, mm: 20 };
    })(),
    meta: {
      precision: 98.5,
      docs: 890,
      estado: 'ninguno',
      validacion: 'Anclas Notariales OK',
      unidadDocs: 'docs validados',
      etiquetas: { presencia: 'Cláusulas', firma: 'Firmas', texto: 'Radicación' },
      etiquetaCampos: 'Zonas Auditables',
      orden: 2,
    },
    campos: [
      { etiqueta: 'Cláusula de Monto', tipo: 'presencia' },
      { etiqueta: 'Cláusula de Plazo', tipo: 'presencia' },
      { etiqueta: 'Cláusula de Intereses', tipo: 'presencia' },
      { etiqueta: 'Cláusula de Garantía', tipo: 'presencia' },
      { etiqueta: 'Cláusula de Jurisdicción', tipo: 'presencia' },
      { etiqueta: 'Cláusula de Autenticación', tipo: 'presencia' },
      { etiqueta: 'Firma Deudor Principal', tipo: 'firma' },
      { etiqueta: 'Firma Codeudor 1', tipo: 'firma' },
      { etiqueta: 'Firma Codeudor 2', tipo: 'firma' },
      { etiqueta: 'Firma Testigo 1', tipo: 'firma' },
      { etiqueta: 'Firma Testigo 2', tipo: 'firma' },
      { etiqueta: 'Sello Notarial Seco', tipo: 'firma' },
      { etiqueta: 'Huella Dactilar Deudor', tipo: 'firma' },
      { etiqueta: 'Firma Escribano', tipo: 'firma' },
      { etiqueta: 'Firma Tratamiento de Datos', tipo: 'firma' },
      { etiqueta: 'Número de Radicado', tipo: 'texto' },
      { etiqueta: 'Fecha de Radicación', tipo: 'texto' },
      { etiqueta: 'Notaría', tipo: 'texto' },
      { etiqueta: 'Código de Barras Ministerial', tipo: 'texto' },
    ],
  },
  {
    nombre: 'Acta de Escrutinio E-14 (Gubernamental)',
    documento: 'Gubernamental',
    version: '2.0.0',
    descripcion:
      'Plantilla electoral con resolución de anclas OCR mediante RANSAC homográfico bidimensional y decodificación ZXing Code-128 para actas de mesa.',
    fecha: (() => {
      const d = new Date();
      return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate(), hh: 14, mm: 22 };
    })(),
    imagenRef: '/actas-e14/referencia-p1.png',
    paginasRef: [
      { pagina: 1, imagen: '/actas-e14/referencia-p1.png' },
      { pagina: 2, imagen: '/actas-e14/referencia-p2.png' },
    ],
    meta: {
      precision: 99.4,
      docs: 140,
      estado: 'ninguno',
      validacion: 'Esquema doc.v2 Strict',
      unidadDocs: 'actas validadas',
      etiquetas: { presencia: 'Presencia', firma: 'Firmas', texto: 'Texto/ID' },
      etiquetaCampos: 'Campos Calibrados',
      orden: 3,
    },
    campos: [
      // Texto/ID ×6 — zonas ancla_relativa reales del escaneo nairobi.
      { id: 'campo_aueg20', etiqueta: 'Código Consulado', tipo: 'texto', estrategia: 'ancla_relativa', ancla: { texto: 'CONSULADO', rect: { x: 0.062, y: 0.151, w: 0.12, h: 0.02 } }, zona: { x: 0.1, y: 0, w: 0.2, h: 0.024 }, umbral: 0.03, obligatorio: true },
      { id: 'campo_zb39vg', etiqueta: 'Código País', tipo: 'texto', estrategia: 'ancla_relativa', ancla: { texto: 'PAIS', rect: { x: 0.062, y: 0.166, w: 0.12, h: 0.02 } }, zona: { x: 0.1, y: 0, w: 0.2, h: 0.024 }, umbral: 0.03, obligatorio: true },
      { id: 'campo_4i1nu9', etiqueta: 'Zona', tipo: 'texto', estrategia: 'ancla_relativa', ancla: { texto: 'ZONA', rect: { x: 0.06, y: 0.179, w: 0.1, h: 0.02 } }, zona: { x: 0.1, y: 0, w: 0.2, h: 0.024 }, umbral: 0.03, obligatorio: true },
      { id: 'campo_r56dqv', etiqueta: 'Puesto', tipo: 'texto', estrategia: 'ancla_relativa', ancla: { texto: 'PUESTO', rect: { x: 0.207, y: 0.178, w: 0.1, h: 0.02 } }, zona: { x: 0.1, y: 0, w: 0.2, h: 0.024 }, umbral: 0.03, obligatorio: true },
      { id: 'campo_hxu00b', etiqueta: 'Mesa', tipo: 'texto', estrategia: 'ancla_relativa', ancla: { texto: 'MESA', rect: { x: 0.391, y: 0.178, w: 0.08, h: 0.02 } }, zona: { x: 0.1, y: 0, w: 0.2, h: 0.024 }, umbral: 0.03, obligatorio: true },
      { id: 'campo_unbs6w', etiqueta: 'Lugar', tipo: 'texto', estrategia: 'ancla_relativa', ancla: { texto: 'LUGAR', rect: { x: 0.062, y: 0.192, w: 0.12, h: 0.02 } }, zona: { x: 0.1, y: 0, w: 0.2, h: 0.024 }, umbral: 0.03, obligatorio: false },
      // Presencia ×10 — bandas de totales (x absoluto, reales del escaneo).
      { id: 'campo_h2245k', etiqueta: 'Total Sufragantes E-11', tipo: 'presencia', estrategia: 'ancla_relativa', ancla: { texto: 'TOTAL', rect: { x: 0.36, y: 0.265, w: 0.24, h: 0.02 } }, x_absoluto: true, zona: { x: 0.62, y: -0.004, w: 0.35, h: 0.03 }, umbral: 0.03, obligatorio: false },
      { id: 'campo_rabnxk', etiqueta: 'Total Votos en la Urna', tipo: 'presencia', estrategia: 'ancla_relativa', ancla: { texto: 'TOTAL', rect: { x: 0.36, y: 0.297, w: 0.24, h: 0.02 } }, x_absoluto: true, zona: { x: 0.62, y: -0.004, w: 0.35, h: 0.03 }, umbral: 0.03, obligatorio: false },
      { id: 'campo_gkq9tc', etiqueta: 'Total Votos Incinerados', tipo: 'presencia', estrategia: 'ancla_relativa', ancla: { texto: 'INCINERADOS', rect: { x: 0.36, y: 0.329, w: 0.24, h: 0.02 } }, x_absoluto: true, zona: { x: 0.62, y: -0.004, w: 0.35, h: 0.03 }, umbral: 0.03, obligatorio: false },
      { id: 'campo_ivfoq7', etiqueta: 'Votos Lista 01 — Alianza Verde', tipo: 'presencia', estrategia: 'ancla_relativa', ancla: { texto: 'CEPEDA', rect: { x: 0.36, y: 0.424, w: 0.3, h: 0.03 } }, x_absoluto: true, zona: { x: 0.7, y: -0.09, w: 0.26, h: 0.082 }, umbral: 0.03, obligatorio: false },
      { id: 'campo_2ykfjz', etiqueta: 'Votos Lista 02 — Partido Histórico', tipo: 'presencia', estrategia: 'ancla_relativa', ancla: { texto: 'ABELARDO', rect: { x: 0.36, y: 0.579, w: 0.3, h: 0.03 } }, x_absoluto: true, zona: { x: 0.7, y: -0.09, w: 0.26, h: 0.082 }, umbral: 0.03, obligatorio: false },
      { id: 'campo_nuevo_l03', etiqueta: 'Votos Lista 03 — Partido Liberal', tipo: 'presencia', estrategia: 'ancla_relativa', ancla: { texto: 'LIBERAL', rect: { x: 0.36, y: 0.502, w: 0.3, h: 0.03 } }, x_absoluto: true, zona: { x: 0.7, y: -0.09, w: 0.26, h: 0.082 }, umbral: 0.03, obligatorio: false },
      { id: 'campo_f4syjd', etiqueta: 'Votos en Blanco', tipo: 'presencia', estrategia: 'ancla_relativa', ancla: { texto: 'BLANCO', rect: { x: 0.36, y: 0.652, w: 0.24, h: 0.02 } }, x_absoluto: true, zona: { x: 0.62, y: -0.004, w: 0.35, h: 0.03 }, umbral: 0.03, obligatorio: false },
      { id: 'campo_fc4qnp', etiqueta: 'Votos Nulos', tipo: 'presencia', estrategia: 'ancla_relativa', ancla: { texto: 'NULOS', rect: { x: 0.36, y: 0.702, w: 0.24, h: 0.02 } }, x_absoluto: true, zona: { x: 0.62, y: -0.004, w: 0.35, h: 0.03 }, umbral: 0.03, obligatorio: false },
      { id: 'campo_3fkfzn', etiqueta: 'Tarjetas No Marcadas', tipo: 'presencia', estrategia: 'ancla_relativa', ancla: { texto: 'MARCADAS', rect: { x: 0.36, y: 0.752, w: 0.24, h: 0.02 } }, x_absoluto: true, zona: { x: 0.62, y: -0.004, w: 0.35, h: 0.03 }, umbral: 0.03, obligatorio: false },
      { id: 'campo_ikxw2b', etiqueta: 'Total Votos de la Mesa', tipo: 'presencia', estrategia: 'ancla_relativa', ancla: { texto: 'SUMA', rect: { x: 0.36, y: 0.818, w: 0.24, h: 0.02 } }, x_absoluto: true, zona: { x: 0.62, y: -0.004, w: 0.35, h: 0.03 }, umbral: 0.03, obligatorio: false },
      // Firma ×6 — firmas de jurado reales en página 2 + sellos.
      { id: 'campo_0g5nq1', etiqueta: 'Firma Jurado 1', tipo: 'firma', zona: { x: 0.03, y: 0.85, w: 0.45, h: 0.05 }, pagina: 2, umbral: 0.02, obligatorio: true },
      { id: 'campo_4l5hio', etiqueta: 'Firma Jurado 2', tipo: 'firma', zona: { x: 0.52, y: 0.85, w: 0.44, h: 0.05 }, pagina: 2, umbral: 0.02, obligatorio: true },
      { id: 'campo_l8obhr', etiqueta: 'Firma Jurado 3', tipo: 'firma', zona: { x: 0.03, y: 0.915, w: 0.45, h: 0.05 }, pagina: 2, umbral: 0.02, obligatorio: true },
      { id: 'campo_5soeu0', etiqueta: 'Firma Jurado 4', tipo: 'firma', zona: { x: 0.52, y: 0.915, w: 0.44, h: 0.05 }, pagina: 2, umbral: 0.02, obligatorio: false },
      { id: 'campo_nuevo_sello', etiqueta: 'Sello Registraduría', tipo: 'firma', zona: { x: 0.72, y: 0.35, w: 0.2, h: 0.09 }, umbral: 0.02, obligatorio: false },
      { id: 'campo_nuevo_testigo', etiqueta: 'Firma Testigo de Partido', tipo: 'firma', zona: { x: 0.03, y: 0.75, w: 0.45, h: 0.06 }, pagina: 2, umbral: 0.02, obligatorio: false },
    ],
  },
  {
    nombre: 'Formulario Clínico / Consentimiento Informado',
    documento: 'Salud & Admisión',
    version: '1.2.0',
    descripcion:
      'Verificación automática de casillas OMR (checkboxes), diagnóstico CIE-10 manuscrito, firma de paciente, testigo médico y registro de seguro médico.',
    fecha: { y: 2025, m: 10, d: 14, hh: 17, mm: 35 },
    meta: {
      precision: 97.9,
      docs: 512,
      estado: 'ninguno',
      validacion: 'OMR + HTR Ready',
      unidadDocs: 'fichas auditadas',
      etiquetas: { checkbox: 'Checkbox', firma: 'Firmas', texto: 'Diagnóstico' },
      etiquetaCampos: 'Campos de Admisión',
      orden: 4,
    },
    campos: [
      { etiqueta: 'Autorización Tratamiento de Datos', tipo: 'checkbox' },
      { etiqueta: 'Consentimiento Procedimiento', tipo: 'checkbox' },
      { etiqueta: 'Acepta Anestesia', tipo: 'checkbox' },
      { etiqueta: 'Acepta Transfusión', tipo: 'checkbox' },
      { etiqueta: 'Consentimiento Biopsia', tipo: 'checkbox' },
      { etiqueta: 'Autoriza Contacto Telefónico', tipo: 'checkbox' },
      { etiqueta: 'Acepta Política de Privacidad', tipo: 'checkbox' },
      { etiqueta: 'Consentimiento Cirugía', tipo: 'checkbox' },
      { etiqueta: 'Autoriza Uso de Imagen Clínica', tipo: 'checkbox' },
      { etiqueta: 'Acepta Términos EPS', tipo: 'checkbox' },
      { etiqueta: 'Firma Paciente', tipo: 'firma' },
      { etiqueta: 'Firma Testigo', tipo: 'firma' },
      { etiqueta: 'Firma Médico Tratante', tipo: 'firma' },
      { etiqueta: 'Firma Enfermera Jefe', tipo: 'firma' },
      { etiqueta: 'Sello Institución', tipo: 'firma' },
      { etiqueta: 'Diagnóstico CIE-10 Principal', tipo: 'texto' },
      { etiqueta: 'Diagnóstico CIE-10 Secundario', tipo: 'texto' },
      { etiqueta: 'Nombre Completo del Paciente', tipo: 'texto' },
      { etiqueta: 'Documento de Identidad', tipo: 'texto' },
      { etiqueta: 'Fecha de Nacimiento', tipo: 'texto' },
      { etiqueta: 'Número de Historia Clínica', tipo: 'texto' },
      { etiqueta: 'Nombre EPS', tipo: 'texto' },
      { etiqueta: 'Número de Autorización', tipo: 'texto' },
      { etiqueta: 'Médico Tratante', tipo: 'texto' },
    ],
  },
];

async function main() {
  await db.prueba.deleteMany({});
  await db.molde.deleteMany({});

  for (const m of MOLDES) {
    const fecha = new Date(m.fecha.y, m.fecha.m, m.fecha.d, m.fecha.hh, m.fecha.mm);
    const molde: Record<string, unknown> = {
      tipo: 'universal',
      version: m.version,
      nombre: m.nombre,
      descripcion: m.descripcion,
      documento: m.documento,
      idioma: 'spa',
      campos: camposDesde(m.campos),
      meta: m.meta,
    };
    if (m.paginasRef) molde.paginasRef = m.paginasRef;
    await db.molde.create({
      data: {
        nombre: m.nombre,
        descripcion: m.descripcion,
        documento: m.documento,
        json: JSON.stringify(molde),
        imagenRef: m.imagenRef ?? null,
        createdAt: fecha,
        updatedAt: fecha,
      },
    });
  }

  // Corrida real restaurada del proyecto anterior (escaneo nairobi-p1)
  // para que el módulo Verificación tenga contenido como el diseño Stitch.
  const acta = await db.molde.findFirst({ where: { nombre: 'Acta de Escrutinio E-14 (Gubernamental)' } });
  if (acta) {
    const p = JSON.parse(readFileSync(new URL('./prueba-nairobi.json', import.meta.url), 'utf8')) as {
      archivo: string;
      resultados: unknown;
      score: number;
      requiereRevision: boolean;
    };
    await db.prueba.create({
      data: {
        moldeId: acta.id,
        archivo: p.archivo,
        resultados: JSON.stringify(p.resultados),
        score: p.score,
        requiereRevision: p.requiereRevision,
      },
    });
  }

  console.log(`Seed listo: ${MOLDES.length} moldes del diseño Stitch + corrida de verificación.`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
