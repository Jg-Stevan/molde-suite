// SHA-256 de un dataURL (para la identidad de un acta).
//
// Fase 3 (migración scanner-core): implementación absorbida a
// packages/scanner-core/core/hash.ts (Fase 2a); esta ruta se conserva como
// re-export para los consumidores existentes (store/envio, store/navegacion).

import { sha256HexDeDataUrl } from '@molde-suite/scanner-core/core/hash';

export { sha256HexDeDataUrl };

/** Clave de caché del visor de conversión atada a la REVISIÓN de la imagen:
 *  id del acta + SHA-256 de cada foto que alimenta el visor. Una foto nueva
 *  (recorte, giro, filtro, re-proceso full-res) o un lote de páginas distinto
 *  cambia la clave y obliga a regenerar el HTML. Sin crypto.subtle se cae al
 *  tamaño del dataURL — colisión teórica, nunca silenciosa en móvil real. */
export async function claveRevisionVisor(actaId: string, fotos: string[]): Promise<string> {
  const huellas = await Promise.all(fotos.map((f) => sha256HexDeDataUrl(f)));
  return `${actaId}|${huellas.map((h, i) => h ?? `n${fotos[i].length}`).join(',')}`;
}
