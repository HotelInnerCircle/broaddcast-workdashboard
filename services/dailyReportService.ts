import { Types } from "mongoose";
import { scoped, pop } from "@/lib/db/scoped";
import { DailyReport } from "@/models/DailyReport";
import { companyClock } from "@/lib/time/company-clock";
import { audit } from "@/lib/audit";
import type { CompanyContext } from "@/lib/auth/context";
import { scopedUsers } from "./timesheetService";

export function serializeDailyReport(r: Record<string, unknown>) {
  const u = r.userId;
  return {
    id: String(r._id), userId: u && typeof u === "object" && "name" in (u as object) ? String((u as { _id: unknown })._id) : String(u),
    user: u && typeof u === "object" && "name" in (u as object) ? { id: String((u as { _id: unknown })._id), name: (u as { name: string }).name } : null,
    date: r.date as string, completed: r.completed as string,
    submittedAt: r.submittedAt as Date, updatedAt: r.updatedAt as Date,
  };
}

/** Employees submit (or re-submit) their own report for a day; defaults to today in the company timezone. */
export async function submitDailyReport(ctx: CompanyContext, input: { date?: string; completed: string; inProgress?: string; pending?: string; blockers?: string; tomorrow?: string }, ip: string | null) {
  const clock = await companyClock(ctx.companyId);
  const today = clock.dayOf(new Date());
  const date = input.date ?? today;
  if (date > today) throw (await import("@/lib/api/errors")).Errors.bad("FUTURE_DATE", "Daily reports cannot be submitted for a future date");
  const { date: _d, ...fields } = input;
  void _d;
  const existing = await scoped(DailyReport, ctx).findOne({ userId: new Types.ObjectId(ctx.userId), date });
  const rec = await scoped(DailyReport, ctx).findOneAndUpdate({ userId: new Types.ObjectId(ctx.userId), date }, { $set: { ...fields, submittedAt: new Date() } }, { upsert: true });
  await audit({ ctx, companyId: ctx.companyId, entity: "dailyReport", entityId: rec!._id, action: existing ? "daily_report.updated" : "daily_report.submitted", summary: `${ctx.name} ${existing ? "updated" : "submitted"} their daily report for ${date}`, after: { date }, ip });
  return serializeDailyReport(rec!.toObject() as Record<string, unknown>);
}

export async function listDailyReports(ctx: CompanyContext, q: { from: string; to: string; userId?: string; teamId?: string }) {
  const users = await scopedUsers(ctx, { userId: q.userId, teamId: q.teamId, includeDeactivated: true });
  const rows = await scoped(DailyReport, ctx).find({ userId: { $in: users.map((u) => u._id) }, date: { $gte: q.from, $lte: q.to } }).sort({ date: -1 }).populate(pop("userId", "name")).lean();
  return rows.map((r) => serializeDailyReport(r as Record<string, unknown>));
}
