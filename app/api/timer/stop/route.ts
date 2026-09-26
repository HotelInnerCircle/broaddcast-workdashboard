import { route, clientIp } from "@/lib/api/handler";
import { ok, parseBody } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { stopTimerSchema } from "@/lib/validation/time";
import { stopTimer } from "@/services/timerService";
import { readProof, proofRequired, storeWorkProof, missingProof } from "@/lib/storage/work-proof";

/**
 * Stop the running timer (A105: with a picture of the work, when the company asks).
 *
 * Takes multipart when there is a picture and plain JSON when there is not, so
 * the request only becomes a file upload when it needs to be.
 */
export const POST = route(async (req) => {
  const ctx = await requirePermission("timer", "update");
  const multipart = await readProof(req, ctx.companyId, "timer");
  const required = await proofRequired(ctx.companyId, "timer");

  if (!multipart) {
    if (required) throw missingProof("what you worked on");
    const input = await parseBody(req, stopTimerSchema);
    return ok(await stopTimer(ctx, input, clientIp(req)));
  }

  if (required && !multipart.file) throw missingProof("what you worked on");
  const input = stopTimerSchema.parse({ notes: multipart.fields.notes });
  const proof = multipart.file ? await storeWorkProof(ctx.companyId, multipart.file, "timer", ctx.userId) : null;
  return ok(await stopTimer(ctx, { ...input, proof }, clientIp(req)));
});
