/** Browser-side fetch wrapper matching the API conventions (spec section 9). */
export class ClientApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details: Record<string, unknown> = {}) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: "same-origin",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = body?.error ?? {};
    throw new ClientApiError(res.status, err.code ?? "REQUEST_FAILED", err.message ?? "Request failed", err.details ?? {});
  }
  return (body.data ?? body) as T;
}

export async function apiPaged<T = unknown>(path: string): Promise<{ data: T[]; meta: { page: number; limit: number; total: number; totalPages: number } }> {
  const res = await fetch(path, { credentials: "same-origin" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = body?.error ?? {};
    throw new ClientApiError(res.status, err.code ?? "REQUEST_FAILED", err.message ?? "Request failed", err.details ?? {});
  }
  return body;
}
