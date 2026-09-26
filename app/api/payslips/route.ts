import { route, clientIp } from "@/lib/api/handler";
import { ok, created } from "@/lib/api/response";
import { Errors } from "@/lib/api/errors";
import { requireCompanySession, requirePermission } from "@/lib/auth/context";
import { rateLimit } from "@/lib/rate-limit";
import { validateUpload, sniffMatches } from "@/lib/storage";
import { payslipRegister, myPayslips, uploadPayslip } from "@/services/payslipService";

/**
 * The payroll month's register for HR, or your own payslips (A102).
 *
 * `?mine=true` needs no grant: reading your own payslip is like reading your own
 * profile. Everything else is HR and the company admin.
 */
export const GET = route(async (req) => {
  const url = new URL(req.url);
  const month = url.searchParams.get("month") ?? undefined;
  if (url.searchParams.get("mine") === "true") {
    const ctx = await requireCompanySession();
    return ok(await myPayslips(ctx));
  }
  const ctx = await requirePermission("payslips", "view");
  const asked = url.searchParams.get("userId");
  if (asked) return ok(await myPayslips(ctx, asked));
  return ok(await payslipRegister(ctx, month));
});

/** Upload a payslip. Multipart, because it is a file. */
export const POST = route(async (req) => {
  const ctx = await requirePermission("payslips", "create");
  rateLimit(`payslip:${ctx.userId}`, 60, 60_000);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw Errors.bad("FILE_REQUIRED", "Choose a payslip file");
  const userId = String(form.get("userId") ?? "");
  if (!userId) throw Errors.bad("USER_REQUIRED", "Choose whose payslip this is");

  const { mime } = validateUpload(file);
  if (mime !== "application/pdf") throw Errors.bad("PDF_ONLY", "A payslip must be a PDF");
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!sniffMatches(buffer, mime)) throw Errors.bad("BAD_PDF", "That file is not the PDF it claims to be");

  const netPayRaw = form.get("netPay");
  const netPay = netPayRaw === null || String(netPayRaw).trim() === "" ? null : Number(netPayRaw);
  if (netPay !== null && !Number.isFinite(netPay)) throw Errors.bad("BAD_AMOUNT", "Net pay must be a number");

  return created(await uploadPayslip(
    ctx,
    {
      userId,
      month: (form.get("month") as string | null) ?? undefined,
      netPay,
      note: (form.get("note") as string | null) ?? null,
      publish: form.get("publish") !== "false",
    },
    { buffer, contentType: mime, fileName: file.name || "payslip.pdf", size: file.size },
    clientIp(req),
  ));
});
