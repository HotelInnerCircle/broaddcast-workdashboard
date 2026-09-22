import { route } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { Company } from "@/models/Company";

/** The company's job designations (A57) for pickers; anyone who can see employees may read them. */
export const GET = route(async () => {
  const ctx = await requirePermission("employees", "view");
  const c = await Company.findById(ctx.companyId).select("designations").lean();
  return ok({ designations: c?.designations ?? [] });
});
