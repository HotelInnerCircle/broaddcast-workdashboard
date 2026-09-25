import { route } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { backfillEmployeeCodes } from "@/services/employeeCodeService";

/**
 * Gives a code to everyone who joined before codes existed (A95). Oldest first, so the numbering
 * follows the order people actually joined. Safe to run again - it only touches those without one.
 */
export const POST = route(async () => {
  const ctx = await requirePermission("employees", "update");
  return ok(await backfillEmployeeCodes(ctx));
});
