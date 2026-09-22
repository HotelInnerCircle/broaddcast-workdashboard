import { route, clientIp } from "@/lib/api/handler";
import { ok, created, parseBody } from "@/lib/api/response";
import { requireRole } from "@/lib/auth/context";
import { createCompanySchema } from "@/lib/validation/company";
import { createCompany, listCompanies } from "@/services/superAdminService";

export const GET = route(async (req) => {
  const ctx = await requireRole("SUPER_ADMIN");
  return ok(await listCompanies(ctx, clientIp(req)));
});

/** Only the Super Admin creates companies (A55); the first admin is invited by email. */
export const POST = route(async (req) => {
  const ctx = await requireRole("SUPER_ADMIN");
  const input = await parseBody(req, createCompanySchema);
  return created(await createCompany(ctx, input, clientIp(req)));
});
