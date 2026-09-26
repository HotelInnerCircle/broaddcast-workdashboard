import PDFDocument from "pdfkit";
import type { PayslipComputation } from "./compute";

/**
 * The payslip as a PDF, laid out like the one the company already issues.
 *
 * Matched to an existing slip rather than designed fresh, deliberately: people
 * have been reading this layout for years and know where to look for their net
 * pay. A "better" arrangement would mostly generate questions.
 *
 * Boxes are drawn by hand because the layout is a grid of labelled cells rather
 * than a table - a left and a right column of details, then three columns of
 * scale, attendance, earnings and deductions side by side.
 */

export interface PayslipHeader {
  monthLabel: string;
  periodLabel: string;
  establishment: string;
  address: string | null;
  employeeName: string;
  employeeCode: string | null;
  referenceNumber: string | null;
  fatherOrHusbandName: string | null;
  joiningDate: string | null;
  branch: string | null;
  designation: string | null;
  department: string | null;
  pfNumber: string | null;
  esiNumber: string | null;
  uan: string | null;
  pan: string | null;
  bankName: string | null;
  bankIfsc: string | null;
  bankAccount: string | null;
  paymentMode: string | null;
  leaveAvailed: string | null;
  leaveBalance: string | null;
}

const money = (n: number) => n.toLocaleString("en-IN");

export function renderPayslipPdf(header: PayslipHeader, c: PayslipComputation): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 28, info: { Title: `Payslip ${header.monthLabel}`, Author: header.establishment } });
    const chunks: Buffer[] = [];
    doc.on("data", (d: Buffer) => chunks.push(d));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const L = 28;
    const W = doc.page.width - 56;
    const R = L + W;
    let y = L;

    const line = (yy: number) => doc.moveTo(L, yy).lineTo(R, yy).lineWidth(0.7).strokeColor("#000000").stroke();
    const vline = (x: number, y1: number, y2: number) => doc.moveTo(x, y1).lineTo(x, y2).lineWidth(0.7).strokeColor("#000000").stroke();
    const text = (s: string, x: number, yy: number, w: number, opts: { bold?: boolean; size?: number; align?: "left" | "right" | "center" } = {}) => {
      doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(opts.size ?? 8.5).fillColor("#000000");
      doc.text(s, x + 3, yy + 3.5, { width: w - 6, align: opts.align ?? "left", lineBreak: false, ellipsis: true });
    };

    /* ---------------- title ---------------- */
    doc.rect(L, y, W, 34).lineWidth(0.7).strokeColor("#000000").stroke();
    doc.font("Helvetica").fontSize(12).text("Pay Slip for the month of : ", L + 4, y + 5, { continued: true, lineBreak: false });
    doc.font("Helvetica-Bold").text(header.monthLabel);
    doc.font("Helvetica").fontSize(11).text(`Name of Establishment : ${header.establishment}`, L + 4, y + 20, { width: W - 8, lineBreak: false, ellipsis: true });
    y += 34;

    doc.rect(L, y, W, 14).stroke();
    text(`Address: ${header.address ?? "-"}`, L, y, W, { size: 8 });
    y += 14;

    /* ---------------- who this is ---------------- */
    const rows: Array<[string, string, string, string]> = [
      ["Employee Name:", header.employeeName, "ID #:", header.employeeCode ?? "-"],
      ["DOJ :", header.joiningDate ?? "-", "REF #:", header.referenceNumber ?? "-"],
      ["F/H Name:", header.fatherOrHusbandName ?? "-", "P.F. #:", header.pfNumber ?? "-"],
      ["Branch:", header.branch ?? "-", "ESI #:", header.esiNumber ?? "-"],
      ["Designation:", header.designation ?? "-", "UAN #:", header.uan ?? "-"],
      ["Department:", header.department ?? "-", "PAN #:", header.pan ?? "-"],
      ["Bank Name:", header.bankName ?? "-", "IFSC #:", header.bankIfsc ?? "-"],
      ["Mode of Payment:", header.paymentMode ?? "-", "Account #:", header.bankAccount ?? "-"],
    ];
    const c1 = L + 118;           // label | value
    const c2 = L + W * 0.62;      // right-hand label
    const c3 = c2 + 72;
    for (const [k, v, k2, v2] of rows) {
      doc.rect(L, y, W, 14).stroke();
      vline(c1, y, y + 14); vline(c2, y, y + 14); vline(c3, y, y + 14);
      text(k, L, y, c1 - L);
      text(v, c1, y, c2 - c1);
      text(k2, c2, y, c3 - c2);
      text(v2, c3, y, R - c3);
      y += 14;
    }

    /* ---------------- the four columns ---------------- */
    const colScale = L + W * 0.25;
    const colAtt = L + W * 0.42;
    const colEarn = L + W * 0.72;
    doc.rect(L, y, W, 14).stroke();
    vline(colScale, y, y + 14); vline(colAtt, y, y + 14); vline(colEarn, y, y + 14);
    text("Scale", L, y, colScale - L, { bold: true, align: "center" });
    text("Attendance", colScale, y, colAtt - colScale, { bold: true, align: "center" });
    text("Earnings", colAtt, y, colEarn - colAtt, { bold: true, align: "center" });
    text("Deductions", colEarn, y, R - colEarn, { bold: true, align: "center" });
    y += 14;

    const scaleRows: Array<[string, number]> = [
      ["FULL BASIC", c.scale.basic], ["FULL HRA", c.scale.hra],
      ["Conveyance Allowance", c.scale.conveyance], ["LTA ALLOWANCE", c.scale.lta],
    ];
    if (c.scale.special) scaleRows.push(["SPECIAL ALLOWANCE", c.scale.special]);
    scaleRows.push(["GROSS", c.scale.gross]);

    const attRows: Array<[string, number]> = [
      ["Working Days", c.attendance.totalDays],
      ["Holiday", c.attendance.holidays],
    ];
    if (c.attendance.lossOfPayDays) attRows.push(["Loss of Pay", c.attendance.lossOfPayDays]);

    const earnRows: Array<[string, number]> = [
      ["BASIC", c.earnings.basic], ["HRA", c.earnings.hra],
      ["CONVEYANCE ALLOWANCE", c.earnings.conveyance], ["LTA ALLOWANCE", c.earnings.lta],
    ];
    if (c.earnings.special) earnRows.push(["SPECIAL ALLOWANCE", c.earnings.special]);
    if (c.earnings.other) earnRows.push(["OTHER / ARREARS", c.earnings.other]);

    const dedRows: Array<[string, number]> = [
      ["ESI", c.deductions.esi], ["EPF", c.deductions.epf], ["PTAX", c.deductions.professionalTax],
      ["T.D.S", c.deductions.tds], ["LATE PENALTY", c.deductions.latePenalty], ["Advance", c.deductions.advance],
    ];

    const bodyRows = Math.max(scaleRows.length, attRows.length, earnRows.length, dedRows.length);
    const rowH = 13;
    const bodyTop = y;
    for (let i = 0; i < bodyRows; i++) {
      const s = scaleRows[i], a = attRows[i], e = earnRows[i], d = dedRows[i];
      const bold = s?.[0] === "GROSS";
      if (s) { text(s[0], L, y, (colScale - L) * 0.68, { bold, size: 7.5 }); text(money(s[1]), L + (colScale - L) * 0.6, y, (colScale - L) * 0.4 - 3, { bold, align: "right" }); }
      if (a) { text(a[0], colScale, y, (colAtt - colScale) * 0.7, { size: 8 }); text(String(a[1]), colScale + (colAtt - colScale) * 0.6, y, (colAtt - colScale) * 0.4 - 3, { align: "right" }); }
      if (e) { text(e[0], colAtt, y, (colEarn - colAtt) * 0.72, { size: 8 }); text(money(e[1]), colAtt + (colEarn - colAtt) * 0.6, y, (colEarn - colAtt) * 0.4 - 3, { align: "right" }); }
      if (d) { text(d[0], colEarn, y, (R - colEarn) * 0.62, { size: 8 }); text(money(d[1]), colEarn + (R - colEarn) * 0.55, y, (R - colEarn) * 0.45 - 3, { align: "right" }); }
      y += rowH;
    }
    doc.rect(L, bodyTop, W, y - bodyTop).stroke();
    vline(colScale, bodyTop, y); vline(colAtt, bodyTop, y); vline(colEarn, bodyTop, y);

    /* ---------------- totals ---------------- */
    doc.rect(L, y, W, 15).stroke();
    vline(colScale, y, y + 15); vline(colAtt, y, y + 15); vline(colEarn, y, y + 15);
    text("PD", L, y, 40, { bold: true });
    text(String(c.attendance.paidDays), colScale - 46, y, 40, { bold: true, align: "right" });
    text("Total Earned:", colAtt, y, (colEarn - colAtt) * 0.62, { bold: true, align: "right" });
    text(money(c.earnings.total), colAtt + (colEarn - colAtt) * 0.6, y, (colEarn - colAtt) * 0.4 - 3, { bold: true, align: "right" });
    text(`Total Deductions: ${money(c.deductions.total)}`, colEarn, y, R - colEarn, { bold: true, align: "right" });
    y += 15;

    const band = (s: string, bold = true, size = 9.5) => {
      doc.rect(L, y, W, 15).stroke();
      text(s, L, y, W, { bold, align: "center", size });
      y += 15;
    };
    band(`Net Payment: Rs ${money(c.net)}`, true, 10);
    band(`In Words: ${c.netInWords}`);
    if (header.leaveAvailed) band(`Leave Availed ${header.leaveAvailed}`);
    if (header.leaveBalance) band(`Leave Balance ${header.leaveBalance}`);
    band("Note : This is a computer generated statement & does not require signature.", false, 8);

    // The days the month covered, so a 26th-to-25th cycle is not a mystery.
    doc.font("Helvetica").fontSize(7).fillColor("#555555")
      .text(`Pay period: ${header.periodLabel}`, L, y + 4, { width: W, align: "center", lineBreak: false });

    doc.end();
  });
}
