import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { esMoldeUniversal, erroresMolde, type MoldeUniversal } from '../packages/scanner-core/molde/universal-types';

const dir = process.argv[2] ?? 'moldes-finales';
let fallos = 0;
for (const f of readdirSync(dir).filter((n) => n.endsWith('.molde.json')).sort()) {
  const obj: unknown = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const errores = erroresMolde(obj);
  const valido = esMoldeUniversal(obj);
  const m = obj as MoldeUniversal;
  const pags = new Set(m.campos.map((c) => c.pagina));
  const info = {
    archivo: f,
    esMoldeUniversal: valido,
    erroresMolde: errores,
    nombre: m.nombre,
    documento: m.documento,
    version: m.version,
    campos: m.campos.length,
    obligatorios: m.campos.filter((c) => c.obligatorio).length,
    paginas: Math.max(...m.campos.map((c) => c.pagina)),
    paginasDistintas: [...pags],
    htr: m.campos.filter((c) => c.htr).length,
    sinPaginasRef: !('paginasRef' in m),
    sinLayout: !('layout' in m),
  };
  console.log(JSON.stringify(info));
  if (!valido || errores.length > 0) fallos++;
}
if (fallos > 0) process.exit(1);
console.log('OK: todos los moldes pasan el contrato TypeScript');
