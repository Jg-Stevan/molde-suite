// Catálogo de imágenes simuladas (KIT e14-simulacion-imagenes-v1): documentos
// sintéticos dibujados en canvas para probar el flujo sin cámara. El generador
// pinta una hoja con cabecera E-14, códigos Divipol impresas y manuscritos
// según el caso, de modo que el pipeline real (detección + OCR + gate) corre
// igual que con una foto.

export type ImagenSimuladaId =
  | 'completa'
  | 'color'
  | 'rotada'
  | 'inclinada'
  | 'sombras'
  | 'recortada'
  | 'optima'
  | 'rechazada'
  | 'no-identificado';

export interface ImagenSimulada {
  id: ImagenSimuladaId;
  titulo: string;
  descripcion: string;
}

/** Catálogo del selector SIMULACIÓN (la primera es el default).
 *  P4 (plan PLAN-AJUSTES-VISUALES, adaptación E-14): el último caso es el
 *  5.º estado del ciclo del zip — un documento SIN PLANTILLA CONOCIDA (no
 *  es un E-14) que produce la tarjeta «DOCUMENTO NO IDENTIFICADO». */
export const IMAGENES_SIMULADAS: ImagenSimulada[] = [
  { id: 'completa', titulo: 'Completa', descripcion: 'Acta legible, bien encuadrada' },
  { id: 'color', titulo: 'Color', descripcion: 'Fondo con color, texto legible' },
  { id: 'rotada', titulo: 'Rotada', descripcion: 'Documento girado en el encuadre' },
  { id: 'inclinada', titulo: 'Inclinada', descripcion: 'Papel inclinado (perspectiva leve)' },
  { id: 'sombras', titulo: 'Sombras', descripcion: 'Sombra dura sobre la mitad inferior' },
  { id: 'recortada', titulo: 'Recortada', descripcion: 'Falta la esquina inferior del papel' },
  { id: 'optima', titulo: 'Óptima', descripcion: 'E-14 nítida — auto-envío (guardado automático)' },
  { id: 'rechazada', titulo: 'Rechazada', descripcion: 'E-14 borrosa — score bajo el umbral (6.5)' },
  { id: 'no-identificado', titulo: 'No identificado', descripcion: 'Documento sin plantilla conocida (no es E-14)' },
];

/** Dibuja el documento sintético del caso y devuelve dataURL JPEG. */
export function dibujarImagenSimulada(id: ImagenSimuladaId): string {
  const W = 850;
  const H = 1100;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  // Fondo según caso.
  ctx.fillStyle = id === 'color' ? '#e8e2d4' : '#f4f4f0';
  ctx.fillRect(0, 0, W, H);
  // Marco del papel (documento interior).
  ctx.save();
  if (id === 'rotada') {
    ctx.translate(W / 2, H / 2);
    ctx.rotate(Math.PI / 12);
    ctx.translate(-W / 2, -H / 2);
  } else if (id === 'inclinada') {
    ctx.transform(1, 0.03, -0.02, 1, 12, 0);
  }
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#1c1c1c';
  ctx.lineWidth = 3;
  const mx = 70;
  const my = 80;
  const dw = W - mx * 2;
  const dh = H - my * 2;
  ctx.beginPath();
  if (id === 'recortada') {
    // Falta la esquina inferior derecha del papel.
    ctx.moveTo(mx, my);
    ctx.lineTo(mx + dw, my);
    ctx.lineTo(mx + dw, my + dh - 160);
    ctx.lineTo(mx + dw - 200, my + dh);
    ctx.lineTo(mx, my + dh);
  } else {
    ctx.rect(mx, my, dw, dh);
  }
  ctx.fill();
  ctx.stroke();
  // Cabecera E-14.
  ctx.fillStyle = '#111';
  ctx.font = 'bold 44px "Times New Roman", serif';
  ctx.fillText('E-14', mx + 40, my + 80);
  ctx.font = '20px Arial, sans-serif';
  ctx.fillText('LEY ESTATUTARIA 996 DE 2005', mx + 40, my + 116);
  ctx.fillText('ARTICULO 32 CONSULADO', mx + 40, my + 142);
  // Divipol impresa.
  ctx.font = '18px monospace';
  ctx.fillText('CONSULADO: 88  NAIROBI', mx + 40, my + 200);
  ctx.fillText('PAIS: 335  KENIA', mx + 40, my + 226);
  ctx.fillText('ZONA: 05   PUESTO: 02', mx + 40, my + 252);
  ctx.fillText('MESA: 001', mx + 40, my + 278);
  ctx.fillText('TRANSMISION', mx + 40, my + 320);
  // Filas de votación (etiquetas impresas + números manuscritos simulados).
  ctx.font = '16px Arial, sans-serif';
  const filas = ['IVAN CEPEDA CASTRO', 'ABELARDO DE LA ESPRIELLA', 'VOTOS EN BLANCO', 'VOTOS NULOS'];
  filas.forEach((f, i) => {
    const y = my + 400 + i * 70;
    ctx.fillText(f, mx + 40, y);
    ctx.font = 'bold 30px cursive';
    ctx.fillText(['4', '4', '1', '0'][i], mx + dw - 140, y + 4);
    ctx.font = '16px Arial, sans-serif';
    ctx.strokeStyle = '#9a9a9a';
    ctx.beginPath();
    ctx.moveTo(mx + 30, y + 18);
    ctx.lineTo(mx + dw - 40, y + 18);
    ctx.stroke();
  });
  ctx.font = 'bold 26px cursive';
  ctx.fillText('9', mx + dw - 140, my + 700);
  ctx.font = '18px Arial, sans-serif';
  ctx.fillText('SUMA TOTAL', mx + 40, my + 700);
  ctx.restore();
  // Sombras duras sobre la mitad inferior.
  if (id === 'sombras') {
    const grad = ctx.createLinearGradient(0, H * 0.45, 0, H);
    grad.addColorStop(0, 'rgba(60,50,30,0)');
    grad.addColorStop(1, 'rgba(60,50,30,0.55)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, H * 0.45, W, H * 0.55);
  }
  if (id === 'no-identificado') return dibujarDocumentoNoIdentificado();
  if (id === 'optima') return dibujarActaOptima();
  if (id === 'rechazada') return dibujarActaRechazada();
  return c.toDataURL('image/jpeg', 0.9);
}

/* E-14 BORROSA (RECHAZADA con checklist): cabecera legible (la clasificación
 * la reconoce) pero el contenido DESFOCADO — nitidez bajo el umbral → el
 * gate real la rechaza con OCR válido (GENERICO): la REVISIÓN muestra el
 * checklist DESPLEGADO con SOLO los campos faltantes (P4). */
function dibujarActaRechazada(): string {
  const W = 850;
  const H = 1100;
  const papel = document.createElement('canvas');
  papel.width = W;
  papel.height = H;
  const p = papel.getContext('2d')!;
  const mx = 70;
  const my = 80;
  const dw = W - mx * 2;
  const dh = H - my * 2;
  p.fillStyle = '#ffffff';
  p.strokeStyle = '#1c1c1c';
  p.lineWidth = 3;
  p.fillRect(mx, my, dw, dh);
  p.strokeRect(mx, my, dw, dh);
  // TODO el contenido con tinta GRIS-MEDIO y desenfoque LIGERO (2.5px):
  // calibración del punto medio — el OCR aún rescata la cabecera (GENERICO)
  // y la nitidez cae bajo el umbral de rechazo (6.5).
  p.filter = 'blur(2px)';
  p.fillStyle = '#6a6b70';
  p.font = 'bold 40px "Times New Roman", serif';
  p.fillText('E-14', mx + 40, my + 66);
  p.font = 'bold 19px Arial, sans-serif';
  p.fillText('LEY ESTATUTARIA 996 DE 2005 · ARTICULO 32', mx + 40, my + 98);
  p.font = 'bold 18px monospace';
  p.fillText('CONSULADO: 88  NAIROBI · PAIS: 335', mx + 40, my + 126);
  p.fillText('ZONA: 05   PUESTO: 02   MESA: 001', mx + 40, my + 152);
  // Cuerpo (firmas, casillas y totales) con el MISMO desenfoque.
  p.font = 'bold 26px Arial, sans-serif';
  const filas = ['IVAN CEPEDA CASTRO', 'ABELARDO DE LA ESPRIELLA', 'VOTOS EN BLANCO', 'VOTOS NULOS'];
  filas.forEach((f, i) => {
    const y = my + 240 + i * 74;
    p.fillText(f, mx + 40, y);
    p.font = 'bold 34px cursive';
    p.fillText(['4', '4', '1', '0'][i], mx + dw - 130, y + 6);
    p.font = 'bold 26px Arial, sans-serif';
  });
  p.font = 'bold 30px Arial, sans-serif';
  p.fillText('SUMA TOTAL', mx + 40, my + 560);
  p.font = 'bold 40px cursive';
  p.fillText('9', mx + dw - 130, my + 566);
  // Firmas borrosas (dos trazos anchos — quedan «tenues» para el checklist).
  p.strokeStyle = '#3a3a3a';
  p.lineWidth = 6;
  p.beginPath();
  p.moveTo(mx + 60, my + 700);
  p.bezierCurveTo(mx + 140, my + 640, mx + 200, my + 740, mx + 280, my + 690);
  p.stroke();
  p.beginPath();
  p.moveTo(mx + dw - 320, my + 700);
  p.bezierCurveTo(mx + dw - 240, my + 650, mx + dw - 180, my + 745, mx + dw - 100, my + 695);
  p.stroke();
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f4f4f0';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(papel, 0, 0);
  return c.toDataURL('image/jpeg', 0.9);
}

/* ------------------------------------------------------------------
 * P4 — 5.º/6.º estados del ciclo del zip (plan PLAN-AJUSTES-VISUALES,
 * adaptación E-14):
 *  · «Óptima»: un E-14 con tinta GRANDE y NÍTIDA — el gate real lo
 *    acepta con score ≥ 8.5 y clasificación AUTO → auto-envío
 *    (ENVIADA): en REVISIÓN se ve el guardado automático y la
 *    VERIFICACIÓN DOCUMENTAL COLAPSADA por defecto (P4).
 *  · «No identificado»: un recibo público (no es un E-14) con tinta
 *    gruesa pero MUY DESFOCADA — tinta suficiente para el realce,
 *    texto ilegible para el OCR (ILEGIBLE) y nitidez bajo el umbral:
 *    RECHAZADA sin clasificación → tarjeta «DOCUMENTO NO
 *    IDENTIFICADO — SIN PLANTILLA CONOCIDA» (P4).
 * ------------------------------------------------------------------ */
function dibujarActaOptima(): string {
  const W = 850;
  const H = 1100;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f4f4f0';
  ctx.fillRect(0, 0, W, H);
  const mx = 70;
  const my = 80;
  const dw = W - mx * 2;
  const dh = H - my * 2;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#1c1c1c';
  ctx.lineWidth = 3;
  ctx.fillRect(mx, my, dw, dh);
  ctx.strokeRect(mx, my, dw, dh);
  // Cabecera E-14 GRANDE y NÍTIDA (nitidez alta → score ≥ 8.5).
  ctx.fillStyle = '#000';
  ctx.font = 'bold 100px "Times New Roman", serif';
  ctx.fillText('E-14', mx + 40, my + 130);
  // Reglas negras nítidas (aristas de alto contraste → nitidez).
  ctx.fillRect(mx + 40, my + 150, dw - 80, 8);
  ctx.font = 'bold 32px Arial, sans-serif';
  ctx.fillText('LEY ESTATUTARIA 996 DE 2005', mx + 40, my + 210);
  ctx.fillText('ARTICULO 32 CONSULADO', mx + 40, my + 252);
  ctx.fillRect(mx + 40, my + 272, dw - 80, 4);
  ctx.font = 'bold 32px monospace';
  ctx.fillText('CONSULADO: 88  NAIROBI', mx + 40, my + 330);
  ctx.fillText('PAIS: 335  KENIA', mx + 40, my + 372);
  ctx.fillText('ZONA: 05   PUESTO: 02', mx + 40, my + 414);
  ctx.fillText('MESA: 001', mx + 40, my + 456);
  ctx.font = 'bold 40px Arial, sans-serif';
  ctx.fillText('TRANSMISION', mx + 40, my + 540);
  ctx.fillRect(mx + 40, my + 560, dw - 80, 5);
  // Filas de votación: etiquetas impresas nítidas + manuscritos legibles.
  ctx.font = 'bold 32px Arial, sans-serif';
  const filas = ['IVAN CEPEDA CASTRO', 'ABELARDO DE LA ESPRIELLA', 'VOTOS EN BLANCO', 'VOTOS NULOS'];
  filas.forEach((f, i) => {
    const y = my + 660 + i * 78;
    ctx.fillStyle = '#000';
    ctx.fillText(f, mx + 40, y);
    ctx.font = 'bold 52px cursive';
    ctx.fillStyle = '#101060';
    ctx.fillText(['4', '4', '1', '0'][i], mx + dw - 160, y + 8);
    ctx.font = 'bold 32px Arial, sans-serif';
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(mx + 30, y + 24);
    ctx.lineTo(mx + dw - 40, y + 24);
    ctx.stroke();
  });
  ctx.font = 'bold 64px cursive';
  ctx.fillStyle = '#101060';
  ctx.fillText('9', mx + dw - 160, my + 1010);
  ctx.font = 'bold 34px Arial, sans-serif';
  ctx.fillStyle = '#000';
  ctx.fillText('SUMA TOTAL', mx + 40, my + 1010);
  return c.toDataURL('image/jpeg', 0.95);
}

/* ------------------------------------------------------------------
 * P4 — DOCUMENTO NO IDENTIFICADO (5.º estado del ciclo, plan v2):
 * un documento REAL pero sin plantilla conocida (recibo público —
 * no es un E-14) con CALIDAD INSUFICIENTE (texto desenfocado + tinta
 * débil): el gate real lo rechaza sin clasificación y la REVISIÓN
 * muestra la tarjeta «DOCUMENTO NO IDENTIFICADO — SIN PLANTILLA
 * CONOCIDA». El desenfoque es deliberado: el score de calidad
 * (nitidez 0.55 · contraste 0.25 · brillo 0.2) debe caer bajo el
 * umbral de rechazo (6.5) para producir el estado completo.
 * ------------------------------------------------------------------ */
function dibujarDocumentoNoIdentificado(): string {
  const W = 850;
  const H = 1100;
  const papel = document.createElement('canvas');
  papel.width = W;
  papel.height = H;
  const p = papel.getContext('2d')!;
  // Hoja del recibo — MISMO estilo de fondo/borde que los casos que el
  // detector encuentra (claro + borde oscuro nítido); solo el CONTENIDO
  // sale borroso y débil (calidad insuficiente → rechazo por score).
  const mx = 110;
  const my = 120;
  const dw = W - mx * 2;
  const dh = H - my * 2;
  p.fillStyle = '#fdfdf8';
  p.strokeStyle = '#3a3a3a';
  p.lineWidth = 3;
  p.fillRect(mx, my, dw, dh);
  p.strokeRect(mx, my, dw, dh);
  // Contenido ILEGIBLE: bloques de tinta oscura abstracta (sin letras
  // reales) — tinta suficiente para el realce (bloques gruesos que
  // conservan oscuridad tras el blur) pero ilegible para el OCR
  // (< 8 caracteres alfanuméricos → rechazo ILEGIBLE → P4 «no
  // identificado») y con nitidez bajo el umbral de rechazo (6.5).
  p.filter = 'blur(4px)';
  p.fillStyle = '#1a1b1f';
  // "Cabecera" — bloque grueso tipo título.
  p.fillRect(mx + 40, my + 80, 430, 38);
  p.fillRect(mx + 40, my + 138, 330, 24);
  // "Datos" — barras gruesas de distinta longitud (simulan texto ilegible).
  const barras = [520, 470, 540, 430, 380, 500, 340, 450, 300];
  barras.forEach((largo, i) => {
    p.fillRect(mx + 40, my + 210 + i * 62, largo, 24);
  });
  // "Marca manuscrita" — óvalo grueso a la derecha (firma/timbre borroso).
  p.beginPath();
  p.ellipse(mx + dw - 130, my + 420, 55, 34, -0.5, 0, Math.PI * 2);
  p.fill();
  p.filter = 'none';
  // Composición final: fondo CLARO (igual que los casos detectables) — el
  // papel destaca por su borde oscuro; sin sombras duras (evitan el falso
  // «INCOMPLETA» al filo del recorte).
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f0ede6';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(papel, 0, 0);
  return c.toDataURL('image/jpeg', 0.85);
}
