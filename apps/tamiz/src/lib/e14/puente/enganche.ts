// Enganche del puente: inicialización (hoy sin hub backend — ver envio.ts).

export function iniciarPuenteSupervision(): void {
  // Re-exporta la supervisión real (escucha 'online') del módulo de envío.
  void import('./envio').then((m) => m.iniciarPuenteSupervision());
}
