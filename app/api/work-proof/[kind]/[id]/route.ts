import { Types } from "mongoose";
import { route } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { Errors } from "@/lib/api/errors";
import { requireCompanySession } from "@/lib/auth/context";
import { scoped } from "@/lib/db/scoped";
import { TimeEntry } from "@/models/TimeEntry";
import { DailyReport } from "@/models/DailyReport";
import { proofUrl } from "@/lib/storage/work-proof";
import { employeeScopeFilter } from "@/services/scope";
import { User } from "@/models/User";

/**
 * A short-lived link to the picture attached to a time entry or a daily report.
 *
 * Minted one at a time rather than listed, because a timesheet of two thousand
 * rows would otherwise sign two thousand URLs nobody opens. Your own always;
 * somebody else's only if they are within your people scope - a screenshot of
 * their screen is exactly as private as the rest of their record.
 */
export const GET = route(async (_req, { params }) => {
  const ctx = await requireCompanySession();
  const { kind, id } = await params;
  if (!Types.ObjectId.isValid(id)) throw Errors.notFound("Picture");
  const _id = new Types.ObjectId(id);

  const row = kind === "daily"
    ? await scoped(DailyReport, ctx).findOne({ _id }).select("userId proofKey").lean()
    : await scoped(TimeEntry, ctx).findOne({ _id }).select("userId proofKey").lean();
  if (!row?.proofKey) throw Errors.notFound("Picture");

  if (String(row.userId) !== ctx.userId) {
    const visible = await scoped(User, ctx).exists({
      $and: [await employeeScopeFilter(ctx), { _id: row.userId }],
    } as never);
    if (!visible) throw Errors.forbidden("That is not yours to look at");
  }
  return ok({ url: await proofUrl(row.proofKey as string) });
});
