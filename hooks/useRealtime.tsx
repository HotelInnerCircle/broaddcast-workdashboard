"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { io, type Socket } from "socket.io-client";
import { toast } from "sonner";
import { api, apiCache } from "@/lib/api/client";

type Handler = (payload: unknown) => void;
interface RealtimeApi {
  connected: boolean;
  /** Subscribe to a server event; returns an unsubscribe function. */
  subscribe: (event: string, handler: Handler) => () => void;
  emit: (event: string, payload?: unknown, ack?: (ok: boolean) => void) => void;
  /** Room membership that survives reconnects: joins are queued until the socket is up and replayed on every (re)connect. */
  joinRoom: (conversationId: string) => void;
  leaveRoom: (conversationId: string) => void;
  unreadNotifications: number;
  setUnreadNotifications: (n: number) => void;
}

const Ctx = createContext<RealtimeApi | null>(null);
const HEARTBEAT_MS = 30_000;

/**
 * One socket per browser tab (spec 3.3, 7.6): authenticates with the session cookie, sends a
 * heartbeat every 30s, fans events out to subscribers, and surfaces notifications as toasts.
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const socketRef = useRef<Socket | null>(null);
  const handlers = useRef<Map<string, Set<Handler>>>(new Map());
  const rooms = useRef<Set<string>>(new Set());
  const dispatch = (event: string, payload: unknown) => { apiCache.clear(); handlers.current.get(event)?.forEach((h) => { try { h(payload); } catch { /* handler error */ } }); };
  const [connected, setConnected] = useState(false);
  const [unread, setUnread] = useState(0);
  const pathname = usePathname();
  const router = useRouter();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  useEffect(() => {
    const socket = io({ path: "/socket.io", withCredentials: true, transports: ["websocket", "polling"] });
    socketRef.current = socket;
    let everConnected = false;
    socket.on("connect", () => {
      setConnected(true);
      // Rooms are server-side per socket: rejoin everything after a reconnect, then let subscribers catch up.
      rooms.current.forEach((id) => socket.emit("chat:join", id));
      if (everConnected) dispatch("realtime:reconnected", { at: Date.now() });
      everConnected = true;
    });
    socket.on("disconnect", () => setConnected(false));
    socket.onAny((event: string, payload: unknown) => dispatch(event, payload));
    const hb = setInterval(() => { if (socket.connected) socket.emit("presence:heartbeat"); }, HEARTBEAT_MS);
    api<{ unread: number }>("/api/notifications?limit=1").then((r) => setUnread(r.unread)).catch(() => {});
    return () => { clearInterval(hb); socket.disconnect(); socketRef.current = null; };
  }, []);

  const subscribe = useCallback((event: string, handler: Handler) => {
    const set = handlers.current.get(event) ?? new Set<Handler>();
    set.add(handler); handlers.current.set(event, set);
    return () => { set.delete(handler); };
  }, []);
  const emit = useCallback((event: string, payload?: unknown, ack?: (ok: boolean) => void) => { socketRef.current?.emit(event, payload, ack); }, []);
  const joinRoom = useCallback((id: string) => { rooms.current.add(id); if (socketRef.current?.connected) socketRef.current.emit("chat:join", id); }, []);
  const leaveRoom = useCallback((id: string) => { rooms.current.delete(id); socketRef.current?.emit("chat:leave", id); }, []);

  // Notifications: bump the badge and toast (spec 12.16). Chat activity toasts when the user is not in the chat.
  useEffect(() => {
    const offNew = subscribe("notification:new", (p) => {
      const n = p as { title: string; body: string | null; link: string | null; type: string };
      setUnread((u) => u + 1);
      toast(n.title, { description: n.body ?? undefined, action: n.link ? { label: "Open", onClick: () => router.push(n.link!) } : undefined, duration: 6000 });
    });
    const offRead = subscribe("notification:read", (p) => setUnread((p as { unread: number }).unread));
    const offChat = subscribe("chat:activity", (p) => {
      const m = p as { conversationId: string; preview: string; from: string };
      if (pathRef.current.startsWith("/chat")) return;
      toast(`${m.from}`, { description: m.preview, action: { label: "Reply", onClick: () => router.push(`/chat?c=${m.conversationId}`) }, duration: 5000 });
    });
    return () => { offNew(); offRead(); offChat(); };
  }, [subscribe, router]);

  // Memoised so consumers that depend on the api object do not re-run effects on every provider render.
  const value = useMemo<RealtimeApi>(() => ({ connected, subscribe, emit, joinRoom, leaveRoom, unreadNotifications: unread, setUnreadNotifications: setUnread }), [connected, subscribe, emit, joinRoom, leaveRoom, unread]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRealtime(): RealtimeApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useRealtime must be used inside RealtimeProvider");
  return v;
}

/** Subscribe to several events and run a debounced callback (dashboards refetch on any relevant event). */
export function useRealtimeRefetch(events: string[], cb: () => void, debounceMs = 400) {
  const { subscribe } = useRealtime();
  const cbRef = useRef(cb); cbRef.current = cb;
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const trigger = () => { if (t) clearTimeout(t); t = setTimeout(() => cbRef.current(), debounceMs); };
    const offs = events.map((e) => subscribe(e, trigger));
    return () => { offs.forEach((o) => o()); if (t) clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe, events.join(","), debounceMs]);
}
