"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api, ClientApiError } from "@/lib/api/client";
import { showLimitError } from "@/lib/api/limit-toast";
import { useAuth } from "@/hooks/useAuth";
import { useRealtime } from "@/hooks/useRealtime";

export interface ConversationRow { id: string; type: "dm" | "team" | "project"; name: string; teamId: string | null; projectId: string | null; avatarUrl: string | null; otherUserId: string | null; online: boolean | null; lastMessageAt: string | null; lastMessagePreview: string | null; lastMessageSender: string | null; unread: number }
export interface ChatMessage { id: string; conversationId: string; /** Optimistic local message not yet confirmed by the server (A62). */ pending?: boolean; failed?: boolean; sender: { id: string; name: string; avatarUrl: string | null } | null; senderId: string; body: string; deleted: boolean; attachments: { id: string; name: string; size: number; mime: string; url: string }[]; mentions: string[]; replyTo: { id: string; body: string; sender: string | null } | null; editedAt: string | null; createdAt: string }
export interface Member { id: string; name: string; avatarUrl: string | null; role: string; online: boolean }
interface Thread { conversation: { id: string; type: string; reads: { userId: string; at: string }[] }; members: Member[]; messages: ChatMessage[]; hasMore: boolean }

/**
 * Chat state (spec 12.15): conversation list with unread counts, the open thread, socket room
 * membership, typing indicators, read receipts, send/edit/delete and attachments.
 */
export function useChat(initialConversationId?: string | null) {
  const me = useAuth();
  const rt = useRealtime();
  const { subscribe, emit, joinRoom, leaveRoom } = rt;
  const [conversations, setConversations] = useState<ConversationRow[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(initialConversationId ?? null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const [typing, setTyping] = useState<Record<string, { name: string; at: number }>>({});
  const [reads, setReads] = useState<Record<string, string>>({});
  const activeRef = useRef(activeId); activeRef.current = activeId;
  const lastTyping = useRef(0);

  const loadConversations = useCallback(async () => { try { setConversations(await api<ConversationRow[]>("/api/chat/conversations")); } catch { setConversations([]); } }, []);
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
        const t = await api<Thread>(`/api/chat/conversations/${activeId}/messages?limit=50`);
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
    if (!activeId) return;
    joinRoom(activeId);
    return () => leaveRoom(activeId);
  }, [activeId, joinRoom, leaveRoom]);

  // Catch-up (A62): anything that arrived while the socket was down is fetched after a reconnect, and a
  // light poll every 15s backstops delivery even if an event is lost. Only messages newer than the last
  // one on screen are appended, so this never flickers or duplicates.
  const catchUp = useCallback(async () => {
    const id = activeRef.current;
    if (!id) return;
    try {
      const t = await api<Thread>(`/api/chat/conversations/${id}/messages?limit=50`, { fresh: true });
      if (activeRef.current !== id) return;
      setThread((cur) => {
        if (!cur) return t;
        const known = new Set(cur.messages.filter((m) => !m.pending).map((m) => m.id));
        const fresh = t.messages.filter((m) => !known.has(m.id));
        const updated = cur.messages.map((m) => t.messages.find((x) => x.id === m.id) ?? m);
        return fresh.length || updated.some((m, i) => m !== cur.messages[i]) ? { ...cur, members: t.members, messages: [...updated, ...fresh].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) } : cur;
      });
      setReads(Object.fromEntries(t.conversation.reads.map((r) => [r.userId, r.at])));
    } catch { /* keep what we have */ }
  }, []);
  useEffect(() => {
    const off = subscribe("realtime:reconnected", () => { void catchUp(); void loadConversations(); });
    const poll = setInterval(() => { if (document.visibilityState === "visible") void catchUp(); }, 15_000);
    const onVisible = () => { if (document.visibilityState === "visible") void catchUp(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { off(); clearInterval(poll); document.removeEventListener("visibilitychange", onVisible); };
  }, [subscribe, catchUp, loadConversations]);

  // Realtime: new/updated messages, typing, read receipts, presence, and list refresh on activity.
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
    const offRead = subscribe("chat:read", (p) => { const r = p as { conversationId: string; userId: string; at: string }; if (r.conversationId === activeRef.current) setReads((rs) => ({ ...rs, [r.userId]: r.at })); });
    const offActivity = subscribe("chat:activity", () => void loadConversations());
    const offPresence = subscribe("presence:update", (p) => {
      const u = p as { userId: string; online: boolean };
      setConversations((cs) => cs?.map((c) => (c.otherUserId === u.userId ? { ...c, online: u.online } : c)) ?? cs);
      setThread((t) => (t ? { ...t, members: t.members.map((m) => (m.id === u.userId ? { ...m, online: u.online } : m)) } : t));
    });
    const sweep = setInterval(() => setTyping((ty) => Object.fromEntries(Object.entries(ty).filter(([, v]) => Date.now() - v.at < 4000))), 1500);
    return () => { offMsg(); offUpd(); offTyping(); offRead(); offActivity(); offPresence(); clearInterval(sweep); };
  }, [subscribe, me.userId, markRead, loadConversations]);

  const send = useCallback(async (body: string, opts: { mentions?: string[]; replyTo?: string | null } = {}) => {
    if (!activeId) return false;
    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: ChatMessage = { id: tempId, conversationId: activeId, sender: { id: me.userId, name: me.name, avatarUrl: me.avatarUrl ?? null }, senderId: me.userId, body, deleted: false, attachments: [], mentions: opts.mentions ?? [], replyTo: null, editedAt: null, createdAt: new Date().toISOString(), pending: true };
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

  const sendFile = useCallback(async (file: File, body = "") => {
    if (!activeId) return;
    const fd = new FormData(); fd.append("file", file); fd.append("body", body);
    try { const m = await api<ChatMessage>(`/api/chat/conversations/${activeId}/attachments`, { method: "POST", body: fd }); setThread((t) => (t && !t.messages.some((x) => x.id === m.id) ? { ...t, messages: [...t.messages, m] } : t)); void loadConversations(); }
    catch (e) { if (!showLimitError(e)) toast.error(e instanceof ClientApiError ? e.message : "Upload failed"); }
  }, [activeId, loadConversations]);

  const edit = useCallback(async (id: string, body: string) => { try { const m = await api<ChatMessage>(`/api/chat/messages/${id}`, { method: "PATCH", json: { body } }); setThread((t) => (t ? { ...t, messages: t.messages.map((x) => (x.id === id ? m : x)) } : t)); } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not edit"); } }, []);
  const remove = useCallback(async (id: string) => { try { const m = await api<ChatMessage>(`/api/chat/messages/${id}`, { method: "DELETE" }); setThread((t) => (t ? { ...t, messages: t.messages.map((x) => (x.id === id ? m : x)) } : t)); } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not delete"); } }, []);
  const loadMore = useCallback(async () => {
    if (!activeId || !thread?.hasMore || thread.messages.length === 0) return;
    try { const t = await api<Thread>(`/api/chat/conversations/${activeId}/messages?limit=50&before=${thread.messages[0].id}`, { fresh: true }); setThread((cur) => (cur ? { ...cur, messages: [...t.messages, ...cur.messages], hasMore: t.hasMore } : cur)); } catch { /* ignore */ }
  }, [activeId, thread]);
  const notifyTyping = useCallback(() => { if (!activeId) return; const now = Date.now(); if (now - lastTyping.current > 2000) { lastTyping.current = now; emit("chat:typing", activeId); } }, [activeId, emit]);
  const openDm = useCallback(async (userId: string) => { try { const r = await api<{ id: string }>("/api/chat/conversations", { method: "POST", json: { userId } }); await loadConversations(); setActiveId(r.id); } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not open chat"); } }, [loadConversations]);

  return { me, conversations, activeId, setActiveId, thread, loadingThread, typing, reads, send, sendFile, edit, remove, loadMore, notifyTyping, openDm, reloadConversations: loadConversations };
}
