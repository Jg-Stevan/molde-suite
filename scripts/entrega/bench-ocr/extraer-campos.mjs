/**
 * extraer-campos.mjs — prototipo de EXTRACCIÓN POR VALORES (paso 4 del plan)
 * sobre el crudo del arnés: ancla (o variantes) → valor en la misma línea /
 * banda local → patrón → estado honesto. No usa el molde de Tamiz ni sus
 * reglas: sirve para mostrar qué se puede verificar con el OCR tal cual.
 *
 *   bun extraer-campos.mjs <crudo.json> [--motor tess_fast] [--maestra A56-limpia3]
 *
 * Sin dependencias. Valores personales se muestran redactados o enmascarados.
 */
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const crudo = args[0];
if (!crudo) {
  console.error("uso: bun extraer-campos.mjs <crudo.json> [--motor M] [--maestra X]");
  process.exit(1);
}
const op = (n, d) => {
  const i = args.indexOf("--" + n);
  return i > -1 ? args[i + 1] : d;
};
const MOTOR = op("motor", "tess_fast");
const MAESTRA = op("maestra", "A56-limpia3");
const CABECERA = args.includes("--cabecera");

const norm = (s) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** normaliza a minúsculas sin acentos conservando un mapa al texto original. */
function normMapa(s) {
  let out = "";
  const mapa = [];
  for (let i = 0; i < s.length; i++) {
    const base = s[i].normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    for (const ch of base) {
      if (/[a-z0-9]/.test(ch)) {
        out += ch;
        mapa.push(i);
      } else if (out && !out.endsWith(" ")) {
        out += " ";
        mapa.push(i);
      }
    }
  }
  while (out.endsWith(" ")) { out = out.slice(0, -1); mapa.pop(); }
  return { out, mapa };
}

/** ancla con separadores tolerantes (puntos, º, °, espacios, guiones). */
function restoTrasAncla(linea, palabras) {
  const { out, mapa } = normMapa(linea);
  const objetivo = palabras.join(" ");
  const idx = out.indexOf(objetivo);
  if (idx === -1) return null;
  const fin = idx + objetivo.length - 1;
  const finOriginal = mapa[fin];
  return linea.slice(finOriginal + 1).replace(/^[\s:;._\-]+/, "").trim();
}

const CAMPOS = [
  { id: "titulo", anclas: [["recibo", "de", "pago"]], patron: /recibo\s+de\s+pago/i, todo: true },
  {
    id: "fecha_emision",
    anclas: [["fecha"]],
    cerca: "recibo",
    arriba: 0.25,
    patron: /\b\d{1,2}\s+de\s+[a-z]{3,}\s+de\s+20\d{2}\b/i,
    parcial: /\b\d{1,2}\s+de\s+[a-z]{3,}/i,
  },
  {
    id: "numero_recibo",
    anclas: [["n", "recibo"], ["n", "9", "recibo"]],
    arriba: 0.25,
    patron: /REC\s*-?\s*\d{4}\s*-?\s*\d{3,4}/i,
  },
  { id: "datos_emisor", anclas: [["con", "dni"]], ocurrencia: 1, patron: /dni\s*\d{1,3}(?:\.\d{3}){1,3}/i, todo: true, redactar: true },
  { id: "datos_pagador", anclas: [["recibi", "de"]], patron: /dni\s*\d{1,3}(?:\.\d{3}){1,3}/i, todo: true, redactar: true },
  { id: "importe", anclas: [["la", "suma", "de"]], patron: /\d{1,3}(?:\.\d{3})*,\d{2}/ },
  { id: "importe_texto", anclas: [["la", "suma", "de"]], patron: /\(([^)]{4,})\)/, opcional: true },
  { id: "concepto", anclas: [["en", "concepto", "de"]], recorte: 64 },
  { id: "forma_pago", anclas: [["forma", "de", "pago"]], cuenta: true },
  { id: "fecha_pago", anclas: [["fecha", "de", "pago"]], patron: /\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/ },
  { id: "firma_emisor", tinta: true },
  { id: "firma_pagador", tinta: true },
];

function caja(l) {
  const xs = l.box.map((p) => p.x), ys = l.box.map((p) => p.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function enmascarar(r) {
  let v = r.valor ?? "";
  if (r.campo.redactar) {
    const dni = /(\d{2})\.\d{3}\.(\d{3})/.exec(v);
    return "línea leída" + (dni ? ` (DNI ${dni[1]}.***.${dni[2]})` : "") + " — datos personales redactados";
  }
  if (r.campo.cuenta) {
    v = v.replace(/ES(\d{2})[\s\d]{10,}/i, (m, p1, off) => `ES${p1} **** **** **** **** ${m.trim().slice(-4)}`);
  }
  if (r.campo.recorte && v.length > r.campo.recorte) v = v.slice(0, r.campo.recorte) + "…";
  return v;
}

function evaluarCampo(campo, lineas, W, H) {
  if (campo.tinta) return { campo, estado: "requiere_tinta", valor: "medición de tinta no disponible en este prototipo" };
  const candidatos = [];
  for (const l of lineas) {
    const n = norm(l.texto);
    if (campo.arriba != null) {
      const [, y0, , y1] = caja(l);
      if ((y0 + y1) / 2 / H > campo.arriba) continue;
    }
    for (const ancla of campo.anclas) {
      const objetivo = ancla.join(" ");
      if (!n.includes(objetivo)) continue;
      const resto = restoTrasAncla(l.texto, ancla);
      if (resto == null) continue;
      const [x0, y0, x1, y1] = caja(l);
      candidatos.push({ linea: l, resto, cx: (x0 + x1) / 2 / W, cy: (y0 + y1) / 2 / H });
      break;
    }
  }
  if (candidatos.length === 0) return { campo, estado: "sin_ancla" };
  if (campo.cerca) {
    const radios = candidatos.map((c) => {
      const cerca = lineas.some((l) => {
        const [, y0, , y1] = caja(l);
        const x0 = Math.min(...l.box.map((p) => p.x));
        const x1 = Math.max(...l.box.map((p) => p.x));
        const cx = (x0 + x1) / 2 / W, cy = (y0 + y1) / 2 / H;
        return norm(l.texto).includes(campo.cerca) && Math.hypot(cx - c.cx, cy - c.cy) <= 0.3;
      });
      return c && cerca;
    });
    const idx = radios.indexOf(true);
    if (idx === -1) return { campo, estado: "ancla_descartada" };
    candidatos.splice(0, idx);
  }
  const cand = candidatos[Math.min((campo.ocurrencia ?? 1) - 1, candidatos.length - 1)];
  const valor = campo.todo ? cand.linea.texto.trim() : cand.resto;
  if (!valor) return { campo, estado: "sin_lectura", valor: "" };
  if (campo.patron && !campo.patron.test(valor)) {
    if (campo.parcial && campo.parcial.test(valor)) return { campo, estado: "parcial", valor };
    return { campo, estado: "sin_lectura", valor };
  }
  return { campo, estado: "ok", valor };
}

const EMOJI = { ok: "OK", parcial: "PARCIAL", sin_ancla: "NO VERIF.", ancla_descartada: "NO VERIF.", sin_lectura: "NO VERIF.", requiere_tinta: "TINTA" };

/** El crudo guarda PALABRAS con caja; reconstruye renglones por línea base. */
function agruparRenglones(palabras) {
  const ws = palabras.map((w) => {
    const [x0, y0, x1, y1] = caja(w);
    return { t: w.texto, x0, y0, x1, y1, cy: (y0 + y1) / 2, h: y1 - y0 };
  });
  ws.sort((a, b) => a.cy - b.cy || a.x0 - b.x0);
  const alturas = ws.map((w) => w.h).sort((a, b) => a - b);
  const hMed = alturas[Math.floor(alturas.length / 2)] || 10;
  const grupos = [];
  for (const w of ws) {
    const ult = grupos[grupos.length - 1];
    const cyUlt = ult ? ult.reduce((s, c) => s + c.cy, 0) / ult.length : -1e9;
    if (!ult || Math.abs(w.cy - cyUlt) > hMed * 0.6) grupos.push([w]);
    else ult.push(w);
  }
  return grupos.map((g) => {
    g.sort((a, b) => a.x0 - b.x0);
    const x0 = Math.min(...g.map((w) => w.x0)), y0 = Math.min(...g.map((w) => w.y0));
    const x1 = Math.max(...g.map((w) => w.x1)), y1 = Math.max(...g.map((w) => w.y1));
    return { texto: g.map((w) => w.t).join(" "), box: [{ x: x0, y: y0 }, { x: x1, y: y1 }] };
  });
}

const snap = JSON.parse(readFileSync(crudo, "utf8"));
const runs = (snap.resultados ?? []).filter((r) => r.motor === MOTOR && r.maestra === MAESTRA && !r.error);
if (runs.length === 0) throw new Error(`sin corridas de ${MOTOR}/${MAESTRA} en ${crudo}`);

const gt = JSON.parse(readFileSync(new URL("../../resultados/medicion-ocr/gt/etiquetas.json", import.meta.url), "utf8")).recibo;
// Modo rescate de cabecera: solo los dos campos del bloque, sin el faro
// `arriba` (dentro del recorte la etiqueta queda más abajo del 25 %) ni el
// radio de `cerca` (se mide sobre el alto del recorte, donde «Fecha» y
// «Recibo» caen a ~0,45 de separación y el faro descartaba el ancla).
const campos = CABECERA
  ? CAMPOS.filter((c) => c.id === "fecha_emision" || c.id === "numero_recibo").map((c) => ({ ...c, arriba: null, cerca: null }))
  : CAMPOS;
const lados = [...new Set(runs.map((r) => r.lado))].sort((a, b) => a - b);

console.log(`\n### ${crudo.split(/[\\/]/).slice(-3, -2)[0]} · ${MOTOR} · ${MAESTRA}${CABECERA ? " · rescate" : ""}\n`);
for (const lado of lados) {
  const delLado = runs.filter((x) => x.lado === lado);
  const r = delLado[0];
  const lineas = agruparRenglones(r.lineas ?? []);
  const W = r.cropW ?? r.limpioW;
  const H = r.cropH ?? r.limpioH;
  const resultados = campos.map((c) => evaluarCampo(c, lineas, W, H));
  const etiq = gt.map((e) => norm(r.texto).includes(norm(e)));
  const oblig = resultados.filter((x) => !x.campo.opcional && !x.campo.tinta);
  const ok = oblig.filter((x) => x.estado === "ok").length;
  const noVerif = oblig.filter((x) => x.estado !== "ok").length;
  // Repeticiones: el conteo por fila puede variar entre pasadas (el OCR no es
  // determinista con la misma imagen en todos los motores), así que se reporta
  // la mediana sobre todas, no solo la primera lectura.
  const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const porRep = delLado.map((x) => {
    const re = campos.map((c) => evaluarCampo(c, agruparRenglones(x.lineas ?? []), x.cropW ?? x.limpioW, x.cropH ?? x.limpioH));
    const ob = re.filter((y) => !y.campo.opcional && !y.campo.tinta);
    return {
      campos: ob.filter((y) => y.estado === "ok").length,
      etiq: gt.filter((e) => norm(x.texto).includes(norm(e))).length,
      okPorCampo: Object.fromEntries(re.map((y) => [y.campo.id, y.estado === "ok"])),
    };
  });
  const dims = r.cropW ? `${r.cropW}×${r.cropH} (recorte de ${r.limpioW}×${r.limpioH})` : `${r.limpioW}×${r.limpioH}`;
  console.log(
    `— lado ${lado} (${dims}) · ms=${r.ms} · conf=${r.conf} · etiquetas GT reales=${etiq.filter(Boolean).length}/${gt.length} · campos obligatorios OK=${ok}/${oblig.length}` +
      ` → ${noVerif ? "EN_REVISION_HUMANA (NO SE PUDO VERIFICAR " + noVerif + ")" : "VERIFICABLE (firmas pendientes de tinta)"}`,
  );
  if (delLado.length > 1) {
    const camposOk = [...new Set(porRep.map((p) => p.campos))].sort((a, b) => a - b);
    console.log(
      `  ${delLado.length} repeticiones: campos OK mediana=${med(porRep.map((p) => p.campos))}/${oblig.length} (rangos ${camposOk.join(",")}) · etiquetas mediana=${med(porRep.map((p) => p.etiq))}/${gt.length}`,
    );
  }
  for (const x of resultados) {
    const estado = EMOJI[x.estado] ?? x.estado;
    const valor = x.estado === "ok" || x.estado === "parcial" ? enmascarar(x) : x.estado === "sin_lectura" && x.valor ? "«" + enmascarar(x) + "»" : "";
    const estables = porRep.filter((p) => p.okPorCampo?.[x.campo.id]).length;
    console.log(`    ${x.campo.id.padEnd(15)} ${estado.padEnd(9)} ${valor}${estables && delLado.length > 1 ? ` (${estables}/${delLado.length} reps)` : ""}`);
  }
  console.log("");
}
