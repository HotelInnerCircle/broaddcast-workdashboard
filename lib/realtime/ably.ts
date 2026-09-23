import Ably from "ably";
import { env } from "@/lib/env";
import { rooms, type RealtimeAdapter } from "./adapter";

/**
 * Ably adapter (A76): realtime on a host that cannot keep a WebSocket server of its own, such as
 * Vercel. Publishing is plain REST from the route handler, so it works inside a serverless
 * function; the browser subscribes with a short-lived token minted by `/api/realtime/token`,
 * scoped to that person's own two channels.
 *
 * The secret key never leaves the server.
 */
let rest: Ably.Rest | null = null;
function client(): Ably.Rest {
  if (!rest) rest = new Ably.Rest({ key: env.ABLY_API_KEY });
  return rest;
}

export const ablyConfigured = () => env.ABLY_API_KEY.length > 0;

/**
 * A token the browser can use, limited to the channels this person may read. Returns null if the
 * key is unusable - a typo in `ABLY_API_KEY` must degrade to the fallback transport, not answer
 * 500 to every browser on every page load.
 */
export async function createRealtimeToken(userId: string, companyId: string | null) {
  const capability: Record<string, Ably.capabilityOp[]> = { [rooms.user(userId)]: ["subscribe"] };
  // The company channel doubles as the presence set - entering it is what makes someone "online".
  if (companyId) capability[rooms.company(companyId)] = ["subscribe", "presence"];
  try {
    const tokenRequest = await client().auth.createTokenRequest({ clientId: userId, capability });
    return { tokenRequest, companyChannel: companyId ? rooms.company(companyId) : null, userChannel: rooms.user(userId) };
  } catch (e) {
    if (!warned) { warned = true; console.error("[realtime] ABLY_API_KEY is not usable, falling back:", e instanceof Error ? e.message : e); }
    rest = null; // a later key change should get a fresh client
    return null;
  }
}
let warned = false;

/** Publishes are fire-and-forget, like the Socket.IO adapter: a failed emit must never fail a request. */
function publish(channel: string, event: string, payload: unknown) {
  void client().channels.get(channel).publish(event, payload).catch((e: unknown) => {
    console.error("[realtime] ably publish failed", channel, event, e instanceof Error ? e.message : e);
  });
}

export function ablyAdapter(): RealtimeAdapter {
  return {
    emitToCompany: (companyId, event, payload) => publish(rooms.company(companyId), event, payload),
    emitToUser: (userId, event, payload) => publish(rooms.user(userId), event, payload),
    emitToUsers: (userIds, event, payload) => { for (const id of new Set(userIds)) publish(rooms.user(id), event, payload); },
  };
}
