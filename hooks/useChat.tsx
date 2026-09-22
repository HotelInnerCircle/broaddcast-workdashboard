"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api, ClientApiError } from "@/lib/api/client";
import { showLimitError } from "@/lib/api/limit-toast";
import { useAuth } from "@/hooks/useAuth";
import { useRealtime } from "@/hooks/useRealtime";

export interface ConversationRow { id: string; type: "dm" | "team" | "project"; name: string; teamId: string | null; projectId: string | null; avatarUrl: string | null; otherUserId: string | null; online: boolean | null; lastMessageAt: string | null; lastMessagePreview: string | null; lastMessageSender: string | null; unread: number }
export interface ChatMessage { id: string; conversationId: string; sender: { id: string; name: string; avatarUrl: string | null } | null; senderId: string; body: string; deleted: boolean; attachments: { id: string; name: string; size: number; mime: string; url: string }[]; mentions: string[]; replyTo: { id: string; body: string; sender: string | null } | null; editedAt: string | null; createdAt: string }
export interface Member { id: string; name: string; avatarUrl: string | null; role: string; online: boolean }
interface Thread { conversation: { id: string; type: string; reads: { userId: string; at: string }[] }; members: Member[]; messages: ChatMessage[]; hasMore: boolean }

/**
 * Chat state (spec 12.15): conversation list with unread counts, the open thread, socket room
 * membership, typing indicators, read receipts, send/edit/delete and attachments.
 */
export function useChat(initialConversationId?: string | null) {
  const me = useAuth();
  const rt = useRealtime();
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
        rt.emit("chat:join", activeId);
        void markRead(activeId);
      } catch (e) { if (!cancelled) { toast.error(e instanceof ClientApiError ? e.message : "Could not open conversation"); setActiveId(null); } }
      finally { if (!cancelled) setLoadingThread(false); }
    })();
    return () => { cancelled = true; rt.emit("chat:leave", activeId); };
  }, [activeId, rt, markRead]);

  // Realtime: new/updated messages, typing, read receipts, presence, and list refresh on activity.
  useEffect(() => {
    const offMsg = rt.subscribe("chat:message", (p) => {
      const m = p as ChatMessage;
      if (m.conversationId !== activeRef.current) return;
      setThread((t) => (t && !t.messages.some((x) => x.id === m.id) ? { ...t, messages: [...t.messages, m] } : t));
      setTyping((ty) => { const n = { ...ty }; delete n[m.senderId]; return n; });
      if (m.senderId !== me.userId) void markRead(m.conversationId);
    });
    const offUpd = rt.subscribe("chat:message-updated", (p) => { const m = p as ChatMessage; setThread((t) => (t ? { ...t, messages: t.messages.map((x) => (x.id === m.id ? m : x)) } : t)); });
    const offTyping = rt.subscribe("chat:typing", (p) => { const t = p as { conversationId: string; userId: string; name: string; at: number }; if (t.conversationId === activeRef.current && t.userId !== me.userId) setTyping((ty) => ({ ...ty, [t.userId]: { name: t.name, at: Date.now() } })); });
    const offRead = rt.subscribe("chat:read", (p) => { const r = p as { conversationId: string; userId: string; at: string }; if (r.conversationId === activeRef.current) setReads((rs) => ({ ...rs, [r.userId]: r.at })); });
    const offActivity = rt.subscribe("chat:activity", () => void loadConversations());
    const offPresence = rt.subscribe("presence:update", (p) => {
      const u = p as { userId: string; online: boolean };
      setConversations((cs) => cs?.map((c) => (c.otherUserId === u.userId ? { ...c, online: u.online } : c)) ?? cs);
      setThread((t) => (t ? { ...t, members: t.members.map((m) => (m.id === u.userId ? { ...m, online: u.online } : m)) } : t));
    });
    const sweep = setInterval(() => setTyping((ty) => Object.fromEntries(Object.entries(ty).filter(([, v]) => Date.now() - v.at < 4000))), 1500);
    return () => { offMsg(); offUpd(); offTyping(); offRead(); offActivity(); offPresence(); clearInterval(sweep); };
  }, [rt, me.userId, markRead, loadConversations]);

  const send = useCallback(async (body: string, opts: { mentions?: string[]; replyTo?: string | null } = {}) => {
    if (!activeId) return false;
    try {
      const m = await api<ChatMessage>("/api/chat/messages", { method: "POST", json: { conversationId: activeId, body, mentions: opts.mentions ?? [], replyTo: opts.replyTo ?? null } });
      setThread((t) => (t && !t.messages.some((x) => x.id === m.id) ? { ...t, messages: [...t.messages, m] } : t));
      void loadConversations();
      return true;
    } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not send"); return false; }
  }, [activeId, loadConversations]);

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
    try { const t = await api<Thread>(`/api/chat/conversations/${activeId}/messages?limit=50&before=${thread.messages[0].id}`); setThread((cur) => (cur ? { ...cur, messages: [...t.messages, ...cur.messages], hasMore: t.hasMore } : cur)); } catch { /* ignore */ }
  }, [activeId, thread]);
  const notifyTyping = useCallback(() => { if (!activeId) return; const now = Date.now(); if (now - lastTyping.current > 2000) { lastTyping.current = now; rt.emit("chat:typing", activeId); } }, [activeId, rt]);
  const openDm = useCallback(async (userId: string) => { try { const r = await api<{ id: string }>("/api/chat/conversations", { method: "POST", json: { userId } }); await loadConversations(); setActiveId(r.id); } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not open chat"); } }, [loadConversations]);

  return { me, conversations, activeId, setActiveId, thread, loadingThread, typing, reads, send, sendFile, edit, remove, loadMore, notifyTyping, openDm, reloadConversations: loadConversations };
}
