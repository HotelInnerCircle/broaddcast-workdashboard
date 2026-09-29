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
 * Enrol a face (A108, reviewed since A120).
 *
 * What identifies the face is still descriptors - lists of numbers computed in
 * the browser - and nothing derived from them can be turned back into a picture.
 * A photograph now comes with them, deliberately and separately: somebody has
 * to approve the enrolment, and approving means recognising a face rather than
 * agreeing with a row in a table.
 *
 * Multipart, so the picture travels as a file like every other upload here.
 * JSON is still accepted, which is what the API tests and any older client send.
 */
export const POST = route(async (req) => {
  const ctx = await requireCompanySession();
  rateLimit(`face-enrol:${ctx.userId}`, 10, 60_000);

  let samples: unknown;
  let consent = false;
  let photo: File | null = null;
  let where: { lat?: number; lng?: number } | null = null;

  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData();
    consent = form.get("consent") === "true";
    try { samples = JSON.parse(String(form.get("samples") ?? "null")); } catch { samples = null; }
    const file = form.get("photo");
    photo = file instanceof File && file.size > 0 ? file : null;
    const lat = Number(form.get("lat"));
    const lng = Number(form.get("lng"));
    where = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  } else {
    const body = (await req.json().catch(() => null)) as { samples?: unknown; consent?: boolean; lat?: number; lng?: number } | null;
    consent = body?.consent === true;
    samples = body?.samples;
    where = typeof body?.lat === "number" && typeof body?.lng === "number" ? { lat: body.lat, lng: body.lng } : null;
  }

  // Biometric data needs consent given, not assumed. The client sends it
  // explicitly so there is something to point at later.
  if (!consent) throw Errors.bad("CONSENT_REQUIRED", "Agree to your face being used for attendance before enrolling.");
  return ok(await enrolFace(ctx, samples, photo, where, clientIp(req)));
});

/** Remove it. Their own always; somebody else's only for HR. */
export const DELETE = route(async (req) => {
  const ctx = await requireCompanySession();
  const userId = new URL(req.url).searchParams.get("userId");
  return ok(await forgetFace(ctx, userId, clientIp(req)));
});
