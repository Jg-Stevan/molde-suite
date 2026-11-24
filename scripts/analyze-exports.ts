/**
 * scripts/analyze-exports.ts — Inventario AST determinista de exports (solo lectura).
 *
 * Uso:
 *   bun run scripts/analyze-exports.ts                      # raíces por defecto
 *   bun run scripts/analyze-exports.ts <ruta> [ruta...]     # raíces custom
 *   bun run scripts/analyze-exports.ts > docs/INVENTARIO-EXPORTS.md
 *
 * Usa el compilador de TypeScript (ts.createProgram) ya instalado en el
 * monorepo. Sin dependencias nuevas. Salida ordenada alfabéticamente por
 * archivo y símbolo: dos ejecuciones sin cambios de código producen diff vacío.
 */

import ts from 'typescript';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const RAICES_DEFAULT = ['packages/scanner-core', 'apps/tamiz/src/lib/e14'];
const DIRS_EXCLUIDOS = new Set(['node_modules', '__fixtures__', 'tests', '.next']);

function listarArchivosTs(dir: string): string[] {
  const out: string[] = [];
  const recorrer = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (!DIRS_EXCLUIDOS.has(e.name)) recorrer(p);
      } else if (/\.tsx?$/.test(e.name)) {
        out.push(p);
      }
    }
  };
  recorrer(dir);
  return out.sort();
}

const raices = process.argv.slice(2).length ? process.argv.slice(2) : RAICES_DEFAULT;
const rootNames = raices.flatMap((r) =>
  existsSync(r) && statSync(r).isDirectory() ? listarArchivosTs(r) : [r],
);

if (rootNames.length === 0) {
  console.error('[analyze-exports] No se encontraron archivos .ts/.tsx en las raíces indicadas.');
  process.exit(1);
}

const program = ts.createProgram({
  rootNames,
  options: {
    allowJs: false,
    esModuleInterop: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    resolveJsonModule: true,
    lib: ['ES2020', 'DOM', 'DOM.Iterable'],
  },
});

const checker = program.getTypeChecker();

type Fila = { nombre: string; clase: string; linea: number; firma: string };
const porArchivo = new Map<string, Fila[]>();

for (const sf of program.getSourceFiles()) {
  const rel = relative(process.cwd(), sf.fileName);
  if (sf.isDeclarationFile) continue;
  if (!rootNames.some((n) => rel.startsWith(n))) continue;

  const filas: Fila[] = [];
  const simboloModulo = checker.getSymbolAtLocation(sf);
  if (!simboloModulo) continue;

  for (const exp of checker.getExportsOfModule(simboloModulo)) {
    const decl = exp.declarations?.[0];
    if (!decl) continue;
    const linea = sf.getLineAndCharacterOfPosition(decl.getStart(sf)).line + 1;
    const clase = ts.SyntaxKind[decl.kind].replace(/Declaration$/, '').toLowerCase();
    let firma = '';
    try {
      const tipo = checker.getTypeOfSymbolAtLocation(exp, decl);
      firma = checker
        .typeToString(tipo, undefined, ts.TypeFormatFlags.NoTruncation)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200);
    } catch {
      firma = '';
    }
    filas.push({ nombre: exp.name, clase, linea, firma });
  }

  filas.sort((a, b) => a.nombre.localeCompare(b.nombre));
  if (filas.length) porArchivo.set(rel, filas);
}

let md =
  '# Inventario de exports (generado por scripts/analyze-exports.ts)\n\n' +
  '> Determinista: orden alfabético por archivo y símbolo; sin timestamps ni ' +
  'rutas absolutas. Dos ejecuciones seguidas sin cambios de código producen diff vacío.\n\n';

for (const archivo of [...porArchivo.keys()].sort()) {
  const filas = porArchivo.get(archivo)!;
  md += `## ${archivo}\n\n| Símbolo | Clase | Línea | Firma |\n|---|---|---|---|\n`;
  for (const f of filas) {
    md += `| \`${f.nombre}\` | ${f.clase} | ${f.linea} | \`${f.firma.replace(/\|/g, '\\|')}\` |\n`;
  }
  md += '\n';
}

const total = [...porArchivo.values()].reduce((acc, f) => acc + f.length, 0);
md += `---\n\nTotal: ${total} símbolos en ${porArchivo.size} archivos.\n`;
process.stdout.write(md);
