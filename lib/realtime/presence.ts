/**
 * In-process presence store (spec 7.6). Heartbeats arrive every 30s over the socket;
 * a user is "online" while a heartbeat is younger than 90s (or a socket is still open).
 * Single-node by design (spec 3.1); swap for Redis when running several app instances.
 */
export const HEARTBEAT_MS = 30_000;
export const OFFLINE_AFTER_MS = 90_000;

interface Entry { last: number; sockets: number; companyId: string | null }

declare global {
  // eslint-disable-next-line no-var
  var __presence: Map<string, Entry> | undefined;
}
const store: Map<string, Entry> = global.__presence ?? (global.__presence = new Map());

export const presence = {
  /** Returns true when this heartbeat flipped the user from offline to online. */
  heartbeat(userId: string, companyId: string | null, opened = false): boolean {
    const now = Date.now();
    const e = store.get(userId);
    const wasOnline = e ? isFresh(e, now) : false;
    store.set(userId, { last: now, sockets: (e?.sockets ?? 0) + (opened ? 1 : 0), companyId });
    return !wasOnline;
  },
  /** Socket closed cleanly: when it was the last one, the user is offline immediately. Returns true if now offline. */
  disconnect(userId: string): boolean {
    const e = store.get(userId);
    if (!e) return false;
    e.sockets = Math.max(0, e.sockets - 1);
    if (e.sockets === 0) { e.last = 0; return true; }
    return false;
  },
  isOnline(userId: string, now = Date.now()): boolean {
    const e = store.get(userId);
    return e ? isFresh(e, now) : false;
  },
  onlineIds(companyId: string, now = Date.now()): string[] {
    return [...store.entries()].filter(([, e]) => e.companyId === companyId && isFresh(e, now)).map(([id]) => id);
  },
  /** Users whose heartbeats went stale since the last sweep (dead connections without a close frame). */
  sweep(now = Date.now()): { userId: string; companyId: string | null }[] {
    const gone: { userId: string; companyId: string | null }[] = [];
    for (const [userId, e] of store) {
      if (e.last !== 0 && !isFresh(e, now)) { e.last = 0; e.sockets = 0; gone.push({ userId, companyId: e.companyId }); }
    }
    return gone;
  },
};

function isFresh(e: Entry, now: number) {
  return e.last !== 0 && now - e.last < OFFLINE_AFTER_MS;
}
