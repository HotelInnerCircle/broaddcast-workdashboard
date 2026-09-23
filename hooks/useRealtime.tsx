"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { io, type Socket } from "socket.io-client";
import { toast } from "sonner";
import { api, apiCache } from "@/lib/api/client";
import { playMessageChime, showDesktopAlert } from "@/lib/chat-sound";

type Handler = (payload: unknown) => void;
/** "socket" once a live Socket.IO connection is possible, "http" when this host has none (A75). */
export type RealtimeMode = "probing" | "socket" | "http";
interface RealtimeApi {
  connected: boolean;
  /** Lets features poll harder when there is no socket to push to them. */
  mode: RealtimeMode;
  /** Subscribe to a server event; returns an unsubscribe function. */
  subscribe: (event: string, handler: Handler) => () => void;
  emit: (event: string, payload?: unknown, ack?: (ok: boolean) => void) => void;
  /** The conversation currently on screen: no chime for a message the user is already watching (A73). */
  setMutedConversation: (id: string | null) => void;
  /** Room membership that survives reconnects: joins are queued until the socket is up and replayed on every (re)connect. */
  joinRoom: (conversationId: string) => void;
  leaveRoom: (conversationId: string) => void;
  unreadNotifications: number;
  setUnreadNotifications: (n: number) => void;
}

const Ctx = createContext<RealtimeApi | null>(null);
const HEARTBEAT_MS = 30_000;
/** Remembered per tab so the probe runs once, not on every client-side navigation. */
const PROBE_KEY = "wp.realtime.socket";

/**
 * Does this deployment actually have a Socket.IO server? (A75)
 *
 * On a serverless host the custom server never runs, so `/socket.io` 404s. socket.io-client cannot
 * tell that apart from a blip: it retries forever and every attempt prints
 * `WebSocket connection to 'wss://.../socket.io/...' failed` in the console. One cheap handshake
 * request settles it - a real Engine.IO server answers with a payload starting `0{`. When it does
 * not, no socket is ever created and the app runs on its HTTP fallback with a quiet console.
 */
async function socketAvailable(): Promise<boolean> {
  try {
    const cached = sessionStorage.getItem(PROBE_KEY);
    if (cached) return cached === "up";
  } catch { /* private window - just probe */ }
  let ok = false;
  try {
    const res = await fetch(`/socket.io/?EIO=4&transport=polling&t=${Date.now()}`, { cache: "no-store", credentials: "same-origin" });
    ok = res.ok && (await res.text()).trimStart().startsWith("0{");
  } catch { ok = false; }
  try { sessionStorage.setItem(PROBE_KEY, ok ? "up" : "down"); } catch { /* ignore */ }
  return ok;
}

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
  const [mode, setMode] = useState<RealtimeMode>("probing");
  const [unread, setUnread] = useState(0);
  const pathname = usePathname();
  const router = useRouter();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const mutedRef = useRef<string | null>(null);
  const setMutedConversation = useCallback((id: string | null) => { mutedRef.current = id; }, []);

  useEffect(() => {
    let socket: Socket | null = null;
    let cancelled = false;
    let hb: ReturnType<typeof setInterval> | null = null;

    /** HTTP beat: keeps presence fresh and pulls everyone else's state back (A74). */
    const httpBeat = async () => {
      try {
        const r = await api<{ online: string[] }>("/api/me/presence", { method: "POST" });
        dispatch("presence:sync", { online: r.online });
      } catch { /* offline or signed out - the next beat tries again */ }
      // Nothing pushes notification:new here, so the badge is refreshed on the same beat (A75).
      try { setUnread((await api<{ unread: number }>("/api/notifications?limit=1", { fresh: true })).unread); } catch { /* ignore */ }
    };

    (async () => {
      const available = await socketAvailable();
      if (cancelled) return;
      setMode(available ? "socket" : "http");

      if (!available) {
        // A75: no socket on this host, so none is opened. Creating one would only produce a
        // failed WebSocket every few seconds in the console and never connect.
        void httpBeat();
        hb = setInterval(() => { void httpBeat(); }, HEARTBEAT_MS);
        return;
      }

      socket = io({ path: "/socket.io", withCredentials: true, transports: ["websocket", "polling"] });
      socketRef.current = socket;
      let everConnected = false;
      socket.on("connect", () => {
        setConnected(true);
        // Rooms are server-side per socket: rejoin everything after a reconnect, then let subscribers catch up.
        rooms.current.forEach((id) => socket!.emit("chat:join", id));
        if (everConnected) dispatch("realtime:reconnected", { at: Date.now() });
        everConnected = true;
      });
      socket.on("disconnect", () => setConnected(false));
      socket.onAny((event: string, payload: unknown) => dispatch(event, payload));
      // The socket carries the heartbeat; the HTTP beat covers a connection that drops later.
      hb = setInterval(() => { if (socket?.connected) socket.emit("presence:heartbeat"); else void httpBeat(); }, HEARTBEAT_MS);
    })();

    api<{ unread: number }>("/api/notifications?limit=1").then((r) => setUnread(r.unread)).catch(() => {});
    return () => { cancelled = true; if (hb) clearInterval(hb); socket?.disconnect(); socketRef.current = null; };
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
      const m = p as { conversationId: string; preview: string; from: string; messageId?: string };
      // A73: the chime and the desktop banner fire wherever you are in the app. The conversation
      // you already have open mutes itself, so watching a thread does not beep at you.
      if (mutedRef.current !== m.conversationId) {
        playMessageChime();
        showDesktopAlert(m.from, m.preview, () => router.push(`/chat?c=${m.conversationId}`));
      }
      if (pathRef.current.startsWith("/chat")) return;
      toast(`${m.from}`, { description: m.preview, action: { label: "Reply", onClick: () => router.push(`/chat?c=${m.conversationId}`) }, duration: 5000 });
    });
    return () => { offNew(); offRead(); offChat(); };
  }, [subscribe, router]);

  // Memoised so consumers that depend on the api object do not re-run effects on every provider render.
  const value = useMemo<RealtimeApi>(() => ({ connected, mode, subscribe, emit, joinRoom, leaveRoom, setMutedConversation, unreadNotifications: unread, setUnreadNotifications: setUnread }), [connected, mode, subscribe, emit, joinRoom, leaveRoom, setMutedConversation, unread]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Null outside RealtimeProvider, instead of throwing. */
export function useRealtimeOptional(): RealtimeApi | null { return useContext(Ctx); }

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
