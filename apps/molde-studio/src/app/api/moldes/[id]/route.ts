import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { protegerEscritura } from '@/lib/api-guard';
import { esMoldeUniversal } from '@/lib/molde/universal-types';

type Params = { params: Promise<{ id: string }> };

// GET /api/moldes/:id
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const molde = await db.molde.findUnique({ where: { id }, include: { _count: { select: { pruebas: true } } } });
  if (!molde) return NextResponse.json({ error: 'Molde no encontrado' }, { status: 404 });
  return NextResponse.json(molde);
}

// PUT /api/moldes/:id — actualizar metadatos y/o el JSON del molde
export async function PUT(req: NextRequest, { params }: Params) {
  // Fase 6.2: token opcional (X_API_TOKEN) + rate-limit por IP.
  const denegado = protegerEscritura(req);
  if (denegado) return denegado;
  const { id } = await params;
  try {
    const body = await req.json();
    const data: Record<string, string | null> = {};
    if (typeof body.nombre === 'string') data.nombre = body.nombre;
    if (typeof body.descripcion === 'string' || body.descripcion === null) data.descripcion = body.descripcion;
    if (typeof body.documento === 'string' || body.documento === null) data.documento = body.documento;
    if (typeof body.imagenRef === 'string' || body.imagenRef === null) data.imagenRef = body.imagenRef;
    if (body.json !== undefined) {
      let parsed: unknown;
      try {
        parsed = typeof body.json === 'string' ? JSON.parse(body.json) : body.json;
      } catch {
        return NextResponse.json({ error: 'El JSON del molde es inválido' }, { status: 400 });
      }
      if (!esMoldeUniversal(parsed)) {
        return NextResponse.json({ error: 'Estructura de molde universal inválida' }, { status: 400 });
      }
      data.json = JSON.stringify(parsed);
      if (typeof parsed.nombre === 'string' && !data.nombre) data.nombre = parsed.nombre;
    }
    const actualizado = await db.molde.update({ where: { id }, data });
    return NextResponse.json(actualizado);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// DELETE /api/moldes/:id — elimina el molde y sus pruebas (cascada)
export async function DELETE(req: NextRequest, { params }: Params) {
  // Fase 6.2: token opcional (X_API_TOKEN) + rate-limit por IP.
  const denegado = protegerEscritura(req);
  if (denegado) return denegado;
  const { id } = await params;
  try {
    await db.molde.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
