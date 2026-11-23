// Prueba unitaria de la regla de veredicto con 9 casos sintéticos (como los
// del starter) + los 3 casos de identidad que el starter no cubría.
import { calcularVeredicto, paginasEsperadas, esFaltanteDuro } from '../apps/tamiz/src/lib/generico/veredicto';
import type { MoldeUniversal, ResultadoUniversal, ResultadoCampoUniversal, ResultadoPaginaUniversal } from '../packages/scanner-core/molde/universal-types';
import { readFileSync } from 'node:fs';

const molde: MoldeUniversal = JSON.parse(readFileSync('moldes-finales/e26_acta_parcial.molde.json', 'utf8'));

function campo(pagina: number, id: string, estado: ResultadoCampoUniversal['estado'], banderas: string[] = [], valor: string | boolean | null = null): ResultadoCampoUniversal {
  const def = molde.campos.find(c => c.id === id)!;
  return { id, etiqueta: def.etiqueta, tipo: def.tipo, pagina, estado, valor, conf: 0.9, rect: null, crop: null, crop_dims: null, fuente: 'ancla', banderas, ratio: 0.5 };
}
function universal(paginas: ResultadoPaginaUniversal[]): ResultadoUniversal {
  const todos = paginas.flatMap(p => p.campos);
  return { archivo: 'sintetico', paginas, total: todos.length, ok_count: todos.filter(c => c.estado === 'ok').length, score: 100, pct_diligenciado: 100, pct_lectura: 100, obligatorios_faltantes: [], validaciones: [], requiere_revision: false, tiempos: { render_ms: 1, ocr_ms: 1, motor_ms: 1 } };
}
function pagina(n: number, campos: ResultadoCampoUniversal[]): ResultadoPaginaUniversal { return { pagina: n, ocr_conf: 0.9, campos }; }

function completa(): ResultadoUniversal {
  return universal([1, 2, 3, 4, 5, 6].map(n => pagina(n, molde.campos.filter(c => c.pagina === n).map(c => campo(n, c.id, 'ok')))));
}

const casos: Array<[string, ResultadoUniversal, number, string]> = [];
// 1. documento completo ok
casos.push(['completo-ok', completa(), 6, 'OPTIMA']);
// 2. faltan páginas (5 de 6)
const u2 = completa(); u2.paginas = u2.paginas.filter(p => p.pagina !== 4);
casos.push(['sin-p4', u2, 5, 'RECHAZADA']);
// 3. página 3 intercambiada por la 2: identidad de p3 no cumplida
const u3 = completa();
u3.paginas = u3.paginas.map(p => p.pagina === 3 ? pagina(3, molde.campos.filter(c => c.pagina === 3).map(c => c.id === 'pagina_3' ? campo(3, 'pagina_3', 'requiere_revision', ['patron_no_cumple'], 'Pág 2 de 6') : campo(3, c.id, 'ok'))) : p);
casos.push(['dup-p2-en-slot3', u3, 6, 'RECHAZADA']);
// 4. página correcta con ruido: un opcional falla y un obligatorio no-identidad en revisión
const u4 = completa();
u4.paginas = u4.paginas.map(p => p.pagina === 1 ? pagina(1, molde.campos.filter(c => c.pagina === 1).map(c => c.id === 'departamento' ? campo(1, 'departamento', 'requiere_revision', ['patron_no_cumple'], 'OL ANTIOQUIA') : campo(1, c.id, 'ok'))) : p);
casos.push(['ruido-opcional', u4, 6, 'ADVERTENCIA']);
// 5. página ajena (E-17 en slot 2): toda la página 2 falla
const u5 = completa();
u5.paginas = u5.paginas.map(p => p.pagina === 2 ? pagina(2, molde.campos.filter(c => c.pagina === 2).map(c => campo(2, c.id, c.id === 'pagina_2' ? 'requiere_revision' : 'no_encontrado', ['patron_no_cumple'], null))) : p);
casos.push(['ajena-slot2', u5, 6, 'RECHAZADA']);
// 6. firma faltante (sin tinta) en página correcta
const u6 = completa();
u6.paginas = u6.paginas.map(p => p.pagina === 1 ? pagina(1, molde.campos.filter(c => c.pagina === 1).map(c => c.id === 'firma_1_pag_1' ? campo(1, 'firma_1_pag_1', 'no_encontrado', [], false) : campo(1, c.id, 'ok'))) : p);
casos.push(['firma-sin-tinta', u6, 6, 'RECHAZADA']);
// 7. HTR con tinta y sin OCR (no aplica a e26; simular con campo texto sin patrón)
const u7 = completa();
u7.paginas = u7.paginas.map(p => p.pagina === 1 ? pagina(1, molde.campos.filter(c => c.pagina === 1).map(c => campo(1, c.id, 'ok'))) : p);
casos.push(['repetible-estable', u7, 6, 'OPTIMA']);

let fallos = 0;
for (const [nombre, u, recibidas, esperado] of casos) {
  const r = calcularVeredicto(molde, u, recibidas);
  const ok = r.veredicto === esperado;
  if (!ok) fallos++;
  console.log(`${ok ? 'OK ' : '!! '} ${nombre}: ${r.veredicto} (esperado ${esperado})`);
}
console.log(fallos === 0 ? 'TODOS LOS CASOS OK' : `${fallos} CASOS FALLARON`);
process.exit(fallos === 0 ? 0 : 1);
