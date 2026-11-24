// FASE 0 (blueprint DLA — unificación Studio↔Tamiz): el motor universal v3
// vive en packages/scanner-core y TAMBIÉN lo ejecuta Tamiz (evaluación de
// moldes sobre fotos de cámara). Este archivo queda como SHIM de
// compatibilidad: todas las rutas `@/lib/molde/*` del Studio siguen
// importando desde aquí sin cambios, pero el código real es del paquete.
// Al importar este módulo se REGISTRA el proveedor OCR del Studio (worker
// Tesseract auto-hospedado con probe SIMD) para el motor compartido.
export * from '@molde-suite/scanner-core/molde/universal-types';
