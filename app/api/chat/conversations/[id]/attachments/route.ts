import { route } from "@/lib/api/handler";
import { created } from "@/lib/api/response";
import { Errors } from "@/lib/api/errors";
import { requirePermission } from "@/lib/auth/context";
import { storage, validateUpload, sniffMatches } from "@/lib/storage";
import { sendMessage } from "@/services/chatService";
import { checkLimit } from "@/lib/limits";

/** File/image attachment in chat: uploads through the storage service, then sends as a message. */
export const POST = route(async (req, { params }) => {
  const ctx = await requirePermission("chat", "create");
  const { id } = await params;
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw Errors.bad("FILE_REQUIRED", "Attach a file");
  const { mime } = validateUpload(file);
  await checkLimit(ctx.companyId, "storage", { addBytes: file.size });
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!sniffMatches(buffer, mime)) throw Errors.bad("UNSUPPORTED_FILE", "File content does not match its type");
  const key = `companies/${ctx.companyId}/chat/${id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  await storage().put({ key, body: buffer, contentType: mime });
  return created(await sendMessage(ctx, { conversationId: id, body: String(form.get("body") ?? ""), attachment: { key, name: file.name, size: buffer.length, mime } }));
});
