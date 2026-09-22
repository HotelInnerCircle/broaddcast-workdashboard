import { route, clientIp } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { Errors } from "@/lib/api/errors";
import { requirePermission } from "@/lib/auth/context";
import { validateUpload, sniffMatches } from "@/lib/storage";
import { setCompanyLogo } from "@/services/companyService";

export const POST = route(async (req) => {
  const ctx = await requirePermission("companySettings", "update");
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw Errors.bad("FILE_REQUIRED", "Attach an image file");
  const { ext, mime } = validateUpload(file, { imagesOnly: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!sniffMatches(buffer, mime)) throw Errors.bad("UNSUPPORTED_FILE", "File content does not match its type");
  return ok(await setCompanyLogo(ctx, buffer, ext, mime, clientIp(req)));
});
