import { Types } from "mongoose";
import { scoped, pop } from "@/lib/db/scoped";
import { Conversation, type ConversationDoc } from "@/models/Conversation";
import { Message, type MessageAttachment } from "@/models/Message";
import { User } from "@/models/User";
import { Team } from "@/models/Team";
import { Project } from "@/models/Project";
import { Errors } from "@/lib/api/errors";
import { realtime } from "@/lib/realtime";
import { storage } from "@/lib/storage";
import { presence } from "@/lib/realtime/presence";
import type { CompanyContext } from "@/lib/auth/context";
import { ROLE_LABEL } from "@/types";
import { notify, notifyMany } from "./notificationService";
import { projectScopeFilter } from "./scope";

export const conversationRoom = (conversationId: string) => `conversation:${conversationId}`;
const oid = (v: string) => new Types.ObjectId(v);
type Conv = ConversationDoc & { _id: Types.ObjectId };

/** Teams and projects whose channels the caller may read. Admins see every channel; nobody sees DMs they are not in. */
async function channelScope(ctx: CompanyContext) {
  const me = oid(ctx.userId);
  const teamFilter: Record<string, unknown> = ctx.role === "COMPANY_ADMIN" ? { archivedAt: null } : { archivedAt: null, $or: [{ _id: ctx.teamId ? oid(ctx.teamId) : new Types.ObjectId() }, { managerId: me }, { leadId: me }] };
  const [teams, projects] = await Promise.all([
    scoped(Team, ctx).find(teamFilter).select("_id name").lean(),
    scoped(Project, ctx).find({ ...(await projectScopeFilter(ctx)), archivedAt: null }).select("_id name").lean(),
  ]);
  return { teamIds: teams.map((t) => t._id), projectIds: projects.map((p) => p._id), teams, projects };
}

async function accessFilter(ctx: CompanyContext): Promise<Record<string, unknown>> {
  const { teamIds, projectIds } = await channelScope(ctx);
  return { $or: [{ type: "dm", participantIds: oid(ctx.userId) }, { type: "team", teamId: { $in: teamIds } }, { type: "project", projectId: { $in: projectIds } }] };
}

/** Membership check used by the API and by the socket `chat:join` handler. Cross-tenant and non-members get 404. */
export async function getAccessibleConversation(ctx: CompanyContext, conversationId: string): Promise<Conv> {
  const conv = await scoped(Conversation, ctx).findOne({ ...(await accessFilter(ctx)), _id: Types.ObjectId.isValid(conversationId) ? oid(conversationId) : new Types.ObjectId() }).lean();
  if (!conv) throw Errors.notFound("Conversation");
  return conv as Conv;
}

/** People who belong to a conversation (for mentions, read receipts and notifications). */
export async function conversationMembers(ctx: { companyId: string }, conv: Conv) {
  let filter: Record<string, unknown>;
  if (conv.type === "dm") filter = { _id: { $in: conv.participantIds } };
  else if (conv.type === "team") {
    const team = await scoped(Team, ctx).findById(String(conv.teamId)).select("leadId managerId").lean();
    filter = { $or: [{ teamId: conv.teamId }, { _id: { $in: [team?.leadId, team?.managerId].filter(Boolean) } }, { role: "COMPANY_ADMIN" }] };
  } else {
    const project = await scoped(Project, ctx).findById(String(conv.projectId)).select("memberIds managerId").lean();
    filter = { $or: [{ _id: { $in: [...(project?.memberIds ?? []), project?.managerId].filter(Boolean) } }, { role: "COMPANY_ADMIN" }] };
  }
  const users = await scoped(User, ctx).find({ ...filter, archivedAt: null, status: "active" }).select("name avatarUrl role").sort({ name: 1 }).lean();
  return users.map((u) => ({ id: String(u._id), name: u.name, avatarUrl: u.avatarUrl ?? null, role: u.role, online: presence.isOnline(String(u._id)) }));
}

/** Lazily creates team/project channels the caller can see, then lists everything with unread counts. */
export async function listConversations(ctx: CompanyContext) {
  const { teams, projects } = await channelScope(ctx);
  for (const t of teams) if (!(await scoped(Conversation, ctx).exists({ teamId: t._id }))) await scoped(Conversation, ctx).create({ type: "team", teamId: t._id, participantIds: [], createdBy: null }).catch(() => null);
  for (const p of projects) if (!(await scoped(Conversation, ctx).exists({ projectId: p._id }))) await scoped(Conversation, ctx).create({ type: "project", projectId: p._id, participantIds: [], createdBy: null }).catch(() => null);
  const convs = await scoped(Conversation, ctx).find(await accessFilter(ctx)).sort({ lastMessageAt: -1, createdAt: -1 }).populate([pop("participantIds", "name avatarUrl"), pop("teamId", "name"), pop("projectId", "name"), pop("lastMessageSenderId", "name")]).lean();
  const me = ctx.userId;
  const rows = await Promise.all(convs.map(async (c) => {
    const myRead = c.reads.find((r) => String(r.userId) === me)?.at ?? new Date(0);
    const unread = await scoped(Message, ctx).countDocuments({ conversationId: c._id, createdAt: { $gt: myRead }, senderId: { $ne: oid(me) }, deletedAt: null });
    const other = c.type === "dm" ? (c.participantIds as unknown as { _id: unknown; name: string; avatarUrl?: string | null }[]).find((p) => String(p._id) !== me) : null;
    const name = c.type === "dm" ? other?.name ?? "Direct message" : c.type === "team" ? `# ${(c.teamId as unknown as { name?: string })?.name ?? "team"}` : `# ${(c.projectId as unknown as { name?: string })?.name ?? "project"}`;
    return {
      id: String(c._id), type: c.type, name, avatarUrl: other?.avatarUrl ?? null, otherUserId: other ? String(other._id) : null, online: other ? presence.isOnline(String(other._id)) : null,
      teamId: c.teamId ? String((c.teamId as unknown as { _id?: unknown })._id ?? c.teamId) : null, projectId: c.projectId ? String((c.projectId as unknown as { _id?: unknown })._id ?? c.projectId) : null,
      lastMessageAt: c.lastMessageAt, lastMessagePreview: c.lastMessagePreview, lastMessageSender: (c.lastMessageSenderId as unknown as { name?: string } | null)?.name ?? null, unread,
    };
  }));
  return rows.sort((a, b) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0));
}

export async function openDm(ctx: CompanyContext, otherUserId: string) {
  if (otherUserId === ctx.userId) throw Errors.bad("SELF_DM", "You cannot message yourself");
  const other = await scoped(User, ctx).findOne({ _id: Types.ObjectId.isValid(otherUserId) ? oid(otherUserId) : new Types.ObjectId(), archivedAt: null, status: "active" }).select("_id").lean();
  if (!other) throw Errors.notFound("User");
  const key = [ctx.userId, otherUserId].sort().join(":");
  const conv = await scoped(Conversation, ctx).findOneAndUpdate({ dmKey: key }, { $setOnInsert: { type: "dm", dmKey: key, participantIds: [oid(ctx.userId), other._id], createdBy: oid(ctx.userId) } }, { upsert: true });
  return { id: String(conv!._id) };
}

const senderOf = (v: unknown) => (v && typeof v === "object" && "name" in v ? { id: String((v as unknown as { _id: unknown })._id), name: (v as { name: string }).name, avatarUrl: (v as { avatarUrl?: string | null }).avatarUrl ?? null } : null);

export async function serializeMessage(m: Record<string, unknown>) {
  const deleted = Boolean(m.deletedAt);
  const reply = m.replyTo && typeof m.replyTo === "object" && "body" in (m.replyTo as object) ? (m.replyTo as { _id: unknown; body: string; senderId: unknown; deletedAt?: Date | null }) : null;
  const attachments = await Promise.all(((m.attachments as MessageAttachment[]) ?? []).map(async (a) => ({ id: String(a._id), name: a.name, size: a.size, mime: a.mime, url: await storage().getSignedUrl(a.key, 3600) })));
  return {
    id: String(m._id), conversationId: String(m.conversationId), sender: senderOf(m.senderId), senderId: m.senderId && typeof m.senderId === "object" && "_id" in (m.senderId as object) ? String((m.senderId as { _id: unknown })._id) : String(m.senderId),
    body: deleted ? "" : (m.body as string), deleted, attachments: deleted ? [] : attachments, mentions: ((m.mentions as unknown[]) ?? []).map(String),
    replyTo: reply ? { id: String(reply._id), body: reply.deletedAt ? "Message deleted" : reply.body.slice(0, 140), sender: senderOf(reply.senderId)?.name ?? null } : null,
    editedAt: (m.editedAt as Date | null) ?? null, createdAt: m.createdAt as Date,
  };
}

const MSG_POPULATE = [pop("senderId", "name avatarUrl"), { path: "replyTo", select: "body senderId deletedAt", options: { skipTenantGuard: true }, populate: { path: "senderId", select: "name", options: { skipTenantGuard: true } } }];

export async function listMessages(ctx: CompanyContext, conversationId: string, q: { before?: string; limit?: number }) {
  const conv = await getAccessibleConversation(ctx, conversationId);
  const filter: Record<string, unknown> = { conversationId: conv._id };
  if (q.before && Types.ObjectId.isValid(q.before)) filter._id = { $lt: oid(q.before) };
  const limit = Math.min(q.limit ?? 50, 100);
  const rows = await scoped(Message, ctx).find(filter).sort({ _id: -1 }).limit(limit + 1).populate(MSG_POPULATE).lean();
  const hasMore = rows.length > limit;
  const messages = await Promise.all(rows.slice(0, limit).reverse().map((m) => serializeMessage(m as Record<string, unknown>)));
  const members = await conversationMembers(ctx, conv);
  return { conversation: { id: String(conv._id), type: conv.type, reads: conv.reads.map((r) => ({ userId: String(r.userId), at: r.at })) }, members, messages, hasMore };
}

/** Send: validates mentions against members, persists, fans out `chat:message`, notifies DM recipients and mentioned people. */
export async function sendMessage(ctx: CompanyContext, input: { conversationId: string; body: string; mentions?: string[]; replyTo?: string | null; attachment?: { key: string; name: string; size: number; mime: string } }) {
  const conv = await getAccessibleConversation(ctx, input.conversationId);
  const members = await conversationMembers(ctx, conv);
  const memberIds = new Set(members.map((m) => m.id));
  const mentions = (input.mentions ?? []).filter((m) => memberIds.has(m) && m !== ctx.userId);
  if (input.replyTo && !(await scoped(Message, ctx).exists({ _id: input.replyTo, conversationId: conv._id }))) throw Errors.notFound("Message");
  if (!input.body.trim() && !input.attachment) throw Errors.bad("EMPTY_MESSAGE", "Write something or attach a file");
  const now = new Date();
  const created = await scoped(Message, ctx).create({ conversationId: conv._id, senderId: oid(ctx.userId), body: input.body.trim(), mentions: mentions.map(oid), replyTo: input.replyTo ? oid(input.replyTo) : null, attachments: input.attachment ? [input.attachment] : [], readBy: [{ userId: oid(ctx.userId), at: now }] });
  const preview = input.body.trim() ? input.body.trim().slice(0, 120) : `Attachment: ${input.attachment?.name}`;
  await scoped(Conversation, ctx).updateOne({ _id: conv._id }, { $set: { lastMessageAt: now, lastMessagePreview: preview, lastMessageSenderId: oid(ctx.userId) }, $pull: { reads: { userId: oid(ctx.userId) } } });
  await scoped(Conversation, ctx).updateOne({ _id: conv._id }, { $push: { reads: { userId: oid(ctx.userId), at: now } } });
  const full = await scoped(Message, ctx).findById(String(created._id)).populate(MSG_POPULATE).lean();
  const dto = await serializeMessage(full as Record<string, unknown>);
  realtime().emitToRoom(ctx.companyId, conversationRoom(String(conv._id)), "chat:message", dto);
  for (const m of members) if (m.id !== ctx.userId) realtime().emitToUser(m.id, "chat:activity", { conversationId: String(conv._id), preview, from: ctx.name, at: now });
  const convLabel = conv.type === "dm" ? "" : ` in ${members.length > 0 ? "a channel" : "chat"}`;
  if (conv.type === "dm") {
    const other = members.find((m) => m.id !== ctx.userId);
    if (other) await notify(ctx.companyId, { userId: other.id, type: "MESSAGE", title: `New message from ${ctx.name}`, body: preview, link: `/chat?c=${conv._id}`, actorId: ctx.userId });
  }
  await notifyMany(ctx.companyId, mentions, { type: "MENTION", title: `${ctx.name} mentioned you${convLabel}`, body: preview, link: `/chat?c=${conv._id}`, actorId: ctx.userId });
  return dto;
}

export async function editMessage(ctx: CompanyContext, id: string, body: string) {
  const msg = await scoped(Message, ctx).findOne({ _id: Types.ObjectId.isValid(id) ? oid(id) : new Types.ObjectId(), senderId: oid(ctx.userId), deletedAt: null });
  if (!msg) throw Errors.notFound("Message");
  msg.body = body.trim(); msg.editedAt = new Date();
  await msg.save();
  const full = await scoped(Message, ctx).findById(id).populate(MSG_POPULATE).lean();
  const dto = await serializeMessage(full as Record<string, unknown>);
  realtime().emitToRoom(ctx.companyId, conversationRoom(String(msg.conversationId)), "chat:message-updated", dto);
  return dto;
}

export async function deleteMessage(ctx: CompanyContext, id: string) {
  const msg = await scoped(Message, ctx).findOne({ _id: Types.ObjectId.isValid(id) ? oid(id) : new Types.ObjectId(), senderId: oid(ctx.userId), deletedAt: null });
  if (!msg) throw Errors.notFound("Message");
  for (const a of msg.attachments as MessageAttachment[]) await storage().delete(a.key).catch(() => {});
  msg.deletedAt = new Date(); msg.set("attachments", []);
  await msg.save();
  const dto = await serializeMessage({ ...msg.toObject(), senderId: { _id: msg.senderId, name: ctx.name } } as Record<string, unknown>);
  realtime().emitToRoom(ctx.companyId, conversationRoom(String(msg.conversationId)), "chat:message-updated", dto);
  return dto;
}

/** Read receipt: moves the caller's cursor and tells the room (spec 12.15 read/unread). */
export async function markConversationRead(ctx: CompanyContext, conversationId: string) {
  const conv = await getAccessibleConversation(ctx, conversationId);
  const now = new Date();
  await scoped(Conversation, ctx).updateOne({ _id: conv._id }, { $pull: { reads: { userId: oid(ctx.userId) } } });
  await scoped(Conversation, ctx).updateOne({ _id: conv._id }, { $push: { reads: { userId: oid(ctx.userId), at: now } } });
  await scoped(Message, ctx).updateMany({ conversationId: conv._id, senderId: { $ne: oid(ctx.userId) }, "readBy.userId": { $ne: oid(ctx.userId) } }, { $push: { readBy: { userId: oid(ctx.userId), at: now } } });
  realtime().emitToRoom(ctx.companyId, conversationRoom(String(conv._id)), "chat:read", { conversationId: String(conv._id), userId: ctx.userId, name: ctx.name, at: now });
  return { at: now };
}

export async function searchMessages(ctx: CompanyContext, q: string, limit = 20) {
  const convs = await scoped(Conversation, ctx).find(await accessFilter(ctx)).select("_id type teamId projectId participantIds").populate([pop("teamId", "name"), pop("projectId", "name"), pop("participantIds", "name")]).lean();
  const names = new Map(convs.map((c) => [String(c._id), c.type === "dm" ? (c.participantIds as unknown as { _id: unknown; name: string }[]).filter((p) => String(p._id) !== ctx.userId).map((p) => p.name).join(", ") : `# ${((c.teamId ?? c.projectId) as unknown as { name?: string })?.name ?? ""}`]));
  const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rows = await scoped(Message, ctx).find({ conversationId: { $in: convs.map((c) => c._id) }, deletedAt: null, body: { $regex: safe, $options: "i" } }).sort({ createdAt: -1 }).limit(limit).populate(pop("senderId", "name")).lean();
  return rows.map((m) => ({ id: String(m._id), conversationId: String(m.conversationId), conversation: names.get(String(m.conversationId)) ?? "", sender: senderOf(m.senderId)?.name ?? null, body: m.body, createdAt: m.createdAt }));
}

export async function totalUnread(ctx: CompanyContext) {
  const convs = await scoped(Conversation, ctx).find(await accessFilter(ctx)).select("_id reads").lean();
  let n = 0;
  for (const c of convs) {
    const myRead = c.reads.find((r) => String(r.userId) === ctx.userId)?.at ?? new Date(0);
    n += await scoped(Message, ctx).countDocuments({ conversationId: c._id, createdAt: { $gt: myRead }, senderId: { $ne: oid(ctx.userId) }, deletedAt: null });
  }
  return n;
}

/** People picker for new DMs (A62): every active colleague, regardless of the caller's employee-list permissions. */
export async function listChatPeople(ctx: CompanyContext) {
  const users = await scoped(User, ctx).find({ archivedAt: null, status: "active", _id: { $ne: oid(ctx.userId) } }).select("name avatarUrl role designation").sort({ name: 1 }).lean();
  return users.map((u) => ({ id: String(u._id), name: u.name, avatarUrl: (u.avatarUrl as string | null) ?? null, roleLabel: ROLE_LABEL[u.role as keyof typeof ROLE_LABEL] ?? u.role, designation: (u.designation as string | null) ?? null, online: presence.isOnline(String(u._id)) }));
}
