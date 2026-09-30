import { route, clientIp } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { parseBody } from "@/lib/api/response";
import { decideEnrolment, enrolmentPhotoUrl, enrolFaceFor } from "@/services/faceService";
import { faceDecisionSchema } from "@/lib/validation/face";

/**
 * The picture taken when this person enrolled, for whoever is reviewing it.
 *
 * Separate from the register so a reviewer can look at somebody who is already
 * approved - to check a face against a person standing in front of them, or to
 * see what was agreed to months ago.
 */
export const GET = route(async (_req, { params }) => {
  const ctx = await requirePermission("employees", "view");
  const { userId } = await params;
  return ok({ url: await enrolmentPhotoUrl(ctx, userId) });
});

/**
 * Approve or turn down an enrolment (A120).
 *
 * This is the whole feature. A face nobody has agreed to is a face the camera
 * chose, and checking against it produces records that read "verified" while
 * being anchored to nothing.
 */
export const PATCH = route(async (req, { params }) => {
  const ctx = await requirePermission("employees", "update");
  const { userId } = await params;
  const input = await parseBody(req, faceDecisionSchema);
  return ok(await decideEnrolment(ctx, userId, input, clientIp(req)));
});

/**
 * Enrol somebody's face with them standing in front of you (A127).
 *
 * The other way round from the phone: there a person enrols themselves and
 * waits for approval, because nobody watched. Here the watching is the
 * enrolment, so it is approved on the spot by whoever did it.
 */
export const POST = route(async (req, { params }) => {
  const ctx = await requirePermission("employees", "update");
  const { userId } = await params;

  let samples: unknown;
  let photo: File | null = null;
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData();
    try { samples = JSON.parse(String(form.get("samples") ?? "null")); } catch { samples = null; }
    const file = form.get("photo");
    photo = file instanceof File && file.size > 0 ? file : null;
  } else {
    const body = (await req.json().catch(() => null)) as { samples?: unknown } | null;
    samples = body?.samples;
  }

  return ok(await enrolFaceFor(ctx, userId, samples, photo, clientIp(req)));
});
