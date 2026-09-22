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
  if (input.notificationPrefs?.email !== undefined) $set["notificationPrefs.email"] = input.notificationPrefs.email;
  if (input.notificationPrefs?.inApp !== undefined) $set["notificationPrefs.inApp"] = input.notificationPrefs.inApp;
  await User.updateOne({ _id: new Types.ObjectId(ctx.userId) }, { $set });
  await audit({ ctx, companyId: ctx.companyId, entity: "user", entityId: ctx.userId, action: "user.profile_updated", summary: `${ctx.name} updated their profile`, after: $set, ip: clientIp(req) });
  return ok({ ...ctx, ...("name" in $set ? { name: $set.name as string } : {}) });
});
