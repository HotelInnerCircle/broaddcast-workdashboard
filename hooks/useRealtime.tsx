"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { io, type Socket } from "socket.io-client";
import { toast } from "sonner";
import { api, apiCache } from "@/lib/api/client";
import { playMessageChime, showDesktopAlert } from "@/lib/chat-sound";

type Handler = (payload: unknown) => void;
/** "socket" once a live Socket.IO connection is possible, "http" when this host has none (A75). */
export type RealtimeMode = "probing" | "ably" | "socket" | "http";
interface RealtimeApi {
  connected: boolean;
  /** Lets features poll harder when there is no socket to push to them. */
  mode: RealtimeMode;
  /** Subscribe to a server event; returns an unsubscribe function. */
  subscribe: (event: string, handler: Handler) => () => void;
  emit: (event: string, payload?: unknown, ack?: (ok: boolean) => void) => void;
  /** The conversation currently on screen: no chime for a message the user is already watching (A73). */
  setMutedConversation: (id: string | null) => void;
  unreadNotifications: number;
  setUnreadNotifications: (n: number) => void;
}

const Ctx = createContext<RealtimeApi | null>(null);
const HEARTBEAT_MS = 30_000;
/** Remembered per tab so the probe runs once, not on every client-side navigation. */
const PROBE_KEY = "wp.realtime.socket";
/** How long to give the hosted service before giving up on it and trying the next transport. */
const CONNECT_TIMEOUT_MS = 8_000;

/** The live Ably connection, or null when this deployment has no realtime service configured. */
interface AblyHandle { close: () => void }

/**
 * Connect to the hosted realtime service, if there is one (A76).
 *
 * The browser asks the app for a short-lived token scoped to its own two channels; a 404 means no
 * service is configured and the caller falls back to Socket.IO or polling. Everything the server
 * addresses to this person arrives on `user:<id>`; company-wide events arrive on `company:<id>`,
 * whose presence set doubles as the online list - entering it is what makes someone "online",
 * and leaving is instant, so no heartbeat window is involved.
 */
async function connectAbly(dispatch: (event: string, payload: unknown) => void, setConnected: (v: boolean) => void): Promise<AblyHandle | null> {
  let first: { provider: string | null; tokenRequest?: unknown; companyChannel?: string | null; userChannel?: string };
  try {
    const res = await fetch("/api/realtime/token", { cache: "no-store", credentials: "same-origin" });
    if (!res.ok) return null;
    first = (await res.json()).data;
  } catch { return null; }
  if (first.provider !== "ably" || !first.userChannel) return null;

  try {
    // `ably/modular` rather than `ably`: the default browser entry is a UMD bundle that webpack
    // cannot parse, and the modular build only pulls in the transport and presence we actually use.
    const { BaseRealtime, WebSocketTransport, XHRPolling, FetchRequest, RealtimePresence } = await import("ably/modular");
    let pending: unknown = first.tokenRequest;
    const realtime = new BaseRealtime({
      plugins: { WebSocketTransport, XHRPolling, FetchRequest, RealtimePresence },
      // The first token is already in hand; later renewals go back to the same endpoint.
      authCallback: async (_params, cb) => {
        if (pending) { const t = pending; pending = null; cb(null, t as never); return; }
        try {
          const res = await fetch("/api/realtime/token", { cache: "no-store", credentials: "same-origin" });
          if (!res.ok) throw new Error(String(res.status));
          cb(null, (await res.json()).data.tokenRequest);
        } catch (e) { cb(e instanceof Error ? e.message : "token request failed", null); }
      },
    });

    // Prove the connection works before committing to it: a wrong or revoked key must fall through
    // to the other transports rather than leave chat quietly on the slow path.
    const live = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), CONNECT_TIMEOUT_MS);
      const done = (v: boolean) => { clearTimeout(timer); resolve(v); };
      realtime.connection.once("connected", () => done(true));
      realtime.connection.once("failed", () => done(false));
      realtime.connection.once("suspended", () => done(false));
    });
    if (!live) { try { realtime.close(); } catch { /* ignore */ } return null; }

    setConnected(true);
    let everConnected = true;
    realtime.connection.on("connected", () => {
      setConnected(true);
      if (everConnected) dispatch("realtime:reconnected", { at: Date.now() });
      everConnected = true;
    });
    realtime.connection.on("disconnected", () => setConnected(false));
    realtime.connection.on("suspended", () => setConnected(false));

    const userCh = realtime.channels.get(first.userChannel!);
    void userCh.subscribe((m) => dispatch(m.name ?? "", m.data));

    if (first.companyChannel) {
      const companyCh = realtime.channels.get(first.companyChannel);
      void companyCh.subscribe((m) => dispatch(m.name ?? "", m.data));
      // Presence: enter so others see us, then publish the whole set whenever it changes.
      const syncPresence = async () => {
        try {
          const members = await companyCh.presence.get();
          dispatch("presence:sync", { online: [...new Set(members.map((m) => m.clientId).filter(Boolean))] });
        } catch { /* a presence read can fail mid-reconnect; the next change re-syncs */ }
      };
      void companyCh.presence.subscribe(["enter", "leave", "update", "present"], () => { void syncPresence(); });
      void companyCh.presence.enter().then(syncPresence).catch(() => {});
    }

    return { close: () => { try { realtime.close(); } catch { /* already gone */ } } };
  } catch {
    return null; // the SDK failed to load or connect - fall through to the other transports
  }
}

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
  const ablyRef = useRef<AblyHandle | null>(null);
  const handlers = useRef<Map<string, Set<Handler>>>(new Map());
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

    /**
     * HTTP beat: keeps `lastActiveAt` fresh so server-rendered pages know who is online (A74).
     * `authoritative` is false under Ably, whose presence set is exact and instant - letting the
     * 75s database view overwrite it would make dots flicker back to grey.
     */
    const httpBeat = async (authoritative = true) => {
      try {
        const r = await api<{ online: string[] }>("/api/me/presence", { method: "POST" });
        if (authoritative) dispatch("presence:sync", { online: r.online });
      } catch { /* offline or signed out - the next beat tries again */ }
      // Nothing pushes notification:new here, so the badge is refreshed on the same beat (A75).
      try { setUnread((await api<{ unread: number }>("/api/notifications?limit=1", { fresh: true })).unread); } catch { /* ignore */ }
    };

    (async () => {
      /* 1. A hosted realtime service, if this deployment has one (A76). Works anywhere, including
            serverless, because it is the browser that holds the connection, not the server. */
      const ably = await connectAbly(dispatch, setConnected);
      if (cancelled) { ably?.close(); return; }
      if (ably) {
        ablyRef.current = ably;
        setMode("ably");
        // The beat still writes lastActiveAt, so server-rendered pages know who is online too,
        // but Ably presence stays the source of truth for the live dots.
        void httpBeat(false);
        hb = setInterval(() => { void httpBeat(false); }, HEARTBEAT_MS);
        return;
      }

      /* 2. The custom server's own Socket.IO, when it is running. */
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
        if (everConnected) dispatch("realtime:reconnected", { at: Date.now() });
        everConnected = true;
      });
      socket.on("disconnect", () => setConnected(false));
      socket.onAny((event: string, payload: unknown) => dispatch(event, payload));
      // The socket carries the heartbeat; the HTTP beat covers a connection that drops later.
      hb = setInterval(() => { if (socket?.connected) socket.emit("presence:heartbeat"); else void httpBeat(); }, HEARTBEAT_MS);
    })();

    api<{ unread: number }>("/api/notifications?limit=1").then((r) => setUnread(r.unread)).catch(() => {});
    return () => {
      cancelled = true;
      if (hb) clearInterval(hb);
      socket?.disconnect(); socketRef.current = null;
      ablyRef.current?.close(); ablyRef.current = null;
    };
  }, []);

  const subscribe = useCallback((event: string, handler: Handler) => {
    const set = handlers.current.get(event) ?? new Set<Handler>();
    set.add(handler); handlers.current.set(event, set);
    return () => { set.delete(handler); };
  }, []);
  const emit = useCallback((event: string, payload?: unknown, ack?: (ok: boolean) => void) => { socketRef.current?.emit(event, payload, ack); }, []);

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
  const value = useMemo<RealtimeApi>(() => ({ connected, mode, subscribe, emit, setMutedConversation, unreadNotifications: unread, setUnreadNotifications: setUnread }), [connected, mode, subscribe, emit, setMutedConversation, unread]);
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
