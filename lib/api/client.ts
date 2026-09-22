/** Browser-side fetch wrapper matching the API conventions (spec section 9). */
export class ClientApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details: Record<string, unknown> = {}) {
    super(message);
  }
}

/**
 * Client-side GET cache (A63): stale-while-revalidate so a page you already visited renders from
 * memory instantly instead of showing a skeleton and hitting the database again.
 *  - A cached GET is served immediately and refreshed in the background (the next mount gets the newer copy).
 *  - Any non-GET call, any realtime event (every audited write emits one) and every socket reconnect
 *    clear the cache, so views that refetch after a change always get fresh data.
 *  - In-flight GETs are de-duplicated (two components asking for the same URL share one request).
 */
const CACHE_TTL_MS = 5 * 60_000;
const entries = new Map<string, { at: number; body: unknown }>();
const inflight = new Map<string, Promise<unknown>>();
export const apiCache = {
  clear: () => { entries.clear(); },
  /** Drop every cached URL that starts with the prefix (e.g. "/api/tasks"). */
  invalidate: (prefix: string) => { for (const k of entries.keys()) if (k.startsWith(prefix)) entries.delete(k); },
  size: () => entries.size,
};

async function fetchJson(path: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(path, { ...init, credentials: "same-origin" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = body?.error ?? {};
    throw new ClientApiError(res.status, err.code ?? "REQUEST_FAILED", err.message ?? "Request failed", err.details ?? {});
  }
  return body;
}

/** GET with cache + de-dupe; anything else runs straight through and clears the cache. */
async function request(path: string, init: RequestInit, opts: { fresh?: boolean } = {}): Promise<unknown> {
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET") {
    try { return await fetchJson(path, init); } finally { entries.clear(); }
  }
  const hit = entries.get(path);
  const revalidate = () => {
    if (inflight.has(path)) return inflight.get(path)!;
    const p = fetchJson(path, init).then((body) => { entries.set(path, { at: Date.now(), body }); return body; }).finally(() => inflight.delete(path));
    inflight.set(path, p);
    return p;
  };
  if (!opts.fresh && hit && Date.now() - hit.at < CACHE_TTL_MS) {
    void revalidate().catch(() => {});
    return hit.body;
  }
  return revalidate();
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown; fresh?: boolean } = {}): Promise<T> {
  const { json, headers, fresh, ...rest } = init;
  const body = await request(path, {
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  }, { fresh });
  const b = body as { data?: unknown };
  return (b.data ?? body) as T;
}

export async function apiPaged<T = unknown>(path: string, opts: { fresh?: boolean } = {}): Promise<{ data: T[]; meta: { page: number; limit: number; total: number; totalPages: number } }> {
  return (await request(path, {}, opts)) as { data: T[]; meta: { page: number; limit: number; total: number; totalPages: number } };
}
