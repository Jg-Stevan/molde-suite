// Guarda de contrato de la biblioteca descargable: cada .molde.json debe
// pasar erroresMolde (validador de scanner-core) antes de publicarse.
// Uso: bun scripts/entrega/validar-moldes.ts [dir]
import { erroresMolde } from '@molde-suite/scanner-core/contract';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.argv[2] ?? 'apps/tamiz/public/moldes';
let fallos = 0;
for (const f of readdirSync(dir).filter((x) => x.endsWith('.molde.json'))) {
  const j = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const e = erroresMolde(j);
  if (e.length) fallos++;
  console.log(e.length === 0 ? 'OK  ' : 'FALLA', f, e.length ? JSON.stringify(e.slice(0, 4)) : '');
}
process.exit(fallos ? 1 : 0);