# Plan — Molde Studio: Creador y Editor de Plantillas UNIVERSAL

> **Proyecto:** app web para que un agente de código cree, edite y pruebe moldes `.json`
> de extracción de datos sobre CUALQUIER documento escaneado o fotografiado (no acoplado
> al E-14), y para que el usuario verifique visualmente que las zonas de interés se
> ubican y clasifican correctamente.
> **Fecha:** 2026-11-19 · **Versión del plan:** 1.1 (universal) · **Estado: Fases 1-3 CONSTRUIDAS y verificadas**

---

# PARTE 1 — Versión simplificada (para ti)

## ¿Qué es Molde Studio?

Una app con **4 pestañas**, ya funcionando:

1. **Biblioteca** — tus moldes guardados. Importa un JSON existente (formato universal v3 o el viejo E-14 v2, que se convierte automáticamente), crea desde cero, duplica o elimina.
2. **Editor visual** — el molde se dibuja sobre el escaneo de referencia: cada campo es un rectángulo de color (violeta=texto, verde=presencia, rosa=firma, ámbar=checkbox). Se arrastra, se redimensiona y se edita viendo. Botón **"Alinear anclas (OCR)"**: lee el escaneo con OCR y coloca las anclas en su posición real — WYSIWYG total.
3. **Pruebas** — sueltas fotos reales (celular) o PDFs; cada archivo corre contra el molde y queda en el historial con su score.
4. **Verificación** — el veredicto visual: overlay de zonas sobre la foto, **captura recortada de cada zona** (dónde quedó el manuscrito), estado OK/NO, confianza y score. Botón "Copiar reporte JSON" para el agente.

## ¿Por qué es universal?

El formato v3 no sabe nada del E-14. Un molde = lista de campos con:

- **`zona_fija`**: rectángulo absoluto en coordenadas normalizadas 0-1.
- **`ancla_relativa`**: se busca un texto (ej: "MESA") por OCR con tolerancia a errores y la zona se posiciona relativa a él (con `x_absoluto` opcional para bandas horizontales de columna fija).

Sirve para actas E-14, solicitudes, contratos, formularios — cualquier documento con estructura estable.

## El circuito del agente (verificado hoy en navegador)

```
importar/crear molde → Editor: dibujar zonas + "Alinear anclas (OCR)" → Guardar
   → Pruebas: subir fotos reales → score por corrida
   → Verificación: overlay + capturas por campo + reporte JSON
   → ajustar el molde → repetir
```

**Prueba real ejecutada:** molde E-14 v2 importado → 27 campos convertidos → alineación OCR sobre la foto de Nairobi → corrida con la foto → 18.5% inicial (5/27) con overlay correcto sobre los manuscritos (la zona "Votos candidato 1" cayó exactamente sobre el "4" escrito a mano).

## Lo que falta (Fase 4-5)

| # | Fase | Qué entrega |
|---|------|-------------|
| 4 | Modo agente avanzado | "Proponer molde con IA" (VLM sugiere zonas desde el escaneo) + runner server-side opcional |
| 5 | Pulido | Zoom/pan del lienzo, historial de versiones del molde, comparación entre corridas, reporte exportable |

---

# PARTE 2 — Plan completo (detalle técnico)

## 1. Lo que ya existe (construido y verificado)

| Componente | Ubicación | Estado |
|---|---|---|
| Formato universal v3 (tipos + validación) | `src/lib/molde/universal-types.ts` | Listo |
| Motor universal (anclas fuzzy, tinta sin líneas, crops) | `src/lib/molde/universal-engine.ts` | Listo — corre en cliente |
| Importador E-14 v2 → universal (fidelidad: x_absoluto, paridad jurados, B3 aproximado) | `src/lib/molde/importar-e14.ts` | Listo |
| OCR local (Tesseract.js: página completa + línea única) | `src/lib/ocr/ocr-client.ts` | Ampliado con `ocrTextoUnico` |
| Render PDF/imagen | `src/lib/ocr/pdf-client.ts` | Existente |
| Prisma: Molde + Prueba (SQLite) | `prisma/schema.prisma` | Migrado |
| API: moldes CRUD, pruebas, upload | `src/app/api/{moldes,pruebas,upload}` | Listo |
| UI: Biblioteca / Editor / Pruebas / Verificación | `src/components/studio/*.tsx` + `src/app/page.tsx` | Listo — verificado en navegador |

## 2. Formato del molde universal v3.0.0

```json
{
  "tipo": "universal",
  "version": "3.0.0",
  "nombre": "Acta E-14",
  "documento": "acta_e14",
  "paginasRef": [{ "pagina": 1, "imagen": "/uploads/escaneo.jpg" }],
  "campos": [
    {
      "id": "campo_x1",
      "etiqueta": "Mesa",
      "pagina": 1,
      "tipo": "texto",                    // texto | presencia | firma | checkbox
      "estrategia": "ancla_relativa",     // zona_fija | ancla_relativa
      "ancla": { "texto": "MESA", "rect": { "x": 0.81, "y": 0.13, "w": 0.05, "h": 0.016 } },
      "ancla_respaldo": "PUESTO",
      "zona": { "x": 0.1, "y": 0.0, "w": 0.2, "h": 0.028 },
      "x_absoluto": false,                // true: zona.x es columna absoluta (semántica fila/banda E-14)
      "umbral": 0.03,
      "patron": "\\d{3}",
      "obligatorio": true,
      "nota": "..."
    }
  ]
}
```

Reglas del motor:
- Coordenadas **normalizadas 0-1** (independientes de la resolución de la foto).
- Ancla por **OCR fuzzy** (tolerancia ~35% de distancia de edición, prioriza cercanía a `ancla.rect`), con **respaldo** y **fallback a la referencia guardada** (bandera `ancla_no_encontrada`).
- `presencia/firma/checkbox`: densidad de tinta con binarización adaptativa + eliminación de líneas impresas → `diligenciado` si `ratio >= umbral`.
- `texto`: OCR de la línea del recorte (psm 7) + regex opcional.
- Cada resultado incluye **crop JPEG** de la zona resuelta, confianza, banderas y el rect final (para el overlay).

## 3. Arquitectura

```
Navegador (ruta única /, 4 pestañas)
├─ Motor universal + OCR + pdf.js (cliente, sin cambios de infra)
├─ Editor: overlay de rects resueltos, drag/resize, inspector, JSON vivo
└─ Pruebas: render → OCR → motor → crops → POST resultados
        │ fetch /api/...
Backend Next.js (API Routes)
├─ /api/moldes        GET lista · POST crear (valida estructura)
├─ /api/moldes/:id    GET · PUT (json/nombre/imagenRef) · DELETE (cascada)
├─ /api/pruebas       GET ?moldeId · POST corrida
├─ /api/pruebas/:id   GET reporte completo (para el agente) · DELETE
└─ /api/upload        POST imagen → public/uploads
        │ Prisma
SQLite: Molde(json, imagenRef) · Prueba(archivo, resultados, score, requiereRevision)
```

## 4. Decisiones clave

- **El motor vive en el cliente** (reuso de Tesseract.js + pdf.js + imageproc calibrado). Las corridas se persisten vía API.
- **El formato no depende del E-14**: el importador es un puente de mejor esfuerzo; las estrategias avanzadas del E-14 (B3 diferencial, rejilla 2x2) quedan aproximadas y editables.
- **WYSIWYG**: "Alinear anclas (OCR)" captura `ancla.rect` real sobre el escaneo; los rects dibujados son los que el motor resuelve en producción.
- **E14-específico → universal**: el motor viejo (`engine.ts`, e14.schema.v2) queda intacto en el repo como referencia y motor avanzado futuro.

## 5. Fases

- [x] **Fase 1 — Fundaciones**: Prisma (Molde, Prueba), API CRUD, importador JSON v2/universal, UI en pestañas.
- [x] **Fase 2 — Editor visual**: lienzo con escaneo por página, alineación OCR de anclas, drag/resize, inspector completo, JSON vivo (copiar/descargar/aplicar).
- [x] **Fase 3 — Verificación visual**: overlay por página, capturas por campo con estado/confianza/banderas, score, historial persistido, reporte JSON copiable.
- [ ] **Fase 4 — Modo agente avanzado**: endpoint "proponer molde con IA" (VLM analiza el escaneo y sugiere anclas/zonas iniciales), runner server-side opcional (tesseract.js en Node) para pruebas sin navegador.
- [ ] **Fase 5 — Pulido**: zoom/pan, historial de versiones del molde, comparación entre corridas (regresión), reporte consolidado exportable.

## 6. Criterios de éxito (estado actual)

1. [x] Alinear anclas con OCR y ver los rects resueltos sobre el escaneo al instante.
2. [x] Correr una foto real y ver cada campo con captura + estado + confianza (verificado con foto Nairobi: overlay sobre el manuscrito correcto).
3. [x] Una zona mal ubicada se nota de un vistazo (color por estado).
4. [x] El circuito del agente: editar JSON → probar → leer reporte → ajustar.
5. [x] El `e14.schema.v2.json` se importa sin cambios de formato (conversión automática).

## 7. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| OCR del editor difiere del de producción | Mismo cliente OCR y mismo motor en editor y pruebas |
| Fotos mal recortadas desalinean zonas | Anclas fuzzy + respaldo + fallback a referencia; banderas visibles en Verificación |
| Crops como dataURL inflan la corrida | JPEG q0.72, máx. 420 px; previews de página a 900 px |
| Importador E-14 aproximado en estrategias B3/rejilla | Las zonas quedan editables; nota en cada campo importado |
| Zona inválida (rect fuera de página) | Bandera `zona_invalida` visible en la tarjeta del campo |

## 8. Fuera de alcance (por ahora)

- Lectura del valor manuscrito (HTR/ICR): los campos de texto leen impreso; el manuscrito sigue siendo detección de presencia.
- Moldes multi-documento con lógica condicional entre campos.
- Multi-usuario / autenticación.
