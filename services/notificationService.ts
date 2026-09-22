import { Types } from "mongoose";
import { scoped } from "@/lib/db/scoped";
import { Notification } from "@/models/Notification";
import { realtime } from "@/lib/realtime";
import type { NotificationType } from "@/types";

export interface NotifyInput { userId: string | Types.ObjectId; type: NotificationType; title: string; body?: string | null; link?: string | null; actorId?: string | Types.ObjectId | null; dedupeKey?: string | null }

export function serializeNotification(n: Record<string, unknown>) {
  return { id: String(n._id), type: n.type as NotificationType, title: n.title as string, body: (n.body as string | null) ?? null, link: (n.link as string | null) ?? null, readAt: (n.readAt as Date | null) ?? null, createdAt: n.createdAt as Date };
}

/** Single write path for notifications (spec 12.16): persists, then pushes `notification:new` to the user's room. */
export async function notify(companyId: string | Types.ObjectId, input: NotifyInput) {
  const ctx = { companyId: String(companyId) };
  if (input.actorId && String(input.actorId) === String(input.userId)) return null; // never notify yourself about your own action
  try {
    const n = await scoped(Notification, ctx).create({ userId: new Types.ObjectId(String(input.userId)), type: input.type, title: input.title, body: input.body ?? null, link: input.link ?? null, actorId: input.actorId ? new Types.ObjectId(String(input.actorId)) : null, dedupeKey: input.dedupeKey ?? null });
    const dto = serializeNotification(n.toObject() as Record<string, unknown>);
    realtime().emitToUser(String(input.userId), "notification:new", dto);
    return dto;
  } catch (e) {
    if ((e as { code?: number }).code === 11000) return null; // deduplicated reminder
    throw e;
  }
}

export async function notifyMany(companyId: string | Types.ObjectId, userIds: (string | Types.ObjectId)[], input: Omit<NotifyInput, "userId">) {
  const seen = new Set<string>();
  for (const id of userIds) { const s = String(id); if (seen.has(s)) continue; seen.add(s); await notify(companyId, { ...input, userId: s }); }
}

export async function listNotifications(ctx: { companyId: string; userId: string }, q: { unread?: boolean; limit?: number }) {
  const filter: Record<string, unknown> = { userId: new Types.ObjectId(ctx.userId) };
  if (q.unread) filter.readAt = null;
  const [rows, unread] = await Promise.all([
    scoped(Notification, ctx).find(filter).sort({ createdAt: -1 }).limit(q.limit ?? 30).lean(),
    scoped(Notification, ctx).countDocuments({ userId: new Types.ObjectId(ctx.userId), readAt: null }),
  ]);
  return { items: rows.map((r) => serializeNotification(r as Record<string, unknown>)), unread };
}

export async function markRead(ctx: { companyId: string; userId: string }, ids: string[] | "all") {
  const filter: Record<string, unknown> = { userId: new Types.ObjectId(ctx.userId), readAt: null };
  if (ids !== "all") filter._id = { $in: ids.filter((i) => Types.ObjectId.isValid(i)).map((i) => new Types.ObjectId(i)) };
  const r = await scoped(Notification, ctx).updateMany(filter, { $set: { readAt: new Date() } });
  const unread = await scoped(Notification, ctx).countDocuments({ userId: new Types.ObjectId(ctx.userId), readAt: null });
  realtime().emitToUser(ctx.userId, "notification:read", { unread });
  return { updated: r.modifiedCount, unread };
}
