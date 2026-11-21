// OCR núcleo (D8 opción B): validez del texto reconocido. `ocrTextIsValid`
// NO es señal de contenido (la bolsa de papas lo pasa con texto del empaque):
// solo verifica que haya texto suficiente para intentar clasificar.

export function ocrTextIsValid(texto: string | null | undefined): boolean {
  if (!texto) return false;
  // Al menos 8 caracteres alfanuméricos: evita ruido de 1-2 letras.
  const alfanum = texto.replace(/[^A-Za-z0-9ÁÉÍÓÚÑÜáéíóúñü]/g, '');
  return alfanum.length >= 8;
}
