"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api, ClientApiError } from "@/lib/api/client";
import { showLimitError } from "@/lib/api/limit-toast";
import { useAuth } from "@/hooks/useAuth";
import { useRealtime } from "@/hooks/useRealtime";
import { playMessageChime, showDesktopAlert } from "@/lib/chat-sound";

export interface ChatAttachment { id: string; name: string; size: number; mime: string; width: number | null; height: number | null; url: string; downloadUrl: string }
export interface Receipt { userId: string; at: string }
export interface ConversationRow {
  id: string; type: "dm" | "team" | "project" | "channel"; name: string; description: string | null; teamId: string | null; projectId: string | null;
  avatarUrl: string | null; otherUserId: string | null; online: boolean | null; memberCount: number | null; canManage: boolean;
  lastMessageAt: string | null; lastMessagePreview: string | null; lastMessageSender: string | null; lastMessageSenderId: string | null; lastMessageRead: boolean | null; unread: number;
}
export interface ChatMessage {
  id: string; conversationId: string;
  /** Optimistic local message not yet confirmed by the server (A62). */
  pending?: boolean; failed?: boolean;
  sender: { id: string; name: string; avatarUrl: string | null } | null; senderId: string;
  body: string; deleted: boolean; attachments: ChatAttachment[]; mentions: string[];
  replyTo: { id: string; body: string; sender: string | null; attachmentCount: number } | null;
  /** Tick state (A72): who has received the message, and who has opened the conversation since. */
  deliveredTo: Receipt[]; readBy: Receipt[];
  /** A copy made by forwarding (A73) - the bubble shows a "Forwarded" label. */
  forwarded?: boolean;
  editedAt: string | null; createdAt: string;
}
export interface Member { id: string; name: string; avatarUrl: string | null; role: string; online: boolean }
interface ThreadState {
  conversation: { id: string; type: string; name: string | null; description: string | null; ownerId: string | null; canManage: boolean; archived?: boolean; reads: Receipt[] };
  members: Member[]; messages: ChatMessage[]; hasMore: boolean;
}

/**
 * Chat state (spec 12.15): conversation list with unread counts, the open thread, socket room
 * membership, typing indicators, delivery and read receipts, send/edit/delete and attachments.
 */
export function useChat(initialConversationId?: string | null) {
  const me = useAuth();
  const rt = useRealtime();
  const { subscribe, emit, joinRoom, leaveRoom, setMutedConversation, mode } = rt;
  const [conversations, setConversations] = useState<ConversationRow[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(initialConversationId ?? null);
  const [thread, setThread] = useState<ThreadState | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const [typing, setTyping] = useState<Record<string, { name: string; at: number }>>({});
  const [reads, setReads] = useState<Record<string, string>>({});
  const activeRef = useRef(activeId); activeRef.current = activeId;
  const modeRef = useRef(mode); modeRef.current = mode;
  const lastTyping = useRef(0);
  /** Message ids already confirmed as delivered this session, so the ack fires once each. */
  const acked = useRef<Set<string>>(new Set());

  /** Unread per conversation at the last refresh, to spot arrivals found by polling (A75). */
  const lastUnread = useRef<Map<string, number> | null>(null);
  const loadConversations = useCallback(async () => {
    try {
      const rows = await api<ConversationRow[]>("/api/chat/conversations");
      // With no socket nothing announces a new message, so the poll has to. Anything whose unread
      // count went up since the last look gets the same chime and banner a pushed message would.
      const before = lastUnread.current;
      if (before && modeRef.current === "http") {
        const arrived = rows.find((r) => r.unread > (before.get(r.id) ?? 0) && r.id !== activeRef.current);
        if (arrived) {
          playMessageChime();
          showDesktopAlert(arrived.lastMessageSender ?? arrived.name.replace(/^# /, ""), arrived.lastMessagePreview ?? "New message");
        }
      }
      lastUnread.current = new Map(rows.map((r) => [r.id, r.unread]));
      setConversations(rows);
    } catch { setConversations([]); }
  }, []);
  useEffect(() => { void loadConversations(); }, [loadConversations]);

  const markRead = useCallback(async (id: string) => {
    try { await api(`/api/chat/conversations/${id}/read`, { method: "POST" }); setConversations((cs) => cs?.map((c) => (c.id === id ? { ...c, unread: 0 } : c)) ?? cs); } catch { /* ignore */ }
  }, []);

  // Open a thread: fetch, join the socket room, mark read.
  useEffect(() => {
    if (!activeId) { setThread(null); return; }
    let cancelled = false;
    setLoadingThread(true);
    (async () => {
      try {
        const t = await api<ThreadState>(`/api/chat/conversations/${activeId}/messages?limit=50`);
        if (cancelled) return;
        setThread(t);
        setReads(Object.fromEntries(t.conversation.reads.map((r) => [r.userId, r.at])));
        void markRead(activeId);
      } catch (e) { if (!cancelled) { toast.error(e instanceof ClientApiError ? e.message : "Could not open conversation"); setActiveId(null); } }
      finally { if (!cancelled) setLoadingThread(false); }
    })();
    return () => { cancelled = true; };
  }, [activeId, markRead]);
  // Room membership is separate from fetching: joinRoom queues until the socket is up and is replayed after every reconnect.
  useEffect(() => {
    setMutedConversation(activeId);
    if (!activeId) return;
    joinRoom(activeId);
    return () => { leaveRoom(activeId); setMutedConversation(null); };
  }, [activeId, joinRoom, leaveRoom, setMutedConversation]);

  // Catch-up (A62): anything that arrived while the socket was down is fetched after a reconnect, and a
  // light poll every 15s backstops delivery even if an event is lost. Only messages newer than the last
  // one on screen are appended, so this never flickers or duplicates.
  const catchUp = useCallback(async () => {
    const id = activeRef.current;
    if (!id) return;
    try {
      const t = await api<ThreadState>(`/api/chat/conversations/${id}/messages?limit=50`, { fresh: true });
      if (activeRef.current !== id) return;
      setThread((cur) => {
        if (!cur) return t;
        const known = new Set(cur.messages.filter((m) => !m.pending).map((m) => m.id));
        const fresh = t.messages.filter((m) => !known.has(m.id));
        const updated = cur.messages.map((m) => t.messages.find((x) => x.id === m.id) ?? m);
        return fresh.length || updated.some((m, i) => m !== cur.messages[i]) ? { ...cur, conversation: t.conversation, members: t.members, messages: [...updated, ...fresh].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) } : cur;
      });
      setReads(Object.fromEntries(t.conversation.reads.map((r) => [r.userId, r.at])));
    } catch { /* keep what we have */ }
  }, []);
  useEffect(() => {
    const off = subscribe("realtime:reconnected", () => { void catchUp(); void loadConversations(); });
    // A75: with a socket, this is only a backstop for a lost event. Without one it is how messages
    // arrive at all, so it runs far more often - and it also refreshes the list, since nothing else will.
    const everyMs = mode === "http" ? 4_000 : 15_000;
    let ticks = 0;
    const poll = setInterval(() => {
      ticks++;
      if (document.visibilityState === "visible") {
        void catchUp();
        if (mode === "http" && ticks % 3 === 0) void loadConversations();
        return;
      }
      // A background tab needs no polling when a socket can push to it. With no socket it still
      // needs a slow watch, or a message arriving while the tab is behind another would never
      // chime or raise a banner - which is exactly when you want it to.
      if (mode === "http" && ticks % 4 === 0) void loadConversations();
    }, everyMs);
    const onVisible = () => { if (document.visibilityState === "visible") void catchUp(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { off(); clearInterval(poll); document.removeEventListener("visibilitychange", onVisible); };
  }, [subscribe, catchUp, loadConversations, mode]);

  // Realtime: new/updated messages, typing, delivery and read receipts, presence, list refresh on activity.
  useEffect(() => {
    const offMsg = subscribe("chat:message", (p) => {
      const m = p as ChatMessage;
      if (m.conversationId !== activeRef.current) return;
      setThread((t) => {
        if (!t || t.messages.some((x) => x.id === m.id)) return t;
        // The socket echo of our own optimistic message may beat the HTTP response: replace it in place.
        const pendingIdx = m.senderId === me.userId ? t.messages.findIndex((x) => x.pending && x.body === m.body) : -1;
        if (pendingIdx >= 0) { const next = [...t.messages]; next[pendingIdx] = m; return { ...t, messages: next }; }
        return { ...t, messages: [...t.messages, m] };
      });
      setTyping((ty) => { const n = { ...ty }; delete n[m.senderId]; return n; });
      if (m.senderId !== me.userId) void markRead(m.conversationId);
    });
    const offUpd = subscribe("chat:message-updated", (p) => { const m = p as ChatMessage; setThread((t) => (t ? { ...t, messages: t.messages.map((x) => (x.id === m.id ? m : x)) } : t)); });
    const offTyping = subscribe("chat:typing", (p) => { const t = p as { conversationId: string; userId: string; name: string; at: number }; if (t.conversationId === activeRef.current && t.userId !== me.userId) setTyping((ty) => ({ ...ty, [t.userId]: { name: t.name, at: Date.now() } })); });
    // Second tick: stamp deliveredTo on the messages the recipient has just acknowledged.
    const offDelivered = subscribe("chat:delivered", (p) => {
      const d = p as { conversationId: string; userId: string; at: string; messageIds: string[] };
      if (d.conversationId !== activeRef.current) return;
      const ids = new Set(d.messageIds);
      setThread((t) => (t ? { ...t, messages: t.messages.map((m) => (ids.has(m.id) && !m.deliveredTo.some((x) => x.userId === d.userId) ? { ...m, deliveredTo: [...m.deliveredTo, { userId: d.userId, at: d.at }] } : m)) } : t));
    });
    // Blue ticks: their read cursor moved, so everything of ours up to that moment is read.
    const offRead = subscribe("chat:read", (p) => {
      const r = p as { conversationId: string; userId: string; at: string };
      // The list updates wherever we are (A73): our own row goes blue when they read it, and our
      // unread badge clears when we read the conversation in another tab.
      setConversations((cs) => cs?.map((c) => {
        if (c.id !== r.conversationId) return c;
        if (r.userId === me.userId) return { ...c, unread: 0 };
        // Only a DM can be called "read" from one person reading it; a channel needs everyone, so
        // its row waits for the next list refresh rather than turning blue too early.
        return c.type === "dm" && c.lastMessageSenderId === me.userId ? { ...c, lastMessageRead: true } : c;
      }) ?? cs);
      if (r.conversationId !== activeRef.current) return;
      setReads((rs) => ({ ...rs, [r.userId]: r.at }));
      setThread((t) => (t ? {
        ...t,
        conversation: { ...t.conversation, reads: [...t.conversation.reads.filter((x) => x.userId !== r.userId), { userId: r.userId, at: r.at }] },
        messages: t.messages.map((m) => (m.senderId !== r.userId && new Date(m.createdAt) <= new Date(r.at) && !m.readBy.some((x) => x.userId === r.userId)
          ? { ...m, deliveredTo: m.deliveredTo.some((x) => x.userId === r.userId) ? m.deliveredTo : [...m.deliveredTo, { userId: r.userId, at: r.at }], readBy: [...m.readBy, { userId: r.userId, at: r.at }] }
          : m)),
      } : t));
    });
    const offActivity = subscribe("chat:activity", () => void loadConversations());
    const offConv = subscribe("chat:conversation-updated", () => { void loadConversations(); void catchUp(); });
    // A74: the whole company's presence in one go, from the HTTP heartbeat on hosts with no socket.
    const offPresenceSync = subscribe("presence:sync", (p) => {
      const online = new Set((p as { online: string[] }).online);
      setConversations((cs) => cs?.map((c) => (c.otherUserId ? { ...c, online: online.has(c.otherUserId) } : c)) ?? cs);
      setThread((t) => (t ? { ...t, members: t.members.map((m) => ({ ...m, online: online.has(m.id) })) } : t));
    });
    const offPresence = subscribe("presence:update", (p) => {
      const u = p as { userId: string; online: boolean };
      setConversations((cs) => cs?.map((c) => (c.otherUserId === u.userId ? { ...c, online: u.online } : c)) ?? cs);
      setThread((t) => (t ? { ...t, members: t.members.map((m) => (m.id === u.userId ? { ...m, online: u.online } : m)) } : t));
    });
    const sweep = setInterval(() => setTyping((ty) => Object.fromEntries(Object.entries(ty).filter(([, v]) => Date.now() - v.at < 4000))), 1500);
    return () => { offMsg(); offUpd(); offTyping(); offDelivered(); offRead(); offActivity(); offConv(); offPresence(); offPresenceSync(); clearInterval(sweep); };
  }, [subscribe, me.userId, markRead, loadConversations, catchUp]);

  /** Tell the server we have these messages on screen - this is what turns one tick into two (A72). */
  const confirmDelivered = useCallback(async (messageIds: string[]) => {
    const fresh = messageIds.filter((id) => !id.startsWith("tmp-") && !acked.current.has(id));
    if (fresh.length === 0) return;
    fresh.forEach((id) => acked.current.add(id));
    try { await api("/api/chat/delivered", { method: "POST", json: { messageIds: fresh } }); }
    catch { fresh.forEach((id) => acked.current.delete(id)); }
  }, []);

  const send = useCallback(async (body: string, opts: { mentions?: string[]; replyTo?: string | null } = {}) => {
    if (!activeId) return false;
    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const optimistic: ChatMessage = { id: tempId, conversationId: activeId, sender: { id: me.userId, name: me.name, avatarUrl: me.avatarUrl ?? null }, senderId: me.userId, body, deleted: false, attachments: [], mentions: opts.mentions ?? [], replyTo: null, deliveredTo: [{ userId: me.userId, at: now }], readBy: [{ userId: me.userId, at: now }], editedAt: null, createdAt: now, pending: true };
    setThread((t) => (t ? { ...t, messages: [...t.messages, optimistic] } : t));
    try {
      const m = await api<ChatMessage>("/api/chat/messages", { method: "POST", json: { conversationId: activeId, body, mentions: opts.mentions ?? [], replyTo: opts.replyTo ?? null } });
      setThread((t) => {
        if (!t) return t;
        if (t.messages.some((x) => x.id === m.id)) return { ...t, messages: t.messages.filter((x) => x.id !== tempId) }; // socket echo already replaced it
        return { ...t, messages: t.messages.map((x) => (x.id === tempId ? m : x)) };
      });
      void loadConversations();
      return true;
    } catch (e) {
      setThread((t) => (t ? { ...t, messages: t.messages.map((x) => (x.id === tempId ? { ...x, pending: false, failed: true } : x)) } : t));
      toast.error(e instanceof ClientApiError ? e.message : "Could not send");
      return false;
    }
  }, [activeId, loadConversations, me.userId, me.name, me.avatarUrl]);

  /** Several photos or documents plus an optional caption, sent as one message (A72). */
  const sendFiles = useCallback(async (files: File[], body = "", replyTo: string | null = null) => {
    if (!activeId || files.length === 0) return false;
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    fd.append("body", body);
    if (replyTo) fd.append("replyTo", replyTo);
    try {
      const m = await api<ChatMessage>(`/api/chat/conversations/${activeId}/attachments`, { method: "POST", body: fd });
      setThread((t) => (t && !t.messages.some((x) => x.id === m.id) ? { ...t, messages: [...t.messages, m] } : t));
      void loadConversations();
      return true;
    } catch (e) {
      if (!showLimitError(e)) toast.error(e instanceof ClientApiError ? e.message : "Upload failed");
      return false;
    }
  }, [activeId, loadConversations]);
  /** Single-file convenience kept for older callers. */
  const sendFile = useCallback((file: File, body = "") => sendFiles([file], body), [sendFiles]);

  const edit = useCallback(async (id: string, body: string) => { try { const m = await api<ChatMessage>(`/api/chat/messages/${id}`, { method: "PATCH", json: { body } }); setThread((t) => (t ? { ...t, messages: t.messages.map((x) => (x.id === id ? m : x)) } : t)); } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not edit"); } }, []);
  const remove = useCallback(async (id: string) => { try { const m = await api<ChatMessage>(`/api/chat/messages/${id}`, { method: "DELETE" }); setThread((t) => (t ? { ...t, messages: t.messages.map((x) => (x.id === id ? m : x)) } : t)); } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not delete"); } }, []);
  const loadMore = useCallback(async () => {
    if (!activeId || !thread?.hasMore || thread.messages.length === 0) return;
    try { const t = await api<ThreadState>(`/api/chat/conversations/${activeId}/messages?limit=50&before=${thread.messages[0].id}`, { fresh: true }); setThread((cur) => (cur ? { ...cur, messages: [...t.messages, ...cur.messages], hasMore: t.hasMore } : cur)); } catch { /* ignore */ }
  }, [activeId, thread]);
  const notifyTyping = useCallback(() => { if (!activeId) return; const now = Date.now(); if (now - lastTyping.current > 2000) { lastTyping.current = now; emit("chat:typing", activeId); } }, [activeId, emit]);
  /** Forward a message into other conversations (A73). Returns how many actually took it. */
  const forward = useCallback(async (messageId: string, conversationIds: string[]) => {
    try {
      const r = await api<{ sent: string[]; skipped: string[] }>("/api/chat/forward", { method: "POST", json: { messageId, conversationIds } });
      toast.success(r.sent.length === 1 ? "Message forwarded" : `Forwarded to ${r.sent.length} chats`);
      if (r.skipped.length) toast.error(`${r.skipped.length} chat${r.skipped.length === 1 ? "" : "s"} could not receive it`);
      void loadConversations();
      return true;
    } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not forward"); return false; }
  }, [loadConversations]);

  const openDm = useCallback(async (userId: string) => { try { const r = await api<{ id: string }>("/api/chat/conversations", { method: "POST", json: { userId } }); await loadConversations(); setActiveId(r.id); } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not open chat"); } }, [loadConversations]);

  return { me, conversations, activeId, setActiveId, thread, loadingThread, typing, reads, send, sendFile, sendFiles, confirmDelivered, forward, edit, remove, loadMore, notifyTyping, openDm, reloadConversations: loadConversations };
}
