import { Types } from "mongoose";
import { route, clientIp } from "@/lib/api/handler";
import { ok, parseBody } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/context";
import { updateProfileSchema } from "@/lib/validation/company";
import { User } from "@/models/User";
import { audit } from "@/lib/audit";

export const GET = route(async () => {
  const ctx = await requireSession();
  return ok(ctx);
});

export const PATCH = route(async (req) => {
  const ctx = await requireSession();
  const input = await parseBody(req, updateProfileSchema);
  const $set: Record<string, unknown> = {};
  if (input.name !== undefined) $set.name = input.name;
  if (input.phone !== undefined) $set.phone = input.phone;
  // A93: the personal details someone owns about themselves. Employment facts are not here.
  for (const k of ["gender", "maritalStatus", "address", "updateRequest"] as const) {
    if (input[k] !== undefined) $set[k] = input[k];
  }
  if (input.dateOfBirth !== undefined) {
    // Midday UTC: a birthday is a calendar date and must not slide a day either way.
    $set.dateOfBirth = input.dateOfBirth ? new Date(`${input.dateOfBirth}T12:00:00Z`) : null;
  }
  if (input.emergencyContact) {
    for (const k of ["name", "relation", "phone"] as const) {
      if (input.emergencyContact[k] !== undefined) $set[`emergencyContact.${k}`] = input.emergencyContact[k];
    }
  }
  if (input.updateRequest !== undefined) $set.updateRequestAt = input.updateRequest ? new Date() : null;
  if (input.notificationPrefs?.email !== undefined) $set["notificationPrefs.email"] = input.notificationPrefs.email;
  if (input.notificationPrefs?.inApp !== undefined) $set["notificationPrefs.inApp"] = input.notificationPrefs.inApp;
  await User.updateOne({ _id: new Types.ObjectId(ctx.userId) }, { $set });
  await audit({ ctx, companyId: ctx.companyId, entity: "user", entityId: ctx.userId, action: "user.profile_updated", summary: `${ctx.name} updated their profile`, after: $set, ip: clientIp(req) });
  return ok({ ...ctx, ...("name" in $set ? { name: $set.name as string } : {}) });
});
