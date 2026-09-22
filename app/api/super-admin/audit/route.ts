import { route, clientIp } from "@/lib/api/handler";
import { paged, parseQuery } from "@/lib/api/response";
import { requireRole } from "@/lib/auth/context";
import { auditQuerySchema } from "@/lib/validation/billing";
import { platformAudit } from "@/services/superAdminService";

export const GET = route(async (req) => {
  const ctx = await requireRole("SUPER_ADMIN");
  const q = parseQuery(req, auditQuerySchema);
  const r = await platformAudit(ctx, { page: q.page, limit: q.limit, action: q.action, companyId: q.companyId, crossTenant: q.crossTenant === "true" }, clientIp(req));
  return paged(r.rows, r.meta);
});
