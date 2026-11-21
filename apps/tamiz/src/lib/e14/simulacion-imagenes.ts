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
  | 'recortada';

export interface ImagenSimulada {
  id: ImagenSimuladaId;
  titulo: string;
  descripcion: string;
}

/** Catálogo del selector SIMULACIÓN (la primera es el default). */
export const IMAGENES_SIMULADAS: ImagenSimulada[] = [
  { id: 'completa', titulo: 'Completa', descripcion: 'Acta legible, bien encuadrada' },
  { id: 'color', titulo: 'Color', descripcion: 'Fondo con color, texto legible' },
  { id: 'rotada', titulo: 'Rotada', descripcion: 'Documento girado en el encuadre' },
  { id: 'inclinada', titulo: 'Inclinada', descripcion: 'Papel inclinado (perspectiva leve)' },
  { id: 'sombras', titulo: 'Sombras', descripcion: 'Sombra dura sobre la mitad inferior' },
  { id: 'recortada', titulo: 'Recortada', descripcion: 'Falta la esquina inferior del papel' },
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
  return c.toDataURL('image/jpeg', 0.9);
}
