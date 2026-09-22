import { route, clientIp } from "@/lib/api/handler";
import { ok, parseBody } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { updateCompanySchema } from "@/lib/validation/company";
import { getCompany, updateCompany } from "@/services/companyService";

export const GET = route(async () => {
  const ctx = await requirePermission("companySettings", "view");
  return ok(await getCompany(ctx));
});

export const PATCH = route(async (req) => {
  const ctx = await requirePermission("companySettings", "update");
  const input = await parseBody(req, updateCompanySchema);
  return ok(await updateCompany(ctx, input, clientIp(req)));
});
