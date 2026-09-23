/**
 * In-process presence store (spec 7.6). Heartbeats arrive every 30s over the socket;
 * a user is "online" while a heartbeat is younger than 90s (or a socket is still open).
 * Single-node by design (spec 3.1); swap for Redis when running several app instances.
 */
export const HEARTBEAT_MS = 30_000;
export const OFFLINE_AFTER_MS = 90_000;

interface Entry { last: number; sockets: number; companyId: string | null; /** When a socket last saw this user leave, so a stale HTTP beat cannot resurrect them (A74). */ offlineAt?: number }

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
    store.set(userId, { last: now, sockets: (e?.sockets ?? 0) + (opened ? 1 : 0), companyId, offlineAt: undefined });
    return !wasOnline;
  },
  /** Socket closed cleanly: when it was the last one, the user is offline immediately. Returns true if now offline. */
  disconnect(userId: string): boolean {
    const e = store.get(userId);
    if (!e) return false;
    e.sockets = Math.max(0, e.sockets - 1);
    if (e.sockets === 0) { e.last = 0; e.offlineAt = Date.now(); return true; }
    return false;
  },
  /** When a socket in this process last saw the user disconnect, or null if it never has. */
  offlineSince(userId: string): number | null {
    return store.get(userId)?.offlineAt ?? null;
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
      if (e.last !== 0 && !isFresh(e, now)) { e.last = 0; e.sockets = 0; e.offlineAt = now; gone.push({ userId, companyId: e.companyId }); }
    }
    return gone;
  },
};

function isFresh(e: Entry, now: number) {
  return e.last !== 0 && now - e.last < OFFLINE_AFTER_MS;
}

/**
 * How recently `User.lastActiveAt` must have been written for the person to count as online when
 * the socket store cannot answer. The browser pings every 30s while a socket is unavailable, so
 * this allows two missed pings before anyone is called offline.
 */
export const LAST_ACTIVE_WINDOW_MS = 75_000;

/**
 * Presence with a fallback (A74). The in-memory store is exact and instant, but it only exists in a
 * process that owns the Socket.IO server - on a serverless host there is no such process, so
 * `isOnline` was false for everyone and the whole company showed as offline. `User.lastActiveAt`,
 * kept fresh by the browser's heartbeat, answers the question wherever the app runs.
 */
export function isOnlineUser(userId: string, lastActiveAt?: Date | string | null, now = Date.now()): boolean {
  if (presence.isOnline(userId, now)) return true;
  if (!lastActiveAt) return false;
  const at = lastActiveAt instanceof Date ? lastActiveAt.getTime() : new Date(lastActiveAt).getTime();
  if (!Number.isFinite(at) || now - at >= LAST_ACTIVE_WINDOW_MS) return false;
  // A socket here watched them leave. Their last HTTP beat only counts if it came after that -
  // otherwise closing a tab would leave the dot green for another minute.
  const offlineAt = presence.offlineSince(userId);
  return offlineAt === null || at > offlineAt;
}
