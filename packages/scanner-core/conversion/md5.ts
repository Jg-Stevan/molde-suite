/**
 * MD5 puro en TypeScript (sin dependencias, corre en worker/navegador y en Node).
 * Lo usamos para el nombre de archivo de los recortes: `{md5}_img.jpg`, mismo
 * formato que emite datalab-convert. Nota honesta: el hash de datalab no es
 * derivable de los bytes (probamos md5/sha1 del JPEG y del base64: no coincide);
 * cualquier hex de 32 chars respeta el formato y el nuestro además deduplica
 * recortes idénticos.
 */

// Constantes K[i] = floor(|sin(i+1)| * 2^32) — se calculan en arranque para
// evitar erratas en una tabla de 64 constantes.
const K = new Uint32Array(64);
for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

function rotl(x: number, c: number): number {
  return (x << c) | (x >>> (32 - c));
}

/** md5 en hex minúscula de un array de bytes. */
export function md5Hex(bytes: Uint8Array): string {
  const bitLen = bytes.length * 8;
  // padding: mensaje + 0x80 + ceros + longitud en 64 bits little-endian
  const conPadding = ((bytes.length + 8) >> 6) + 1; // nº de chunks de 64B
  const total = conPadding * 64;
  const m = new Uint8Array(total);
  m.set(bytes);
  m[bytes.length] = 0x80;
  // longitud little-endian (JS_SAFE: bitLen cabe en 53 bits, suficiente para
  // cualquier página/recorte)
  const dv = new DataView(m.buffer);
  dv.setUint32(total - 8, bitLen >>> 0, true);
  dv.setUint32(total - 4, Math.floor(bitLen / 4294967296), true);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const M = new Uint32Array(16);

  for (let chunk = 0; chunk < conPadding; chunk++) {
    const off = chunk * 64;
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number, g: number;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      const tmp = D;
      D = C;
      C = B;
      B = (B + rotl((A + F + K[i] + M[g]) >>> 0, S[i])) >>> 0;
      A = tmp;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new Uint8Array(16);
  const odv = new DataView(out.buffer);
  odv.setUint32(0, a0, true); odv.setUint32(4, b0, true);
  odv.setUint32(8, c0, true); odv.setUint32(12, d0, true);
  let hex = '';
  for (const b of out) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/** Nombre de archivo de recorte en el formato datalab: `{hash}_img.jpg`. */
export function nombreArchivoImagen(jpegBytes: Uint8Array): string {
  return md5Hex(jpegBytes) + '_img.jpg';
}

// ---------------------------------------------------------------------------
// Base64 sin dependencias (Node usa Buffer; navegador usa btoa por chunks)
// ---------------------------------------------------------------------------

export function bytesABase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function base64ABytes(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
