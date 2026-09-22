import { route, clientIp } from "@/lib/api/handler";
import { ok, parseBody } from "@/lib/api/response";
import { requireRole } from "@/lib/auth/context";
import { deleteCompanySchema, superAdminCompanyPatchSchema } from "@/lib/validation/company";
import { companyDetail, deleteCompany, patchCompany } from "@/services/superAdminService";

/** Cross-tenant read: audited (spec 4.6). */
export const GET = route(async (req, { params }) => {
  const ctx = await requireRole("SUPER_ADMIN");
  return ok(await companyDetail(ctx, (await params).id, clientIp(req)));
});

/** Suspend / reactivate / change plan. Every action is audited as cross-tenant (spec 4.6). */
export const PATCH = route(async (req, { params }) => {
  const ctx = await requireRole("SUPER_ADMIN");
  const { id } = await params;
  const input = await parseBody(req, superAdminCompanyPatchSchema);
  return ok(await patchCompany(ctx, id, input, clientIp(req)));
});

/** Irreversible full delete of a company and all of its data (A55). Body: { confirmName }. */
export const DELETE = route(async (req, { params }) => {
  const ctx = await requireRole("SUPER_ADMIN");
  const { id } = await params;
  const { confirmName } = await parseBody(req, deleteCompanySchema);
  return ok(await deleteCompany(ctx, id, confirmName, clientIp(req)));
});
