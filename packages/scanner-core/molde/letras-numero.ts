// FASE 6b (plan extracción relacional): conversión número↔letras en español
// y reparación UNÍVOCA de dígitos OCR ambiguos. TS puro, 0 dependencias.
//
// Principio rector: NUNCA inventar. `letrasANumero` devuelve null ante
// cualquier texto que no pueda parsearse completo (tokens numéricos sueltos,
// relleno desconocido, gramática incompleta). `repararNumeroAmbiguo` solo
// repara caracteres que el OCR confunde con dígitos de trazo idéntico
// (O→0, I/l→1, S→5, B→8, Z→2, G→6, T→7, q/Q→9); si queda cualquier otra
// letra, devuelve null. La reparación se usa SIEMPRE validada contra una
// segunda fuente (las letras del importe), nunca en solitario — ver
// `evaluarValidaciones` en el motor.

const SIN_ACENTOS = (s: string): string =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// Palabras que acompañan al número sin alterar el valor (moneda, artículos).
const RELLENO = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'y', 'e',
  'pesos', 'peso', 'euros', 'euro', 'colones', 'colon', 'soles', 'sol',
  'reales', 'real', 'dolar', 'dolares', 'quetzales', 'quetzal', 'cordobas',
  'cordoba', 'balboas', 'balboa', 'guaranies', 'guarani', 'moneda',
  'importe', 'son',
]);

const UNIDADES: Record<string, number> = {
  uno: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7,
  ocho: 8, nueve: 9,
};
const DIEZ_A_QUINCE: Record<string, number> = {
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
};
// Compuestos 16-19, 21-29, 30-90 irregulares y decenas redondas.
const VEINTE_A_NOVENTA: Record<string, number> = {
  veinte: 20, veintiun: 21, veintiuno: 21, veintidos: 22, veintitres: 23,
  veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27,
  veintiocho: 28, veintinueve: 29, treinta: 30, cuarenta: 40, cincuenta: 50,
  sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
};
const CIENTOS: Record<string, number> = {
  cien: 100, ciento: 100, doscientos: 200, doscientas: 200,
  trescientos: 300, trescientas: 300, cuatrocientos: 400, cuatrocientas: 400,
  quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600,
  setecientos: 700, setecientas: 700, ochocientos: 800, ochocientas: 800,
  novecientos: 900, novecientas: 900,
};

/**
 * Convierte un número escrito en letras (español) a valor numérico.
 * Soporta hasta «billones» (<1e12) y decimales introducidos por «con»
 * («dos mil cuatrocientos ochenta con cincuenta» → 2480.50 — los céntimos
 * se interpretan como fracción de 100 si son < 100).
 * Devuelve null si el texto no es un número completo y unívoco.
 */
export function letrasANumero(texto: string): number | null {
  if (typeof texto !== 'string') return null;
  const limpio = SIN_ACENTOS(texto.toLowerCase().replace(/[.,;¡!¿?]/g, ' '));
  const tokens = limpio.split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;

  let total = 0;
  let current = 0;
  let vistosNumero = 0;
  let decimales: number[] | null = null;

  const acumular = (v: number): void => {
    if (decimales) decimales.push(v);
    else current += v;
    vistosNumero++;
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (RELLENO.has(t)) continue;
    if (t === 'con') {
      decimales = [];
      total += current;
      current = 0;
      continue;
    }
    if (t === 'entero') continue;
    if (t === 'mil') {
      const grupo = current === 0 ? 1 : current;
      if (decimales) return null;
      total += grupo * 1000;
      current = 0;
      vistosNumero++;
      continue;
    }
    if (t === 'millon' || t === 'millones') {
      const grupo = current === 0 ? 1 : current;
      if (decimales) return null;
      total += grupo * 1_000_000;
      current = 0;
      vistosNumero++;
      continue;
    }
    if (t === 'billon' || t === 'billones') {
      const grupo = current === 0 ? 1 : current;
      if (decimales) return null;
      total += grupo * 1_000_000_000;
      current = 0;
      vistosNumero++;
      continue;
    }
    // Compuestos «veintiuno»-style ya están en la tabla.
    const u = UNIDADES[t];
    const d = DIEZ_A_QUINCE[t];
    const v = VEINTE_A_NOVENTA[t];
    const c = CIENTOS[t];
    if (u !== undefined) { acumular(u); continue; }
    if (d !== undefined) { acumular(d); continue; }
    if (v !== undefined) { acumular(v); continue; }
    if (c !== undefined) { acumular(c); continue; }
    return null; // token desconocido o cifra mezclada: NO se inventa el resto
  }

  total += current;
  if (!vistosNumero || total === 0) return null;

  if (decimales && decimales.length) {
    const cent = decimales.reduce((a, b) => a + b, 0);
    return total + (cent < 100 ? cent / 100 : 0);
  }
  return total;
}

/** Mapa de dígitos cuyo glifo OCR puede confundirse con una letra. */
export const DIGITOS_AMBIGUOS: Record<string, string> = {
  o: '0', i: '1', l: '1', s: '5', b: '8', z: '2', g: '6', t: '7', q: '9',
};

/**
 * Repara un número con letras-similares («15O.000» → «150.000»). Devuelve el
 * string ya normalizado SOLO si: (a) cada carácter desconocido está en el
 * mapa, (b) el resultado tiene pinta de número de miles/decimales español
 * (`1.234,56` / `1234,56` / `17 000`), y (c) el valor es finito. Si el texto
 * ya era numérico limpio devuelve null (no hay nada que reparar).
 */
export function repararNumeroAmbiguo(s: string): { texto: string; valor: number } | null {
  if (typeof s !== 'string') return null;
  let txt = s.trim();
  if (!txt) return null;
  // Quitar símbolo de moneda colgante («2.480,50 €»).
  txt = txt.replace(/\s*(€|\$|Q|Gs|C[/$])\s*$/i, '').trim();
  const limpio = txt.toLowerCase();
  // Si ya parsea sin tocar nada, NO es reparación.
  if (/^[\d.,\s]+$/.test(limpio)) return null;
  let reparado = '';
  for (const ch of limpio) {
    if (/^[0-9.,\s]$/.test(ch)) { reparado += ch; continue; }
    const map = DIGITOS_AMBIGUOS[ch];
    if (!map) return null; // letra sin correspondencia unívoca
    reparado += map;
  }
  // La reparación introduce CEROS: exijamos que el primer dígito no sea 0
  // («OIO» → «010» no es un número plausible de documento).
  if (/^0\d/.test(reparado)) return null;
  if (!/^\d{1,3}([ .]\d{3})*(,\d+)?$|^\d+(,\d+)?$/.test(reparado)) return null;
  const valor = Number(reparado.replace(/[ ]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  if (!Number.isFinite(valor) || valor <= 0) return null;
  return { texto: reparado, valor };
}
