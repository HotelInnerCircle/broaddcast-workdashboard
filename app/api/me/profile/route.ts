import { route } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { requireCompanySession } from "@/lib/auth/context";
import { getProfile, reportingList } from "@/services/profileService";

/** The full profile plus whatever is waiting on this person to decide (A93). */
export const GET = route(async (req) => {
  const ctx = await requireCompanySession();
  const asked = new URL(req.url).searchParams.get("userId");
  // Looking at someone else is only for people who can see beyond themselves.
  const userId = asked && asked !== ctx.userId && ctx.role !== "EMPLOYEE" ? asked : undefined;
  const [profile, reporting] = await Promise.all([getProfile(ctx, userId), userId ? [] : reportingList(ctx)]);
  return ok({ profile, reporting });
});
