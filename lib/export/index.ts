import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

/** A flat table: the exportable view of any report (spec 12.18: CSV, Excel, PDF). */
export interface ExportColumn { key: string; label: string; width?: number; align?: "left" | "right" }
export interface ExportTable { title: string; subtitle?: string; columns: ExportColumn[]; rows: Record<string, string | number | null | undefined>[]; totals?: Record<string, string | number> }
export type ExportFormat = "csv" | "xlsx" | "pdf";

export interface ExportFile { buffer: Buffer; contentType: string; filename: string }

const safeName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export async function exportTable(table: ExportTable, format: ExportFormat): Promise<ExportFile> {
  const base = `${safeName(table.title)}-${new Date().toISOString().slice(0, 10)}`;
  if (format === "csv") return { buffer: Buffer.from(toCsv(table), "utf8"), contentType: "text/csv; charset=utf-8", filename: `${base}.csv` };
  if (format === "xlsx") return { buffer: await toXlsx(table), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", filename: `${base}.xlsx` };
  return { buffer: await toPdf(table), contentType: "application/pdf", filename: `${base}.pdf` };
}

function cell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, "\"\"")}"` : s;
}

export function toCsv(table: ExportTable): string {
  const lines = [table.columns.map((c) => cell(c.label)).join(",")];
  for (const r of table.rows) lines.push(table.columns.map((c) => cell(r[c.key])).join(","));
  if (table.totals) lines.push(table.columns.map((c) => cell(table.totals![c.key])).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n"; // BOM so Excel opens UTF-8 correctly
}

async function toXlsx(table: ExportTable): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "WorkPulse";
  const ws = wb.addWorksheet(table.title.slice(0, 31));
  ws.addRow([table.title]).font = { bold: true, size: 14 };
  if (table.subtitle) ws.addRow([table.subtitle]).font = { color: { argb: "FF64748B" } };
  ws.addRow([]);
  const header = ws.addRow(table.columns.map((c) => c.label));
  header.font = { bold: true };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF2FF" } };
  for (const r of table.rows) ws.addRow(table.columns.map((c) => r[c.key] ?? ""));
  if (table.totals) { const t = ws.addRow(table.columns.map((c) => table.totals![c.key] ?? "")); t.font = { bold: true }; }
  table.columns.forEach((c, i) => { const col = ws.getColumn(i + 1); col.width = c.width ?? Math.max(12, c.label.length + 4); if (c.align === "right") col.alignment = { horizontal: "right" }; });
  ws.views = [{ state: "frozen", ySplit: table.subtitle ? 4 : 3 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function toPdf(table: ExportTable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const landscape = table.columns.length > 6;
    const doc = new PDFDocument({ size: "A4", layout: landscape ? "landscape" : "portrait", margin: 36, info: { Title: table.title, Author: "WorkPulse" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width - 72;
    doc.fontSize(16).font("Helvetica-Bold").text(table.title);
    if (table.subtitle) doc.moveDown(0.2).fontSize(9).font("Helvetica").fillColor("#64748b").text(table.subtitle).fillColor("#000000");
    doc.moveDown(0.8);

    const weights = table.columns.map((c) => c.width ?? Math.max(8, c.label.length));
    const totalW = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((w) => (w / totalW) * pageWidth);
    const rowH = 16;
    let y = doc.y;

    const drawRow = (values: (string | number | null | undefined)[], bold = false, shade = false) => {
      if (y + rowH > doc.page.height - 36) { doc.addPage(); y = 36; drawHeader(); }
      if (shade) doc.rect(36, y, pageWidth, rowH).fill("#f1f5f9").fillColor("#000000");
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8);
      let x = 36;
      values.forEach((v, i) => {
        doc.text(v === null || v === undefined ? "" : String(v), x + 3, y + 4, { width: widths[i] - 6, height: rowH, ellipsis: true, lineBreak: false, align: table.columns[i].align ?? "left" });
        x += widths[i];
      });
      y += rowH;
    };
    const drawHeader = () => { drawRow(table.columns.map((c) => c.label), true, true); doc.moveTo(36, y).lineTo(36 + pageWidth, y).strokeColor("#cbd5e1").stroke(); };
    drawHeader();
    table.rows.forEach((r, i) => drawRow(table.columns.map((c) => r[c.key]), false, i % 2 === 1));
    if (table.totals) { doc.moveTo(36, y).lineTo(36 + pageWidth, y).strokeColor("#94a3b8").stroke(); drawRow(table.columns.map((c) => table.totals![c.key]), true); }
    doc.fontSize(7).fillColor("#94a3b8").text(`Generated by WorkPulse on ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`, 36, doc.page.height - 30, { lineBreak: false });
    doc.end();
  });
}
