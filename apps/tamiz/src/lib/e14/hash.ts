// SHA-256 de un dataURL (para la identidad de un acta).
//
// Fase 3 (migración scanner-core): implementación absorbida a
// packages/scanner-core/core/hash.ts (Fase 2a); esta ruta se conserva como
// re-export para los consumidores existentes (store/envio, store/navegacion).

export { sha256HexDeDataUrl } from '@molde-suite/scanner-core/core/hash';
