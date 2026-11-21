// Exportación de archivos: descarga de blobs.

export function downloadBlob(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();
  // El blob ya está en el disco del navegador: liberar el object URL tras el click.
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
