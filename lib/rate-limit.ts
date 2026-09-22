import { Errors } from "@/lib/api/errors";

/**
 * In-memory sliding-window limiter, sufficient for a single-node VPS deployment
 * (see ASSUMPTIONS.md). Swap for a Redis-backed store when running multiple app instances.
 */
const buckets = new Map<string, number[]>();

export function rateLimit(key: string, limit = 10, windowMs = 60_000): void {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    buckets.set(key, arr);
    throw Errors.rateLimited();
  }
  arr.push(now);
  buckets.set(key, arr);
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (v.every((t) => now - t >= windowMs)) buckets.delete(k);
  }
}
