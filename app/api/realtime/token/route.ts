import { route } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/context";
import { ablyConfigured, createRealtimeToken } from "@/lib/realtime/ably";

/**
 * Short-lived Ably token for the signed-in browser (A76). The secret key stays on the server; the
 * token can only subscribe to this person's own user channel and, for presence, their company's
 * channel - so it cannot be used to listen in on anyone else or on another tenant.
 *
 * With no provider configured this answers 200 with `provider: null` rather than 404: a 404 would
 * put a red line in every browser console, which is the noise A75 set out to remove.
 */
export const GET = route(async () => {
  const ctx = await requireSession();
  if (!ablyConfigured()) return ok({ provider: null });
  const token = await createRealtimeToken(ctx.userId, ctx.companyId ?? null);
  return ok(token ? { provider: "ably", ...token } : { provider: null });
});
