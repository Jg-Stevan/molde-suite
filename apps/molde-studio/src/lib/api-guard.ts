import { NextRequest, NextResponse } from 'next/server';

// Hardening de la API (Fase 6.2 / N-14 residual): mientras el despliegue
// público sea Pages (estático, sin API) el CRUD queda abierto por diseño.
// Si se define X_API_TOKEN en el entorno, TODAS las escrituras lo exigen y
// cada IP tiene un rate-limit por ventana deslizante.
//
// Uso en cada route handler de escritura:
//   const denegado = await protegerEscritura(req);
//   if (denegado) return denegado;

const VENTANA_MS = 60_000;
const MAX_ESCRITURAS_POR_VENTANA = 60;

/** Rate-limit en memoria por IP (suficiente para un VPS mono-instancia). */
const golpes = new Map<string, number[]>();

function ipDe(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'local'
  );
}

function sobreLimite(ip: string): boolean {
  const ahora = Date.now();
  const previos = (golpes.get(ip) ?? []).filter((t) => ahora - t < VENTANA_MS);
  if (previos.length >= MAX_ESCRITURAS_POR_VENTANA) {
    golpes.set(ip, previos);
    return true;
  }
  previos.push(ahora);
  golpes.set(ip, previos);
  // Limpieza oportunista del mapa (no crece sin límite).
  if (golpes.size > 10_000) {
    for (const [k, v] of golpes) {
      if (v.every((t) => ahora - t >= VENTANA_MS)) golpes.delete(k);
    }
  }
  return false;
}

/**
 * Protege una escritura (POST/PUT/DELETE): token si está configurado +
 * rate-limit por IP. Devuelve una respuesta de error o null si pasa.
 */
export function protegerEscritura(req: NextRequest): NextResponse | null {
  const token = process.env.X_API_TOKEN;
  if (token) {
    if (req.headers.get('x-api-token') !== token) {
      return NextResponse.json({ error: 'X-API-Token ausente o inválido' }, { status: 401 });
    }
  }
  if (sobreLimite(ipDe(req))) {
    return NextResponse.json(
      { error: `Demasiadas escrituras: máximo ${MAX_ESCRITURAS_POR_VENTANA}/min por IP` },
      { status: 429 },
    );
  }
  return null;
}
