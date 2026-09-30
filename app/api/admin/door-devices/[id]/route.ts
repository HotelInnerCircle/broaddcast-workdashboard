import { route, clientIp } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { revokeDoorDevice } from "@/services/doorService";

/**
 * Stop trusting a device.
 *
 * Takes effect on its very next request, because the reason somebody revokes a
 * door device is usually that it has left the building.
 */
export const DELETE = route(async (req, { params }) => {
  const ctx = await requirePermission("companySettings", "update");
  const { id } = await params;
  return ok(await revokeDoorDevice(ctx, id, clientIp(req)));
});
