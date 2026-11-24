/**
 * scripts/agent-map.ts — Mapa de repositorio determinista para agentes (Fase 4).
 *
 * Uso: bun run agent:map   (o: bun run scripts/agent-map.ts)
 * Genera .agent/repo-map.md con:
 *   1. Grafo de dependencias entre workspaces (desde los package.json).
 *   2. Índice de símbolos exportados de cada paquete (archivo:línea + firma,
 *      sin cuerpos de función) vía ts.createProgram.
 *
 * Determinismo estricto: salida ordenada alfabéticamente, rutas relativas al
 * repo, sin timestamps. Dos ejecuciones seguidas sin cambios de código
 * producen diff vacío. Sin dependencias nuevas (usa el `typescript` ya
 * instalado en el monorepo).
 */

import ts from 'typescript';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const RAIZ = process.cwd();
const DIRS_EXCLUIDOS = new Set(['node_modules', '__fixtures__', 'tests', '.next', '.agent']);
const DESTINO = join(RAIZ, '.agent', 'repo-map.md');

// ---------- 1. Grafo de dependencias de workspaces ----------

type Workspace = { nombre: string; ruta: string; deps: string[]; priv: boolean };

function workspaces(): Workspace[] {
  const out: Workspace[] = [];
  for (const grupo of ['apps', 'packages']) {
    const dir = join(RAIZ, grupo);
    for (const nombre of readdirSync(dir, { withFileTypes: true })) {
      if (!nombre.isDirectory()) continue;
      const ruta = `${grupo}/${nombre.name}`;
      const pkgPath = join(RAIZ, ruta, 'package.json');
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        const todas = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
        const deps = Object.entries(todas)
          .filter(([, v]) => String(v).startsWith('workspace:'))
          .map(([k]) => k)
          .sort();
        out.push({ nombre: String(pkg.name ?? ruta), ruta, deps, priv: Boolean(pkg.private) });
      } catch {
        // package.json ilegible: se omite (no silencia errores de código).
      }
    }
  }
  return out.sort((a, b) => a.nombre.localeCompare(b.nombre));
}

// ---------- 2. Índice de símbolos exportados de packages/* ----------

function archivosTs(dir: string): string[] {
  const out: string[] = [];
  const recorrer = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!DIRS_EXCLUIDOS.has(e.name)) recorrer(join(d, e.name));
      } else if (/\.tsx?$/.test(e.name)) {
        out.push(join(d, e.name));
      }
    }
  };
  recorrer(dir);
  return out.sort();
}

type Fila = { nombre: string; clase: string; linea: number; firma: string };

function indiceExports(paquetes: string[]): Map<string, Fila[]> {
  const rootNames = paquetes.flatMap((p) => archivosTs(join(RAIZ, p)));
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
  const porArchivo = new Map<string, Fila[]>();

  for (const sf of program.getSourceFiles()) {
    const rel = relative(RAIZ, sf.fileName);
    if (sf.isDeclarationFile) continue;
    if (!rootNames.some((n) => rel === relative(RAIZ, n) || relative(RAIZ, n).startsWith(rel + '/'))) continue;
    if (!paquetes.some((p) => rel.startsWith(p + '/'))) continue;

    const filas: Fila[] = [];
    const mod = checker.getSymbolAtLocation(sf);
    if (!mod) continue;
    for (const exp of checker.getExportsOfModule(mod)) {
      const decl = exp.declarations?.[0];
      if (!decl) continue;
      const linea = sf.getLineAndCharacterOfPosition(decl.getStart(sf)).line + 1;
      const clase = ts.SyntaxKind[decl.kind].replace(/Declaration$/, '').toLowerCase();
      let firma = '';
      try {
        const tipo = checker.getTypeOfSymbolAtLocation(exp, decl);
        firma = checker.typeToString(tipo, undefined, ts.TypeFormatFlags.NoTruncation).replace(/\s+/g, ' ').trim().slice(0, 160);
      } catch {
        firma = '';
      }
      filas.push({ nombre: exp.name, clase, linea, firma });
    }
    filas.sort((a, b) => a.nombre.localeCompare(b.nombre));
    if (filas.length) porArchivo.set(rel, filas);
  }
  return porArchivo;
}

// ---------- Generación ----------

const workspacesOrdenados = workspaces();
const paquetes = workspacesOrdenados.filter((w) => w.ruta.startsWith('packages/')).map((w) => w.ruta);
const porArchivo = indiceExports(paquetes);

let md = '# Mapa de repositorio (generado por scripts/agent-map.ts)\n\n';
md += '> Determinista: orden alfabético, rutas relativas al repo, sin timestamps.\n';
md += '> Dos ejecuciones seguidas sin cambios de código producen diff vacío.\n';
md += '> Regenerar con `bun run agent:map`. Índice limitado a packages/* (la API compartida).\n\n';

md += '## 1. Grafo de dependencias entre workspaces\n\n';
md += '| Workspace | Ruta | Depende de (workspace:*) |\n|---|---|---|\n';
for (const w of workspacesOrdenados) {
  md += `| \`${w.nombre}\` | \`${w.ruta}\` | ${w.deps.map((d) => `\`${d}\``).join(', ') || '—'} |\n`;
}

md += '\n## 2. Índice de símbolos exportados (packages/*)\n\n';
const archivos = [...porArchivo.keys()].sort();
for (const archivo of archivos) {
  const filas = porArchivo.get(archivo)!;
  md += `### ${archivo}\n\n| Símbolo | Clase | Línea | Firma |\n|---|---|---|---|\n`;
  for (const f of filas) {
    md += `| \`${f.nombre}\` | ${f.clase} | ${f.linea} | \`${f.firma.replace(/\|/g, '\\|')}\` |\n`;
  }
  md += '\n';
}
const total = [...porArchivo.values()].reduce((acc, f) => acc + f.length, 0);
md += `---\n\nTotal: ${total} símbolos en ${archivos.length} archivos de ${paquetes.length} paquetes.\n`;

mkdirSync(join(RAIZ, '.agent'), { recursive: true });
writeFileSync(DESTINO, md);
console.log(`[agent-map] Escrito ${relative(RAIZ, DESTINO)} (${total} símbolos, ${archivos.length} archivos).`);
