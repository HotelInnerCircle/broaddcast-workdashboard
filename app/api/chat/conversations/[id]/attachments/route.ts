import { route } from "@/lib/api/handler";
import { created } from "@/lib/api/response";
import { Errors } from "@/lib/api/errors";
import { requirePermission } from "@/lib/auth/context";
import { storage, validateUpload, sniffMatches, imageSize } from "@/lib/storage";
import { sendMessage } from "@/services/chatService";
import { checkLimit } from "@/lib/limits";

/** At most this many files in one message - the picker stops the user long before the server has to. */
const MAX_FILES = 10;

/**
 * File/image attachments in chat. Accepts several files in one request (A72): they are validated
 * and uploaded together and arrive as a single message, so a batch of photos stays one bubble.
 */
export const POST = route(async (req, { params }) => {
  const ctx = await requirePermission("chat", "create");
  const { id } = await params;
  const form = await req.formData();
  const files = form.getAll("files").concat(form.getAll("file")).filter((f): f is File => f instanceof File);
  if (files.length === 0) throw Errors.bad("FILE_REQUIRED", "Attach a file");
  if (files.length > MAX_FILES) throw Errors.bad("TOO_MANY_FILES", `Send at most ${MAX_FILES} files at a time`);

  // Validate everything before the first upload, so a bad file in the batch leaves nothing behind.
  const checked = files.map((file) => ({ file, mime: validateUpload(file).mime }));
  await checkLimit(ctx.companyId, "storage", { addBytes: files.reduce((n, f) => n + f.size, 0) });

  const attachments: { key: string; name: string; size: number; mime: string; width: number | null; height: number | null }[] = [];
  try {
    for (const [i, { file, mime }] of checked.entries()) {
      const buffer = Buffer.from(await file.arrayBuffer());
      if (!sniffMatches(buffer, mime)) throw Errors.bad("UNSUPPORTED_FILE", `"${file.name}" does not match its file type`);
      const key = `companies/${ctx.companyId}/chat/${id}/${Date.now()}-${i}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      await storage().put({ key, body: buffer, contentType: mime });
      const { width, height } = mime.startsWith("image/") ? imageSize(buffer, mime) : { width: null, height: null };
      attachments.push({ key, name: file.name, size: buffer.length, mime, width, height });
    }
  } catch (err) {
    for (const a of attachments) await storage().delete(a.key).catch(() => {});
    throw err;
  }
  return created(await sendMessage(ctx, { conversationId: id, body: String(form.get("body") ?? ""), replyTo: (form.get("replyTo") as string) || null, attachments }));
});
