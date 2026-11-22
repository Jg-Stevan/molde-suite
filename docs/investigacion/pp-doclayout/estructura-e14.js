const fs = require('fs');

const RESULT = 'results.jsonl';
const CHANDRA = 'C:/Users/JG/Downloads/datalab-convert-exterior-delegados-molde-plantilla-escaneada.json';
const RUN = process.env.RUN || 'phone-mwrf3lq0';
const PAGE = 0;
const W = 676;
const H = 2048;

const rows = fs.readFileSync(RESULT, 'utf8').trim().split('\n').map(JSON.parse);
const run = rows.filter((r) => r.id === RUN).pop();
const NMSRUN = process.env.NMSRUN || 'phone-mwrfakmk';
const runNms = rows.filter((r) => r.id === NMSRUN).pop() || run;
const MIN = Number(process.env.MIN || 0.2);
const pool = run.thrSweep.find((s) => s.threshold === Number(process.env.POOL_T || 0.2)).dets;

const ch = JSON.parse(fs.readFileSync(CHANDRA, 'utf8'));
const pg = ch.children.find((p) => p.page === PAGE);
const sx = W / pg.bbox[2];
const sy = H / pg.bbox[3];
const gt = pg.children.map((b) => ({
  type: b.block_type,
  x1: b.bbox[0] * sx,
  y1: b.bbox[1] * sy,
  x2: b.bbox[2] * sx,
  y2: b.bbox[3] * sy,
  text: String(b.html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50)
}));

const area = (d) => (d.x2 - d.x1) * (d.y2 - d.y1);
const inter = (a, b) => Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)) * Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
const iou = (a, b) => {
  const i = inter(a, b);
  const u = area(a) + area(b) - i;
  return u > 0 ? i / u : 0;
};
const containment = (a, b) => (Math.min(area(a), area(b)) > 0 ? inter(a, b) / Math.min(area(a), area(b)) : 0);

const n = (d) => ({ x1: d.x1 / W, y1: d.y1 / H, x2: d.x2 / W, y2: d.y2 / H });

function pick(zone, opts = {}) {
  const z = n(zone);
  return pool
    .filter((d) => {
      const p = n(d);
      if (p.x1 < z.x1 || p.y1 < z.y1 || p.x2 > z.x2 || p.y2 > z.y2) return false;
      if (opts.classes && !opts.classes.includes(d.cls)) return false;
      const w = p.x2 - p.x1;
      const h = p.y2 - p.y1;
      if (opts.minW && w < opts.minW) return false;
      if (opts.maxW && w > opts.maxW) return false;
      if (opts.minH && h < opts.minH) return false;
      if (opts.maxH && h > opts.maxH) return false;
      return d.score >= (opts.minScore || MIN);
    })
    .sort((a, b) => b.score - a.score);
}

function firstWithNms(list, count, iouT = 0.5) {
  const keep = [];
  for (const d of list) {
    if (!keep.some((k) => iou(d, k) >= iouT)) keep.push(d);
    if (keep.length === count) break;
  }
  return keep;
}

function box(x1, y1, x2, y2) {
  return { x1, y1, x2, y2 };
}

const out = [];
const add = (d, label, zone) => out.push({ ...d, label, zone });

// 1) 3 footers
for (const d of firstWithNms(pick(box(0, 0.95 * H, W, H), { classes: ['footer'] }), 3)) add(d, 'PageFooter', 'footer');

// 2) barcode + numero + version
const barcode = pick(box(0.2 * W, 0, 0.8 * W, 0.045 * H), { classes: ['header', 'image', 'paragraph_title'], minW: 0.3 })[0];
if (barcode) add(barcode, 'Picture', 'barcode');

const barcodeText = pick(box(0.25 * W, 0.043 * H, 0.75 * W, 0.06 * H), { classes: ['text', 'header', 'paragraph_title', 'doc_title'], minW: 0.15, maxH: 0.03 })[0];
if (barcodeText) add(barcodeText, 'Text', 'barcode_text');

const version = pick(box(0.7 * W, 0, W, 0.065 * H), { classes: ['text', 'header'], maxW: 0.3, maxH: 0.04 })[0];
if (version) add(version, 'Text', 'version');

// 3) QR
const qr = pick(box(0, 0.05 * H, 0.35 * W, 0.15 * H), { classes: ['image'], minW: 0.1, minH: 0.05 })[0];
if (qr) add(qr, 'Picture', 'qr');

// 4) 3 lineas del titulo
const titleLines = firstWithNms(
  pick(box(0.25 * W, 0.055 * H, 0.75 * W, 0.14 * H), { classes: ['doc_title', 'paragraph_title', 'text'], minW: 0.2, maxH: 0.04 }),
  3
);
titleLines.forEach((d, i) => add(d, i === 0 ? 'SectionHeader' : 'Text', 'title'));

// 5) E-14
const e14 = pick(box(0.7 * W, 0.055 * H, 0.95 * W, 0.09 * H), { classes: ['text', 'image', 'header', 'doc_title'], minW: 0.1, maxW: 0.25, minH: 0.02, maxH: 0.05 })[0];
if (e14) add(e14, 'Text', 'e14');

// 6) logo Registraduria
const logo = pick(box(0.72 * W, 0.09 * H, 0.88 * W, 0.125 * H), { classes: ['image'], minW: 0.08, maxW: 0.2, minH: 0.02, maxH: 0.04 })[0];
if (logo) add(logo, 'Picture', 'registraduria_logo');

// 7) texto Registraduria
const regText = pick(box(0.7 * W, 0.118 * H, 0.92 * W, 0.14 * H), { classes: ['text', 'header'], minW: 0.12, maxH: 0.02 })[0];
if (regText) add(regText, 'Text', 'registraduria_text');

// 8) consulado
const consulado = pick(box(0.05 * W, 0.14 * H, 0.7 * W, 0.205 * H), { classes: ['text'], minW: 0.3, minH: 0.03 })[0];
if (consulado) add(consulado, 'Text', 'consulado');

// 9) linea X
const xline = pick(box(0.25 * W, 0.205 * H, 0.75 * W, 0.235 * H), { classes: ['figure_title', 'text', 'number'], minW: 0.25, maxH: 0.02 })[0];
if (xline) add(xline, 'Text', 'xline');

// 10) tablas nivelacion y votos
const nivel = pick(box(0.03 * W, 0.23 * H, 0.95 * W, 0.36 * H), { classes: ['table'], minW: 0.5 })[0];
if (nivel) add(nivel, 'Table', 'nivelacion');

const votos = pick(box(0.03 * W, 0.7 * H, 0.95 * W, 0.86 * H), { classes: ['table'], minW: 0.5 })[0];
if (votos) add(votos, 'Table', 'votos');

// 11) dos bloques de candidatos: usar el contenedor y partirlo por la plantilla
const container = pick(box(0.03 * W, 0.36 * H, 0.95 * W, 0.7 * H), {
  classes: ['image', 'table', 'content'],
  minW: 0.5,
  minH: 0.25
}).sort((a, b) => area(b) - area(a))[0];
if (container) {
  const cut = 0.544 * H;
  add({ ...box(container.x1, container.y1, container.x2, cut), score: container.score }, 'Table', 'candidato1');
  add({ ...box(container.x1, cut, container.x2, container.y2), score: container.score }, 'Table', 'candidato2');
}

function match(preds, gts, minIou = 0.5, minCont = 0.8) {
  const used = new Set();
  let tp = 0;
  const pairs = [];
  for (const p of [...preds].sort((a, b) => b.score - a.score)) {
    let best = null;
    for (let i = 0; i < gts.length; i++) {
      if (used.has(i)) continue;
      const g = gts[i];
      const v = iou(p, g);
      const c = containment(p, g);
      const ok = v >= minIou || c >= minCont;
      if (!ok) continue;
      if (!best || v > best.v) best = { i, v, c, g };
    }
    if (best) {
      used.add(best.i);
      tp++;
      pairs.push({ pred: p, gt: best.g, iou: +best.v.toFixed(2), cont: +best.c.toFixed(2) });
    }
  }
  const P = preds.length ? tp / preds.length : 0;
  const R = gts.length ? tp / gts.length : 0;
  return { tp, preds: preds.length, gt: gts.length, P: +P.toFixed(3), R: +R.toFixed(3), F1: +(P + R ? (2 * P * R) / (P + R) : 0).toFixed(3), pairs };
}

const stock = run.thrSweep.find((s) => s.threshold === Number(process.env.STOCK_T || 0.5)).dets;
const nms04 = runNms.thrSweep.find((s) => s.threshold === Number(process.env.NMS_T || 0.4)).dets;
const mStock = match(stock, gt);
const mNms = match(nms04, gt);
const mStruct = match(out, gt);

console.log('GT Chandra:', gt.length, 'bloques');
console.log('stock 0.5        ', JSON.stringify({ tp: mStock.tp, preds: mStock.preds, P: mStock.P, R: mStock.R, F1: mStock.F1 }));
console.log('0.4 + NMS (app)  ', JSON.stringify({ tp: mNms.tp, preds: mNms.preds, P: mNms.P, R: mNms.R, F1: mNms.F1 }));
console.log('estructura E-14  ', JSON.stringify({ tp: mStruct.tp, preds: mStruct.preds, P: mStruct.P, R: mStruct.R, F1: mStruct.F1 }));
console.log('\nSalida estructurada:');
for (const d of out) {
  const p = mStruct.pairs.find((x) => x.pred === d);
  console.log(
    (d.label + ' [' + d.zone + ']').padEnd(28),
    'score', d.score.toFixed(2),
    'IoU', p ? String(p.iou).padStart(4) : '  - ',
    'cont', p ? String(p.cont).padStart(4) : '  - ',
    p ? '-> ' + p.gt.type + ' | ' + p.gt.text : '-> SIN MATCH'
  );
}
const missing = gt.filter((g, i) => !mStruct.pairs.some((p) => p.gt === g));
console.log('\nGT sin match:', missing.map((g) => g.type + ' | ' + g.text).join(' || ') || 'ninguno');

fs.writeFileSync(process.env.OUT || 'estructura-e14-result.json', JSON.stringify({
  W, H, run: RUN, threshold: 0.2,
  metrics: { stock: mStock, nms04: mNms, structure: mStruct },
  boxes: out
}, null, 2));
