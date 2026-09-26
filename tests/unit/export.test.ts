/**
 * The export library: CSV, Excel and PDF of a report table.
 *
 * These matter because an export is read once, elsewhere, by somebody who cannot
 * see the screen it came from. A quoting bug does not throw - it produces a file
 * that opens, looks plausible, and has the columns shifted by one from the first
 * comma onwards.
 *
 * The `sections` support exists so the employee report can carry what people
 * actually wrote alongside the summary of counts: its own sheet in Excel, its own
 * block in the CSV.
 */
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { exportTable, toCsv, type ExportTable } from "@/lib/export";

const table: ExportTable = {
  title: "Employee report",
  subtitle: "2026-09-01 to 2026-09-26",
  columns: [
    { key: "name", label: "Employee", width: 20 },
    { key: "hours", label: "Tracked hours", width: 10, align: "right" },
  ],
  rows: [
    { name: "Satheesh Reddy", hours: 6.5 },
    { name: "Priya Nair", hours: 4 },
  ],
  totals: { name: "Total", hours: 10.5 },
  sections: [{
    title: "Submissions",
    columns: [
      { key: "date", label: "Date", width: 12 },
      { key: "name", label: "Employee", width: 20 },
      { key: "completed", label: "Daily report", width: 60 },
    ],
    rows: [
      { date: "2026-09-26", name: "Satheesh Reddy", completed: "Finished the AUDI drawings, started NEXA" },
      { date: "2026-09-25", name: "Priya Nair", completed: 'Said "done" and meant it' },
    ],
  }],
};

describe("CSV", () => {
  const csv = toCsv(table);

  it("starts with a BOM, so Excel reads it as UTF-8", () => {
    expect(csv.startsWith("﻿")).toBe(true);
  });

  it("writes the headings, the rows and the totals", () => {
    expect(csv).toContain("Employee,Tracked hours");
    expect(csv).toContain("Satheesh Reddy,6.5");
    expect(csv).toContain("Total,10.5");
  });

  it("quotes a value containing a comma, so the columns do not shift", () => {
    // Without the quotes this row would have four fields instead of three and
    // every column after it would be wrong - silently.
    expect(csv).toContain('"Finished the AUDI drawings, started NEXA"');
  });

  it("doubles a quote inside a value", () => {
    expect(csv).toContain('"Said ""done"" and meant it"');
  });

  it("puts the section under its own heading and header row", () => {
    const [summary, submissions] = csv.split("Submissions");
    expect(summary).toContain("Satheesh Reddy,6.5");
    expect(submissions).toContain("Date,Employee,Daily report");
    expect(submissions).toContain("2026-09-26");
  });

  it("leaves the rows intact when a section is absent", () => {
    const csvNoSections = toCsv({ ...table, sections: undefined });
    expect(csvNoSections).not.toContain("Submissions");
    expect(csvNoSections).toContain("Total,10.5");
  });
});

describe("Excel", () => {
  it("puts each section on its own sheet", async () => {
    const file = await exportTable(table, "xlsx");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Employee report", "Submissions"]);
  });

  it("writes the section's rows, prose and all", async () => {
    const file = await exportTable(table, "xlsx");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    const sheet = wb.getWorksheet("Submissions")!;
    // Row 1 is the header.
    expect(sheet.getRow(2).getCell(3).value).toBe("Finished the AUDI drawings, started NEXA");
    expect(sheet.getRow(3).getCell(2).value).toBe("Priya Nair");
  });

  it("names the file after the report and the day", async () => {
    const file = await exportTable(table, "xlsx");
    expect(file.filename).toMatch(/^employee-report-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(file.contentType).toContain("spreadsheetml");
  });

  it("makes only one sheet when there are no sections", async () => {
    const file = await exportTable({ ...table, sections: undefined }, "xlsx");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    expect(wb.worksheets).toHaveLength(1);
  });
});

describe("PDF", () => {
  it("produces a PDF that carries the sections too", async () => {
    const withSections = await exportTable(table, "pdf");
    expect(withSections.buffer.subarray(0, 4).toString()).toBe("%PDF");
    expect(withSections.filename).toMatch(/\.pdf$/);

    // The section is drawn on its own page, so the document is bigger than the
    // summary alone. A section that quietly rendered nothing would not be.
    const without = await exportTable({ ...table, sections: undefined }, "pdf");
    expect(withSections.buffer.length).toBeGreaterThan(without.buffer.length);
  });
});
