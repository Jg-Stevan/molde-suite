import { erroresMolde } from '@jg-stevan/scanner-core/molde/universal-types';
import type { MoldeUniversal } from '@jg-stevan/scanner-core/molde/universal-types';
import comprobanteEntrega from './moldes/comprobante_entrega.molde.json';
import reciboPago from './moldes/recibo_pago.molde.json';
import e22Resolucion from './moldes/e22_resolucion.molde.json';
import e24Cuadro from './moldes/e24_cuadro.molde.json';
import e26ActaParcial from './moldes/e26_acta_parcial.molde.json';

/**
 * Catálogo empaquetado: los moldes viajan en el build, así el celular no
 * necesita importar JSON ni tener red. Un molde inválido se reporta (para el
 * manifiesto/consola) y se excluye del selector en lugar de romper la app.
 */
const CANDIDATOS: unknown[] = [
  comprobanteEntrega,
  reciboPago,
  e22Resolucion,
  e24Cuadro,
  e26ActaParcial,
];

export const PROBLEMAS_MOLDES: string[] = [];

export const MOLDES_INCLUIDOS: MoldeUniversal[] = CANDIDATOS.flatMap(
  (candidato, i) => {
    const errores = erroresMolde(candidato);
    if (errores.length === 0) return [candidato as MoldeUniversal];
    PROBLEMAS_MOLDES.push(`Molde #${i + 1}: ${errores.join('; ')}`);
    return [];
  },
);

export function moldeIncluidoPorNombre(nombre: string): MoldeUniversal | undefined {
  return MOLDES_INCLUIDOS.find((m) => m.nombre === nombre);
}
