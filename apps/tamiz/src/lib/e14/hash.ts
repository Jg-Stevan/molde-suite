// SHA-256 de un dataURL (para la identidad de un acta). Usa WebCrypto;
// null sin crypto.subtle (contexto inseguro) — jamás inventa un hash.

export async function sha256HexDeDataUrl(dataUrl: string): Promise<string | null> {
  try {
    if (typeof crypto === 'undefined' || !crypto.subtle) return null;
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}
