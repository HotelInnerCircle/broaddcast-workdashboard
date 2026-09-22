import { route, clientIp } from "@/lib/api/handler";
import { ok, parseBody } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { updateEmployeeSchema } from "@/lib/validation/employees";
import { getEmployee, updateEmployee } from "@/services/employeeService";

export const GET = route(async (_req, { params }) => {
  const ctx = await requirePermission("employees", "view");
  const { id } = await params;
  return ok(await getEmployee(ctx, id));
});

export const PATCH = route(async (req, { params }) => {
  const ctx = await requirePermission("employees", "update");
  const { id } = await params;
  const input = await parseBody(req, updateEmployeeSchema);
  return ok(await updateEmployee(ctx, id, input, clientIp(req)));
});
