import { route, clientIp } from "@/lib/api/handler";
import { created } from "@/lib/api/response";
import { Errors } from "@/lib/api/errors";
import { requirePermission } from "@/lib/auth/context";
import { validateUpload, sniffMatches } from "@/lib/storage";
import { addAttachment } from "@/services/taskService";
import { checkLimit } from "@/lib/limits";

export const POST = route(async (req, { params }) => {
  const ctx = await requirePermission("tasks", "update");
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw Errors.bad("FILE_REQUIRED", "Attach a file");
  const { ext, mime } = validateUpload(file);
  await checkLimit(ctx.companyId, "storage", { addBytes: file.size });
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!sniffMatches(buffer, mime)) throw Errors.bad("UNSUPPORTED_FILE", "File content does not match its type");
  return created(await addAttachment(ctx, (await params).id, { buffer, name: file.name, mime, ext }, clientIp(req)));
});
