import { route, clientIp } from "@/lib/api/handler";
import { created, paged, parseQuery } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { leaveCreateSchema, leaveQuerySchema } from "@/lib/validation/leave";
import { createLeave, listLeave } from "@/services/leaveService";

/** Leave plans the caller may see (A91). */
export const GET = route(async (req) => {
  const ctx = await requirePermission("attendance", "view");
  const q = parseQuery(req, leaveQuerySchema);
  const res = await listLeave(ctx, q);
  return paged(res.data, { page: res.page, limit: res.limit, total: res.total, totalPages: Math.ceil(res.total / res.limit) });
});

/** Multipart, because a plan may carry proof - a medical certificate, say. */
export const POST = route(async (req) => {
  const ctx = await requirePermission("attendance", "create");
  const form = await req.formData();
  const file = form.get("attachment");
  const input = leaveCreateSchema.parse({
    type: form.get("type"),
    startDate: form.get("startDate"),
    endDate: form.get("endDate"),
    note: form.get("note") ?? undefined,
  });
  return created(await createLeave(ctx, input, file instanceof File && file.size > 0 ? file : null, clientIp(req)));
});
