import { z } from "zod";
import { route } from "@/lib/api/handler";
import { ok, parseQuery } from "@/lib/api/response";
import { requireCompanySession } from "@/lib/auth/context";
import { listNotifications } from "@/services/notificationService";

const q = z.object({ unread: z.enum(["true", "false"]).optional(), limit: z.coerce.number().int().min(1).max(100).optional() });

export const GET = route(async (req) => {
  const ctx = await requireCompanySession();
  const p = parseQuery(req, q);
  return ok(await listNotifications(ctx, { unread: p.unread === "true", limit: p.limit }));
});
