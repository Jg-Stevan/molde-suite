// Exportación a PDF (Bloque 2.6): UNA página por documento o consolidado
// multipágina. jspdf ÚNICAMENTE (sin fflate, sin ZIP — decisión de alcance).
// Las fotos viajan como dataURL (JPEG/PNG detectado del prefijo); A4 vertical.

import { jsPDF } from "jspdf";
import type { ActaStatus } from "@molde-suite/scanner-core/dominio/types";

/** Descarga de blobs (flujos "guardar como"). */
export function downloadBlob(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export interface DocPdf {
  titulo: string;
  estado: string;
  score: number | null;
  /** dataURL JPEG/PNG del documento (procesada; cae a original). */
  foto: string | null;
  hora?: string | null;
  qr?: string | null;
}

const A4_W = 595.28;
const A4_H = 841.89;
const MARGEN = 36;

function formatoDe(dataUrl: string): "JPEG" | "PNG" {
  return /^data:image\/png/i.test(dataUrl) ? "PNG" : "JPEG";
}

function cabecera(doc: jsPDF, d: DocPdf, indice: number, total: number): number {
  const y = MARGEN;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(String(d.titulo || "DOCUMENTO").slice(0, 60), MARGEN, y + 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const meta = [
    d.estado,
    d.score != null ? `score ${d.score.toFixed(1)}/10` : null,
    d.hora ?? null,
    total > 1 ? `doc ${indice + 1}/${total}` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");
  doc.setTextColor(90);
  doc.text(meta, MARGEN, y + 26);
  doc.setTextColor(0);
  doc.setDrawColor(200);
  doc.line(MARGEN, y + 34, A4_W - MARGEN, y + 34);
  return y + 44;
}

function paginaDe(doc: jsPDF, d: DocPdf, indice: number, total: number): void {
  let y = cabecera(doc, d, indice, total);
  const ancho = A4_W - MARGEN * 2;
  if (d.foto) {
    // Aspecto real cuando hay DOM (naturalWidth); en Node/tests (sin Image)
    // el fallback 3/4 mantiene el addImage dentro de la página.
    let iw = 1536;
    let ih = 2048;
    if (typeof Image !== "undefined") {
      const img = new Image();
      img.src = d.foto;
      iw = img.naturalWidth || 1536;
      ih = img.naturalHeight || 2048;
    }
    const h = Math.min(A4_H - y - MARGEN, (ancho * ih) / iw);
    try {
      doc.addImage(d.foto, formatoDe(d.foto), MARGEN, y, ancho, h, undefined, "FAST");
      y += h + 8;
    } catch {
      doc.setFontSize(9);
      doc.text("[imagen no exportable]", MARGEN, y + 10);
      y += 16;
    }
  }
  if (d.qr) {
    doc.setFontSize(9);
    doc.text(`QR/código: ${String(d.qr).slice(0, 120)}`, MARGEN, Math.min(y + 10, A4_H - MARGEN));
  }
}

/** PDF de UN documento (1 página). */
export function pdfDeActa(d: DocPdf): Blob {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  paginaDe(doc, d, 0, 1);
  return doc.output("blob");
}

/** PDF CONSOLIDADO — una página por documento (multipágina). */
export function pdfConsolidadoDeActas(docs: DocPdf[]): Blob {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const total = Math.max(1, docs.length);
  docs.forEach((d, i) => {
    if (i > 0) doc.addPage();
    paginaDe(doc, d, i, total);
  });
  return doc.output("blob");
}

/** Nombre honesto de archivo. */
export function nombrePdf(n: number, titulo: string): string {
  const base = (titulo || "documentos").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24);
  return n === 1 ? `${base}.pdf` : `${base}-${n}-paginas.pdf`;
}

export type { ActaStatus };
