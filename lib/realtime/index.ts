import { noopAdapter, type RealtimeAdapter } from "./adapter";

declare global {
  // eslint-disable-next-line no-var
  var __realtime: RealtimeAdapter | undefined;
}

/** The custom server registers the live adapter; everywhere else falls back to a no-op. */
export function registerRealtime(adapter: RealtimeAdapter) {
  global.__realtime = adapter;
}

export function realtime(): RealtimeAdapter {
  return global.__realtime ?? noopAdapter;
}

export { rooms } from "./adapter";
export type { RealtimeAdapter } from "./adapter";
