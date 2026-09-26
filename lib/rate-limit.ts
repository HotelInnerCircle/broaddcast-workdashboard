import { Errors } from "@/lib/api/errors";

/**
 * In-memory sliding-window limiter.
 *
 * **Read this before relying on it.** The counters live in this process's memory,
 * so the limit is per instance, not per deployment. On a single VPS that is the
 * whole deployment and the limit means what it says. On Vercel - which is where
 * this app actually runs - requests are spread over however many instances are
 * warm, and each keeps its own count, so "ten sign-ins a minute" is ten per
 * instance and resets whenever an instance is recycled.
 *
 * It is therefore a speed bump against credential stuffing rather than a gate:
 * useful, and much better than nothing, but it should not be described as the
 * control that stops it. Making it real needs a shared store - Upstash Redis is
 * the usual answer on Vercel - keyed the same way, at which point only this file
 * changes. Tracked in ASSUMPTIONS.md.
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
