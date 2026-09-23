import { Types } from "mongoose";
import { route } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/context";
import { User } from "@/models/User";
import { LAST_ACTIVE_WINDOW_MS, presence } from "@/lib/realtime/presence";

/**
 * Presence heartbeat for hosts without a socket (A74). The browser calls this every 30s whenever
 * the Socket.IO connection is unavailable: it stamps `lastActiveAt` so colleagues can see this
 * person as online, and returns who else in the company is currently online so the caller can
 * update its own dots without waiting for a `presence:update` event that will never arrive.
 */
export const POST = route(async () => {
  const ctx = await requireSession();
  const now = new Date();
  await User.updateOne({ _id: new Types.ObjectId(ctx.userId) }, { $set: { lastActiveAt: now } });
  if (!ctx.companyId) return ok({ online: [ctx.userId], at: now });

  const cutoff = new Date(now.getTime() - LAST_ACTIVE_WINDOW_MS);
  const rows = await User.find({ companyId: new Types.ObjectId(ctx.companyId), status: "active", archivedAt: null, lastActiveAt: { $gte: cutoff } }).select("_id").lean();
  // Union with the in-memory store, which is authoritative when this process owns the sockets.
  const online = new Set(rows.map((r) => String(r._id)));
  for (const id of presence.onlineIds(ctx.companyId)) online.add(id);
  return ok({ online: [...online], at: now });
});
