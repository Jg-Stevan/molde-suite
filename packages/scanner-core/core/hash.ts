// Hashes SHA-256 (Fase 2a — migración scanner-core). ABSORBIDO desde
// apps/tamiz/src/lib/e14/hash.ts (sha256HexDeDataUrl) y ampliado con las
// variantes bytes/texto que necesita el contrato (sobre con checksum).
// WebCrypto puro, sin DOM; null sin crypto.subtle (contexto inseguro) —
// jamás inventa un hash.

/** ArrayBuffer → hex en bloques (sin apply sobre buffers grandes). */
function aHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/** SHA-256 de bytes → hex en minúsculas (null sin crypto.subtle). */
export async function sha256HexDeBytes(bytes: Uint8Array<ArrayBuffer>): Promise<string | null> {
  try {
    if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle) return null;
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return aHex(digest);
  } catch {
    return null;
  }
}

/** SHA-256 de un texto UTF-8 → hex (checksum del cuerpo del molde). */
export async function sha256HexDeTexto(texto: string): Promise<string | null> {
  return sha256HexDeBytes(new TextEncoder().encode(texto));
}

/** SHA-256 de un dataURL (identidad de un acta). null sin crypto.subtle. */
export async function sha256HexDeDataUrl(dataUrl: string): Promise<string | null> {
  try {
    if (typeof crypto === 'undefined' || !crypto.subtle) return null;
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return sha256HexDeBytes(bytes);
  } catch {
    return null;
  }
}
