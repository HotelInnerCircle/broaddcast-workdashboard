import { Types } from "mongoose";
import { scoped, pop } from "@/lib/db/scoped";
import { Errors } from "@/lib/api/errors";
import { audit } from "@/lib/audit";
import { storage } from "@/lib/storage";
import { Payslip } from "@/models/Payslip";
import { User } from "@/models/User";
import { Company } from "@/models/Company";
import { payrollPeriod, payrollMonthOf, type PayrollPeriod } from "@/lib/time/payroll-period";
import { companyClock } from "@/lib/time/company-clock";
import { employeeScopeFilter, requireVisibleEmployee } from "./scope";
import type { CompanyContext } from "@/lib/auth/context";

export interface PayslipRow {
  id: string;
  userId: string;
  userName: string;
  employeeCode: string | null;
  period: string;
  from: string;
  to: string;
  fileName: string;
  fileSize: number;
  netPay: number | null;
  note: string | null;
  uploadedAt: string;
  publishedAt: string | null;
}

/** The company's payroll cycle, and the period a given month covers. */
export async function periodFor(ctx: CompanyContext, month?: string): Promise<PayrollPeriod & { startDay: number }> {
  const company = await Company.findById(ctx.companyId).select("payrollStartDay").lean();
  const startDay = (company?.payrollStartDay as number | undefined) ?? 1;
  const clock = await companyClock(ctx.companyId);
  const key = month ?? payrollMonthOf(startDay, clock.dayOf(new Date()));
  return { ...payrollPeriod(startDay, key), startDay };
}

const serialize = (p: Record<string, unknown>, name: string, code: string | null): PayslipRow => ({
  id: String(p._id),
  userId: String(p.userId),
  userName: name,
  employeeCode: code,
  period: p.period as string,
  from: p.from as string,
  to: p.to as string,
  fileName: p.fileName as string,
  fileSize: p.fileSize as number,
  netPay: (p.netPay as number | null) ?? null,
  note: (p.note as string | null) ?? null,
  uploadedAt: new Date(p.createdAt as string).toISOString(),
  publishedAt: p.publishedAt ? new Date(p.publishedAt as string).toISOString() : null,
});

/**
 * Everyone in scope for a payroll month, with their payslip if they have one.
 *
 * Deliberately returns the people *without* one too. "Who is still missing a
 * payslip" is the question this screen exists to answer on the 30th of the
 * month, and a list of only the uploaded ones cannot answer it.
 */
export async function payslipRegister(ctx: CompanyContext, month?: string) {
  const period = await periodFor(ctx, month);
  const scope = await employeeScopeFilter(ctx);
  const people = await scoped(User, ctx)
    .find({ $and: [scope, { archivedAt: null, status: { $ne: "deactivated" } }] } as never)
    .select("name employeeCode").sort({ name: 1 }).lean();

  const slips = await scoped(Payslip, ctx).find({ period: period.key }).lean();
  const byUser = new Map(slips.map((s) => [String(s.userId), s]));

  const rows = people.map((u) => {
    const slip = byUser.get(String(u._id));
    return {
      userId: String(u._id),
      userName: u.name as string,
      employeeCode: (u.employeeCode as string | null) ?? null,
      payslip: slip ? serialize(slip as Record<string, unknown>, u.name as string, (u.employeeCode as string | null) ?? null) : null,
    };
  });

  return {
    period,
    rows,
    uploaded: rows.filter((r) => r.payslip).length,
    missing: rows.filter((r) => !r.payslip).length,
    total: rows.length,
  };
}

/** One person's own payslips, newest month first. */
export async function myPayslips(ctx: CompanyContext, userId?: string): Promise<PayslipRow[]> {
  const id = userId ? await requireVisibleEmployee(ctx, userId) : new Types.ObjectId(ctx.userId);
  const rows = await scoped(Payslip, ctx)
    .find({ userId: id, publishedAt: { $ne: null } })
    .sort({ period: -1 }).populate(pop("userId", "name employeeCode")).lean();
  return rows.map((r) => {
    const u = r.userId as unknown as { name?: string; employeeCode?: string | null };
    return serialize(r as Record<string, unknown>, u?.name ?? "", u?.employeeCode ?? null);
  });
}

/**
 * Store a payslip for one person and one month.
 *
 * Replacing an existing one deletes the old object rather than orphaning it, and
 * is written to the audit log: a payslip that changed after somebody read it is
 * exactly the kind of thing that has to be explainable later.
 */
export async function uploadPayslip(
  ctx: CompanyContext,
  input: { userId: string; month?: string; netPay?: number | null; note?: string | null; publish?: boolean },
  file: { buffer: Buffer; contentType: string; fileName: string; size: number },
  ip: string | null,
) {
  const id = await requireVisibleEmployee(ctx, input.userId);
  const user = await scoped(User, ctx).findOne({ _id: id, archivedAt: null }).select("name employeeCode").lean();
  if (!user) throw Errors.notFound("Employee");
  const period = await periodFor(ctx, input.month);

  const existing = await scoped(Payslip, ctx).findOne({ userId: id, period: period.key });
  const key = `companies/${ctx.companyId}/payslips/${period.key}/${id}-${Date.now()}.pdf`;
  await storage().put({ key, body: file.buffer, contentType: file.contentType });

  const previousKey = existing?.fileKey as string | undefined;
  const doc = existing ?? new Payslip({ companyId: new Types.ObjectId(ctx.companyId), userId: id, period: period.key });
  doc.set({
    from: period.from,
    to: period.to,
    fileKey: key,
    fileName: file.fileName,
    fileSize: file.size,
    contentType: file.contentType,
    netPay: input.netPay ?? null,
    note: input.note ?? null,
    uploadedBy: new Types.ObjectId(ctx.userId),
    publishedAt: input.publish === false ? null : (existing?.publishedAt ?? new Date()),
  });
  await doc.save();

  // Only after the new one is safely stored.
  if (previousKey && previousKey !== key) await storage().delete(previousKey).catch(() => {});

  await audit({
    ctx, companyId: ctx.companyId, entity: "payslip", entityId: doc._id,
    action: existing ? "payslip.replaced" : "payslip.uploaded",
    summary: `${ctx.name} ${existing ? "replaced" : "uploaded"} ${user.name}'s payslip for ${period.label}`,
    after: { period: period.key, fileName: file.fileName }, ip,
  });

  return serialize(doc.toObject() as Record<string, unknown>, user.name as string, (user.employeeCode as string | null) ?? null);
}

/** A short-lived link to the file. Anyone may fetch their own; HR may fetch any. */
export async function payslipFileUrl(ctx: CompanyContext, payslipId: string, canSeeEveryone: boolean) {
  const slip = await scoped(Payslip, ctx).findOne({
    _id: Types.ObjectId.isValid(payslipId) ? new Types.ObjectId(payslipId) : new Types.ObjectId(),
  }).lean();
  if (!slip) throw Errors.notFound("Payslip");
  const mine = String(slip.userId) === ctx.userId;
  if (!mine && !canSeeEveryone) throw Errors.forbidden("That is not your payslip");
  // An unpublished payslip is still a draft: HR can open it, the employee cannot.
  if (mine && !slip.publishedAt && !canSeeEveryone) throw Errors.notFound("Payslip");
  return { url: await storage().getSignedUrl(slip.fileKey as string, 300), fileName: slip.fileName as string };
}

export async function deletePayslip(ctx: CompanyContext, payslipId: string, ip: string | null) {
  const slip = await scoped(Payslip, ctx).findOne({
    _id: Types.ObjectId.isValid(payslipId) ? new Types.ObjectId(payslipId) : new Types.ObjectId(),
  });
  if (!slip) throw Errors.notFound("Payslip");
  const user = await scoped(User, ctx).findOne({ _id: slip.userId }).select("name").lean();
  await storage().delete(slip.fileKey as string).catch(() => {});
  // Through the scoped query, not `slip.deleteOne()`: a document's own delete
  // carries no companyId filter, and the tenant guard refuses it - correctly.
  await scoped(Payslip, ctx).deleteOne({ _id: slip._id } as never);
  await audit({
    ctx, companyId: ctx.companyId, entity: "payslip", entityId: slip._id, action: "payslip.deleted",
    summary: `${ctx.name} deleted ${user?.name ?? "an employee"}'s payslip for ${slip.period}`,
    before: { period: slip.period }, ip,
  });
  return { deleted: true };
}
