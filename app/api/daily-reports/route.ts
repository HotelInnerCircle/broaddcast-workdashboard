import { route, clientIp } from "@/lib/api/handler";
import { ok, parseBody, parseQuery } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { dailyReportQuerySchema, dailyReportSchema } from "@/lib/validation/reports";
import { listDailyReports, submitDailyReport, hasProofAlready } from "@/services/dailyReportService";
import { companyClock } from "@/lib/time/company-clock";
import { readProof, proofRequired, storeWorkProof, missingProof } from "@/lib/storage/work-proof";

export const GET = route(async (req) => {
  const ctx = await requirePermission("dailyReports", "view");
  const q = parseQuery(req, dailyReportQuerySchema);
  const today = (await companyClock(ctx.companyId)).dayOf(new Date());
  const from = q.from ?? q.date ?? today, to = q.to ?? q.date ?? today;
  return ok(await listDailyReports(ctx, { from, to, userId: ctx.role === "EMPLOYEE" ? ctx.userId : q.userId, teamId: q.teamId }));
});

/** Submit or update the caller's own report (spec 12.17). */
/**
 * Submit or update the caller own report (spec 12.17), with a picture of the
 * work when the company asks for one (A105). Multipart only when there is a
 * file; plain JSON otherwise.
 */
export const POST = route(async (req) => {
  const ctx = await requirePermission("dailyReports", "create");
  const multipart = await readProof(req, ctx.companyId, "dailyReport");
  const required = await proofRequired(ctx.companyId, "dailyReport");
  const ip = clientIp(req);

  if (!multipart) {
    const input = await parseBody(req, dailyReportSchema);
    /*
     * A plain JSON submission is either the first one - which needs a picture -
     * or an edit to a report that already has one. Refusing both would mean
     * nobody could refine their wording later in the day without photographing
     * their screen again, which is not what "required" was meant to mean.
     */
    if (required && !(await hasProofAlready(ctx, input.date))) throw missingProof("what you completed");
    return ok(await submitDailyReport(ctx, input, ip));
  }

  const existing = await hasProofAlready(ctx, multipart.fields.date);
  if (required && !multipart.file && !existing) throw missingProof("what you completed");
  const input = dailyReportSchema.parse(multipart.fields);
  const proof = multipart.file ? await storeWorkProof(ctx.companyId, multipart.file, "daily", ctx.userId) : null;
  return ok(await submitDailyReport(ctx, { ...input, proof }, ip));
});
