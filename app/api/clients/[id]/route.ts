import { route, clientIp } from "@/lib/api/handler";
import { ok, parseBody } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { updateClientSchema } from "@/lib/validation/clients";
import { getClient, updateClient } from "@/services/clientService";

export const GET = route(async (_req, { params }) => {
  const ctx = await requirePermission("clients", "view");
  return ok(await getClient(ctx, (await params).id));
});

/** Update or archive/restore (spec 7.8: never hard-deleted). */
export const PATCH = route(async (req, { params }) => {
  const ctx = await requirePermission("clients", "update");
  return ok(await updateClient(ctx, (await params).id, await parseBody(req, updateClientSchema), clientIp(req)));
});
