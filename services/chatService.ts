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
import { isOnlineUser } from "@/lib/realtime/presence";
import type { CompanyContext } from "@/lib/auth/context";
import { ROLE_LABEL } from "@/types";
import { notify, notifyMany } from "./notificationService";
import { projectScopeFilter } from "./scope";

/**
 * Everyone who should receive this conversation's events (A76: fan-out replaced shared rooms).
 * A DM and a hand-made channel already carry their member list, so routing needs no query at all -
 * which matters because this runs on every message, receipt and tick.
 */
async function memberIdsOf(ctx: CompanyContext, conv: Conv): Promise<string[]> {
  if (conv.type === "dm" || conv.type === "channel") return conv.participantIds.map(String);
  return (await conversationMembers(ctx, conv)).map((m) => m.id);
}
const oid = (v: string) => new Types.ObjectId(v);
const isId = (v: string) => Types.ObjectId.isValid(v);
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

/**
 * Everything the caller may open. A hand-made channel (A72) is visible to its members only - except
 * to the Company Admin, who already sees every team channel and stays able to moderate.
 */
async function accessFilter(ctx: CompanyContext): Promise<Record<string, unknown>> {
  const { teamIds, projectIds } = await channelScope(ctx);
  const me = oid(ctx.userId);
  return {
    $or: [
      { type: "dm", participantIds: me },
      { type: "team", teamId: { $in: teamIds } },
      { type: "project", projectId: { $in: projectIds } },
      ctx.role === "COMPANY_ADMIN" ? { type: "channel" } : { type: "channel", participantIds: me },
    ],
  };
}

/** Membership check used by the API and by the socket `chat:join` handler. Cross-tenant and non-members get 404. */
export async function getAccessibleConversation(ctx: CompanyContext, conversationId: string): Promise<Conv> {
  const conv = await scoped(Conversation, ctx).findOne({ ...(await accessFilter(ctx)), _id: isId(conversationId) ? oid(conversationId) : new Types.ObjectId() }).lean();
  if (!conv) throw Errors.notFound("Conversation");
  return conv as Conv;
}

/** People who belong to a conversation (for mentions, read receipts and notifications). */
export async function conversationMembers(ctx: { companyId: string }, conv: Conv) {
  let filter: Record<string, unknown>;
  if (conv.type === "dm" || conv.type === "channel") filter = { _id: { $in: conv.participantIds } };
  else if (conv.type === "team") {
    const team = await scoped(Team, ctx).findById(String(conv.teamId)).select("leadId managerId").lean();
    filter = { $or: [{ teamId: conv.teamId }, { _id: { $in: [team?.leadId, team?.managerId].filter(Boolean) } }, { role: "COMPANY_ADMIN" }] };
  } else {
    const project = await scoped(Project, ctx).findById(String(conv.projectId)).select("memberIds managerId").lean();
    filter = { $or: [{ _id: { $in: [...(project?.memberIds ?? []), project?.managerId].filter(Boolean) } }, { role: "COMPANY_ADMIN" }] };
  }
  const users = await scoped(User, ctx).find({ ...filter, archivedAt: null, status: "active" }).select("name avatarUrl role lastActiveAt").sort({ name: 1 }).lean();
  return users.map((u) => ({ id: String(u._id), name: u.name, avatarUrl: u.avatarUrl ?? null, role: u.role, online: isOnlineUser(String(u._id), u.lastActiveAt) }));
}

const channelName = (c: { name?: string | null }) => `# ${c.name ?? "channel"}`;

/** Has every other member's read cursor caught up with the last message? Drives the tick in the chat list. */
function everyoneRead(c: { participantIds: unknown[]; reads: { userId: unknown; at: Date }[]; lastMessageAt?: Date | null }, meId: string): boolean {
  if (!c.lastMessageAt) return false;
  const others = c.participantIds.map((p) => String((p as { _id?: unknown })?._id ?? p)).filter((id) => id !== meId);
  if (others.length === 0) return false;
  return others.every((id) => { const at = c.reads.find((r) => String(r.userId) === id)?.at; return at ? at >= c.lastMessageAt! : false; });
}

/** Lazily creates team/project channels the caller can see, then lists everything with unread counts. */
export async function listConversations(ctx: CompanyContext) {
  const { teams, projects } = await channelScope(ctx);
  for (const t of teams) if (!(await scoped(Conversation, ctx).exists({ teamId: t._id }))) await scoped(Conversation, ctx).create({ type: "team", teamId: t._id, participantIds: [], createdBy: null }).catch(() => null);
  for (const p of projects) if (!(await scoped(Conversation, ctx).exists({ projectId: p._id }))) await scoped(Conversation, ctx).create({ type: "project", projectId: p._id, participantIds: [], createdBy: null }).catch(() => null);
  const convs = await scoped(Conversation, ctx).find({ ...(await accessFilter(ctx)), archivedAt: null }).sort({ lastMessageAt: -1, createdAt: -1 }).populate([pop("participantIds", "name avatarUrl lastActiveAt"), pop("teamId", "name"), pop("projectId", "name"), pop("lastMessageSenderId", "name")]).lean();
  const me = ctx.userId;
  const rows = await Promise.all(convs.map(async (c) => {
    const myRead = c.reads.find((r) => String(r.userId) === me)?.at ?? new Date(0);
    const unread = await scoped(Message, ctx).countDocuments({ conversationId: c._id, createdAt: { $gt: myRead }, senderId: { $ne: oid(me) }, deletedAt: null });
    const participants = c.participantIds as unknown as { _id: unknown; name: string; avatarUrl?: string | null; lastActiveAt?: Date | null }[];
    const other = c.type === "dm" ? participants.find((p) => String(p._id) !== me) : null;
    const name = c.type === "dm" ? other?.name ?? "Direct message"
      : c.type === "channel" ? channelName(c)
      : c.type === "team" ? `# ${(c.teamId as unknown as { name?: string })?.name ?? "team"}`
      : `# ${(c.projectId as unknown as { name?: string })?.name ?? "project"}`;
    return {
      id: String(c._id), type: c.type, name, description: c.description ?? null, avatarUrl: other?.avatarUrl ?? null, otherUserId: other ? String(other._id) : null, online: other ? isOnlineUser(String(other._id), other.lastActiveAt) : null,
      teamId: c.teamId ? String((c.teamId as unknown as { _id?: unknown })._id ?? c.teamId) : null, projectId: c.projectId ? String((c.projectId as unknown as { _id?: unknown })._id ?? c.projectId) : null,
      memberCount: c.type === "channel" ? participants.length : null, canManage: c.type === "channel" && canManageChannel(ctx, c as unknown as Conv),
      lastMessageAt: c.lastMessageAt, lastMessagePreview: c.lastMessagePreview, lastMessageSender: (c.lastMessageSenderId as unknown as { name?: string } | null)?.name ?? null, unread,
      lastMessageSenderId: c.lastMessageSenderId ? String((c.lastMessageSenderId as unknown as { _id?: unknown })._id ?? c.lastMessageSenderId) : null,
      // Tick on your own last message in the list. Only rows with a known member list can answer it;
      // team and project channels take their membership from elsewhere, so they stay null (no tick).
      lastMessageRead: c.type === "dm" || c.type === "channel" ? everyoneRead(c, me) : null,
    };
  }));
  return rows.sort((a, b) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0));
}

export async function openDm(ctx: CompanyContext, otherUserId: string) {
  if (otherUserId === ctx.userId) throw Errors.bad("SELF_DM", "You cannot message yourself");
  const other = await scoped(User, ctx).findOne({ _id: isId(otherUserId) ? oid(otherUserId) : new Types.ObjectId(), archivedAt: null, status: "active" }).select("_id").lean();
  if (!other) throw Errors.notFound("User");
  const key = [ctx.userId, otherUserId].sort().join(":");
  const conv = await scoped(Conversation, ctx).findOneAndUpdate({ dmKey: key }, { $setOnInsert: { type: "dm", dmKey: key, participantIds: [oid(ctx.userId), other._id], createdBy: oid(ctx.userId) } }, { upsert: true });
  return { id: String(conv!._id) };
}

/* ------------------------------------------------------------------ channels (A72) */

/** The owner of a channel, or any Company Admin, may rename it and change its members. */
function canManageChannel(ctx: CompanyContext, conv: Conv) {
  return ctx.role === "COMPANY_ADMIN" || String(conv.createdBy ?? "") === ctx.userId;
}

/** Only people who actually exist in this company can be added - ids from elsewhere are dropped. */
async function validMemberIds(ctx: CompanyContext, ids: string[]) {
  const wanted = [...new Set(ids.filter(isId))].map(oid);
  if (wanted.length === 0) return [];
  const users = await scoped(User, ctx).find({ _id: { $in: wanted }, archivedAt: null, status: "active" }).select("_id").lean();
  return users.map((u) => u._id as Types.ObjectId);
}

export async function createChannel(ctx: CompanyContext, input: { name: string; description?: string | null; members: string[] }) {
  const members = await validMemberIds(ctx, [...input.members, ctx.userId]);
  const conv = await scoped(Conversation, ctx).create({ type: "channel", name: input.name, description: input.description ?? null, participantIds: members, createdBy: oid(ctx.userId) });
  const id = String(conv._id);
  for (const m of members) realtime().emitToUser(String(m), "chat:activity", { conversationId: id, preview: `You were added to # ${input.name}`, from: ctx.name, at: new Date() });
  await notifyMany(ctx.companyId, members.map(String).filter((m) => m !== ctx.userId), { type: "MESSAGE", title: `${ctx.name} added you to # ${input.name}`, body: input.description ?? "", link: `/chat?c=${id}`, actorId: ctx.userId });
  return { id, name: input.name };
}

/** Rename / re-describe / archive or restore. Archiving hides the channel without losing its history. */
export async function updateChannel(ctx: CompanyContext, id: string, input: { name?: string; description?: string | null; members?: string[]; archived?: boolean }) {
  const conv = await getManageableChannel(ctx, id);
  const set: Record<string, unknown> = {};
  if (input.name !== undefined) set.name = input.name;
  if (input.description !== undefined) set.description = input.description ?? null;
  if (input.archived !== undefined) set.archivedAt = input.archived ? new Date() : null;
  if (input.members) set.participantIds = await validMemberIds(ctx, [...input.members, String(conv.createdBy ?? ctx.userId)]);
  await scoped(Conversation, ctx).updateOne({ _id: conv._id }, { $set: set });
  const touched = ((set.participantIds as Types.ObjectId[] | undefined) ?? conv.participantIds).map(String);
  realtime().emitToUsers(touched, "chat:conversation-updated", { conversationId: id });
  for (const m of (set.participantIds as Types.ObjectId[] | undefined) ?? conv.participantIds) realtime().emitToUser(String(m), "chat:activity", { conversationId: id, preview: "Channel updated", from: ctx.name, at: new Date() });
  return { id };
}

export async function setChannelMembers(ctx: CompanyContext, id: string, input: { add?: string[]; remove?: string[] }) {
  const conv = await getManageableChannel(ctx, id);
  const owner = String(conv.createdBy ?? ctx.userId);
  const current = new Set(conv.participantIds.map(String));
  for (const a of await validMemberIds(ctx, input.add ?? [])) current.add(String(a));
  for (const r of input.remove ?? []) if (r !== owner) current.delete(r); // the owner cannot be removed from their own channel
  const next = [...current].filter(isId).map(oid);
  await scoped(Conversation, ctx).updateOne({ _id: conv._id }, { $set: { participantIds: next } });
  realtime().emitToUsers([...next.map(String), ...(input.remove ?? [])], "chat:conversation-updated", { conversationId: id });
  for (const m of [...next.map(String), ...(input.remove ?? [])]) realtime().emitToUser(m, "chat:activity", { conversationId: id, preview: "Channel members changed", from: ctx.name, at: new Date() });
  await notifyMany(ctx.companyId, (input.add ?? []).filter((m) => m !== ctx.userId), { type: "MESSAGE", title: `${ctx.name} added you to # ${conv.name}`, body: "", link: `/chat?c=${id}`, actorId: ctx.userId });
  return { id, memberCount: next.length };
}

/** Permanent removal, with every message and stored attachment (the owner or an admin only). */
export async function deleteChannel(ctx: CompanyContext, id: string) {
  const conv = await getManageableChannel(ctx, id);
  const msgs = await scoped(Message, ctx).find({ conversationId: conv._id }).select("attachments").lean();
  for (const m of msgs) for (const a of (m.attachments as MessageAttachment[]) ?? []) await storage().delete(a.key).catch(() => {});
  await scoped(Message, ctx).deleteMany({ conversationId: conv._id });
  await scoped(Conversation, ctx).deleteOne({ _id: conv._id });
  for (const m of conv.participantIds) realtime().emitToUser(String(m), "chat:activity", { conversationId: id, preview: "Channel deleted", from: ctx.name, at: new Date() });
  return { id, deleted: true };
}

async function getManageableChannel(ctx: CompanyContext, id: string): Promise<Conv> {
  const conv = await scoped(Conversation, ctx).findOne({ _id: isId(id) ? oid(id) : new Types.ObjectId(), type: "channel" }).lean() as Conv | null;
  if (!conv) throw Errors.notFound("Channel");
  if (!canManageChannel(ctx, conv)) throw Errors.forbidden("Only the channel owner or a company admin can change this channel");
  return conv;
}

/** Channel detail for the manage dialog: who is in it, and everyone who could be added. */
export async function channelDetail(ctx: CompanyContext, id: string) {
  const conv = await getAccessibleConversation(ctx, id);
  if (conv.type !== "channel") throw Errors.notFound("Channel");
  const everyone = await listChatPeople(ctx);
  const memberIds = new Set(conv.participantIds.map(String));
  return {
    id: String(conv._id), name: conv.name ?? "", description: conv.description ?? null, archived: Boolean(conv.archivedAt),
    ownerId: conv.createdBy ? String(conv.createdBy) : null, canManage: canManageChannel(ctx, conv),
    // `people` is everyone except the caller; the caller's own membership is implied and never editable here.
    memberIds: [...memberIds], people: everyone,
  };
}

/* ------------------------------------------------------------------ messages */

const senderOf = (v: unknown) => (v && typeof v === "object" && "name" in v ? { id: String((v as unknown as { _id: unknown })._id), name: (v as { name: string }).name, avatarUrl: (v as { avatarUrl?: string | null }).avatarUrl ?? null } : null);
const receipts = (v: unknown) => ((v as { userId: unknown; at: Date }[] | undefined) ?? []).map((r) => ({ userId: String(r.userId), at: r.at }));

export async function serializeMessage(m: Record<string, unknown>) {
  const deleted = Boolean(m.deletedAt);
  const reply = m.replyTo && typeof m.replyTo === "object" && "body" in (m.replyTo as object) ? (m.replyTo as { _id: unknown; body: string; senderId: unknown; deletedAt?: Date | null; attachments?: MessageAttachment[] }) : null;
  const id = String(m._id);
  const attachments = await Promise.all(((m.attachments as MessageAttachment[]) ?? []).map(async (a) => ({
    id: String(a._id), name: a.name, size: a.size, mime: a.mime, width: a.width ?? null, height: a.height ?? null,
    url: await storage().getSignedUrl(a.key, 3600),
    // Served through the app so the browser gets a filename and a real Save dialog (A72).
    downloadUrl: `/api/chat/messages/${id}/attachments/${String(a._id)}`,
  })));
  return {
    id, conversationId: String(m.conversationId), sender: senderOf(m.senderId), senderId: m.senderId && typeof m.senderId === "object" && "_id" in (m.senderId as object) ? String((m.senderId as { _id: unknown })._id) : String(m.senderId),
    body: deleted ? "" : (m.body as string), deleted, attachments: deleted ? [] : attachments, mentions: ((m.mentions as unknown[]) ?? []).map(String),
    replyTo: reply ? { id: String(reply._id), body: reply.deletedAt ? "Message deleted" : reply.body.slice(0, 140), sender: senderOf(reply.senderId)?.name ?? null, attachmentCount: reply.deletedAt ? 0 : (reply.attachments ?? []).length } : null,
    deliveredTo: deleted ? [] : receipts(m.deliveredTo), readBy: deleted ? [] : receipts(m.readBy), forwarded: Boolean(m.forwarded) && !deleted,
    editedAt: (m.editedAt as Date | null) ?? null, createdAt: m.createdAt as Date,
  };
}
export type MessageDto = Awaited<ReturnType<typeof serializeMessage>>;

const MSG_POPULATE = [pop("senderId", "name avatarUrl"), { path: "replyTo", select: "body senderId deletedAt attachments", options: { skipTenantGuard: true }, populate: { path: "senderId", select: "name", options: { skipTenantGuard: true } } }];

export async function listMessages(ctx: CompanyContext, conversationId: string, q: { before?: string; limit?: number }) {
  const conv = await getAccessibleConversation(ctx, conversationId);
  const filter: Record<string, unknown> = { conversationId: conv._id };
  if (q.before && isId(q.before)) filter._id = { $lt: oid(q.before) };
  const limit = Math.min(q.limit ?? 50, 100);
  const rows = await scoped(Message, ctx).find(filter).sort({ _id: -1 }).limit(limit + 1).populate(MSG_POPULATE).lean();
  const hasMore = rows.length > limit;
  const messages = await Promise.all(rows.slice(0, limit).reverse().map((m) => serializeMessage(m as Record<string, unknown>)));
  const members = await conversationMembers(ctx, conv);
  return {
    conversation: {
      id: String(conv._id), type: conv.type, name: conv.type === "channel" ? conv.name ?? "" : null, description: conv.description ?? null,
      ownerId: conv.createdBy ? String(conv.createdBy) : null, canManage: conv.type === "channel" && canManageChannel(ctx, conv), archived: Boolean(conv.archivedAt),
      reads: conv.reads.map((r) => ({ userId: String(r.userId), at: r.at })),
    },
    members, messages, hasMore,
  };
}

/** Send: validates mentions against members, persists, fans out `chat:message`, notifies DM recipients and mentioned people. */
export async function sendMessage(ctx: CompanyContext, input: { conversationId: string; body: string; mentions?: string[]; replyTo?: string | null; attachments?: { key: string; name: string; size: number; mime: string; width?: number | null; height?: number | null }[] }) {
  const conv = await getAccessibleConversation(ctx, input.conversationId);
  if (conv.archivedAt) throw Errors.bad("CHANNEL_ARCHIVED", "This channel is archived");
  const members = await conversationMembers(ctx, conv);
  const memberIds = new Set(members.map((m) => m.id));
  const mentions = (input.mentions ?? []).filter((m) => memberIds.has(m) && m !== ctx.userId);
  if (input.replyTo && !(await scoped(Message, ctx).exists({ _id: input.replyTo, conversationId: conv._id }))) throw Errors.notFound("Message");
  const files = input.attachments ?? [];
  if (!input.body.trim() && files.length === 0) throw Errors.bad("EMPTY_MESSAGE", "Write something or attach a file");
  const now = new Date();
  const created = await scoped(Message, ctx).create({ conversationId: conv._id, senderId: oid(ctx.userId), body: input.body.trim(), mentions: mentions.map(oid), replyTo: input.replyTo ? oid(input.replyTo) : null, attachments: files, deliveredTo: [{ userId: oid(ctx.userId), at: now }], readBy: [{ userId: oid(ctx.userId), at: now }] });
  const preview = input.body.trim() ? input.body.trim().slice(0, 120) : files.length === 1 ? files[0].name : `${files.length} attachments`;
  await scoped(Conversation, ctx).updateOne({ _id: conv._id }, { $set: { lastMessageAt: now, lastMessagePreview: preview, lastMessageSenderId: oid(ctx.userId) }, $pull: { reads: { userId: oid(ctx.userId) } } });
  await scoped(Conversation, ctx).updateOne({ _id: conv._id }, { $push: { reads: { userId: oid(ctx.userId), at: now } } });
  const full = await scoped(Message, ctx).findById(String(created._id)).populate(MSG_POPULATE).lean();
  const dto = await serializeMessage(full as Record<string, unknown>);
  realtime().emitToUsers(members.map((m) => m.id), "chat:message", dto);
  for (const m of members) if (m.id !== ctx.userId) realtime().emitToUser(m.id, "chat:activity", { conversationId: String(conv._id), preview, from: ctx.name, at: now, messageId: dto.id });
  const convLabel = conv.type === "dm" ? "" : ` in ${conv.type === "channel" ? `# ${conv.name}` : "a channel"}`;
  if (conv.type === "dm") {
    const other = members.find((m) => m.id !== ctx.userId);
    if (other) await notify(ctx.companyId, { userId: other.id, type: "MESSAGE", title: `New message from ${ctx.name}`, body: preview, link: `/chat?c=${conv._id}`, actorId: ctx.userId });
  }
  await notifyMany(ctx.companyId, mentions, { type: "MENTION", title: `${ctx.name} mentioned you${convLabel}`, body: preview, link: `/chat?c=${conv._id}`, actorId: ctx.userId });
  return dto;
}

export async function editMessage(ctx: CompanyContext, id: string, body: string) {
  const msg = await scoped(Message, ctx).findOne({ _id: isId(id) ? oid(id) : new Types.ObjectId(), senderId: oid(ctx.userId), deletedAt: null });
  if (!msg) throw Errors.notFound("Message");
  msg.body = body.trim(); msg.editedAt = new Date();
  await msg.save();
  const full = await scoped(Message, ctx).findById(id).populate(MSG_POPULATE).lean();
  const dto = await serializeMessage(full as Record<string, unknown>);
  realtime().emitToUsers(await memberIdsOf(ctx, await getAccessibleConversation(ctx, String(msg.conversationId))), "chat:message-updated", dto);
  return dto;
}

export async function deleteMessage(ctx: CompanyContext, id: string) {
  const msg = await scoped(Message, ctx).findOne({ _id: isId(id) ? oid(id) : new Types.ObjectId(), senderId: oid(ctx.userId), deletedAt: null });
  if (!msg) throw Errors.notFound("Message");
  for (const a of msg.attachments as MessageAttachment[]) await storage().delete(a.key).catch(() => {});
  msg.deletedAt = new Date(); msg.set("attachments", []);
  await msg.save();
  const dto = await serializeMessage({ ...msg.toObject(), senderId: { _id: msg.senderId, name: ctx.name } } as Record<string, unknown>);
  realtime().emitToUsers(await memberIdsOf(ctx, await getAccessibleConversation(ctx, String(msg.conversationId))), "chat:message-updated", dto);
  return dto;
}

/**
 * Forward a message into other conversations (A73). Each target gets its own message, and each
 * attachment is copied to its own storage object - deleting the original later must not pull the
 * file out from under the forward. Targets the caller cannot post to are skipped, not an error.
 */
export async function forwardMessage(ctx: CompanyContext, messageId: string, conversationIds: string[]) {
  const source = await scoped(Message, ctx).findOne({ _id: isId(messageId) ? oid(messageId) : new Types.ObjectId(), deletedAt: null }).lean();
  if (!source) throw Errors.notFound("Message");
  await getAccessibleConversation(ctx, String(source.conversationId)); // must be able to see it to forward it
  const files = (source.attachments as MessageAttachment[]) ?? [];
  const sent: string[] = [];
  const skipped: string[] = [];
  for (const target of [...new Set(conversationIds)]) {
    let conv: Conv;
    try { conv = await getAccessibleConversation(ctx, target); } catch { skipped.push(target); continue; }
    if (conv.archivedAt) { skipped.push(target); continue; }
    const copies: { key: string; name: string; size: number; mime: string; width: number | null; height: number | null }[] = [];
    try {
      for (const [i, a] of files.entries()) {
        const key = `companies/${ctx.companyId}/chat/${target}/${Date.now()}-${i}-${a.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        await storage().copy(a.key, key);
        copies.push({ key, name: a.name, size: a.size, mime: a.mime, width: a.width ?? null, height: a.height ?? null });
      }
    } catch {
      for (const c of copies) await storage().delete(c.key).catch(() => {});
      skipped.push(target);
      continue;
    }
    const dto = await sendMessage(ctx, { conversationId: target, body: source.body as string, attachments: copies });
    await scoped(Message, ctx).updateOne({ _id: oid(dto.id) }, { $set: { forwarded: true } });
    realtime().emitToUsers(await memberIdsOf(ctx, conv), "chat:message-updated", { ...dto, forwarded: true });
    sent.push(target);
  }
  if (sent.length === 0) throw Errors.bad("FORWARD_FAILED", "The message could not be forwarded to any of those chats");
  return { sent, skipped };
}

/** One attachment, streamed through the app so access is checked and the browser gets a real filename (A72). */
export async function attachmentDownload(ctx: CompanyContext, messageId: string, attachmentId: string) {
  const msg = await scoped(Message, ctx).findOne({ _id: isId(messageId) ? oid(messageId) : new Types.ObjectId(), deletedAt: null }).lean();
  if (!msg) throw Errors.notFound("Message");
  await getAccessibleConversation(ctx, String(msg.conversationId)); // 404s for non-members and other tenants
  const a = ((msg.attachments as MessageAttachment[]) ?? []).find((x) => String(x._id) === attachmentId);
  if (!a) throw Errors.notFound("Attachment");
  return { url: await storage().getSignedUrl(a.key, 300), name: a.name, mime: a.mime };
}

/**
 * Second tick (A72). The recipient's browser calls this for messages it has just put on screen;
 * the sender's room hears `chat:delivered`. Only messages the caller did not send are marked.
 */
export async function markDelivered(ctx: CompanyContext, messageIds: string[]) {
  const ids = messageIds.filter(isId).map(oid);
  if (ids.length === 0) return { at: new Date(), conversationIds: [] as string[] };
  const now = new Date();
  const rows = await scoped(Message, ctx).find({ _id: { $in: ids }, senderId: { $ne: oid(ctx.userId) }, "deliveredTo.userId": { $ne: oid(ctx.userId) } }).select("_id conversationId").lean();
  if (rows.length === 0) return { at: now, conversationIds: [] };
  const allowed: string[] = [];
  const convById = new Map<string, Conv>();
  for (const convId of [...new Set(rows.map((r) => String(r.conversationId)))]) {
    try { convById.set(convId, await getAccessibleConversation(ctx, convId)); allowed.push(convId); } catch { /* not ours - skip */ }
  }
  const mine = rows.filter((r) => allowed.includes(String(r.conversationId)));
  if (mine.length === 0) return { at: now, conversationIds: [] };
  await scoped(Message, ctx).updateMany({ _id: { $in: mine.map((r) => r._id) } }, { $push: { deliveredTo: { userId: oid(ctx.userId), at: now } } });
  for (const convId of allowed) {
    realtime().emitToUsers(await memberIdsOf(ctx, convById.get(convId)!), "chat:delivered", { conversationId: convId, userId: ctx.userId, at: now, messageIds: mine.filter((r) => String(r.conversationId) === convId).map((r) => String(r._id)) });
  }
  return { at: now, conversationIds: allowed };
}

/** Read receipt: moves the caller's cursor and tells the room (spec 12.15 read/unread). */
export async function markConversationRead(ctx: CompanyContext, conversationId: string) {
  const conv = await getAccessibleConversation(ctx, conversationId);
  const now = new Date();
  await scoped(Conversation, ctx).updateOne({ _id: conv._id }, { $pull: { reads: { userId: oid(ctx.userId) } } });
  await scoped(Conversation, ctx).updateOne({ _id: conv._id }, { $push: { reads: { userId: oid(ctx.userId), at: now } } });
  // Reading implies delivery, so the second tick can never be missing under a blue one.
  await scoped(Message, ctx).updateMany({ conversationId: conv._id, senderId: { $ne: oid(ctx.userId) }, "deliveredTo.userId": { $ne: oid(ctx.userId) } }, { $push: { deliveredTo: { userId: oid(ctx.userId), at: now } } });
  await scoped(Message, ctx).updateMany({ conversationId: conv._id, senderId: { $ne: oid(ctx.userId) }, "readBy.userId": { $ne: oid(ctx.userId) } }, { $push: { readBy: { userId: oid(ctx.userId), at: now } } });
  // A73/A76: every member hears it, whether or not they have this thread open - that is what keeps
  // the sender's tick in the chat list correct and clears the reader's badge in their other tabs.
  realtime().emitToUsers(await memberIdsOf(ctx, conv), "chat:read", { conversationId: String(conv._id), userId: ctx.userId, name: ctx.name, at: now });
  return { at: now };
}

export async function searchMessages(ctx: CompanyContext, q: string, limit = 20) {
  const convs = await scoped(Conversation, ctx).find(await accessFilter(ctx)).select("_id type name teamId projectId participantIds").populate([pop("teamId", "name"), pop("projectId", "name"), pop("participantIds", "name")]).lean();
  const names = new Map(convs.map((c) => [String(c._id), c.type === "dm" ? (c.participantIds as unknown as { _id: unknown; name: string }[]).filter((p) => String(p._id) !== ctx.userId).map((p) => p.name).join(", ") : c.type === "channel" ? channelName(c) : `# ${((c.teamId ?? c.projectId) as unknown as { name?: string })?.name ?? ""}`]));
  const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rows = await scoped(Message, ctx).find({ conversationId: { $in: convs.map((c) => c._id) }, deletedAt: null, body: { $regex: safe, $options: "i" } }).sort({ createdAt: -1 }).limit(limit).populate(pop("senderId", "name")).lean();
  return rows.map((m) => ({ id: String(m._id), conversationId: String(m.conversationId), conversation: names.get(String(m.conversationId)) ?? "", sender: senderOf(m.senderId)?.name ?? null, body: m.body, createdAt: m.createdAt }));
}

export async function totalUnread(ctx: CompanyContext) {
  const convs = await scoped(Conversation, ctx).find({ ...(await accessFilter(ctx)), archivedAt: null }).select("_id reads").lean();
  let n = 0;
  for (const c of convs) {
    const myRead = c.reads.find((r) => String(r.userId) === ctx.userId)?.at ?? new Date(0);
    n += await scoped(Message, ctx).countDocuments({ conversationId: c._id, createdAt: { $gt: myRead }, senderId: { $ne: oid(ctx.userId) }, deletedAt: null });
  }
  return n;
}

/** People picker for new DMs (A62): every active colleague, regardless of the caller's employee-list permissions. */
export async function listChatPeople(ctx: CompanyContext) {
  const users = await scoped(User, ctx).find({ archivedAt: null, status: "active", _id: { $ne: oid(ctx.userId) } }).select("name avatarUrl role designation lastActiveAt").sort({ name: 1 }).lean();
  return users.map((u) => ({ id: String(u._id), name: u.name, avatarUrl: (u.avatarUrl as string | null) ?? null, roleLabel: ROLE_LABEL[u.role as keyof typeof ROLE_LABEL] ?? u.role, designation: (u.designation as string | null) ?? null, online: isOnlineUser(String(u._id), u.lastActiveAt as Date | null) }));
}

/**
 * Relay a typing indicator to the other people in a conversation (A76). Throttled by the browser;
 * the membership check here is what stops it being usable to probe other people's conversations.
 */
export async function notifyTyping(ctx: CompanyContext, conversationId: string) {
  const conv = await getAccessibleConversation(ctx, conversationId);
  const others = (await memberIdsOf(ctx, conv)).filter((id) => id !== ctx.userId);
  realtime().emitToUsers(others, "chat:typing", { conversationId: String(conv._id), userId: ctx.userId, name: ctx.name, at: Date.now() });
  return { ok: true };
}
