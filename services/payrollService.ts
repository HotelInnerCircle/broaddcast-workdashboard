import { Types } from "mongoose";
import { scoped } from "@/lib/db/scoped";
import { Errors } from "@/lib/api/errors";
import { audit } from "@/lib/audit";
import { storage } from "@/lib/storage";
import { SalaryStructure } from "@/models/SalaryStructure";
import { Payslip } from "@/models/Payslip";
import { User } from "@/models/User";
import { Company } from "@/models/Company";
import { LeaveRequest } from "@/models/LeaveRequest";
import { attendanceLedger } from "./ledgerService";
import { periodFor } from "./payslipService";
import { employeeScopeFilter, requireVisibleEmployee } from "./scope";
import { computePayslip, grossOf, type ManualAdjustments, type SalaryScale, type StatutoryRules } from "@/lib/payroll/compute";
import { renderPayslipPdf, type PayslipHeader } from "@/lib/payroll/payslip-pdf";
import { formatDate } from "@/lib/utils/dates";
import { LEAVE_TYPE_LABEL, type LeaveType } from "@/types";
import type { CompanyContext } from "@/lib/auth/context";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

const scaleOf = (d: Record<string, unknown> | null): SalaryScale => ({
  basic: num(d?.basic), hra: num(d?.hra), conveyance: num(d?.conveyance), lta: num(d?.lta), special: num(d?.special),
});

/** The statutory rules as this company has them set. */
async function rulesFor(companyId: string): Promise<StatutoryRules & { establishmentName: string; address: string | null }> {
  const c = await Company.findById(companyId).select("name payroll").lean();
  const p = (c?.payroll ?? {}) as Record<string, unknown>;
  return {
    pf: { enabled: p.pfEnabled !== false, employeeRate: num(p.pfEmployeeRate) || 12, wageCeiling: num(p.pfWageCeiling) || 15_000 },
    esi: { enabled: p.esiEnabled !== false, employeeRate: num(p.esiEmployeeRate) || 0.75, wageLimit: num(p.esiWageLimit) || 21_000 },
    professionalTax: { amount: num(p.professionalTax), minGross: num(p.professionalTaxMinGross) },
    establishmentName: (p.establishmentName as string | null) ?? (c?.name as string) ?? "",
    address: (p.address as string | null) ?? null,
  };
}

/**
 * The scale in force on a given day.
 *
 * The latest structure that started on or before that day - never simply the
 * newest one. A raise dated next month must not change this month's payslip,
 * which is the entire reason these rows are effective-dated.
 */
export async function scaleOn(ctx: CompanyContext, userId: Types.ObjectId | string, day: string) {
  const rows = await scoped(SalaryStructure, ctx)
    .find({ userId: new Types.ObjectId(String(userId)), effectiveFrom: { $lte: day } })
    .sort({ effectiveFrom: -1 }).limit(1).lean();
  return rows[0] ?? null;
}

/** Every scale ever set for a person, newest first. */
export async function salaryHistory(ctx: CompanyContext, userId: string) {
  const id = await requireVisibleEmployee(ctx, userId);
  const rows = await scoped(SalaryStructure, ctx).find({ userId: id }).sort({ effectiveFrom: -1 }).lean();
  return rows.map((r) => ({
    id: String(r._id),
    effectiveFrom: r.effectiveFrom as string,
    ...scaleOf(r as Record<string, unknown>),
    gross: grossOf(scaleOf(r as Record<string, unknown>)),
    note: (r.note as string | null) ?? null,
  }));
}

/** Everybody in scope with the scale they are on today, for the salaries screen. */
export async function salaryRegister(ctx: CompanyContext) {
  const today = new Date().toISOString().slice(0, 10);
  const scope = await employeeScopeFilter(ctx);
  const people = await scoped(User, ctx)
    .find({ $and: [scope, { archivedAt: null, status: { $ne: "deactivated" } }] } as never)
    .select("name employeeCode designation department payrollProfile").sort({ name: 1 }).lean();

  const structures = await scoped(SalaryStructure, ctx).find({ effectiveFrom: { $lte: today } }).sort({ effectiveFrom: 1 }).lean();
  // Later rows overwrite earlier ones, leaving the one in force today.
  const current = new Map<string, Record<string, unknown>>();
  for (const s of structures) current.set(String(s.userId), s as Record<string, unknown>);

  const rows = people.map((u) => {
    const s = current.get(String(u._id));
    const scale = s ? scaleOf(s) : null;
    const bank = (u.payrollProfile ?? {}) as Record<string, unknown>;
    return {
      userId: String(u._id),
      userName: u.name as string,
      employeeCode: (u.employeeCode as string | null) ?? null,
      designation: (u.designation as string | null) ?? null,
      scale,
      gross: scale ? grossOf(scale) : null,
      effectiveFrom: s ? (s.effectiveFrom as string) : null,
      hasBank: Boolean(bank.bankAccount),
    };
  });
  return { rows, withSalary: rows.filter((r) => r.scale).length, total: rows.length };
}

export async function setSalary(
  ctx: CompanyContext,
  input: { userId: string; effectiveFrom: string; basic: number; hra?: number; conveyance?: number; lta?: number; special?: number; note?: string | null },
  ip: string | null,
) {
  const id = await requireVisibleEmployee(ctx, input.userId);
  const user = await scoped(User, ctx).findOne({ _id: id, archivedAt: null }).select("name").lean();
  if (!user) throw Errors.notFound("Employee");

  const scale: SalaryScale = {
    basic: num(input.basic), hra: num(input.hra), conveyance: num(input.conveyance),
    lta: num(input.lta), special: num(input.special),
  };
  if (grossOf(scale) <= 0) throw Errors.bad("EMPTY_SALARY", "A salary needs at least one amount on it");

  const existing = await scoped(SalaryStructure, ctx).findOne({ userId: id, effectiveFrom: input.effectiveFrom });
  const doc = existing ?? new SalaryStructure({ companyId: new Types.ObjectId(ctx.companyId), userId: id, effectiveFrom: input.effectiveFrom });
  doc.set({ ...scale, note: input.note ?? null, createdBy: new Types.ObjectId(ctx.userId) });
  await doc.save();

  await audit({
    ctx, companyId: ctx.companyId, entity: "salary", entityId: doc._id,
    action: existing ? "salary.updated" : "salary.set",
    summary: `${ctx.name} set ${user.name}'s salary to ${grossOf(scale).toLocaleString("en-IN")} a month from ${input.effectiveFrom}`,
    after: { ...scale, effectiveFrom: input.effectiveFrom }, ip,
  });
  return { id: String(doc._id), effectiveFrom: input.effectiveFrom, ...scale, gross: grossOf(scale) };
}

export async function deleteSalary(ctx: CompanyContext, id: string, ip: string | null) {
  const row = await scoped(SalaryStructure, ctx).findOne({
    _id: Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : new Types.ObjectId(),
  }).lean();
  if (!row) throw Errors.notFound("Salary");
  await scoped(SalaryStructure, ctx).deleteOne({ _id: row._id } as never);
  await audit({
    ctx, companyId: ctx.companyId, entity: "salary", entityId: row._id, action: "salary.deleted",
    summary: `${ctx.name} removed a salary record effective ${row.effectiveFrom}`, before: { effectiveFrom: row.effectiveFrom }, ip,
  });
  return { deleted: true };
}

/** Leave taken and left, for the two lines at the foot of the slip. */
async function leaveLines(ctx: CompanyContext, userId: Types.ObjectId, from: string, to: string) {
  const taken = await scoped(LeaveRequest, ctx)
    .find({ userId, status: "APPROVED", startDate: { $lte: to }, endDate: { $gte: from } })
    .select("type days").lean();
  const byType = new Map<string, number>();
  for (const l of taken) byType.set(l.type as string, (byType.get(l.type as string) ?? 0) + num(l.days));
  const availed = [...byType.entries()].map(([t, n]) => `${LEAVE_TYPE_LABEL[t as LeaveType] ?? t} : ${n}`).join(" | ");
  return availed || null;
}

/**
 * Work out and store one person's payslip for one month, and render the PDF.
 *
 * The figures come from three places that must agree: the scale in force on the
 * last day of the period, the attendance ledger for the same days, and the
 * company's statutory rules. Nothing is counted twice - the ledger is asked, not
 * recomputed, which is why `payableDays` exists there.
 */
export async function generatePayslip(
  ctx: CompanyContext,
  input: { userId: string; month?: string; adjustments?: Partial<ManualAdjustments>; publish?: boolean },
  ip: string | null,
) {
  const id = await requireVisibleEmployee(ctx, input.userId);
  const period = await periodFor(ctx, input.month);
  const user = await scoped(User, ctx).findOne({ _id: id, archivedAt: null })
    .select("name employeeCode designation department branch joiningDate createdAt payrollProfile").lean();
  if (!user) throw Errors.notFound("Employee");

  const structure = await scaleOn(ctx, id, period.to);
  if (!structure) {
    throw Errors.bad("NO_SALARY", `${user.name} has no salary set. Add one before generating a payslip.`);
  }

  const [ledger, rules] = await Promise.all([
    attendanceLedger(ctx, String(id), period.key),
    rulesFor(ctx.companyId),
  ]);

  const kept = (existing: Record<string, unknown> | null | undefined): ManualAdjustments => {
    const a = (existing ?? {}) as Partial<ManualAdjustments>;
    return {
      tds: num(input.adjustments?.tds ?? a.tds),
      latePenalty: num(input.adjustments?.latePenalty ?? a.latePenalty),
      advance: num(input.adjustments?.advance ?? a.advance),
      otherEarnings: num(input.adjustments?.otherEarnings ?? a.otherEarnings),
      otherEarningsLabel: input.adjustments?.otherEarningsLabel ?? a.otherEarningsLabel ?? null,
    };
  };

  const existing = await scoped(Payslip, ctx).findOne({ userId: id, period: period.key });
  const adjustments = kept(existing?.adjustments as Record<string, unknown> | null);

  const totalDays = ledger.days.length;
  const computation = computePayslip(
    scaleOf(structure as Record<string, unknown>),
    {
      totalDays,
      paidDays: ledger.summary.payableDays,
      lossOfPayDays: ledger.summary.lossOfPay,
      holidays: ledger.summary.holidays,
    },
    rules,
    adjustments,
  );

  const pp = (user.payrollProfile ?? {}) as Record<string, string | null>;
  const header: PayslipHeader = {
    monthLabel: new Date(`${period.key}-15T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }),
    periodLabel: period.label,
    establishment: rules.establishmentName,
    address: rules.address,
    employeeName: user.name as string,
    employeeCode: (user.employeeCode as string | null) ?? null,
    referenceNumber: pp.referenceNumber ?? null,
    fatherOrHusbandName: pp.fatherOrHusbandName ?? null,
    joiningDate: formatDate((user.joiningDate ?? user.createdAt) as Date | null),
    branch: (user.branch as string | null) ?? null,
    designation: (user.designation as string | null) ?? null,
    department: (user.department as string | null) ?? null,
    pfNumber: pp.pfNumber ?? null,
    esiNumber: pp.esiNumber ?? null,
    uan: pp.uan ?? null,
    pan: pp.pan ?? null,
    bankName: pp.bankName ?? null,
    bankIfsc: pp.bankIfsc ?? null,
    bankAccount: pp.bankAccount ?? null,
    paymentMode: pp.paymentMode ?? "Savings Account",
    leaveAvailed: await leaveLines(ctx, id, period.from, period.to),
    leaveBalance: null,
  };

  const pdf = await renderPayslipPdf(header, computation);
  const key = `companies/${ctx.companyId}/payslips/${period.key}/${id}-${Date.now()}.pdf`;
  await storage().put({ key, body: pdf, contentType: "application/pdf" });
  const previousKey = existing?.fileKey as string | undefined;

  const doc = existing ?? new Payslip({ companyId: new Types.ObjectId(ctx.companyId), userId: id, period: period.key });
  doc.set({
    from: period.from, to: period.to,
    fileKey: key, fileName: `payslip-${period.key}.pdf`, fileSize: pdf.length, contentType: "application/pdf",
    netPay: computation.net, source: "generated", computation, adjustments,
    uploadedBy: new Types.ObjectId(ctx.userId),
    publishedAt: input.publish === false ? null : (existing?.publishedAt ?? new Date()),
  });
  await doc.save();
  if (previousKey && previousKey !== key) await storage().delete(previousKey).catch(() => {});

  await audit({
    ctx, companyId: ctx.companyId, entity: "payslip", entityId: doc._id,
    action: existing ? "payslip.regenerated" : "payslip.generated",
    summary: `${ctx.name} generated ${user.name}'s payslip for ${period.label} - net ${computation.net.toLocaleString("en-IN")}`,
    after: { period: period.key, net: computation.net, paidDays: computation.attendance.paidDays }, ip,
  });

  return {
    id: String(doc._id), userId: String(id), userName: user.name as string,
    period: period.key, from: period.from, to: period.to,
    net: computation.net, paidDays: computation.attendance.paidDays, totalDays,
    incomplete: incompleteWarning(period.to, ledger.joinedOn, period.from),
    computation,
  };
}

/**
 * Why this payslip might be for less than a full month.
 *
 * Days that have not happened yet are not payable days, so **running payroll
 * before the period ends prorates everybody down to the days so far** - a
 * fortnight into the month, everyone is paid half. The figures are right and the
 * mistake is invisible on the payslip itself, which is what makes it dangerous.
 * The run says so rather than leaving it to be noticed on payday.
 */
function incompleteWarning(periodTo: string, joinedOn: string, periodFrom: string): string | null {
  const today = new Date().toISOString().slice(0, 10);
  if (periodTo >= today) {
    return `This period runs to ${periodTo} and has not finished. Days still to come do not count as paid, so the amounts are for the days so far.`;
  }
  if (joinedOn > periodFrom) return `They joined on ${joinedOn}, part way through this period.`;
  return null;
}

/** Generate for everybody who has a salary set. Returns what happened to each. */
export async function generateAll(ctx: CompanyContext, month: string | undefined, ip: string | null) {
  const register = await salaryRegister(ctx);
  const results: Array<{ userId: string; userName: string; ok: boolean; net?: number; reason?: string; incomplete?: string | null }> = [];
  // One at a time on purpose: each run reads a ledger and writes a PDF, and a
  // burst of those in parallel is how a payroll run times out halfway through.
  for (const row of register.rows) {
    if (!row.scale) { results.push({ userId: row.userId, userName: row.userName, ok: false, reason: "No salary set" }); continue; }
    try {
      const r = await generatePayslip(ctx, { userId: row.userId, month }, ip);
      results.push({ userId: row.userId, userName: row.userName, ok: true, net: r.net, incomplete: r.incomplete });
    } catch (e) {
      results.push({ userId: row.userId, userName: row.userName, ok: false, reason: e instanceof Error ? e.message : "Failed" });
    }
  }
  return { generated: results.filter((r) => r.ok).length, skipped: results.filter((r) => !r.ok).length, results };
}
