// AUDITORÍA v3.2.0 — retrocompatibilidad real de moldes-finales/*.molde.json
// con el validador esMoldeUniversal v3.2.0 (sin modificar los moldes).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { esMoldeUniversal, erroresMolde, MOLDE_UNIVERSAL_VERSION } from '../src/lib/molde/universal-types';

const dir = join(import.meta.dir, '..', '..', '..', 'moldes-finales');
const archivos = readdirSync(dir).filter((f) => f.endsWith('.molde.json'));
let ok = 0;
let fail = 0;
for (const f of archivos) {
  const raw = readFileSync(join(dir, f), 'utf8');
  let molde: unknown;
  try {
    molde = JSON.parse(raw);
  } catch (e) {
    console.log(`✗ ${f}: JSON parse error ${(e as Error).message}`);
    fail++;
    continue;
  }
  const m = molde as Record<string, unknown>;
  const version = typeof m.version === 'string' ? m.version : String(m.version);
  const campos = Array.isArray(m.campos) ? (m.campos as Array<Record<string, unknown>>) : [];
  const relacional = campos.filter((c) => c.estrategia === 'ancla_relacional').length;
  const conFaro = campos.filter((c) => c.zona_busqueda).length;
  const conGrupo = campos.filter((c) => c.grupo !== undefined).length;
  if (esMoldeUniversal(molde as never)) {
    console.log(`✓ ${f} (version ${version}, campos ${campos.length}, relacional ${relacional}, faro ${conFaro}, grupo ${conGrupo})`);
    ok++;
  } else {
    console.log(`✗ ${f} RECHAZADO por esMoldeUniversal v${MOLDE_UNIVERSAL_VERSION}`);
    console.log(`   errores: ${JSON.stringify(erroresMoldeUniversal(molde as never))}`);
    fail++;
  }
}
console.log(`\nRetrocompat: ${ok} OK / ${fail} FALLO de ${archivos.length} moldes`);
if (fail > 0) process.exit(1);
