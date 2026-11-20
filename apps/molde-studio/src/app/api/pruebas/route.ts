import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/pruebas?moldeId= — historial de corridas (sin resultados pesados)
export async function GET(req: NextRequest) {
  const moldeId = req.nextUrl.searchParams.get('moldeId') ?? undefined;
  const pruebas = await db.prueba.findMany({
    where: moldeId ? { moldeId } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true, moldeId: true, archivo: true, score: true, requiereRevision: true, createdAt: true,
      molde: { select: { nombre: true } },
    },
  });
  return NextResponse.json(pruebas);
}

// POST /api/pruebas — guardar una corrida
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.moldeId || !body.archivo || !body.resultados) {
      return NextResponse.json({ error: 'moldeId, archivo y resultados son obligatorios' }, { status: 400 });
    }
    const molde = await db.molde.findUnique({ where: { id: body.moldeId }, select: { id: true } });
    if (!molde) return NextResponse.json({ error: 'Molde no encontrado' }, { status: 404 });
    const creado = await db.prueba.create({
      data: {
        moldeId: body.moldeId,
        archivo: String(body.archivo),
        resultados: typeof body.resultados === 'string' ? body.resultados : JSON.stringify(body.resultados),
        score: typeof body.score === 'number' ? body.score : null,
        requiereRevision: Boolean(body.requiereRevision),
      },
    });
    return NextResponse.json({ id: creado.id }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
