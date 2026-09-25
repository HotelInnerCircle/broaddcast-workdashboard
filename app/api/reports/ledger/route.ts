import { Types } from "mongoose";
import { route } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { Errors } from "@/lib/api/errors";
import { requirePermission } from "@/lib/auth/context";
import { scoped } from "@/lib/db/scoped";
import { employeeScopeFilter } from "@/services/scope";
import { attendanceLedger } from "@/services/ledgerService";
import { User } from "@/models/User";

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
    /*
     * $and, not a spread. The scope filter for an employee is `{ _id: me }`, and spreading
     * `{ ...scope, _id: asked }` overwrites that key - the check then asks only "does this user
     * exist", which is true for everyone. It let an employee read anyone's ledger.
     */
    const allowed = await scoped(User, ctx).exists({
      $and: [await employeeScopeFilter(ctx), { _id: new Types.ObjectId(asked) }],
    } as never);
    if (!allowed) throw Errors.forbidden("That person is not in your scope");
    userId = asked;
  }
  return ok(await attendanceLedger(ctx, userId, month));
});
