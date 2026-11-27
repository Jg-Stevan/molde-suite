# PLAN-BASES-DE-DATOS.md — Capa de datos de molde-suite + ruta de aprendizaje SQL/NoSQL

> Objetivo doble: (1) dar a molde-suite una capa de datos seria, consultable y
> versionada, y (2) convertir el dominio del proyecto en el laboratorio donde
> aprender bases de datos **relacionales (SQL)** y **no relacionales (NoSQL)**
> con datos reales del proyecto — no con tablas de ejemplo de tutorial.
>
> La idea central: **el mismo dominio (moldes, campos, corridas, resultados,
> lecciones) se modela dos veces** — una vez normalizado en SQL y otra como
> documentos en NoSQL — y la comparación ES la lección.

Fecha: 2026-11-27 · Estado: PROPUESTO (revisión pendiente)

---

## 0. Resumen ejecutivo

| # | Fase | Qué se construye | Qué se aprende | Esfuerzo |
|---|------|------------------|----------------|----------|
| 0 | Diagnóstico | Auditoría del esquema actual + herramientas de BD | Leer un esquema, CLI sqlite3 / DB Browser | 1 sesión |
| 1 | Esquema relacional v2 | Normalizar `Molde`/`Prueba` → 9 tablas (versiones, campos, anclas, corridas, resultados) | Modelo ER, normalización 1NF-3NF, FK, migraciones | 2-3 sesiones |
| 2 | Consultas + API | API `/api/estadisticas` con SQL real | SELECT, JOIN, GROUP BY, subconsultas | 2 sesiones |
| 3 | SQL avanzado | Vistas, índices, EXPLAIN, transacciones, window functions | CTE, ROW_NUMBER, LAG, plan de ejecución | 2 sesiones |
| 4 | NoSQL documental | MongoDB: moldes JSON versionados + lecciones | Documentos, embedding vs referencia, `$lookup`, aggregation pipeline | 2-3 sesiones |
| 5 | NoSQL clave-valor | Redis: cache del molde activo de Tamiz | TTL, invalidación, patrones de cache | 1-2 sesiones |
| 6 | Persistencia políglota | Arquitectura final + búsqueda vectorial de lecciones (opcional) | Cuándo usar cada motor, embeddings | 2 sesiones |

Total: ~12-15 sesiones de trabajo. Cada fase entrega código en el repo y un
set de ejercicios **con las respuestas documentadas en `lessons/`** — así el
aprendizaje queda en el propio sistema de fichas del proyecto, como el resto
del conocimiento de molde-suite.

---

## 1. Estado actual (diagnóstico)

El esquema actual de `apps/molde-studio/prisma/schema.prisma` tiene 2 modelos:

```prisma
model Molde {
  id          String   @id @default(cuid())
  nombre      String
  json        String   // ← el molde COMPLETO como texto plano
  pruebas     Prueba[]
}

model Prueba {
  id               String  @id @default(cuid())
  moldeId          String
  fuenteUrls       String? // ← JSON array serializado en un string
  resultados       String  // ← los resultados COMPLETOS como texto plano
  score            Float?
  requiereRevision Boolean
}
```

### Problemas concretos (son las lecciones de Fase 1)

1. **`Molde.json` como string opaco** — el molde entero (páginas, zonas,
   campos, anclas, desambiguadores, grupos, herencia, fixtures) vive en una
   sola columna TEXT. No se puede: consultar qué campos tiene un molde,
   indexar por tipo de campo, ni responder «¿qué campo falla más?» sin
   `JSON.parse()` en JavaScript. **Violación de 1NF en espíritu** (atributos
   multivaluados escondidos en un string).
2. **`Prueba.fuenteUrls` como JSON array serializado** — violación clásica de
   1NF (grupo repetitivo). Debe ser una tabla `Pagina` con `UNIQUE(documentoId, orden)`.
3. **`Prueba.resultados` como string** — los resultados campo-por-campo
   (estado, valor, conf, banderas) son la materia prima de la analítica del
   motor y hoy son inaccesibles para SQL.
4. **Sin versionado de moldes** — la detección de «corrida desactualizada»
   compara `Prueba.updatedAt` contra `Molde.updatedAt`, pero no hay historia
   de qué cambió entre versiones del molde.
5. **Sin trazabilidad de documentos fuente** — no existe la entidad
   «documento» (foto/PDF con sus páginas); solo URLs sueltas por corrida.
6. **Sin normalización de estados** — `estado` (ÓPTIMA/ADVERTENCIA/RECHAZADA)
   y `estado` de campo (ok/no_encontrado/requiere_revision) son strings libres.

---

## 2. Por qué molde-suite es un laboratorio de BD casi perfecto

- **El molde JSON es un documento anidado real** → el caso de uso canónico de
  una BD **documental** (MongoDB). Misma pregunta, dos motores, comparación honesta.
- **Las corridas y resultados son transaccionales y analíticos** → el caso de
  uso canónico de una BD **relacional** (JOIN, GROUP BY, window functions).
- **Tamiz necesita el molde activo en milisegundos en cada scan** → el caso de
  uso canónico de un **cache clave-valor** (Redis, TTL, invalidación).
- **Las fotos y PDFs nunca deben ir en filas de la BD** → la lección del
  anti-patrón del blob y el patrón «URL en la BD, binario en el FS».
- **`lessons/` es un corpus de texto libre** → el caso de uso emergente de las
  BD **vectoriales** (búsqueda semántica: «¿qué lecciones tratan firmas con
  tachones?»).

---

## 3. Diseño relacional objetivo (esquema v2)

### 3.1 Diagrama de entidades

```
Molde (1) ────< VersionMolde (N)       cada cambio del molde = nueva versión
VersionMolde (1) ────< Campo (N)       campos declarados en esa versión
Campo (1) ─── 1 Ancla                  cómo se localiza el campo en el papel
Molde (1) ────< Corrida (N)            cada prueba / ejecución del motor
DocumentoFuente (1) ────< Pagina (N)   fotos/PDF ordenados por página
DocumentoFuente (1) ────< Corrida (N)  un documento se puede probar N veces
Corrida (1) ────< ResultadoCampo (N)   lo que el motor leyó de cada campo
Campo (1) ────< ResultadoCampo (N)     cruze: historia completa de un campo
FichaLeccion                           independiente (conocimiento de lessons/)
```

### 3.2 Decisión de diseño clave: esquema HÍBRIDO

El JSON del molde **se conserva SIEMPRE como columna** (`VersionMolde.json`).
Razón: es el **contrato del motor** (`packages/scanner-core`), se consume
íntegro y su forma cambia con la evolución del motor (v3.2.0 faro, v3.3.0
votación...). Las columnas normalizadas (`Campo`, `Ancla`, `ResultadoCampo`)
existen **para consultar y analizar**, no para ejecutar el motor.

Patrón de escritura: la API de Studio escribe **ambas cosas en una sola
transacción** — el JSON íntegro (contrato) + las filas normalizadas (analítica).
Patrón de lectura: el editor lee el JSON; las estadísticas leen las tablas.
(Este patrón «dual write + transacción» es en sí una lección de Fase 3.)

### 3.3 Borrador de esquema Prisma v2 (se ajusta en Fase 1)

Nota: Prisma + SQLite no soporta enums ni listas escalares → los estados y
arrays serializados usan `String` con convención documentada (buena lección
de dialectos SQL: PostgreSQL sí tendría `ENUM` y `TEXT[]`).

```prisma
// ─── Definición ─────────────────────────────────────────────────
model Molde {
  id        String   @id @default(cuid())
  nombre    String   @unique
  familia   String?  // "acta-e14" | "recibo" | ... (huella de cabecera)
  activo    Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  versiones VersionMolde[]
  corridas  Corrida[]
}

model VersionMolde {
  id        String   @id @default(cuid())
  moldeId   String
  molde     Molde    @relation(fields: [moldeId], references: [id], onDelete: Cascade)
  version   Int
  json      String   // CONTRATO ÍNTEGRO para el motor — nunca se parsea para consultar
  nota      String?
  createdAt DateTime @default(now())
  campos    Campo[]
  corridas  Corrida[]

  @@unique([moldeId, version])
}

model Campo {
  id          String  @id @default(cuid())
  versionId   String
  version     VersionMolde @relation(fields: [versionId], references: [id], onDelete: Cascade)
  clave       String  // "nombre_fallecido"
  etiqueta    String  // "NOMBRES Y APELLIDOS"
  tipo        String  // texto | firma | checkbox | presencia
  obligatorio Boolean @default(false)
  grupo       String?
  orden       Int?
  umbral      Float?
  patron      String?
  ancla       Ancla?
  resultados  ResultadoCampo[]

  @@unique([versionId, clave])
}

model Ancla {
  id              String @id @default(cuid())
  campoId         String @unique
  campo           Campo  @relation(fields: [campoId], references: [id], onDelete: Cascade)
  tipo            String // relativa | relacional(faro) | voto | referencia
  texto           String?
  faro            String?  // zona_busqueda (v3.2.0)
  desambiguadores String?  // JSON array serializado (SQLite)
  respaldo        String?  // ancla_respaldo
  rectX           Float?
  rectY           Float?
  rectW           Float?
  rectH           Float?
}

// ─── Ejecución ──────────────────────────────────────────────────
model DocumentoFuente {
  id        String   @id @default(cuid())
  nombre    String
  sha256    String?  // dedupe: la misma foto no se guarda dos veces
  paginas   Pagina[]
  corridas  Corrida[]
  createdAt DateTime @default(now())
}

model Pagina {
  id          String          @id @default(cuid())
  documentoId String
  documento   DocumentoFuente @relation(fields: [documentoId], references: [id], onDelete: Cascade)
  orden       Int
  url         String          // /uploads/... — el binario vive en el FS

  @@unique([documentoId, orden])
}

model Corrida {
  id               String           @id @default(cuid())
  moldeId          String
  molde            Molde            @relation(fields: [moldeId], references: [id])
  versionId        String?
  version          VersionMolde?    @relation(fields: [versionId], references: [id])
  documentoId      String?
  documento        DocumentoFuente? @relation(fields: [documentoId], references: [id])
  score            Float?
  estado           String?          // OPTIMA | ADVERTENCIA | RECHAZADA
  requiereRevision Boolean          @default(false)
  duracionMs       Int?
  createdAt        DateTime         @default(now())
  resultados       ResultadoCampo[]
}

model ResultadoCampo {
  id        String  @id @default(cuid())
  corridaId String
  corrida   Corrida @relation(fields: [corridaId], references: [id], onDelete: Cascade)
  campoId   String?
  campo     Campo?  @relation(fields: [campoId], references: [id])
  clave     String
  estado    String  // ok | no_encontrado | requiere_revision
  valor     String?
  conf      Float?
  banderas  String? // JSON array: ancla_colision, firma_ausente, ...

  @@unique([corridaId, clave])
}

// ─── Conocimiento ───────────────────────────────────────────────
model FichaLeccion {
  id        String   @id @default(cuid())
  titulo    String
  cuerpo    String   // markdown completo
  tipoDoc   String?
  etiquetas String?  // JSON array de tags
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### 3.4 Migración de datos existentes (backfill)

Script `scripts/backfill-normaliza.ts`: lee cada fila `Molde` existente,
`JSON.parse` del molde y de sus pruebas históricas, inserta las filas
normalizadas **y conserva el JSON original**. (Parsear los moldes reales del
E-14 en tablas es en sí el mejor ejercicio de modelado: obliga a decidir qué
es entidad, qué es atributo y qué es relación.)

---

## 4. Ruta SQL relacional — las 12 consultas de la colección

El currículo completo cabe en 12 consultas sobre los datos REALES del proyecto.
Cada una introduce un concepto y produce una vista del futuro dashboard.

**Q1 — Filtro y orden (SELECT / WHERE / ORDER BY / LIMIT)**
```sql
-- Los moldes editados más recientemente
SELECT nombre, familia, updated_at
FROM molde
ORDER BY updated_at DESC
LIMIT 10;
```

**Q2 — JOIN 1:N (corrida con su molde)**
```sql
SELECT m.nombre, c.created_at, c.score, c.estado
FROM corrida c
JOIN molde m ON m.id = c.molde_id
ORDER BY c.created_at DESC;
```

**Q3 — LEFT JOIN + IS NULL (moldes olvidados)**
```sql
SELECT m.nombre
FROM molde m
LEFT JOIN corrida c ON c.molde_id = m.id
WHERE c.id IS NULL;
```

**Q4 — GROUP BY + HAVING (calidad por molde — el criterio de MOLDE-SPEC §3)**
```sql
-- Tasa de revisión por molde; alerta si supera el 20%
SELECT m.nombre,
       COUNT(*)                 AS corridas,
       SUM(c.requiere_revision) AS en_revision,
       ROUND(100.0 * SUM(c.requiere_revision) / COUNT(*), 1) AS pct_revision
FROM corrida c
JOIN molde m ON m.id = c.molde_id
GROUP BY m.id
HAVING pct_revision > 20;
```

**Q5 — Agregación del detalle (¿qué campo falla más en la historia?)**
```sql
SELECT rc.clave,
       SUM(rc.estado = 'ok')                AS ok,
       SUM(rc.estado = 'requiere_revision') AS revision,
       SUM(rc.estado = 'no_encontrado')     AS no_encontrado
FROM resultado_campo rc
GROUP BY rc.clave
ORDER BY (no_encontrado + revision) DESC;
```

**Q6 — Subconsulta correlacionada (última corrida por molde)**
```sql
SELECT m.nombre, c.score, c.created_at
FROM corrida c
JOIN molde m ON m.id = c.molde_id
WHERE c.created_at = (
  SELECT MAX(c2.created_at) FROM corrida c2 WHERE c2.molde_id = c.molde_id
);
```

**Q7 — CTE (la misma Q6, legible y reutilizable)**
```sql
WITH ultima AS (
  SELECT molde_id, MAX(created_at) AS fecha
  FROM corrida
  GROUP BY molde_id
)
SELECT m.nombre, c.score, c.estado
FROM ultima u
JOIN corrida c ON c.molde_id = u.molde_id AND c.created_at = u.fecha
JOIN molde m   ON m.id = c.molde_id
ORDER BY c.score ASC;
```

**Q8 — Window functions (regresión de score entre corridas)**
```sql
-- ¿Qué moldes empeoraron respecto a su corrida anterior?
WITH serie AS (
  SELECT molde_id, score,
         LAG(score) OVER (PARTITION BY molde_id ORDER BY created_at) AS score_previo
  FROM corrida
)
SELECT m.nombre, score_previo, score,
       ROUND(score - score_previo, 2) AS delta
FROM serie s
JOIN molde m ON m.id = s.molde_id
WHERE score < score_previo;
```

**Q9 — CASE WHEN (semáforo en SQL)**
```sql
SELECT nombre,
  CASE WHEN pct_revision = 0  THEN 'OPTIMA'
       WHEN pct_revision <= 20 THEN 'ADVERTENCIA'
       ELSE 'RECHAZADA' END AS semaforo
FROM ( /* Q4 sin el HAVING */ );
```

**Q10 — Series temporales (strftime)**
```sql
SELECT strftime('%Y-W%W', created_at) AS semana,
       COUNT(*) AS corridas,
       ROUND(AVG(score), 1) AS score_medio
FROM corrida
GROUP BY semana
ORDER BY semana;
```

**Q11 — Índices y plan de ejecución (medir, no adivinar)**
```sql
CREATE INDEX idx_corrida_molde_fecha ON corrida(molde_id, created_at DESC);

EXPLAIN QUERY PLAN
SELECT * FROM corrida WHERE molde_id = '...' ORDER BY created_at DESC;
-- compara el plan con y sin índice (SCAN vs SEARCH)
```

**Q12 — Transacción + UPSERT (guardar una corrida atómicamente)**
```sql
BEGIN;
INSERT INTO corrida (id, molde_id, score, estado) VALUES (...);
INSERT INTO resultado_campo (corrida_id, clave, estado, valor, conf)
  VALUES (...), (...), (...);
COMMIT;

-- Re-ejecución: UPSERT por (corrida_id, clave)
INSERT INTO resultado_campo (...) VALUES (...)
ON CONFLICT(corrida_id, clave) DO UPDATE SET
  estado = excluded.estado, valor = excluded.valor, conf = excluded.conf;
```

Y el ejercicio paralelo de DDL: **escribir el mismo esquema en SQL puro**
(`CREATE TABLE` con `CHECK`, `UNIQUE`, `REFERENCES ... ON DELETE CASCADE`) y
compararlo con lo que genera `prisma migrate` — se ve en la práctica qué hace
un ORM por ti y qué te esconde.

---

## 5. Ruta NoSQL — mismos problemas, otros motores

### 5.1 Documental — MongoDB (Fase 4)

El molde ES un documento: se lee entero, su esquema varía por familia de
documento y evoluciona con el motor. Colecciones propuestas:
`moldes` (documento completo con historial de versiones embebido),
`lecciones` (las fichas de `lessons/`).

Las mismas preguntas del §4, ahora en MQL — ejemplo con la Q5:

```js
db.corridas.aggregate([
  { $unwind: "$resultados" },
  { $group: {
      _id: "$resultados.clave",
      ok:            { $sum: { $cond: [{ $eq: ["$resultados.estado", "ok"] }, 1, 0] } },
      revision:      { $sum: { $cond: [{ $eq: ["$resultados.estado", "requiere_revision"] }, 1, 0] } },
      no_encontrado: { $sum: { $cond: [{ $eq: ["$resultados.estado", "no_encontrado"] }, 1, 0] } }
  }},
  { $addFields: { fallos: { $add: ["$revision", "$no_encontrado"] } } },
  { $sort: { fallos: -1 } }
])
```

Y el «JOIN» de Mongo para comparar con la Q2:

```js
db.corridas.aggregate([
  { $lookup: { from: "moldes", localField: "moldeId", foreignField: "_id", as: "molde" } },
  { $unwind: "$molde" },
  { $project: { "molde.nombre": 1, score: 1, estado: 1, createdAt: 1 } },
  { $sort: { createdAt: -1 } }
])
```

La conclusión esperada (y documentable en `lessons/`): leer el molde entero es
1 consulta sin JOIN en Mongo (el embedding gana), pero la analítica cruzada
corrida-campo-molde es más natural en SQL. Se usa MongoDB con **el driver
nativo** (`mongodb` de npm), no un ORM — para aprender MQL crudo.

### 5.2 Clave-valor — Redis (Fase 5)

Casos concretos del proyecto:

```text
molde:activo:{familia}       → JSON del molde que Tamiz debe usar (TTL 24 h,
                               invalidado por Studio al guardar una versión)
stats:molde:{id}:score-7d    → promedio cacheado del dashboard (TTL 5 min)
scan:{id}:pipeline           → estado efímero del pipeline de Tamiz en vivo
```

```ts
import { createClient } from "redis";

const redis = createClient();
await redis.connect();

// Tamiz pide el molde activo: primero cache, luego SQL
const key = `molde:activo:${familia}`;
let json = await redis.get(key);
if (!json) {
  json = await leerMoldeActivoDesdeSQL(familia);
  await redis.set(key, json, { EX: 60 * 60 * 24 });
}

// Studio invalida al guardar (mismo flujo de escritura)
await redis.del(key);
```

Lecciones: patrón cache-aside, TTL, invalidación en escritura, y la medida
«segunda corrida no toca SQL» (visible en logs).

### 5.3 Vectorial — búsqueda semántica de lecciones (Fase 6, opcional)

El corpus de `lessons/` indexado por embeddings para preguntar en lenguaje
natural («¿qué lecciones tratan firmas bajo tachones?»). Implementación ligera
sin infra nueva: `sqlite-vec` sobre la misma SQLite; alternativa productiva:
MongoDB Atlas Vector Search.

### 5.4 Matriz de decisión (el resumen del curso entero)

| Necesidad del proyecto | Motor | Por qué |
|---|---|---|
| Corridas, resultados, integridad referencial, analítica | SQLite / PostgreSQL | ACID, JOINs, índices, transacciones |
| Molde JSON completo (contrato del motor), lecciones | MongoDB | documento anidado, esquema flexible, lectura entera en 1 query |
| Molde activo de Tamiz, aggregates calientes, estado de pipeline | Redis | latencia de memoria, TTL nativo |
| Fotos, PDFs, imágenes procesadas | Sistema de archivos (o S3 en producción) | blobs en la BD es anti-patrón |
| Búsqueda semántica del corpus de lecciones | sqlite-vec / Atlas Vector | similitud coseno sobre embeddings |

---

## 6. Arquitectura final: persistencia políglota

```text
                        ┌──────────────────────────────┐
   Molde Studio ────────▶  PostgreSQL/SQLite (relacional) │ ← verdad transaccional:
   (editor)    ────────▶  MongoDB (moldes + lecciones)    │   corridas, resultados,
               ────────▶  Redis (cache + estado efímero)  │   versiones
                        └──────────────────────────────┘
   Tamiz ────▶ Redis (molde activo) ────▶ SQL (fallback) ──▶ FS (uploads)
   scanner-core: sin BD — consume el contrato JSON que le entrega la capa de datos
```

Regla de oro documentada: **el motor (`packages/scanner-core`) jamás conoce la
BD** — solo recibe el JSON del molde. La capa de datos es un detalle de las
apps (decisiones D8 del README aplicadas a datos).

---

## 7. Roadmap con criterios de hecho

### Fase 0 — Diagnóstico (1 sesión)
- [ ] Instalar DB Browser for SQLite (o usar `sqlite3` CLI)
- [ ] Abrir la BD real de Studio y documentar tablas/columnas actuales
- [ ] 5 SELECT crudos sobre `Molde`/`Prueba` (los primeros del §4)
- **Hecho cuando:** sabes explicar en una frase por qué el `json` como string
  no se puede consultar.

### Fase 1 — Esquema relacional v2 (2-3 sesiones)
- [ ] Esquema v2 (§3.3) en `apps/molde-studio/prisma/schema.prisma`
- [ ] Cambiar de `db:push` a `prisma migrate` (evolución seria del esquema)
- [ ] Script de backfill que normaliza los moldes/pruebas existentes
- [ ] Seed con el acta E-14 + fixtures de verdad de terreno
- [ ] Ejercicio DDL en SQL puro comparado con el SQL generado por Prisma
- **Hecho cuando:** Prisma Studio muestra los datos normalizados y ninguna
  consulta del app necesita `JSON.parse` para responder.

### Fase 2 — Consultas + API (2 sesiones)
- [ ] `/api/estadisticas` con los endpoints: campos que más fallan (Q5),
  tasa de revisión por molde (Q4), score por semana (Q10)
- [ ] Vista «Estadísticas» en Molde Studio consumiendo la API
- **Hecho cuando:** el dashboard muestra analítica real alimentada por
  JOIN/GROUP BY.

### Fase 3 — SQL avanzado (2 sesiones)
- [ ] Vistas: `v_ultima_corrida`, `v_moldes_estancados`
- [ ] Índices + `EXPLAIN QUERY PLAN` con medición antes/después
- [ ] Transacción en el guardado de corrida + resultados (Q12)
- [ ] `LAG()` para el detector de regresión de score (Q8)
- **Hecho cuando:** cada query del dashboard tiene versión CTE/window-function
  documentada en `lessons/`.

### Fase 4 — MongoDB (2-3 sesiones)
- [ ] Mongo local (Docker) o Atlas free tier
- [ ] Colecciones `moldes` + `lecciones` con datos reales migrados
- [ ] Las 6 preguntas del dashboard reescritas como aggregation pipelines
- [ ] Documento comparativo SQL vs MQL en `lessons/`
- **Hecho cuando:** la comparativa honesta (qué motor gana en qué pregunta)
  está medida y documentada.

### Fase 5 — Redis (1-2 sesiones)
- [ ] Cache del molde activo con TTL + invalidación al guardar
- [ ] (Opcional) estado efímero del pipeline de Tamiz
- **Hecho cuando:** en los logs se ve que la 2ª corrida consecutiva no toca SQL.

### Fase 6 — Políglota + vectorial (2 sesiones)
- [ ] ADR (Architecture Decision Record) de la arquitectura final
- [ ] `ARCHITECTURE.md` actualizado con la sección «Capa de datos»
- [ ] (Opcional) búsqueda semántica de `lessons/` con `sqlite-vec`
- **Hecho cuando:** la matriz de decisión del §5.4 tiene medidas propias.

---

## 8. Herramientas y recursos

| Recurso | Para qué | Cuándo |
|---|---|---|
| [SQLBolt](https://sqlbolt.com) | Lecciones interactivas de SQL desde cero | Fases 0-2 |
| [DB Browser for SQLite](https://sqlitebrowser.org) | Ver la BD del proyecto sin terminal | Fase 0 en adelante |
| `sqlite3` CLI + `EXPLAIN QUERY PLAN` | Medir planes de ejecución | Fase 3 |
| [Use The Index, Luke](https://use-the-index-luke.com) | Índices y rendimiento a fondo | Fase 3 |
| [pgexercises](https://pgexercises.com) | Práctica intensiva de SQL (PostgreSQL) | Cuando se pase a Postgres |
| [MongoDB University](https://learn.mongodb.com) | Cursos gratuitos oficiales | Fase 4 |
| [Try Redis](https://try.redis.io) | Playground de Redis sin instalar | Fase 5 |
| `prisma migrate` + `prisma studio` | Migraciones y exploración visual | Fase 1 en adelante |

PostgreSQL (opcional, fase SQL-Pro): cuando SQLite se quede corto, montar
Postgres en Docker abre tipos avanzados (`JSONB`, `TEXT[]`, `ENUM`), full-text
search y CTE materializadas — y es la lección final de dialectos SQL.

---

## 9. Riesgos y notas de implementación

1. **No romper el contrato del motor**: `VersionMolde.json` se conserva íntegro.
   El `scanner-core` jamás lee tablas normalizadas.
2. **SQLite**: sin enums ni arrays nativos → convenciones `String` + CHECK en
   el DDL de aprendizaje. Documentar cada convención en el propio esquema.
3. **Binarios fuera de la BD**: fotos/PDFs en `uploads/` con URL en la tabla;
   `sha256` para dedupe.
4. **Migraciones, no `db:push`**: a partir de Fase 1 el esquema evoluciona con
   `prisma migrate` (historial versionado, sin pérdida de datos).
5. **Escritura dual**: JSON + tablas normalizadas en UNA transacción; si el
   backfill detecta un molde que no parsea, se reporta y no se inventa estructura.
6. **Tamiz por ahora**: mantiene su historial local; la Fase 2 le da API para
   persistir corridas en la misma BD (opcional, no bloquea nada).
