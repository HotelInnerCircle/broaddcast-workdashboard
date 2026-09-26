import { route } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { requireCompanySession } from "@/lib/auth/context";
import { requireVisibleEmployee } from "@/services/scope";
import { getProfile, reportingList } from "@/services/profileService";

/**
 * The full profile plus whatever is waiting on this person to decide (A93).
 *
 * A profile holds a date of birth, a home address, a phone number and an emergency contact, and
 * `getProfile` is only tenant-scoped - so the caller's people scope has to be checked here.
 * It previously asked whether the caller was an EMPLOYEE, which is not the same question: a team
 * lead could read the address and date of birth of everybody in the company.
 */
export const GET = route(async (req) => {
  const ctx = await requireCompanySession();
  const asked = new URL(req.url).searchParams.get("userId");
  const userId = asked && asked !== ctx.userId ? String(await requireVisibleEmployee(ctx, asked)) : undefined;
  const [profile, reporting] = await Promise.all([getProfile(ctx, userId), userId ? [] : reportingList(ctx)]);
  return ok({ profile, reporting });
});
