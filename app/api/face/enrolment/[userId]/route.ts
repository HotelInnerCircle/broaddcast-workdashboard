import { route, clientIp } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { parseBody } from "@/lib/api/response";
import { decideEnrolment, enrolmentPhotoUrl } from "@/services/faceService";
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
