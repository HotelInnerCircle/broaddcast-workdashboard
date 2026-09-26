import { route } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { requireVisibleEmployee } from "@/services/scope";
import { attendanceLedger } from "@/services/ledgerService";

/**
 * One person's month, day by day (A94). Anyone may read their own; seeing someone else's follows
 * the same people scope as the rest of the app, checked here rather than assumed.
 */
export const GET = route(async (req) => {
  const ctx = await requirePermission("attendance", "view");
  const url = new URL(req.url);
  const asked = url.searchParams.get("userId");
  const month = url.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);

  let userId = ctx.userId;
  if (asked && asked !== ctx.userId) {
    // Answers 403 for anyone out of scope, and for an id that is not an id at all.
    userId = String(await requireVisibleEmployee(ctx, asked));
  }
  return ok(await attendanceLedger(ctx, userId, month));
});
