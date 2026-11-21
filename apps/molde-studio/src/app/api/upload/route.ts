import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

import { protegerEscritura } from '@/lib/api-guard';

// F2 (conversación de mejora — variante 2.1): implementación de la ruta que
// docs/API.md documenta desde la Fase 1 pero cuyo handler NUNCA llegó al repo
// (el commit 8dec868 la describe pero solo tocó .gitignore/docs/db.ts).
// El frontend la llama en repo.subirArchivo() (POST /api/upload) para
// persistir el documento fuente de cada corrida — sin ella, "Probar Plantilla"
// degrada a un no-op silencioso porque ninguna corrida queda re-ejecutable.
//
// Contrato (docs/API.md):
//   POST /api/upload — multipart/form-data con `file` (y `nombre` opcional,
//   informativo). Acepta png/jpeg/webp/heic/heif/pdf hasta 25 MB. Devuelve
//   { url: "/api/upload/<uuid>.<ext>", bytes } (201). Errores: 400 sin file,
//   415 tipo no soportado, 413 demasiado grande.
//
// Storage — decisión A (disco local): los bytes van a uploads/<uuid>.<ext>,
// directorio FUERA de public/ (no se sirven sin pasar por la ruta API que
// valida el nombre). Configurable con UPLOADS_DIR (default <cwd>/uploads).

export const runtime = 'nodejs';

/** Límite documentado del contrato: 25 MB. */
const MAX_BYTES = 25 * 1024 * 1024;

/** MIME aceptados → extensión canónica del archivo guardado. */
const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
};

function extDeTipo(mime: string, nombre: string): string | null {
  const porMime = MIME_EXT[mime.toLowerCase()];
  if (porMime) return porMime;
  // Browsers raros/envieles mandan type vacío: el nombre del archivo es la
  // única pista (mismo criterio de tolerancia que VerificacionTab).
  const ext = nombre.toLowerCase().split('.').pop() ?? '';
  if (['png', 'jpg', 'jpeg', 'webp', 'heic', 'heif', 'pdf'].includes(ext)) {
    return ext === 'jpeg' ? 'jpg' : ext;
  }
  return null;
}

/** Directorio de storage (UPLOADS_DIR o <cwd>/uploads). Resuelto a ruta absoluta. */
function dirUploads(): string {
  return process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : path.join(process.cwd(), 'uploads');
}

export async function POST(req: NextRequest) {
  // Fase 6.2: token opcional (X_API_TOKEN) + rate-limit por IP — igual que el
  // resto de escrituras de la API.
  const denegado = protegerEscritura(req);
  if (denegado) return denegado;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'El body debe ser multipart/form-data' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Falta el archivo (campo "file")' }, { status: 400 });
  }

  const ext = extDeTipo(file.type, file.name || '');
  if (!ext) {
    return NextResponse.json(
      {
        error: `Tipo no soportado (${file.type || 'sin tipo'}): usa PNG, JPEG, WebP, HEIC/HEIF o PDF`,
      },
      { status: 415 },
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `Archivo demasiado grande: ${file.size} bytes (máximo ${MAX_BYTES})` },
      { status: 413 },
    );
  }

  // Nombre opaco e impredecible (UUID): nada de user-supplied paths en disco y
  // la URL resultante es cacheable como inmutable (GET la sirve así).
  const nombre = `${randomUUID()}.${ext}`;
  const dir = dirUploads();
  const destino = path.join(dir, nombre);

  try {
    await mkdir(dir, { recursive: true });
    const bytes = Buffer.from(await file.arrayBuffer());
    await writeFile(destino, bytes);
    return NextResponse.json(
      { url: `/api/upload/${nombre}`, bytes: bytes.length },
      { status: 201 },
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
