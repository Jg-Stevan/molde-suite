// Tests del visor dev de conversión. PUREZA: `armarDocumentoVisorConv` es
// string → string (cero `window`), así que se puede exigir aquí lo que solo se
// rompe en el deploy — el documento blob: HEREDA el CSP de `public/_headers`
// (default-src 'self'), por lo que no puede referenciar NADA externo ni llevar
// script. La apertura de la pestaña (blob + window.open) se verifica en
// navegador, no acá.

import { describe, expect, test } from "bun:test";
import {
  TITULO_VISOR,
  armarDocumentoVisorConv,
  fotosAConvertir,
  type MetaVisorConversion,
} from "../src/lib/e14/conversion/visor-conversion";
import type { ResultadoConversionChandra } from "../src/lib/e14/conversion/chandra-bridge";

const META: MetaVisorConversion = {
  actaId: "acta-7",
  estado: "RECHAZADA",
  score: 8.3,
  esperadas: 1,
  conMolde: false,
  generado: "27/11/2026 10:15:04",
};

function resultado(
  parcial: Partial<ResultadoConversionChandra> = {},
): ResultadoConversionChandra {
  return {
    jsonTexto: JSON.stringify({ schema: "datalab-convert", children: [] }, null, 2),
    md: "# RECIBO DE PAGO\n\nFecha: 02 de febrero de 2026\n",
    html: '\n  <table data-bbox="10 20 300 40"><tr><td>Lucía Torres</td><td></td></tr></table>',
    ok: true,
    avisos: [],
    paginas: 1,
    ...parcial,
  };
}

describe("armarDocumentoVisorConv", () => {
  test("documento completo, listo para abrir en una pestaña", () => {
    const doc = armarDocumentoVisorConv(resultado(), META);
    expect(doc.startsWith("<!doctype html>")).toBe(true);
    expect(doc).toContain("</html>");
    expect(doc).toContain(TITULO_VISOR);
    expect(doc).toContain("VISTA DE DESARROLLO TEMPORAL");
  });

  // La aserción anti-CSP: el documento vive en una URL blob: que hereda
  // `default-src 'self'`. Un recurso externo se rompería SOLO en el deploy.
  test("cero <script> y cero URLs externas (CSP heredado del blob)", () => {
    const doc = armarDocumentoVisorConv(resultado(), META);
    expect(doc).not.toContain("<script");
    expect(doc).not.toContain("http://");
    expect(doc).not.toContain("https://");
    expect(doc).not.toContain("<link");
    expect(doc).not.toContain("<base");
  });

  test("las tres fuentes van como texto plano", () => {
    const doc = armarDocumentoVisorConv(resultado(), META);
    expect(doc).toContain("HTML renderizado");
    expect(doc).toContain("Markdown");
    expect(doc).toContain("JSON datalab-convert");
    expect(doc).toContain("HTML fuente");
  });

  test("el HTML del serializador entra crudo; el MD y el JSON van como texto", () => {
    const r = resultado();
    const doc = armarDocumentoVisorConv(r, META);
    // Verbatim: hay que ver la geometría real (data-bbox), no una caricatura.
    expect(doc).toContain('<table data-bbox="10 20 300 40">');
    // Los tres <pre> en orden: markdown, json, html-fuente.
    const pres = [...doc.matchAll(/<pre>([\s\S]*?)<\/pre>/g)].map((m) => m[1]);
    expect(pres).toHaveLength(3);
    expect(pres[0]).toContain("# RECIBO DE PAGO");
    // El JSON no se redacta ni se embellece: es parseable tal cual lo recibe
    // importar-chandra (escapar solo toca & < >, y aquí no hay ninguno).
    expect(JSON.parse(pres[1]).schema).toBe("datalab-convert");
    // El html-fuente es el MISMO fragmento, pero neutralizado como texto.
    expect(pres[2]).toContain("&lt;table");
  });

  test("contenido OCR adverso no puede escapar de su <pre>", () => {
    const r = resultado({
      md: "</pre><img src=x onerror=alert(1)>",
      jsonTexto: '{"x":"</textarea><script>bad</script>"}',
      avisos: ["<b>aviso</b> con & sinos"],
    });
    const doc = armarDocumentoVisorConv(r, META);
    expect(doc).not.toContain("</pre><img");
    expect(doc).not.toContain("<b>aviso</b>");
    expect(doc).toContain("&lt;/pre&gt;&lt;img src=x onerror=alert(1)&gt;");
    expect(doc).toContain("&lt;b&gt;aviso&lt;/b&gt; con &amp; sinos");
    // y ni a palos un script, escapado o no
    expect(doc).not.toContain("<script");
  });

  test("autochequeo y avisos se muestran; el lote sin molde se declara", () => {
    const doc = armarDocumentoVisorConv(
      resultado({ ok: false, avisos: ["1 recorte de firma no se pudo extraer"] }),
      { ...META, esperadas: 3 },
    );
    expect(doc).toContain("autochequeo con avisos");
    expect(doc).toContain("1 aviso(s)");
    expect(doc).toContain("1 recorte de firma no se pudo extraer");
    // páginas convertidas / esperadas, para no leer un lote parcial como pleno
    expect(doc).toContain("1 / 3");
    expect(doc).toContain("solo bandas OCR");
  });

  test("con molde lo dice explícitamente", () => {
    const doc = armarDocumentoVisorConv(
      resultado(),
      { ...META, conMolde: true, esperadas: null },
    );
    expect(doc).toContain("geometría de campos");
    expect(doc).not.toContain("solo bandas OCR");
    expect(doc).toContain("8.3/10");
  });
});

describe("fotosAConvertir", () => {
  const foto = "data:image/jpeg;base64,AAA";

  test("el documento en curso manda sobre el acta de la página", () => {
    const acta = { id: "a", fotoProcesada: "otra" } as never;
    const enCurso = { paginas: [{ fotoProcesada: foto }, { fotoProcesada: foto }] } as never;
    expect(fotosAConvertir(acta, enCurso)).toEqual([foto, foto]);
  });

  test("sin lote → la foto del acta; sin foto → vacío (botón deshabilitado)", () => {
    expect(fotosAConvertir({ fotoProcesada: foto } as never, null)).toEqual([foto]);
    expect(fotosAConvertir({ id: "a" } as never, null)).toEqual([]);
    expect(fotosAConvertir(null, null)).toEqual([]);
  });
});
