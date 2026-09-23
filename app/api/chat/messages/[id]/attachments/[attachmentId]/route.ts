import { route } from "@/lib/api/handler";
import { errorResponse } from "@/lib/api/response";
import { Errors } from "@/lib/api/errors";
import { requirePermission } from "@/lib/auth/context";
import { attachmentDownload } from "@/services/chatService";

/**
 * Download one chat attachment (A72). The file is fetched with a short-lived signed URL and passed
 * through with `Content-Disposition: attachment`, so the browser saves it under its real name and
 * non-members of the conversation get a 404 instead of a usable link.
 */
export const GET = route(async (_req, { params }) => {
  const ctx = await requirePermission("chat", "view");
  const { id, attachmentId } = await params;
  const { url, name, mime } = await attachmentDownload(ctx, id, attachmentId);
  const upstream = await fetch(url);
  if (!upstream.ok || !upstream.body) return errorResponse(Errors.notFound("Attachment"));
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(upstream.body, {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Content-Length": upstream.headers.get("content-length") ?? "",
      "Cache-Control": "private, no-store",
    },
  });
});
