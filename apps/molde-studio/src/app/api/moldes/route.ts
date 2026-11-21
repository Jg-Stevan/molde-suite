import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { protegerEscritura } from '@/lib/api-guard';
import { esMoldeUniversal } from '@/lib/molde/universal-types';

// GET /api/moldes — lista de moldes con conteo de pruebas
export async function GET() {
  const moldes = await db.molde.findMany({
    orderBy: { updatedAt: 'desc' },
    include: { _count: { select: { pruebas: true } }, pruebas: { orderBy: { createdAt: 'desc' }, take: 1, select: { score: true } } },
  });
  return NextResponse.json(moldes);
}

// POST /api/moldes — crear molde (json = objeto o string JSON)
export async function POST(req: NextRequest) {
  // Fase 6.2: token opcional (X_API_TOKEN) + rate-limit por IP.
  const denegado = protegerEscritura(req);
  if (denegado) return denegado;
  try {
    const body = await req.json();
    let parsed: unknown;
    try {
      parsed = typeof body.json === 'string' ? JSON.parse(body.json) : body.json;
    } catch {
      return NextResponse.json({ error: 'El JSON del molde es inválido' }, { status: 400 });
    }
    if (!esMoldeUniversal(parsed)) {
      return NextResponse.json(
        { error: 'Estructura de molde universal inválida (tipo "universal", nombre y campos[])' },
        { status: 400 },
      );
    }
    const creado = await db.molde.create({
      data: {
        nombre: parsed.nombre,
        descripcion: parsed.descripcion ?? null,
        documento: parsed.documento ?? null,
        json: JSON.stringify(parsed),
        imagenRef: body.imagenRef ?? null,
      },
    });
    return NextResponse.json(creado, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
