import { noopAdapter, type RealtimeAdapter } from "./adapter";
import { ablyAdapter, ablyConfigured } from "./ably";

declare global {
  // eslint-disable-next-line no-var
  var __realtime: RealtimeAdapter | undefined;
  // eslint-disable-next-line no-var
  var __realtimeAbly: RealtimeAdapter | undefined;
}

/** The custom server registers the live Socket.IO adapter when it is running. */
export function registerRealtime(adapter: RealtimeAdapter) {
  global.__realtime = adapter;
}

/**
 * Whichever transport this deployment actually has (A76):
 *  1. Socket.IO, when the custom server is running in this process.
 *  2. Ably, when `ABLY_API_KEY` is set - the case on a serverless host, where step 1 never happens.
 *  3. Nothing, in which case the browser falls back to polling and events are simply dropped.
 */
export function realtime(): RealtimeAdapter {
  if (global.__realtime) return global.__realtime;
  if (ablyConfigured()) return (global.__realtimeAbly ??= ablyAdapter());
  return noopAdapter;
}

export { rooms } from "./adapter";
export type { RealtimeAdapter } from "./adapter";
