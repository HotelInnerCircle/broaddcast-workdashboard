import { route, clientIp } from "@/lib/api/handler";
import { created, paged, parseBody, parseQuery } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { paginationSchema } from "@/lib/api/pagination";
import { createClientSchema, listClientsSchema } from "@/lib/validation/clients";
import { createClient, listClients } from "@/services/clientService";

export const GET = route(async (req) => {
  const ctx = await requirePermission("clients", "view");
  const r = await listClients(ctx, parseQuery(req, listClientsSchema.merge(paginationSchema)));
  return paged(r.data, r.meta);
});

export const POST = route(async (req) => {
  const ctx = await requirePermission("clients", "create");
  return created(await createClient(ctx, await parseBody(req, createClientSchema), clientIp(req)));
});
