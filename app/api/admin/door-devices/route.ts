import { route, clientIp } from "@/lib/api/handler";
import { ok, created, parseBody } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { listDoorDevices, registerDoorDevice } from "@/services/doorService";
import { doorDeviceSchema } from "@/lib/validation/door";

/** The tablets this company has on doors, and where each one is. */
export const GET = route(async () => {
  const ctx = await requirePermission("companySettings", "view");
  return ok(await listDoorDevices(ctx));
});

/**
 * Register one.
 *
 * The token comes back in this response and is never retrievable again - it is
 * stored hashed, the way a password is. Losing it costs a minute of registering
 * the device afresh, which is the right price for not keeping a working key to
 * the attendance of everybody in the company sitting in a database.
 */
export const POST = route(async (req) => {
  const ctx = await requirePermission("companySettings", "update");
  const input = await parseBody(req, doorDeviceSchema);
  return created(await registerDoorDevice(ctx, input, clientIp(req)));
});
