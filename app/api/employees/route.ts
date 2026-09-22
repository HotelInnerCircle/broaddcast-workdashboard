import { route, clientIp } from "@/lib/api/handler";
import { created, paged, parseBody, parseQuery } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { paginationSchema } from "@/lib/api/pagination";
import { createEmployeeSchema, listEmployeesSchema } from "@/lib/validation/employees";
import { listEmployees } from "@/services/employeeService";
import { createEmployee } from "@/services/inviteService";

export const GET = route(async (req) => {
  const ctx = await requirePermission("employees", "view");
  const query = parseQuery(req, listEmployeesSchema.merge(paginationSchema));
  const result = await listEmployees(ctx, query);
  return paged(result.data, result.meta);
});

/** Direct account creation with a password (A56); same permission as inviting. */
export const POST = route(async (req) => {
  const ctx = await requirePermission("employees", "invite");
  const input = await parseBody(req, createEmployeeSchema);
  return created(await createEmployee(ctx, input, clientIp(req)));
});
