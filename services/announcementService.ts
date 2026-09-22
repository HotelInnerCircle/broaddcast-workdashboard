import { Types } from "mongoose";
import { scoped, pop } from "@/lib/db/scoped";
import { Announcement } from "@/models/Announcement";
import { User } from "@/models/User";
import { audit } from "@/lib/audit";
import { realtime } from "@/lib/realtime";
import type { CompanyContext } from "@/lib/auth/context";
import { notifyMany } from "./notificationService";

const author = (v: unknown) => (v && typeof v === "object" && "name" in v ? { id: String((v as unknown as { _id: unknown })._id), name: (v as { name: string }).name, avatarUrl: (v as { avatarUrl?: string | null }).avatarUrl ?? null } : null);
const serialize = (a: Record<string, unknown>) => ({ id: String(a._id), title: a.title as string, body: a.body as string, author: author(a.authorId), createdAt: a.createdAt as Date });

export async function listAnnouncements(ctx: CompanyContext, limit = 50) {
  const rows = await scoped(Announcement, ctx).find({}).sort({ createdAt: -1 }).limit(limit).populate(pop("authorId", "name avatarUrl")).lean();
  return rows.map((r) => serialize(r as Record<string, unknown>));
}

/** Admin/Manager posts; every active user in the company is notified (spec 12.21). */
export async function createAnnouncement(ctx: CompanyContext, input: { title: string; body: string }, ip: string | null) {
  const a = await scoped(Announcement, ctx).create({ authorId: new Types.ObjectId(ctx.userId), title: input.title, body: input.body });
  const full = await scoped(Announcement, ctx).findById(String(a._id)).populate(pop("authorId", "name avatarUrl")).lean();
  const dto = serialize(full as Record<string, unknown>);
  await audit({ ctx, companyId: ctx.companyId, entity: "announcement", entityId: a._id, action: "announcement.created", summary: `${ctx.name} announced "${input.title}"`, after: { title: input.title }, ip });
  const users = await scoped(User, ctx).find({ archivedAt: null, status: "active" }).select("_id").lean();
  await notifyMany(ctx.companyId, users.map((u) => String(u._id)), { type: "ANNOUNCEMENT", title: input.title, body: input.body.slice(0, 160), link: "/announcements", actorId: ctx.userId });
  realtime().emitToCompany(ctx.companyId, "announcement:new", { id: dto.id, title: dto.title, author: dto.author?.name ?? null });
  return dto;
}
