// FASE 0 (blueprint DLA): shim de compatibilidad — el código real vive en
// packages/scanner-core/molde/tabla-detect (unificado con Tamiz). Incluye la
// FASE A1: detectarTablaCompleta (vía imagen con port SPARTAN + caída a la
// vía OCR original). Las rutas `@/lib/molde/tabla-detect` del Studio siguen
// funcionando sin cambios.
export * from '@jg-stevan/scanner-core/molde/tabla-detect';
