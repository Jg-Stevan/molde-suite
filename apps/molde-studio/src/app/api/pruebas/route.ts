import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/pruebas?moldeId=&take=&cursor= — historial de corridas (sin
// resultados pesados). N-7a: `take` configurable (default 100, máx. 500) y
// header X-Total con el total real del filtro, para que el cliente avise
// cuando la lista está truncada (antes se cortaba en 100 en silencio).
export async function GET(req: NextRequest) {
  const moldeId = req.nextUrl.searchParams.get('moldeId') ?? undefined;
  const takeRaw = Number(req.nextUrl.searchParams.get('take') ?? '100');
  const take = Number.isFinite(takeRaw) ? Math.min(500, Math.max(1, Math.trunc(takeRaw))) : 100;
  const cursor = req.nextUrl.searchParams.get('cursor') ?? undefined;
  const where = {
    ...(moldeId ? { moldeId } : {}),
    // Keyset: createdAt estrictamente menor al cursor (página ya vista).
    ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
  };
  const [pruebas, total] = await Promise.all([
    db.prueba.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true, moldeId: true, archivo: true, score: true, requiereRevision: true, createdAt: true,
        // fuenteUrl: para saber desde el cliente si la corrida es re-ejecutable
        // sin volver a subir el archivo; updatedAt: para el aviso de versión.
        fuenteUrl: true, updatedAt: true,
        molde: { select: { nombre: true } },
      },
    }),
    db.prueba.count({ where: moldeId ? { moldeId } : {} }),
  ]);
  return NextResponse.json(pruebas, {
    status: 200,
    headers: {
      'X-Total': String(total),
      'X-Take': String(take),
    },
  });
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
        // URL del documento fuente (/uploads/...) si el cliente la subió.
        fuenteUrl: typeof body.fuenteUrl === 'string' && body.fuenteUrl ? body.fuenteUrl : null,
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
