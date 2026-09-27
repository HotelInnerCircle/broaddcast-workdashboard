import { route, clientIp } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { Errors } from "@/lib/api/errors";
import { requireCompanySession } from "@/lib/auth/context";
import { rateLimit } from "@/lib/rate-limit";
import { enrolFace, forgetFace, faceStatus } from "@/services/faceService";

/** Whether this person has enrolled a face, and whether the company asks for one. */
export const GET = route(async () => {
  const ctx = await requireCompanySession();
  return ok(await faceStatus(ctx));
});

/**
 * Enrol a face (A108).
 *
 * The body is descriptors - lists of numbers computed in the browser - never a
 * photograph. Nothing that can be turned back into a picture is stored.
 */
export const POST = route(async (req) => {
  const ctx = await requireCompanySession();
  rateLimit(`face-enrol:${ctx.userId}`, 10, 60_000);
  const body = (await req.json().catch(() => null)) as { samples?: unknown; consent?: boolean } | null;
  // Biometric data needs consent given, not assumed. The client sends it
  // explicitly so there is something to point at later.
  if (body?.consent !== true) throw Errors.bad("CONSENT_REQUIRED", "Agree to your face being used for attendance before enrolling.");
  return ok(await enrolFace(ctx, body?.samples, clientIp(req)));
});

/** Remove it. Their own always; somebody else's only for HR. */
export const DELETE = route(async (req) => {
  const ctx = await requireCompanySession();
  const userId = new URL(req.url).searchParams.get("userId");
  return ok(await forgetFace(ctx, userId, clientIp(req)));
});
