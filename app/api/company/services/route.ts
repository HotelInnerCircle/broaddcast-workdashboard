import { route } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { Company } from "@/models/Company";

/** The services this company sells (A69), for the checkboxes on a client. */
export const GET = route(async () => {
  const ctx = await requirePermission("clients", "view");
  const c = await Company.findById(ctx.companyId).select("services").lean();
  return ok({ services: c?.services ?? [] });
});
