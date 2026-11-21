/// <reference types="bun-types" />
// Smoke Fase 8 end-to-end: descarga las corridas SEMBRADAS POR API de un
// servidor Next real y alimenta sugerirUmbralClustering exactamente como lo
// hace EditorTab.sugerirUmbralClick (repo.obtenerPrueba → resultados parseados).
// Ejecutar: bun scripts/smoke-fase8-e2e.ts <BASE_URL> <MOLDE_ID>

import { sugerirUmbralClustering } from '@/lib/molde/universal-engine';
import type { ResultadoUniversal } from '@/lib/molde/universal-types';

const [base, moldeId] = process.argv.slice(2);
if (!base || !moldeId) {
  console.error('uso: bun scripts/smoke-fase8-e2e.ts <BASE_URL> <MOLDE_ID>');
  process.exit(1);
}

const lista = (await fetch(`${base}/api/pruebas?moldeId=${moldeId}`).then((r) => r.json())) as Array<{
  id: string;
  fuente_urls: string[] | null;
}>;

const resultados: ResultadoUniversal[] = [];
for (const p of lista) {
  const r = (await fetch(`${base}/api/pruebas/${p.id}`).then((r) => r.json())) as { resultados: string | object };
  const doc = typeof r.resultados === 'string' ? JSON.parse(r.resultados) : r.resultados;
  resultados.push(doc as ResultadoUniversal);
}

console.log(`Corridas descargadas por API: ${resultados.length}`);
const s = sugerirUmbralClustering(resultados, 'firma_x');
console.log('Resultado del motor:', JSON.stringify(s, null, 2));

// Verificación del caso residual: corte entre distribuciones, flash por debajo.
const fallos: string[] = [];
if (s.metodo !== 'clustering') fallos.push(`metodo esperado clustering, fue ${s.metodo}`);
if (s.corridasConMediciones !== 3) fallos.push(`corridasConMediciones esperado 3, fue ${s.corridasConMediciones}`);
if (s.sugerido === null) fallos.push('sugerido esperado no-null');
else {
  if (Math.abs(s.sugerido - 0.079 * 0.7) > 1e-9) fallos.push(`sugerido esperado 0.0553, fue ${s.sugerido}`);
  if (s.sugerido <= 0.0139) fallos.push('el flash 0.0139 NO quedó por debajo del umbral');
}
if (s.minConTinta === null || Math.abs(s.minConTinta - 0.079) > 1e-6) fallos.push(`minConTinta esperado 0.079, fue ${s.minConTinta}`);
if (s.maxSinTinta === null || Math.abs(s.maxSinTinta - 0.0139) > 1e-6) fallos.push(`maxSinTinta esperado 0.0139, fue ${s.maxSinTinta}`);

if (fallos.length) {
  console.error('FALLOS:', fallos);
  process.exit(1);
}
console.log('SMOKE FASE 8 OK: corte entre distribuciones, flash por debajo del umbral');
