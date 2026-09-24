import { Types } from "mongoose";
import { scoped, pop } from "@/lib/db/scoped";
import { DailyReport } from "@/models/DailyReport";
import { companyClock } from "@/lib/time/company-clock";
import { audit } from "@/lib/audit";
import type { CompanyContext } from "@/lib/auth/context";
import { scopedUsers } from "./timesheetService";
import { notify } from "./notificationService";
import { User } from "@/models/User";
import { Team } from "@/models/Team";

/**
 * Who reviews this person's daily report (A77): the lead of the team they belong to. Falls back to
 * their manager when the team has no lead (or they have no team), so a report is never submitted
 * into silence. Returns null for someone with neither - and never the author themselves.
 */
async function reportReviewerId(ctx: CompanyContext): Promise<string | null> {
  const me = await scoped(User, ctx).findById(ctx.userId).select("teamId managerId").lean();
  if (!me) return null;
  if (me.teamId) {
    const team = await scoped(Team, ctx).findById(String(me.teamId)).select("leadId managerId").lean();
    for (const candidate of [team?.leadId, team?.managerId]) {
      if (candidate && String(candidate) !== ctx.userId) return String(candidate);
    }
  }
  return me.managerId && String(me.managerId) !== ctx.userId ? String(me.managerId) : null;
}

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
  // A77: a report belongs to its own day. It can be written and rewritten all through that day and
  // is locked the moment the day is over - which also means no back-filling yesterday, or the lock
  // would be a formality. "Today" is the company's timezone day, not the server's.
  if (date !== today) {
    const { Errors } = await import("@/lib/api/errors");
    throw date > today
      ? Errors.bad("FUTURE_DATE", "Daily reports cannot be submitted for a future date")
      : Errors.bad("REPORT_LOCKED", `The report for ${date} is locked. Daily reports can only be written on the day itself.`);
  }
  const { date: _d, ...fields } = input;
  void _d;
  const existing = await scoped(DailyReport, ctx).findOne({ userId: new Types.ObjectId(ctx.userId), date });
  const rec = await scoped(DailyReport, ctx).findOneAndUpdate({ userId: new Types.ObjectId(ctx.userId), date }, { $set: { ...fields, submittedAt: new Date() } }, { upsert: true });
  await audit({ ctx, companyId: ctx.companyId, entity: "dailyReport", entityId: rec!._id, action: existing ? "daily_report.updated" : "daily_report.submitted", summary: `${ctx.name} ${existing ? "updated" : "submitted"} their daily report for ${date}`, after: { date }, ip });
  // The lead is told once, when the report first lands. Same-day edits stay quiet on purpose -
  // people revise their own wording through the day and a ping per keystroke-save is noise.
  if (!existing) {
    const reviewerId = await reportReviewerId(ctx);
    if (reviewerId) {
      const preview = (input.completed ?? "").trim();
      await notify(ctx.companyId, {
        userId: reviewerId, type: "DAILY_REPORT",
        title: `${ctx.name} submitted their daily report`,
        body: preview.length > 140 ? `${preview.slice(0, 137)}...` : preview || "No details given",
        link: `/reports/daily?date=${date}`, actorId: ctx.userId,
      });
    }
  }
  return serializeDailyReport(rec!.toObject() as Record<string, unknown>);
}

export async function listDailyReports(ctx: CompanyContext, q: { from: string; to: string; userId?: string; teamId?: string }) {
  const users = await scopedUsers(ctx, { userId: q.userId, teamId: q.teamId, includeDeactivated: true });
  const rows = await scoped(DailyReport, ctx).find({ userId: { $in: users.map((u) => u._id) }, date: { $gte: q.from, $lte: q.to } }).sort({ date: -1 }).populate(pop("userId", "name")).lean();
  return rows.map((r) => serializeDailyReport(r as Record<string, unknown>));
}
