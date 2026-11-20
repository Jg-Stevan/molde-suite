import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * COOP/COEP condicionales por destino de navegación (convención `proxy` de
 * Next.js 16 — reemplaza a `middleware.ts`).
 *
 * Contexto (sandbox de preview, 2026-11-17):
 * El servidor de preview embebe la app en un <iframe> desde el shell del IDE
 * (origen distinto). El HTML salía con `Cross-Origin-Embedder-Policy:
 * require-corp` fijo (configuración `headers()` de next.config.ts), y un
 * documento con COEP require-corp NO puede incrustarse en un iframe cuyo
 * documento ancestro no es cross-origin-isolated: Chrome/Edge/Firefox rehúsan
 * la carga completa del frame ("Refused to display …") → la preview se ve
 * vacía aunque el servidor responda 200.
 *
 * Decisión: COOP/COEP solo en navegación TOP-LEVEL (dest `document` o
 * peticiones sin cabecera Sec-Fetch-Dest, p.ej. curl). Para destinos
 * `iframe`/`frame`/`embed` no se emiten: sin crossOriginIsolated el motor
 * wasm cae a 1 hilo de forma controlada (ver `rapidocr.ts` §ocr:multihilo-
 * entorno: "sin SAB el wasm cae a 1 hilo") — degradación ya probada E2E.
 *
 * NOTA de despliegue: esto solo gobierna el servidor Next (dev/standalone de
 * esta sandbox). El build estático (BUILD_STATIC=1, móvil Cloudflare Pages)
 * no ejecuta proxy; sus cabeceras siguen viniendo de `public/_headers`.
 */

const DESTINOS_EMBEBIDOS = new Set(["iframe", "frame", "embed"]);

export default function proxy(req: NextRequest) {
  const res = NextResponse.next();

  const dest = (req.headers.get("sec-fetch-dest") ?? "").toLowerCase();
  const esEmbebido = DESTINOS_EMBEBIDOS.has(dest);

  if (!esEmbebido) {
    // Navegación top-level (o cliente sin Sec-Fetch-*): aislamiento completo,
    // SharedArrayBuffer disponible → OCR multihilo.
    res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
    res.headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  }
  // Embebido: sin COOP/COEP — el frame carga en navegadores reales y el motor
  // opera mono-hilo sin tocar ninguna ruta de código.

  return res;
}

export const config = {
  // Espejo del source "/:path*" que antes vivía en headers() de next.config.
  matcher: ["/:path*"],
};
