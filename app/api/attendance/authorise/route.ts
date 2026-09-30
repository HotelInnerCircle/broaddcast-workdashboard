import { route, clientIp } from "@/lib/api/handler";
import { ok, parseBody } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { authorisationGrid } from "@/services/ledgerService";
import { settleDay } from "@/services/attendanceService";
import { settleDaySchema } from "@/lib/validation/attendance-auth";

/**
 * Everybody's month, day by day (A130) - the grid HR works in.
 *
 * Scoped like every other people-shaped query: a team lead sees their team, HR
 * sees the company. The scope is applied inside, never trusted from here.
 */
export const GET = route(async (req) => {
  const ctx = await requirePermission("attendance", "view");
  const url = new URL(req.url);
  return ok(await authorisationGrid(ctx, {
    month: url.searchParams.get("month") ?? new Date().toISOString().slice(0, 7),
    userId: url.searchParams.get("userId") ?? undefined,
    teamId: url.searchParams.get("teamId") ?? undefined,
  }));
});

/**
 * Settle one day, with a reason.
 *
 * The step that was missing between a swipe and a payslip: somebody looking at
 * a month and saying it is right. A day settled here wins over the swipes and
 * is never recomputed away by one arriving late.
 */
export const PATCH = route(async (req) => {
  const ctx = await requirePermission("attendance", "update");
  const input = await parseBody(req, settleDaySchema);
  return ok(await settleDay(ctx, input, clientIp(req)));
});
