import { z } from "zod";
import { route } from "@/lib/api/handler";
import { ok, parseBody } from "@/lib/api/response";
import { requireCompanySession } from "@/lib/auth/context";
import { DeviceToken } from "@/models/DeviceToken";
import { scoped } from "@/lib/db/scoped";
import { Types } from "mongoose";

const schema = z.object({ token: z.string().trim().min(16).max(4096), platform: z.enum(["android", "ios", "web"]) });

/** Register this device for push (A65). Idempotent: re-registering refreshes ownership and lastSeenAt. */
export const POST = route(async (req) => {
  const ctx = await requireCompanySession();
  const { token, platform } = await parseBody(req, schema);
  await scoped(DeviceToken, ctx).findOneAndUpdate(
    { token },
    { $set: { userId: new Types.ObjectId(ctx.userId), platform, lastSeenAt: new Date() } },
    { upsert: true },
  );
  return ok({ registered: true });
});

/** Unregister on logout so a shared device stops receiving the previous user's notifications. */
export const DELETE = route(async (req) => {
  const ctx = await requireCompanySession();
  const { token } = await parseBody(req, schema.pick({ token: true }));
  await scoped(DeviceToken, ctx).deleteOne({ token, userId: new Types.ObjectId(ctx.userId) });
  return ok({ unregistered: true });
});
