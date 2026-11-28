// TEMPORAL-DEV-CONVERSION — visor de diagnóstico de la conversión datalab-convert.
//
// Qué es: UI TEMPORAL de desarrollador. Convierte el documento en curso con el
// MISMO puente que cerró el Benchmark OCR V3 (`convertirActaAChandra`) y arma un
// documento HTML autocontenido que el botón de la píldora abre en una pestaña
// nueva — HTML renderizado arriba, y .md / .json / html-fuente en texto plano
// abajo. NO descarga nada (por eso `BotonExportarConversion` se retiró).
//
// Dos restricciones duras que explican cada decisión de abajo:
//
//  · CSP heredado. `public/_headers` fija `default-src 'self'; style-src 'self'
//    'unsafe-inline'; img-src 'self' data: blob:; base-uri 'none'` y el blob
//    hereda el CSP del documento creador en Chromium. En `next start`/dev NO hay
//    CSP, así que romper esto solo se vería en el deploy: por eso el documento
//    tiene CERO recursos externos, CERO <script> y todo el CSS inline. Requisito
//    permanente del builder: jamás emitir una URL ajena.
//  · El OCR re-corrre al convertir (~1-3 s/página, ver chandra-bridge.ts:24-26)
//    y abrir una pestaña de fondo STRANGULA la CPU en Android (medido
//    2026-11-26 en scripts/entrega/a56-comun.mjs:133-137). Por eso este módulo
//    prepara la URL y NO abre la ventana: `abrirUrlVisor` se llama después del
//    await, con la app al frente.

import { escapar } from "@molde-suite/scanner-core/conversion";
import type { Acta } from "@molde-suite/scanner-core/dominio/types";
import type { DocumentoEnCurso } from "@/lib/e14/store/tipos";
import { convertirActaAChandra, type ResultadoConversionChandra } from "./chandra-bridge";

export const TITULO_VISOR = "Conversión datalab (Chandra) · vista dev";

const CODIFICADOR = new TextEncoder();

/** KB legibles para el banner y los <summary> (bytes UTF-8 reales). */
function kb(texto: string): string {
  return `${(CODIFICADOR.encode(texto).length / 1024).toFixed(1)} KB`;
}

/**
 * Páginas a convertir: el documento en curso (1..N) o la foto del acta.
 * Regla intacta del bloque retirado — SOLO `fotoProcesada`, sin fallback a
 * `fotoOriginal` (mezclar ese cambio aquí ensuciaría la regresión visual).
 */
export function fotosAConvertir(
  acta: Acta | null,
  enCurso: DocumentoEnCurso | null,
): string[] {
  if (enCurso && enCurso.paginas.length > 0) {
    return enCurso.paginas
      .map((p) => p.fotoProcesada)
      .filter((f): f is string => Boolean(f));
  }
  return acta?.fotoProcesada ? [acta.fotoProcesada] : [];
}

export interface MetaVisorConversion {
  actaId: string;
  estado: string;
  score: number;
  /** Páginas que declara el molde (`documentoEnCurso.esperadas`), si aplica. */
  esperadas: number | null;
  /** false → el puente cayó a la vía M2-estructural (solo bandas de OCR). */
  conMolde: boolean;
  /** Fecha ya formateada para mostrar (texto, no objeto). */
  generado: string;
}

/**
 * CSS del visor. Tema oscuro propio (no hereda de la app: es otro documento).
 * `pre-wrap` es obligatorio — las tablas del .md miden max(largo)+2 chars y sin
 * eso fuerzan scroll horizontal en los 412 px del A56. Los bordes de `th/td`
 * existen porque el GT emite celdas vacías que sin borde son invisibles, y
 * `[data-bbox]` se puntea para ver la geometría heredada: eso ES el diagnóstico.
 */
const ESTILO = `
:root{color-scheme:dark}
body{margin:0 auto;padding:16px;max-width:52rem;background:#090d12;color:#e2e8f0;font:14px/1.55 system-ui,sans-serif}
h1{font:700 15px/1.3 ui-monospace,monospace;margin:10px 0 4px}
h2{font:700 11px/1.3 ui-monospace,monospace;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;margin:26px 0 8px;border-bottom:1px solid #1e293b;padding-bottom:6px}
.temp{border:1px solid #b45309;background:#451a03;color:#fbbf24;padding:8px 10px;border-radius:8px;font:600 11px/1.55 ui-monospace,monospace}
dl.meta{display:flex;flex-wrap:wrap;gap:4px 18px;margin:10px 0 0}
dl.meta>div{display:flex;gap:6px;align-items:baseline}
dt{font:700 9px/1.5 ui-monospace,monospace;text-transform:uppercase;letter-spacing:.08em;color:#64748b}
dd{margin:0;font:600 12px/1.5 ui-monospace,monospace;color:#cbd5e1}
.ok{color:#10b981}
.no{color:#f59e0b}
.avisos{margin-top:10px}
.avisos ul{margin:6px 0 0;padding-left:18px;font:11px/1.6 ui-monospace,monospace;color:#94a3b8}
summary{cursor:pointer;font:700 11px/1.7 ui-monospace,monospace;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8}
#render{background:#0b1017;border:1px solid #1e293b;border-radius:10px;padding:12px}
[data-bbox]{outline:1px dashed #475569;outline-offset:1px}
table{border-collapse:collapse;width:100%;margin:12px 0}
th,td{border:1px solid #334155;padding:4px 6px;font:12px/1.4 ui-monospace,monospace;text-align:left;vertical-align:top}
img{max-width:100%;height:auto;background:#fff}
pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:70vh;overflow:auto;background:#0b1017;border:1px solid #1e293b;border-radius:8px;padding:10px;margin:8px 0;font:11px/1.5 ui-monospace,monospace;color:#cbd5e1}
`.trim();

/**
 * PURA (string → string, cero `window`): documento HTML completo y autocontenido.
 *
 * Escape: TODO el contenido OCR/JSON va en nodos de texto con `escapar()` — que
 * cubre `& < >` pero NO comillas, así que está prohibido poner contenido del
 * documento en un atributo. `r.html` se inserta crudo: ya viene escapado por los
 * emisores del paquete (`conversion/html.ts`) y trae `data-bbox` + imágenes
 * `data:` inline.
 */
export function armarDocumentoVisorConv(
  r: ResultadoConversionChandra,
  meta: MetaVisorConversion,
): string {
  const paginas =
    meta.esperadas && meta.esperadas !== r.paginas
      ? `${r.paginas} / ${meta.esperadas}`
      : `${r.paginas}`;
  const avisos = r.avisos.slice(0, 40);
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escapar(TITULO_VISOR)} · ${paginas} pág.</title>
<style>${ESTILO}</style>
</head>
<body>
<header>
<p class="temp">VISTA DE DESARROLLO TEMPORAL — no es parte del flujo de producto. No se descarga nada: esta dirección vive mientras la pestaña de Tamiz esté abierta. Contiene el texto OCR completo del documento (nombres, cédulas, montos); no sale del dispositivo.</p>
<h1>${escapar(TITULO_VISOR)}</h1>
<dl class="meta">
<div><dt>acta</dt><dd>${escapar(meta.actaId)}</dd></div>
<div><dt>estado</dt><dd>${escapar(meta.estado)}</dd></div>
<div><dt>score</dt><dd>${meta.score.toFixed(1)}/10</dd></div>
<div><dt>páginas</dt><dd>${paginas}</dd></div>
<div><dt>molde</dt><dd>${meta.conMolde ? "sí — geometría de campos" : "no — solo bandas OCR (vía M2-estructural)"}</dd></div>
<div><dt>autochequeo</dt><dd><b class="${r.ok ? "ok" : "no"}">${r.ok ? "✓ esquema datalab verificado" : "⚠ autochequeo con avisos"}</b></dd></div>
<div><dt>tamaño</dt><dd>${kb(r.html)} html · ${kb(r.md)} md · ${kb(r.jsonTexto)} json</dd></div>
<div><dt>generado</dt><dd>${escapar(meta.generado)}</dd></div>
</dl>
${
  avisos.length
    ? `<details class="avisos"><summary>${r.avisos.length} aviso(s)</summary><ul>${avisos
        .map((a) => `<li>${escapar(a)}</li>`)
        .join("")}</ul></details>`
    : ""
}
</header>
<main>
<h2>HTML renderizado</h2>
<section id="render">${r.html}</section>
<h2>Fuentes · texto plano</h2>
<section id="fuente">
<details open><summary>Markdown · ${kb(r.md)}</summary><pre>${escapar(r.md)}</pre></details>
<details><summary>JSON datalab-convert (idéntico al que consume Molde Studio) · ${kb(r.jsonTexto)}</summary><pre>${escapar(r.jsonTexto)}</pre></details>
<details><summary>HTML fuente (fragmento sin envolver) · ${kb(r.html)}</summary><pre>${escapar(r.html)}</pre></details>
</section>
</main>
</body>
</html>
`;
}

export interface PreparadoVisor {
  url: string;
  bytes: number;
  paginas: number;
  ok: boolean;
}

/** Convierte (OCR incluido) y deja el documento listo como URL blob. NO abre nada. */
export async function prepararVisorConversionDev(
  acta: Acta,
  enCurso: DocumentoEnCurso | null,
): Promise<PreparadoVisor> {
  const fotos = fotosAConvertir(acta, enCurso);
  const r = await convertirActaAChandra(fotos, acta.evaluacionMolde ?? null);
  const doc = armarDocumentoVisorConv(r, {
    actaId: acta.id,
    estado: acta.status,
    score: acta.score,
    esperadas: enCurso?.esperadas ?? null,
    conMolde: Boolean(acta.evaluacionMolde),
    generado: new Date().toLocaleString(),
  });
  // `charset=utf-8` explícito: el deploy sirve X-Content-Type-Options: nosniff.
  const url = URL.createObjectURL(
    new Blob([doc], { type: "text/html;charset=utf-8" }),
  );
  return {
    url,
    bytes: CODIFICADOR.encode(doc).length,
    paginas: r.paginas,
    ok: r.ok,
  };
}

/** Devuelve false si el navegador bloqueó la ventana (sin transient activation). */
export function abrirUrlVisor(url: string): boolean {
  // COOP same-origin: `window.open` devuelve un proxy opaco → SOLO se lee si es
  // null; tocar `win.document`/`win.focus()` está prohibido.
  return window.open(url, "_blank") !== null;
}
