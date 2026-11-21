import { NextRequest, NextResponse } from 'next/server';
import { readFile, stat } from 'fs/promises';
import path from 'path';

// F2 (conversación de mejora): GET /api/upload/<file> — sirve el documento
// fuente persistido con su Content-Type y cache inmutable (los nombres son
// UUID únicos). 404 si no existe. Contrato de docs/API.md.
//
// La re-ejecución de "Probar Plantilla" descarga el archivo fuente por aquí
// (VerificacionTab → repo.resolverUrl(fuente_url) → fetch), así que esta ruta
// es el segundo eslabón del circuito que antes estaba roto.

export const runtime = 'nodejs';

/** Content-Type por extensión (espejo de la tabla del POST). */
const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  pdf: 'application/pdf',
};

/** Nombres aceptados: solo [uuid].[ext] generado por el POST — nunca una ruta
 * arbitraria (blindaje de path traversal: se valida la forma Y que la ruta
 * resuelta quede dentro del directorio de uploads). */
const NOMBRE_VALIDO = /^[a-zA-Z0-9-]{8,}\.(png|jpe?g|webp|heic|heif|pdf)$/i;

function dirUploads(): string {
  return process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : path.join(process.cwd(), 'uploads');
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;

  if (!NOMBRE_VALIDO.test(file)) {
    return NextResponse.json({ error: 'Archivo no encontrado' }, { status: 404 });
  }

  const dir = dirUploads();
  const ruta = path.join(dir, file);
  // Defensa en profundidad: la ruta resuelta DEBE seguir dentro del directorio
  // de uploads (con un nombre validado por regex no debería poder salir, pero
  // el chequeo es barato y elimina la clase entera de bugs).
  if (!path.resolve(ruta).startsWith(dir + path.sep)) {
    return NextResponse.json({ error: 'Archivo no encontrado' }, { status: 404 });
  }

  try {
    const info = await stat(ruta);
    if (!info.isFile()) {
      return NextResponse.json({ error: 'Archivo no encontrado' }, { status: 404 });
    }
    const bytes = await readFile(ruta);
    const ext = (file.toLowerCase().split('.').pop() ?? '') as keyof typeof EXT_MIME;
    const mime = EXT_MIME[ext] ?? 'application/octet-stream';
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': mime,
        // Los nombres son UUID únicos e inmutables: cache agresivo correcto.
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Archivo no encontrado' }, { status: 404 });
  }
}
