# services/

Servicios **opcionales** (sidecars locales) del monorepo.

- [`sidecar-dla/`](./sidecar-dla/) — sidecar Python (FastAPI, `127.0.0.1:3070`) para la **calibración desktop de moldes en Molde Studio** (Nivel 3 — blueprint DLA): OCR local con RapidOCR, estructura con `chandra-ocr` y borradores MoldeUniversal v3.

**Nunca son dependencia de runtime de las apps cliente** (Molde Studio / Tamiz): las apps deben funcionar completas sin levantar nada de esta carpeta. Ver el README de cada sidecar para detalles de uso y seguridad.
