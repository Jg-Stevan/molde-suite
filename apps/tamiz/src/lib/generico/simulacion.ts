// Páginas SIMULADAS del modo genérico (mismo espíritu que
// simulacion-imagenes.ts del E-14: canvas puro, sin dependencias, PARA
// demo/verificación sin cámara — el pipeline real corre igual sobre ellas).
//
// Dibuja el papel con las ANCLAS del molde en sus posiciones declaradas
// (rect 0..1 sobre la página) y valores de ejemplo en las zonas, así el
// reconocimiento de plantilla y el motor universal encuentran lo esperado.

import type { CampoUniversal, MoldeUniversal } from '@jg-stevan/scanner-core/molde/universal-types';

const ANCHO = 850;
const ALTO = 1100;
// Papel casi llenando el cuadro (scan limpio): el anillo del borde queda
// blanco → prepararPagina toma el camino 'identidad' (sin warp) y las
// posiciones declaradas se cumplen al píxel, igual que el simulador E-14.
const PAPEL = { x: 8, y: 8, w: 834, h: 1084 };

/** Valor de ejemplo para un campo, según su patrón (sin inventar datos raros). */
function valorDeEjemplo(campo: CampoUniversal): string {
  const patron = campo.patron ?? '';
  if (/REC-/.test(patron)) return 'REC-2026-0157';
  if (/\\d{1,2}\\s+de/.test(patron)) return '2 de febrero de 2026';
  if (/\\d{1,2}[\\/-]\\d{1,2}[\\/-]/.test(patron)) return '05/02/2026';
  if (/DNI/.test(patron)) return 'DNI 8.101.234-5';
  if (/\\d{1,3}(\\.\\d{3})*,\\d{2}/.test(patron)) return '1.250,00';
  if (/\\d{3}/.test(patron)) return '123';
  if (campo.htr) return 'dato a mano';
  return 'VALOR LEIDO';
}

/** Reduce el tamaño de fuente hasta que el texto quepa en maxW (zonas/anclas). */
function fuenteQueQuepa(
  ctx: CanvasRenderingContext2D,
  texto: string,
  maxW: number,
  basePx: number,
  sufijo = 'px Arial, sans-serif',
): number {
  let px = basePx;
  ctx.font = `bold ${px}${sufijo}`;
  while (px > 9 && ctx.measureText(texto).width > maxW) {
    px -= 1;
    ctx.font = `bold ${px}${sufijo}`;
  }
  return px;
}

function dibujarCampo(
  ctx: CanvasRenderingContext2D,
  campo: CampoUniversal,
  pagina: number,
): void {
  if (campo.pagina !== pagina) return;

  // Etiqueta de la ANCLA en su posición declarada (el motor la busca ahí).
  // Tamaño proporcional al rect declarado (los títulos salen más grandes).
  if (campo.estrategia === 'ancla_relativa' && campo.ancla) {
    const r = campo.ancla.rect;
    // Ancla sin rect declarado: no hay posición donde dibujar.
    if (!r) return;
    const x = PAPEL.x + r.x * PAPEL.w;
    const y = PAPEL.y + (r.y + r.h / 2) * PAPEL.h;
    // Tamaño proporcional al rect declarado Y ajustado a su ancho (el
    // texto recortado rompe el patrón del motor — lección E2E).
    const tamano = fuenteQueQuepa(
      ctx,
      campo.ancla.texto.toUpperCase(),
      r.w * PAPEL.w,
      Math.max(14, Math.min(26, Math.round(r.h * PAPEL.h * 0.85))),
    );
    ctx.fillStyle = '#111111';
    ctx.textAlign = 'left';
    ctx.fillText(campo.ancla.texto.toUpperCase(), x, y);

    // Los campos de IDENTIDAD (destacado) NO llevan valor dibujado: su
    // contenido esperado ES la propia ancla (el patrón coincide con ella).
    if (campo.destacado === true) return;

    // Valor de ejemplo dentro de la zona (relativa al ancla). Trazo grueso
    // y oscuro, ajustado al ANCHO de la zona para no salirse del recorte
    // que evalúa el motor.
    const z = campo.zona;
    const zx = PAPEL.x + (r.x + z.x) * PAPEL.w;
    const zy = PAPEL.y + (r.y + z.y + z.h / 2) * PAPEL.h + 4;
    ctx.fillStyle = '#111111';
    if (campo.tipo === 'firma') {
      dibujarRubrica(ctx, zx, zy);
    } else if (campo.tipo === 'checkbox') {
      ctx.strokeStyle = '#222222';
      ctx.lineWidth = 2;
      ctx.strokeRect(zx, zy - 12, 18, 18);
      ctx.beginPath();
      ctx.moveTo(zx + 3, zy - 4);
      ctx.lineTo(zx + 8, zy + 2);
      ctx.lineTo(zx + 16, zy - 10);
      ctx.stroke();
    } else {
      const valor = valorDeEjemplo(campo);
      fuenteQueQuepa(ctx, valor, z.w * PAPEL.w - 4, 17);
      ctx.fillText(valor, zx, zy);
    }
    return;
  }

  // Zona fija: etiqueta + valor directo sobre la zona absoluta.
  const z = campo.zona;
  const x = PAPEL.x + z.x * PAPEL.w;
  const y = PAPEL.y + (z.y + z.h / 2) * PAPEL.h;
  ctx.fillStyle = '#111111';
  ctx.font = 'bold 14px Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(campo.etiqueta.toUpperCase(), x, y);
  ctx.font = '15px Arial, sans-serif';
  ctx.fillStyle = '#222222';
  ctx.fillText(valorDeEjemplo(campo), x + 8, y + 18);
}

function dibujarRubrica(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.strokeStyle = '#111111';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.bezierCurveTo(x + 20, y - 26, x + 48, y + 18, x + 84, y - 10);
  ctx.bezierCurveTo(x + 100, y - 22, x + 120, y + 6, x + 140, y - 4);
  ctx.stroke();
}

/**
 * Genera una página simulada del molde (JPEG dataUrl). Sin molde (antes de
 * la identificación) dibuja un encabezado genérico «RECIBO DE PAGO» para
 * poder demostrar el reconocimiento automático.
 */
export function dibujarPaginaSimulada(molde: MoldeUniversal | null, pagina: number): string {
  const c = document.createElement('canvas');
  c.width = ANCHO;
  c.height = ALTO;
  const ctx = c.getContext('2d')!;

  // SCAN LIMPIO: papel blanco a pantalla completa (sin fondo de mesa ni
  // marco) → bordesBlancos() toma el camino 'identidad' y las posiciones
  // declaradas se cumplen tal cual.
  ctx.fillStyle = '#fbfbf8';
  ctx.fillRect(0, 0, ANCHO, ALTO);

  // El grano va PRIMERO (queda como fondo del papel): el gate de calidad
  // mide la textura de TODA la página, y el texto dibujado ENCIMA queda
  // nítido para el OCR (lección de la prueba E2E: grano sobre el texto
  // degradaba la lectura de los valores).
  aplicarGrano(ctx);

  const totalPaginas = molde
    ? molde.campos.reduce((max, campo) => Math.max(max, campo.pagina), 1)
    : 1;

  // Identidad de página impresa (el motor la exige por posición).
  ctx.fillStyle = '#111111';
  ctx.font = 'bold 16px Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`Página ${pagina} de ${totalPaginas}`, PAPEL.x + 28, PAPEL.y + 60);

  if (!molde) {
    // Sin molde (antes de la identificación) se dibuja un encabezado de
    // ejemplo en la POSICIÓN TÍPICA de un título (rect ~0.41..0.59 ×
    // 0.06..0.08, como el del recibo): así el crop del motor lo lee entero
    // cuando la plantilla se reconozca. La captura completa del molde se
    // hace con «REPETIR SIM» ya con el molde conocido.
    const titulo = 'RECIBO DE PAGO';
    const tx = PAPEL.x + 0.4056 * PAPEL.w;
    const ty = PAPEL.y + (0.063 + 0.0182 / 2) * PAPEL.h;
    fuenteQueQuepa(ctx, titulo, 0.189 * PAPEL.w, 24);
    ctx.fillStyle = '#111111';
    ctx.textAlign = 'left';
    ctx.fillText(titulo, tx, ty);
  } else {
    // Los campos de la página se dibujan en SUS posiciones declaradas: son
    // la única fuente de verdad (sin títulos extra que tapen las anclas).
    ctx.textAlign = 'left';
    for (const campo of molde.campos) {
      dibujarCampo(ctx, campo, pagina);
    }
  }

  // Banda oscura de pie (franja tipo sello/pie de documento): el contraste
  // global del gate es la DESVIACIÓN de gris de toda la página y el texto
  // solo cubre ~0.3% del área — sin una zona oscura grande el scan mide
  // contraste ~12 y el gate lo rechazaría. Zona segura: bajo las firmas.
  ctx.fillStyle = '#3a3a3a';
  ctx.fillRect(30, ALTO - 105, ANCHO - 60, 44);

  return c.toDataURL('image/jpeg', 0.9);
}

/**
 * Grano de sensor/tóner SOLO en el interior (±40 por canal): una página
 * perfectamente plana mide nitidez casi 0 en el gate (varianza del
 * Laplaciano sin textura). El anillo del borde queda LIMPIO para que
 * bordesBlancos() reconozca el scan.
 */
function aplicarGrano(ctx: CanvasRenderingContext2D): void {
  const INSET = 30;
  const w = ANCHO - INSET * 2;
  const h = ALTO - INSET * 2;
  if (w <= 0 || h <= 0) return;
  const data = ctx.getImageData(INSET, INSET, w, h);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const n = (Math.random() - 0.5) * 104;
    px[i] = Math.min(255, Math.max(0, px[i] + n));
    px[i + 1] = Math.min(255, Math.max(0, px[i + 1] + n));
    px[i + 2] = Math.min(255, Math.max(0, px[i + 2] + n));
  }
  ctx.putImageData(data, INSET, INSET);
}
