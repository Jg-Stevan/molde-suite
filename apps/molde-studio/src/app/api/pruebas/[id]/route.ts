import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

type Params = { params: Promise<{ id: string }> };

// GET /api/pruebas/:id — reporte completo de la corrida (para el agente y la UI)
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const prueba = await db.prueba.findUnique({
    where: { id },
    include: { molde: { select: { id: true, nombre: true, documento: true } } },
  });
  if (!prueba) return NextResponse.json({ error: 'Prueba no encontrada' }, { status: 404 });
  let resultados: unknown = null;
  try {
    resultados = JSON.parse(prueba.resultados);
  } catch {
    resultados = null;
  }
  return NextResponse.json({
    id: prueba.id,
    moldeId: prueba.moldeId,
    molde: prueba.molde,
    archivo: prueba.archivo,
    score: prueba.score,
    requiere_revision: prueba.requiereRevision,
    createdAt: prueba.createdAt,
    resultados,
  });
}

// DELETE /api/pruebas/:id — idempotente: si la corrida ya no existe, responde OK
// (evita 500 cuando otra sesión la eliminó antes y la lista local quedó vieja).
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const existe = await db.prueba.findUnique({ where: { id }, select: { id: true } });
    if (!existe) return NextResponse.json({ ok: true, ya_eliminada: true });
    await db.prueba.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
