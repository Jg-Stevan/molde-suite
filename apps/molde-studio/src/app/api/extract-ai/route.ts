import { NextRequest, NextResponse } from 'next/server';
import type { VisionMessage, VisionMultimodalContentItem } from 'z-ai-web-dev-sdk';

// Comparacion con IA: extrae campos del acta E-14 con un modelo de vision
// (VLM) en el servidor, para contrastar contra el molde JSON+OCR en el cliente.

export const runtime = 'nodejs';

const PROMPT = `Estas son las paginas de un acta E-14 de escrutinio de jurados de votacion de Colombia (Registraduria). La primera imagen es la pagina 1 (cabecera, candidatos y filas de votos) y la segunda, si existe, es la pagina 2 (constancias, recuento SI/NO y firmas de jurados).

Devuelve EXCLUSIVAMENTE un objeto JSON valido (sin markdown, sin explicaciones) con esta estructura exacta:
{
  "consulado_codigo": string|null,
  "pais_codigo": string|null,
  "pais_nombre": string|null,
  "zona_codigo": string|null,
  "puesto_codigo": string|null,
  "mesa_codigo": string|null,
  "lugar": string|null,
  "documento_id_15": string|null,
  "total_votantes_e11": boolean|null,
  "total_votos_urna": boolean|null,
  "total_votos_incinerados": boolean|null,
  "votos_candidato_1": boolean|null,
  "votos_candidato_2": boolean|null,
  "votos_en_blanco": boolean|null,
  "votos_nulos": boolean|null,
  "votos_no_marcados": boolean|null,
  "suma_total": boolean|null,
  "constancias_presente": boolean|null,
  "recuento_si": boolean|null,
  "recuento_no": boolean|null,
  "firmas_jurados": number|null,
  "observaciones": string|null
}

Reglas:
- Los campos *_codigo son los numeros impresos tras las etiquetas CONSULADO / PAIS / ZONA / PUESTO / MESA (el separador puede ser ':', ';' o ','.).
- documento_id_15 es el numero de 15 digitos bajo el codigo de barras (empieza por 7).
- Los booleanos indican si la casilla correspondiente esta DILIGENCIADA a mano (marca, X o numeros escritos): true si hay tinta manuscrita, false si la casilla esta vacia, null si no aparece en las imagenes.
- firmas_jurados: numero de casillas de FIRMA JURADO con tinta (pagina 2); null si no ves la pagina 2.
- No inventes datos.`;

function extraerJson(raw: string): Record<string, unknown> | null {
  const limpio = raw
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  const i0 = limpio.indexOf('{');
  const i1 = limpio.lastIndexOf('}');
  if (i0 === -1 || i1 === -1 || i1 <= i0) return null;
  try {
    return JSON.parse(limpio.slice(i0, i1 + 1));
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { images?: unknown };
    const images = body.images;
    if (!Array.isArray(images) || images.length === 0 || images.length > 2) {
      return NextResponse.json(
        { ok: false, error: 'Se esperan 1 o 2 imagenes (dataURL) en "images".' },
        { status: 400 },
      );
    }
    for (const img of images) {
      if (typeof img !== 'string' || !img.startsWith('data:image/')) {
        return NextResponse.json(
          { ok: false, error: 'Cada imagen debe ser un dataURL de imagen.' },
          { status: 400 },
        );
      }
    }

    const { default: ZAI } = await import('z-ai-web-dev-sdk');
    const zai = await ZAI.create();
    const content: VisionMultimodalContentItem[] = [{ type: 'text', text: PROMPT }];
    for (const img of images as string[]) {
      content.push({ type: 'image_url', image_url: { url: img } });
    }
    const messages: VisionMessage[] = [{ role: 'user', content }];
    const resp = await zai.chat.completions.createVision({
      model: 'glm-4.6v',
      messages,
      thinking: { type: 'disabled' },
    });
    const raw: string = resp?.choices?.[0]?.message?.content ?? '';
    return NextResponse.json({
      ok: true,
      raw,
      campos: extraerJson(raw),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
