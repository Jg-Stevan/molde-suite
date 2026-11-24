'use client';

// FASE 0 (blueprint DLA): shim de compatibilidad del motor universal v3.
// El motor vive en packages/scanner-core/molde/universal-engine y es
// COMPARTIDO con Tamiz; su OCR llega por PROVEEDOR INYECTABLE
// (configurarProveedorOcr), así que este módulo:
//   1. Registra el proveedor OCR del Studio (worker auto-hospedado, probe
//      SIMD — el mismo que siempre usó el motor).
//   2. Re-exporta TODO el motor (evaluarDocumentoUniversal, buscarAncla,
//      alinearAnclas, sugerirUmbral, sugerirUmbralClustering, …) para que
//      las rutas `@/lib/molde/universal-engine` sigan funcionando sin cambios.
import { ocrLines, ocrTextoUnico } from '@/lib/ocr/ocr-client';
import { configurarProveedorOcr } from '@molde-suite/scanner-core/molde/ocr-tipos';

configurarProveedorOcr({ ocrLines, ocrTextoUnico });

export * from '@molde-suite/scanner-core/molde/universal-engine';
